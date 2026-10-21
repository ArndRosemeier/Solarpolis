/**
 * The scatter stage: where each plant stands. The land is cut into plant cells, a grid over (θ, s) per plant (its
 * cells are larger the farther the plant is seen), and each cell is planted on its own from its seed and the biome
 * shares (`ecology.ts`): one candidate spot anywhere in each square of the plant's spacing, or on a straight grid for
 * plants set in rows, each kept with the probability of its biome there. So any cell comes out the same whenever and
 * in whatever order it is made, and cells never need their neighbours.
 *
 * Plants are seen up to `SEEN_PER_METRE` times their height; beyond that the ground's own colour (the far tiles'
 * biome colour) stands in for them. Pure: runs in the generation workers.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { fromWorld, toWorld, wrapAngle, type PlantSpec, type Vec3 } from '../blueprint';
import type { Ecology } from './ecology';
import { PLANT_VARIANTS } from './plants';
import { horizonAt } from './horizon';

/** How far a plant is drawn, in multiples of its greatest height: at that distance a tree is a couple of dozen pixels. */
export const SEEN_PER_METRE = 40;
/** Plant cells: the smallest and largest side (m), and about how many cells a plant's sight distance spans. */
const CELL_MIN = 16;
const CELL_MAX = 256;
const CELLS_ACROSS = 6;

/** One plant of the climate: the biome it grows in, its spec, its index in `plantsOf`. */
export interface Species {
  id: number;
  biome: number;
  spec: PlantSpec;
  /** Side of its cells (m) and how far it is seen (m). */
  cell: number;
  seen: number;
}

/** Every plant of the habitat's climate, in a fixed order. */
export function plantsOf(ecology: Ecology): Species[] {
  const out: Species[] = [];
  ecology.climate.biomes.forEach((b, biome) => {
    for (const spec of b.plants) {
      const seen = spec.height[1] * SEEN_PER_METRE;
      const cell = Math.min(CELL_MAX, Math.max(CELL_MIN, 2 ** Math.round(Math.log2(seen / CELLS_ACROSS))));
      out.push({ id: out.length, biome, spec, cell, seen });
    }
  });
  return out;
}

/** A plant cell: one species, a row along s (`j`) and a column around the axis (`i`). */
export interface CellKey {
  species: number;
  j: number;
  i: number;
}

export const cellId = (k: CellKey): string => `${k.species}:${k.j}:${k.i}`;

/** Columns around the axis in a row of cells. */
function columns(ecology: Ecology, sp: Species, j: number): number {
  const { profile } = ecology.terrain.habitat;
  const s = Math.min(profile.length, (j + 0.5) * sp.cell);
  return Math.max(1, Math.round(profile.circumference(s) / sp.cell));
}

/** The (θ, s) rectangle a cell covers. */
export function cellBounds(ecology: Ecology, sp: Species, k: CellKey): { theta0: number; theta1: number; s0: number; s1: number } {
  const { profile } = ecology.terrain.habitat;
  const n = columns(ecology, sp, k.j);
  return { theta0: (2 * Math.PI * k.i) / n, theta1: (2 * Math.PI * (k.i + 1)) / n, s0: k.j * sp.cell, s1: Math.min(profile.length, (k.j + 1) * sp.cell) };
}

/** The cells of a plant that may hold something seen from `eye` (world), nearest first. */
export function cellsNear(ecology: Ecology, sp: Species, eye: Vec3): CellKey[] {
  const { profile } = ecology.terrain.habitat;
  const at = fromWorld(profile, eye[0], eye[1], eye[2]);
  // Too high above the ground to see any of this plant: none.
  if (at.h > sp.seen) return [];
  const reach = Math.sqrt(Math.max(0, sp.seen * sp.seen - at.h * at.h));
  const out: { k: CellKey; d: number }[] = [];
  const j0 = Math.max(0, Math.floor((at.s - reach) / sp.cell)), j1 = Math.min(Math.ceil(profile.length / sp.cell) - 1, Math.floor((at.s + reach) / sp.cell));
  for (let j = j0; j <= j1; j++) {
    const n = columns(ecology, sp, j);
    const s = Math.min(profile.length, (j + 0.5) * sp.cell), r = Math.max(profile.at(s).r, 1e-6);
    const half = Math.min(n, Math.ceil((reach / r) / ((2 * Math.PI) / n)) + 1);
    const ic = Math.floor((wrapAngle(at.theta) / (2 * Math.PI)) * n);
    const seenCol = new Set<number>();
    for (let di = -half; di <= half; di++) {
      const i = (((ic + di) % n) + n) % n;
      if (seenCol.has(i)) continue;
      seenCol.add(i);
      const k = { species: sp.id, j, i }, b = cellBounds(ecology, sp, k);
      const c = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });
      // Distance to the cell's middle, less half its diagonal and the tallest plant: the nearest anything in it can be.
      const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) - sp.cell * Math.SQRT1_2 - sp.spec.height[1];
      if (d < sp.seen) out.push({ k, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.k);
}

/** A planted cell: its plants per variant, relative to the cell's origin. */
export interface PlantCell {
  key: CellKey;
  /** World position of the cell's origin (float64). */
  origin: Vec3;
  /** Per variant: x, y, z (relative to the origin), height (m), turn about up (radians), five floats per plant. */
  instances: Float32Array[];
  count: number;
  /** The terrain's horizon angles at the cell's middle (`horizonAt`): the cell's plants see the sunline past them. */
  horizon: [number, number];
}

/** Floats per plant in `PlantCell.instances`. */
export const PLANT_STRIDE = 5;

/** Plant one cell. */
export function plantCell(ecology: Ecology, plants: readonly Species[], k: CellKey): PlantCell {
  const t = ecology.terrain, h = t.habitat, { profile } = h;
  const sp = plants[k.species], spec = sp.spec;
  const b = cellBounds(ecology, sp, k);
  const origin = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });
  const rng = new Rng(deriveSeed(h.seed, 'scatter', spec.name, sp.biome, k.j, k.i));
  const lists: number[][] = Array.from({ length: PLANT_VARIANTS }, () => []);
  const shares = new Float32Array(ecology.climate.biomes.length);
  const gap = spec.spacing;
  // One candidate per square of the plant's spacing, anywhere in its square (so the density is even, edges and all);
  // rows: one grid for the whole habitat, so rows run straight across cell edges.
  const sStart = spec.rows ? Math.ceil(b.s0 / gap) * gap : b.s0;
  for (let s = sStart; s < b.s1; s += gap) {
    const r = profile.at(Math.min(b.s1, s + gap / 2)).r;
    if (r < gap) continue; // at the axis itself, nothing grows
    const dTheta = gap / r;
    const tStart = spec.rows ? Math.ceil(b.theta0 / dTheta) * dTheta : b.theta0;
    for (let theta = tStart; theta < b.theta1; theta += dTheta) {
      const ps = spec.rows ? s : s + rng.float() * gap, pt = spec.rows ? theta : theta + rng.float() * dTheta;
      if (ps >= b.s1 || pt >= b.theta1) { rng.float(); rng.float(); rng.float(); rng.float(); continue; }
      const keep = rng.float(), size = rng.float(), turn = rng.range(0, 2 * Math.PI), variant = rng.int(0, PLANT_VARIANTS - 1);
      const ground = t.heightAt(pt, ps);
      if (t.standAt(pt, ps) > ground + 0.05) continue; // under water
      const slope = slopeAt(ecology, pt, ps, ground, gap);
      ecology.biomesAt(pt, ps, ground, slope, shares);
      if (keep >= shares[sp.biome]) continue;
      const p = toWorld(profile, { theta: pt, s: ps, h: ground });
      lists[variant].push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2], spec.height[0] + (spec.height[1] - spec.height[0]) * size, turn);
    }
  }
  const instances = lists.map((l) => new Float32Array(l));
  const horizon = horizonAt(t, (b.theta0 + b.theta1) / 2, (b.s0 + b.s1) / 2);
  return { key: k, origin, instances, count: instances.reduce((n, a) => n + a.length / PLANT_STRIDE, 0), horizon };
}

/** Bytes a planted cell holds (memory watchdog). */
export function cellBytes(c: PlantCell): number {
  return c.instances.reduce((n, a) => n + a.byteLength, 0);
}

/** How steep the ground is at a point (0 flat … 1 a wall), from its height a step either way. */
function slopeAt(ecology: Ecology, theta: number, s: number, ground: number, step: number): number {
  const t = ecology.terrain, { profile } = t.habitat;
  const p = profile.at(s), r = Math.max(p.r, 1e-6), d = Math.max(step * 0.5, 0.5);
  const dh = Math.hypot(t.heightAt(theta + d / r, s) - ground, t.heightAt(theta, Math.min(profile.length, s + d)) - ground) / d;
  const tilt = 1 - 1 / Math.sqrt(1 + dh * dh);
  return Math.min(1, Math.max(Math.abs(p.nz), tilt * 3));
}
