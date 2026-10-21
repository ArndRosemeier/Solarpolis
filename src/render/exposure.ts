/**
 * The eye's adaptation outside: how bright the view is, metered on a coarse grid of rays against what the sky holds
 * (sunlit Earth, the Moon, the habitat's hull, the Sun's glare), and an exposure that follows it in log space as eyes
 * do, quickly toward the light and slowly into the dark. No three.js here, so the tests run it headless.
 *
 * Units as in skyShaders.ts: white paper in full sunlight is 1.
 */
import { v3add, v3cross, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { fluxOfMagnitude, type SkyView } from '../space';

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
