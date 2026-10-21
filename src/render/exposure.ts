/**
 * The eye's adaptation outside: how bright the view is, metered on a coarse grid of rays against what the sky holds
 * (sunlit Earth, the Moon, the habitat's hull, the Sun's glare), and an exposure that follows it in log space as eyes
 * do, quickly toward the light and slowly into the dark. No three.js here, so the tests run it headless.
 *
 * Units as in skyShaders.ts: white paper in full sunlight is 1.
 */
import { v3add, v3cross, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { SkyView } from '../space';

/** The eye's glare around the Sun: strength (radiance × rad²) and how far it reaches (rad). The sky shader draws the same. */
export const GLARE = 6e-4;
export const GLARE_REACH = 0.15;

/** Mid grey: the metered log-average maps to this before the tone mapping. */
export const KEY = 0.18;
/** The faintest scene the eyes adapt to: plain eyes, and the "night eyes" augmentation. */
export const DARKEST = { plain: 1e-5, nightEyes: 1e-7 };

export interface Meterable {
  sky: SkyView;
  /** The habitat as a cylinder: centre relative to the eye, unit axis, radius, half length (m). */
  hull: { center: Vec3; axis: Vec3; radius: number; halfLength: number } | null;
  /** Irradiance from Earth on the hull, relative to full sunlight. */
  earthshine: number;
}

/** What a ray along unit d sees, as a luminance. */
export function rayLuminance(m: Meterable, d: Vec3): number {
  const s = m.sky;
  const a = v3len(v3cross(d, s.sunDir));
  const glare = v3dot(d, s.sunDir) > 0 ? GLARE / (a * a + s.sunRadius ** 2) * Math.exp(-a / GLARE_REACH) * s.sunlight : 0;
  const h = m.hull ? hitCylinder(m.hull, d) : null;
  if (h) return 0.08 * (Math.max(0, v3dot(h, s.sunDir)) * s.sunlight + m.earthshine) + glare;
  const earth = sphereNormal(d, s.earth.center, s.earth.radius);
  if (earth) return 0.3 * Math.max(0, v3dot(earth, s.sunDir)) * s.sunlight + 1e-5 + glare;
  const moon = sphereNormal(d, s.moon.center, s.moon.radius);
  if (moon) return 0.12 * Math.max(0, v3dot(moon, s.sunDir)) * s.sunlight + glare;
  return glare;
}

/** The brightest thing in sight lands here before the tone mapping: bright, not burnt out. */
export const HIGHLIGHT_LEVEL = 1.5;
/** The meter looks this much wider than the view: the Sun just out of the frame still blinds. */
export const PERIPHERY = 1.5;

/**
 * The exposure the eyes would settle on for these rays: the log-average maps to mid grey, unless that would burn out
 * the brightest thing in sight (a sunlit habitat against black space, the Sun's glare), which then sets it.
 */
export function exposureFor(m: Meterable, rays: readonly Vec3[], darkest: number): number {
  let sum = 0, high = darkest;
  for (const d of rays) {
    const l = Math.max(darkest, rayLuminance(m, d));
    sum += Math.log(l);
    high = Math.max(high, l);
  }
  return Math.min(KEY / Math.exp(sum / rays.length), HIGHLIGHT_LEVEL / high);
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

/** The outward normal where the ray first meets the cylinder's side or caps, or null for a miss. */
function hitCylinder(c: NonNullable<Meterable['hull']>, d: Vec3): Vec3 | null {
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
  return n;
}
