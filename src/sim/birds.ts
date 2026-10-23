/**
 * The birds of the land (thread "Birds in the interior"; how many: `HabitatParams.life.birds`; what each species is
 * like and its body: gen/birds.ts), and where each is at any moment: a pure function of the habitat's seed, its land
 * and the clock, like the people and the other animals. The calls heard on the land (sim/sounds.ts `callsIn`) are these
 * birds singing: each song comes from a bird that is on its song post then, so what is heard can be seen.
 *
 *   songbirds  blackbirds, robins, wrens, song thrushes, woodpeckers and wood pigeons hold territories in the woods,
 *              `birds.woods` per hectare of closed crowns, each round a home tree the scatter planted (gen/scatter.ts)
 *              and a few more trees near it, whose tops are its song posts (a wren's are bush tops). It lives in slots
 *              (`SLOT`): at the start of each it flies (or, on the ground, hops) to its next spot, then stays there:
 *              singing on a post (most at the dawn chorus, as the light comes up over its trees), sitting and looking
 *              about, or feeding on the ground near its trees (in the bushes for a wren, up in the trees for a
 *              woodpecker). At night it roosts deep in its home tree's crown.
 *   skylarks   live on the open meadows, `birds.larks` per hectare: they feed on the ground and, in cycles, rise
 *              singing in a slow spiral, hang singing high over the meadow for minutes and come down, the last metres
 *              with wings closed.
 *   owls       tawny owls, `birds.owls` per km² of woods, are the other way round: out at night on their perches,
 *              hooting and flying between them; by day they roost in their tree.
 *
 * Flight follows the spin's physics (world/motion.ts). A bird's path is its own choice; what its wings must give to
 * fly it is not: the path's acceleration less the apparent gravity and Coriolis acceleration where it is (`wingsFor`).
 * Lift is the part of that across its way, and the bird banks and pitches to it: heavier flying spinward, lighter
 * against the spin, pushed sideways as it climbs or dives. How hard it works (how far and how fast its wings beat, and
 * whether it can glide) follows from what it carries and the air's density there (thinner toward the axis): wingbeats
 * go with the square root of the load (Pennycuick), so in weak gravity a bird beats slowly and glides often. Pure.
 */
import { clamp, hash3i, smootherstep, smoothstep, v3add, v3cross, v3dot, v3madd, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat } from '../blueprint';
import { BIRDS, feetOf, lookFor, type BirdKind, type BirdSpec } from '../gen/birds';
import type { Ecology } from '../gen/ecology';
import { kept } from '../gen/kept';
import { LEVELS, poseOf, standsIn, type Species } from '../gen/scatter';
import type { Terrain } from '../gen/terrain';
import { apparentAcceleration, upAt } from '../world/motion';
import { emissionAt, sunlineEmission } from '../world/sunline';
import { TREE_SEARCH, crownsOf, open, treeNear } from './fauna';
import { unit } from './population';
import { floorGap } from './walks';

const TURN = 2 * Math.PI;
const G0 = 9.81;

/** A bird's home and who it is: the same every time it is asked for. */
export interface Nest {
  /** Its own number: the same bird every time. */
  id: number;
  kind: BirdKind;
  /** Its home: its home tree's foot (a lark's: its patch of meadow). */
  theta: number;
  s: number;
  seed: number;
  /** Its size (× its species' length) and look (index into the species' looks). */
  size: number;
  look: number;
  /** Its perches (a lark has none): the top of a tree or bush each, its home tree's first (a wren's: bush tops). */
  perches: Perch[];
  /** Where it roosts: deep in its home tree's crown (a lark: on the ground at home). */
  roost: Perch;
}

/** A place a bird's feet are: (θ, s), their height over the profile (m), and whether that is the ground. */
export interface Perch {
  theta: number;
  s: number;
  h: number;
  ground?: boolean;
}

/** What a bird is doing. */
export type BirdDoing = 'roost' | 'perch' | 'sing' | 'feed' | 'hop' | 'fly' | 'climb' | 'hover' | 'drop';

/** A bird at a moment, posed: where its body is, which way it faces and how its wings, tail, beak and head are. */
export interface BirdNow {
  kind: BirdKind;
  /** Its origin (gen/birds.ts: the middle of its body; world), its forward and its up (unit, world). */
  at: Vec3;
  fwd: Vec3;
  up: Vec3;
  /** Its length (m): its species' times its own size. */
  length: number;
  /** Wings folded (1) or open (0); beats a second; how far they beat and how far they are held up (rad); the tail fanned (0 … 1). */
  fold: number;
  beat: number;
  amp: number;
  bias: number;
  spread: number;
  /** The beak open (0 … 1), the head turned to its left (rad) and down (rad). */
  gape: number;
  yaw: number;
  nod: number;
  doing: BirdDoing;
  /** How fast it goes (m/s). */
  speed: number;
}

/** A song: which bird's call, where (world, its head) and when it starts (clock s). */
export interface Song {
  kind: BirdKind;
  at: Vec3;
  t: number;
}

/** A songbird's slot (s): its move to its next spot, then whatever it does there. An owl's is longer. */
export const SLOT = 20;
const OWL_SLOT = 60;
/** A lark's cycle (s): feeding on the ground, then (most cycles) its song flight. */
export const LARK_CYCLE = 420;
/** The light (share of the day's) at which songbirds wake and owls go to roost. */
export const WAKE = 0.05;
/** The light this many seconds ago tells rising light (dawn chorus) from falling. */
export const LIGHT_LAG = 900;
/** How the territories' birds are shared among the woods' species. */
export const WOOD_SHARES: readonly [BirdKind, number][] = [['blackbird', 0.25], ['robin', 0.2], ['wren', 0.15], ['thrush', 0.15], ['woodpecker', 0.08], ['pigeon', 0.17]];
/** Trees this tall at least (m) are homes and song posts; bushes from `BUSH[0]` to `BUSH[1]` tall are a wren's posts. */
const TREE = 4;
const BUSH: [number, number] = [0.4, 4];
/** Perches besides the home tree, at most; the share of a plant's height its top perch is at, and a roost. */
const MORE_PERCHES = 3;
const TOP = 0.97;
const ROOST = 0.62;
/** Owls' cells (m), and how far round their home tree their perches are. */
const OWL_CELL = 400;
const OWL_REACH = 60;
/** On the ground: it feeds within this of a perch's foot (m); moves shorter than `HOP_MOST` are hopped. */
const FEED_REACH = 12;
const HOP_MOST = 2.5;
/** A hop: how far (m), how long (s), and the pause after it (s); how high it bounces (m). */
const HOP = 0.3;
const HOP_TIME = 0.2;
const HOP_PAUSE = 0.2;
const HOP_RISE = 0.05;
/** How long wings take to open on taking off and to fold on landing (s); how long a turn on the spot takes (s). */
const OPEN_TIME = 0.18;
const CLOSE_TIME = 0.25;
const TURN_TIME = 0.4;
/** How the sizes of birds of a species differ (± share). */
const SIZES = 0.06;
/** A woodpecker's bounds: their period (s), the share of it beating, how far the path rises and falls (m). */
const BOUND = 0.9;
const BOUND_BEATS = 0.55;
const BOUND_RISE = 0.25;
/** The share of a flight's time spent speeding up, and again slowing down. */
const RAMP = 0.25;
/** A path's speed and acceleration are taken over this step (s). */
const DT = 0.04;
/** A lark's song flight: climb (s), hang singing (s), come down (s), how high (m); the spiral's radius (m) and a turn's time (s). */
const LARK_CLIMB: [number, number] = [50, 40];
const LARK_HANG: [number, number] = [90, 120];
const LARK_DOWN = 22;
const LARK_HIGH: [number, number] = [30, 35];
const LARK_RADIUS = 6;
const LARK_TURN = 14;
/** The last stretch a lark drops with wings closed (m). */
const LARK_DROP = 5;
/** How far from home a lark feeds (m). */
const LARK_FEEDS = 25;

/** The habitat's seed for its birds. */
const seedOf = kept((h: Habitat): number => hash3i(h.seed, 0xb1d5, 3, 0));

/**
 * The birds whose homes lie within `radius` m of (θ, s): songbirds in the woods' cells, larks on the meadows' and owls
 * in larger cells of their own. For the worker (it needs the ecology and the plants); `plants` is `plantsOf(ecology)`.
 * Each cell's birds are worked out once and kept (`CELLS_KEPT` cells), so a scan after a move works out only new cells.
 */
export function nestsNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, radius: number): Nest[] {
  const t = ecology.terrain, h = t.habitat, b = h.params.life.birds, crowns = crownsOf(ecology), out: Nest[] = [], cache = cellsOf(ecology);
  const isPlant = (sp: Species): boolean => sp.what === 'plant' || sp.what === 'planted';
  const trees = plants.filter((sp) => isPlant(sp) && sp.spec.height[1] >= TREE);
  const bushes = plants.filter((sp) => isPlant(sp) && sp.spec.height[1] >= BUSH[0] && sp.spec.height[1] < BUSH[1]);
  const seed = seedOf(h), G = 2 * b.territory, colour = new Float32Array(3), floor = new Uint8Array(8);
  const within = (r: number) => (n: Nest): boolean => floorGap(r, theta, s, n.theta, n.s) <= radius;
  const cached = (key: string, make: () => Nest[]): Nest[] => {
    let nests = cache.get(key);
    if (!nests) {
      if (cache.size >= CELLS_KEPT) cache.clear();
      cache.set(key, (nests = make()));
    }
    return nests;
  };
  cells(h, theta, s, radius, G, (row, col, mid, sMid, dTheta, r) => {
    for (const n of cached(`${row}:${col}`, () => {
      const nests: Nest[] = [], ground = t.heightAt(mid, sMid);
      if (t.standAt(mid, sMid) > ground + 0.05) return nests;
      const cover = crowns(mid, sMid, ground), cell = hash3i(seed, row, col, 1);
      // Songbirds where there are woods.
      const songbirds = count((b.woods * G * G * cover) / 1e4, unit(cell, 0, 0, 0));
      for (let j = 0; j < songbirds; j++) {
        const home = treeNear(ecology, trees, cell, j, col * dTheta, row * G, dTheta, G);
        if (!home) continue;
        const kind = pick(WOOD_SHARES, unit(cell, j, 5, 0)), own = hash3i(cell, j, 6, 0), wren = kind === 'wren';
        nests.push({ id: idOf(row, col, j, 0), kind, theta: home.theta, s: home.s, seed: own, ...sizeLook(kind, own), ...perchesNear(ecology, wren ? bushes : trees, home, b.territory * (wren ? 0.3 : 0.5), own, wren) });
      }
      // Larks on open meadow.
      ecology.colorAt(mid, sMid, ground, 0, colour, 0, undefined, floor);
      const meadow = (floor[0] + floor[1]) / 255, larks = count((b.larks * G * G * meadow * Math.max(0, 1 - 4 * cover)) / 1e4, unit(cell, 1, 0, 0));
      for (let j = 0; j < larks; j++) {
        const at = { theta: col * dTheta + dTheta * unit(cell, j, 7, 0), s: Math.min(h.profile.length, row * G + G * unit(cell, j, 8, 0)) };
        if (!open(t, at.theta, at.s) || t.form.inWater(at.theta, at.s)) continue;
        const own = hash3i(cell, j, 9, 0);
        nests.push({ id: idOf(row, col, j, 1), kind: 'lark', ...at, seed: own, ...sizeLook('lark', own), perches: [], roost: { ...at, h: t.standAt(at.theta, at.s), ground: true } });
      }
      return nests;
    })) if (within(r)(n)) out.push(n);
  });
  // Owls: one to a large cell where it is wooded enough.
  cells(h, theta, s, radius, OWL_CELL, (row, col, mid, sMid, dTheta, r) => {
    for (const n of cached(`owl:${row}:${col}`, () => {
      const ground = t.heightAt(mid, sMid), cell = hash3i(seed, row, col, 2);
      if (t.standAt(mid, sMid) > ground + 0.05) return [];
      if (count((b.owls * OWL_CELL * OWL_CELL * crowns(mid, sMid, ground)) / 1e6, unit(cell, 0, 0, 0)) < 1) return [];
      const home = treeNear(ecology, trees, cell, 0, col * dTheta, row * OWL_CELL, dTheta, OWL_CELL);
      if (!home) return [];
      const own = hash3i(cell, 0, 6, 0);
      return [{ id: idOf(row, col, 0, 2), kind: 'owl', theta: home.theta, s: home.s, seed: own, ...sizeLook('owl', own), ...owlPerches(ecology, trees, home, own) }];
    })) if (within(r)(n)) out.push(n);
  });
  return out;
}

/**
 * An owl's perches: its home tree's top and the trees nearest a few spots within `OWL_REACH` of it (its territory is
 * wide, so it is not searched whole); its roost in its home tree's crown.
 */
function owlPerches(ecology: Ecology, trees: readonly Species[], home: { theta: number; s: number; height: number }, own: number): { perches: Perch[]; roost: Perch } {
  const t = ecology.terrain, r = Math.max(1, t.habitat.profile.at(home.s).r), ground = t.heightAt(home.theta, home.s), perches: Perch[] = [{ theta: home.theta, s: home.s, h: ground + home.height * TOP }];
  for (let j = 1; j <= MORE_PERCHES; j++) {
    const tree = treeNear(ecology, trees, own, j, home.theta - OWL_REACH / r, home.s - OWL_REACH, (2 * OWL_REACH) / r, 2 * OWL_REACH);
    if (tree && floorGap(r, home.theta, home.s, tree.theta, tree.s) > 1) perches.push({ theta: tree.theta, s: tree.s, h: t.heightAt(tree.theta, tree.s) + tree.height * TOP });
  }
  return { perches, roost: { theta: home.theta, s: home.s, h: ground + home.height * ROOST } };
}

/** Each ecology's cells' birds as worked out, by cell; at most this many cells kept. */
const cellsOf = kept((_: Ecology) => new Map<string, Nest[]>());
const CELLS_KEPT = 1024;

/** How far a home may stand outside its cell (m): its tree is the nearest to a spot of the cell, searched in a square. */
const SLACK = TREE_SEARCH * Math.SQRT2;

/**
 * Every cell of side `G` (rows along the axis, as many cells round it as fit) whose homes may stand within `reach` of
 * (θ, s): the cells reaching that far, and those a home's slack past it.
 */
function cells(h: Habitat, theta: number, s: number, reach: number, G: number, visit: (row: number, col: number, mid: number, sMid: number, dTheta: number, r: number) => void): void {
  const { profile } = h, rows = Math.floor(profile.length / G), far = reach + SLACK;
  for (let k = Math.max(0, Math.floor((s - far) / G)); k <= Math.min(rows, Math.floor((s + far) / G)); k++) {
    const sMid = Math.min(profile.length, (k + 0.5) * G), r = Math.max(1, profile.at(sMid).r);
    const n = Math.max(1, Math.round((TURN * r) / G)), dTheta = TURN / n, around = far / r;
    const c0 = Math.floor((theta - around) / dTheta), c1 = Math.min(c0 + n - 1, Math.floor((theta + around) / dTheta));
    for (let cc = c0; cc <= c1; cc++) {
      const c = ((cc % n) + n) % n;
      visit(k, c, (c + 0.5) * dTheta, sMid, dTheta, r);
    }
  }
}

/** A whole number for an expected count: its whole part, and one more by chance. */
const count = (expect: number, chance: number): number => Math.floor(expect) + (chance < expect - Math.floor(expect) ? 1 : 0);
const idOf = (row: number, col: number, j: number, group: number): number => ((row * 100000 + col) * 32 + j) * 4 + group;

/** What a draw (0 … 1) picks from shares. */
function pick<T>(shares: readonly [T, number][], u: number): T {
  for (const [what, share] of shares) { if (u < share) return what; u -= share; }
  return shares[shares.length - 1][0];
}

const sizeLook = (kind: BirdKind, own: number): { size: number; look: number } => ({ size: 1 + SIZES * (2 * unit(own, 1, 2, 3) - 1), look: lookFor(kind, unit(own, 4, 5, 6)) });

/**
 * A bird's perches and roost: its home tree's top and up to `MORE_PERCHES` tops of the plants within `reach` of it,
 * picked by its seed; its roost in its home tree's crown. A wren's posts are the bushes nearest its home.
 */
function perchesNear(ecology: Ecology, plants: readonly Species[], home: { theta: number; s: number; height: number }, reach: number, own: number, bushes: boolean): { perches: Perch[]; roost: Perch } {
  const t = ecology.terrain, { profile } = t.habitat, r = Math.max(1, profile.at(home.s).r), shapes = LEVELS[0].variants;
  const found: (Perch & { d: number; foot: number })[] = [];
  const b = { theta0: home.theta - reach / r, theta1: home.theta + reach / r, s0: home.s - reach, s1: home.s + reach };
  for (const sp of plants) standsIn(ecology, sp, b, 0, (pt, ps, ground, f, along) => {
    const d = floorGap(r, home.theta, home.s, pt, ps);
    if (d > reach || d < 0.5) return;
    const height = poseOf(ecology, sp, pt, ps, toWorld(profile, { theta: pt, s: ps, h: ground }), f, along, shapes).height;
    found.push({ theta: pt, s: ps, h: ground + height * TOP, d, foot: ground });
  });
  const ground = t.heightAt(home.theta, home.s);
  const top: Perch = { theta: home.theta, s: home.s, h: ground + home.height * TOP };
  const roost: Perch = { theta: home.theta, s: home.s, h: ground + home.height * ROOST };
  const strip = ({ theta, s, h }: Perch): Perch => ({ theta, s, h });
  if (bushes) {
    // A wren's posts are the bushes nearest its home, and it roosts deep in the nearest.
    const near = found.sort((a, c) => a.d - c.d).slice(0, MORE_PERCHES + 1);
    if (!near.length) return { perches: [top], roost };
    const first = near[0];
    return { perches: near.map(strip), roost: { theta: first.theta, s: first.s, h: first.foot + (first.h - first.foot) * ROOST } };
  }
  const ranked = found.map((p, k) => ({ p, rank: unit(own, k, 11, 0) })).sort((a, c) => a.rank - c.rank).slice(0, MORE_PERCHES);
  return { perches: [top, ...ranked.map((x) => strip(x.p))], roost };
}

// --- light ---------------------------------------------------------------------------------------------------------

/** Per habitat: the brightest the sunline's bright stretch gets (its peak at midday). */
const peakOf = kept((h: Habitat): number => Math.max(1e-6, ...sunlineEmission(h, (h.params.day.length * h.params.day.daylight) / 2)));

/** The sunline's emission profiles worked out per habitat, by `LIGHT_STEP` of the clock (many birds ask in one step). */
const emissions = new WeakMap<Habitat, Map<number, Float32Array>>();
/** The clock step the birds read the light in (s): it changes slowly, so they share the profile. */
const LIGHT_STEP = 60;

/** The share of the day's light over a point along the axis at clock time t (0 … 1). `buffer` is a scratch (any length). */
export function lightAt(h: Habitat, s: number, t: number, buffer?: Float32Array<ArrayBuffer>): number {
  const e = sunlineEmission(h, t, buffer);
  return Math.min(1, emissionAt(e, h.params.length, h.profile.at(s).z) / peakOf(h));
}

/** The same, the clock taken to its `LIGHT_STEP` (the profile worked out once a step, shared by every bird; a few kept). */
function lightNow(h: Habitat, s: number, t: number): number {
  const step = Math.floor(t / LIGHT_STEP) * LIGHT_STEP;
  let cache = emissions.get(h);
  if (!cache) emissions.set(h, (cache = new Map()));
  let e = cache.get(step);
  if (!e) {
    if (cache.size >= 64) cache.clear();
    cache.set(step, (e = sunlineEmission(h, step)));
  }
  return Math.min(1, emissionAt(e, h.params.length, h.profile.at(s).z) / peakOf(h));
}

/** How busy the birds are at a light that is rising or falling: a chorus as it comes up, quieter through the day, none at night. */
export function chorusAt(light: number, rising: boolean): number {
  if (light < 0.04) return 0;
  const day = 0.35 * smoothstep(0.04, 0.3, light);
  const chorus = rising ? Math.exp(-(((light - 0.3) / 0.22) ** 2)) : 0;
  return Math.min(1, day + chorus);
}

/** Whether a bird is out (songbirds and larks by day, owls by night) and how busy the birds are, at a place and time. */
function dayAt(h: Habitat, kind: BirdKind, s: number, t: number): { awake: boolean; busy: number } {
  const light = lightNow(h, s, t), before = lightNow(h, s, t - LIGHT_LAG);
  const awake = BIRDS[kind].night ? light < WAKE : light >= WAKE;
  return { awake, busy: BIRDS[kind].night ? (awake ? 0.6 : 0) : chorusAt(light, light > before) };
}

// --- the day: spots and moves ----------------------------------------------------------------------------------------

/** Where a bird's feet are and what it does there. */
interface Place {
  at: Perch;
  doing: 'roost' | 'perch' | 'sing' | 'feed';
}

/** A place with the way the bird faces there (world, along the floor), its body's tilt up from that (rad) and its origin (world). */
interface Spot extends Place {
  heading: Vec3;
  tilt: number;
  origin: Vec3;
  /** Its origin on the profile (θ, s, height), for paths through it. */
  on: { theta: number; s: number; h: number };
}

/** A slot as worked out once: where the bird came from and went, how (flying, hopping or turning on the spot), for how long. */
interface Slot {
  n: number;
  from: Spot;
  to: Spot;
  move: 'fly' | 'hop' | 'turn';
  /** How long the move takes (s), and the path's arc over the straight line (m). */
  time: number;
  arc: number;
}

/** The last slot worked out per bird (each is a pure function of the bird and n; this only saves working it out again). */
const lastSlot = new WeakMap<Nest, Slot>();

const slotLength = (kind: BirdKind): number => (kind === 'owl' ? OWL_SLOT : SLOT);

/** The bird's own offset into its slots (s), so its neighbours keep their own time. */
const phaseOf = (nest: Nest, length: number): number => length * unit(nest.seed, 7, 7, 7);

/** Slot n: from slot n − 1's spot to slot n's, and how. */
function slotOf(t: Terrain, nest: Nest, n: number): Slot {
  const was = lastSlot.get(nest);
  if (was && was.n === n) return was;
  const from = was && was.n === n - 1 ? was.to : spotOf(t, nest, n - 1), to = spotOf(t, nest, n);
  const gap = Math.hypot(...v3sub(to.origin, from.origin)), spec = BIRDS[nest.kind];
  let move: Slot['move'] = 'fly', time: number, arc = 0;
  if (gap < 0.02) { move = 'turn'; time = TURN_TIME; }
  else if (from.at.ground && to.at.ground && gap < HOP_MOST) { move = 'hop'; time = Math.ceil(gap / HOP) * (HOP_TIME + HOP_PAUSE); }
  else { time = gap / (Math.min(spec.cruise, 2 + gap / 2.5) * (1 - RAMP)) + 0.4; arc = clamp(0.15 * gap, 0.3, 8); }
  const slot: Slot = { n, from, to, move, time: Math.min(time, slotLength(nest.kind) * 0.8), arc };
  lastSlot.set(nest, slot);
  return slot;
}

/** Where a songbird or owl is in slot n and what it does: roosting, on a post (singing or not), or feeding. */
function placeOf(t: Terrain, nest: Nest, n: number): Place {
  const h = t.habitat, spec = BIRDS[nest.kind], L = slotLength(nest.kind);
  const { awake, busy } = dayAt(h, nest.kind, nest.s, n * L - phaseOf(nest, L));
  if (!awake) return { at: nest.roost, doing: 'roost' };
  const u = (k: number): number => unit(nest.seed, n, k, 3), posts = nest.perches, post = (k: number): Perch => posts[Math.floor(u(k) * posts.length) % posts.length];
  if (u(1) < 0.35 + 0.5 * busy || spec.forage !== 'ground') {
    const sings = u(3) < 0.25 + 0.75 * busy;
    return { at: post(2), doing: sings ? 'sing' : spec.forage === 'ground' || spec.night ? 'perch' : 'feed' };
  }
  // On the ground near one of its posts, where it is open; else it stays up on the post.
  const near = post(4), r = Math.max(1, h.profile.at(near.s).r), d = FEED_REACH * Math.sqrt(u(5)), a = TURN * u(6);
  const theta = near.theta + (d * Math.cos(a)) / r, s = clamp(near.s + d * Math.sin(a), 0, h.profile.length);
  return open(t, theta, s) ? { at: { theta, s, h: t.standAt(theta, s), ground: true }, doing: 'feed' } : { at: near, doing: 'perch' };
}

/** Slot n's spot: its place, facing the way it came from slot n − 1's. */
function spotOf(t: Terrain, nest: Nest, n: number): Spot {
  return placed(t.habitat, nest, placeOf(t, nest, n), placeOf(t, nest, n - 1).at, n);
}

/**
 * A place with its heading (the way the bird came from `from`; staying put, a way of its own for the slot, or at roost
 * always the same), its tilt and its origin.
 */
function placed(h: Habitat, nest: Nest, place: Place, from: Perch | undefined, n: number): Spot {
  const spec = BIRDS[nest.kind], { at, doing } = place, feet = toWorld(h.profile, at), up = upOf(feet);
  let way: Vec3 | null = null;
  if (from) {
    const d = v3sub(feet, toWorld(h.profile, from)), flat = v3madd(d, up, -v3dot(d, up));
    if (Math.hypot(...flat) > 0.05) way = v3norm(flat);
  }
  if (!way) {
    const a = TURN * unit(nest.seed, doing === 'roost' ? 0 : n, 9, 3), side = spinward(up), along = v3cross(up, side);
    way = v3norm(v3madd(v3scale(along, Math.cos(a)), side, Math.sin(a)));
  }
  const tilt = doing === 'roost' ? spec.stance * 0.7 : at.ground ? spec.stance * 0.4 : spec.stance;
  const origin = originOn(spec, nest, feet, up, way, tilt);
  return { at, doing, heading: way, tilt, origin, on: fromWorld(h.profile, ...origin) };
}

/** Up at a point: toward the axis (birds are never on it). */
const upOf = (p: Vec3): Vec3 => upAt(p) ?? [0, 1, 0];

/** Spinward at a point with up `up` (+θ). */
const spinward = (up: Vec3): Vec3 => [up[1], -up[0], 0];

/** A bird's frame tilted nose up by `tilt` from a heading along the floor: its forward and up. */
function bodyFrame(heading: Vec3, up: Vec3, tilt: number): { fwd: Vec3; up: Vec3 } {
  const c = Math.cos(tilt), s = Math.sin(tilt), level = v3norm(v3madd(heading, up, -v3dot(heading, up)));
  return { fwd: v3norm(v3madd(v3scale(level, c), up, s)), up: v3norm(v3madd(v3scale(up, c), level, -s)) };
}

/** Its origin standing with its feet at `feet`: the body above them, tilted about them. */
function originOn(spec: BirdSpec, nest: Nest, feet: Vec3, up: Vec3, heading: Vec3, tilt: number): Vec3 {
  const L = spec.length * nest.size, f = feetOf(nest.kind), frame = bodyFrame(heading, up, tilt);
  // The soles are at (0, −stand, hip) in the bird's frame.
  return v3madd(v3madd(feet, frame.up, f.stand * L), frame.fwd, -f.hip * L);
}

// --- where a bird is now -------------------------------------------------------------------------------------------

/** Bird `nest` at clock time t (s), posed. */
export function birdAt(t: Terrain, nest: Nest, time: number): BirdNow {
  return nest.kind === 'lark' ? larkAt(t, nest, time) : songbirdAt(t, nest, time);
}

/** A songbird or an owl: in its slot's move, or at its spot. */
function songbirdAt(t: Terrain, nest: Nest, time: number): BirdNow {
  const h = t.habitat, spec = BIRDS[nest.kind], L = slotLength(nest.kind), shifted = time + phaseOf(nest, L);
  const n = Math.floor(shifted / L), tau = shifted - n * L, slot = slotOf(t, nest, n), { from, to } = slot;
  if (tau < slot.time && slot.move === 'fly') {
    const bounds = spec.flight === 'bound' ? slot.time : 0;
    return flying(h, nest, (q) => arcPoint(h, from.on, to.on, q, slot.arc, bounds), slot.time, tau, from, to);
  }
  if (tau < slot.time && slot.move === 'hop') return hopping(h, nest, slot, tau);
  if (tau < slot.time) {
    // Turning on the spot: from the way it faced to its new one.
    const k = smootherstep(0, 1, tau / slot.time), mixed = v3madd(v3scale(from.heading, 1 - k), to.heading, k);
    const heading = Math.hypot(...mixed) > 0.1 ? v3norm(mixed) : k < 0.5 ? from.heading : to.heading;
    const feet = toWorld(h.profile, to.at), up = upOf(feet);
    return sitting(nest, to, originOn(spec, nest, feet, up, heading, to.tilt), heading, time, null);
  }
  return sitting(nest, to, to.origin, to.heading, time, songOn(nest, slot, tau));
}

/** A bird at its spot: sitting or standing, looking about, feeding, singing (`song`: s into a song, or null); roosting still. */
function sitting(nest: Nest, spot: Spot, origin: Vec3, heading: Vec3, time: number, song: number | null): BirdNow {
  const spec = BIRDS[nest.kind], frame = bodyFrame(heading, upOf(origin), spot.tilt);
  const look = Math.floor(time / 2.5), glance = (k: number): number => (unit(nest.seed, look + k, 21, 0) - 0.5) * 1.6;
  let yaw = spot.doing === 'roost' ? 0 : glance(-1) + (glance(0) - glance(-1)) * smootherstep(0, 0.3, time - look * 2.5), nod = 0, gape = 0;
  if (spot.doing === 'feed' && spot.at.ground) {
    // Pecking: the head down for a moment, now and then.
    const peck = Math.floor(time / 0.9), into = time - peck * 0.9;
    const down = unit(nest.seed, peck, 23, 0) < 0.5 ? smoothstep(0, 0.1, into) * (1 - smoothstep(0.25, 0.4, into)) : 0;
    nod = 0.9 * down;
    yaw *= 1 - down;
  }
  if (song !== null) { gape = 0.35 + 0.35 * Math.sin(song * TURN * 6) ** 2; nod = -0.25; yaw *= 0.3; }
  return {
    kind: nest.kind, at: origin, fwd: frame.fwd, up: frame.up, length: spec.length * nest.size, fold: 1, beat: 0, amp: 0, bias: 0, spread: 0,
    gape, yaw, nod, doing: song !== null ? 'sing' : spot.doing === 'sing' ? 'perch' : spot.doing, speed: 0,
  };
}

/** How far into a song a bird on its post is at τ into its slot (s), or null between songs. */
function songOn(nest: Nest, slot: Slot, tau: number): number | null {
  if (slot.to.doing !== 'sing') return null;
  const spec = BIRDS[nest.kind], every = songEvery(nest, slot.n), first = slot.time + 0.6;
  if (tau < first - 1e-6) return null;
  const since = Math.max(0, tau - first), into = Math.max(0, since - every * Math.floor(since / every + 1e-9));
  return into < spec.song[0] && tau - into + spec.song[0] < slotLength(nest.kind) ? into : null;
}

/** How long from one song to the next in a slot (s). */
const songEvery = (nest: Nest, n: number): number => BIRDS[nest.kind].song[1] * (0.8 + 0.4 * unit(nest.seed, n, 25, 0));

/** The share of the way at a share q of the time: speeding up over the first `RAMP` of it, cruising, slowing over the last. */
function cruising(q: number): number {
  const ramp = (u: number): number => u * u * u - (u * u * u * u) / 2;
  if (q <= 0) return 0;
  if (q >= 1) return 1;
  if (q < RAMP) return (RAMP * ramp(q / RAMP)) / (1 - RAMP);
  if (q > 1 - RAMP) return 1 - (RAMP * ramp((1 - q) / RAMP)) / (1 - RAMP);
  return (q - RAMP / 2) / (1 - RAMP);
}

/** Between two points on the profile a share q of the way (eased from rest to rest), lifted in an arc; a bounding bird's path rises and falls. */
function arcPoint(h: Habitat, a: { theta: number; s: number; h: number }, b: { theta: number; s: number; h: number }, q: number, arc: number, bounds: number): Vec3 {
  const e = cruising(q), dTheta = Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta));
  let lift = arc * Math.sin(Math.PI * e);
  if (bounds > 0) lift += BOUND_RISE * Math.sin((TURN * q * bounds) / BOUND) * Math.sin(Math.PI * q);
  return toWorld(h.profile, { theta: a.theta + dTheta * e, s: a.s + (b.s - a.s) * e, h: a.h + (b.h - a.h) * e + lift });
}

/**
 * A bird in flight along `path` (q: 0 … 1 of the way) taking `time` s, τ s in: its velocity and acceleration from the
 * path, what its wings must give for them (`wingsFor`), and so its pose, its wingbeats and whether it glides. Taking
 * off and landing it opens and folds its wings; a lark's last drop is with wings closed.
 */
function flying(h: Habitat, nest: Nest, path: (q: number) => Vec3, time: number, tau: number, from: Spot, to: Spot, doing: BirdDoing = 'fly'): BirdNow {
  const spec = BIRDS[nest.kind], q = (x: number): number => clamp(x / time, 0, 1);
  const p = path(q(tau)), p0 = path(q(tau - DT)), p1 = path(q(tau + DT));
  const v = v3scale(v3sub(p1, p0), 1 / (2 * DT)), a = v3scale(v3add(v3sub(p1, p), v3sub(p0, p)), 1 / (DT * DT));
  const open = Math.min(smoothstep(0, OPEN_TIME, tau), smoothstep(0, CLOSE_TIME, time - tau)), fold = 1 - open;
  const sit = q(tau) < 0.5 ? from : to, w = wingsFor(h, spec, p, v, a, sit.heading);
  // Wings closed it is posed as it sits; open, by what its wings carry.
  const rest = bodyFrame(sit.heading, upOf(p), sit.tilt);
  const fwd = v3norm(v3madd(v3scale(w.fwd, open), rest.fwd, fold)), up = v3norm(v3madd(v3scale(w.up, open), rest.up, fold));
  let amp = w.amp, bias = 0, wingFold = fold;
  if (doing === 'drop') { wingFold = Math.max(fold, 0.9); amp = 0; }
  else if (spec.flight === 'glide' && w.effort < 0.5) { amp = 0.05; bias = 0.12; }
  else if (spec.flight === 'glide' && w.effort < 1.1 && Math.sin((TURN * tau) / 2.3 + nest.seed) > 0.4 + 0.5 * w.effort) { amp = 0.06; bias = 0.1; }
  else if (spec.flight === 'bound' && (tau / BOUND) % 1 > BOUND_BEATS && tau > OPEN_TIME && time - tau > CLOSE_TIME) { wingFold = Math.max(fold, 0.85); amp = 0; }
  const slow = 1 - clamp(w.speed / (0.6 * spec.cruise), 0, 1);
  return {
    kind: nest.kind, at: p, fwd, up, length: spec.length * nest.size, fold: wingFold, beat: w.beat, amp: amp * open, bias: bias * open,
    spread: Math.max(slow, w.flare), gape: 0, yaw: 0, nod: 0, doing, speed: w.speed,
  };
}

/** Hopping over the ground: hop after hop along the way, a pause after each. */
function hopping(h: Habitat, nest: Nest, slot: Slot, tau: number): BirdNow {
  const spec = BIRDS[nest.kind], each = HOP_TIME + HOP_PAUSE, hops = Math.max(1, Math.round(slot.time / each));
  const k = Math.min(hops - 1, Math.floor(tau / each)), f = Math.min(1, (tau - k * each) / HOP_TIME);
  const share = (k + smootherstep(0, 1, f)) / hops, a = slot.from.at, b = slot.to.at;
  const dTheta = Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta));
  const feet = toWorld(h.profile, { theta: a.theta + dTheta * share, s: a.s + (b.s - a.s) * share, h: a.h + (b.h - a.h) * share + HOP_RISE * Math.sin(Math.PI * f) });
  const up = upOf(feet), heading = slot.to.heading, frame = bodyFrame(heading, up, slot.to.tilt);
  return {
    kind: nest.kind, at: originOn(spec, nest, feet, up, heading, slot.to.tilt), fwd: frame.fwd, up: frame.up, length: spec.length * nest.size,
    fold: 1, beat: 0, amp: 0, bias: 0, spread: 0, gape: 0, yaw: 0, nod: 0, doing: 'hop', speed: f < 1 ? HOP / HOP_TIME : 0,
  };
}

// --- larks ---------------------------------------------------------------------------------------------------------

/** A lark's cycle n: where it feeds (from) and where it lands for the next (to), and its song flight if it flies one. */
interface Cycle {
  n: number;
  from: Spot;
  to: Spot;
  /** Its song flight: when it starts (s into the cycle), how long it climbs and hangs singing (s), how high (m). */
  flight: { start: number; climb: number; hang: number; high: number } | null;
}

const lastCycle = new WeakMap<Nest, Cycle>();

/** The share of a lark's way down spent spiralling, before its drop with wings closed. */
const LARK_SPIRAL = 0.8;

/** The ground a lark feeds on in cycle n: near home, out of its roost after a cycle of light and back to it at dusk. */
function larkSpot(t: Terrain, nest: Nest, n: number): Spot {
  const h = t.habitat, start = n * LARK_CYCLE - phaseOf(nest, LARK_CYCLE);
  const out = dayAt(h, 'lark', nest.s, start).awake && dayAt(h, 'lark', nest.s, start - LARK_CYCLE).awake;
  let place: Place = { at: nest.roost, doing: 'roost' };
  if (out) {
    const r = Math.max(1, h.profile.at(nest.s).r), d = LARK_FEEDS * Math.sqrt(unit(nest.seed, n, 31, 0)), a = TURN * unit(nest.seed, n, 32, 0);
    const theta = nest.theta + (d * Math.cos(a)) / r, s = clamp(nest.s + d * Math.sin(a), 0, h.profile.length);
    place = { at: open(t, theta, s) ? { theta, s, h: t.standAt(theta, s), ground: true } : nest.roost, doing: 'feed' };
  }
  return placed(h, nest, place, undefined, n);
}

function cycleOf(t: Terrain, nest: Nest, n: number): Cycle {
  const was = lastCycle.get(nest);
  if (was && was.n === n) return was;
  const { awake, busy } = dayAt(t.habitat, 'lark', nest.s, n * LARK_CYCLE - phaseOf(nest, LARK_CYCLE));
  const from = was && was.n === n - 1 ? was.to : larkSpot(t, nest, n), to = larkSpot(t, nest, n + 1);
  const u = (k: number): number => unit(nest.seed, n, k, 5);
  const flight = awake && from.doing === 'feed' && u(1) < 0.35 + 0.55 * busy
    ? { start: 30 + 90 * u(2), climb: LARK_CLIMB[0] + LARK_CLIMB[1] * u(3), hang: LARK_HANG[0] + LARK_HANG[1] * u(4), high: LARK_HIGH[0] + LARK_HIGH[1] * u(5) }
    : null;
  const cycle = { n, from, to, flight };
  lastCycle.set(nest, cycle);
  return cycle;
}

/** A lark: feeding, rising singing, hanging singing, coming down; without a song flight, a short low flight to its next patch. */
function larkAt(t: Terrain, nest: Nest, time: number): BirdNow {
  const h = t.habitat, shifted = time + phaseOf(nest, LARK_CYCLE), n = Math.floor(shifted / LARK_CYCLE), tau = shifted - n * LARK_CYCLE;
  const c = cycleOf(t, nest, n), f = c.flight, still = (spot: Spot): BirdNow => sitting(nest, spot, spot.origin, spot.heading, time, null);
  if (!f) {
    const gap = Math.hypot(...v3sub(c.to.origin, c.from.origin)), flight = gap / (6 * (1 - RAMP)) + 0.4, go = LARK_CYCLE - flight - 2;
    if (gap < 0.02 || tau < go) return still(c.from);
    if (tau >= go + flight) return still(c.to);
    return flying(h, nest, (q) => arcPoint(h, c.from.on, c.to.on, q, clamp(0.15 * gap, 0.3, 4), 0), flight, tau - go, c.from, c.to);
  }
  const hang = f.climb + f.hang, end = hang + LARK_DOWN, x = tau - f.start;
  if (x < 0) return still(c.from);
  if (x >= end) return still(c.to);
  const doing: BirdDoing = x < f.climb ? 'climb' : x < hang ? 'hover' : x < hang + LARK_DOWN * LARK_SPIRAL ? 'fly' : 'drop';
  return flying(h, nest, (q) => larkFlight(h, nest, c, q * end), end, x, c.from, c.to, doing);
}

/**
 * Where a lark is x s into its song flight: rising in a widening spiral over where it fed, hanging high and drifting
 * toward where it will land, coming down in a closing spiral, the last `LARK_DROP` m dropped with wings closed.
 */
function larkFlight(h: Habitat, nest: Nest, c: Cycle, x: number): Vec3 {
  const f = c.flight!, a = c.from.on, b = c.to.on;
  const hang = f.climb + f.hang, spiral = hang + LARK_DOWN * LARK_SPIRAL, end = hang + LARK_DOWN, top = f.high + 1.2 * Math.sin(f.hang / 7);
  // Round the spiral a turn each `LARK_TURN` s climbing, half as fast after.
  const angle = TURN * unit(nest.seed, c.n, 33, 0) + (TURN * (Math.min(x, f.climb) + 0.5 * Math.max(0, x - f.climb))) / LARK_TURN;
  let share: number, radius: number, lift: number;
  if (x < f.climb) { const k = x / f.climb; share = 0; radius = LARK_RADIUS * smoothstep(0, 0.1, k); lift = f.high * smoothstep(0, 1, k); }
  else if (x < hang) { share = 0.8 * smoothstep(f.climb, hang, x); radius = LARK_RADIUS; lift = f.high + 1.2 * Math.sin((x - f.climb) / 7); }
  else if (x < spiral) { const k = smoothstep(hang, spiral, x); share = 0.8 + 0.2 * k; radius = LARK_RADIUS * (1 - k); lift = LARK_DROP + (top - LARK_DROP) * (1 - k); }
  else { share = 1; radius = 0; lift = LARK_DROP * (1 - smootherstep(spiral, end, x)); }
  const r = Math.max(1, h.profile.at(a.s).r), dTheta = Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta));
  return toWorld(h.profile, {
    theta: a.theta + dTheta * share + (radius * Math.cos(angle)) / r,
    s: a.s + (b.s - a.s) * share + radius * Math.sin(angle),
    h: a.h + (b.h - a.h) * share + lift,
  });
}

// --- the physics of flight -----------------------------------------------------------------------------------------

/** What a bird's wings do flying through a point: its frame, how hard it works, its wingbeats. */
export interface Wings {
  /** What the wings must give (m/s²): the path's acceleration less the apparent one (centrifugal and Coriolis). */
  need: Vec3;
  /** Its forward and up: up along the lift (across its way), forward along its way (its heading where it hangs still). */
  fwd: Vec3;
  up: Vec3;
  /** Its speed (m/s), the load it carries in g, how hard it works (1 level cruising under a full g in the floor's air), its beats a second, their reach (rad). */
  speed: number;
  load: number;
  effort: number;
  beat: number;
  amp: number;
  /** How far its body is pitched up to brake (rad, landing). */
  flare: number;
}

/**
 * The wings of a bird of `spec` at p (world) moving at v with acceleration a along its path (`heading`: its way along
 * the floor when it hangs still). Its lift must turn its path: lift = (a − apparent acceleration) across its way. It
 * banks and pitches into that; its wingbeats go with √load / (air density)^(3/8) (Pennycuick 1996); its effort is the
 * load over what its speed gives in this air, plus what climbing costs.
 */
export function wingsFor(h: Habitat, spec: BirdSpec, p: Vec3, v: Vec3, a: Vec3, heading: Vec3): Wings {
  const need = v3sub(a, apparentAcceleration(h, p, v)), speed = Math.hypot(...v), up0 = upOf(p);
  const along = speed > 0.3 ? v3scale(v, 1 / speed) : heading;
  const across = v3madd(need, along, -v3dot(need, along)), size = Math.hypot(...across);
  let up = size > 1e-4 ? v3scale(across, 1 / size) : up0;
  // Never on its back: past 80° of bank it is the turn's limit.
  if (v3dot(up, up0) < Math.cos(1.4)) up = v3norm(v3madd(up, up0, Math.cos(1.4) - v3dot(up, up0) + 0.01));
  const r = Math.hypot(p[0], p[1]), air = h.airDensityAt(r) / h.airDensityAt(h.radius);
  const load = Math.hypot(...need) / G0;
  const lift = Math.max(0.15, air * (speed / spec.cruise) ** 2), climb = Math.max(0, v3dot(v, up0));
  const effort = Math.min(3, load / lift + climb / (0.4 * spec.cruise));
  const beat = spec.beat * Math.sqrt(clamp(load, 0.04, 4)) * Math.pow(air, -3 / 8);
  // Braking to land: the body pitched up against the way, wings forward.
  const brake = Math.max(0, -v3dot(a, along)), flare = clamp(brake / G0, 0, 0.9);
  const c = Math.cos(flare), s = Math.sin(flare);
  const fwd = v3norm(v3madd(v3scale(along, c), up, s));
  return { need, fwd, up: v3norm(v3madd(v3scale(up, c), along, -s)), speed, load, effort, beat, amp: clamp(0.3 + 0.55 * effort, 0.25, 1.2), flare };
}

// --- songs ---------------------------------------------------------------------------------------------------------

/**
 * The songs a bird starts between clock times t0 and t1 (sorted): a songbird's on its song post in the slots it sings,
 * an owl's hoots, a lark's song all through its song flight; each from its head as it is then.
 */
export function songsIn(t: Terrain, nest: Nest, t0: number, t1: number): Song[] {
  const out: Song[] = [];
  if (t1 <= t0) return out;
  const spec = BIRDS[nest.kind];
  const sing = (at: number): void => {
    if (at < t0 || at >= t1) return;
    const b = birdAt(t, nest, at);
    out.push({ kind: nest.kind, at: v3madd(v3madd(b.at, b.fwd, 0.35 * b.length), b.up, 0.12 * b.length), t: at });
  };
  if (nest.kind === 'lark') {
    const phase = phaseOf(nest, LARK_CYCLE);
    for (let n = Math.floor((t0 + phase) / LARK_CYCLE); n * LARK_CYCLE - phase < t1; n++) {
      const f = cycleOf(t, nest, n).flight;
      if (!f) continue;
      const begin = n * LARK_CYCLE - phase + f.start + 2, until = begin - 2 + f.climb + f.hang;
      for (let at = begin + Math.max(0, Math.ceil((t0 - begin) / spec.song[1])) * spec.song[1]; at < Math.min(t1, until); at += spec.song[1]) sing(at);
    }
    return out;
  }
  const L = slotLength(nest.kind), phase = phaseOf(nest, L);
  for (let n = Math.floor((t0 + phase) / L); n * L - phase < t1; n++) {
    const slot = slotOf(t, nest, n);
    if (slot.to.doing !== 'sing') continue;
    const start = n * L - phase, every = songEvery(nest, n);
    for (let tau = slot.time + 0.6; tau + spec.song[0] < L; tau += every) sing(start + tau);
  }
  return out;
}

/** Bytes a list of nests holds (memory watchdog): about 60 each and 40 a perch. */
export const nestsBytes = (nests: readonly Nest[]): number => nests.reduce((n, x) => n + 60 + 40 * (x.perches.length + 1), 0);
