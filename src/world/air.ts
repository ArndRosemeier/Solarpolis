/**
 * The air as light passes through it: the haze. The air's density depends only on the distance from the axis
 * (`pressureAt`: thinner toward the axis, much thinner in a large habitat), and it is lit by the sunline, brightest
 * close to it. Along a line of sight from the eye to a surface, the air takes away some of the surface's light
 * (transmittance) and adds its own glow (in-scatter): the far side fades into blue, and the sunline wears a halo.
 *
 *   σ(p) = extinction · density(r)        source(p) = sky + (1 − sky) · (R / r) · seen(z, r) · emission(z)
 *
 * `seen` is the share of the tube's length visible from there, relative to the mid floor's, so on the floor
 * everywhere along the middle the source is 1 and the haze tends to its plain colour. The line of sight is cut into
 * `HAZE_STEPS` pieces. In each, density, `seen` and emission are taken at the middle, and the R / r term is integrated
 * exactly, because close to the axis it changes faster than any step: that is the halo. The shaders run the same sums
 * (render/materials.ts, `throughAir`); this is their reference. Pure.
 */
import type { Habitat, Vec3 } from '../blueprint';
import { emissionAt, nearestLit } from './sunline';

/** Pieces of a line of sight in the shaders. */
export const HAZE_STEPS = 10;

/** Density falls as exp(−kappa · (R² − r²)) toward the axis (1/m²), from the blueprint's pressure profile. */
export function densityFalloff(h: Habitat): number {
  return Math.log(h.pressureAt(h.radius) / h.pressureAt(0)) / (h.radius * h.radius);
}

/** The angle the sunline spans seen from (z, r) (radians). */
function span(h: Habitat, z: number, r: number): number {
  return Math.atan((h.length - z) / r) + Math.atan(z / r);
}

/** The angle the sunline spans from the mid floor: the shaders' `airShape.seenMid`. */
export function seenMid(h: Habitat): number {
  return span(h, h.length / 2, h.radius);
}

/** The share of the sunline seen from (z, r), with the mid floor's share as 1. */
export function seenShare(h: Habitat, z: number, r: number): number {
  return span(h, z, r) / seenMid(h);
}

/** ∫ dt / sqrt(|p_xy + t d_xy|² + n²) from t0 to t1 (d a unit vector): the R / r term over one piece, exactly. */
export function inverseRadiusIntegral(p: Vec3, d: Vec3, n: number, t0: number, t1: number): number {
  const A = d[0] * d[0] + d[1] * d[1], B = 2 * (p[0] * d[0] + p[1] * d[1]), C = p[0] * p[0] + p[1] * p[1] + n * n;
  if (A < 1e-6) return (t1 - t0) / Math.sqrt(C); // along the axis: the distance does not change
  const disc = Math.sqrt(Math.max(4 * A * C - B * B, 1e-12));
  const primitive = (t: number): number => Math.asinh((2 * A * t + B) / disc) / Math.sqrt(A);
  return primitive(t1) - primitive(t0);
}

export interface Haze {
  /** How much of the surface's light arrives (0 … 1). */
  transmittance: number;
  /** How much of the haze colour the air adds (1 = as much as an endless floor-level view). */
  inscatter: number;
}

/**
 * The haze between `eye` and `p` (world points), for an extinction per metre at floor density and a sky-light share,
 * in `steps` pieces.
 */
export function hazeAlong(h: Habitat, emission: Float32Array, extinction: number, sky: number, eye: Vec3, p: Vec3, steps = HAZE_STEPS): Haze {
  const kappa = densityFalloff(h), R = h.radius, near = nearestLit(h);
  const D = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
  if (D < 1e-9) return { transmittance: 1, inscatter: 0 };
  const d: Vec3 = [(p[0] - eye[0]) / D, (p[1] - eye[1]) / D, (p[2] - eye[2]) / D];
  let T = 1, glow = 0;
  for (let k = 0; k < steps; k++) {
    const t0 = (D * k) / steps, t1 = (D * (k + 1)) / steps, dt = t1 - t0, tm = (t0 + t1) / 2;
    const x = eye[0] + d[0] * tm, y = eye[1] + d[1] * tm, z = eye[2] + d[2] * tm;
    const r = Math.max(Math.hypot(x, y), near);
    const sigma = extinction * Math.exp(-kappa * (R * R - r * r));
    const lit = seenShare(h, z, r) * emissionAt(emission, h.length, z);
    const source = sky * dt + (1 - sky) * R * lit * inverseRadiusIntegral(eye, d, near, t0, t1);
    const tau = sigma * dt;
    // Light made inside the piece is dimmed by the rest of the piece too: the mean of e^(−σ t) over it.
    const inside = tau > 1e-6 ? (1 - Math.exp(-tau)) / tau : 1;
    glow += T * sigma * source * inside;
    T *= Math.exp(-tau);
  }
  return { transmittance: T, inscatter: glow };
}
