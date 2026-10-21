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
 *
 * Ground cover (the climate's `cover`: grass tufts) is planted the same way, but where its floor layer is, as densely
 * as the layer's share of the ground (`coverChance`), and drawn at the first two levels only, out to `COVER_FADE`
 * metres; past them the floor's own texture is the cover.
 *
 * Debris (the climate's `debris`: stones, fallen trunks and branches) lies on its floor layer the same way, but is drawn
 * at all three levels, seen as far as its size makes it more than a pixel or two (`debrisUnit`). It lies along the
 * ground: each one carries the ground's slope under it, which its kind shears it by.
 */
import { hash3f, deriveSeed } from '@futuremagic/core';
import { FLOOR_LAYERS, fromWorld, groundNormal, toWorld, wrapAngle, type CoverSpec, type DebrisSpec, type PlantSpec, type Vec3 } from '../blueprint';
import { TREE_HEIGHT, type Ecology } from './ecology';
import { horizonAt } from './horizon';
import { groundSlope } from './terrain';
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

/**
 * Ground cover's bands (m from the eye) at the full and the light level: the full tufts out to a dozen metres, the light
 * ones on to forty, where they sink into the floor (`userData.sink` of their meshes) and its texture carries on.
 */
export const COVER_FADE = [[-2, -1, 12, 16], [12, 16, 32, 40]] as const;
/** The lattice (m) the cover's floor layer is read on and blended between: finer than any patch edge or shore. */
export const COVER_GRID = 2;
/**
 * Debris reads its floor layer on a lattice of half its spacing, doubled at each farther level, within these bounds
 * (m): sparse boulders need no 2 m reading, and kilometres of far cells would cost seconds of it. Where a level hands a
 * stone over to the next, the two may then disagree about it; it is a few pixels across there.
 */
const DEBRIS_GRID = [2, 16] as const;
/** The floor-layer lattice of a species on the floor at a level (`coverChance`). */
export const gridOf = (sp: Species, level: Level): number =>
  sp.what === 'debris' ? Math.min(DEBRIS_GRID[1], Math.max(DEBRIS_GRID[0], sp.spec.spacing / 2) * 2 ** level) : COVER_GRID;
/** Debris's cells span its far edge only twice: it has many species and levels, and each cell is cheap to plant. */
const DEBRIS_ACROSS = 2;

/** A plant's sight unit (m): its greatest height, but never less than a small tree's, so shrubs are seen too. */
export const unit = (spec: PlantSpec): number => Math.max(spec.height[1], 6);

/**
 * How far a plant smaller than a tree is seen (m per m of its height): where it is a pixel or two tall, as debris is
 * (`debrisUnit`). Trees last until the canopy layer takes over the woods; shrubs and heather last until they are too
 * small to see, but no farther than the woods, and a dense plant (reeds) no farther than `DENSE` spacings, past which
 * so many would be too many to draw and its biome's ground colour carries it.
 */
const SIGHT = 500;
const DENSE = 250;

/** How thick a piece of debris is for its size: a stone is as thick as it is high; trunks and branches are long and thin. */
export const DEBRIS_GIRTH = { stone: 1, log: 0.1, branch: 0.04 } as const;
/**
 * Debris's sight unit (m): a dozen times its apparent size (the root of its length times its thickness), so its last
 * level (out to 60 units) ends where it is a pixel or two across: a pebble at a hundred metres, a boulder at kilometres.
 */
export const debrisUnit = (spec: DebrisSpec): number => 12 * spec.height[1] * Math.sqrt(DEBRIS_GIRTH[spec.form]);
/** Plant cells: the smallest and largest side (m). */
const CELL_MIN = 16;
const CELL_MAX = 512;

/** One plant of the climate: the biome it grows in (or the floor layer, for cover), its spec, its index in `plantsOf`. */
export interface Species {
  id: number;
  /** The biome it grows in; -1 for ground cover and debris. */
  biome: number;
  /** Ground cover and debris: its floor layer's index in FLOOR_LAYERS; -1 for a biome's plant. */
  on: number;
  /** What it is: a biome's plant, ground cover, or debris (which lies along the slope). */
  what: 'plant' | 'cover' | 'debris';
  spec: PlantSpec | CoverSpec | DebrisSpec;
  /** Per level it is drawn at (all of `LEVELS`, or the first two for cover): the side of its cells (m), and its bands (m from the eye: fade in x..y, out z..w). */
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
      const far = band[LEVELS.length - 1];
      if (spec.height[1] >= TREE_HEIGHT) [far[2], far[3]] = woods;
      else {
        // Fading out over the same share of the distance as before.
        const [, , out0, out1] = LEVELS[LEVELS.length - 1].fade;
        const end = Math.max(far[3], Math.min(SIGHT * spec.height[1], woods[1], DENSE * spec.spacing));
        [far[2], far[3]] = [(end * out0) / out1, end];
      }
      out.push({ id: out.length, biome, on: -1, what: 'plant', spec, cell: cellsFor(band), band, seen: band[LEVELS.length - 1][3] });
    }
  });
  const onFloor = (what: 'cover' | 'debris', spec: CoverSpec | DebrisSpec, band: [number, number, number, number][]) =>
    out.push({ id: out.length, biome: -1, on: FLOOR_LAYERS.indexOf(spec.on), what, spec, cell: cellsFor(band, what === 'debris' ? DEBRIS_ACROSS : 0), band, seen: band[band.length - 1][3] });
  for (const spec of ecology.climate.cover) onFloor('cover', spec, COVER_FADE.map((f) => [...f] as [number, number, number, number]));
  for (const spec of ecology.climate.debris) {
    const u = debrisUnit(spec);
    onFloor('debris', spec, LEVELS.map((l) => l.fade.map((f) => f * u) as [number, number, number, number]));
  }
  return out;
}

/** The side of a plant's cells at each level it is drawn at: a few across its far edge (the level's own, or `across`). */
const cellsFor = (band: readonly (readonly number[])[], across = 0): number[] =>
  band.map((b, k) => Math.min(CELL_MAX, Math.max(CELL_MIN, 2 ** Math.round(Math.log2(b[3] / (across || LEVELS[k].across))))));

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
  if (level >= sp.band.length) return []; // not drawn at this level
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
  /**
   * Per shape: x, y, z (relative to the origin), height (m), turn about up (radians), and for debris the ground's slope
   * under it (rise per metre toward +θ and toward +z, in its upright frame; 0 for plants), `PLANT_STRIDE` floats each.
   */
  instances: Float32Array[];
  count: number;
  /** The terrain's horizon angles at the cell's middle (`horizonAt`): the cell's plants see the sunline past them. */
  horizon: [number, number];
}

/** Floats per plant in `PlantCell.instances`. */
export const PLANT_STRIDE = 7;
/** The steepest slope debris is sheared to (rise per metre); steeper ground is cliff, where it rests on a ledge. */
const MAX_TILT = 1.5;

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
  const cover = sp.on >= 0 ? coverChance(ecology, sp.on, gridOf(sp, k.level)) : null;
  const gap = spec.spacing;
  for (let row = Math.floor(b.s0 / gap); row * gap < b.s1; row++) {
    const s0 = row * gap, r = profile.at(Math.min(profile.length, s0 + gap / 2)).r;
    if (r < gap) continue; // at the axis itself, nothing grows
    const n = Math.max(1, Math.round((2 * Math.PI * r) / gap)), dTheta = (2 * Math.PI) / n;
    // The lattice squares that reach into the cell (a cell can wrap past θ = 0 only as a whole column).
    for (let col = Math.floor(b.theta0 / dTheta); col * dTheta < b.theta1; col++) {
      const it = ((col % n) + n) % n;
      const f = (q: number) => hash3f(seed, row, it, q);
      const rows = 'rows' in spec && spec.rows;
      const ps = rows ? s0 : s0 + f(0) * gap, pt = rows ? col * dTheta : (col + f(1)) * dTheta;
      if (ps < b.s0 || ps >= b.s1 || pt < b.theta0 || pt >= b.theta1 || ps > profile.length) continue;
      if (cover && f(2) >= cover(pt, ps)) continue;
      const ground = t.heightAt(pt, ps);
      if (t.standAt(pt, ps) > ground + 0.05) continue; // under water
      if (!cover) {
        const slope = slopeAt(ecology, pt, ps, ground, gap);
        // Where the ground is too steep for any biome, the nearest fit still claims it (its colour is rock), but nothing
        // grows on a wall steeper than its biome holds: the woods from afar (`colorAt`'s canopy) leave it bare too.
        if (slope > ecology.climate.biomes[sp.biome].slope + 0.1) continue;
        ecology.biomesAt(pt, ps, ground, slope, shares);
        if (f(2) >= shares[sp.biome]) continue;
      }
      const p = toWorld(profile, { theta: pt, s: ps, h: ground });
      const shape = Math.min(shapes - 1, Math.floor(f(5) * shapes));
      const [tx, tz] = sp.what === 'debris' ? tiltAt(ecology, pt, ps, p) : [0, 0];
      lists[shape].push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2], spec.height[0] + (spec.height[1] - spec.height[0]) * f(3), f(4) * 2 * Math.PI, tx, tz);
    }
  }
  const instances = lists.map((l) => new Float32Array(l));
  const horizon = horizonAt(t, (b.theta0 + b.theta1) / 2, (b.s0 + b.s1) / 2);
  return { key: k, origin, instances, count: instances.reduce((n, a) => n + a.length / PLANT_STRIDE, 0), horizon };
}

/**
 * How much of the ground a floor layer covers at a point (0 … 1), read on a lattice of side `G` (m) (rows along s, as
 * many columns around as fit) and blended between its four nearest points: the same at a point whichever cell asks,
 * and a few hundred floor readings for a cell rather than one per tuft. Each call keeps its own readings.
 */
export function coverChance(ecology: Ecology, layer: number, G = COVER_GRID): (theta: number, s: number) => number {
  const t = ecology.terrain, { profile } = t.habitat, L = FLOOR_LAYERS.length;
  const read = new Map<number, number>(), rgb = new Float32Array(3), floor = new Uint8Array(L);
  const rows = Math.ceil(profile.length / G) + 1;
  const columns = (k: number) => Math.max(1, Math.round(profile.circumference(Math.min(profile.length, k * G)) / G));
  const reading = (k: number, c: number, n: number): number => {
    const id = k + rows * c;
    let v = read.get(id);
    if (v === undefined) {
      const theta = (2 * Math.PI * c) / n, s = Math.min(profile.length, k * G), ground = t.heightAt(theta, s);
      ecology.colorAt(theta, s, ground, slopeAt(ecology, theta, s, ground, G), rgb, 0, undefined, floor);
      v = floor[layer] / 255;
      read.set(id, v);
    }
    return v;
  };
  const inRow = (k: number, theta: number): number => {
    const n = columns(k), u = (wrapAngle(theta) / (2 * Math.PI)) * n, c = Math.floor(u), f = u - c;
    return reading(k, c % n, n) * (1 - f) + reading(k, (c + 1) % n, n) * f;
  };
  return (theta, s) => {
    const v = s / G, k = Math.floor(v), f = v - k;
    return inRow(k, theta) * (1 - f) + inRow(k + 1, theta) * f;
  };
}

/** Bytes a planted cell holds (memory watchdog). */
export function cellBytes(c: PlantCell): number {
  return bytesOf(c.instances);
}

/**
 * The ground's slope at a ground point `p` (world) in the frame a plant stands in there (up toward the axis, x around
 * it, z along it): how far the ground rises per metre along x and along z, half a metre either way.
 */
function tiltAt(ecology: Ecology, theta: number, s: number, p: Vec3): [number, number] {
  // The frame `plantFrame` (render/materials.ts) stands a plant in: x = (up.y, −up.x, 0), z the axis.
  const t = ecology.terrain, { profile } = t.habitat, d = 0.5;
  const r = Math.max(Math.hypot(p[0], p[1]), 1e-6), up: Vec3 = [-p[0] / r, -p[1] / r, 0], side: Vec3 = [up[1], -up[0], 0];
  const rise = (dir: Vec3, th0: number, s0: number, th1: number, s1: number): number => {
    const a = toWorld(profile, { theta: th0, s: s0, h: t.heightAt(th0, s0) }), b = toWorld(profile, { theta: th1, s: s1, h: t.heightAt(th1, s1) });
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const run = dx * dir[0] + dy * dir[1] + dz * dir[2], lift = dx * up[0] + dy * up[1] + dz * up[2];
    return Math.abs(run) < 1e-6 ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, lift / run));
  };
  const dth = d / Math.max(profile.at(s).r, 1e-6), s0 = Math.max(0, s - d), s1 = Math.min(profile.length, s + d);
  return [rise(side, theta - dth, s, theta + dth, s), rise([0, 0, 1], theta, s0, theta, s1)];
}

/** How steep the ground is at a point (0 flat … 1 a wall), from its height a step either way (m). */
export function slopeAt(ecology: Ecology, theta: number, s: number, ground: number, step: number): number {
  const t = ecology.terrain, { profile } = t.habitat;
  const r = Math.max(profile.at(s).r, 1e-6), d = Math.max(step * 0.5, 0.5);
  // The ground's normal from a step around the axis and a step along the profile (back where it ends).
  const ta = theta + d / r, sb = s + d <= profile.length ? s + d : s - d;
  const o = toWorld(profile, { theta, s, h: ground });
  const a = toWorld(profile, { theta: ta, s, h: t.heightAt(ta, s) }), b = toWorld(profile, { theta, s: sb, h: t.heightAt(theta, sb) });
  const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2], bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2];
  let n: Vec3 = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const len = Math.hypot(n[0], n[1], n[2]), air = groundNormal(profile, theta, s);
  if (len < 1e-12) n = air;
  else {
    const facing = n[0] * air[0] + n[1] * air[1] + n[2] * air[2] < 0 ? -1 : 1;
    n = [(n[0] / len) * facing, (n[1] / len) * facing, (n[2] / len) * facing];
  }
  return groundSlope(n, theta);
}

/**
 * The nearest of a species' plants to the eye (world), searched in its nearest cells, level by level out until one
 * holds any: where it stands (world). For the debug menu's "Go" entries.
 */
export function nearestOf(ecology: Ecology, plants: readonly Species[], sp: Species, eye: Vec3, cells = 12): Vec3 | null {
  let best: Vec3 | null = null, d = Infinity;
  for (let level = 0 as Level; level < sp.band.length && !best; level++) for (const { key } of cellsNear(ecology, sp, level, eye).slice(0, cells)) {
    const c = plantCell(ecology, plants, key);
    for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const p: Vec3 = [c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]];
      const e = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
      if (e < d) { d = e; best = p; }
    }
  }
  return best;
}
