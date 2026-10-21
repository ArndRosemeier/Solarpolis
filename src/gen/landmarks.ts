/**
 * The landmarks (Arnd, 2026-10-21: the surface is park and nature reserve with only a few landmark buildings): where
 * each one stands and how big it is, from the blueprint's `landmarks` and the land. Each one is placed by a rule, not
 * by chance, so the layout can be designed, each on its site in the habitat plan (gen/plan.ts):
 *
 * - the assembly pavilion (gen/pavilion.ts builds it) on the lake-pavilion site: in the ring lake's middle, where the
 *   Sunwalk crosses it, clear of the rivers, with a bridge to each shore along the axis, so the Sunwalk runs through;
 * - the summit hut (gen/summitHut.ts) on the summit-hut site, high on the Mountain's cliff, looking down the cylinder:
 *   set out from the rock where the rock comes farthest out over its height, the gap filled by its anchor, and its
 *   struts run back until they bury.
 *
 * The Lift Stair streams in tiles of its own (gen/liftStair.ts); its standing and its plants are folded in here. Pure.
 */
import { fromWorld, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { deriveSeed, v3add, v3dot, v3scale, v3sub } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { buildPavilion, pavilionPlan, pavilionTop, roofAt, type LandmarkLevel } from './pavilion';
import { buildHut, hutBounds, hutPlan, hutScale, hutTop, strutDir, strutFeet } from './summitHut';
import { planOf, siteOf } from './plan';
import { intoPlace, outOfPlace, placeAt, type Place, type Shape } from './shapes';
import { kept } from './kept';
import { stairKeepsClear, stairStandAt } from './liftStair';
import { standThrough } from './standing';
import { courtTopAt } from './courts';

/** A bridge along the axis from the deck's edge (`from`, m from the centre) to the shore (`to`), `end` m over the water there. */
export interface Bridge {
  /** Toward the port end (+1, along +z) or the wild end (−1). */
  dir: 1 | -1;
  from: number;
  to: number;
  end: number;
}

export interface Pavilion {
  kind: 'pavilion';
  /** Its centre on the profile, and its frame's height above the profile there: the lake's surface. */
  theta: number;
  s: number;
  level: number;
  /** The deck's radius and the handrail's height (m). */
  radius: number;
  handrail: number;
  /** How deep the lake is under it. */
  depth: number;
  bridges: Bridge[];
  seed: number;
}

export interface Hut {
  kind: 'hut';
  theta: number;
  s: number;
  /**
   * Its frame: standing `level` over the profile at (θ, s) (the rock's face there), turned by `facing` (0 looks toward
   * +s, π/2 spinward), and moved `shift` out along its x, so that x = 0 is the hall's back wall.
   */
  level: number;
  facing: number;
  shift: number;
  handrail: number;
  /** How much its lengths are shrunk to fit the site (gen/summitHut.ts `hutScale`). */
  scale: number;
  /** In its frame: the anchor's back, buried in the rock (x < 0), and its foot (z < 0). */
  back: number;
  foot: number;
  /** Its struts: from under the deck back down to where they bury in the anchor or the rock. */
  struts: { from: Vec3; to: Vec3 }[];
  seed: number;
}

export type Landmark = Pavilion | Hut;

/** The landmarks of a terrain (placed once per terrain, then kept). */
export const landmarksOf: (t: Terrain) => readonly Landmark[] = kept(placeLandmarks);

export function placeLandmarks(t: Terrain): Landmark[] {
  const out: Landmark[] = [];
  const pavilion = placePavilion(t), hut = placeHut(t);
  if (pavilion) out.push(pavilion);
  if (hut) out.push(hut);
  return out;
}

function placePavilion(t: Terrain): Pavilion | null {
  const h = t.habitat, spec = h.params.landmarks, lake = t.lake;
  const site = spec && lake ? siteOf(planOf(h), 'lake-pavilion') : undefined;
  if (!spec || !lake || !site) return null;
  // The deck within the ground the plan keeps for it.
  const radius = Math.min(spec.size / 2, site.size);
  if (radius < spec.handrail * 5) return null;
  const p: Pavilion = { kind: 'pavilion', theta: site.theta, s: site.s, level: lake.level, radius, handrail: spec.handrail, depth: lake.depth, bridges: [], seed: deriveSeed(h.seed, 'landmark', 'pavilion') };
  p.bridges = ([1, -1] as const).map((dir) => bridgeTo(t, p, dir));
  return p;
}

/**
 * The summit hut on its site: out from the rock face. The hall stands where the face comes farthest out over the
 * hut's width and height (so no rock pokes into it); its anchor fills back to where the face goes deepest, and on into
 * the rock; each strut runs back and down from under the deck until it meets the anchor or the rock. Null without a
 * site, where the site is too small for even a bivouac, or where there is no rock face to hang it on.
 */
function placeHut(t: Terrain): Hut | null {
  const h = t.habitat, spec = h.params.landmarks, site = spec ? siteOf(planOf(h), 'summit-hut') : undefined;
  const scale = spec && site ? hutScale(site.size, spec.handrail) : null;
  if (!spec || !site || scale === null) return null;
  const hr = spec.handrail, q = hutPlan(hr, scale);
  const hut: Hut = {
    kind: 'hut', theta: site.theta, s: site.s, level: t.heightAt(site.theta, site.s), facing: site.facing, shift: 0,
    handrail: hr, scale, back: 0, foot: 0, struts: [], seed: deriveSeed(h.seed, 'landmark', 'hut'),
  };
  const at = frameOf(h, hut);
  const rock = (p: Vec3): boolean => { const a = fromWorld(h.profile, ...outOfPlace(at, p)); return a.h < t.heightAt(a.theta, a.s); };
  const far = q.reach * 1.5;
  /**
   * Where a line along x at (y, z), coming in from out in front, first meets the rock: from `from` (far out, or a
   * little out from the neighbouring line's answer), stepping out first if that is still in the rock; far out if it
   * never leaves the rock, −far if it never meets it.
   */
  const faceAt = (y: number, z: number, from = far): number => {
    let x = from;
    while (x < far && rock([x, y, z])) x += hr * 2;
    if (rock([x, y, z])) return far;
    for (; x > -far; x -= hr) {
      if (!rock([x - hr, y, z])) continue;
      let lo = x - hr, hi = x;
      for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (rock([m, y, z])) lo = m; else hi = m; }
      return hi;
    }
    return -far;
  };
  const across = [-1, -0.5, 0, 0.5, 1].map((u) => u * q.span);
  /** The face along lines at every `across`, at n + 1 heights from z0 to z1: each line starts near its neighbour's answer. */
  const faces = (z0: number, z1: number, n: number): number[] => across.flatMap((y) => {
    let last = far;
    return Array.from({ length: n + 1 }, (_, i) => {
      last = faceAt(y, z0 + ((z1 - z0) * i) / n, last >= far || last <= -far ? far : last + hr * 2);
      return last;
    });
  });
  const front = Math.max(...faces(-q.slab - q.course, q.top + q.flue, 6));
  if (front >= far || front <= -far) return null;
  hut.shift = front;
  const inRock = (p: Vec3): boolean => rock([p[0] + front, p[1], p[2]]);
  // Each strut back and down until it is in the anchor (behind the back wall) or the rock, and a little on.
  const dir = strutDir(q), step = hr * 0.25;
  for (const from of strutFeet(q)) {
    let k = 0;
    while (k < far * 2 && v3add(from, v3scale(dir, k))[0] > 0 && !inRock(v3add(from, v3scale(dir, k)))) k += step;
    hut.struts.push({ from, to: v3add(from, v3scale(dir, k + q.strut * 2)) });
  }
  const knees = hut.struts.filter((st) => st.to[0] <= 0).map((st) => st.to[2]);
  hut.foot = Math.min(-q.slab - q.courses * q.course, ...knees) - hr;
  hut.back = Math.max(-q.reach, Math.min(...faces(hut.foot, q.top + q.flue, 8)) - front - q.bury);
  return hut;
}

/** A bridge from the deck to the shore in one direction: out to where the ground is dry, and a little onto it. */
function bridgeTo(t: Terrain, p: Pavilion, dir: 1 | -1): Bridge {
  const hr = p.handrail, lake = t.lake!;
  let x = p.radius;
  const limit = lake.halfWidth * 2;
  while (x < limit && t.heightAt(p.theta, p.s + dir * x) <= p.level + hr * 0.2) x += hr;
  const to = x + hr * 2;
  return { dir, from: p.radius, to, end: Math.max(0, t.heightAt(p.theta, p.s + dir * to) - p.level) };
}

/**
 * The frame a landmark is built in, in the world (`intoPlace`, `outOfPlace`), z toward the axis (up): the pavilion's
 * centre on the water, x (`ex`) along the axis, y around; the hut's back wall at its floor, x out toward the view.
 */
export function frameOf(h: Habitat, l: Landmark): Place {
  const f = placeAt(h, l.theta, l.s, l.level);
  if (l.kind !== 'hut') return f;
  const c = Math.cos(l.facing), sn = Math.sin(l.facing);
  const ex = v3add(v3scale(f.ex, c), v3scale(f.ey, sn)), ey = v3add(v3scale(f.ex, -sn), v3scale(f.ey, c));
  return { at: v3add(f.at, v3scale(ex, l.shift)), ex, ey, ez: f.ez };
}

/** A landmark at one of its levels, in its frame (`frameOf`), as a mapped and coloured shape. */
export function buildLandmark(l: Landmark, level: LandmarkLevel): Shape {
  return l.kind === 'hut' ? buildHut(l, level) : buildPavilion(l, level);
}

/**
 * How the view sees a landmark: the size (m) of the finest parts the near and mid levels add (each level takes over
 * where they would be about a pixel wide), the roof's shelter for the BUILT kind (`userData.roof`: outer radius,
 * eaves, oculus radius and height, in its frame), and how far a point of its frame is from its nearest part.
 */
export interface Sight {
  near: number;
  mid: number;
  roof: readonly [number, number, number, number];
  away(p: Vec3): number;
}

export function sightOf(l: Landmark): Sight {
  if (l.kind === 'hut') {
    const q = hutPlan(l.handrail, l.scale), b = hutBounds(l);
    const away = (p: Vec3): number => Math.hypot(...[0, 1, 2].map((a) => Math.max(0, b.lo[a] - p[a], p[a] - b.hi[a])));
    // Near: the railings' posts and cables; mid: the posts and struts. Sheltered from the sunline under the hall's roof.
    return { near: l.handrail * 0.07, mid: q.post, roof: [q.length + q.over, q.eaves, 0, 0], away };
  }
  const q = pavilionPlan(l);
  /** Under or over the roof's disc, or by one of its bridges. */
  const away = ([x, y, z]: Vec3): number => {
    let across = Math.max(0, Math.hypot(x, y) - q.reach);
    for (const b of l.bridges) {
      const along = x * b.dir, past = along < b.from ? b.from - along : along > b.to ? along - b.to : 0;
      across = Math.min(across, Math.hypot(past, Math.max(0, Math.abs(y) - q.bridge / 2)));
    }
    return Math.hypot(across, Math.max(0, z - q.eaves, -z));
  };
  // Near: the railings' posts and cables (a few centimetres); mid: the seats' risers and the piers.
  return { near: q.handrail * 0.07, mid: q.riser, roof: [q.reach, roofAt(q, q.reach) - q.shell, q.oculus, roofAt(q, q.oculus) - q.shell], away };
}

/** How far out from its frame's origin a landmark reaches: bridges and eaves, or the hut's anchor and struts (m). */
export function reachOf(l: Landmark): number {
  if (l.kind === 'hut') {
    const b = hutBounds(l), feet = l.struts.map((st) => Math.hypot(...st.to));
    return Math.max(Math.hypot(Math.max(-b.lo[0], b.hi[0]), b.hi[1], Math.max(-b.lo[2], b.hi[2])), ...feet);
  }
  return Math.max(pavilionPlan(l).reach, ...l.bridges.map((b) => b.to));
}

/** Where a point (θ, s) lies in the pavilion's frame, across the floor (its height left out). */
function across(h: Habitat, l: Pavilion, theta: number, s: number): [number, number] {
  const q = intoPlace(frameOf(h, l), toWorld(h.profile, { theta, s, h: l.level }));
  return [q[0], q[1]];
}

/**
 * Whether (θ, s) is certainly far from a landmark: more than twice its reach (and `margin`) away along the profile or
 * around it. The cheap test before the ground's height is asked for.
 */
const wellAway = (h: Habitat, l: Landmark, theta: number, s: number, margin: number): boolean => {
  const wide = (reachOf(l) + margin) * 2, turn = Math.abs(Math.atan2(Math.sin(theta - l.theta), Math.cos(theta - l.theta)));
  return Math.abs(s - l.s) > wide || turn * h.profile.at(l.s).r > wide;
};

/** Whether a point of the world is near a landmark at all: within its reach of its frame's origin (a cheap first test). */
const near = (f: Place, l: Landmark, p: Vec3, margin: number): boolean => {
  const d = v3sub(p, f.at);
  return v3dot(d, d) < (reachOf(l) + margin) ** 2;
};

/**
 * Whether plants keep off a point: under a landmark or the Lift Stair, or by a bridge's landing (a few handrails
 * around it), so nothing grows through the deck or the steps or blocks the way onto them.
 */
export function keptClear(t: Terrain, theta: number, s: number): boolean {
  const h = t.habitat;
  if (h.params.landmarks && stairKeepsClear(h, theta, s, h.params.landmarks.handrail * 2)) return true;
  // The entrance courts and their clear ring (gen/courts.ts).
  if (t.courtAt(theta, s)) return true;
  for (const l of landmarksOf(t)) {
    if (l.kind === 'hut') {
      // Its whole box, a few handrails out: on the face of the rock the ground runs up past it, not under it.
      const m = l.handrail * 3;
      if (wellAway(h, l, theta, s, m)) continue;
      const f = frameOf(h, l), g = toWorld(h.profile, { theta, s, h: t.heightAt(theta, s) });
      if (!near(f, l, g, m)) continue;
      const p = intoPlace(f, g), b = hutBounds(l);
      if ([0, 1, 2].every((a) => p[a] > b.lo[a] - m && p[a] < b.hi[a] + m)) return true;
      continue;
    }
    if (Math.abs(s - l.s) > reachOf(l) + l.handrail * 4) continue;
    const [x, y] = across(h, l, theta, s), q = pavilionPlan(l), margin = l.handrail * 3;
    if (Math.hypot(x, y) < q.reach + margin) return true;
    for (const b of l.bridges) if (x * b.dir > 0 && x * b.dir < b.to + margin && Math.abs(y) < q.bridge / 2 + margin) return true;
  }
  return false;
}

/**
 * The height above the profile of the walkable top of a landmark over (θ, s), or null where none is: the deck, the
 * seats, the bridges, the Lift Stair's steps and platforms. Someone set down there stands on it, not in the water or
 * the slope under it.
 */
export function landmarkTopAt(t: Terrain, theta: number, s: number): number | null {
  const h = t.habitat, stair = stairStandAt(h, theta, s);
  if (stair !== null) return stair;
  const court = courtTopAt(t, theta, s);
  if (court !== null) return court;
  for (const l of landmarksOf(t)) {
    if (l.kind === 'hut') {
      // Up the profile's normal (it leans far from true up on the cliff) to where it comes out through the floor.
      const r = reachOf(l);
      if (wellAway(h, l, theta, s, r)) continue;
      const f = frameOf(h, l), g = t.heightAt(theta, s);
      if (!near(f, l, toWorld(h.profile, { theta, s, h: g }), r)) continue;
      const top = standThrough(h, theta, s, g - r, g + r, l.handrail / 4, (w) => {
        const p = intoPlace(f, w), z = hutTop(l, p[0], p[1]);
        return z === null ? null : z - p[2];
      });
      if (top !== null) return top;
      continue;
    }
    if (Math.abs(s - l.s) > reachOf(l)) continue;
    const f = frameOf(h, l), [x, y] = across(h, l, theta, s), z = pavilionTop(l, x, y);
    if (z === null) continue;
    return fromWorld(h.profile, ...outOfPlace(f, [x, y, z])).h;
  }
  return null;
}
