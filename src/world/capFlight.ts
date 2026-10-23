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
 * less. It speeds up and slows down by at most `accel`.
 *
 * What the passenger feels is the turning frame's apparent acceleration (centrifugal and Coriolis) less the pod's own
 * acceleration along its way (`flightAt`): the pod's floor banks into it, as a fan-lifted craft must (its thrust is
 * along its up), by at most `tilt` from true up. Pitching nose down to speed up, banking into a bend, leaning sideways
 * as the Coriolis force pushes on a climb toward the axis: all from the same sum.
 */
import { smoothstep, v3cross, v3dot, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
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
/** Speeds and accelerations are read over this much time either side of a moment (s), so the pod's bank is smooth. */
const SPAN = 0.5;
/** Below this speed over the floor (m/s along the way) the pod turns from the pad's heading to its way's. */
const TURNING = 0.25;

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
  const across = overTheLand(t, acrossAt(A1, B1, best, ACROSS), rise, rhoMin);
  const way: Vec3[] = [];
  const column = (a: Vec3, b: Vec3): Vec3[] => { const n = Math.max(1, Math.ceil(apart(a, b) / STEP)); return Array.from({ length: n }, (_, i) => madd(a, v3sub(b, a), i / n)); };
  if (!ends.airborneStart) way.push(...column(A0, A1));
  way.push(...across);
  if (!ends.airborneEnd) way.push(...column(B1, B0).slice(1), B0);
  const fixed = (i: number): boolean => {
    // The pads' columns stay straight up and down to most of their height; the corners above them round off.
    const a = !ends.airborneStart && apart(way[i], A0) < rise * 0.6, b = !ends.airborneEnd && apart(way[i], B0) < rise * 0.6;
    return i === 0 || i === way.length - 1 || a || b;
  };
  for (let pass = 0; pass < 8; pass++) for (let i = 1; i < way.length - 1; i++) if (!fixed(i)) way[i] = smoothed(way, i);
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
 * or as near as an end lies plus how far it has come from it), smoothing between; its ends stay where they are.
 */
function overTheLand(t: Terrain, way: Vec3[], rise: number, rhoMin: number): Vec3[] {
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
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < n; i++) keep(i);
    for (let k = 0; k < 6; k++) for (let i = 1; i < n; i++) way[i] = smoothed(way, i);
  }
  for (let i = 1; i < n; i++) keep(i);
  return way;
}

/** A polyline resampled evenly by its length (every `STEP` m or more, at most `MOST` samples). */
function resample(way: readonly Vec3[]): Vec3[] {
  const run = [0];
  for (let i = 1; i < way.length; i++) run.push(run[i - 1] + apart(way[i - 1], way[i]));
  const total = run[run.length - 1], n = Math.max(2, Math.min(MOST, Math.ceil(total / STEP)));
  const out: Vec3[] = [];
  for (let k = 0, j = 0; k <= n; k++) {
    const d = (total * k) / n;
    while (j < way.length - 2 && run[j + 1] < d) j++;
    const seg = run[j + 1] - run[j], f = seg > 0 ? (d - run[j]) / seg : 0;
    out.push(madd(way[j], v3sub(way[j + 1], way[j]), Math.min(1, Math.max(0, f))));
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
  v[0] = 0;
  v[n] = 0;
  for (let i = 0; i < n; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] * v[i] + 2 * caps.accel * (run[i + 1] - run[i])));
  for (let i = n; i > 0; i--) v[i - 1] = Math.min(v[i - 1], Math.sqrt(v[i] * v[i] + 2 * caps.accel * (run[i] - run[i - 1])));
  const times = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) times[i + 1] = times[i] + (run[i + 1] - run[i]) / Math.max(1e-3, (v[i] + v[i + 1]) / 2);
  const points = new Float64Array(3 * (n + 1));
  let nearest = Infinity;
  way.forEach((p, i) => { points.set(p, 3 * i); nearest = Math.min(nearest, Math.hypot(p[0], p[1])); });
  return {
    points, times, speeds: v, headings: full ? headingsOf(way, ends) : new Float64Array(0), seconds: times[n],
    length: total, nearest, heaviest: felt, from: ends.from, to: ends.to,
  };
}

/**
 * Which way the pod faces over the floor along its way: along the way where it moves over the floor; going straight up
 * off a pad (or down onto one), turning from the pad's heading to the way's as it climbs.
 */
function headingsOf(way: readonly Vec3[], ends: FlightEnds): Float64Array {
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
  const blend = (a: Vec3, b: Vec3, w: number): Vec3 => v3norm(madd(a, v3sub(b, a), smoothstep(0, 1, w)));
  for (let i = 0; i < first; i++) out.set(blend(ends.from.ex, at3(out, first), i / first), 3 * i);
  for (let i = n; i > last; i--) out.set(blend(ends.to.ex, at3(out, last), (n - i) / Math.max(1, n - last)), 3 * i);
  for (let i = first + 1; i < last; i++) if (!known[i]) out.set(at3(out, i - 1), 3 * i);
  return out;
}

/** Where along its way the pod is at time t (world), and which sample it is past. */
function positionAt(f: Flight, t: number): { p: Vec3; i: number } {
  const n = f.times.length - 1;
  if (t <= 0) return { p: at3(f.points, 0), i: 0 };
  if (t >= f.seconds) return { p: at3(f.points, n), i: n - 1 };
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f.times[mid] <= t) lo = mid; else hi = mid; }
  const a = at3(f.points, lo), b = at3(f.points, lo + 1), ds = apart(a, b), v0 = f.speeds[lo], v1 = f.speeds[lo + 1];
  const acc = ds > 0 ? (v1 * v1 - v0 * v0) / (2 * ds) : 0, tau = t - f.times[lo];
  const d = Math.min(ds, Math.max(0, v0 * tau + 0.5 * acc * tau * tau));
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
  const here = positionAt(f, t), tm = Math.max(0, t - SPAN), tp = Math.min(f.seconds, t + SPAN);
  const before = positionAt(f, tm).p, after = positionAt(f, tp).p, p = here.p;
  const velocity: Vec3 = [0, 1, 2].map((k) => (after[k] - before[k]) / Math.max(1e-6, tp - tm)) as Vec3;
  const acc: Vec3 = t - tm > 1e-6 && tp - t > 1e-6
    ? [0, 1, 2].map((k) => (2 * ((after[k] - p[k]) / (tp - t) - (p[k] - before[k]) / (t - tm))) / (tp - tm)) as Vec3 : [0, 0, 0];
  const felt = v3sub(apparentAcceleration(h, p, velocity), acc), weight = Math.hypot(...felt);
  const trueUp = upAt(p) ?? f.from.ez;
  let up = weight > 1e-6 ? v3norm([-felt[0], -felt[1], -felt[2]]) : trueUp;
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
