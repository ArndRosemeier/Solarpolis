/**
 * The landmarks (Arnd, 2026-10-21: the surface is park and nature reserve with only a few landmark buildings): where
 * each one stands and how big it is, from the blueprint's `landmarks` and the land. Each one is placed by a rule, not
 * by chance, so the layout can be designed: for now the one landmark is the assembly pavilion (gen/pavilion.ts draws
 * it), in the middle of the ring lake, on the meridian farthest from every river mouth, with a bridge to each shore
 * along the axis. Pure.
 */
import { fromWorld, toWorld, type Habitat } from '../blueprint';
import { deriveSeed } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { pavilionPlan, pavilionTop } from './pavilion';
import { intoPlace, outOfPlace, type Place } from './shapes';

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

/** Candidate meridians the rule weighs (it takes the best; ties go to the first). */
const MERIDIANS = 96;
/** The pavilion's deck reaches at most this share of the way from the lake's middle to its shore. */
const LAKE_SHARE = 0.55;

/** The landmarks of a terrain (placed once per terrain, then kept). */
export function landmarksOf(t: Terrain): readonly Landmark[] {
  let l = placed.get(t);
  if (!l) { l = placeLandmarks(t); placed.set(t, l); }
  return l;
}
const placed = new WeakMap<Terrain, readonly Landmark[]>();

export function placeLandmarks(t: Terrain): Landmark[] {
  const h = t.habitat, spec = h.params.landmarks, lake = t.lake;
  if (!spec || !lake) return [];
  const radius = Math.min(spec.size / 2, lake.halfWidth * LAKE_SHARE);
  if (radius < spec.handrail * 5) return [];
  // The rule: the meridian farthest (around the lake) from every river's mouth, so the bridges land on quiet shore.
  const mouths = t.rivers.map((r) => r.theta[r.from === 'wild' ? r.count - 1 : 0]);
  let theta = 0, best = -1;
  for (let i = 0; i < MERIDIANS; i++) {
    const a = (i / MERIDIANS) * 2 * Math.PI;
    const clear = mouths.length ? Math.min(...mouths.map((m) => Math.abs(Math.atan2(Math.sin(a - m), Math.cos(a - m))))) : 0;
    if (clear > best + 1e-9) { best = clear; theta = a; }
  }
  const p: Pavilion = { kind: 'pavilion', theta, s: lake.s, level: lake.level, radius, handrail: spec.handrail, depth: lake.depth, bridges: [], seed: deriveSeed(h.seed, 'landmark', 'pavilion') };
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
  const at = toWorld(h.profile, { theta: l.theta, s: l.s, h: l.level });
  const c = Math.cos(l.theta), sn = Math.sin(l.theta);
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
