/**
 * The habitat frame: converting between world positions and the interior's own coordinates (θ, s, h).
 *
 * World axes (rotating with the habitat, so nothing in it spins): +z runs along the axis from the wild endcap wall
 * (z = 0) to the port endcap wall (z = L); x and y span the cross-section, with θ measured from +x towards +y.
 * The habitat spins about +z in the positive θ direction, so "spinward" is +θ.
 */
import type { Profile } from './profile';

/** A position in the interior's own coordinates: angle around the axis, distance along the profile, height above it. */
export interface Interior {
  theta: number;
  s: number;
  h: number;
}

export type Vec3 = [number, number, number];

const TAU = Math.PI * 2;

/** θ in [0, 2π). */
export function wrapAngle(theta: number): number {
  const t = theta % TAU;
  return t < 0 ? t + TAU : t;
}

/** The world position of an interior point. */
export function toWorld(profile: Profile, at: Interior): Vec3 {
  const p = profile.at(at.s);
  const r = p.r + at.h * p.nr, z = p.z + at.h * p.nz;
  return [r * Math.cos(at.theta), r * Math.sin(at.theta), z];
}

/** The interior coordinates of a world position (its nearest point on the profile, and the height above it). */
export function fromWorld(profile: Profile, x: number, y: number, z: number): Interior {
  const r = Math.hypot(x, y);
  const { s, h } = profile.nearest(z, r);
  return { theta: wrapAngle(Math.atan2(y, x)), s, h };
}

/** The ground's unit normal at an interior point, in world axes (it points into the air). */
export function groundNormal(profile: Profile, theta: number, s: number): Vec3 {
  const p = profile.at(s);
  return [p.nr * Math.cos(theta), p.nr * Math.sin(theta), p.nz];
}
