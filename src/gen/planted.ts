/**
 * Plants set by hand, not scattered: each stands exactly where someone planted it, of a species of the climate, at its
 * own height:
 *
 * - the founders' grove (Solarpolis design, "A land people make": quiet and memory): on the habitat plan's
 *   `founders-grove` site, a ring of the climate's founders' tree (`Climate.grove`) around a clearing, planted when the
 *   habitat was new and so the oldest and tallest trees in it. Where the site is too small for a ring, one tree alone;
 * - the grown halls (grove commons: "halls grown from living trees"): in each grove district, two rows of the climate's
 *   hall tree (`Climate.hall`), planted at the founding and trained ever since, their limbs grafted across into a vault
 *   (built in gen/grownHall.ts) under crowns held high as its roof. Sited by rules: level, dry, inside the district,
 *   clear of the paths, the water and the courts, by an entrance, near the Sunwalk where it can be (people cook there
 *   for the walkers). `LandPlan.places.hall` long, in bays `HALL.bay` of the trees' height.
 *
 * The scatter stage draws them as species of their own (`plantsOf`, kind `planted`), cell by cell at every level, and
 * keeps scattered trees and debris out of a grove's clearing (`scatterKeepsOff`); the ecology lays their crowns into
 * the woods' canopy from afar (`plantedCanopy`), so a grove is still there when its trees are too far to draw. Pure.
 */
import { Rng, deriveSeed, hash3f, smoothstep } from '@futuremagic/core';
import { climateOf, type Climate, type PlantSpec } from '../blueprint';
import type { Terrain } from './terrain';
import { fromLake, planOf, siteOf, type District } from './plan';
import { pathsOf } from './paths';
import { floorAt, inFloorFrame, type FloorFrame } from './shapes';
import { canopyColor } from './trees';
import { kept } from './kept';

/** One planted plant: its species (a plant of the climate, by name), where it stands, its height (m) and turn. */
export interface Planted {
  species: string;
  theta: number;
  s: number;
  height: number;
  turn: number;
}

/** A grove: a ring of trees around a clearing (or one tree, `ring` 0), and how far scattered trees keep off it. */
export interface Grove {
  kind: 'founders-grove';
  theta: number;
  s: number;
  /** The ring's radius (m; 0 for a lone tree), the trees' crown diameter and the clearing's radius. */
  ring: number;
  crown: number;
  clear: number;
  spec: PlantSpec;
  trees: Planted[];
}

/** A column of a grown hall: where it stands in the hall's frame, the ground under it (over the frame), its tree. */
export interface HallColumn {
  x: number;
  y: number;
  /** Which bay line (0 … bays) and which side (−1 right, +1 left). */
  line: number;
  side: -1 | 1;
  ground: number;
  tree: Planted;
}

/** A grown hall: its frame on the floor (x along the nave, its height the ground at its middle), its trees and sizes. */
export interface Hall {
  kind: 'grown-hall';
  district: number;
  seed: number;
  frame: FloorFrame;
  spec: PlantSpec;
  /** The trees' height (m), the nave's span between the rows' trunks, a bay between trunks along a row, how many. */
  height: number;
  span: number;
  bay: number;
  bays: number;
  /** Half the nave's length (trunk to trunk, m). */
  half: number;
  /** Two per bay line: line 0's right and left, then line 1's … */
  columns: HallColumn[];
  /** The ground over the frame along three lines (y = −span/2, 0, +span/2), every `step` (a quarter bay) from x = −half − bay. */
  ground: [Float64Array, Float64Array, Float64Array];
  step: number;
  /** Bays (by side, then index) a path passes through, left open in the hall's low lattice. */
  open: Set<string>;
}

/** A grown hall's sizes as shares of its trees' height: the span between the rows, a bay, how far trees keep off. */
export const HALL = { span: 0.42, bay: 0.3, keepOff: 0.35 };
/** The least number of bays a grown hall has. */
const HALL_BAYS = 3;
/** Tries for each grove district's hall. */
const HALL_TRIES = 16;

export interface Plantings {
  groves: Grove[];
  halls: Hall[];
  /** Every planted species. */
  species: PlantSpec[];
  /** Every planted plant, by species name. */
  bySpecies: ReadonlyMap<string, readonly Planted[]>;
}

/** How much taller the founders' trees grew than their species' tallest scattered ones: two centuries, and room. */
export const FOUNDERS_GROWTH = 1.35;
/** A tree's crown diameter as a share of its height (as `canopyOf` reckons crowns). */
const CROWN = 0.55;
/** The ring stands this share of the way out to the site's edge. */
const RING_SHARE = 0.6;
/** Trees in the ring stand this many crown diameters apart (their crowns all but touch). */
const RING_GAP = 1.15;
/** Fewer trees than this would not read as a ring: one tree stands alone instead. */
const RING_MIN = 6;

/** The plantings of a terrain (made once per terrain, then kept). */
export const plantingsOf: (t: Terrain) => Plantings = kept(makePlantings);

/** The climate's plant of that name, if one of its biomes grows it. */
export function plantSpec(climate: Climate, name: string): PlantSpec | null {
  for (const b of climate.biomes) for (const p of b.plants) if (p.name === name) return p;
  return null;
}

function makePlantings(t: Terrain): Plantings {
  const groves: Grove[] = [];
  const site = siteOf(planOf(t.habitat), 'founders-grove');
  const climate = climateOf(t.habitat.params.climate), spec = climate && plantSpec(climate, climate.grove);
  if (site && spec) groves.push(foundersGrove(t, site.theta, site.s, site.size, spec));
  const halls = climate ? grownHalls(t, climate.hall, groves) : [];
  const bySpecies = new Map<string, Planted[]>(), species: PlantSpec[] = [];
  const put = (spec: PlantSpec, tree: Planted): void => {
    const list = bySpecies.get(tree.species);
    if (list) list.push(tree);
    else { bySpecies.set(tree.species, [tree]); species.push(spec); }
  };
  for (const g of groves) for (const tree of g.trees) put(g.spec, tree);
  for (const hall of halls) for (const c of hall.columns) put(hall.spec, c.tree);
  return { groves, halls, species, bySpecies };
}

/** One grown hall in each grove district outside the reserve, where one fits. */
function grownHalls(t: Terrain, spec: PlantSpec, groves: readonly Grove[]): Hall[] {
  const h = t.habitat, plan = planOf(h), paths = pathsOf(h), R = h.radius, TURN = 2 * Math.PI;
  const height = spec.height[1], span = height * HALL.span, bay = height * HALL.bay;
  const bays = Math.max(HALL_BAYS, Math.round(h.params.plan.places.hall / bay)), half = (bays * bay) / 2;
  const reach = Math.hypot(half + bay, span / 2 + height * HALL.keepOff);
  const sunwalk = plan.paths.filter((p) => p.kind === 'sunwalk');
  const halls: Hall[] = [];
  const nearSunwalk = (theta: number, s: number): number => {
    let best = Infinity;
    for (const p of sunwalk) for (let i = 0; i < p.points.length; i += 2) {
      const d = p.points[i] - theta;
      best = Math.min(best, Math.hypot((d - TURN * Math.round(d / TURN)) * R, p.points[i + 1] - s));
    }
    return best;
  };
  type Try = { f: FloorFrame; feet: { theta: number; s: number }[]; bound: number; bonus: number };
  /** A frame where a hall of district `d` may stand, with the best score it could reach (its corners' slope), or null. */
  const hallTry = (d: District, f: FloorFrame): Try | null => {
    if (f.s - reach < plan.reserveEnd || f.s + reach > h.profile.floorEnd || fromLake(t.lake, f.s) < reach) return null;
    const at = plan.borderAt(f.theta, f.s);
    if (!at || at.district !== d || at.edge < reach) return null;
    for (const g of groves) {
      const dt = g.theta - f.theta;
      if (Math.hypot((dt - TURN * Math.round(dt / TURN)) * R, g.s - f.s) < g.clear + g.crown + reach) return null;
    }
    for (const o of halls) {
      const dt = o.frame.theta - f.theta;
      if (Math.hypot((dt - TURN * Math.round(dt / TURN)) * R, o.frame.s - f.s) < reach * 2.2) return null;
    }
    // Every trunk in the district, clear of the courts and paths (a way may run through the nave, never into a tree).
    const feet = [];
    for (let line = 0; line <= bays; line++) for (const side of [-1, 1]) {
      const p = floorAt(h, f, -half + line * bay, (side * span) / 2);
      if (plan.districtAt(p.theta, p.s) !== d || t.courtAt(p.theta, p.s) || paths.pathAt(p.theta, p.s, 1.5)) return null;
      feet.push(p);
    }
    // The four corners' slope bounds the whole floor's from below, so the score from above.
    const slope = levelness([feet[0], feet[1], feet[feet.length - 2], feet[feet.length - 1]]);
    if (slope > 0.08) return null;
    const walk = nearSunwalk(f.theta, f.s), bonus = walk < reach * 3 ? 0.6 * (1 - walk / (reach * 3)) : 0;
    return { f, feet, bound: 1 - slope / 0.08 + bonus, bonus };
  };
  /** The rise of the ground under these trunks as a slope along the hall, or Infinity where one stands in the water. */
  const levelness = (feet: readonly { theta: number; s: number }[]): number => {
    let lo = Infinity, hi = -Infinity;
    for (const p of feet) {
      const g = t.heightAt(p.theta, p.s);
      if (t.riverAt(p.theta, p.s) || t.standAt(p.theta, p.s) > g + 0.05) return Infinity;
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    return (hi - lo) / (2 * half);
  };
  for (const d of plan.districts) {
    if (d.style !== 'grove' || !d.entrances.length) continue;
    const rng = new Rng(deriveSeed(h.seed, 'planted', 'hall', d.id)), tries: Try[] = [];
    for (let k = 0; k < HALL_TRIES; k++) {
      const e = d.entrances[k % d.entrances.length], a = rng.range(0, TURN), r = rng.range(0.12, 0.38) * h.params.plan.entranceSpacing;
      const theta = e.theta + (Math.sin(a) * r) / R, s = e.s + Math.cos(a) * r;
      const x = hallTry(d, { theta, s, height: 0, heading: rng.range(0, Math.PI) });
      if (x) tries.push(x);
    }
    // The flattest, nearest the sunwalk: every trunk's ground asked only of a frame that could still win.
    tries.sort((p, q) => q.bound - p.bound);
    let best: FloorFrame | null = null, score = 0;
    for (const x of tries) {
      if (x.bound <= score) break;
      const slope = levelness(x.feet), q = slope > 0.08 ? -1 : 1 - slope / 0.08 + x.bonus;
      if (q > score) { score = q; best = { ...x.f, height: t.heightAt(x.f.theta, x.f.s) }; }
    }
    if (best) halls.push(layHall(t, d.id, best, spec, height, span, bay, bays));
  }
  return halls;
}

/** A hall laid out in its frame: its trees planted, the ground sampled, the bays a path passes through. */
function layHall(t: Terrain, district: number, f: FloorFrame, spec: PlantSpec, height: number, span: number, bay: number, bays: number): Hall {
  const h = t.habitat, half = (bays * bay) / 2, seed = deriveSeed(h.seed, 'planted', 'hall', district, 'trees');
  const columns: HallColumn[] = [];
  for (let line = 0; line <= bays; line++) for (const side of [-1, 1] as const) {
    const x = -half + line * bay, y = (side * span) / 2, p = floorAt(h, f, x, y), k = columns.length;
    columns.push({ x, y, line, side, ground: t.heightAt(p.theta, p.s) - f.height, tree: { species: spec.name, theta: p.theta, s: p.s, height: height * (0.96 + 0.06 * hash3f(seed, k, 0, 1)), turn: hash3f(seed, k, 0, 2) * 2 * Math.PI } });
  }
  const step = bay / 4, n = Math.round((2 * (half + bay)) / step), ground = [0, 1, 2].map(() => new Float64Array(n + 1)) as Hall['ground'];
  for (let i = 0; i <= n; i++) {
    [-span / 2, 0, span / 2].forEach((y, j) => {
      const p = floorAt(h, f, -half - bay + i * step, y);
      ground[j][i] = t.heightAt(p.theta, p.s) - f.height;
    });
  }
  const paths = pathsOf(h), open = new Set<string>();
  for (let i = 0; i < bays; i++) for (const side of [-1, 1]) {
    for (const u of [0.25, 0.5, 0.75]) {
      const p = floorAt(h, f, -half + (i + u) * bay, (side * span) / 2);
      if (paths.pathAt(p.theta, p.s, 0.5)) open.add(`${side},${i}`);
    }
  }
  return { kind: 'grown-hall', district, seed, frame: f, spec, height, span, bay, bays, half, columns, ground, step, open };
}

/** A hall's ground over its frame at (x, y), between its three sampled lines. */
export function hallGroundAt(hall: Hall, x: number, y: number): number {
  const f = Math.min(hall.ground[0].length - 1, Math.max(0, (x + hall.half + hall.bay) / hall.step)), i = Math.min(hall.ground[0].length - 2, Math.floor(f)), u = f - i;
  const line = (k: number): number => hall.ground[k][i] * (1 - u) + hall.ground[k][i + 1] * u;
  const v = Math.max(-1, Math.min(1, y / (hall.span / 2)));
  return v < 0 ? line(1) * (1 + v) + line(0) * -v : line(1) * (1 - v) + line(2) * v;
}

/** Where a point lies in a hall's frame (x along its nave, y across), or null when it is well away from the hall. */
export function inHall(t: Terrain, hall: Hall, theta: number, s: number, margin: number): [number, number] | null {
  const reach = Math.hypot(hall.half, hall.span / 2) + margin;
  if (Math.abs(s - hall.frame.s) > reach) return null;
  const [x, y] = inFloorFrame(t.habitat, hall.frame, theta, s);
  return Math.abs(x) <= hall.half + margin && Math.abs(y) <= hall.span / 2 + margin ? [x, y] : null;
}

/** The founders' grove on its site: as many trees as fit round the ring with their crowns all but touching. */
function foundersGrove(t: Terrain, theta: number, s: number, size: number, spec: PlantSpec): Grove {
  const h = t.habitat, seed = deriveSeed(h.seed, 'planted', 'founders-grove');
  const height = spec.height[1] * FOUNDERS_GROWTH, crown = height * CROWN;
  const r = h.profile.at(s).r, ringR = size * RING_SHARE;
  const count = Math.floor((2 * Math.PI * ringR) / (crown * RING_GAP));
  const lone = count < RING_MIN;
  const trees: Planted[] = [];
  const plantAt = (a: number, k: number): void => {
    // Each its own: a little taller or shorter, turned its own way.
    const pt = theta + (Math.sin(a) * ringR) / r, ps = s + Math.cos(a) * ringR;
    if (t.standAt(pt, ps) > t.heightAt(pt, ps) + 0.05) return; // a ring is never planted in the water
    trees.push({ species: spec.name, theta: pt, s: ps, height: height * (0.92 + 0.08 * hash3f(seed, k, 0, 1)), turn: hash3f(seed, k, 0, 2) * 2 * Math.PI });
  };
  if (lone) {
    trees.push({ species: spec.name, theta, s, height, turn: hash3f(seed, 0, 0, 2) * 2 * Math.PI });
    return { kind: 'founders-grove', theta, s, ring: 0, crown, clear: crown, spec, trees };
  }
  for (let k = 0; k < count; k++) plantAt((2 * Math.PI * k) / count, k);
  return { kind: 'founders-grove', theta, s, ring: ringR, crown, clear: ringR + crown, spec, trees };
}

/** The planted plants of a species within a (θ, s) rectangle of the profile. */
export function plantedIn(t: Terrain, species: string, b: { theta0: number; theta1: number; s0: number; s1: number }): Planted[] {
  const list = plantingsOf(t).bySpecies.get(species) ?? [];
  const turn = 2 * Math.PI;
  return list.filter((p) => {
    const th = ((p.theta % turn) + turn) % turn;
    return p.s >= b.s0 && p.s < b.s1 && th >= b.theta0 && th < b.theta1;
  });
}

/** Where a point lies from a grove's middle across the ground (m: along s, around), and how far. */
function fromMiddle(t: Terrain, g: Grove, theta: number, s: number): number {
  const r = t.habitat.profile.at(g.s).r;
  const d = Math.atan2(Math.sin(theta - g.theta), Math.cos(theta - g.theta)) * r;
  return Math.hypot(s - g.s, d);
}

/**
 * Whether scattered trees, shrubs and debris keep off a point: inside a grove's clearing and under its ring (grass
 * still grows there: the clearing is a lawn, `plantedLawn`).
 */
export function scatterKeepsOff(t: Terrain, theta: number, s: number): boolean {
  const p = plantingsOf(t);
  for (const g of p.groves) if (Math.abs(s - g.s) < g.clear && fromMiddle(t, g, theta, s) < g.clear) return true;
  // A grown hall's nave and a ring round it, where nothing scattered stands among its trained trees.
  for (const hall of p.halls) if (inHall(t, hall, theta, s, hall.height * HALL.keepOff)) return true;
  return false;
}

/**
 * How much a point is a grove's lawn (0 … 1): its clearing and the ground under its ring, mown, soft at the edge. The
 * ecology gives it to its open, grassy biome there (`biomesAt`), so the ground, its floor and its grass agree.
 */
export function plantedLawn(t: Terrain, theta: number, s: number): number {
  let lawn = 0;
  const p = plantingsOf(t);
  for (const g of p.groves) {
    const edge = g.crown / 2;
    if (Math.abs(s - g.s) > g.clear + edge) continue;
    lawn = Math.max(lawn, 1 - smoothstep(g.clear - edge, g.clear + edge, fromMiddle(t, g, theta, s)));
  }
  // A grown hall's floor is a lawn too, out to where its trees keep scattered ones off.
  for (const hall of p.halls) {
    const keep = hall.height * HALL.keepOff, at = inHall(t, hall, theta, s, keep);
    if (!at) continue;
    const out = Math.max(Math.abs(at[0]) - hall.half, Math.abs(at[1]) - hall.span / 2, 0);
    lawn = Math.max(lawn, 1 - smoothstep(keep * 0.5, keep, out));
  }
  return lawn;
}

/**
 * The planted crowns over a point, for the woods' canopy from afar: how much of it they cover (0 … 1), their height
 * and colour (linear RGB); null where none are. A ring is smoothed along its circle (the share of it the crowns fill),
 * so far tiles see it however coarsely they sample.
 */
export function plantedCanopy(t: Terrain, theta: number, s: number): { cover: number; height: number; color: [number, number, number] } | null {
  const p = plantingsOf(t);
  // A grown hall's crowns close over its nave: one roof from row to row, as long as the hall.
  for (const hall of p.halls) {
    const crown = hall.height * CROWN * 0.5, at = inHall(t, hall, theta, s, crown);
    if (!at) continue;
    const out = Math.max(Math.abs(at[0]) - hall.half, Math.abs(at[1]) - hall.span / 2, 0), cover = smoothstep(crown, crown * 0.6, out);
    if (cover > 0) return { cover, height: hall.height, color: canopyColor(hall.spec.form) };
  }
  for (const g of p.groves) {
    const reach = g.ring + g.crown;
    if (Math.abs(s - g.s) > reach || !g.trees.length) continue;
    const d = fromMiddle(t, g, theta, s), half = g.crown / 2;
    const off = g.ring ? Math.abs(d - g.ring) : d;
    if (off > half) continue;
    const fill = g.ring ? Math.min(1, (g.trees.length * g.crown) / (2 * Math.PI * g.ring)) : 1;
    const cover = fill * smoothstep(half, half * 0.6, off);
    if (cover <= 0) continue;
    return { cover, height: g.trees.reduce((n, p) => n + p.height, 0) / g.trees.length, color: canopyColor(g.spec.form) };
  }
  return null;
}
