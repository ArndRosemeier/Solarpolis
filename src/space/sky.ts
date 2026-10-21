/**
 * What the sky holds, seen from a point in any frame: the Sun's direction and size, Earth and the Moon as spheres
 * (centre relative to the eye, radius, and their own surface axes for textures), and how much of the Sun's disc is
 * left uncovered by them (eclipses). Pure; the renderer turns it into uniforms.
 */
import { v3len, v3norm, v3scale, v3sub, v3cross, type Vec3 } from '@futuremagic/core';
import { EARTH, MOON, SUN } from './constants';
import type { Mat3 } from './pose';
import type { Space } from './space';

export interface SkyBody {
  /** Centre relative to the eye, in the frame's axes (m). */
  center: Vec3;
  radius: number;
  /** The body's own axes in the frame (Earth: x to Greenwich, z north; Moon: x to Earth, z near the ecliptic pole). */
  axes: Mat3;
}

export interface SkyView {
  /** Unit direction to the Sun, its angular radius (rad) and distance (m). */
  sunDir: Vec3;
  sunRadius: number;
  sunDistance: number;
  earth: SkyBody;
  moon: SkyBody;
  /** Share of the Sun's disc not hidden by Earth or the Moon (0–1). */
  sunlight: number;
}

/** Area of the overlap of two circles of radii a and b whose centres are d apart. */
export function circleOverlap(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const ca = Math.min(1, Math.max(-1, (d * d + a * a - b * b) / (2 * d * a)));
  const cb = Math.min(1, Math.max(-1, (d * d + b * b - a * a) / (2 * d * b)));
  return a * a * Math.acos(ca) + b * b * Math.acos(cb) - 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
}

const angle = (u: Vec3, v: Vec3): number => Math.atan2(v3len(v3cross(u, v)), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);

/** The sky seen from `eye` (a position in `frame`) at clock time t. */
export function skyFrom(space: Space, frame: string, eye: Vec3, t: number): SkyView {
  const f = space.frames;
  const sun = v3sub(f.position([0, 0, 0], 'sun', frame, t), eye);
  const earthC = v3sub(f.position([0, 0, 0], 'earth', frame, t), eye);
  const moonC = v3sub(f.position([0, 0, 0], 'moon', frame, t), eye);
  const sunDistance = v3len(sun), sunDir = v3scale(sun, 1 / sunDistance);
  const sunRadius = Math.asin(SUN.radius / sunDistance);
  // The Moon keeps one face to Earth: its x axis points at Earth, z as near the ecliptic pole as that allows.
  const mx = v3norm(v3sub(earthC, moonC));
  const north = f.direction([0, 0, 1], 'sun', frame, t);
  const my = v3norm(v3cross(north, mx)), mz = v3cross(mx, my);
  const moonAxes: Mat3 = [mx[0], my[0], mz[0], mx[1], my[1], mz[1], mx[2], my[2], mz[2]];
  return {
    sunDir, sunRadius, sunDistance,
    earth: { center: earthC, radius: EARTH.radius, axes: f.relative('earth.fixed', frame, t).axes },
    moon: { center: moonC, radius: MOON.radius, axes: moonAxes },
    sunlight: sunlightFrom(sun, earthC, moonC),
  };
}

/** Share of the Sun's disc not hidden by Earth or the Moon, from their centres relative to a point (any axes, m). */
export function sunlightFrom(sun: Vec3, earth: Vec3, moon: Vec3): number {
  const sunDistance = v3len(sun), sunDir = v3scale(sun, 1 / sunDistance);
  const sunRadius = Math.asin(SUN.radius / sunDistance);
  let hidden = 0;
  for (const [c, r] of [[earth, EARTH.radius], [moon, MOON.radius]] as const) {
    const dist = v3len(c);
    if (dist < r) return 0;
    hidden += circleOverlap(sunRadius, Math.asin(r / dist), angle(sunDir, v3scale(c, 1 / dist)));
  }
  return Math.max(0, 1 - hidden / (Math.PI * sunRadius * sunRadius));
}
