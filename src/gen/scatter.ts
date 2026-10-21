/**
 * The scatter stage: where each plant stands, and the cells it is drawn in.
 *
 * Where: every plant has its own lattice over (θ, s): rows `spacing` apart along s, and around the axis as many
 * columns as fit at `spacing` in that row. Each lattice square holds one candidate spot, anywhere in the square (on
 * its corner for plants set in rows), kept with the probability of the plant's biome there (`ecology.ts`); its size,
 * turn and shape come from the square's own hash. So a plant is the same whichever cell it is asked for in, cells of
 * any size agree, and a cell never needs its neighbours.
 *
 * Drawn: each plant is drawn at one of three levels by its distance (`LEVELS`: the full tree, a lighter one, its
 * crown hull), in multiples of its sight unit (`unit`); neighbouring levels hand it over in a dithered band. Each level
 * has its own grid of cells, larger the farther it reaches, so the number of cells drawn stays small. Pure: runs in the
 * generation workers.
 */
import { hash3f, deriveSeed } from '@futuremagic/core';
import { fromWorld, toWorld, wrapAngle, type PlantSpec, type Vec3 } from '../blueprint';
import { TREE_HEIGHT, type Ecology } from './ecology';
import { horizonAt } from './horizon';
import { bytesOf } from './shapes';

/** Shapes per plant form: plants of a species pick one of these by their own hash. */
export const PLANT_VARIANTS = 3;

/**
 * The levels a plant is drawn at, near to far: the band it fades in over and the band it fades out over, in sight
 * units; how many of its cells span its far edge; how many shapes it draws (the hull level draws every plant with one
 * shape, so a far cell is one draw).
 */
export const LEVELS = [
  { name: 'full', fade: [-2, -1, 5, 6], across: 3, variants: PLANT_VARIANTS },
  { name: 'lite', fade: [5, 6, 14, 16], across: 4, variants: PLANT_VARIANTS },
  { name: 'hull', fade: [14, 16, 45, 60], across: 5, variants: 1 },
] as const;
export type Level = 0 | 1 | 2;

/** A plant's sight unit (m): its greatest height, but never less than a small tree's, so shrubs are seen too. */
export const unit = (spec: PlantSpec): number => Math.max(spec.height[1], 6);
/** Plant cells: the smallest and largest side (m). */
const CELL_MIN = 16;
const CELL_MAX = 512;

/** One plant of the climate: the biome it grows in, its spec, its index in `plantsOf`. */
export interface Species {
  id: number;
  biome: number;
  spec: PlantSpec;
  /** Per level: the side of its cells (m), and its bands (m from the eye: fade in x..y, out z..w). */
  cell: number[];
  band: [number, number, number, number][];
  /** How far it is seen at all (m). */
  seen: number;
}

/**
 * Where the ground's canopy layer takes over the woods (m from the eye: fading in from x to y): where the crown hulls
 * of the climate's tallest trees fade out. Every tree's hulls fade out there too, so no wood is ever missing.
 */
export function canopyBand(ecology: Ecology): [number, number] {
  let u = 0;
  for (const b of ecology.climate.biomes) for (const p of b.plants) if (p.height[1] >= TREE_HEIGHT) u = Math.max(u, unit(p));
  const [, , out0, out1] = LEVELS[LEVELS.length - 1].fade;
  return u ? [out0 * u, out1 * u] : [1e30, 2e30];
}

/** Every plant of the habitat's climate, in a fixed order. */
export function plantsOf(ecology: Ecology): Species[] {
  const out: Species[] = [];
  const woods = canopyBand(ecology);
  ecology.climate.biomes.forEach((b, biome) => {
    for (const spec of b.plants) {
      const u = unit(spec);
      const band = LEVELS.map((l) => l.fade.map((f) => f * u) as [number, number, number, number]);
      if (spec.height[1] >= TREE_HEIGHT) [band[LEVELS.length - 1][2], band[LEVELS.length - 1][3]] = woods;
      const cell = LEVELS.map((l, k) => Math.min(CELL_MAX, Math.max(CELL_MIN, 2 ** Math.round(Math.log2(band[k][3] / l.across)))));
      out.push({ id: out.length, biome, spec, cell, band, seen: band[LEVELS.length - 1][3] });
    }
  });
  return out;
}

/** A plant cell: one species at one level, a row along s (`j`) and a column around the axis (`i`). */
export interface CellKey {
  species: number;
  level: Level;
  j: number;
  i: number;
}

export const cellId = (k: CellKey): string => `${k.species}:${k.level}:${k.j}:${k.i}`;

/** Columns around the axis in a row of cells. */
function columns(ecology: Ecology, cell: number, j: number): number {
  const { profile } = ecology.terrain.habitat;
  const s = Math.min(profile.length, (j + 0.5) * cell);
  return Math.max(1, Math.round(profile.circumference(s) / cell));
}

/** The (θ, s) rectangle a cell covers. */
export function cellBounds(ecology: Ecology, sp: Species, k: CellKey): { theta0: number; theta1: number; s0: number; s1: number } {
  const { profile } = ecology.terrain.habitat;
  const cell = sp.cell[k.level], n = columns(ecology, cell, k.j);
  return { theta0: (2 * Math.PI * k.i) / n, theta1: (2 * Math.PI * (k.i + 1)) / n, s0: k.j * cell, s1: Math.min(profile.length, (k.j + 1) * cell) };
}

/** A cell in sight, and the nearest anything in it can be to the eye (m). */
export interface NearCell {
  key: CellKey;
  near: number;
}

/** The cells of a plant at a level that may hold something it draws seen from `eye` (world), nearest first. */
export function cellsNear(ecology: Ecology, sp: Species, level: Level, eye: Vec3): NearCell[] {
  const { profile } = ecology.terrain.habitat;
  const at = fromWorld(profile, eye[0], eye[1], eye[2]);
  const [near, , , far] = sp.band[level], cell = sp.cell[level], tall = sp.spec.height[1];
  // Too high above the ground to see any of this plant at this level: none.
  if (at.h - tall > far) return [];
  const reach = Math.sqrt(Math.max(0, far * far - Math.max(0, at.h - tall) ** 2)) + cell;
  const out: NearCell[] = [];
  const j0 = Math.max(0, Math.floor((at.s - reach) / cell)), j1 = Math.min(Math.ceil(profile.length / cell) - 1, Math.floor((at.s + reach) / cell));
  for (let j = j0; j <= j1; j++) {
    const n = columns(ecology, cell, j);
    const s = Math.min(profile.length, (j + 0.5) * cell), r = Math.max(profile.at(s).r, 1e-6);
    const half = Math.min(n, Math.ceil((reach / r) / ((2 * Math.PI) / n)) + 1);
    const ic = Math.floor((wrapAngle(at.theta) / (2 * Math.PI)) * n);
    const seenCol = new Set<number>();
    for (let di = -half; di <= half; di++) {
      const i = (((ic + di) % n) + n) % n;
      if (seenCol.has(i)) continue;
      seenCol.add(i);
      const k: CellKey = { species: sp.id, level, j, i }, b = cellBounds(ecology, sp, k);
      const c = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });
      // The nearest and farthest anything in it can be: the middle, give or take half its diagonal and the tallest plant.
      const mid = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]), give = Math.hypot(b.s1 - b.s0, (b.theta1 - b.theta0) * r) / 2 + tall;
      if (mid - give < far && mid + give > near) out.push({ key: k, near: Math.max(0, mid - give) });
    }
  }
  return out.sort((a, b) => a.near - b.near);
}

/** A planted cell: its plants per shape, relative to the cell's origin. */
export interface PlantCell {
  key: CellKey;
  /** World position of the cell's origin (float64). */
  origin: Vec3;
  /** Per shape: x, y, z (relative to the origin), height (m), turn about up (radians), `PLANT_STRIDE` floats per plant. */
  instances: Float32Array[];
  count: number;
  /** The terrain's horizon angles at the cell's middle (`horizonAt`): the cell's plants see the sunline past them. */
  horizon: [number, number];
}

/** Floats per plant in `PlantCell.instances`. */
export const PLANT_STRIDE = 5;

/** Plant one cell: every lattice spot of the plant whose plant stands inside it. */
export function plantCell(ecology: Ecology, plants: readonly Species[], k: CellKey): PlantCell {
  const t = ecology.terrain, h = t.habitat, { profile } = h;
  const sp = plants[k.species], spec = sp.spec;
  const b = cellBounds(ecology, sp, k);
  const origin = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });
  const seed = deriveSeed(h.seed, 'scatter', spec.name, sp.biome);
  const shapes = LEVELS[k.level].variants;
  const lists: number[][] = Array.from({ length: shapes }, () => []);
  const shares = new Float32Array(ecology.climate.biomes.length);
  const gap = spec.spacing;
  for (let row = Math.floor(b.s0 / gap); row * gap < b.s1; row++) {
    const s0 = row * gap, r = profile.at(Math.min(profile.length, s0 + gap / 2)).r;
    if (r < gap) continue; // at the axis itself, nothing grows
    const n = Math.max(1, Math.round((2 * Math.PI * r) / gap)), dTheta = (2 * Math.PI) / n;
    // The lattice squares that reach into the cell (a cell can wrap past θ = 0 only as a whole column).
    for (let col = Math.floor(b.theta0 / dTheta); col * dTheta < b.theta1; col++) {
      const it = ((col % n) + n) % n;
      const f = (q: number) => hash3f(seed, row, it, q);
      const ps = spec.rows ? s0 : s0 + f(0) * gap, pt = spec.rows ? col * dTheta : (col + f(1)) * dTheta;
      if (ps < b.s0 || ps >= b.s1 || pt < b.theta0 || pt >= b.theta1 || ps > profile.length) continue;
      const ground = t.heightAt(pt, ps);
      if (t.standAt(pt, ps) > ground + 0.05) continue; // under water
      const slope = slopeAt(ecology, pt, ps, ground, gap);
      ecology.biomesAt(pt, ps, ground, slope, shares);
      if (f(2) >= shares[sp.biome]) continue;
      const p = toWorld(profile, { theta: pt, s: ps, h: ground });
      const shape = Math.min(shapes - 1, Math.floor(f(5) * shapes));
      lists[shape].push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2], spec.height[0] + (spec.height[1] - spec.height[0]) * f(3), f(4) * 2 * Math.PI);
    }
  }
  const instances = lists.map((l) => new Float32Array(l));
  const horizon = horizonAt(t, (b.theta0 + b.theta1) / 2, (b.s0 + b.s1) / 2);
  return { key: k, origin, instances, count: instances.reduce((n, a) => n + a.length / PLANT_STRIDE, 0), horizon };
}

/** Bytes a planted cell holds (memory watchdog). */
export function cellBytes(c: PlantCell): number {
  return bytesOf(c.instances);
}

/** How steep the ground is at a point (0 flat … 1 a wall), from its height a step either way. */
function slopeAt(ecology: Ecology, theta: number, s: number, ground: number, step: number): number {
  const t = ecology.terrain, { profile } = t.habitat;
  const p = profile.at(s), r = Math.max(p.r, 1e-6), d = Math.max(step * 0.5, 0.5);
  const dh = Math.hypot(t.heightAt(theta + d / r, s) - ground, t.heightAt(theta, Math.min(profile.length, s + d)) - ground) / d;
  const tilt = 1 - 1 / Math.sqrt(1 + dh * dh);
  return Math.min(1, Math.max(Math.abs(p.nz), tilt * 3));
}
