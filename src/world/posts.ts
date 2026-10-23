/**
 * Where the guardians wait (design "Nobody falls far"): along every drop that would hurt, perched on the brink like
 * hawks on a crag, one per `Guard.posts` m. The habitat is cut into cells that size, rows along the profile and as
 * many around the axis as fit at each row's radius; in each cell a few seeded spots are tried and the one over the
 * deepest drop holds the cell's post, if it stands on a cliff at all: the footing falls away steeply right beside it
 * (`EDGE`) and keeps falling further out (`OUT`), measured down the spin's gravity (away from the axis). Built tops
 * count (the Threshold's galleries, the Lift Stair, the hut's deck), so their edges have posts too. The same cells
 * give the same posts every time. Pure.
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import { toWorld, wrapAngle, type Habitat, type Vec3 } from '../blueprint';
import { overFloor } from '../gen/capsules';
import type { Footing } from './fall';

/**
 * A guardian's post: where it perches (world), its (θ, s), how far the ground falls away beside it (m), and which way
 * it falls (radians along the ground: 0 toward +s, π/2 toward +θ).
 */
export interface Post {
  p: Vec3;
  theta: number;
  s: number;
  drop: number;
  toward: number;
}

/** Seeded spots tried per cell; directions looked down from each. */
const SPOTS = 4;
const DIRECTIONS = 8;
/** A cliff: within `EDGE` m the footing falls at least `STEEP` m per m; by `OUT` m it has fallen `DEEP` m (or what would hurt there). */
const EDGE = 3;
const STEEP = 1.4;
const OUT = 12;
const DEEP = 8;
/** A post perches this far over its spot (m). */
const PERCH = 0.4;

/** The posts within `reach` m (along the profile and around the axis) of (θ, s), nearest first. */
export function postsNear(h: Habitat, footing: Footing, theta: number, s: number, reach: number): Post[] {
  const c = h.params.life.guard.posts, L = h.profile.length;
  const out: { post: Post; d: number }[] = [];
  const i0 = Math.max(0, Math.floor((s - reach) / c)), i1 = Math.min(Math.ceil(L / c) - 1, Math.floor((s + reach) / c));
  for (let i = i0; i <= i1; i++) {
    const r = Math.max(1, h.profile.at(Math.min(L, (i + 0.5) * c)).r), n = Math.max(1, Math.round((2 * Math.PI * r) / c));
    const wide = Math.min(n, Math.ceil((reach / (2 * Math.PI * r)) * n) + 1), j0 = Math.floor((wrapAngle(theta) / (2 * Math.PI)) * n);
    for (let dj = -wide; dj <= wide; dj++) {
      if (2 * wide + 1 > n && (dj < -Math.floor(n / 2) || dj > Math.floor((n - 1) / 2))) continue;
      const j = (((j0 + dj) % n) + n) % n, post = postOf(h, footing, i, j, n, c);
      if (!post) continue;
      const d = overFloor(h, theta, s, post.theta, post.s);
      if (d <= reach) out.push({ post, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.post);
}

/** The post of cell (i, j) of a row of n cells around, or null where no spot in it stands on a cliff. */
export function postOf(h: Habitat, footing: Footing, i: number, j: number, n: number, c: number): Post | null {
  const L = h.profile.length, seed = h.seed, harm = h.params.life.guard.harm;
  let best: Post | null = null;
  for (let k = 0; k < SPOTS; k++) {
    const s = Math.min(L, (i + hashToFloat(hash3i(seed, i, j, 31 + k))) * c);
    const theta = ((j + hashToFloat(hash3i(seed, i, j, 37 + k))) / n) * 2 * Math.PI;
    const top = footing(theta, s, Infinity).h, p = toWorld(h.profile, { theta, s, h: top }), r = Math.hypot(p[0], p[1]);
    // What would hurt here: a fall from this high, at the gravity here, lands at the harmful speed.
    const hurts = Math.min(DEEP, (harm * harm) / (2 * Math.max(1e-3, h.gravityAt(r))));
    const rad = Math.max(1, h.profile.at(s).r);
    let drop = 0, toward = 0;
    for (let d = 0; d < DIRECTIONS; d++) {
      const a = (2 * Math.PI * d) / DIRECTIONS;
      if (dropAt(h, footing, theta, s, a, EDGE, rad, r) < STEEP * EDGE) continue;
      const far = dropAt(h, footing, theta, s, a, OUT, rad, r);
      if (far >= hurts && far > drop) { drop = far; toward = a; }
    }
    if (drop > 0 && (!best || drop > best.drop)) best = { p: toWorld(h.profile, { theta, s, h: top + PERCH }), theta, s, drop, toward };
  }
  return best;
}

/** How far the footing lies down the spin's gravity (radially out) at `d` m from (θ, s) in direction `a` (0: along +s). */
function dropAt(h: Habitat, footing: Footing, theta: number, s: number, a: number, d: number, rad: number, r: number): number {
  const ss = Math.min(h.profile.length, Math.max(0, s + d * Math.cos(a))), th = theta + (d * Math.sin(a)) / rad;
  const q = toWorld(h.profile, { theta: th, s: ss, h: footing(th, ss, Infinity).h });
  return Math.hypot(q[0], q[1]) - r;
}
