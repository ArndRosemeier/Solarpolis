/**
 * The landmarks (Arnd, 2026-10-21: the surface is park and nature reserve with only a few landmark buildings): where
 * each one stands and how big it is, from the blueprint's `landmarks` and the land. Each one is placed by a rule, not
 * by chance, so the layout can be designed: for now the one landmark is the assembly pavilion (gen/pavilion.ts draws
 * it), on the habitat plan's lake-pavilion site (gen/plan.ts: in the ring lake's middle, where the Sunwalk crosses
 * it, clear of the rivers), with a bridge to each shore along the axis, so the Sunwalk runs through it. Pure.
 */
import { fromWorld, toWorld, type Habitat } from '../blueprint';
import { deriveSeed } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { pavilionPlan, pavilionTop } from './pavilion';
import { planOf, siteOf } from './plan';
import { intoPlace, outOfPlace, type Place } from './shapes';
import { kept } from './kept';

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

export type Landmark = Pavilion;


/** The landmarks of a terrain (placed once per terrain, then kept). */
export const landmarksOf: (t: Terrain) => readonly Landmark[] = kept(placeLandmarks);

export function placeLandmarks(t: Terrain): Landmark[] {
  const h = t.habitat, spec = h.params.landmarks, lake = t.lake;
  const site = spec && lake ? siteOf(planOf(h), 'lake-pavilion') : undefined;
  if (!spec || !lake || !site) return [];
  // The deck within the ground the plan keeps for it.
  const radius = Math.min(spec.size / 2, site.size);
  if (radius < spec.handrail * 5) return [];
  const p: Pavilion = { kind: 'pavilion', theta: site.theta, s: site.s, level: lake.level, radius, handrail: spec.handrail, depth: lake.depth, bridges: [], seed: deriveSeed(h.seed, 'landmark', 'pavilion') };
  p.bridges = ([1, -1] as const).map((dir) => bridgeTo(t, p, dir));
  return [p];
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
 * The frame a landmark is built in, in the world (`intoPlace`, `outOfPlace`): its centre on the water, x (`ex`) along
 * the axis, y around, z toward the axis (up).
 */
export function frameOf(h: Habitat, l: Landmark): Place {
  return placeAt(h, l.theta, l.s, l.level);
}

/** A frame standing on the profile at (θ, s), `height` above it: x along the axis, y around, z toward the axis (up). */
export function placeAt(h: Habitat, theta: number, s: number, height: number): Place {
  const at = toWorld(h.profile, { theta, s, h: height });
  const c = Math.cos(theta), sn = Math.sin(theta);
  return { at, ex: [0, 0, 1], ey: [-sn, c, 0], ez: [-c, -sn, 0] };
}

/** How far out from its centre a landmark reaches, bridges and eaves included (m). */
export function reachOf(l: Landmark): number {
  return Math.max(pavilionPlan(l).reach, ...l.bridges.map((b) => b.to));
}

/** Where a point (θ, s) lies in a landmark's frame, across the floor (its height left out). */
function across(h: Habitat, l: Landmark, theta: number, s: number): [number, number] {
  const q = intoPlace(frameOf(h, l), toWorld(h.profile, { theta, s, h: l.level }));
  return [q[0], q[1]];
}

/**
 * Whether plants keep off a point: under a landmark, or by a bridge's landing (a few handrails around it), so nothing
 * grows through the deck or blocks the way onto it.
 */
export function keptClear(t: Terrain, theta: number, s: number): boolean {
  const h = t.habitat;
  for (const l of landmarksOf(t)) {
    if (Math.abs(s - l.s) > reachOf(l) + l.handrail * 4) continue;
    const [x, y] = across(h, l, theta, s), q = pavilionPlan(l), margin = l.handrail * 3;
    if (Math.hypot(x, y) < q.reach + margin) return true;
    for (const b of l.bridges) if (x * b.dir > 0 && x * b.dir < b.to + margin && Math.abs(y) < q.bridge / 2 + margin) return true;
  }
  return false;
}

/**
 * The height above the profile of the walkable top of a landmark over (θ, s), or null where none is: the deck, the
 * seats, the bridges. Someone set down there stands on it, not in the water under it.
 */
export function landmarkTopAt(t: Terrain, theta: number, s: number): number | null {
  const h = t.habitat;
  for (const l of landmarksOf(t)) {
    if (Math.abs(s - l.s) > reachOf(l)) continue;
    const f = frameOf(h, l), [x, y] = across(h, l, theta, s), z = pavilionTop(l, x, y);
    if (z === null) continue;
    return fromWorld(h.profile, ...outOfPlace(f, [x, y, z])).h;
  }
  return null;
}
