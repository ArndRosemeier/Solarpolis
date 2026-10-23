/**
 * How a transport capsule flies (gen/capsules.ts is the pod): from one pad to another, planned once by the pod's mind
 * as the quickest way its passenger finds comfortable, then followed to the second. Nobody steers it. Pure.
 *
 * The way: straight up off the pad over the crowns, across, and straight down onto the other pad. Across, the mind
 * chooses how near the axis to climb (`HabitatParams.life.caps`): a short hop or a trip along the axis stays low over
 * the land, but a trip far round the cylinder climbs toward the axis, where the circle round it is short and the spin's
 * weight fades, swings past the sunline at a distance and comes down on the far side. It keeps over the ground and the
 * built things by `over` m and the climate's tallest crowns, and off the axis by `axis` radii (except near a pad that is
 * nearer the axis than that, the arrival terrace by the hub).
 *
 * Its speed along the way: at most `cruise`, `climb` near the pads, no faster round a bend than `turn` allows, and never
 * so fast that what the passenger feels passes `comfort` times the floor's gravity: flying spinward along the floor one
 * goes round faster than the floor does and weighs more ((ωr + v)²/r, world/motion.ts `feltGravity`), against the spin
 * less. It speeds up and slows down by at most `accel`, and eases into every change of that over `ease` s (`eased`).
 *
 * What the passenger feels is the turning frame's apparent acceleration (centrifugal and Coriolis) less the pod's own
 * acceleration along its way (`flightAt`): the pod's floor banks into it, as a fan-lifted craft must (its thrust is
 * along its up), by at most `tilt` from true up. Pitching nose down to speed up, banking into a bend, leaning sideways
 * as the Coriolis force pushes on a climb toward the axis: all from the same sum.
 */
import { smoothstep, v3cross, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { apart, fromWorld, toWorld, type Habitat } from '../blueprint';
import { tallestCrown, type CapPad } from '../gen/capsules';
import { landmarkTopAt } from '../gen/landmarks';
import type { Place } from '../gen/shapes';
import type { Terrain } from '../gen/terrain';
import { apparentAcceleration, upAt } from './motion';

/** A planned flight: its way sampled evenly, the time (s) and speed (m/s) at each sample, the way it faces over the floor there. */
export interface Flight {
  /** World points, 3 floats each. */
  points: Float64Array;
  times: Float64Array;
  speeds: Float64Array;
  /** Forward over the floor at each sample (unit, 3 floats each). */
  headings: Float64Array;
  seconds: number;
  /** The way's length (m), the nearest it comes to the axis (m), and the most the passenger feels on it (m/s²). */
  length: number;
  nearest: number;
  heaviest: number;
  from: Place;
  to: Place;
}

/** Where a flight starts and ends: on a pad (parked) or hovering in the air (a called pod coming in, an empty one leaving). */
export interface FlightEnds {
  from: Place;
  to: Place;
  airborneStart?: boolean;
  airborneEnd?: boolean;
}

/** The pod at a moment of its flight: its frame (banked), its velocity, what its passenger feels (m/s², "down") and how much. */
export interface FlightState {
  place: Place;
  velocity: Vec3;
  felt: Vec3;
  weight: number;
  /** Share of the flight's time gone (0 … 1). */
  share: number;
}

/** Samples along the way across, and across before the flight's speeds are worked out (choosing how high to go). */
const ACROSS = 360;
const ROUGH = 96;
/** How many heights across the mind weighs, from the lowest to as near the axis as allowed. */
const HEIGHTS = 6;
/** The way is resampled every this many m (at least), at most this many samples. */
const STEP = 2;
const MOST = 3000;
/**
 * Speeds and accelerations are read over this much time either side of a moment (s), and over at least `SPAN_STEPS`
 * samples of the way when it goes slowly, so the pod's bank is smooth.
 */
const SPAN = 1;
const SPAN_STEPS = 3;
/**
 * Off a pad the pod goes straight up this share of the climb's height (clear of the crowns beside it), then curves onto
 * the way across, which it meets this many times the climb's height along it.
 */
const STRAIGHT = 0.6;
const CORNER = 4;
/** Below this speed over the floor (m/s along the way) the pod turns from the pad's heading to its way's. */
const TURNING = 0.25;
/** The quickest the pod turns about its up over a pad (rad/s): it turns gently, never swings round. */
const YAW = 0.2;
/** How much of the floor's weight the fans hold the pod toward level with, beyond what its passenger feels. */
const LEVEL = 0.3;

const cyl = (p: Vec3): { theta: number; z: number; rho: number } => ({ theta: Math.atan2(p[1], p[0]), z: p[2], rho: Math.hypot(p[0], p[1]) });
const fromCyl = (theta: number, z: number, rho: number): Vec3 => [rho * Math.cos(theta), rho * Math.sin(theta), z];
const madd = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const at3 = (a: Float64Array, i: number): Vec3 => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];

/** How high over the ground and the crowns a pod cruises (m), and so how high it climbs off a pad. */
export const cruiseClear = (h: Habitat): number => h.params.life.caps.over + tallestCrown(h);

/**
 * Plan a flight between two ends over a terrain: the quickest of `HEIGHTS` ways across (from as low as the ends allow to
 * as near the axis as `axis` lets it), kept over the land and off the axis, then its speeds and times.
 */
export function planFlight(t: Terrain, ends: FlightEnds): Flight {
  const h = t.habitat, caps = h.params.life.caps, rise = cruiseClear(h);
  const A0 = ends.from.at, A1 = ends.airborneStart ? A0 : madd(A0, ends.from.ez, rise);
  const B0 = ends.to.at, B1 = ends.airborneEnd ? B0 : madd(B0, ends.to.ez, rise);
  const rhoMin = caps.axis * h.radius, top = Math.min(cyl(A1).rho, cyl(B1).rho);
  // Weigh the heights on a rough way first (no ground kept to, a few samples), then build the chosen one in full.
  let best = top, quickest = Infinity;
  for (let k = 0; k < HEIGHTS && top > rhoMin; k++) {
    const rho = top - ((top - rhoMin) * k) / (HEIGHTS - 1);
    const rough = acrossAt(A1, B1, rho, ROUGH), seconds = timed(h, rough, ends, rise, false).seconds;
    if (seconds < quickest) { quickest = seconds; best = rho; }
  }
  const across = overTheLand(t, acrossAt(A1, B1, best, ACROSS), rise, rhoMin, (caps.cruise * caps.ease) / 2);
  // Straight up off the pad to most of the climb's height, then one long smooth curve onto the way across, leaving
  // the column straight up and meeting the way along it (no corner where the two join), and so down onto the other.
  const column = (a: Vec3, b: Vec3): Vec3[] => { const n = Math.max(1, Math.ceil(apart(a, b) / STEP)); return Array.from({ length: n }, (_, i) => madd(a, v3sub(b, a), i / n)); };
  // From the top of a pad's straight column (leaving it along `up`) to a point of the way across (arriving along its
  // way), each end's pull as long as the curve, so it bends gently all along.
  const curve = (a: Vec3, up: Vec3, b: Vec3, along: Vec3): Vec3[] => {
    const L = apart(a, b), n = Math.max(2, Math.ceil((1.5 * L) / STEP));
    return Array.from({ length: n }, (_, k) => cubic(a, v3scale(up, L), b, v3scale(along, L), k / n));
  };
  const runs = [0];
  for (let i = 1; i < across.length; i++) runs.push(runs[i - 1] + apart(across[i - 1], across[i]));
  const len = runs[runs.length - 1], reach = Math.min(rise * CORNER, len / 3), last = across.length - 1;
  const tangentAt = (i: number): Vec3 => v3norm(v3sub(across[Math.min(last, i + 1)], across[Math.max(0, i - 1)]));
  let e0 = 0, e1 = last;
  if (!ends.airborneStart) while (e0 < last - 2 && runs[e0] < reach) e0++;
  if (!ends.airborneEnd) while (e1 > e0 + 2 && len - runs[e1] < reach) e1--;
  const way: Vec3[] = [];
  if (!ends.airborneStart) {
    const S = madd(A0, ends.from.ez, rise * STRAIGHT);
    way.push(...column(A0, S), ...curve(S, ends.from.ez, across[e0], tangentAt(e0)));
  }
  way.push(...across.slice(e0, e1 + 1));
  if (!ends.airborneEnd) {
    // The same curve as off a pad, flown the other way.
    const T = madd(B0, ends.to.ez, rise * STRAIGHT), back = curve(T, ends.to.ez, across[e1], v3scale(tangentAt(e1), -1)).reverse();
    way.push(...back.slice(0, -1), ...column(T, B0), B0);
  }
  return timed(h, resample(way), ends, rise, true);
}

/**
 * The way across from A to B (`n` + 1 points) climbing to `rho` from the axis: round the axis and along it evenly,
 * and toward the axis as soon as it is off the pad's column, staying there most of the way.
 */
function acrossAt(A: Vec3, B: Vec3, rho: number, n: number): Vec3[] {
  const a = cyl(A), b = cyl(B);
  let turn = b.theta - a.theta;
  turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, base = a.rho + (b.rho - a.rho) * u, dip = Math.max(0, base - rho) * smoothstep(0, 0.3, u) * smoothstep(0, 0.3, 1 - u);
    out.push(fromCyl(a.theta + turn * u, a.z + (b.z - a.z) * u, base - dip));
  }
  return out;
}

/** The point halfway between a point and the middle of its neighbours (one pass of smoothing). */
const smoothed = (w: readonly Vec3[], i: number): Vec3 => [0, 1, 2].map((k) => 0.5 * w[i][k] + 0.25 * (w[i - 1][k] + w[i + 1][k])) as Vec3;

/**
 * Keep a way across over the land (the ground, the water, anything built: `rise` m over it) and off the axis (`rhoMin`,
 * or as near as an end lies plus how far it has come from it), smoothing between; its ends stay where they are. It
 * rises over the land as a smooth swell over `swell` m (about what the pod goes at cruise while it eases into a change).
 */
function overTheLand(t: Terrain, way: Vec3[], rise: number, rhoMin: number, swell: number): Vec3[] {
  const h = t.habitat, { profile } = h, n = way.length - 1, ra = cyl(way[0]).rho, rb = cyl(way[n]).rho;
  let length = 0;
  for (let i = 1; i <= n; i++) length += apart(way[i - 1], way[i]);
  const keep = (i: number): void => {
    let p = way[i];
    const q = fromWorld(profile, ...p), ground = t.standAt(q.theta, q.s);
    // Built things stand no more than a few tens of metres over the ground: only look for them near it.
    const built = q.h < ground + rise + 60 ? landmarkTopAt(t, q.theta, q.s) : null, under = Math.max(ground, built ?? -Infinity);
    if (q.h < under + rise) p = toWorld(profile, { theta: q.theta, s: q.s, h: under + rise });
    const lo = Math.min(rhoMin, ra + (length * i) / n, rb + (length * (n - i)) / n), c = cyl(p);
    if (c.rho < lo) p = fromCyl(c.theta, c.z, lo);
    way[i] = p;
  };
  // Over hills and valleys in one long, smooth swell, not following each bump (a bump taken at speed is a lurch): how
  // much each point must rise, as an envelope that never dips under it, over about `swell` m either way.
  const need = new Float64Array(n + 1), ups: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = way[i], q = fromWorld(profile, ...p), ground = t.standAt(q.theta, q.s);
    const built = q.h < ground + rise + 60 ? landmarkTopAt(t, q.theta, q.s) : null, under = Math.max(ground, built ?? -Infinity);
    need[i] = i === 0 || i === n ? 0 : Math.max(0, under + rise - q.h);
    ups.push(upAt(p) ?? [0, 0, 0]);
  }
  // Shorter toward the ends, which stay where they are (over the pads).
  const far = Math.max(1, Math.round(swell / Math.max(1e-6, length / n))), reach = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) reach[i] = Math.max(0, Math.min(far, Math.floor((Math.min(i, n - i) - 1) / 3)));
  const raised = envelope(need, reach, 1);
  for (let i = 1; i < n; i++) way[i] = madd(way[i], ups[i], raised[i]);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < n; i++) keep(i);
    for (let k = 0; k < 6; k++) for (let i = 1; i < n; i++) way[i] = smoothed(way, i);
  }
  for (let i = 1; i < n; i++) keep(i);
  return way;
}

/** The cubic from a (leaving it along da) to b (arriving along db), at a share f of the way (Hermite). */
function cubic(a: Vec3, da: Vec3, b: Vec3, db: Vec3, f: number): Vec3 {
  const f2 = f * f, f3 = f2 * f;
  return madd(madd(madd(v3scale(a, 2 * f3 - 3 * f2 + 1), da, f3 - 2 * f2 + f), b, -2 * f3 + 3 * f2), db, f3 - f2);
}

/** A polyline resampled evenly by its length (every `STEP` m or more, at most `MOST` samples), as a smooth curve through its points. */
function resample(way: readonly Vec3[]): Vec3[] {
  const run = [0];
  for (let i = 1; i < way.length; i++) run.push(run[i - 1] + apart(way[i - 1], way[i]));
  const total = run[run.length - 1], n = Math.max(2, Math.min(MOST, Math.ceil(total / STEP)));
  const out: Vec3[] = [];
  for (let k = 0, j = 0; k <= n; k++) {
    const d = (total * k) / n;
    while (j < way.length - 2 && run[j + 1] < d) j++;
    const seg = run[j + 1] - run[j], f = Math.min(1, Math.max(0, seg > 0 ? (d - run[j]) / seg : 0));
    // A cubic through the points, its slope at each from its neighbours, so the way bends smoothly between them and
    // has no corner at any (a corner, however slight, is a jolt at speed).
    const slope = (i: number): Vec3 => {
      const a = Math.max(0, i - 1), b = Math.min(way.length - 1, i + 1), span = run[b] - run[a];
      return span > 0 ? v3scale(v3sub(way[b], way[a]), seg / span) : [0, 0, 0];
    };
    out.push(cubic(way[j], slope(j), way[j + 1], slope(j + 1), f));
  }
  return out;
}

/**
 * The speeds and times along an evenly sampled way: each sample's top speed (cruise, the climb near a pad, the bend,
 * the passenger's comfort), then no more speeding up or slowing down than `accel` allows, from rest to rest.
 */
function timed(h: Habitat, way: readonly Vec3[], ends: FlightEnds, rise: number, full: boolean): Flight {
  const caps = h.params.life.caps, n = way.length - 1, heaviest = caps.comfort * h.gravityAt(h.radius);
  const run = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) run[i] = run[i - 1] + apart(way[i - 1], way[i]);
  const total = run[n], v = new Float64Array(n + 1);
  let felt = 0;
  for (let i = 0; i <= n; i++) {
    const p = way[i], prev = way[Math.max(0, i - 1)], next = way[Math.min(n, i + 1)];
    const ds = Math.max(1e-6, (run[Math.min(n, i + 1)] - run[Math.max(0, i - 1)]) / 2);
    const tangent = v3norm(v3sub(next, prev)), bend: Vec3 = i > 0 && i < n ? [0, 1, 2].map((k) => (next[k] - 2 * p[k] + prev[k]) / (ds * ds)) as Vec3 : [0, 0, 0];
    let top = caps.cruise;
    // Near a pad, the climb; above it the cruise, by the time it is well over the crowns.
    for (const [grounded, d] of [[!ends.airborneStart, run[i]], [!ends.airborneEnd, total - run[i]]] as const) {
      if (grounded) top = Math.min(top, caps.climb + (caps.cruise - caps.climb) * smoothstep(0.7 * rise, 1.6 * rise, d));
    }
    const k = Math.hypot(...bend);
    if (k > 1e-9) top = Math.min(top, Math.sqrt(caps.turn / k));
    // What the passenger feels at speed u along here: the turning frame's push less the bend's pull.
    const feels = (u: number): number => Math.hypot(...v3sub(apparentAcceleration(h, p, [tangent[0] * u, tangent[1] * u, tangent[2] * u]), [bend[0] * u * u, bend[1] * u * u, bend[2] * u * u]));
    if (feels(top) > heaviest) {
      let lo = 0, hi = top;
      for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (feels(mid) > heaviest) hi = mid; else lo = mid; }
      top = lo;
    }
    v[i] = top;
    felt = Math.max(felt, feels(top));
  }
  // From rest and to rest gently: the push builds up over `ease` (at most accel/ease m/s³ more each second), so going
  // `d` m from rest it is no faster than that jerk allows (v = j t²/2 after d = j t³/6).
  const jerk = caps.accel / caps.ease, fromRest = (d: number): number => (jerk / 2) * Math.pow((6 * Math.max(0, d)) / jerk, 2 / 3);
  for (let i = 0; i <= n; i++) v[i] = Math.min(v[i], fromRest(run[i]), fromRest(total - run[i]));
  for (let i = 0; i < n; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] * v[i] + 2 * caps.accel * (run[i + 1] - run[i])));
  for (let i = n; i > 0; i--) v[i - 1] = Math.min(v[i - 1], Math.sqrt(v[i] * v[i] + 2 * caps.accel * (run[i] - run[i - 1])));
  eased(v, run, caps.ease);
  const times = new Float64Array(n + 1);
  // Off rest and onto it the push builds up evenly (the way goes as the time cubed, positionAt): that takes three
  // times the distance over the end's speed; elsewhere the speed changes evenly.
  for (let i = 0; i < n; i++) {
    const ds = run[i + 1] - run[i], still = v[i] === 0 || v[i + 1] === 0;
    times[i + 1] = times[i] + (still ? (3 * ds) / Math.max(1e-3, v[i] + v[i + 1]) : ds / Math.max(1e-3, (v[i] + v[i + 1]) / 2));
  }
  const points = new Float64Array(3 * (n + 1));
  let nearest = Infinity;
  way.forEach((p, i) => { points.set(p, 3 * i); nearest = Math.min(nearest, Math.hypot(p[0], p[1])); });
  return {
    points, times, speeds: v, headings: full ? headingsOf(way, ends, times) : new Float64Array(0), seconds: times[n],
    length: total, nearest, heaviest: felt, from: ends.from, to: ends.to,
  };
}

/**
 * Ease every change of the pod's acceleration in over about `ease` s, so it never lurches from speeding up to slowing
 * down (or into a bend's slowing) at once: the squared speed, whose slope along the way is the acceleration, is taken
 * as the least within twice the reach and then averaged twice over the reach, the reach being the way the pod goes in
 * half `ease` there. That keeps it under every limit it had (the average of what is no faster than anywhere near is no
 * faster than here) and its slope under the acceleration's; a last minimum with the limits catches what the reach's
 * changing from place to place lets through. Both ends stay at rest. In place.
 */
function eased(v: Float64Array, run: Float64Array, ease: number): void {
  const n = v.length - 1, total = run[n];
  if (n < 4 || total <= 0) return;
  const ds = total / n, sq = Float64Array.from(v, (u) => u * u), reach = new Int32Array(n + 1);
  // The reach in samples, short enough near the ends that the least never takes the ends' rest.
  for (let i = 0; i <= n; i++) reach[i] = Math.max(0, Math.min(Math.round((ease * v[i]) / 2 / ds), Math.floor((Math.min(i, n - i) - 1) / 3)));
  const cur = envelope(sq, reach, -1);
  for (let i = 0; i <= n; i++) v[i] = Math.min(v[i], Math.sqrt(cur[i]));
}

/**
 * A smooth envelope of values (samples evenly spaced) that never crosses them: over them (`side` 1) or under them (−1).
 * Each is taken as the most (or least) within twice its reach, then averaged twice over its reach (the average of what
 * is over everything near is over what is here). Its slope is never steeper than theirs.
 */
function envelope(values: Float64Array, reach: Int32Array, side: 1 | -1): Float64Array {
  const n = values.length - 1;
  let cur = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    let m = values[i];
    for (let k = Math.max(0, i - 2 * reach[i]); k <= Math.min(n, i + 2 * reach[i]); k++) m = side > 0 ? Math.max(m, values[k]) : Math.min(m, values[k]);
    cur[i] = m;
  }
  for (let pass = 0; pass < 2; pass++) {
    const sum = new Float64Array(n + 2), next = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) sum[i + 1] = sum[i] + cur[i];
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - reach[i]), b = Math.min(n, i + reach[i]);
      next[i] = (sum[b + 1] - sum[a]) / (b - a + 1);
    }
    cur = next;
  }
  return cur;
}

/**
 * Which way the pod faces over the floor along its way: along the way where it moves over the floor; going straight up
 * off a pad (or down onto one), turning from the pad's heading to the way's as it climbs, evenly in time.
 */
function headingsOf(way: readonly Vec3[], ends: FlightEnds, times: Float64Array): Float64Array {
  const n = way.length - 1, out = new Float64Array(3 * (n + 1)), known: boolean[] = [];
  for (let i = 0; i <= n; i++) {
    const tangent = v3norm(v3sub(way[Math.min(n, i + 1)], way[Math.max(0, i - 1)])), up = upAt(way[i]) ?? ends.from.ez;
    const flat = madd(tangent, up, -v3dot(tangent, up)), k = Math.hypot(...flat);
    known.push(k > TURNING);
    if (k > TURNING) out.set(v3norm(flat), 3 * i);
  }
  const first = known.indexOf(true), last = known.lastIndexOf(true);
  if (first < 0) {
    for (let i = 0; i <= n; i++) out.set(ends.from.ex, 3 * i);
    return out;
  }
  for (let i = first + 1; i < last; i++) if (!known[i]) out.set(at3(out, i - 1), 3 * i);
  for (let i = 0; i < first; i++) out.set(at3(out, first), 3 * i);
  for (let i = n; i > last; i--) out.set(at3(out, last), 3 * i);
  // Turning from a pad's heading to the way's (and at the end back to the pad's) gently in time: over the climb (or
  // the descent), longer where the turn is large, at most YAW rad/s at its quickest. Round its up (a half turn too).
  const T = times[n];
  const turn = (pad: Place, from: number, ease: (i: number) => number, inside: (i: number) => boolean): void => {
    const way0 = at3(out, from), angle = Math.atan2(Math.hypot(...v3cross(pad.ex, way0)), v3dot(pad.ex, way0));
    const over = Math.max(1e-6, ease(from), (1.5 * angle) / YAW);
    for (let i = 0; i <= n; i++) if (inside(i) && ease(i) < over) out.set(rotateToward(pad.ex, at3(out, i), pad.ez, smoothstep(0, 1, ease(i) / over)), 3 * i);
  };
  turn(ends.from, first, (i) => times[i], () => true);
  turn(ends.to, last, (i) => T - times[i], () => true);
  return out;
}

/** a turned toward b by a share w of the angle between them, round `up` when they point opposite ways (unit vectors). */
function rotateToward(a: Vec3, b: Vec3, up: Vec3, w: number): Vec3 {
  const c = v3dot(a, b);
  let side = madd(b, a, -c), k = Math.hypot(...side);
  const th = Math.atan2(k, c) * w;
  if (k < 1e-6) {
    if (c > 0) return a;
    side = v3cross(up, a);
    k = Math.hypot(...side);
    if (k < 1e-9) return a;
  }
  return v3norm(madd(v3scale(a, Math.cos(th)), side, Math.sin(th) / k));
}

/** Where along its way the pod is at time t (world), and which sample it is past. */
function positionAt(f: Flight, t: number): { p: Vec3; i: number } {
  const n = f.times.length - 1;
  if (t <= 0) return { p: at3(f.points, 0), i: 0 };
  if (t >= f.seconds) return { p: at3(f.points, n), i: n - 1 };
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f.times[mid] <= t) lo = mid; else hi = mid; }
  const a = at3(f.points, lo), b = at3(f.points, lo + 1), ds = apart(a, b), v0 = f.speeds[lo], v1 = f.speeds[lo + 1];
  const acc = ds > 0 ? (v1 * v1 - v0 * v0) / (2 * ds) : 0, tau = t - f.times[lo], T = Math.max(1e-6, f.times[lo + 1] - f.times[lo]), u = Math.min(1, tau / T);
  // From rest (or to it) the way goes as the time cubed, so the push grows from nothing (timed); else evenly.
  const d = Math.min(ds, Math.max(0, v0 === 0 && v1 > 0 ? ds * u * u * u : v1 === 0 && v0 > 0 ? ds * (1 - Math.pow(1 - u, 3)) : v0 * tau + 0.5 * acc * tau * tau));
  return { p: ds > 0 ? madd(a, v3sub(b, a), d / ds) : a, i: lo };
}

/**
 * The pod at time t of its flight (before it: on its first pad; after: on its last): where it is, how it moves, what
 * its passenger feels (the turning frame's apparent acceleration less its own) and its frame, banked into that by at
 * most `tilt`, facing its way.
 */
export function flightAt(h: Habitat, f: Flight, t: number): FlightState {
  if (t <= 0 || t >= f.seconds) {
    const place = t <= 0 ? f.from : f.to, felt = apparentAcceleration(h, place.at, [0, 0, 0]);
    return { place, velocity: [0, 0, 0], felt, weight: Math.hypot(...felt), share: t <= 0 ? 0 : 1 };
  }
  const here = positionAt(f, t), slow = Math.max(f.speeds[here.i], f.speeds[here.i + 1] ?? 0, 0.5);
  // Before the flight and after it the pod stands on its pads (positionAt), so lifting off and setting down ease in too.
  const span = Math.min(3, Math.max(SPAN, (SPAN_STEPS * STEP) / slow)), tm = t - span, tp = t + span;
  const before = positionAt(f, tm).p, after = positionAt(f, tp).p, p = here.p;
  const velocity: Vec3 = [0, 1, 2].map((k) => (after[k] - before[k]) / Math.max(1e-6, tp - tm)) as Vec3;
  const acc: Vec3 = t - tm > 1e-6 && tp - t > 1e-6
    ? [0, 1, 2].map((k) => (2 * ((after[k] - p[k]) / (tp - t) - (p[k] - before[k]) / (t - tm))) / (tp - tm)) as Vec3 : [0, 0, 0];
  const felt = v3sub(apparentAcceleration(h, p, velocity), acc), weight = Math.hypot(...felt);
  const trueUp = upAt(p) ?? f.from.ez;
  // Its fans hold it a little toward level (`LEVEL` of the floor's weight): where one weighs next to nothing (fast
  // against the spin), what little one feels swings round quickly, and the pod does not swing with it.
  const level = LEVEL * h.gravityAt(h.radius), tu = v3norm(trueUp);
  let up = v3norm([level * tu[0] - felt[0], level * tu[1] - felt[1], level * tu[2] - felt[2]]);
  // Banked by at most the tilt from true up.
  const tilt = h.params.life.caps.tilt, cos = v3dot(up, trueUp);
  if (cos < Math.cos(tilt)) {
    const side = madd(up, trueUp, -cos), k = Math.hypot(...side);
    up = k > 1e-9 ? v3norm(madd(v3norm(trueUp), side, Math.tan(tilt) / k)) : trueUp;
  }
  const i = here.i, w = Math.min(1, Math.max(0, (t - f.times[i]) / Math.max(1e-6, f.times[i + 1] - f.times[i])));
  const heading = madd(at3(f.headings, i), v3sub(at3(f.headings, i + 1), at3(f.headings, i)), w);
  let ex = madd(heading, up, -v3dot(heading, up));
  ex = Math.hypot(...ex) > 1e-9 ? v3norm(ex) : f.from.ex;
  return { place: { at: p, ex, ey: v3cross(up, ex), ez: up }, velocity, felt, weight, share: t / f.seconds };
}

/**
 * Where a called pod comes from (or an emptied one goes): hovering `call` m over the floor from a pad, in a direction
 * of its own (from `seed`), over the crowns there, facing the pad.
 */
export function awayFrom(t: Terrain, pad: CapPad, seed: number): Place {
  const h = t.habitat, { profile } = h, at = fromWorld(profile, ...pad.at), call = h.params.life.caps.call;
  const a = 2 * Math.PI * (seed - Math.floor(seed)), r = Math.max(1, profile.at(at.s).r);
  const margin = Math.min(call, (profile.floorEnd - profile.floorStart) / 4);
  const s = Math.min(profile.floorEnd - margin, Math.max(profile.floorStart + margin, at.s + call * Math.cos(a)));
  const theta = at.theta + (call * Math.sin(a)) / r, ground = t.standAt(theta, s);
  const p = toWorld(profile, { theta, s, h: ground + cruiseClear(h) }), up = upAt(p)!;
  const to = v3sub(pad.at, p), flat = madd(to, up, -v3dot(to, up)), ex = Math.hypot(...flat) > 1e-6 ? v3norm(flat) : pad.ex;
  return { at: p, ex, ey: v3cross(up, ex), ez: up };
}
