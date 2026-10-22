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
 *
 * `clear(a, b)`, if given, says that no part of the thing comes near the stretch of the line from a to b: the walk then
 * skips what is clear, a half at a time (the whole line, its halves, their halves… down to `COARSE` steps), and walks
 * step by step only where it might meet the thing. A long line past a big thing, like the Lift Stair, is mostly far
 * from it; the steps walked, and so the answer, are the same as without `clear`.
 */
export function standThrough(h: Habitat, theta: number, s: number, from: number, to: number, step: number, under: (p: Vec3) => number | null, clear?: (a: Vec3, b: Vec3) => boolean): number | null {
  const lineAt = (k: number): Vec3 => toWorld(h.profile, { theta, s, h: k });
  const depthAt = (k: number): number | null => under(lineAt(k));
  let inside = (depthAt(from) ?? -1) > 0;
  const long = step * COARSE, stretches = Math.ceil((to - from) / long - 1e-9);
  const edge = (i: number): number => Math.min(to, from + i * long);
  // Stretches i … j-1, in order: skipped where clear, else halved, and walked step by step one stretch at a time.
  const walk = (i: number, j: number): number | null => {
    const k0 = edge(i), k1 = edge(j);
    if (clear && clear(lineAt(k0), lineAt(k1))) { inside = false; return null; }
    if (j - i > 1) { const m = (i + j) >> 1; return walk(i, m) ?? walk(m, j); }
    for (let k = k0 + step; k <= k1 + 1e-9; k += step) {
      const u = depthAt(k);
      if (u !== null && u <= 0 && inside) {
        let lo = k - step, hi = k;
        for (let n = 0; n < 12; n++) { const m = (lo + hi) / 2; if ((depthAt(m) ?? -1) > 0) lo = m; else hi = m; }
        return hi;
      }
      inside = u !== null && u > 0;
    }
    return null;
  };
  return stretches > 0 ? walk(0, stretches) : null;
}

/** Steps in one stretch of a walk with `clear`. */
const COARSE = 16;
