/**
 * The river crossings: wherever a way fords a river on the floor (the plan's ways, gen/plan.ts; the rivers,
 * gen/rivers.ts), the district it lies in has built its crossing its own way (`STYLE_CROSSING`):
 *
 * - `arch`: stone arches (the stone gardens, the makers' in glazed brick): a hump of segmental arches on piers with
 *   cutwaters, parapet walls with a coping, as many arches as the river's width needs (`PART.arch` the widest);
 * - `timber`: a timber deck on trestle bents (the orchards, the living halls, the pastures): planks, stringers, posts
 *   and two rails each side, cambered to clear the water;
 * - `stepping`: stepping stones (by the water, where people play), a stride apart, standing out of the stream;
 * - `log`: where the land was let go, a trunk laid across with a rope handline on two posts; a river too wide for a
 *   log is crossed on stepping stones there too.
 *
 * Each in its frame lying on the floor (`FloorFrame`: x along the way from bank to bank, y to its left, z up from the
 * water's surface), sized from the river it fords and the way's width, its parts in handrails. They are things at
 * sites (`crossingSites`, gen/siteTiles.ts: tiles over the floor, `topAt` what people walk on, `solids` what the
 * physics touches); `crossingKeepsClear` is where plants keep off. Pure.
 */
import { Rng, deriveSeed, v3cross, v3norm, type Vec3 } from '@futuremagic/core';
import type { DistrictStyle, Habitat } from '../blueprint';
import type { Terrain } from './terrain';
import { planOf } from './plan';
import { kept } from './kept';
import { STYLE_STONE } from './courts';
import { FINISH } from './pavilion';
import { Shape, floorAt, inFloorFrame, shade, type FloorFrame, type RGB } from './shapes';
import { siteParts, type Site, type SiteDetail } from './siteTiles';

export type CrossingKind = 'arch' | 'timber' | 'stepping' | 'log';

/** How each district style crosses its rivers. */
export const STYLE_CROSSING: Readonly<Record<DistrictStyle, CrossingKind>> = {
  stone: 'arch', makers: 'arch',
  orchard: 'timber', grove: 'timber', herd: 'timber',
  water: 'stepping', play: 'stepping',
  'let-go': 'log',
};

/** A crossing's parts, in handrails. */
export const PART = {
  /** How far a crossing reaches onto dry ground past each bank; how deep its footings go into the ground. */
  landing: 1.5, bury: 0.4,
  /** Arches: the widest opening, a pier's share of an opening (and its least), the ring, the fill over it, the least
   * height of an arch's crown over the water; the parapet's height and thickness, the coping's overhang. */
  arch: 7, pier: 0.2, leastPier: 0.8, ring: 0.5, fill: 0.25, archClear: 1.2, parapet: 1, wall: 0.35, over: 0.06,
  /** Timber: the least clearance under its beams, the deck's planks (thick, wide), the stringers' depth, the widest bay
   * between bents, a post's half width; the railing posts' spacing, the rails' half size. */
  timberClear: 0.6, plank: 0.08, board: 0.2, stringer: 0.3, bay: 5, post: 0.1, rail: 1.6, bar: 0.045,
  /** Stepping stones: a stride between them, a stone's size and how far its top stands out of the water. */
  stride: 0.75, stone: 0.62, rise: 0.25,
  /** A log: its radius, the widest river one fords, the handline's posts (how far out to the side, how tall). */
  log: 0.3, logMax: 15, line: 0.75, lineHigh: 1.1,
};

/** The longest stretch of a way in the water that is still a crossing (as rivers' widths): a longer one runs along it. */
const ACROSS_MOST = 5;

/** Linear albedo of timber by style (weathered oak; the orchards' warmer, the living halls' darker, the pastures' grey). */
const TIMBER: Readonly<Partial<Record<DistrictStyle, RGB>>> = {
  orchard: [0.36, 0.26, 0.17], grove: [0.25, 0.2, 0.15], herd: [0.36, 0.33, 0.29],
};
const PLAIN_TIMBER: RGB = [0.32, 0.25, 0.18];
const BARK: RGB = [0.2, 0.16, 0.12];
const WOOD: RGB = [0.5, 0.4, 0.28];
const ROPE: RGB = [0.45, 0.38, 0.26];
const PLAIN_STONE: RGB = [0.5, 0.48, 0.44];

/** An arch: its opening from x0 to x1, its crown's rise over the springing (the water's surface). */
export interface Arch {
  x0: number;
  x1: number;
  rise: number;
}

/** A stepping stone: its middle, its half size, which way its sides face (a unit vector in the frame), its top over the water. */
export interface Stone {
  x: number;
  y: number;
  half: number;
  way: [number, number];
  top: number;
}

/** Everything about one crossing, in its frame. */
export interface Crossing {
  habitat: Habitat;
  seed: number;
  kind: CrossingKind;
  style: DistrictStyle | null;
  handrail: number;
  /** The frame: at the ford's middle, its height the water's surface, its heading along the way. */
  frame: FloorFrame;
  /** The crossing runs from x = −half to +half; the water from wet[0] to wet[1]. */
  half: number;
  wet: [number, number];
  /** Its width (outside its parapets or rails), and the width one walks on. */
  width: number;
  walk: number;
  /** The ground over the water's surface along its middle line, every `step` m from −half. */
  ground: Float64Array;
  step: number;
  /** The deck's (or the log's underside's) height over the water at both ends: on the ground, never below the water. */
  ends: [number, number];
  /** The deck's rise over the straight line between its ends (its hump or camber) at the middle. */
  hump: number;
  arches: Arch[];
  /** Timber: the bents' places along x. */
  bents: number[];
  stones: Stone[];
}

/** The ground over the water's surface at x along a crossing's middle line (between its samples). */
export function groundAt(c: Crossing, x: number): number {
  const f = Math.min(c.ground.length - 1, Math.max(0, (x + c.half) / c.step)), i = Math.min(c.ground.length - 2, Math.floor(f)), t = f - i;
  return c.ground[i] * (1 - t) + c.ground[i + 1] * t;
}

/** The deck's top over the water at x: straight from end to end, raised by the hump (arch, timber) in the middle. */
export function deckTop(c: Crossing, x: number): number {
  const [a, b] = c.ends, t = (x + c.half) / (2 * c.half), u = x / c.half;
  return a + (b - a) * t + c.hump * Math.max(0, 1 - u * u);
}

/** The log's top over the water at x: it rests on both banks. */
export function logTopAt(c: Crossing, x: number): number {
  const r = PART.log * c.handrail, [a, b] = c.ends;
  return a + ((b - a) * (x + c.half)) / (2 * c.half) + 2 * r;
}

/** An arch's underside (its soffit) at x, or null outside its opening: a segment of a circle through both springings. */
export function soffitAt(a: Arch, x: number): number | null {
  if (x < a.x0 || x > a.x1) return null;
  const half = (a.x1 - a.x0) / 2, rho = (half * half + a.rise * a.rise) / (2 * a.rise), d = x - (a.x0 + a.x1) / 2;
  return a.rise - rho + Math.sqrt(Math.max(0, rho * rho - d * d));
}

/** A terrain's crossings, found and laid out once. */
export const crossingsOf: (t: Terrain) => readonly Crossing[] = kept(findCrossings);

function findCrossings(t: Terrain): Crossing[] {
  const h = t.habitat, hr = h.params.landmarks?.handrail, rivers = h.params.relief.rivers;
  if (!hr || !rivers || !t.rivers.length) return [];
  const plan = planOf(h), R = h.radius, out: Crossing[] = [];
  const wet = (theta: number, s: number): boolean => t.riverAt(theta, s) !== null;
  // Walk each way in steps a quarter of a river's width; where it goes into the water and out, find both edges.
  const step = Math.max(rivers.width / 4, 0.25);
  for (const path of plan.paths) {
    if (path.kind !== 'way') continue;
    const q = path.points;
    let into: { theta: number; s: number } | null = null, prev = { theta: q[0], s: q[1] };
    for (let i = 2; i < q.length; i += 2) {
      const du = (q[i] - q[i - 2]) * R, ds = q[i + 1] - q[i - 1], n = Math.max(1, Math.ceil(Math.hypot(du, ds) / step));
      for (let k = 1; k <= n; k++) {
        const at = { theta: q[i - 2] + ((q[i] - q[i - 2]) * k) / n, s: q[i - 1] + (ds * k) / n }, w = wet(at.theta, at.s);
        if (w && !into) into = shore(prev, at, wet);
        else if (!w && into) {
          const leave = shore(at, prev, wet), c = layCrossing(t, path.width, into, leave, out.length);
          if (c) out.push(c);
          into = null;
        }
        prev = at;
      }
    }
  }
  return out;
}

/** The point where `wet` changes between a dry point and a wet one (bisected to a few cm). */
function shore(dry: { theta: number; s: number }, wetPoint: { theta: number; s: number }, wet: (theta: number, s: number) => boolean): { theta: number; s: number } {
  let a = dry, b = wetPoint;
  for (let k = 0; k < 12; k++) {
    const m = { theta: (a.theta + b.theta) / 2, s: (a.s + b.s) / 2 };
    if (wet(m.theta, m.s)) b = m; else a = m;
  }
  return b;
}

/** A crossing over the water from `a` to `b` (the way's wet stretch), or null where the way runs along the river. */
function layCrossing(t: Terrain, way: number, a: { theta: number; s: number }, b: { theta: number; s: number }, index: number): Crossing | null {
  const h = t.habitat, hr = h.params.landmarks!.handrail, R = h.profile.at((a.s + b.s) / 2).r;
  const du = (b.theta - a.theta) * R, ds = b.s - a.s, across = Math.hypot(du, ds);
  const river = t.riverAt((a.theta + b.theta) / 2, (a.s + b.s) / 2);
  if (!river || across < 1e-3 || across > ACROSS_MOST * river.halfWidth * 2) return null;
  const style = planOf(h).districtAt((a.theta + b.theta) / 2, (a.s + b.s) / 2)?.style ?? null;
  let kind = style ? STYLE_CROSSING[style] : 'timber';
  if (kind === 'log' && across > PART.logMax * hr) kind = 'stepping';
  const half = across / 2 + PART.landing * hr, frame: FloorFrame = { theta: (a.theta + b.theta) / 2, s: (a.s + b.s) / 2, height: river.surface, heading: Math.atan2(du, ds) };
  const n = Math.max(8, Math.ceil((2 * half) / (hr * 0.25))), sampleStep = (2 * half) / n, ground = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = floorAt(h, frame, -half + i * sampleStep, 0);
    ground[i] = t.heightAt(p.theta, p.s) - frame.height;
  }
  const c: Crossing = {
    habitat: h, seed: deriveSeed(h.seed, 'crossing', index), kind, style, handrail: hr, frame, half, wet: [-across / 2, across / 2],
    width: kind === 'arch' ? way + 2 * PART.wall * hr : kind === 'timber' ? Math.max(way, 1.6 * hr) : kind === 'log' ? 2 * PART.log * hr : PART.stone * hr,
    walk: kind === 'arch' ? way : kind === 'timber' ? Math.max(way, 1.6 * hr) - 2 * PART.bar * hr : 0,
    ground, step: sampleStep, ends: [Math.max(ground[0], 0.1 * hr), Math.max(ground[n], 0.1 * hr)], hump: 0, arches: [], bents: [], stones: [],
  };
  if (kind === 'arch') layArches(c);
  else if (kind === 'timber') layTimber(c);
  else if (kind === 'stepping') layStones(c);
  return c;
}

/** The hump that lifts a deck `need` m over the straight line between its ends at each x given (at least `least`). */
function humpFor(c: Crossing, need: (x: number) => number, xs: readonly number[], least: number): number {
  const [a, b] = c.ends;
  let hump = least;
  for (const x of xs) {
    const u = x / c.half, line = a + ((b - a) * (x + c.half)) / (2 * c.half), room = 1 - u * u;
    if (room > 1e-3) hump = Math.max(hump, (need(x) - line) / room);
  }
  return hump;
}

/** Arches over the water: as many as its width needs, on piers; the deck humped over them, each crown clear of the water. */
function layArches(c: Crossing): void {
  const hr = c.handrail, span = c.wet[1] - c.wet[0] + 0.6 * hr, n = Math.max(1, Math.ceil(span / (PART.arch * hr)));
  const opening = n === 1 ? span : Math.min((span - (n - 1) * PART.leastPier * hr) / n, span / (n + PART.pier * (n - 1)));
  const pier = n === 1 ? 0 : (span - n * opening) / (n - 1), x0 = (c.wet[0] + c.wet[1]) / 2 - span / 2;
  const middles = Array.from({ length: n }, (_, i) => x0 + i * (opening + pier) + opening / 2);
  const over = (PART.ring + PART.fill) * hr;
  c.hump = humpFor(c, () => PART.archClear * hr + over, middles, 0.3 * hr);
  // Each arch as high as the deck over it lets it be (the ring and its fill under the deck all along it, where the
  // deck slopes too), no higher than a half circle; where that leaves a crown too low, the hump grows and they rise.
  const want = Math.min(opening / 2, PART.archClear * hr);
  for (let round = 0; round < 12; round++) {
    c.arches = middles.map((m) => ({ x0: m - opening / 2, x1: m + opening / 2, rise: highest(c, m - opening / 2, m + opening / 2, over) }));
    // The hump lifts an arch by its share there (1 − u²).
    const short = Math.max(...c.arches.map((a) => (want - a.rise) / Math.max(0.05, 1 - ((a.x0 + a.x1) / 2 / c.half) ** 2)));
    if (short <= 1e-9) break;
    c.hump += short * 1.1 + 1e-4;
  }
}

/** The highest rise (up to a half circle) of an arch from x0 to x1 that keeps `over` under the deck everywhere along it. */
function highest(c: Crossing, x0: number, x1: number, over: number): number {
  const fits = (rise: number): boolean => {
    const a = { x0, x1, rise };
    for (let k = 0; k <= 16; k++) {
      const x = x0 + ((x1 - x0) * k) / 16;
      if (deckTop(c, x) - soffitAt(a, x)! < over) return false;
    }
    return true;
  };
  let lo = 0, hi = (x1 - x0) / 2;
  if (fits(hi)) return hi;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (fits(m)) lo = m; else hi = m;
  }
  return lo;
}

/** A timber deck on bents across the water, cambered so its beams clear the water everywhere. */
function layTimber(c: Crossing): void {
  const hr = c.handrail, depth = (PART.plank + PART.stringer) * hr, wetLen = c.wet[1] - c.wet[0];
  const xs = Array.from({ length: 17 }, (_, i) => c.wet[0] + (wetLen * i) / 16);
  // Full clearance over the middle of the stream, less toward the banks, where the beams run into the landings.
  const mid = (c.wet[0] + c.wet[1]) / 2, wHalf = wetLen / 2;
  c.hump = humpFor(c, (x) => depth + PART.timberClear * hr * (0.25 + 0.75 * (1 - ((x - mid) / wHalf) ** 2)), xs, 0.15 * hr);
  const n = Math.max(1, Math.ceil(wetLen / (PART.bay * hr)));
  c.bents = Array.from({ length: n + 1 }, (_, i) => c.wet[0] + (wetLen * i) / n);
}

/** A unit vector turned a from x. */
const facing = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];

/** Stepping stones a stride apart across the water, each a little off the line and turned, standing out of it. */
function layStones(c: Crossing): void {
  const hr = c.handrail, rng = new Rng(c.seed), wetLen = c.wet[1] - c.wet[0], n = Math.max(1, Math.round(wetLen / (PART.stride * hr)));
  for (let i = 0; i < n; i++) {
    const x = c.wet[0] + ((i + 0.5) * wetLen) / n;
    c.stones.push({ x, y: rng.range(-0.12, 0.12) * hr, half: (PART.stone / 2) * hr * rng.range(0.85, 1.1), way: facing(rng.range(-0.35, 0.35)), top: Math.max(PART.rise * hr, groundAt(c, x) + 0.05 * hr) + rng.range(-0.03, 0.03) * hr });
  }
}

/** Where a crossing's railings, posts and walls stand across (|y|): its edges, less half a wall or a bar. */
const edgeOf = (c: Crossing): number => c.width / 2 - (c.kind === 'arch' ? PART.wall : PART.bar) * c.handrail;

/** A crossing's samples along x at a detail: the ends, every arch's springings, and enough between. */
function samples(c: Crossing, detail: SiteDetail): number[] {
  const per = { far: 0.12, mid: 0.4, near: 1, solid: 0.4 }[detail], n = Math.max(8, Math.ceil(((2 * c.half) / c.handrail) * per));
  const xs = new Set<number>(Array.from({ length: n + 1 }, (_, i) => -c.half + (2 * c.half * i) / n));
  for (const a of c.arches) { xs.add(a.x0); xs.add(a.x1); }
  return [...xs].sort((p, q) => p - q);
}

/** A crossing at one detail, in its own frame. */
export function buildCrossing(c: Crossing, detail: SiteDetail): Shape {
  const sh = new Shape(8, true, true);
  if (c.kind === 'arch') archBridge(sh, c, detail);
  else if (c.kind === 'timber') timberBridge(sh, c, detail);
  else if (c.kind === 'stepping') steppingStones(sh, c, detail);
  else logCrossing(sh, c, detail);
  return sh;
}

/** A slat from a to b (any slope), `w` wide and `d` deep, its sides upright. */
function slat(sh: Shape, a: Vec3, b: Vec3, w: number, d: number, col: RGB): void {
  const along = v3norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const across = Math.abs(along[2]) > 0.99 ? [0, 1, 0] as Vec3 : v3norm(v3cross([0, 0, 1], along)), up = v3cross(along, across);
  sh.block([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], along, across, up, [len / 2, w / 2, d / 2], col);
}

/** The stone bridge: deck, spandrel walls rising into the parapets, the arches' undersides, piers with cutwaters. */
function archBridge(sh: Shape, c: Crossing, detail: SiteDetail): void {
  const hr = c.handrail, look = (c.style && STYLE_STONE[c.style]) ?? { stone: PLAIN_STONE, finish: FINISH.stone }, stone = look.stone;
  const far = detail === 'far', near = detail === 'near', solid = detail === 'solid';
  const W = c.width / 2, inner = W - PART.wall * hr, high = PART.parapet * hr, bury = PART.bury * hr, xs = samples(c, detail);
  sh.finish = look.finish;
  const archAt = (x: number): Arch | undefined => c.arches.find((a) => x >= a.x0 - 1e-9 && x <= a.x1 + 1e-9);
  // Under the deck at x: an arch's soffit, else the pier or abutment down into the ground.
  const under = (x: number, mid: number): number => {
    const a = archAt(mid);
    return a ? soffitAt(a, Math.min(a.x1, Math.max(a.x0, x)))! : groundAt(c, x) - bury;
  };
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1], m = (x0 + x1) / 2, d0 = deckTop(c, x0), d1 = deckTop(c, x1);
    // The walk between the parapets, and the parapets' inner faces up from it.
    sh.faceToward([x0, -inner, d0], [x1, -inner, d1], [x1, inner, d1], [x0, inner, d0], [0, 0, 1], stone);
    for (const s of [-1, 1]) {
      sh.faceToward([x0, s * inner, d0], [x1, s * inner, d1], [x1, s * inner, d1 + high], [x0, s * inner, d0 + high], [0, -s, 0], stone);
      // The parapet's top (its coping), and the outer face from under the deck up to it.
      const o = near ? PART.over * hr : 0, top = near ? 0.08 * hr : 0;
      sh.faceToward([x0, s * (inner - o), d0 + high + top], [x1, s * (inner - o), d1 + high + top], [x1, s * (W + o), d1 + high + top], [x0, s * (W + o), d0 + high + top], [0, 0, 1], near ? shade(stone, 1.08) : stone);
      if (solid) continue;
      sh.faceToward([x0, s * W, under(x0, m)], [x1, s * W, under(x1, m)], [x1, s * W, d1 + high], [x0, s * W, d0 + high], [0, s, 0], stone);
      if (near) {
        // The coping's edges, proud of both faces.
        for (const [y, out] of [[W + o, s], [inner - o, -s]] as const) sh.faceToward([x0, s * y, d0 + high], [x1, s * y, d1 + high], [x1, s * y, d1 + high + top], [x0, s * y, d0 + high + top], [0, out, 0], shade(stone, 1.08));
        sh.faceToward([x0, s * W, d0 + high], [x1, s * W, d1 + high], [x1, s * (W + o), d1 + high], [x0, s * (W + o), d0 + high], [0, 0, -1], shade(stone, 1.08));
        sh.faceToward([x0, s * (inner - o), d0 + high], [x1, s * (inner - o), d1 + high], [x1, s * inner, d1 + high], [x0, s * inner, d0 + high], [0, 0, -1], shade(stone, 1.08));
      }
    }
    // An arch's underside.
    const a = archAt(m);
    if (a && !solid) sh.faceToward([x0, -W, under(x0, m)], [x1, -W, under(x1, m)], [x1, W, under(x1, m)], [x0, W, under(x0, m)], [0, 0, -1], shade(stone, 0.8));
  }
  if (solid) return;
  // The ends: into the banks.
  for (const s of [-1, 1]) {
    const x = s * c.half, d = deckTop(c, x), g = groundAt(c, x) - bury;
    sh.faceToward([x, -W, g], [x, W, g], [x, W, d + high], [x, -W, d + high], [s, 0, 0], stone);
  }
  // The piers and abutments: the faces down from each arch's springing into the river's bed, cutwaters before the piers.
  c.arches.forEach((a, k) => {
    for (const [x, s] of [[a.x0, 1], [a.x1, -1]] as const) {
      sh.faceToward([x, -W, groundAt(c, x) - bury], [x, W, groundAt(c, x) - bury], [x, W, 0], [x, -W, 0], [s, 0, 0], shade(stone, 0.85));
    }
    const next = c.arches[k + 1];
    if (!next || far) return;
    // A cutwater either side of the pier: a block turned on edge, half in the wall.
    const p0 = a.x1, p1 = next.x0, xm = (p0 + p1) / 2, half = (p1 - p0) / 2 / Math.SQRT2, bed = groundAt(c, xm) - bury, top = Math.min(a.rise, next.rise) * 0.55;
    for (const s of [-1, 1]) {
      sh.block([xm, s * W, (bed + top) / 2], [Math.SQRT1_2, Math.SQRT1_2, 0], [-Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1], [half, half, (top - bed) / 2], shade(stone, 0.9), true);
    }
  });
  if (!near) return;
  // The arch rings on both faces: a band of voussoirs a little proud, a shade darker, its joints cut every so often.
  for (const a of c.arches) {
    const n = Math.max(7, 2 * Math.round(((a.x1 - a.x0) / hr) * 1.5) + 1), ring = PART.ring * hr;
    for (let k = 0; k < n; k++) {
      const xa = a.x0 + ((a.x1 - a.x0) * k) / n, xb = a.x0 + ((a.x1 - a.x0) * (k + 1)) / n, za = soffitAt(a, xa)!, zb = soffitAt(a, xb)!;
      const col = shade(stone, k % 2 ? 0.86 : 0.8);
      for (const s of [-1, 1]) {
        const y = s * (W + 0.02 * hr);
        sh.faceToward([xa, y, za], [xb, y, zb], [xb, y, zb + ring], [xa, y, za + ring], [0, s, 0], col);
      }
    }
  }
}

/** The timber bridge: planks on two stringers, bents of posts down into the bed, posts and two rails each side. */
function timberBridge(sh: Shape, c: Crossing, detail: SiteDetail): void {
  const hr = c.handrail, wood = (c.style && TIMBER[c.style]) ?? PLAIN_TIMBER, far = detail === 'far', near = detail === 'near', solid = detail === 'solid';
  const W = c.width / 2, plank = PART.plank * hr, beam = PART.stringer * hr, xs = samples(c, detail), bury = PART.bury * hr, edge = edgeOf(c);
  sh.finish = FINISH.timber;
  const up: Vec3 = [0, 0, 1];
  if (near) {
    // Planks across, a finger's gap apart, each a little off level, following the camber.
    const n = Math.max(2, Math.round((2 * c.half) / (PART.board * hr))), w = (2 * c.half) / n, rng = new Rng(c.seed);
    for (let i = 0; i < n; i++) {
      const x = -c.half + (i + 0.5) * w, z = deckTop(c, x) - plank / 2 + rng.range(-0.008, 0.008) * hr, tilt = (deckTop(c, x + w / 2) - deckTop(c, x - w / 2)) / w;
      const ex = v3norm([1, 0, tilt]);
      sh.block([x, 0, z], ex, [0, 1, 0], v3cross(ex, [0, 1, 0]), [w / 2 - 0.006 * hr, W - rng.range(0, 0.04) * hr, plank / 2], shade(wood, rng.range(0.9, 1.08)));
    }
  } else {
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], d0 = deckTop(c, x0), d1 = deckTop(c, x1);
      sh.faceToward([x0, -W, d0], [x1, -W, d1], [x1, W, d1], [x0, W, d0], up, wood);
      if (solid) continue;
      sh.faceToward([x0, -W, d0 - plank], [x1, -W, d1 - plank], [x1, W, d1 - plank], [x0, W, d0 - plank], [0, 0, -1], shade(wood, 0.7));
      for (const s of [-1, 1]) sh.faceToward([x0, s * W, d0 - plank - (far ? beam : 0)], [x1, s * W, d1 - plank - (far ? beam : 0)], [x1, s * W, d1], [x0, s * W, d0], [0, s, 0], shade(wood, 0.85));
    }
  }
  // The railing: posts every so far along both edges, a top rail and a middle rail between them.
  const posts = Math.max(2, Math.round((2 * c.half) / (PART.rail * hr)) + 1), high = hr, b = PART.bar * hr;
  for (const s of [-1, 1]) {
    const at = Array.from({ length: posts }, (_, i) => -c.half + (2 * c.half * i) / (posts - 1));
    for (let i = 0; i < at.length; i++) {
      const x = at[i], d = deckTop(c, x);
      if (solid) {
        if (i + 1 < at.length) {
          const x1 = at[i + 1], d1 = deckTop(c, x1);
          sh.faceToward([x, s * edge, d], [x1, s * edge, d1], [x1, s * edge, d1 + high], [x, s * edge, d + high], [0, -s, 0], wood);
        }
        continue;
      }
      if (!far) sh.block([x, s * edge, d + high / 2 - plank / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [b, b, high / 2 + plank / 2], wood, true);
      if (i + 1 === at.length) continue;
      const x1 = at[i + 1], d1 = deckTop(c, x1);
      for (const z of far ? [high] : [high, high * 0.5]) slat(sh, [x, s * edge, d + z], [x1, s * edge, d1 + z], b * 1.4, far ? b * 4 : b * 2, wood);
    }
  }
  if (solid) return;
  if (!far) {
    // Two stringers under the planks, from bank to bank.
    for (const s of [-1, 1]) {
      const y = s * (W - 0.3 * hr);
      for (let i = 0; i + 1 < xs.length; i++) slat(sh, [xs[i], y, deckTop(c, xs[i]) - plank - beam / 2], [xs[i + 1], y, deckTop(c, xs[i + 1]) - plank - beam / 2], 0.22 * hr, beam, shade(wood, 0.8));
    }
  }
  // The bents: two posts down into the bed under each, a cap across; braced up close.
  for (const x of c.bents) {
    const top = deckTop(c, x) - plank - beam, bed = groundAt(c, x) - bury, y = W - 0.3 * hr, p = PART.post * hr;
    for (const s of [-1, 1]) sh.block([x, s * y, (top + bed) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [p, p, (top - bed) / 2], shade(wood, 0.75));
    if (far) continue;
    sh.block([x, 0, top - p], [1, 0, 0], [0, 1, 0], [0, 0, 1], [p * 1.1, y + p * 2, p], shade(wood, 0.8));
    if (near && top - Math.max(bed, 0) > 0.6 * hr) slat(sh, [x, -y, Math.max(bed, -0.1 * hr) + 0.15 * hr], [x, y, top - 2 * p], p * 0.9, p * 0.9, shade(wood, 0.78));
  }
}

/** Stepping stones: blocks out of the river's bed, a cap a little smaller on each up close. */
function steppingStones(sh: Shape, c: Crossing, detail: SiteDetail): void {
  const hr = c.handrail, look = (c.style && STYLE_STONE[c.style]) ?? { stone: PLAIN_STONE, finish: FINISH.stone }, near = detail === 'near';
  sh.finish = FINISH.stone;
  const rng = new Rng(c.seed + 1);
  for (const st of c.stones) {
    const bed = groundAt(c, st.x) - PART.bury * c.handrail, [cx, cy] = st.way, ex: Vec3 = [cx, cy, 0], ey: Vec3 = [-cy, cx, 0];
    const col = shade(look.stone, rng.range(0.85, 1.05)), cap = near ? 0.07 * hr : 0;
    sh.block([st.x, st.y, (bed + st.top - cap) / 2], ex, ey, [0, 0, 1], [st.half, st.half * 0.9, (st.top - cap - bed) / 2], col, true);
    if (near) sh.block([st.x, st.y, st.top - cap / 2], ex, ey, [0, 0, 1], [st.half - cap * 0.6, st.half * 0.9 - cap * 0.6, cap / 2], shade(col, 1.05), true);
  }
}

/** A log across, resting on both banks; a rope handline on two posts beside it; a few branch stubs up close. */
function logCrossing(sh: Shape, c: Crossing, detail: SiteDetail): void {
  const hr = c.handrail, r = PART.log * hr, sides = { far: 6, mid: 8, near: 12, solid: 6 }[detail], solid = detail === 'solid';
  sh.finish = FINISH.timber;
  const a: Vec3 = [-c.half - 0.3 * hr, 0, logTopAt(c, -c.half) - r], b: Vec3 = [c.half + 0.3 * hr, 0, logTopAt(c, c.half) - r];
  const m: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2], half = Math.hypot(b[0] - m[0], b[2] - m[2]);
  // Two prisms out from the middle, so both ends are capped.
  for (const s of [-1, 1]) {
    const up = v3norm([s * (b[0] - a[0]), 0, s * (b[2] - a[2])]), ey: Vec3 = [0, 1, 0], ex = v3cross(ey, up);
    sh.prism(m, ex, ey, up, r, half, sides, BARK);
  }
  if (solid) return;
  // The handline: a post at each end on the left, a rope sagging between their tops.
  const y = PART.line * hr, high = PART.lineHigh * hr, post = 0.07 * hr;
  const ends = [-1, 1].map((s) => s * (c.half - 0.4 * hr)), tops = ends.map((x) => groundAt(c, x) + high);
  for (let k = 0; k < 2; k++) sh.prism([ends[k], y, groundAt(c, ends[k]) - 0.3 * hr], [1, 0, 0], [0, 1, 0], [0, 0, 1], post, high + 0.3 * hr, 6, WOOD);
  if (detail === 'far') return;
  const n = detail === 'near' ? 12 : 6, sag = 0.25 * hr + (ends[1] - ends[0]) * 0.02;
  for (let k = 0; k < n; k++) {
    const rope = (t: number): Vec3 => [ends[0] + (ends[1] - ends[0]) * t, y, tops[0] + (tops[1] - tops[0]) * t - sag * 4 * t * (1 - t)];
    slat(sh, rope(k / n), rope((k + 1) / n), 0.035 * hr, 0.035 * hr, ROPE);
  }
  if (detail !== 'near') return;
  // Branch stubs, sawn off where they would trip.
  const rng = new Rng(c.seed + 2);
  for (let k = 0; k < 3; k++) {
    const t = rng.range(0.15, 0.85), x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, s = rng.chance(0.5) ? 1 : -1;
    const dir = v3norm([rng.range(-0.3, 0.3), s, rng.range(-0.2, 0.4)]);
    slat(sh, [x, s * r * 0.6, z], [x + dir[0] * r * 1.6, s * r * 0.6 + dir[1] * r * 1.6, z + dir[2] * r * 1.6], r * 0.45, r * 0.45, BARK);
  }
}

/**
 * How high the walkable top of a crossing is over the water at a point of its frame (x, y), or null off it: the deck
 * between the parapets or rails, a stepping stone's top, the log's.
 */
export function crossingTop(c: Crossing, x: number, y: number): number | null {
  if (Math.abs(x) > c.half) return null;
  if (c.kind === 'stepping') {
    for (const st of c.stones) {
      const dx = x - st.x, dy = y - st.y, [cx, cy] = st.way, u = dx * cx + dy * cy, v = dy * cx - dx * cy;
      if (Math.abs(u) <= st.half && Math.abs(v) <= st.half * 0.9) return st.top;
    }
    return null;
  }
  if (c.kind === 'log') return Math.abs(y) <= PART.log * c.handrail * 0.7 ? logTopAt(c, x) : null;
  return Math.abs(y) <= edgeOf(c) ? deckTop(c, x) : null;
}

/** Each crossing as a site on the floor. */
const sitesOf = kept((t: Terrain): Site[] => crossingsOf(t).map((c) => ({ theta: c.frame.theta, s: c.frame.s, reach: Math.hypot(c.half, c.width / 2 + PART.line * c.handrail) })));

/** The index of the crossing over (θ, s) (within `margin` of it), or null. */
function crossingNear(t: Terrain, theta: number, s: number, margin: number): number | null {
  const h = t.habitat, all = crossingsOf(t);
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (Math.abs(s - c.frame.s) > c.half + c.width + margin) continue;
    const [x, y] = inFloorFrame(h, c.frame, theta, s);
    if (Math.abs(x) <= c.half + margin && Math.abs(y) <= c.width / 2 + PART.line * c.handrail + margin) return i;
  }
  return null;
}

/** The crossings as things at sites (gen/siteTiles.ts): their grid, tiles, solids and the top one stands on. */
export const crossingSites = siteParts({
  sites: sitesOf,
  frame: (t, i) => crossingsOf(t)[i].frame,
  build: (t, i, detail) => buildCrossing(crossingsOf(t)[i], detail),
  at: (t, theta, s) => crossingNear(t, theta, s, 0),
  top: (t, i, x, y) => crossingTop(crossingsOf(t)[i], x, y),
});

/** Whether plants keep off a point: on a crossing or within a handrail of it (reeds and trees out of the way). */
export function crossingKeepsClear(t: Terrain, theta: number, s: number): boolean {
  const hr = t.habitat.params.landmarks?.handrail;
  return !!hr && crossingNear(t, theta, s, hr) !== null;
}
