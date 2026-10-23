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

/** Which day of the clock `t` (s) falls in: whole days since the clock's start. */
export const dayNumber = (h: Habitat, t: number): number => Math.floor(t / h.params.day.length);

/** Where in its day the habitat is at clock time `t` (s): 0 … 1, with 0 the start of daylight (dawn at the wild end). */
export function dayPhase(h: Habitat, t: number): number {
  const f = t / h.params.day.length;
  return f - Math.floor(f);
}

/** How far the day has come, while it is light: 0 at dawn, 1 at dusk; outside daylight, the nearer end. */
function daylightProgress(h: Habitat, phase: number): number {
  return Math.min(1, phase / h.params.day.daylight);
}

/**
 * How bright the sunline is overall at a phase, 1 in full day, `night` at night: the light swells over the first
 * and fades over the last twentieth of the daylight hours.
 */
export function dayLevel(h: Habitat, phase: number): number {
  const { daylight, night } = h.params.day;
  if (phase >= daylight) return night;
  const u = phase / daylight, ramp = 0.05;
  const k = Math.min(1, u / ramp, (1 - u) / ramp);
  const s = k * k * (3 - 2 * k);
  return night + (1 - night) * s;
}

/**
 * Where the bright stretch's middle is at a phase of the day, as a share of the length from the wild wall: it runs from
 * just behind the wild wall at dawn to just past the port wall at dusk (and stays there through the night).
 */
export function brightCentre(h: Habitat, phase: number): number {
  const { peakWidth } = h.params.day;
  return -peakWidth + daylightProgress(h, phase) * (1 + 2 * peakWidth);
}

/**
 * The emission profile along the axis at clock time `t` (s), per sample from the wild wall to the port wall. In daylight
 * a bright stretch travels from the wild end to the port end over the tube's even `base` glow; while all of the
 * stretch is inside the tube, the profile's mean over the length is the day's level (1 in full day). At night the
 * tube glows evenly at the night level.
 */
export function sunlineEmission(h: Habitat, t = h.params.day.length * h.params.day.daylight / 2, out = new Float32Array(EMISSION_SAMPLES)): Float32Array {
  const { daylight, peakWidth, base } = h.params.day;
  const phase = dayPhase(h, t), level = dayLevel(h, phase);
  if (phase >= daylight) return out.fill(level);
  const centre = brightCentre(h, phase);
  // Scaled by the whole stretch's mean, so it gives the full day's light only when all of it is inside the tube: at
  // dawn it rises out of the wild wall, at dusk it sinks into the port wall.
  const peakMean = peakWidth * Math.sqrt(2 * Math.PI);
  for (let i = 0; i < EMISSION_SAMPLES; i++) {
    const d = ((i + 0.5) / EMISSION_SAMPLES - centre) / peakWidth;
    out[i] = level * (base + ((1 - base) * Math.exp(-0.5 * d * d)) / peakMean);
  }
  return out;
}

/** The mean of an emission profile over the length (the sky light's share of the day). */
export function emissionMean(emission: Float32Array): number {
  let s = 0;
  for (const e of emission) s += e;
  return s / emission.length;
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
  let sum = 0;
  alongSunline(h, emission, p, towardPort, towardWild, steps, (w, d) => { sum += w * Math.max(0, n[0] * d[0] + n[1] * d[1] + n[2] * d[2]); });
  return sum;
}

/**
 * Visit the sunline seen from p between the two horizon angles in `steps` pieces: each piece's direction d (unit, from
 * p) and its weight w, so that the light on a surface with normal n is Σ w · max(n·d, 0) (before `sunlineNorm`).
 */
function alongSunline(h: Habitat, emission: Float32Array, p: Vec3, towardPort: number, towardWild: number, steps: number, visit: (w: number, d: Vec3) => void): void {
  const len = Math.hypot(p[0], p[1]);
  const r = Math.max(len, nearestLit(h));
  const ix = len > 1e-9 ? -p[0] / len : 0, iy = len > 1e-9 ? -p[1] / len : 0;
  const lo = Math.max(-towardWild, Math.atan(-p[2] / r)), hi = Math.min(towardPort, Math.atan((h.length - p[2]) / r));
  const span = Math.max(0, hi - lo);
  for (let k = 0; k < steps; k++) {
    const a = lo + (span * (k + 0.5)) / steps, c = Math.cos(a), s = Math.sin(a);
    visit((emissionAt(emission, h.length, p[2] + r * Math.tan(a)) * c * span) / steps / r, [ix * c, iy * c, s]);
  }
}

/**
 * The sunline's direct light at p as one vector (scaled like `irradiance`): its direction is where the light comes
 * from on average, its length how strong it is. A surface facing all of the lit stretch gets exactly n · vector; this
 * lights things drawn by three.js's own lights (Actors' bodies) with one directional light. `norm` is `sunlineNorm(h)`,
 * passed in where it is called every frame.
 */
export function lightVector(h: Habitat, emission: Float32Array, p: Vec3, towardPort = OPEN_SKY, towardWild = OPEN_SKY, norm = sunlineNorm(h)): Vec3 {
  const v: Vec3 = [0, 0, 0], k = norm;
  alongSunline(h, emission, p, towardPort, towardWild, 64, (w, d) => { v[0] += w * d[0] * k; v[1] += w * d[1] * k; v[2] += w * d[2] * k; });
  return v;
}

/**
 * Where along the sunline the light on a surface comes from: `count` angles (from the inward radial toward +z, as in
 * `alongSunline`) that split the light on normal n into equal shares, each the middle of its share. The shadow of a
 * line light is the mean of the shadows toward these angles: soft along the axis, sharp across it.
 */
export function lightShares(h: Habitat, emission: Float32Array, p: Vec3, n: Vec3, count: number, towardPort = OPEN_SKY, towardWild = OPEN_SKY): number[] {
  const steps = 128, angles: number[] = [], light: number[] = [];
  let total = 0;
  alongSunline(h, emission, p, towardPort, towardWild, steps, (w, d) => {
    const e = w * Math.max(0, n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
    angles.push(Math.atan2(d[2], Math.hypot(d[0], d[1])));
    light.push(e);
    total += e;
  });
  const out: number[] = [];
  if (total <= 0) return out;
  let seen = 0, k = 0;
  for (let i = 0; i < angles.length && k < count; i++) {
    const next = seen + light[i];
    // The share's middle lies in this piece: interpolate within it.
    while (k < count && (k + 0.5) / count * total <= next) {
      const f = light[i] > 0 ? ((k + 0.5) / count * total - seen) / light[i] : 0.5;
      const half = i + 1 < angles.length ? (angles[i + 1] - angles[i]) / 2 : i > 0 ? (angles[i] - angles[i - 1]) / 2 : 0;
      out.push(angles[i] + (f - 0.5) * 2 * half);
      k++;
    }
    seen = next;
  }
  return out;
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
