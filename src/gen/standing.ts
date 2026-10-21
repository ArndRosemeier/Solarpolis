/**
 * Where someone set down over a point of the land stands on something built there (the Lift Stair, the summit hut):
 * up the profile's normal through (θ, s), the height where that line first comes out through the thing's walkable
 * top. On the endcaps the normal leans far from true up, so this is a line through the built thing, not a drop onto
 * it. Pure.
 */
import { toWorld, type Habitat, type Vec3 } from '../blueprint';

/**
 * The height above the profile at (θ, s), between `from` and `to`, where the line up the normal first leaves a built
 * thing through its top, or null where it never does. `under(p)` says how far under the walkable top a world point is
 * (> 0 inside, ≤ 0 over it), or null where it is off the thing. Walked in `step`s, then halved to a millimetre or so.
 */
export function standThrough(h: Habitat, theta: number, s: number, from: number, to: number, step: number, under: (p: Vec3) => number | null): number | null {
  const depthAt = (k: number): number | null => under(toWorld(h.profile, { theta, s, h: k }));
  let inside = (depthAt(from) ?? -1) > 0;
  for (let k = from + step; k <= to; k += step) {
    const u = depthAt(k);
    if (u !== null && u <= 0 && inside) {
      let lo = k - step, hi = k;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if ((depthAt(m) ?? -1) > 0) lo = m; else hi = m; }
      return hi;
    }
    inside = u !== null && u > 0;
  }
  return null;
}
