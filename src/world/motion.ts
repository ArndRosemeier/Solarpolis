/**
 * Motion inside the habitat, in its own frame (the blueprint's body frame: it turns about +z at the spin rate, as
 * src/space has it). In that frame nothing pulls things down: what feels like gravity is the centrifugal force, and
 * anything moving is pushed sideways by the Coriolis force:
 *
 *   a = ω² (x, y, 0)  −  2 Ω × v,   Ω = (0, 0, ω)
 *
 * So a dropped ball lands behind the spot below where it was let go (antispinward) by `habitat.dropOffset(h)`, a
 * thrown one curves, and on an endcap slope "down" leans out from the axis and weakens toward it. The physics
 * (src/physics) applies this to every body; this is the formula and its reference integrator, for tests.
 *
 * The air turns with the habitat, so in this frame it stands still (wind is not in the physics yet), and anything
 * moving through it is slowed by drag growing with the square of its speed (`airDrag`): a body thrown against the spin
 * at the floor's own speed hangs still seen from outside, but in here it meets a gale and is back down in seconds. Pure.
 */
import type { Habitat, Vec3 } from '../blueprint';

/** The apparent acceleration of something at `p` moving at `v` (m/s², world axes of the habitat's own frame). */
export function apparentAcceleration(h: Habitat, p: Vec3, v: Vec3): Vec3 {
  const w = h.spin, w2 = w * w;
  return [w2 * p[0] + 2 * w * v[1], w2 * p[1] - 2 * w * v[0], 0];
}

/**
 * The air's drag on a body at `p` moving at `v` (habitat frame), as an acceleration (m/s²): −ρ(r) · k · |v| · v / 2,
 * where `k` is the body's drag area over its mass (Cd · A / m, m²/kg). The air is the habitat's: at rest in its frame
 * and thinner toward the axis (`habitat.airDensityAt`).
 */
export function airDrag(h: Habitat, p: Vec3, v: Vec3, k: number): Vec3 {
  const c = -0.5 * h.airDensityAt(Math.hypot(p[0], p[1])) * k * Math.hypot(v[0], v[1], v[2]);
  return [c * v[0], c * v[1], c * v[2]];
}

/**
 * Follow a free body for `seconds` with steps of `dt` (classic RK4), without collisions: the reference that the
 * physics engine's motion is checked against. `drag` is the body's drag area over its mass (`airDrag`); 0 is a vacuum.
 */
export function coast(h: Habitat, p: Vec3, v: Vec3, seconds: number, dt = 1 / 240, stop?: (p: Vec3, v: Vec3) => boolean, drag = 0): { p: Vec3; v: Vec3; t: number } {
  let P: Vec3 = [...p], V: Vec3 = [...v], t = 0;
  const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const acc = (p: Vec3, v: Vec3): Vec3 => drag > 0 ? add(apparentAcceleration(h, p, v), airDrag(h, p, v, drag), 1) : apparentAcceleration(h, p, v);
  while (t < seconds && !(stop && stop(P, V))) {
    const a1 = acc(P, V);
    const p2 = add(P, V, dt / 2), v2 = add(V, a1, dt / 2), a2 = acc(p2, v2);
    const p3 = add(P, v2, dt / 2), v3 = add(V, a2, dt / 2), a3 = acc(p3, v3);
    const p4 = add(P, v3, dt), v4 = add(V, a3, dt), a4 = acc(p4, v4);
    P = [0, 1, 2].map((i) => P[i] + (dt / 6) * (V[i] + 2 * v2[i] + 2 * v3[i] + v4[i])) as Vec3;
    V = [0, 1, 2].map((i) => V[i] + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i])) as Vec3;
    t += dt;
  }
  return { p: P, v: V, t };
}

/** Spinward at `p`: the way the floor itself moves around the axis (+θ, since the habitat turns about +z). */
export function spinwardAt(p: Vec3): Vec3 | null {
  const up = upAt(p);
  return up && [up[1], -up[0], 0];
}

/**
 * The weight a body at `p` moving at `v` (habitat frame) feels per kilogram on the ground under it (m/s²): what the
 * floor must push to bend its path around the axis. Seen from outside, the body goes round at ωr plus its own speed
 * spinward, so it weighs (ωr + v·spinward)² / r: with the spin heavier, against it lighter, along the axis the same.
 * At rest it is `habitat.gravityAt(r)`. It is also the gravity a jump feels: in the turning frame the centrifugal
 * ω²r, the Coriolis 2ωv and the floor curving away under a body moving across it (v²/r) add up to the same.
 */
export function feltGravity(h: Habitat, p: Vec3, v: Vec3): number {
  const r = Math.hypot(p[0], p[1]);
  if (r < 1e-6) return 0;
  const round = h.spin * r + (-p[1] * v[0] + p[0] * v[1]) / r;
  return (round * round) / r;
}

/** How a body moves, for the gravity it feels: on its feet, in the air, swimming, flying, or riding a lift. */
export type Moving = 'foot' | 'air' | 'swim' | 'fly' | 'lift';

/** What the gravity meter shows (app/gravityMeter.ts). */
export interface GravityReading {
  /** Felt gravity now, and what it would be standing still here, and on the floor (m/s²). */
  felt: number;
  rest: number;
  floor: number;
  /** Speed spinward (m/s; negative: against the spin). */
  spinward: number;
  /** Where spinward lies seen from the eye: radians clockwise from straight ahead (along the ground). */
  arrow: number;
  moving: Moving;
}

/** The meter's reading for a body at `p` moving at `v`, seen from an eye looking along `look` with `up` up. */
export function gravityReading(h: Habitat, p: Vec3, v: Vec3, look: Vec3, up: Vec3, moving: Moving): GravityReading {
  const r = Math.hypot(p[0], p[1]), spin = spinwardAt(p) ?? [0, 0, 0];
  const ahead: Vec3 = [look[0] - up[0] * dot(look, up), look[1] - up[1] * dot(look, up), look[2] - up[2] * dot(look, up)];
  // Right of the eye: look × up.
  const right: Vec3 = [look[1] * up[2] - look[2] * up[1], look[2] * up[0] - look[0] * up[2], look[0] * up[1] - look[1] * up[0]];
  return {
    felt: feltGravity(h, p, v), rest: h.gravityAt(r), floor: h.gravityAt(h.radius),
    spinward: dot(v, spin), arrow: Math.atan2(dot(spin, right), dot(spin, ahead)), moving,
  };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Which way is up at `p`: straight toward the axis, against the spin's apparent gravity (its strength there is
 * `habitat.gravityAt(r)`). On the axis itself there is no up, and this returns null.
 */
export function upAt(p: Vec3): Vec3 | null {
  const r = Math.hypot(p[0], p[1]);
  return r < 1e-6 ? null : [-p[0] / r, -p[1] / r, 0];
}
