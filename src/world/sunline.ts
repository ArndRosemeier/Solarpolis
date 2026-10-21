/**
 * The sunline's light. The sunline is a glowing tube along the axis from the wild wall (z = 0) to the port wall
 * (z = L); its brightness along z is the emission profile (uniform for now; the travelling sun of the day cycle will
 * shape it). Seen from a point at distance r from the axis, an axis point at z' lies at angle α from the straight-in
 * direction, with z' = z + r·tan α. The tube shows the same width from every angle and its length foreshortened by
 * cos α, so the light a surface with normal n receives is
 *
 *   E(n) = (1/r) ∫ emission(z + r·tan α) · cos α · max(n · d(α), 0) dα,   d(α) = inward·cos α + axis·sin α,
 *
 * over the α the point can see: the tube's own ends, and the terrain's two horizon angles toward the port end (+z) and
 * the wild end (−z). The axis always lies in the plane through the point and the axis, so two angles describe all
 * terrain occlusion (src/gen/horizon.ts). The shaders evaluate the same integral (render/materials.ts, `sunlit`) with
 * `SUNLINE_STEPS` samples; this is its reference, which also fixes the scale: 1 on the floor at mid-length. Pure.
 */
import type { Habitat, Vec3 } from '../blueprint';
import { OPEN_SKY } from '../gen/horizon';

/** Samples of the emission profile along the axis (the shaders' texture width). */
export const EMISSION_SAMPLES = 256;
/** Samples of the light integral in the shaders. */
export const SUNLINE_STEPS = 8;

/** The emission profile along the axis, 0 … 1 per sample, from the wild wall to the port wall. */
export function sunlineEmission(_h: Habitat): Float32Array {
  // The day cycle (milestone 3) moves a bright stretch along the tube; until then it glows evenly.
  return new Float32Array(EMISSION_SAMPLES).fill(1);
}

/** The emission at z (linear between samples, dark beyond the walls), as the shaders' texture gives it. */
export function emissionAt(emission: Float32Array, length: number, z: number): number {
  if (z < 0 || z > length) return 0;
  const x = (z / length) * EMISSION_SAMPLES - 0.5;
  const i = Math.max(0, Math.min(EMISSION_SAMPLES - 1, Math.floor(x)));
  const j = Math.min(EMISSION_SAMPLES - 1, i + 1), f = Math.max(0, Math.min(1, x - i));
  return emission[i] * (1 - f) + emission[j] * f;
}

/** Below this distance from the axis the light is taken as at this distance: the tube has a thickness. */
export function nearestLit(h: Habitat): number {
  return h.params.sunlineRadius * 2;
}

/**
 * Light on a surface at world point `p` with unit normal `n`, seeing toward the port end up to angle `towardPort` and
 * toward the wild end up to `towardWild` (radians from the straight-in direction), unscaled. `steps` samples (midpoint).
 */
export function rawIrradiance(h: Habitat, emission: Float32Array, p: Vec3, n: Vec3, towardPort = OPEN_SKY, towardWild = OPEN_SKY, steps = 256): number {
  const len = Math.hypot(p[0], p[1]);
  const r = Math.max(len, nearestLit(h));
  const ix = len > 1e-9 ? -p[0] / len : 0, iy = len > 1e-9 ? -p[1] / len : 0;
  const lo = Math.max(-towardWild, Math.atan(-p[2] / r)), hi = Math.min(towardPort, Math.atan((h.length - p[2]) / r));
  const span = Math.max(0, hi - lo);
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    const a = lo + (span * (k + 0.5)) / steps, c = Math.cos(a), s = Math.sin(a);
    const facing = Math.max(0, n[0] * ix * c + n[1] * iy * c + n[2] * s);
    sum += emissionAt(emission, h.length, p[2] + r * Math.tan(a)) * c * facing;
  }
  return (sum * span) / steps / r;
}

/** The scale that makes the light 1 on the floor at mid-length under an even emission (the shaders' `light.norm`). */
export function sunlineNorm(h: Habitat): number {
  const even = new Float32Array(EMISSION_SAMPLES).fill(1);
  return 1 / rawIrradiance(h, even, [h.radius, 0, h.length / 2], [-1, 0, 0], OPEN_SKY, OPEN_SKY, 1024);
}

/** Light on a surface (1 = the floor at mid-length under an even sunline). */
export function irradiance(h: Habitat, emission: Float32Array, p: Vec3, n: Vec3, towardPort = OPEN_SKY, towardWild = OPEN_SKY): number {
  return rawIrradiance(h, emission, p, n, towardPort, towardWild) * sunlineNorm(h);
}
