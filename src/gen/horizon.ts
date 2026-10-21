/**
 * Terrain shadow from the sunline. Seen from a ground point, the whole axis lies in the plane through the point and the
 * axis (its meridian), so whatever hides part of the sunline is ground in that plane: the same θ, other s. Walking
 * out along the profile both ways, each piece of ground nearer the axis than the point cuts off the axis beyond where
 * the line from the point over it meets the axis. The lowest such cut on each side is that side's horizon angle,
 * measured from the straight-in direction (src/world/sunline.ts explains the light integral that uses them).
 *
 * The walk takes steps growing geometrically, from about a metre to the whole profile, so near banks and the far
 * endcap both count. Pure.
 */
import type { Terrain } from './terrain';

/** An open view: no ground in the way toward that end. */
export const OPEN_SKY = Math.PI / 2;

/** The first step (m) and how much each step grows: near detail is the normals' job, so a metre is enough. */
const FIRST_STEP = 1;
const GROWTH = 1.45;

/** The two horizon angles at (θ, s): toward the port end (+z) and toward the wild end (−z), in radians. */
export function horizonAt(terrain: Terrain, theta: number, s: number): [number, number] {
  const { profile } = terrain.habitat;
  const point = (si: number): [number, number] => {
    const pp = profile.at(si), h = terrain.heightAt(theta, si);
    return [pp.z + pp.nz * h, pp.r + pp.nr * h];
  };
  const [zP, rP] = point(s);
  const side = (dir: 1 | -1): number => {
    let best = OPEN_SKY;
    for (let d = FIRST_STEP; ; d *= GROWTH) {
      const si = s + dir * d;
      const end = si <= 0 || si >= profile.length;
      const [zQ, rQ] = point(Math.min(profile.length, Math.max(0, si)));
      if (rQ < rP - 1e-6) {
        // The line from P over Q meets the axis at zHit; the angle to it, signed toward this side.
        const zHit = zP + ((zQ - zP) * rP) / (rP - rQ);
        best = Math.min(best, Math.atan2(dir * (zHit - zP), rP));
      }
      if (end) break;
    }
    return best;
  };
  return [side(1), side(-1)];
}
