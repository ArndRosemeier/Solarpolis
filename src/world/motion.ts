/**
 * Motion inside the habitat, in its own frame (the blueprint's body frame: it turns about +z at the spin rate, as
 * src/space has it). In that frame nothing pulls things down: what feels like gravity is the centrifugal force, and
 * anything moving is pushed sideways by the Coriolis force:
 *
 *   a = ω² (x, y, 0)  −  2 Ω × v,   Ω = (0, 0, ω)
 *
 * So a dropped ball lands behind the spot below where it was let go (antispinward) by `habitat.dropOffset(h)`, a
 * thrown one curves, and on an endcap slope "down" leans out from the axis and weakens toward it. The physics
 * (src/physics) applies this to every body; this is the formula and its reference integrator, for tests. Pure.
 */
import type { Habitat, Vec3 } from '../blueprint';

/** The apparent acceleration of something at `p` moving at `v` (m/s², world axes of the habitat's own frame). */
export function apparentAcceleration(h: Habitat, p: Vec3, v: Vec3): Vec3 {
  const w = h.spin, w2 = w * w;
  return [w2 * p[0] + 2 * w * v[1], w2 * p[1] - 2 * w * v[0], 0];
}

/**
 * Follow a free body for `seconds` with steps of `dt` (classic RK4), without collisions: the reference that the
 * physics engine's motion is checked against.
 */
export function coast(h: Habitat, p: Vec3, v: Vec3, seconds: number, dt = 1 / 240, stop?: (p: Vec3, v: Vec3) => boolean): { p: Vec3; v: Vec3; t: number } {
  let P: Vec3 = [...p], V: Vec3 = [...v], t = 0;
  const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  while (t < seconds && !(stop && stop(P, V))) {
    const a1 = apparentAcceleration(h, P, V);
    const p2 = add(P, V, dt / 2), v2 = add(V, a1, dt / 2), a2 = apparentAcceleration(h, p2, v2);
    const p3 = add(P, v2, dt / 2), v3 = add(V, a2, dt / 2), a3 = apparentAcceleration(h, p3, v3);
    const p4 = add(P, v3, dt), v4 = add(V, a3, dt), a4 = apparentAcceleration(h, p4, v4);
    P = [0, 1, 2].map((i) => P[i] + (dt / 6) * (V[i] + 2 * v2[i] + 2 * v3[i] + v4[i])) as Vec3;
    V = [0, 1, 2].map((i) => V[i] + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i])) as Vec3;
    t += dt;
  }
  return { p: P, v: V, t };
}
