/**
 * Where a falling body comes down, when, and how hard (design "Nobody falls far": the habitat's Mind foresees every
 * fall). The same forces the physics applies (world/motion.ts): in the habitat's turning frame the centrifugal and
 * Coriolis forces and the drag of the air, which turns with it. Seen from outside a fall is a straight line at the
 * speed the body had when it let go; inside it starts gently, curves against the spin and speeds up outward until the
 * air holds it near 50 m/s on a 1 g floor. Off the Threshold, near the axis, the same fall lasts minutes.
 *
 * `fallOf` follows a body from a point and velocity until its feet meet the ground (or the water, or a built top under
 * it), with steps that shrink as the ground nears; `harmful` says whether that landing would hurt (`Guard.harm`, the
 * speed across the ground, or all of it on a cliff, where nobody stops), and `fallAt` where the body is at any moment of the fall. Pure.
 */
import { v3cross, v3dot, v3madd, v3norm, v3sub } from '@futuremagic/core';
import { fromWorld, toWorld, type Guard, type Habitat, type Vec3 } from '../blueprint';
import { landmarkTopAt } from '../gen/landmarks';
import type { Terrain } from '../gen/terrain';
import { airDrag, apparentAcceleration, upAt } from './motion';

/**
 * What a body coming down at (θ, s) from `h` m over the profile meets: the height it would stand at (the ground, the
 * water's surface, or a built top no higher than it is) and whether that is water.
 */
export type Footing = (theta: number, s: number, h: number) => { h: number; water: boolean };

/** One moment of a fall: time from its start (s), the feet's place and velocity (world, the habitat's frame). */
export interface FallPoint {
  t: number;
  p: Vec3;
  v: Vec3;
}

/** Where a fall meets what it lands on: when, where, how fast, the ground's normal there, and its speed across it. */
export interface Landing extends FallPoint {
  normal: Vec3;
  /** Speed into the ground, along its normal (m/s): what hurts. */
  speed: number;
  water: boolean;
}

/** A fall foreseen: the path, a point per step, and its landing (null if it has not landed within the horizon). */
export interface Fall {
  path: FallPoint[];
  lands: Landing | null;
}

/** The step's length is at most this share of the time to the ground at the present speed, and between these (s). */
const STEP_SHARE = 0.25;
const STEP_MIN = 1 / 120;
const STEP_MAX = 0.5;
/** A built top this far over the feet (m) still catches them (a gallery's lip they brush past); higher, it is overhead. */
const TOP_REACH = 0.5;
/** The ground's normal is taken across this far (m). */
const NORMAL_SPAN = 1;
/** Water deeper than this (m) is what the body lands in. */
const WATER = 0.05;
/** Ground steeper than this (radians from up; as steep as feet climb) holds nobody: a body landing on it tumbles on, so all its speed counts. */
const CLIFF = (50 * Math.PI) / 180;

/** What a body lands on in a habitat: the terrain's ground or water, or a landmark's top (a gallery, a hut's deck) under it. */
export function footingOf(terrain: Terrain): Footing {
  return (theta, s, h) => {
    const ground = terrain.heightAt(theta, s), stand = terrain.standAt(theta, s), top = landmarkTopAt(terrain, theta, s);
    if (top !== null && top > stand && top <= h + TOP_REACH) return { h: top, water: false };
    return { h: stand, water: stand - ground > WATER };
  };
}

/**
 * Follow a body's feet from `p` at `v` (world, habitat frame) until they land, or for `horizon` s. `drag` is its drag
 * area over its mass (`HUMAN_DRAG`). RK4 steps, each a share of the time the ground is away at the present speed, the
 * last cut to the moment the feet cross the footing.
 */
export function fallOf(h: Habitat, footing: Footing, p: Vec3, v: Vec3, drag: number, horizon = 900): Fall {
  const acc = (q: Vec3, w: Vec3): Vec3 => {
    const a = apparentAcceleration(h, q, w), d = airDrag(h, q, w, drag);
    return [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
  };
  const rk4 = (q: Vec3, w: Vec3, dt: number): { p: Vec3; v: Vec3 } => {
    const a1 = acc(q, w);
    const q2 = v3madd(q, w, dt / 2), w2 = v3madd(w, a1, dt / 2), a2 = acc(q2, w2);
    const q3 = v3madd(q, w2, dt / 2), w3 = v3madd(w, a2, dt / 2), a3 = acc(q3, w3);
    const q4 = v3madd(q, w3, dt), w4 = v3madd(w, a3, dt), a4 = acc(q4, w4);
    return {
      p: [0, 1, 2].map((i) => q[i] + (dt / 6) * (w[i] + 2 * w2[i] + 2 * w3[i] + w4[i])) as Vec3,
      v: [0, 1, 2].map((i) => w[i] + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i])) as Vec3,
    };
  };
  const gapAt = (q: Vec3): { gap: number; theta: number; s: number; under: { h: number; water: boolean } } => {
    const at = fromWorld(h.profile, q[0], q[1], q[2]), under = footing(at.theta, at.s, at.h);
    return { gap: at.h - under.h, theta: at.theta, s: at.s, under };
  };
  const path: FallPoint[] = [{ t: 0, p: [...p], v: [...v] }];
  let q: Vec3 = [...p], w: Vec3 = [...v], t = 0, here = gapAt(q);
  while (t < horizon) {
    const speed = Math.hypot(w[0], w[1], w[2]);
    const dt = Math.min(STEP_MAX, Math.max(STEP_MIN, (STEP_SHARE * Math.max(0, here.gap)) / (speed + 1)));
    const next = rk4(q, w, dt), there = gapAt(next.p);
    if (there.gap <= 0) {
      // The feet cross the footing in this step: cut it where the gap closes (linearly), then step that far exactly.
      const f = here.gap <= 0 ? 0 : Math.min(1, here.gap / (here.gap - there.gap));
      const end = f > 0 ? rk4(q, w, dt * f) : { p: q, v: w }, at = gapAt(end.p);
      const normal = footingNormal(h, footing, at.theta, at.s, at.under.h), up = upAt(end.p);
      const cliff = !at.under.water && !!up && v3dot(normal, up) < Math.cos(CLIFF);
      const speed = cliff ? Math.hypot(end.v[0], end.v[1], end.v[2]) : Math.max(0, -v3dot(end.v, normal));
      const lands: Landing = { t: t + dt * f, p: end.p, v: end.v, normal, speed, water: at.under.water };
      path.push({ t: lands.t, p: lands.p, v: lands.v });
      return { path, lands };
    }
    q = next.p; w = next.v; t += dt; here = there;
    path.push({ t, p: [...q], v: [...w] });
  }
  return { path, lands: null };
}

/** How far the feet at `p` are over what they would land on (m; below it, negative). */
export function gapOf(h: Habitat, footing: Footing, p: Vec3): number {
  const at = fromWorld(h.profile, p[0], p[1], p[2]);
  return at.h - footing(at.theta, at.s, at.h).h;
}

/** Whether a fall's landing would hurt: faster across the ground than `guard.harm` (into water, `guard.water` times it). */
export function harmful(fall: Fall, guard: Guard): boolean {
  const l = fall.lands;
  return !!l && l.speed > guard.harm * (l.water ? guard.water : 1);
}

/** The body at time t of a fall (s from its start): between two points, the cubic through both with their velocities. */
export function fallAt(fall: Fall, t: number): FallPoint {
  const path = fall.path, last = path[path.length - 1];
  if (t <= 0) return path[0];
  if (t >= last.t) return last;
  let lo = 0, hi = path.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid].t <= t) lo = mid; else hi = mid; }
  return hermite(path[lo], path[hi], t);
}

/** The cubic Hermite between two moments (place and velocity at each), at time t between them. */
export function hermite(a: FallPoint, b: FallPoint, t: number): FallPoint {
  const T = b.t - a.t;
  if (T <= 1e-9) return { t, p: [...b.p], v: [...b.v] };
  const u = (t - a.t) / T, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const d00 = (6 * u2 - 6 * u) / T, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / T, d11 = 3 * u2 - 2 * u;
  const p = [0, 1, 2].map((i) => h00 * a.p[i] + h10 * T * a.v[i] + h01 * b.p[i] + h11 * T * b.v[i]) as Vec3;
  const v = [0, 1, 2].map((i) => d00 * a.p[i] + d10 * a.v[i] + d01 * b.p[i] + d11 * b.v[i]) as Vec3;
  return { t, p, v };
}

/** The normal of the footing at (θ, s) where it stands at `top` (world, unit, away from the ground): across `NORMAL_SPAN` each way. */
export function footingNormal(h: Habitat, footing: Footing, theta: number, s: number, top: number): Vec3 {
  const r = Math.max(1, h.profile.at(s).r), dTheta = NORMAL_SPAN / r;
  const point = (th: number, ss: number): Vec3 => toWorld(h.profile, { theta: th, s: ss, h: footing(th, ss, top + NORMAL_SPAN).h });
  const ds = Math.min(NORMAL_SPAN, Math.max(0.01, (h.profile.length - s) / 2), Math.max(0.01, s / 2));
  const a = point(theta - dTheta, s), b = point(theta + dTheta, s), c = point(theta, s - ds), d = point(theta, s + ds);
  const n = v3norm(v3cross(v3sub(b, a), v3sub(d, c)));
  // Away from the ground: the side the profile's own normal points to.
  const out = v3sub(toWorld(h.profile, { theta, s, h: top + 1 }), toWorld(h.profile, { theta, s, h: top }));
  return v3dot(n, out) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

