/**
 * The eye's adaptation outside: how bright the view is, metered on a coarse grid of rays against what the sky holds
 * (sunlit Earth, the Moon, the habitat's hull, the Sun's glare), and an exposure that follows it in log space as eyes
 * do, quickly toward the light and slowly into the dark. Inside, the eyes open in a wood's shade and stop down in the
 * air's bright glow near the axis. No three.js here, so the tests run it headless.
 *
 * Units as in skyShaders.ts: white paper in full sunlight is 1.
 */
import { v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { fluxOfMagnitude, type SkyView } from '../space';
import { fromWorld, groundNormal, type Habitat } from '../blueprint';
import { hazeAlong } from '../world/air';
import { emissionMean, rawIrradiance } from '../world/sunline';
import { OPEN_SKY } from '../gen/horizon';

/** The eye's glare around the Sun: strength (radiance × rad²) and how far it reaches (rad). The sky shader draws the same. */
export const GLARE = 6e-4;
export const GLARE_REACH = 0.15;

/** Mid grey: the metered log-average maps to this before the tone mapping. */
export const KEY = 0.18;
/** The faintest scene the eyes adapt to: plain eyes, and the "night eyes" augmentation. */
export const DARKEST = { plain: 1e-5, nightEyes: 1e-7 };

export interface Cylinder {
  center: Vec3;
  axis: Vec3;
  radius: number;
  halfLength: number;
  albedo: number;
}

export interface Meterable {
  sky: SkyView;
  /** The habitats in sight as cylinders: centre relative to the eye, unit axis, radius, half length (m), mean albedo. */
  hulls: Cylinder[];
  /** Irradiance from Earth on the hull, relative to full sunlight. */
  earthshine: number;
  /**
   * Inside an enclosure (the spindle's bore), where every ray lands on its walls: their luminance and the light on
   * them, relative to full sunlight.
   */
  room?: { luminance: number; light: number } | null;
}

/** What a ray along unit d sees: its luminance, and the light falling where it lands (0 for open sky). */
export function rayLuminance(m: Meterable, d: Vec3): number {
  return rayMeter(m, d).luminance;
}

/**
 * The light the eyes judge a surface by: once anything in view is in sunlight, they know the light is sunlight,
 * however slanted it falls there (a ship's flank in grazing light is not white paper in shadow).
 */
function lit(sun: number, sunlight: number): number {
  return sun > 0 ? sunlight : 0;
}

function rayMeter(m: Meterable, d: Vec3): { luminance: number; light: number } {
  if (m.room) return m.room;
  const s = m.sky;
  const a = v3len(v3cross(d, s.sunDir));
  const glare = v3dot(d, s.sunDir) > 0 ? GLARE / (a * a + s.sunRadius ** 2) * Math.exp(-a / GLARE_REACH) * s.sunlight : 0;
  let near = Infinity, hit: { n: Vec3; albedo: number } | null = null;
  for (const c of m.hulls) {
    const h = hitCylinder(c, d);
    if (h && h.t < near) { near = h.t; hit = { n: h.n, albedo: c.albedo }; }
  }
  if (hit) {
    const sun = Math.max(0, v3dot(hit.n, s.sunDir)) * s.sunlight;
    return { luminance: hit.albedo * (sun + m.earthshine) + glare, light: lit(sun, s.sunlight) + m.earthshine };
  }
  const earth = sphereNormal(d, s.earth.center, s.earth.radius);
  if (earth) { const sun = Math.max(0, v3dot(earth, s.sunDir)) * s.sunlight; return { luminance: 0.3 * sun + 1e-5 + glare, light: lit(sun, s.sunlight) }; }
  const moon = sphereNormal(d, s.moon.center, s.moon.radius);
  if (moon) { const sun = Math.max(0, v3dot(moon, s.sunDir)) * s.sunlight; return { luminance: 0.12 * sun + glare, light: lit(sun, s.sunlight) }; }
  return { luminance: glare, light: 0 };
}

/** The brightest thing in sight lands here before the tone mapping: bright, not burnt out. */
export const HIGHLIGHT_LEVEL = 1.5;
/**
 * In sunlight the eyes stay anchored to the light falling, not to how dark the surface it falls on is (lightness
 * constancy): white paper in the light in view shows at this level at most, so a black panel in sunlight looks black.
 */
export const ANCHOR_LEVEL = 2.5;
/** The meter looks this much wider than the view: the Sun just out of the frame still blinds. */
export const PERIPHERY = 1.5;

/**
 * The exposure the eyes would settle on for these rays: the log-average maps to mid grey, unless that would burn out
 * the brightest thing in sight (a sunlit habitat against black space, the Sun's glare), or open the eyes further than
 * the light in view allows (`ANCHOR_LEVEL`).
 */
export function exposureFor(m: Meterable, rays: readonly Vec3[], darkest: number): number {
  let sum = 0, high = darkest, light = 0;
  for (const d of rays) {
    const r = rayMeter(m, d), l = Math.max(darkest, r.luminance);
    sum += Math.log(l);
    high = Math.max(high, l);
    light = Math.max(light, r.light);
  }
  const anchored = light > 0 ? ANCHOR_LEVEL / light : Infinity;
  return Math.min(KEY / Math.exp(sum / rays.length), HIGHLIGHT_LEVEL / high, anchored);
}

/**
 * Inside, the eyes open up where the light around them is dimmer than in the open at the same hour (a wood's shade):
 * `light` is that share (1 in the open). They make up most of it, not all: a wood still looks shady. Night is not
 * metered here; the hour's own light stays as it is.
 */
export const INSIDE_MAKES_UP = 0.8;
export function insideExposure(light: number): number {
  return Math.pow(1 / Math.max(light, 0.05), INSIDE_MAKES_UP);
}

/**
 * The share of the open's light around the eye under crowns `closed` (0 … 1, `crownsClosed`), when `skyShare` of the
 * light is the air's glow, which the crowns are taken to pass (the GROUND kind lights the floor the same way).
 */
export function underCrowns(closed: number, skyShare: number, underCrowns: number): number {
  return (1 - skyShare) * (1 - (1 - underCrowns) * closed) + skyShare;
}

/** Move the exposure toward the target: about a second to adapt to light, four to open up in the dark. */
export function adapt(exposure: number, target: number, dt: number): number {
  const tau = target < exposure ? 0.6 : 4;
  return Math.exp(Math.log(exposure) + (Math.log(target) - Math.log(exposure)) * (1 - Math.exp(-dt / tau)));
}

function sphereNormal(d: Vec3, c: Vec3, r: number): Vec3 | null {
  const along = v3dot(d, c);
  if (along <= 0) return null;
  const miss2 = v3dot(c, c) - along * along;
  if (miss2 >= r * r) return null;
  const t = along - Math.sqrt(r * r - miss2);
  return v3scale(v3sub(v3scale(d, t), c), 1 / r);
}

/** Where the ray first meets the cylinder's side or caps (distance, outward normal), or null for a miss. */
function hitCylinder(c: Cylinder, d: Vec3): { t: number; n: Vec3 } | null {
  // Work in the cylinder's frame: along the axis (z) and across it.
  const o = v3scale(c.center, -1);
  const oz = v3dot(o, c.axis), dz = v3dot(d, c.axis);
  const oxy = v3sub(o, v3scale(c.axis, oz)), dxy = v3sub(d, v3scale(c.axis, dz));
  const a = v3dot(dxy, dxy), b = 2 * v3dot(oxy, dxy), q = v3dot(oxy, oxy) - c.radius * c.radius;
  let best = Infinity, n: Vec3 | null = null;
  if (a > 1e-12) {
    const disc = b * b - 4 * a * q;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && Math.abs(oz + t * dz) <= c.halfLength) { best = t; n = v3scale(v3add(v3scale(dxy, t), oxy), 1 / c.radius); }
    }
  }
  if (Math.abs(dz) > 1e-12) {
    for (const side of [-1, 1]) {
      const t = (side * c.halfLength - oz) / dz;
      if (t <= 0 || t >= best) continue;
      const p = v3add(v3scale(dxy, t), oxy);
      if (v3dot(p, p) <= c.radius * c.radius) { best = t; n = v3scale(c.axis, side); }
    }
  }
  return n ? { t: best, n } : null;
}

/**
 * Heroic stars (Arnd, 2026-10-21): like a camera or an eye, the stars fade only while the Sun is in view. Without it,
 * the eyes open for the stars however bright Earth or a hull in sunlight is (the sky itself is black: no air), until a
 * magnitude-0 star's brightest pixel shows at HEROIC_PEAK. Magnitude 6 then still shows at a 250th of it.
 */
export const HEROIC_PEAK = 10;
/** Star quads: σ of the Gaussian spot (px). The shader draws with it (skyShaders.ts); the heroic exposure counts on it. */
export const STAR_SIGMA = 0.75;

/**
 * The exposure the stars are drawn with. `sunSeen` (0–1) is how much of the Sun is in view: at 1 the stars get the
 * eyes' own exposure, at 0 the heroic one (if that is higher), and in between the two blend in log.
 */
export function starExposure(exposure: number, pixelSolidAngle: number, sunSeen: number, heroic = true): number {
  if (!heroic) return exposure;
  // A star's peak pixel: flux × π / Ω, times the Gaussian spot's centre value (STAR_SIGMA px).
  const peakPerExposure = (fluxOfMagnitude(0) * Math.PI / pixelSolidAngle) / (2 * Math.PI * STAR_SIGMA * STAR_SIGMA);
  const open = Math.max(exposure, HEROIC_PEAK / peakPerExposure);
  const s = Math.min(1, Math.max(0, sunSeen));
  return exposure * Math.pow(open / exposure, 1 - s);
}

/**
 * How much the Sun is in view (0–1), from the angle between the view's centre and the Sun and the view's half
 * diagonal (rad): 1 inside the frame, fading to 0 by the meter's periphery, times the share of its disc not eclipsed.
 */
export function sunInView(angle: number, halfDiagonal: number, sunlight: number): number {
  const t = Math.min(1, Math.max(0, (angle - halfDiagonal) / ((PERIPHERY - 1) * halfDiagonal)));
  return (1 - t * t * (3 - 2 * t)) * sunlight;
}

/**
 * Rays through the centres of a `columns` × `rows` grid over a view: unit forward, right and up, the tangent of half the
 * vertical field of view (wider than the frame for a margin), width / height. Both meters (outside and inside) use it.
 */
export function meterRays(fwd: Vec3, right: Vec3, up: Vec3, tanHalf: number, aspect: number, columns: number, rows: number): Vec3[] {
  const out: Vec3[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = ((i + 0.5) / columns * 2 - 1) * tanHalf * aspect, y = ((j + 0.5) / rows * 2 - 1) * tanHalf;
    out.push(v3norm(v3add(fwd, v3add(v3scale(right, x), v3scale(up, y)))));
  }
  return out;
}

/** The mean albedo the inside meter takes for the land (meadows, woods and rock in sight together). */
export const LAND_ALBEDO = 0.15;

/** The inside as the eyes' meter sees it: the habitat, the sunline's emission at this hour and its `sunlineNorm`, the air. */
export interface InsideMeterable {
  habitat: Habitat;
  emission: Float32Array;
  norm: number;
  /** Extinction per metre at floor density, the sky-light share, and the haze colour's luminance (materials.ts `air`). */
  extinction: number;
  sky: number;
  hazeLuminance: number;
  /** The land's height over the profile (`Terrain.heightAt`); without it the meter sees the bare profile's tube and walls. */
  heightAt?: (theta: number, s: number) => number;
}

/** Steps a ray takes toward the tube's wall looking for the land (closer together near the eye), then halvings. */
const MARCH = 16, HALVINGS = 3;

/**
 * Where a ray inside first meets the land, and the land's normal there: with `heightAt`, the first step under the
 * ground on the way to the tube's wall or an end wall (a massif near the axis, a hill), else that wall itself.
 */
function landHit(m: InsideMeterable, eye: Vec3, d: Vec3): { p: Vec3; n: Vec3 } | null {
  const h = m.habitat, R = h.radius, L = h.length;
  const a = d[0] * d[0] + d[1] * d[1], b = eye[0] * d[0] + eye[1] * d[1], c = eye[0] * eye[0] + eye[1] * eye[1] - R * R;
  let t = a > 1e-12 ? (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a : Infinity, n: Vec3 | null = null;
  if (d[2] > 1e-9 && (L - eye[2]) / d[2] < t) { t = (L - eye[2]) / d[2]; n = [0, 0, -1]; }
  else if (d[2] < -1e-9 && -eye[2] / d[2] < t) { t = -eye[2] / d[2]; n = [0, 0, 1]; }
  if (!Number.isFinite(t) || t <= 0) return null;
  const heightAt = m.heightAt;
  if (heightAt) {
    const above = (u: number): { over: number; theta: number; s: number } => {
      const q = fromWorld(h.profile, eye[0] + d[0] * u, eye[1] + d[1] * u, eye[2] + d[2] * u);
      return { over: q.h - heightAt(q.theta, q.s), theta: q.theta, s: q.s };
    };
    let lo = 0;
    for (let k = 1; k <= MARCH; k++) {
      const hi = t * Math.pow(k / MARCH, 1.5);
      if (above(hi).over >= 0) { lo = hi; continue; }
      let under = hi;
      for (let j = 0; j < HALVINGS; j++) { const mid = (lo + under) / 2; if (above(mid).over >= 0) lo = mid; else under = mid; }
      const at = above(under);
      return { p: v3add(eye, v3scale(d, under)), n: groundNormal(h.profile, at.theta, at.s) };
    }
  }
  const p: Vec3 = v3add(eye, v3scale(d, t));
  if (!n) { const r = Math.hypot(p[0], p[1]); n = [-p[0] / r, -p[1] / r, 0]; }
  return { p, n };
}

/**
 * What a ray inside sees, for the eyes' meter (same units as the shaders: white paper on the mid floor in full day is
 * 1): the land where it lands (`landHit`) at `LAND_ALBEDO`, lit by the sunline and the sky light as `sunlit` lights it
 * (close to the axis many times the floor's light), seen through the air (`hazeAlong`), plus the air's own glow. A ray
 * close past the axis gathers the sunline's halo; the line itself is a lamp, not counted.
 */
export function insideRayLuminance(m: InsideMeterable, eye: Vec3, d: Vec3): number {
  const hit = landHit(m, eye, d);
  if (!hit) return 0;
  const { p, n } = hit, h = m.habitat;
  const direct = rawIrradiance(h, m.emission, v3add(p, n), n, OPEN_SKY, OPEN_SKY, 32) * m.norm;
  const light = (1 - m.sky) * direct + m.sky * emissionMean(m.emission);
  const haze = hazeAlong(h, m.emission, m.extinction, m.sky, eye, p);
  return LAND_ALBEDO * light * haze.transmittance + m.hazeLuminance * haze.inscatter;
}

/**
 * Past this level of a view's brightest quarter of rays the eyes stop down. In the reference habitat, views along the
 * floor stay under it all day; looking up at the far side at noon (about 0.8) the eyes stop down by a fifth; in a
 * habitat wider than that, with more air to glow, sooner. Near the axis the sunline lights the air around the eye about
 * R / r times as strongly as on the floor, and toward the travelling sun twice that again, so looking down the tube
 * from the hub the glowing air would burn out to white (docs/far-view.md). Arnd (2026-10-21): eyes adapt, the glow stays.
 */
export const BRIGHT_VIEW = 0.6;

/**
 * The share (≤ 1) the eyes stop down to for a view inside: the log-average of its brightest quarter of rays against
 * `BRIGHT_VIEW`, made up by `INSIDE_MAKES_UP` as the shade is the other way (`insideExposure`). Ordinary views on the
 * floor stay at 1; the eyes never open past it here (night and shade are the hour's and `insideExposure`'s).
 */
export function insideGlare(m: InsideMeterable, eye: Vec3, rays: readonly Vec3[]): number {
  return glareOf(rays.map((d) => insideRayLuminance(m, eye, d)));
}

/** `insideGlare` from the rays' luminances (the view meters a few rays a frame and keeps the rest from before). */
export function glareOf(seen: ArrayLike<number>): number {
  const sorted = Array.from(seen, (l) => Math.max(1e-6, l)).sort((x, y) => y - x);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
  const bright = Math.exp(top.reduce((sum, l) => sum + Math.log(l), 0) / top.length);
  return Math.min(1, Math.pow(BRIGHT_VIEW / bright, INSIDE_MAKES_UP));
}
