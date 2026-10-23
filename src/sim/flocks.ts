/**
 * The birds that live in flocks (thread "Birds in the interior", part 2; how many: `HabitatParams.life.birds`; their
 * bodies: gen/birds.ts), and where each is at any moment: like every other bird a pure function of the habitat's seed,
 * its land and the clock (sim/birds.ts), so a flock seen from a hill is the same flock a minute later and the next day.
 *
 *   swallows   a colony at every bridge (an arch or a timber crossing, gen/crossings.ts), `birds.swallows` birds, a
 *              pair to a nest on the deck's side faces. From first light to dusk they hawk low over the water and the
 *              meadows round the bridge, fast and jinking, skimming the river and lifting over the trees and the deck;
 *              every few minutes one flies back to its nest for a while. At night they sit in their nests.
 *   swifts     one colony at the Lift Stair (gen/liftStair.ts), `birds.swifts` birds, which never land: by day they
 *              feed high over the floor, at dusk they race round the Stair's foot in screaming parties, then they climb
 *              (as real swifts do on their evening ascent) toward the axis, where the air is thin and gravity weak, and
 *              spend the night circling there; with the light they come down to feed again.
 *   starlings  a roost by every lake (the great lake and the meres, gen/plan.ts), `birds.starlings` birds in the
 *              crowns of the nearest wood. At first light they leave in parties for the open grassland round about,
 *              where they walk and feed all day; toward dusk the parties come in and join the murmuration over the
 *              water (Scale's flock: offsets in a slowly deforming, rippling ellipsoid that follows a wandering centre),
 *              which drifts over the roost and pours down into the trees as the light goes.
 *
 * A path through the air is a closed form of the clock (smooth wanders drawn from the seed, blended across the day's
 * changes by the light where the flock lives, `lightAt`), and how the bird flies it follows the spin's physics
 * (sim/birds.ts `onPath`, `wingsFor`): what its wings must give is the path's acceleration less the apparent gravity
 * and Coriolis there, so the swifts beat slowly and glide near the axis. The flocks' places are found in the worker
 * (`flocksNear`: it needs the ecology); where a bird is, on the main thread from the land alone (`memberAt`,
 * `memberWhere`). Pure: caches only save work.
 */
import { clamp, hash3i, smootherstep, v3add, v3cross, v3madd, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat } from '../blueprint';
import { BIRDS, lookFor, type BirdKind } from '../gen/birds';
import type { Ecology } from '../gen/ecology';
import { crossingsOf, deckTop, type Crossing } from '../gen/crossings';
import { kept } from '../gen/kept';
import { liftStairOf, rampOf } from '../gen/liftStair';
import { inFloorFrame, floorAt } from '../gen/shapes';
import { LEVELS, poseOf, standsIn, type Species } from '../gen/scatter';
import type { Terrain } from '../gen/terrain';
import { canopyAtOf, open } from './fauna';
import { lightAt, onPath, originOn, settled, spinward, upOf, type BirdNow, type Perch } from './birds';
import { localNoon, unit } from './population';
import { floorGap } from './walks';

const TURN = 2 * Math.PI;

export type FlockKind = 'swallow' | 'swift' | 'starling';
export const FLOCK_KINDS: readonly FlockKind[] = ['swallow', 'swift', 'starling'];

/** A swallows' nest: where it is on the deck's face, and the way out from that face (unit, world). */
export interface FlockNest extends Perch {
  out: Vec3;
}

/** A starlings' roost tree: its foot, the ground there and its height (m). */
export interface Roost {
  theta: number;
  s: number;
  ground: number;
  height: number;
}

/** Open grassland a party of starlings feeds on: its middle, the ground's height there and its rise (m/m) along s and around. */
export interface Feed {
  theta: number;
  s: number;
  h: number;
  rise: [number, number];
}

/** A flock: where it lives and who is in it. The same every time it is asked for. */
export interface Flock {
  /** Its own number: the same flock every time. */
  id: number;
  kind: FlockKind;
  /** Its home: the bridge's middle, the Stair's foot, the roost wood's middle. */
  theta: number;
  s: number;
  seed: number;
  /** How many birds are in it. */
  count: number;
  /** How far from home its birds go (m): for the views, to ask for the flocks that may be in sight. */
  reach: number;
  /** Swallows: the bridge (its index in `crossingsOf`), their nests (a pair to each) and the ground under their range. */
  bridge: number;
  nests: FlockNest[];
  floor: Float32Array | null;
  /** Starlings: their roost trees, the grassland their parties feed on, the lake they gather over. */
  roosts: Roost[];
  feeds: Feed[];
  /** Where it gathers or feeds over: starlings the lake's middle, swifts the middle of the floor near the Stair; how far it wanders (m). */
  over: { theta: number; s: number; reach: number } | null;
  /** The highest ground under where it wanders (m over the profile). */
  top: number;
  /** Swifts: where on the Stair's face their parties race (in the ramp's plan, gen/liftStair.ts): the middle z, how far along and across. */
  party: { z: number; along: number; across: number } | null;
}

/** Swallows: their range round the bridge (m), the step of the ground under it (m), how high over it they go (m). */
const SWALLOW_RANGE = 200;
const GRID = 12.5;
const SKIM = 0.8;
const SWALLOW_HIGH = 9;
/** Swallows: their wander (m, s), a quick jink on it (m, s); how often one may go home (s) and how long it takes to get there or away (s). */
const HAWK: [number, number] = [120, 9];
const JINK: [number, number] = [8, 1.5];
const VISIT_SLOT = 200;
const VISIT_RAMP = 25;
/** Swallows clear the bridge's deck by this many handrails, and start lifting over it this far out (m). */
const DECK_CLEAR = 1.6;
const DECK_REACH = 8;

/** Swifts: how far they feed from the middle (m at most), how high over the highest ground (m), the wander's step (s). */
const SWIFT_REACH = 2500;
const SWIFT_HIGH: [number, number] = [60, 300];
const SWIFT_STEP = 220;
/** How far from the endcap's foot their feeding keeps (m): the Gate's slopes rise there. */
const GATE_FOOT = 500;
/** A quick turn on their wander (m, s). */
const SWOOP: [number, number] = [30, 3.5];
/** Swifts' parties: how many, the step of their race (s), the gap between birds in one (s), how high over the face (m). */
const PARTIES = 5;
const RACE = 3.2;
/**
 * When they race: from the evening light falling through 60 %, or the last hour before dark where the evening is long
 * (the floor far from the port end), so the parties scream round the Stair in the sunset's light, not in the dark; and
 * how long they take to gather there from where they feed (s).
 */
const RACE_BEFORE = 3600;
const GATHER = 900;
const TRAIL = 0.35;
const PARTY_HIGH: [number, number] = [8, 22];
/** Swifts at night: how far from the axis at least (m, and as a share of the radius); how fast they climb (m/s); their circles (m, m/s). */
const AXIS_LEAST = 150;
const AXIS_SHARE = 0.06;
const CLIMB = 1.5;
const NIGHT_CIRCLE = 400;
const NIGHT_SPEED = 7;

/** Starlings: a party's size; how many roost trees; how far the roost may be from the lake (m); how far they feed (m). */
const PARTY = 40;
const ROOST_TREES = 10;
const ROOST_REACH = 1500;
const STARLING_REACH = 2500;
/** Feeding grounds tried and kept per roost. */
const FEED_TRIES = 160;
const FEEDS = 24;
/** A party spreads this far over its ground (m) and walks this far about (m) every so often (s). */
const SPREAD = 12;
const SHUFFLE: [number, number] = [1.5, 20];
/**
 * The murmuration: its shape (Scale's ball, m across, up, along: only the proportions are kept), the air each bird
 * has in it (m³: about a metre between neighbours, as measured in the starling flocks over Rome), and how high over
 * the ground (m). Packed that close, a flock of thousands is a dark cloud from a few hundred metres off.
 */
const BALL: Vec3 = [19, 6, 12];
const SPACE = 2;
const MURMUR_HIGH: [number, number] = [50, 60];
/** Its wander (s a step), and how long before the drop it drifts over the roost (s). */
const MURMUR_STEP = 25;
const OVER_ROOST: [number, number] = [900, 120];
/** When parties join it (s before the drop, earliest and latest), how long the drop takes (s), how far apart the birds drop (s). */
const JOIN: [number, number] = [2700, 600];
const DROP = 35;
const DROP_SPREAD = 240;

/** How the sizes of birds of a species differ (± share), as in sim/birds.ts. */
const SIZES = 0.06;

/** The habitat's seed for its flocks. */
const seedOf = kept((h: Habitat): number => hash3i(h.seed, 0xf10c, 5, 0));

// --- where the flocks live -----------------------------------------------------------------------------------------

/** Each ecology's flocks as worked out, by id. */
const madeOf = kept((_: Ecology) => new Map<number, Flock | null>());

/**
 * The flocks whose birds may come within `radius` m of (θ, s): swallows at the bridges, swifts at the Lift Stair,
 * starlings at the lakes. For the worker (it needs the ecology and the plants); `plants` is `plantsOf(ecology)`.
 * Each flock is worked out once and kept.
 */
export function flocksNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, radius: number): Flock[] {
  const t = ecology.terrain, h = t.habitat, b = h.params.life.birds, r = h.radius, out: Flock[] = [], made = madeOf(ecology);
  const inReach = (home: { theta: number; s: number }, reach: number): boolean => floorGap(r, theta, s, home.theta, home.s) <= radius + reach;
  const get = (id: number, make: () => Flock | null): void => {
    if (!made.has(id)) made.set(id, make());
    const f = made.get(id);
    if (f && f.count > 0) out.push(f);
  };
  if (b.swallows > 0) crossingsOf(t).forEach((c, i) => {
    if ((c.kind === 'arch' || c.kind === 'timber') && inReach(c.frame, SWALLOW_RANGE)) get(i * 4, () => swallowsAt(ecology, c, i));
  });
  if (b.swifts > 0 && liftStairOf(h)) get(1, () => swiftsAt(ecology));
  if (b.starlings > 0) t.meres.forEach((m, i) => {
    if (inReach(m, ROOST_REACH + STARLING_REACH)) get(i * 4 + 2, () => starlingsAt(ecology, plants, i));
  });
  return out.filter((f, k) => out.indexOf(f) === k && inReach(f, f.reach));
}

/** A flock with nothing yet, for the makers to fill in. */
function flockOf(kind: FlockKind, id: number, theta: number, s: number, seed: number, count: number, reach: number): Flock {
  return { id, kind, theta, s, seed, count, reach, bridge: -1, nests: [], floor: null, roosts: [], feeds: [], over: null, top: 0, party: null };
}

/**
 * The swallows of a bridge: a pair to a nest, the nests spread along the deck's faces over the water, under the deck
 * (an arch's spandrel, a timber deck's stringers), facing out; and the ground they hawk over, with the crowns on it.
 */
function swallowsAt(ecology: Ecology, c: Crossing, index: number): Flock {
  const t = ecology.terrain, h = t.habitat, seed = hash3i(seedOf(h), index, 1, 0), f = c.frame;
  const flock = flockOf('swallow', index * 4, f.theta, f.s, seed, h.params.life.birds.swallows, SWALLOW_RANGE + HAWK[0] * 0.2);
  flock.bridge = index;
  const below = (c.kind === 'arch' ? 0.6 : 0.35) * c.handrail;
  for (let k = 0; k < Math.ceil(flock.count / 2); k++) {
    const x = c.wet[0] + (c.wet[1] - c.wet[0]) * (0.1 + 0.8 * unit(seed, k, 1, 0)), side = unit(seed, k, 2, 0) < 0.5 ? -1 : 1;
    // Under the deck's edge, never down at the water.
    const deck = deckTop(c, x), up = f.height + Math.max(Math.min(0.4, deck / 2), deck - below);
    const y = side * (c.width / 2 + 0.05), at = floorAt(h, f, x, y), feet = toWorld(h.profile, { ...at, h: up });
    const outer = toWorld(h.profile, { ...floorAt(h, f, x, y + side), h: up });
    flock.nests.push({ ...at, h: up, out: v3norm(v3sub(outer, feet)) });
  }
  // The ground under their range, the crowns over it, each node the highest of five points round it.
  const n = Math.round((2 * SWALLOW_RANGE) / GRID) + 1, floor = new Float32Array(n * n), canopy = canopyAtOf(ecology), R = Math.max(1, h.profile.at(f.s).r);
  let top = -Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let most = -Infinity;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = -SWALLOW_RANGE + i * GRID + (dx * GRID) / 2, y = -SWALLOW_RANGE + j * GRID + (dy * GRID) / 2;
      const th = f.theta + x / R, s = clamp(f.s + y, 0, h.profile.length), ground = t.standAt(th, s), crowns = canopy(th, s, ground);
      most = Math.max(most, ground + 1.25 * crowns.height * clamp((crowns.cover - 0.02) / 0.15, 0, 1));
    }
    floor[j * n + i] = most;
    top = Math.max(top, most);
  }
  // Rising and falling over a wood's edge or a bank over a few nodes: the highest within two nodes, smoothed twice over
  // the nodes round (never below where it was, as every node it is smoothed from was at least that high).
  flock.floor = smoothed(smoothed(highestNear(floor, n, 2), n), n);
  flock.top = top;
  return flock;
}

/** A square grid of n a side, each node the highest within `k` nodes of it. */
function highestNear(g: Float32Array, n: number, k: number): Float32Array {
  const out = new Float32Array(g.length);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let most = -Infinity;
    for (let b = Math.max(0, j - k); b <= Math.min(n - 1, j + k); b++) for (let a = Math.max(0, i - k); a <= Math.min(n - 1, i + k); a++) most = Math.max(most, g[b * n + a]);
    out[j * n + i] = most;
  }
  return out;
}

/** A square grid of n a side, each node the mean of the nodes round it (3 × 3, those inside). */
function smoothed(g: Float32Array, n: number): Float32Array {
  const out = new Float32Array(g.length);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let b = Math.max(0, j - 1); b <= Math.min(n - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(n - 1, i + 1); a++) { sum += g[b * n + a]; count++; }
    out[j * n + i] = sum / count;
  }
  return out;
}

/**
 * The swifts of the Lift Stair: their parties race over its lower face; they feed over the floor nearest it (as far as
 * the floor reaches), high over its highest ground.
 */
function swiftsAt(ecology: Ecology): Flock | null {
  const t = ecology.terrain, h = t.habitat, stair = liftStairOf(h), ramp = rampOf(h);
  if (!stair || !stair.platforms.length) return null;
  const foot = stair.platforms[0], z = (foot.z1 + ramp.zAt(ramp.groundAt(foot.z1) + 60)) / 2, along = Math.max(20, Math.min(70, ramp.zAt(ramp.groundAt(foot.z1) + 120) - z));
  const at = fromWorld(h.profile, ...ramp.world(foot.z0, (foot.w0 + foot.w1) / 2, foot.e));
  // Over the floor, clear of the Gate's foot.
  const p = h.profile, room = (p.floorEnd - p.floorStart - GATE_FOOT) / 2, reach = Math.max(50, Math.min(SWIFT_REACH, room * 0.9));
  const s = clamp(at.s - reach - GATE_FOOT, p.floorStart + reach, p.floorEnd - reach - GATE_FOOT);
  const flock = flockOf('swift', 1, at.theta, at.s, hash3i(seedOf(h), 0, 2, 0), h.params.life.birds.swifts, floorGap(h.radius, at.theta, at.s, at.theta, s) + reach);
  flock.over = { theta: at.theta, s, reach };
  flock.party = { z, along, across: Math.max(10, Math.min(50, ramp.halfWidth * 0.8)) };
  flock.top = highestUnder(t, at.theta, s, reach);
  return flock;
}

/** The highest ground in a square of half side `reach` round (θ, s), from a grid of 24 a side (m over the profile). */
function highestUnder(t: Terrain, theta: number, s: number, reach: number): number {
  const p = t.habitat.profile, R = Math.max(1, p.at(s).r);
  let top = -Infinity;
  for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) {
    const x = -reach + (2 * reach * i) / 24, y = -reach + (2 * reach * j) / 24;
    top = Math.max(top, t.standAt(theta + x / R, clamp(s + y, 0, p.length)));
  }
  return top;
}

/**
 * The starlings of a lake: their roost in the nearest closed wood (its tallest trees near where the search found it),
 * the open, dry grassland within their reach that their parties feed on, and the lake they gather over at dusk.
 */
function starlingsAt(ecology: Ecology, plants: readonly Species[], mereIndex: number): Flock | null {
  const t = ecology.terrain, h = t.habitat, mere = t.meres[mereIndex], seed = hash3i(seedOf(h), mereIndex, 3, 0), p = h.profile;
  const canopy = canopyAtOf(ecology), R = Math.max(1, p.at(mere.s).r);
  // The wood: the closed crowns nearest the lake's middle, searched out round it.
  let wood: { theta: number; s: number } | null = null;
  for (let d = 0; d <= ROOST_REACH && !wood; d += 50) {
    for (let k = 0; k < 24 && !wood; k++) {
      const a = (TURN * (k + unit(seed, d, 1, 0))) / 24, th = mere.theta + (d * Math.cos(a)) / R, s = mere.s + d * Math.sin(a);
      if (s < 0 || s > p.length || t.form.inWater(th, s)) continue;
      const ground = t.heightAt(th, s);
      if (t.standAt(th, s) <= ground + 0.05 && canopy(th, s, ground).cover >= 0.5) wood = { theta: th, s };
    }
  }
  if (!wood) return null;
  const trees = plants.filter((sp) => (sp.what === 'plant' || sp.what === 'planted') && sp.spec.height[1] >= 6), shapes = LEVELS[0].variants;
  const found: Roost[] = [], search = 30, Rw = Math.max(1, p.at(wood.s).r);
  for (const sp of trees) standsIn(ecology, sp, { theta0: wood.theta - search / Rw, theta1: wood.theta + search / Rw, s0: wood.s - search, s1: wood.s + search }, 0, (pt, ps, ground, f, along) => {
    found.push({ theta: pt, s: ps, ground, height: poseOf(ecology, sp, pt, ps, toWorld(p, { theta: pt, s: ps, h: ground }), f, along, shapes).height });
  });
  if (!found.length) return null;
  const roosts = found.sort((a, b) => b.height - a.height).slice(0, ROOST_TREES);
  const mid = { theta: roosts.reduce((x, r) => x + r.theta, 0) / roosts.length, s: roosts.reduce((x, r) => x + r.s, 0) / roosts.length };
  const reach = Math.max(80, Math.min(300, mere.across));
  const flock = flockOf('starling', mereIndex * 4 + 2, mid.theta, mid.s, seed, h.params.life.birds.starlings, STARLING_REACH);
  flock.roosts = roosts;
  flock.over = { theta: mere.theta, s: mere.s, reach };
  // Grassland round the roost: open, dry, its crowns thin.
  for (let k = 0; k < FEED_TRIES && flock.feeds.length < FEEDS; k++) {
    const d = STARLING_REACH * Math.sqrt(0.02 + 0.98 * unit(seed, k, 2, 0)), a = TURN * unit(seed, k, 3, 0);
    const th = mid.theta + (d * Math.cos(a)) / Rw, s = mid.s + d * Math.sin(a);
    if (s < p.floorStart || s > p.floorEnd || t.form.inWater(th, s, 5) || !open(t, th, s)) continue;
    const ground = t.heightAt(th, s);
    if (canopy(th, s, ground).cover > 0.1) continue;
    const e = 2, rs = (t.heightAt(th, s + e) - t.heightAt(th, s - e)) / (2 * e), rt = (t.heightAt(th + e / Rw, s) - t.heightAt(th - e / Rw, s)) / (2 * e);
    flock.feeds.push({ theta: th, s, h: ground, rise: [rs, rt] });
  }
  // Over the lake and the roost they go no lower than the highest ground there and the wood's tallest tree.
  flock.top = Math.max(highestUnder(t, mere.theta, mere.s, reach), highestUnder(t, mid.theta, mid.s, 60), ...roosts.map((r) => r.ground + r.height));
  return flock;
}

// --- the day's light where a flock lives ----------------------------------------------------------------------------

/** When the light where a flock lives passes a share of the day's (`lightAt`) rising and falling, per day; kept per place and day. */
const daysOf = kept((_: Habitat) => new Map<string, Map<number, number>>());
const LIGHT_PLACE = 200;
const scratch = new Float32Array(256);

/**
 * The clock time on day `day` (s) at which the light over s first rises through `x` (`rising`), or last falls through
 * it: found by halving between the day's start, the bright stretch's passing (local noon) and its end. A light that
 * never gets so bright is reached at noon.
 */
function lightTime(h: Habitat, s: number, day: number, x: number, rising: boolean): number {
  const sb = Math.round(s / LIGHT_PLACE) * LIGHT_PLACE, key = `${sb}:${day}`, cache = daysOf(h);
  let memo = cache.get(key);
  if (!memo) {
    if (cache.size >= 256) cache.clear();
    cache.set(key, (memo = new Map()));
  }
  const k = rising ? x : -x - 1;
  const known = memo.get(k);
  if (known !== undefined) return known;
  const { length, daylight } = h.params.day, noon = localNoon(h, clamp(sb, 0, h.profile.length)), start = day * length;
  const light = (phase: number): number => lightAt(h, clamp(sb, 0, h.profile.length), start + phase * length, scratch);
  let lo = rising ? 0 : noon, hi = rising ? noon : daylight;
  if (light(noon) < x) { memo.set(k, start + noon * length); return start + noon * length; }
  for (let n = 0; n < 30; n++) {
    const mid = (lo + hi) / 2;
    if ((light(mid) >= x) === rising) hi = mid; else lo = mid;
  }
  const at = start + ((lo + hi) / 2) * length;
  memo.set(k, at);
  return at;
}

/** The day's moments a flock lives by (clock s): its light rising through 10 % and 12 %, falling through 60 %, 10 %, 6 % and 4 %. */
interface Moments {
  day: number;
  rise10: number;
  rise12: number;
  fall60: number;
  fall10: number;
  fall06: number;
  fall04: number;
}

/** Each flock's moments, for the last day asked for. */
const moments = new WeakMap<Flock, Moments>();

function momentsOf(h: Habitat, flock: Flock, day: number): Moments {
  const known = moments.get(flock);
  if (known && known.day === day) return known;
  const when = (x: number, rising: boolean): number => lightTime(h, flock.s, day, x, rising);
  const m = { day, rise10: when(0.1, true), rise12: when(0.12, true), fall60: when(0.6, false), fall10: when(0.1, false), fall06: when(0.06, false), fall04: when(0.04, false) };
  moments.set(flock, m);
  return m;
}

// --- smooth wanders -------------------------------------------------------------------------------------------------

/**
 * A smooth wander (−1 … 1) through numbers drawn from `seed` and channel `ch`, one a unit of x: a uniform cubic
 * B-spline, so its speed and acceleration are smooth too.
 */
function wave(seed: number, ch: number, x: number): number {
  const i = Math.floor(x), f = x - i, f2 = f * f, f3 = f2 * f;
  const knot = (j: number): number => 2 * unit(seed, ch, i + j, 0x5a) - 1;
  return ((1 - f) ** 3 * knot(-1) + (3 * f3 - 6 * f2 + 4) * knot(0) + (-3 * f3 + 3 * f2 + 3 * f + 1) * knot(1) + f3 * knot(2)) / 6;
}

/** A point in the air x m round the axis (at its own height) and y m along it from (θ, s), `up` m over the profile. */
function airPoint(h: Habitat, theta: number, s: number, x: number, y: number, up: number): Vec3 {
  const at = clamp(s + y, 0, h.profile.length), r = Math.max(1, h.profile.at(at).r - up);
  return toWorld(h.profile, { theta: theta + x / r, s: at, h: up });
}

/** A share q of the way from a to b, eased from rest to rest (or from a moving point to one), lifted `arc` m in the middle. */
function between(a: Vec3, b: Vec3, q: number, arc: number): Vec3 {
  const e = smootherstep(0, 1, q), p = v3add(a, v3scale(v3sub(b, a), e));
  return arc ? v3madd(p, upOf(p), arc * Math.sin(Math.PI * e)) : p;
}

/** How long a flight of `d` m takes eased from rest to rest, its fastest at `speed` (m/s). */
const flightTime = (d: number, speed: number): number => Math.max(4, (1.875 * d) / speed);

/** A way along the floor where up is `up`, turned `a` from along the axis toward spinward. */
function headingAt(up: Vec3, a: number): Vec3 {
  const round = spinward(up), along = v3cross(round, up);
  return v3norm(v3madd(v3scale(along, Math.cos(a)), round, Math.sin(a)));
}

/** Smooth maximum of a and b (rounded over `w`). */
const smax = (a: number, b: number, w: number): number => (a + b + Math.sqrt((a - b) * (a - b) + w * w)) / 2;

// --- where a flock's bird is ----------------------------------------------------------------------------------------

/** Where a bird is: in the air on a path (`at` now), or settled with its feet at `feet` doing something. */
type Where =
  | { air: true; at: Vec3; open: number; doing: 'fly' }
  | { air: false; feet: Vec3; heading: Vec3; tilt: number; doing: 'roost' | 'perch' | 'feed'; ground: boolean };

/** A flock's bird m: its size and look. */
export function memberOf(flock: Flock, m: number): { kind: BirdKind; size: number; look: number; seed: number } {
  const own = hash3i(flock.seed, m, 7, 0);
  return { kind: flock.kind, size: 1 + SIZES * (2 * unit(own, 1, 2, 3) - 1), look: lookFor(flock.kind, unit(own, 4, 5, 6)), seed: own };
}

/** Bird m of a flock at clock time t, posed: in flight by its path (sim/birds.ts `onPath`), or settled. */
export function memberAt(t: Terrain, flock: Flock, m: number, time: number): BirdNow {
  const h = t.habitat, who = memberOf(flock, m), w = whereOf(t, flock, m, time);
  if (w.air) {
    const path = (x: number): Vec3 => { const q = whereOf(t, flock, m, x); return q.air ? q.at : originOn(who.kind, who.size, q.feet, upOf(q.feet), q.heading, q.tilt); };
    return onPath(h, who.kind, who.size, who.seed, path, time, spinward(upOf(w.at)), 'fly', w.open);
  }
  const up = upOf(w.feet);
  return settled(who.kind, who.size, who.seed, originOn(who.kind, who.size, w.feet, up, w.heading, w.tilt), w.heading, w.tilt, w.doing, w.ground, time, null);
}

/** Where bird m of a flock is at clock time t (world; its feet when it is settled) and whether it is in the air, without posing it (far birds). */
export function memberWhere(t: Terrain, flock: Flock, m: number, time: number): { at: Vec3; air: boolean; doing: 'fly' | 'roost' | 'perch' | 'feed' } {
  const w = whereOf(t, flock, m, time);
  return w.air ? { at: w.at, air: true, doing: 'fly' } : { at: w.feet, air: false, doing: w.doing };
}

function whereOf(t: Terrain, flock: Flock, m: number, time: number): Where {
  switch (flock.kind) {
    case 'swallow': return swallowAt(t, flock, m, time);
    case 'swift': return swiftAt(t.habitat, flock, m, time);
    case 'starling': return starlingAt(t.habitat, flock, m, time);
  }
}

// --- swallows -------------------------------------------------------------------------------------------------------

/** The lowest a swallow goes over the ground at x m round the axis and y m along it from its bridge (between the grid's nodes). */
function floorUnder(flock: Flock, x: number, y: number): number {
  const g = flock.floor!, n = Math.round(Math.sqrt(g.length)), fx = clamp((x + SWALLOW_RANGE) / GRID, 0, n - 1.001), fy = clamp((y + SWALLOW_RANGE) / GRID, 0, n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, node = (a: number, b: number): number => g[b * n + a];
  return (node(i, j) * (1 - u) + node(i + 1, j) * u) * (1 - v) + (node(i, j + 1) * (1 - u) + node(i + 1, j + 1) * u) * v;
}

/** A swallow hawking: low over its range round the bridge, jinking, lifting over the crowns and over the deck. */
function hawking(t: Terrain, flock: Flock, own: number, time: number): Vec3 {
  const h = t.habitat, c = crossingsOf(t)[flock.bridge], side = unit(own, 9, 0, 0) < 0.5 ? -1 : 1;
  const x = HAWK[0] * wave(own, 1, time / HAWK[1]) + JINK[0] * wave(own, 2, time / JINK[1]);
  const y = HAWK[0] * wave(own, 3, time / HAWK[1]) + JINK[0] * wave(own, 4, time / JINK[1]) + side * 30;
  const R = Math.max(1, h.profile.at(flock.s).r), theta = flock.theta + x / R, s = flock.s + y;
  const n = (wave(own, 5, time / 6) + 1) / 2;
  let up = floorUnder(flock, x, y) + SKIM + SWALLOW_HIGH * n * n;
  if (c) {
    // Over the deck, rising to it as it comes near.
    const [cx, cy] = inFloorFrame(h, c.frame, theta, s), out = Math.max(Math.abs(cx) - c.half, Math.abs(cy) - c.width / 2, 0);
    const k = 1 - smootherstep(0, DECK_REACH, out);
    if (k > 0) up = up + k * (smax(up, c.frame.height + deckTop(c, clamp(cx, -c.half, c.half)) + DECK_CLEAR * c.handrail, 0.5) - up);
  }
  return airPoint(h, flock.theta, flock.s, x, y, up);
}

/** How far a swallow is into a visit to its nest at clock time t (0 away … 1 there), slot by slot. */
function visiting(own: number, time: number): number {
  const phase = VISIT_SLOT * unit(own, 11, 0, 0), x = time + phase, n = Math.floor(x / VISIT_SLOT), tau = x - n * VISIT_SLOT;
  if (unit(own, n, 12, 0) > 0.35) return 0;
  const stay = 8 + 30 * unit(own, n, 13, 0), start = 10 + (VISIT_SLOT - 2 * VISIT_RAMP - stay - 20) * unit(own, n, 14, 0);
  return smootherstep(start, start + VISIT_RAMP, tau) * (1 - smootherstep(start + VISIT_RAMP + stay, start + 2 * VISIT_RAMP + stay, tau));
}

function swallowAt(t: Terrain, flock: Flock, m: number, time: number): Where {
  const h = t.habitat, own = hash3i(flock.seed, m, 1, 0), nest = flock.nests[(m >> 1) % flock.nests.length], day = Math.floor(time / h.params.day.length);
  const feet = v3madd(toWorld(h.profile, nest), v3cross(upOf(toWorld(h.profile, nest)), nest.out), (m & 1 ? 0.06 : -0.06));
  const mo = momentsOf(h, flock, day), out = mo.rise10 + 900 * unit(own, day, 15, 0), home = mo.fall10 - 900 * unit(own, day, 16, 0);
  const active = smootherstep(out, out + 150, time) * (1 - smootherstep(home - 150, home, time));
  const away = active * (1 - visiting(own, time));
  const still: Where = { air: false, feet, heading: nest.out, tilt: BIRDS.swallow.stance + 0.3, doing: active > 0 ? 'perch' : 'roost', ground: false };
  if (away <= 0) return still;
  // Out of the nest by a point before its face, so it comes and goes from the open side.
  const before = v3madd(v3madd(feet, nest.out, 5), upOf(feet), 0.3), sit = originOn('swallow', 1, feet, upOf(feet), nest.out, still.tilt);
  const k1 = smootherstep(0.2, 1, away), k2 = smootherstep(0, 0.2, away);
  const at = v3add(sit, v3scale(v3sub(v3add(before, v3scale(v3sub(hawking(t, flock, own, time), before), k1)), sit), k2));
  return { air: true, at, open: smootherstep(0.05, 0.4, Math.hypot(...v3sub(at, sit))), doing: 'fly' };
}

// --- swifts ---------------------------------------------------------------------------------------------------------

function swiftAt(h: Habitat, flock: Flock, m: number, time: number): Where {
  const own = hash3i(flock.seed, m, 2, 0), over = flock.over!, L = h.params.day.length, day = Math.floor(time / L);
  // High over the floor by day.
  const n = (wave(own, 5, time / 30) + 1) / 2;
  const highUp = flock.top + SWIFT_HIGH[0] + SWIFT_HIGH[1] * n;
  const high = airPoint(h, over.theta, over.s, over.reach * wave(own, 1, time / SWIFT_STEP) + SWOOP[0] * wave(own, 2, time / SWOOP[1]), over.reach * wave(own, 3, time / SWIFT_STEP) + SWOOP[0] * wave(own, 4, time / SWOOP[1]), highUp);
  // In a party racing over the Stair's face at dusk, each bird a little behind the one before.
  const party = m % PARTIES, ps = hash3i(flock.seed, party, 3, 0), lag = time - TRAIL * Math.floor(m / PARTIES), ramp = rampOf(h), pp = flock.party!;
  const z = pp.z + pp.along * wave(ps, 1, lag / RACE), w = pp.across * wave(ps, 2, lag / RACE);
  const e = ramp.groundAt(z) + PARTY_HIGH[0] + PARTY_HIGH[1] * (wave(ps, 3, lag / 5) + 1) / 2;
  const racing = v3add(ramp.world(z, w, e), [2 * wave(own, 6, time / 1.5), 2 * wave(own, 7, time / 1.5), 2 * wave(own, 8, time / 1.5)]);
  // Near the axis at night, circling slowly.
  const R = h.profile.at(over.s).r, nightUp = R - Math.max(AXIS_LEAST, AXIS_SHARE * h.radius) - 60 * unit(own, 9, 0, 0), circle = NIGHT_CIRCLE * (1 + 0.25 * wave(own, 10, time / 120));
  const a = (time * NIGHT_SPEED) / NIGHT_CIRCLE + TURN * unit(own, 10, 0, 0);
  const night = airPoint(h, over.theta, over.s, circle * Math.cos(a), circle * Math.sin(a), nightUp);
  const climb = Math.max(60, (nightUp - flock.top - SWIFT_HIGH[0]) / CLIMB);
  const { fall60, fall04: dark, rise10: dawn } = momentsOf(h, flock, day), dusk = Math.max(fall60, dark - RACE_BEFORE);
  const wParty = smootherstep(dusk, dusk + GATHER, time), wNight = Math.max(1 - smootherstep(dawn, dawn + climb, time), smootherstep(dark, dark + climb, time));
  const at = v3add(v3add(high, v3scale(v3sub(racing, high), wParty)), v3scale(v3sub(night, v3add(high, v3scale(v3sub(racing, high), wParty))), wNight));
  return { air: true, at, open: 1, doing: 'fly' };
}

// --- starlings ------------------------------------------------------------------------------------------------------

/** A starling's place in the roost: a spot in the crown of one of the roost trees. */
function roostSpot(h: Habitat, flock: Flock, own: number, m: number): Vec3 {
  let spots = roostSpots.get(flock);
  if (!spots) roostSpots.set(flock, (spots = new Float64Array(flock.count * 3).fill(NaN)));
  if (!Number.isNaN(spots[m * 3])) return [spots[m * 3], spots[m * 3 + 1], spots[m * 3 + 2]];
  const p = spotIn(h, flock, own, m);
  spots.set(p, m * 3);
  return p;
}

/** Each flock's birds' roost spots as worked out (world, x y z a bird; NaN not yet). */
const roostSpots = new WeakMap<Flock, Float64Array>();

function spotIn(h: Habitat, flock: Flock, own: number, m: number): Vec3 {
  const tree = flock.roosts[m % flock.roosts.length], r = Math.max(1, h.profile.at(tree.s).r);
  const d = 0.3 * tree.height * Math.sqrt(unit(own, 20, 0, 0)), a = TURN * unit(own, 21, 0, 0);
  return toWorld(h.profile, { theta: tree.theta + (d * Math.cos(a)) / r, s: tree.s + d * Math.sin(a), h: tree.ground + tree.height * (0.55 + 0.35 * unit(own, 22, 0, 0)) });
}

/** The murmuration's frame at a moment: its middle (world), its up, round and along, how it is turned and how it breathes. */
interface Murmur {
  centre: Vec3;
  up: Vec3;
  round: Vec3;
  along: Vec3;
  turn: number;
  size: Vec3;
  /** Its own time (s): the clock slowed as the flock is bigger, so its ripples cross it no faster than they cross Scale's. */
  clock: number;
}

/** Each flock's murmuration frames by clock time, the last few asked for (every bird of it asks for the same moments). */
const murmurs = new WeakMap<Flock, Map<number, Murmur>>();

/** The murmuration's frame at clock time t: wandering over the lake, drifting over the roost before the drop (`drop`: when it begins). */
function murmurOf(h: Habitat, flock: Flock, time: number, drop: number): Murmur {
  let kept = murmurs.get(flock);
  if (!kept) murmurs.set(flock, (kept = new Map()));
  const known = kept.get(time);
  if (known) return known;
  const over = flock.over!, fs = flock.seed, k = smootherstep(drop - OVER_ROOST[0], drop - OVER_ROOST[1], time);
  const reach = over.reach * (1 - 0.75 * k), d = Math.atan2(Math.sin(flock.theta - over.theta), Math.cos(flock.theta - over.theta));
  const theta = over.theta + d * k, s = over.s + (flock.s - over.s) * k;
  const up = flock.top + MURMUR_HIGH[0] + MURMUR_HIGH[1] * (wave(fs, 3, time / 40) + 1) / 2;
  const centre = airPoint(h, theta, s, reach * wave(fs, 1, time / MURMUR_STEP), reach * wave(fs, 2, time / MURMUR_STEP), up);
  const u = upOf(centre), round = spinward(u), along = v3cross(round, u);
  const grow = Math.cbrt((flock.count * SPACE) / ((4 / 3) * Math.PI * BALL[0] * BALL[1] * BALL[2])), clock = time / Math.max(1, grow);
  const size: Vec3 = [BALL[0] * grow * (1 + 0.35 * Math.sin(clock * 0.31)), BALL[1] * grow * (1 + 0.4 * Math.sin(clock * 0.47 + 1)), BALL[2] * grow * (1 + 0.4 * Math.sin(clock * 0.23 + 2))];
  const frame = { centre, up: u, round, along, turn: 2.5 * wave(fs, 4, time / 30) + 0.7 * Math.sin(clock * 0.13), size, clock };
  if (kept.size >= 8) kept.delete(kept.keys().next().value!);
  kept.set(time, frame);
  return frame;
}

/** Bird m's place in the murmuration at clock time t: its own spot in the ball, rippling (Scale's flock), turned with the flock. */
function inMurmur(h: Habitat, flock: Flock, own: number, time: number, drop: number): Vec3 {
  const f = murmurOf(h, flock, time, drop);
  // Its spot, even through the ball.
  const r = Math.cbrt(unit(own, 30, 0, 0)), z = 2 * unit(own, 31, 0, 0) - 1, a = TURN * unit(own, 32, 0, 0), q = Math.sqrt(1 - z * z);
  const ox = r * q * Math.cos(a), oy = r * z, oz = r * q * Math.sin(a);
  // Rippling through the flock, a wave of crowding running through it, the whole bending.
  const k = f.clock, wx = ox + 0.22 * Math.sin(k * 1.3 + oz * 3.1), wy = oy + 0.3 * Math.sin(k * 0.9 + ox * 4.2), wz = oz + 0.22 * Math.sin(k * 1.1 + ox * 2.7);
  const crowd = 1 + 0.15 * Math.sin(k * 0.8 - wz * 2.5);
  const lx = wx * f.size[0] * crowd, lz = wz * f.size[2], ly = wy * f.size[1] + 0.75 * f.size[1] * (wx * wx - 0.33) * Math.sin(k * 0.2);
  const c = Math.cos(f.turn), sn = Math.sin(f.turn);
  return v3madd(v3madd(v3madd(f.centre, f.round, lx * c + lz * sn), f.along, -lx * sn + lz * c), f.up, ly);
}

function starlingAt(h: Habitat, flock: Flock, m: number, time: number): Where {
  const own = hash3i(flock.seed, m, 3, 0), party = Math.floor(m / PARTY), ps = hash3i(flock.seed, party, 4, 0), L = h.params.day.length, day = Math.floor(time / L);
  const spec = BIRDS.starling, roost = roostSpot(h, flock, own, m), tree = flock.roosts[m % flock.roosts.length];
  const mo = momentsOf(h, flock, day), drop0 = mo.fall06, drop = drop0 - DROP_SPREAD / 2 + DROP_SPREAD * unit(own, day, 4, 0);
  const leave = mo.rise12 + 900 * unit(ps, day, 1, 0) + 25 * unit(own, day, 2, 0);
  const join = Math.max(leave + 60, drop0 - JOIN[0] + (JOIN[0] - JOIN[1]) * unit(ps, day, 5, 0) + 20 * unit(own, day, 6, 0));
  const atRoost: Where = { air: false, feet: roost, heading: headingAt(upOf(roost), TURN * unit(own, 23, 0, 0)), tilt: spec.stance * 0.7, doing: 'roost', ground: false };
  if (time < leave || time >= drop + DROP) return atRoost;
  const fly = (at: Vec3, open: number): Where => ({ air: true, at, open, doing: 'fly' });
  const there = (x: number): Vec3 => inMurmur(h, flock, own, x, drop0), sitAt = (w: Extract<Where, { air: false }>): Vec3 => originOn('starling', 1, w.feet, upOf(w.feet), w.heading, w.tilt);
  if (time >= join) {
    if (time < drop) return fly(there(time), 1);
    // Down into the roost.
    const q = (time - drop) / DROP;
    return fly(between(there(time), sitAt(atRoost), q, 0), smootherstep(1, 0.95, q));
  }
  // The party's ground for the day and the bird's place on it, walking about.
  const feed = flock.feeds.length ? flock.feeds[Math.floor(unit(ps, day, 7, 0) * flock.feeds.length) % flock.feeds.length] : { theta: tree.theta, s: tree.s, h: tree.ground, rise: [0, 0] as [number, number] };
  const R = Math.max(1, h.profile.at(feed.s).r), d = SPREAD * Math.sqrt(unit(own, day, 8, 0)), b = TURN * unit(own, day, 9, 0);
  const dx = d * Math.cos(b) + SHUFFLE[0] * wave(own, 24, time / SHUFFLE[1]), dy = d * Math.sin(b) + SHUFFLE[0] * wave(own, 25, time / SHUFFLE[1]);
  const ground = toWorld(h.profile, { theta: feed.theta + dx / R, s: feed.s + dy, h: feed.h + feed.rise[0] * dy + feed.rise[1] * dx });
  const feeding: Where = { air: false, feet: ground, heading: headingAt(upOf(ground), TURN * wave(own, 26, time / 12) * 2), tilt: spec.stance * 0.4, doing: 'feed', ground: true };
  // Out to the feeding ground at first light; how long it takes from how far it is (over the floor and up or down).
  const far = (theta: number, s: number, up: number): number => Math.hypot(floorGap(R, feed.theta, feed.s, theta, s), up - feed.h);
  const outward = far(tree.theta, tree.s, tree.ground + tree.height * 0.7), outTime = flightTime(outward, spec.cruise);
  if (time < leave + outTime) {
    const q = (time - leave) / outTime;
    return fly(between(sitAt(atRoost), sitAt(feeding), q, Math.min(40, 0.08 * outward)), Math.min(smootherstep(0, 0.03, q), smootherstep(1, 0.97, q)));
  }
  // Feeding till its party flies in to the murmuration over the lake, setting off to reach it as it joins.
  const over = flock.over!, start = Math.max(leave + outTime, join - flightTime(far(over.theta, over.s, flock.top + MURMUR_HIGH[0] + MURMUR_HIGH[1] / 2), 0.75 * spec.cruise));
  if (time < start) return feeding;
  const q = (time - start) / Math.max(1e-3, join - start);
  return fly(between(sitAt(feeding), there(time), q, 0), smootherstep(0, 0.03, q));
}

/** Bytes a list of flocks holds (memory watchdog): their nests, roosts, feeding grounds and swallows' ground grids. */
export const flocksBytes = (flocks: readonly Flock[]): number => flocks.reduce((n, f) => n + 200 + 48 * f.nests.length + 32 * (f.roosts.length + f.feeds.length) + (f.floor?.byteLength ?? 0), 0);

// --- what a flock sounds like ---------------------------------------------------------------------------------------

/**
 * How a starling flock sounds at clock time t (0 … 1 each): the rush of its murmuration's wings while it is up, and its
 * chatter: from the air, from the roost as it settles at dusk and as it wakes before the parties leave. Other flocks
 * make neither (their birds call one by one, `flockCallsIn`).
 */
export function flockNoise(h: Habitat, flock: Flock, time: number): { wings: number; chatter: number } {
  if (flock.kind !== 'starling' || !flock.over) return { wings: 0, chatter: 0 };
  const mo = momentsOf(h, flock, Math.floor(time / h.params.day.length)), drop = mo.fall06;
  const wings = smootherstep(drop - JOIN[0], drop - JOIN[1], time) * (1 - smootherstep(drop, drop + DROP_SPREAD / 2 + DROP, time));
  const settling = smootherstep(drop - 120, drop + 120, time) * (1 - smootherstep(drop + 1200, drop + 2400, time));
  const waking = smootherstep(mo.rise12 - 1500, mo.rise12 - 600, time) * (1 - smootherstep(mo.rise12, mo.rise12 + 900, time));
  return { wings, chatter: Math.max(0.6 * wings, settling, waking) };
}

/** Where a starling flock's murmuration is at clock time t (world, its middle) and how far it reaches (m), or null (none). */
export function murmurAt(h: Habitat, flock: Flock, time: number): { at: Vec3; reach: number } | null {
  if (flock.kind !== 'starling' || !flock.over) return null;
  const drop = momentsOf(h, flock, Math.floor(time / h.params.day.length)).fall06, f = murmurOf(h, flock, time, drop);
  return { at: f.centre, reach: Math.max(f.size[0], f.size[2]) };
}

/** Where a starling flock roosts (world, amid the crowns of its trees). */
export function roostAt(h: Habitat, flock: Flock): Vec3 {
  const n = Math.max(1, flock.roosts.length), up = flock.roosts.reduce((x, r) => x + r.ground + 0.7 * r.height, 0) / n;
  return toWorld(h.profile, { theta: flock.theta, s: flock.s, h: up });
}

/** How far a swift colony's dusk parties race from the Stair's foot (m): its screams are heard from birds within it. */
const PARTY_REACH = 300;

/**
 * The calls of the flocks' birds that start between clock times t0 and t1 within `reach` m of `ear` (world): swallows
 * twittering as they fly, swifts screaming as they race in their dusk parties, each from where the bird is then. Each
 * bird may call once in each of its species' song gaps (`song[1]`), at a moment drawn from its seed. Pure.
 */
export function flockCallsIn(t: Terrain, flocks: readonly Flock[], t0: number, t1: number, ear: Vec3, reach: number): { kind: BirdKind; at: Vec3; t: number }[] {
  const out: { kind: BirdKind; at: Vec3; t: number }[] = [], h = t.habitat;
  if (t1 <= t0) return out;
  for (const f of flocks) {
    if (f.kind === 'starling') continue;
    const home = toWorld(h.profile, { theta: f.theta, s: f.s, h: 0 }), every = BIRDS[f.kind].song[1];
    if (Math.hypot(...v3sub(home, ear)) > reach + f.reach + 500) continue;
    for (let m = 0; m < f.count; m++) {
      const own = hash3i(f.seed, m, 40, 0);
      for (let n = Math.floor(t0 / every); n * every < t1; n++) {
        if (unit(own, n, 1, 0) > 0.6) continue;
        const at = (n + unit(own, n, 2, 0)) * every;
        if (at < t0 || at >= t1) continue;
        const w = memberWhere(t, f, m, at);
        if (!w.air || Math.hypot(...v3sub(w.at, ear)) > reach) continue;
        if (f.kind === 'swift' && Math.hypot(...v3sub(w.at, home)) > PARTY_REACH) continue;
        out.push({ kind: f.kind, at: w.at, t: at });
      }
    }
  }
  return out;
}
