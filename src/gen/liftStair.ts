/**
 * The Lift Stair (Solarpolis design, "A land people make": the Gate's Stair face, the habitat's signature): the one
 * stair from the floor up the port endcap to the hub, on the plain ramp the terrain leaves for it up the main valley's
 * line (`Landform.stairHalfWidth`, `valleyAt(0, s)`), which spirals spinward as it climbs. Every passenger who arrives
 * comes down it.
 *
 * The Gate is steep (in the reference a little over 40° at its foot, 74° near the axis) and gravity fades up it, so
 * the stair is built the way gravity allows:
 *
 * - its risers grow as gravity fades (`riserAt`): a step takes the same effort everywhere, so a step at a quarter g is
 *   four times as high, and near the hub the steps are ledges one bounds up;
 * - where its steps would climb more gently than the face, it zigzags across the ramp in flights between turning
 *   platforms, each leg as steep as its steps; where they climb as steeply as the face (at the foot, where the face is
 *   still gentle, and high up, where the risers are tall) it runs straight up the middle. So the zigzag tightens and
 *   then straightens toward the hub, and from the floor one reads where gravity fades;
 * - it stands on the face, built up from it (never cut in): every floor is at least `CLEARANCE` over the ground under
 *   it, on walls that go down into the slope.
 *
 * The layout is in plan: `z` along the axis (world z, toward the hub), `w` across the ramp (m around the axis, at the
 * ground's radius, spinward positive), `e` the height above the floor (R − r: level is a constant radius, true up is
 * toward the axis). `rampOf` maps between plan and world. Sizes come from the ramp's width and the handrail's height
 * (`HabitatParams.landmarks`), so every habitat's stair has steps of human size. Pure.
 */
import { toWorld, type Habitat, type Vec3 } from '../blueprint';
import { landformOf, planOf, siteOf } from './plan';
import { kept } from './kept';
import { standThrough } from './standing';
import { layThreshold, type Threshold } from './threshold';

/** The face the stair climbs, in plan (z, w) and height e above the floor. */
export interface Ramp {
  readonly habitat: Habitat;
  /** Half the ramp's width (m), and the profile span the table covers (from a little onto the floor to the hub). */
  readonly halfWidth: number;
  readonly s0: number;
  readonly s1: number;
  /** The profile's point at axial position z (on the floor, z before the endcap; clamped to the span). */
  sOf(z: number): number;
  zOf(s: number): number;
  /** The ground's height above the floor at z (the plain ramp; the terrain's roughness is within `CLEARANCE`). */
  groundAt(z: number): number;
  /** Where the ground reaches height e (the inverse of `groundAt`). */
  zAt(e: number): number;
  /** The ramp's middle line at z (θ), and the ground's radius there. */
  middleAt(z: number): number;
  radiusAt(z: number): number;
  /** A plan point at height e, in the world. */
  world(z: number, w: number, e: number): Vec3;
  /** A world point in plan: z, w and its height e. */
  plan(p: Vec3): { z: number; w: number; e: number };
}

/**
 * A level platform: a forecourt at the foot, a turn between two legs, a rest on a straight run, the top terrace, a bay
 * of one of the Threshold's galleries beside it (gen/threshold.ts).
 */
export interface StairPlatform {
  kind: 'forecourt' | 'turn' | 'rest' | 'top' | 'gallery';
  z0: number;
  z1: number;
  w0: number;
  w1: number;
  /** Its floor's height above the floor of the habitat (m). */
  e: number;
  /** A gallery's bay: its gallery (0 the upper) and its place along it (from the gallery's −w end). */
  bay?: { tier: number; index: number };
}

/** One end of a leg: where its middle line meets the platform's face, and that face's direction in plan. */
export interface LegEnd {
  z: number;
  w: number;
  /** The face it starts or ends on runs along z (a platform's side, `true`) or along w (its downhill or uphill edge). */
  alongZ: boolean;
}

/**
 * A leg: flights of steps from one platform to the next along a straight line in plan, rest landings between the
 * flights. Its floor starts at the first platform's height `e0` and its last step tops out at the next one's `e1`.
 */
export interface StairLeg {
  from: LegEnd;
  to: LegEnd;
  e0: number;
  e1: number;
  /** Its width between the parapets' outer faces (m). */
  width: number;
  steps: number;
  riser: number;
  tread: number;
  /** Steps in a flight, and a rest landing's depth along the leg. */
  flight: number;
  rest: number;
}

export interface LiftStair {
  kind: 'lift-stair';
  /** The handrail's height, a leg's width, the parapets' thickness, and how far every floor stands over the ground. */
  handrail: number;
  width: number;
  parapet: number;
  clearance: number;
  /**
   * Platforms from the foot up to the top terrace, leg i climbing from platform i to platform i + 1; then the
   * Threshold's galleries' bays and the flights between them (`threshold`), so everything that draws, stands on or
   * keeps clear of the stair does so of the Threshold too.
   */
  platforms: StairPlatform[];
  legs: StairLeg[];
  /** The top terrace, where the newcomer arrives, and the stair's last leg, which climbs onto it. */
  top: StairPlatform;
  topLeg: StairLeg;
  /** The Threshold's galleries beside the top terrace, or null where the ramp has no room for them. */
  threshold: Threshold | null;
}

/** A step's riser at 1 g and its tread, as shares of the handrail's height (15 cm and 36 cm for 1.1 m). */
const RISER_1G = 0.14;
export const TREAD = 0.33;
/** The shallowest tread a stair is laid with at all, and the deepest (a stepped ramp at the very foot), in handrails. */
const TREAD_MIN = 0.27;
const TREAD_MAX = 1.5;
/** The highest riser, in handrails: near the hub a step is a ledge one bounds up. */
const RISER_MAX = 1.5;
/** Steps in a flight before a rest landing, and the landing's depth (handrails). */
export const FLIGHT = 18;
export const REST = 1.5;
/** A leg's width as a share of the ramp's half width, within these bounds (handrails). */
const WIDTH = 0.12;
const WIDTH_MIN = 2.5;
const WIDTH_MAX = 10;
/** The parapets' thickness (handrails). */
const PARAPET = 0.4;
/** How far every floor stands over the plain ramp at least (handrails): over the terrain's roughness. */
const CLEARANCE = 1.4;
/** How far the turning platforms keep from the ramp's edges (share of a leg's width). */
const MARGIN = 0.25;
/** The top terrace: where gravity is this share of the floor's, or twice the hub's radius out from the axis. */
const TOP_GRAVITY = 0.04;
/** How deep the forecourt is along the axis and how far it reaches onto the floor (legs' widths). */
const FORECOURT = 2;

/** A step's riser where gravity is `g` (share of the floor's): the same effort for every step, within the bounds. */
export function riserAt(handrail: number, g: number): number {
  return Math.min(RISER_MAX * handrail, (RISER_1G * handrail) / Math.max(g, 1e-3));
}

/** The ramp of a habitat's Stair face, in plan (made once per habitat). */
export const rampOf: (h: Habitat) => Ramp = kept(makeRamp);

function makeRamp(h: Habitat): Ramp {
  const p = h.profile, form = landformOf(h), R = h.radius;
  const halfWidth = form.stairHalfWidth;
  // From a little onto the floor (the forecourt) to the hub, along the profile.
  const s0 = Math.max(p.floorStart, p.floorEnd - Math.max(halfWidth, 1) * 2), s1 = p.length;
  const n = 4096, zs = new Float64Array(n + 1), es = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = p.at(s0 + ((s1 - s0) * i) / n);
    zs[i] = a.z;
    es[i] = R - a.r;
  }
  /** Linear between table rows: the row below x in a rising column, and how far to the next. */
  const find = (col: Float64Array, x: number): [number, number] => {
    if (x <= col[0]) return [0, 0];
    if (x >= col[n]) return [n - 1, 1];
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (col[m] <= x) lo = m; else hi = m; }
    const d = col[lo + 1] - col[lo];
    return [lo, d > 0 ? (x - col[lo]) / d : 0];
  };
  const sOf = (z: number): number => {
    if (z < zs[0]) return s0 - (zs[0] - z); // on the floor, s runs with z
    const [i, f] = find(zs, z);
    return s0 + ((s1 - s0) * (i + f)) / n;
  };
  const zOf = (s: number): number => {
    if (s < s0) return zs[0] - (s0 - s);
    const x = ((Math.min(s, s1) - s0) / (s1 - s0)) * n, i = Math.min(n - 1, Math.floor(x));
    return zs[i] + (zs[i + 1] - zs[i]) * (x - i);
  };
  /** One column of the table read at a value of another (both rising), between rows. */
  const read = (by: Float64Array, x: number, of: Float64Array): number => {
    if (x <= by[0]) return of[0];
    const [i, f] = find(by, x);
    return of[i] + (of[i + 1] - of[i]) * f;
  };
  const groundAt = (z: number): number => read(zs, z, es);
  const zAt = (e: number): number => read(es, e, zs);
  const radiusAt = (z: number): number => p.at(sOf(z)).r;
  const middleAt = (z: number): number => form.valleyAt(0, sOf(z));
  const world = (z: number, w: number, e: number): Vec3 => {
    const theta = middleAt(z) + w / Math.max(radiusAt(z), 1e-6), r = R - e;
    return [r * Math.cos(theta), r * Math.sin(theta), z];
  };
  const plan = (q: Vec3): { z: number; w: number; e: number } => {
    const z = q[2], r = Math.hypot(q[0], q[1]), d = Math.atan2(q[1], q[0]) - middleAt(z);
    return { z, w: Math.atan2(Math.sin(d), Math.cos(d)) * radiusAt(z), e: R - r };
  };
  return { habitat: h, halfWidth, s0, s1, sOf, zOf, groundAt, zAt, middleAt, radiusAt, world, plan };
}

/** The habitat's Lift Stair on its plan site, or null (no landmarks, no site, or a ramp too small for one). */
export const liftStairOf: (h: Habitat) => LiftStair | null = kept(layStair);

function layStair(h: Habitat): LiftStair | null {
  const spec = h.params.landmarks;
  if (!spec || !siteOf(planOf(h), 'lift-stair')) return null;
  const ramp = rampOf(h), hr = spec.handrail, H = ramp.halfWidth, R = h.radius;
  const width = Math.min(WIDTH_MAX * hr, Math.max(WIDTH_MIN * hr, H * WIDTH));
  if (width > H * 1.8) return null;
  const clearance = CLEARANCE * hr, rest = REST * hr;
  const tread = TREAD * hr, treadMax = TREAD_MAX * hr;
  // The turning platforms' middles keep this far from the ramp's middle line; too narrow a ramp only runs straight.
  const A = H - width * MARGIN - width / 2;
  const zigzag = A > width;
  // The top terrace's height: low gravity, clear of the hub.
  const eTop = R - Math.max(R * TOP_GRAVITY, h.profile.at(h.profile.length).r * 2);
  const gravity = (e: number): number => (R - e) / R;
  /**
   * The floor of a platform whose uphill edge is at z: `clearance` and a riser over the ground there (a leg's steps lie
   * up to a riser under the straight line between its platforms, which the ground's rising curve stays under).
   */
  const level = (z: number): number => { const g = ramp.groundAt(z); return g + clearance + riserAt(hr, gravity(g)); };

  const zFoot = ramp.zOf(h.profile.floorEnd);
  const court: StairPlatform = { kind: 'forecourt', z0: zFoot - width * FORECOURT, z1: zFoot, w0: -(A + width / 2), w1: A + width / 2, e: level(zFoot) };
  const platforms: StairPlatform[] = [court];
  const legs: StairLeg[] = [];
  /** Steps for a rise at about `riser` each, never one higher than the highest riser. */
  const stepsFor = (rise: number, riser: number): number => Math.max(1, Math.round(rise / riser), Math.ceil(rise / (RISER_MAX * hr) - 1e-9));
  const legBetween = (a: StairPlatform, b: StairPlatform, steps: number): StairLeg => {
    // Straight up, the run is signed: a landing laid below the last one's edge leaves no room for steps at all.
    const ends = endsOf(a, b, width, PARAPET * hr), dz = ends.to.z - ends.from.z, dw = ends.to.w - ends.from.w;
    const run = ends.from.alongZ ? Math.hypot(dz, dw) : dz;
    const landings = Math.ceil(steps / FLIGHT) - 1;
    return { ...ends, e0: a.e, e1: b.e, width, steps, riser: (b.e - a.e) / steps, tread: (run - landings * rest - skew(ends, width)) / steps, flight: FLIGHT, rest };
  };
  type Next = { to: StairPlatform; leg: StairLeg };

  const turnAt = (kind: 'turn' | 'top', zc: number, w: number, from: StairPlatform, r1: number): StairPlatform => ({
    kind, z0: zc - width, z1: zc + width, w0: w - width / 2, w1: w + width / 2, e: Math.max(level(zc + width), from.e + r1),
  });
  // Straight up from a platform's uphill edge: one flight to a square rest landing, its uphill edge on the ground's line.
  const straight = (from: StairPlatform, kind: 'rest' | 'top'): Next => {
    const r1 = riserAt(hr, gravity(from.e)), w = middleOf(from), rise = FLIGHT * r1;
    const z1 = Math.max(ramp.zAt(from.e + rise - clearance), from.z1 + width);
    const depth = kind === 'top' ? width * FORECOURT : width;
    const to: StairPlatform = { kind, z0: z1 - depth, z1, w0: w - width / 2, w1: w + width / 2, e: Math.max(from.e + rise, level(z1)) };
    let leg = legBetween(from, to, stepsFor(to.e - from.e, r1));
    if (leg.tread > treadMax) {
      // On the gentle foot the treads would be too deep: lay them at the deepest, and let the landing stand lower down.
      const shift = (leg.tread - treadMax) * leg.steps;
      to.z0 -= shift; to.z1 -= shift;
      leg = legBetween(from, to, leg.steps);
    }
    return { to, leg };
  };
  // Across the ramp to a platform at w, as far up as makes its treads come out at `tread`, at least a little above
  // the platform it leaves (so that the legs on one side lie one above the other and never touch).
  const across = (from: StairPlatform, w: number, kind: 'turn'): Next => {
    const r1 = riserAt(hr, gravity(from.e));
    const crossAt = (zc: number): Next => {
      const to = turnAt(kind, zc, w, from, r1), rise = to.e - from.e;
      return { to, leg: legBetween(from, to, stepsFor(rise, riserAt(hr, gravity(from.e + rise / 2)))) };
    };
    // Step out until the treads come out short enough, then halve the step: far past the face's top the ground stops
    // rising and the treads lengthen again, so the search never looks there.
    let lo = (from.z0 + from.z1) / 2 + width * 1.2, hi = lo;
    if (crossAt(lo).leg.tread <= tread) return crossAt(lo);
    for (let step = width / 4; crossAt(hi).leg.tread > tread && step < H * 64; step *= 2) { lo = hi; hi += step; }
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (crossAt(mid).leg.tread > tread) lo = mid; else hi = mid;
    }
    return crossAt(lo);
  };

  let zig = false;
  for (let guard = 0; guard < 100000; guard++) {
    const from = platforms[platforms.length - 1];
    if (from.e >= eTop - 1e-6) break;
    let next: Next;
    if (!zig) {
      next = straight(from, 'rest');
      if (next.to.e >= eTop) next = straight(from, 'top');
      else if (next.leg.tread < tread && zigzag) zig = true;
    }
    if (zig) {
      // Back to the middle once a straight run would climb as steeply as the face again (the risers have grown), or
      // to end on the top terrace there; otherwise over to the other side.
      const middle = { ...from, w0: -width / 2, w1: width / 2 };
      const onwards = straight(middle, 'rest');
      const side = middleOf(from) > 1e-9 ? -1 : 1;
      next = across(from, side * A, 'turn');
      const atMiddle = Math.abs(middleOf(from)) < 1e-9;
      // Past the top: to the middle if that stays short of it (and straight up from there), else onto the top terrace,
      // in the middle, or across from it when the leg starts there.
      const centre = next.to.e >= eTop && !atMiddle ? across(from, 0, 'turn') : null;
      if (centre && centre.to.e < eTop) {
        next = centre;
        zig = false;
      } else if (next.to.e >= eTop) {
        // Laid where the ground reaches the top's height.
        const w = atMiddle ? side * A : 0, zc = Math.max(ramp.zAt(eTop - clearance) - width, (from.z0 + from.z1) / 2 + width * 1.2);
        const to = turnAt('top', zc, w, from, riserAt(hr, gravity(from.e)));
        const rise = to.e - from.e;
        next = { to, leg: legBetween(from, to, stepsFor(rise, riserAt(hr, gravity(from.e + rise / 2)))) };
      } else if (!atMiddle && onwards.leg.tread >= tread * 1.1) {
        next = across(from, 0, 'turn');
        zig = false;
      }
    }
    legs.push(next!.leg);
    platforms.push(next!.to);
  }
  // Too narrow a ramp for the face's steepness: no stair at walking pitch fits on it.
  if (legs.some((l) => l.tread < TREAD_MIN * hr || l.riser <= 0)) return null;
  const top = platforms[platforms.length - 1], topLeg = legs[legs.length - 1];
  const climb: LiftStair = { kind: 'lift-stair', handrail: hr, width, parapet: PARAPET * hr, clearance, platforms, legs, top, topLeg, threshold: null };
  // The Threshold beside the top terrace, where nothing else of the stair's climb stands.
  const others: LiftStair = { ...climb, platforms: platforms.slice(0, -1) };
  const threshold = layThreshold({
    ramp, handrail: hr, width, parapet: climb.parapet, clearance, top, arrives: topLeg.from.w,
    riserAt: (e) => riserAt(hr, gravity(e)), rest, berthClear: BERTH_CLEAR * hr,
    free: (z0, z1, w0, w1) => {
      const n = Math.max(1, Math.ceil((z1 - z0) / hr)), m = Math.max(1, Math.ceil((w1 - w0) / hr));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
        const p: PlanPoint = [z0 + ((z1 - z0) * i) / n, w0 + ((w1 - w0) * j) / m];
        if (stairTopAt(others, p, climb.parapet) !== null) return false;
      }
      return true;
    },
  });
  if (!threshold) return climb;
  return {
    ...climb, threshold,
    platforms: [...platforms, ...threshold.galleries.flatMap((g) => g.bays)],
    legs: [...legs, ...threshold.flights],
  };
}

/** The capsule berth's clear radius (handrails): a capsule (about 3.4 × 2.2 m) and room to step round it. */
export const BERTH_CLEAR = 2.75;

/** A platform's middle across the ramp. */
const middleOf = (p: StairPlatform): number => (p.w0 + p.w1) / 2;

/**
 * Where a leg from platform a to platform b starts and ends. Straight up: from a's uphill edge to b's downhill edge.
 * Across the ramp: from a's side face to b's, the opening its slant cuts in the face kept within the face's upper half
 * on a (`margin` from its uphill corner) and its lower half on b, so the legs on one side lie one above the other and a
 * leg's uphill side never starts beyond the platform's uphill edge, where the slope would stand over its first steps.
 */
export function endsOf(a: StairPlatform, b: StairPlatform, width: number, margin = 0): { from: LegEnd; to: LegEnd } {
  const wa = middleOf(a), wb = middleOf(b);
  if (a.kind === 'forecourt' || Math.abs(wb - wa) <= width / 2) {
    const w = a.kind === 'forecourt' ? wb : wa;
    return { from: { z: a.z1, w, alongZ: false }, to: { z: b.z0, w, alongZ: false } };
  }
  const side = Math.sign(wb - wa), wFrom = side > 0 ? a.w1 : a.w0, wTo = side > 0 ? b.w0 : b.w1;
  // Half the opening along the face: half the width over the cosine of the leg's slant from the face's normal.
  let zFrom = (a.z0 + a.z1) / 2, zTo = (b.z0 + b.z1) / 2;
  for (let k = 0; k < 4; k++) {
    const open = (width / 2) * (Math.hypot(zTo - zFrom, wTo - wFrom) / Math.abs(wTo - wFrom));
    const place = (p: StairPlatform, upper: boolean): number => {
      const lo = p.z0 + open + margin, hi = p.z1 - open - margin, mid = (p.z0 + p.z1) / 2;
      if (lo > hi) return mid;
      return upper ? Math.max(mid, hi) : Math.min(mid, lo);
    };
    zFrom = place(a, true);
    zTo = place(b, false);
  }
  return { from: { z: zFrom, w: wFrom, alongZ: true }, to: { z: zTo, w: wTo, alongZ: true } };
}

/**
 * How much of a leg's middle line runs within the triangles where its square ends meet a platform's face (its
 * aprons, level with the platform): half its width times the tangent of its angle from the face's normal, each end.
 */
export function skew(ends: { from: LegEnd; to: LegEnd }, width: number): number {
  const dz = ends.to.z - ends.from.z, dw = ends.to.w - ends.from.w, run = Math.hypot(dz, dw) || 1;
  const apronOf = (e: LegEnd): number => {
    const normal = Math.abs(e.alongZ ? dw : dz) / run, tangent = Math.abs(e.alongZ ? dz : dw) / run;
    return normal > 1e-6 ? (width / 2) * (tangent / normal) : 0;
  };
  return apronOf(ends.from) + apronOf(ends.to);
}

/** A plan point: z along the axis, w across the ramp (m). */
export type PlanPoint = [number, number];

/** One step of a leg: from `a0` to `a1` along it (its tread, and the landing after it if it ends a flight), its top. */
export interface StairStep {
  a0: number;
  a1: number;
  top: number;
  /** Whether a landing follows it (the last step of a flight that is not the leg's last). */
  landing: boolean;
}

/** The level triangle where a leg's square end meets a platform's slanting face, and the side its wall stands on. */
export interface Apron {
  corners: [PlanPoint, PlanPoint, PlanPoint];
  e: number;
  /** The side (−1 or +1 across the leg) the triangle's long edge lies on, from `a0` to `a1` along the leg. */
  side: number;
  a0: number;
  a1: number;
}

/** A leg laid out in plan: its middle line, its steps, its aprons, and the line its parapets follow. */
export interface LegShape {
  leg: StairLeg;
  origin: PlanPoint;
  /** Unit direction along the leg, and to its left (+ side). */
  dir: PlanPoint;
  left: PlanPoint;
  run: number;
  steps: StairStep[];
  aprons: Apron[];
  /** Where the line under the nosings breaks (along, height): flat over aprons and landings, straight up each flight. */
  line: [number, number][];
}

/** A point `a` along a leg and `l` to its left, in plan. */
export const onLeg = (s: LegShape, a: number, l: number): PlanPoint => [s.origin[0] + s.dir[0] * a + s.left[0] * l, s.origin[1] + s.dir[1] * a + s.left[1] * l];

/** A plan point in a leg's terms: along it and to its left. */
export const intoLeg = (s: LegShape, p: PlanPoint): [number, number] => {
  const dz = p[0] - s.origin[0], dw = p[1] - s.origin[1];
  return [dz * s.dir[0] + dw * s.dir[1], dz * s.left[0] + dw * s.left[1]];
};

/** The height of a leg's nosing line at `a` along it (its parapets' tops are a handrail higher). */
export function lineAt(s: LegShape, a: number): number {
  const L = s.line;
  if (a <= L[0][0]) return L[0][1];
  for (let i = 1; i < L.length; i++) {
    if (a <= L[i][0]) {
      const [a0, e0] = L[i - 1], [a1, e1] = L[i];
      return a1 > a0 ? e0 + ((e1 - e0) * (a - a0)) / (a1 - a0) : e1;
    }
  }
  return L[L.length - 1][1];
}

/** Every leg of a stair, laid out (made once per stair). */
export const legShapesOf: (st: LiftStair) => LegShape[] = kept((st: LiftStair) => st.legs.map((l) => shapeLeg(l)));

function shapeLeg(leg: StairLeg): LegShape {
  const dz = leg.to.z - leg.from.z, dw = leg.to.w - leg.from.w, run = Math.hypot(dz, dw);
  const dir: PlanPoint = [dz / run, dw / run], left: PlanPoint = [-dir[1], dir[0]], half = leg.width / 2;
  // Where each side of the leg crosses a platform's face, along the leg from the end's middle.
  const crossing = (end: LegEnd, side: number): number => {
    const k = end.alongZ ? 1 : 0, d = dir[k];
    return Math.abs(d) < 1e-9 ? 0 : -(left[k] * side * half) / d;
  };
  const start = [-1, 1].map((sd) => crossing(leg.from, sd)), end = [-1, 1].map((sd) => run + crossing(leg.to, sd));
  const a0 = Math.max(...start), a1 = Math.min(...end);
  const origin: PlanPoint = [leg.from.z, leg.from.w];
  const shape: LegShape = { leg, origin, dir, left, run, steps: [], aprons: [], line: [] };
  const point = (a: number, l: number): PlanPoint => onLeg(shape, a, l);
  if (a0 > 1e-6) {
    const side = start[0] < start[1] ? -1 : 1, lo = Math.min(...start);
    shape.aprons.push({ corners: [point(lo, side * half), point(a0, -side * half), point(a0, side * half)], e: leg.e0, side, a0: lo, a1: a0 });
  }
  if (run - a1 > 1e-6) {
    const side = end[0] > end[1] ? -1 : 1, hi = Math.max(...end);
    shape.aprons.push({ corners: [point(a1, side * half), point(a1, -side * half), point(hi, side * half)], e: leg.e1, side, a0: a1, a1: hi });
  }
  let a = a0;
  shape.line.push([Math.min(0, ...start), leg.e0], [a0, leg.e0]);
  for (let k = 0; k < leg.steps; k++) {
    const landing = k % leg.flight === leg.flight - 1 && k < leg.steps - 1;
    const step: StairStep = { a0: a, a1: a + leg.tread + (landing ? leg.rest : 0), top: leg.e0 + (k + 1) * leg.riser, landing };
    shape.steps.push(step);
    // Each flight's line from the foot of its first riser to its last step's nosing, then level.
    if (landing || k === leg.steps - 1) shape.line.push([step.a0, step.top], [step.a1, step.top]);
    else if (k % leg.flight === 0) shape.line.push([step.a0, step.top - leg.riser]);
    a = step.a1;
  }
  shape.line.push([Math.max(run, ...end), leg.e1]);
  return shape;
}

/** Whether a plan point lies within a convex polygon's corners (either winding). */
function inside(p: PlanPoint, poly: readonly PlanPoint[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/**
 * The top of the stair over a plan point (its height e), or null where it does not stand: a platform's floor, a step's
 * tread, an apron, or a parapet's top. `margin` widens every footprint by that much (m) and reports the floor under it.
 */
export function stairTopAt(st: LiftStair, p: PlanPoint, margin = 0): number | null {
  let best: number | null = null;
  const higher = (e: number): void => { if (best === null || e > best) best = e; };
  // Only the platforms and legs whose span along the axis holds the point (all of them for a widened footprint).
  const index = margin === 0 ? reachesOf(st) : null;
  if (index && (p[0] < index.z0 || p[0] > index.z1 || p[1] < index.w0 || p[1] > index.w1)) return null;
  const bin = index ? Math.min(index.bins - 1, Math.floor((p[0] - index.z0) / index.size)) : 0;
  const platforms = index ? index.platforms[bin] : st.platforms;
  const legs = index ? index.legs[bin] : legShapesOf(st);
  for (const q of platforms) {
    if (p[0] < q.z0 - margin || p[0] > q.z1 + margin || p[1] < q.w0 - margin || p[1] > q.w1 + margin) continue;
    higher(q.e + (margin === 0 && onParapet(st, q, p) ? st.handrail : 0));
  }
  for (const s of legs) {
    const [a, l] = intoLeg(s, p), half = s.leg.width / 2;
    if (Math.abs(l) > half + margin || a < -half - margin || a > s.run + half + margin) continue;
    const rim = Math.abs(l) > half - st.parapet && margin === 0;
    for (const ap of s.aprons) if (inside(p, ap.corners) || (margin > 0 && a >= ap.a0 - margin && a <= ap.a1 + margin)) higher(ap.e + (rim ? st.handrail : 0));
    if (a < s.steps[0].a0 - margin || a > s.steps[s.steps.length - 1].a1 + margin) continue;
    if (rim) { higher(lineAt(s, a) + st.handrail); continue; }
    // The step under it: the last one starting at or before it.
    let lo = 0, hi = s.steps.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s.steps[m].a0 <= a) lo = m; else hi = m - 1; }
    higher(s.steps[lo].top);
  }
  return best;
}

/** A platform's edges: its downhill and uphill ends (along w) and its sides (along z). */
export type PlatformEdge = 'z0' | 'z1' | 'w0' | 'w1';

/**
 * Where a platform's edges stand open, without a parapet: intervals along each edge (w along an end, z along a side)
 * where a leg meets it, where a leg's side runs along it, and where another platform as high or higher stands against
 * it (a gallery's bays, a gallery against the wall of the one above).
 */
export function openingsOf(st: LiftStair, q: StairPlatform): Record<PlatformEdge, [number, number][]> {
  const made = openings(st);
  let out = made.get(q);
  if (!out) { out = openEdges(st, q); made.set(q, out); }
  return out;
}

const openings = kept((_st: LiftStair) => new Map<StairPlatform, Record<PlatformEdge, [number, number][]>>());

function openEdges(st: LiftStair, q: StairPlatform): Record<PlatformEdge, [number, number][]> {
  const out: Record<PlatformEdge, [number, number][]> = { z0: [], z1: [], w0: [], w1: [] };
  const eps = 1e-6, near = (a: number, b: number): boolean => Math.abs(a - b) < eps;
  /** Opens [a, b] of an edge, where it overlaps the edge's span by more than nothing. */
  const open = (key: PlatformEdge, a: number, b: number): void => {
    const [lo, hi] = key === 'z0' || key === 'z1' ? [q.w0, q.w1] : [q.z0, q.z1], x = Math.max(lo, Math.min(a, b)), y = Math.min(hi, Math.max(a, b));
    if (y - x > eps) out[key].push([x, y]);
  };
  for (const s of legShapesOf(st)) {
    const half = s.leg.width / 2;
    for (const [end, a] of [[s.leg.from, 0], [s.leg.to, s.run]] as const) {
      // On the line of one of its edges (`open` keeps what of the leg's end lies along the edge itself).
      const onIt = end.alongZ ? near(end.w, q.w0) || near(end.w, q.w1) : near(end.z, q.z0) || near(end.z, q.z1);
      if (!onIt) continue;
      // Where the leg's two sides cross the face, on the coordinate along it.
      const k = end.alongZ ? 1 : 0, key: PlatformEdge = end.alongZ ? (near(end.w, q.w0) ? 'w0' : 'w1') : near(end.z, q.z0) ? 'z0' : 'z1';
      const xs = [-1, 1].map((sd) => {
        const c = Math.abs(s.dir[k]) > 1e-9 ? a - (s.left[k] * sd * half) / s.dir[k] : a;
        return onLeg(s, c, sd * half)[1 - k];
      });
      open(key, Math.min(...xs), Math.max(...xs));
    }
    // A leg straight along the axis whose side runs along one of the platform's sides.
    if (Math.abs(s.dir[1]) < eps) {
      const za = Math.min(s.leg.from.z, s.leg.to.z), zb = Math.max(s.leg.from.z, s.leg.to.z);
      for (const sd of [-1, 1]) {
        const w = s.origin[1] + sd * half;
        if (near(w, q.w0)) open('w0', za, zb);
        if (near(w, q.w1)) open('w1', za, zb);
      }
    }
  }
  for (const r of st.platforms) {
    if (r === q || r.e < q.e - eps) continue;
    if (near(r.z1, q.z0)) open('z0', r.w0, r.w1);
    if (near(r.z0, q.z1)) open('z1', r.w0, r.w1);
    if (near(r.w1, q.w0)) open('w0', r.z0, r.z1);
    if (near(r.w0, q.w1)) open('w1', r.z0, r.z1);
  }
  return out;
}

/** Whether a plan point on a platform is on its parapet: within the parapet's thickness of an edge not open there. */
function onParapet(st: LiftStair, q: StairPlatform, p: PlanPoint): boolean {
  const t = st.parapet, near: [PlatformEdge, boolean, number][] = [
    ['z0', p[0] < q.z0 + t, p[1]], ['z1', p[0] > q.z1 - t, p[1]], ['w0', p[1] < q.w0 + t, p[0]], ['w1', p[1] > q.w1 - t, p[0]],
  ];
  for (const [key, close, x] of near) if (close && !openingsOf(st, q)[key].some(([a, b]) => x >= a && x <= b)) return true;
  return false;
}

/**
 * Which platforms and legs reach each stretch of the axis (bins along z), and the box in plan the stair stands in:
 * `stairTopAt` looks only at the few over a point, not at every one (made once).
 */
const reachesOf = kept((st: LiftStair) => {
  const spans: { z0: number; z1: number; w0: number; w1: number; top: number }[] = [
    ...st.platforms.map((q) => ({ z0: q.z0, z1: q.z1, w0: q.w0, w1: q.w1, top: q.e + st.handrail })),
    // A leg's footprint lies within its width of the line between its ends; nothing on it stands above its high end's
    // parapet.
    ...legShapesOf(st).map((l) => ({
      z0: Math.min(l.leg.from.z, l.leg.to.z) - l.leg.width, z1: Math.max(l.leg.from.z, l.leg.to.z) + l.leg.width,
      w0: Math.min(l.leg.from.w, l.leg.to.w) - l.leg.width, w1: Math.max(l.leg.from.w, l.leg.to.w) + l.leg.width,
      top: Math.max(l.leg.e0, l.leg.e1, ...l.aprons.map((a) => a.e), ...l.steps.map((x) => x.top)) + st.handrail,
    })),
  ];
  const z0 = Math.min(...spans.map((b) => b.z0)), z1 = Math.max(...spans.map((b) => b.z1));
  const bins = Math.max(1, st.legs.length * 2), size = Math.max(1e-6, (z1 - z0) / bins);
  const platforms: StairPlatform[][] = Array.from({ length: bins }, () => []), legs: LegShape[][] = Array.from({ length: bins }, () => []);
  // Each bin's reach across the ramp and its highest top.
  const across = Array.from({ length: bins }, () => ({ w0: Infinity, w1: -Infinity, top: -Infinity }));
  const shapes = legShapesOf(st);
  spans.forEach((b, i) => {
    const from = Math.max(0, Math.floor((b.z0 - z0) / size)), to = Math.min(bins - 1, Math.floor((b.z1 - z0) / size));
    for (let k = from; k <= to; k++) {
      if (i < st.platforms.length) platforms[k].push(st.platforms[i]); else legs[k].push(shapes[i - st.platforms.length]);
      const a = across[k];
      a.w0 = Math.min(a.w0, b.w0); a.w1 = Math.max(a.w1, b.w1); a.top = Math.max(a.top, b.top);
    }
  });
  return { z0, z1, w0: Math.min(...spans.map((b) => b.w0)), w1: Math.max(...spans.map((b) => b.w1)), bins, size, platforms, legs, across };
});

/** A stair's reach over the profile and across the ramp, for quick tests: its rows' s, and how high it stands (made once). */
const boundsOf = kept((h: Habitat) => {
  const st = liftStairOf(h)!, ramp = rampOf(h);
  const tall = Math.max(...st.platforms.map((q) => q.e - ramp.groundAt(q.z0)), ...legShapesOf(st).map((s) => Math.max(s.leg.e0, s.leg.e1) - ramp.groundAt(Math.min(s.leg.from.z, s.leg.to.z)))) + st.handrail;
  return { s0: ramp.sOf(st.platforms[0].z0), s1: ramp.sOf(Math.max(...st.platforms.map((q) => q.z1))), tall };
});

/** Whether plants keep off a point (θ, s) of the land: under the stair, or within `margin` (m) of it. */
export function stairKeepsClear(h: Habitat, theta: number, s: number, margin: number): boolean {
  const st = liftStairOf(h);
  if (!st) return false;
  const b = boundsOf(h), ramp = rampOf(h);
  if (s < b.s0 - margin || s > b.s1 + margin) return false;
  const p = ramp.plan(toWorld(h.profile, { theta, s, h: 0 }));
  if (Math.abs(p.w) > ramp.halfWidth + margin) return false;
  return stairTopAt(st, [p.z, p.w], margin) !== null;
}

/**
 * The height over the profile at (θ, s) where one stands on the stair, or null where the line out from the ground
 * there never comes out of the stair's top: up the profile's normal, from the ground, to where it first leaves the
 * stair through a tread, a floor or a parapet's top.
 */
export function stairStandAt(h: Habitat, theta: number, s: number): number | null {
  const st = liftStairOf(h);
  if (!st) return null;
  const b = boundsOf(h), ramp = rampOf(h);
  if (s < b.s0 - b.tall * 4 || s > b.s1 + b.tall) return null;
  if (Math.abs(ramp.plan(toWorld(h.profile, { theta, s, h: 0 })).w) > ramp.halfWidth + b.tall) return null;
  const index = reachesOf(st);
  return standThrough(h, theta, s, 0, b.tall * 4, st.handrail / 4, (p) => {
    const q = ramp.plan(p), top = stairTopAt(st, [q.z, q.w]);
    return top === null ? null : top - q.e;
  }, (pa, pb) => {
    // Clear where every bin the stretch passes has nothing across where it goes, or nothing as high (the stretch is
    // nearly straight in plan: half its length in slack covers its bend).
    const a = ramp.plan(pa), c = ramp.plan(pb);
    const slack = Math.max(Math.abs(c.z - a.z), Math.abs(c.w - a.w), Math.abs(c.e - a.e)) / 2 + st.handrail;
    const za = Math.min(a.z, c.z) - slack, zb = Math.max(a.z, c.z) + slack;
    if (zb < index.z0 || za > index.z1) return true;
    const wa = Math.min(a.w, c.w) - slack, wb = Math.max(a.w, c.w) + slack, low = Math.min(a.e, c.e) - slack;
    const from = Math.max(0, Math.floor((za - index.z0) / index.size)), to = Math.min(index.bins - 1, Math.floor((zb - index.z0) / index.size));
    for (let k = from; k <= to; k++) {
      const x = index.across[k];
      if (wb >= x.w0 && wa <= x.w1 && low <= x.top) return false;
    }
    return true;
  });
}
