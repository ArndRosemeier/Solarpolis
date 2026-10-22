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
 *
 * Planted plants (gen/planted.ts: the founders' grove) are species of their own (`planted`): no lattice, each where it
 * was planted, at its own height; drawn at the three levels as trees are. Scattered plants and debris keep out of a
 * grove's clearing.
 */
import { hash3f, deriveSeed } from '@futuremagic/core';
import { FLOOR_LAYERS, fromWorld, groundNormal, toWorld, wrapAngle, type CoverSpec, type DebrisSpec, type Habitat, type PlantSpec, type Vec3 } from '../blueprint';
import { TREE_HEIGHT, type Ecology } from './ecology';
import { horizonAt } from './horizon';
import { groundSlope } from './terrain';
import { keptClear } from './landmarks';
import { pathsOf, type PathNet } from './paths';
import { plantedIn, plantingsOf, scatterKeepsOff } from './planted';
import { bytesOf } from './shapes';
import { kept } from './kept';

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
/** Whether (θ, s) lies on a path, or within `verge` of its width beside it (gen/paths.ts). */
const onPath = (paths: PathNet, theta: number, s: number, verge: number): boolean => {
  if (!paths.pieces) return false;
  const hit = paths.pathAt(theta, s);
  return !!hit && hit.distance < hit.width * (0.5 + verge);
};

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
  /** What it is: a biome's plant, ground cover, debris (which lies along the slope), or planted by hand (gen/planted.ts). */
  what: 'plant' | 'cover' | 'debris' | 'planted';
  spec: PlantSpec | CoverSpec | DebrisSpec;
  /** Per level it is drawn at (all of `LEVELS`, or the first two for cover): the side of its cells (m), and its bands (m from the eye: fade in x..y, out z..w). */
  cell: number[];
  band: [number, number, number, number][];
  /** How far it is seen at all (m). */
  seen: number;
  /** The tallest it grows (m). */
  tall: number;
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
  const plant = (spec: PlantSpec, biome: number, what: 'plant' | 'planted') => {
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
    out.push({ id: out.length, biome, on: -1, what, spec, cell: cellsFor(band), band, seen: band[LEVELS.length - 1][3], tall: spec.height[1] });
  };
  ecology.climate.biomes.forEach((b, biome) => { for (const spec of b.plants) plant(spec, biome, 'plant'); });
  // Each planted species as one of its own, sized by its tallest planted plant.
  const planted = plantingsOf(ecology.terrain);
  for (const spec of planted.species) {
    const tall = Math.max(...(planted.bySpecies.get(spec.name) ?? []).map((p) => p.height), spec.height[1]);
    plant({ ...spec, height: [spec.height[0], tall] }, -1, 'planted');
  }
  const onFloor = (what: 'cover' | 'debris', spec: CoverSpec | DebrisSpec, band: [number, number, number, number][]) =>
    out.push({ id: out.length, biome: -1, on: FLOOR_LAYERS.indexOf(spec.on), what, spec, cell: cellsFor(band, what === 'debris' ? DEBRIS_ACROSS : 0), band, seen: band[band.length - 1][3], tall: spec.height[1] });
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

/** A cell in sight, and the nearest and farthest anything in it can be from the eye (m). */
export interface NearCell {
  key: CellKey;
  near: number;
  far: number;
}

/**
 * The cells of a plant at a level that may hold something it draws seen from `eye` (world), nearest first: from where
 * its band starts, or from `from` (m) where it may have to draw nearer, standing in for a finer level that is not built
 * yet (gen/handover.ts).
 */
export function cellsNear(ecology: Ecology, sp: Species, level: Level, eye: Vec3, from = sp.band[level]?.[0] ?? 0): NearCell[] {
  if (level >= sp.band.length) return []; // not drawn at this level
  const { profile } = ecology.terrain.habitat;
  const at = fromWorld(profile, eye[0], eye[1], eye[2]);
  const [, , , far] = sp.band[level], near = from, cell = sp.cell[level], tall = sp.tall;
  // Too high above the ground to see any of this plant at this level: none. Above the ground under the eye, not above
  // the profile: on a hill the eye stands that much higher over the profile, and its plants with it.
  const ground = ecology.terrain.heightAt(at.theta, at.s), above = Math.max(0, at.h - ground - tall);
  if (above > far) return [];
  const reach = Math.sqrt(Math.max(0, far * far - above * above)) + cell;
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
      // On the ground under the eye: the cells it stands among are about as high, a far one's rise or fall is small to its distance.
      const c = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: ground });
      // The nearest and farthest anything in it can be: the middle, give or take half its diagonal and the tallest plant.
      const mid = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]), give = Math.hypot(b.s1 - b.s0, (b.theta1 - b.theta0) * r) / 2 + tall;
      if (mid - give < far && mid + give > near) out.push({ key: k, near: Math.max(0, mid - give), far: mid + give });
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
  const sp = plants[k.species];
  const b = cellBounds(ecology, sp, k);
  const origin = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });
  const shapes = LEVELS[k.level].variants;
  const lists: number[][] = Array.from({ length: shapes }, () => []);
  standsIn(ecology, sp, b, k.level, (pt, ps, ground, f, along0) => {
    const p = toWorld(profile, { theta: pt, s: ps, h: ground });
    const { shape, height, turn, tilt } = poseOf(ecology, sp, pt, ps, p, f, along0, shapes);
    lists[shape].push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2], height, turn, tilt[0], tilt[1]);
  });
  return finished(t, k, b, origin, lists);
}

/** How a plant stands: which of `shapes` it is, its height (m), its turn about up (radians) and, for debris, the slope it is sheared by. */
export interface Pose {
  shape: number;
  height: number;
  turn: number;
  tilt: [number, number];
}

/**
 * How a plant that `standsIn` visits stands (at (θ, s), its foot `p` in the world, its own numbers `f`, a trained
 * plant's row way `along0`), drawn with one of `shapes`: the same for every cell and level that draws it, and for the
 * physics (gen/trunks.ts).
 */
export function poseOf(ecology: Ecology, sp: Species, theta: number, s: number, p: Vec3, f: (q: number) => number, along0: number, shapes: number): Pose {
  const shape = Math.min(shapes - 1, Math.floor(f(5) * shapes)), spec = sp.spec;
  if (sp.what === 'planted') return { shape, height: f(3), turn: f(4), tilt: [0, 0] };
  const tilt = sp.what === 'debris' ? tiltAt(ecology, theta, s, p) : [0, 0] as [number, number];
  // A plant trained in a row is turned along it (its x around the axis: `plantFrame`), either way round, give or take
  // a little; anything else any way.
  const trained = 'rowGap' in spec && !!spec.rowGap;
  const turn = trained ? along0 + (f(4) < 0.5 ? 0 : Math.PI) + (f(7) - 0.5) * TRAINED_TWIST : f(4) * 2 * Math.PI;
  return { shape, height: spec.height[0] + (spec.height[1] - spec.height[0]) * f(3), turn, tilt };
}

/**
 * Where a point of a plant's shape (its own space, one unit high or long, y up) stands in the world, for a plant whose
 * foot is `foot` (world) standing as `pose` says: the CPU's twin of `plantFrame` (render/materials.ts; keep in step).
 * Up is toward the axis, x around it turned by the plant's turn toward z along it, and debris is sheared by its tilt.
 */
export function plantPoint(foot: Vec3, pose: Pose, x: number, y: number, z: number): Vec3 {
  const r = Math.hypot(foot[0], foot[1]) || 1, ux = -foot[0] / r, uy = -foot[1] / r, sx = uy, sy = -ux;
  const c = Math.cos(pose.turn), sn = Math.sin(pose.turn), h = pose.height;
  const lx = x * h, ly = y * h, lz = z * h;
  const dx = sx * c * lx + ux * ly - sx * sn * lz, dy = sy * c * lx + uy * ly - sy * sn * lz, dz = sn * lx + c * lz;
  const shear = (dx * sx + dy * sy) * pose.tilt[0] + dz * pose.tilt[1];
  return [foot[0] + dx + ux * shear, foot[1] + dy + uy * shear, foot[2] + dz];
}

/**
 * Where a species' plants stand within bounds (θ, s), each with its ground height, its own numbers (`f(q)`: 0 … 1 by
 * its lattice square; a planted one answers its height for 3, its turn for 4) and, for a plant trained in a row, the
 * row's way (a plant turn); `level` is the level whose floor-layer lattice cover and debris are read on. The one
 * place the lattice is walked: cells (`plantCell`) and anything that wants to know where plants stand (the squirrels'
 * trees, sim/fauna.ts) see the same plants.
 */
export function standsIn(ecology: Ecology, sp: Species, b: { theta0: number; theta1: number; s0: number; s1: number }, level: Level, visit: (theta: number, s: number, ground: number, f: (q: number) => number, along: number) => void): void {
  const t = ecology.terrain, h = t.habitat, { profile } = h, spec = sp.spec;
  const seed = deriveSeed(h.seed, 'scatter', spec.name, sp.biome);
  if (sp.what === 'planted') {
    // Each where it was planted, its shape from its own hash.
    for (const p of plantedIn(t, spec.name, b)) {
      const ground = t.heightAt(p.theta, p.s), own = hash3f(seed, Math.round(p.s * 16), Math.round(p.theta * 1e5), 5);
      visit(p.theta, p.s, ground, (q) => (q === 3 ? p.height : q === 4 ? p.turn : own), 0);
    }
    return;
  }
  const paths = pathsOf(t.habitat);
  const shares = new Float32Array(ecology.climate.biomes.length);
  const cover = sp.on >= 0 ? coverChance(ecology, sp.on, gridOf(sp, level)) : null;
  // The lattice: rows `along` apart along s, columns `gap` apart around the axis in each. Rows planted by people are
  // that far apart on level ground: along the profile's level run (`levelRunOf`), so on an endcap's terraces they stand
  // as close as on the floor. Plants trained in rows (vines) take the spots of a square lattice their spacing apart that
  // lie on a row (`onRow`), drawn onto it.
  const gap = spec.spacing, rowGap = ('rowGap' in spec && spec.rowGap) || 0, along = gap;
  const rows = 'rows' in spec && !!spec.rows, trained = rowGap > 0, run = rows || trained ? levelRunOf(profile) : null;
  const u0 = run ? run.u(b.s0) : b.s0, u1 = run ? run.u(b.s1) : b.s1;
  for (let row = Math.floor(u0 / along); row * along < u1; row++) {
    const s0 = run ? run.s(row * along) : row * along, r = profile.at(Math.min(profile.length, run ? s0 : s0 + along / 2)).r;
    if (r < gap) continue; // at the axis itself, nothing grows
    const n = Math.max(1, Math.round((2 * Math.PI * r) / gap)), dTheta = (2 * Math.PI) / n;
    // The lattice squares that reach into the bounds (a cell can wrap past θ = 0 only as a whole column).
    for (let col = Math.floor(b.theta0 / dTheta); col * dTheta < b.theta1; col++) {
      const it = ((col % n) + n) % n;
      const f = (q: number) => hash3f(seed, row, it, q);
      let ps = rows ? s0 : s0 + f(0) * along, pt = rows ? col * dTheta : (col + f(1)) * dTheta;
      if (ps < b.s0 || ps >= b.s1 || pt < b.theta0 || pt >= b.theta1 || ps > profile.length) continue;
      let along0 = 0;
      if (trained) {
        const at = onRow(t, run!, pt, ps, rowGap, gap);
        if (!at) continue;
        pt = at.theta; ps = at.s; along0 = at.turn;
      }
      if (cover && f(2) >= cover(pt, ps)) continue;
      const ground = t.heightAt(pt, ps);
      if (t.standAt(pt, ps) > ground + 0.05) continue; // under water
      if (keptClear(t, pt, ps)) continue; // under a landmark, or on the way onto it
      if (sp.what !== 'cover' && scatterKeepsOff(t, pt, ps)) continue; // a grove's clearing (its lawn stays)
      if (sp.what !== 'cover' && onPath(paths, pt, ps, sp.what === 'debris' ? 0 : 0.25)) continue; // a path, and its verges for plants
      if (ps < profile.floorStart && snowKeepsOff(ecology, sp, pt, ps, ground, f(6))) continue;
      if (!cover) {
        const slope = slopeAt(ecology, pt, ps, ground, gap);
        // Where the ground is too steep for any biome, the nearest fit still claims it (its colour is rock), but nothing
        // grows on a wall steeper than its biome holds: the woods from afar (`colorAt`'s canopy) leave it bare too.
        if (slope > ecology.climate.biomes[sp.biome].slope + 0.1) continue;
        ecology.biomesAt(pt, ps, ground, slope, shares);
        if (f(2) >= shares[sp.biome]) continue;
      }
      visit(pt, ps, ground, f, along0);
    }
  }
}

/**
 * Where a spot of a trained plant's square lattice (`spacing` apart) stands on a row `rowGap` from the next, or null
 * when it lies between rows: drawn square onto the nearest row if that is within half the spacing, and the row's way
 * there (a plant turn: 0 around the axis, `plantFrame`). On the Gate's terraces (`Terrain.terraceAt`) the rows follow the
 * terrace, its lines of one level, counted from where its ledge begins; elsewhere they run around the axis, `rowGap`
 * apart along the level run.
 */
export function onRow(t: Ecology['terrain'], run: { u(s: number): number; s(u: number): number }, theta: number, s: number, rowGap: number, spacing: number): { theta: number; s: number; turn: number } | null {
  const { profile } = t.habitat;
  const here = s > profile.floorEnd ? t.terraceAt(theta, s) : null;
  if (!here) {
    const u = run.u(s), off = Math.round(u / rowGap) * rowGap - u;
    return Math.abs(off) < spacing / 2 ? { theta, s: run.s(u + off), turn: 0 } : null;
  }
  // Across the rows is up the level's gradient (over level ground: per metre around the axis, and along it, where a step
  // along the profile is |nr| of a step on the level). Step that far along it to the row's line, twice, as the line bends.
  const p = profile.at(s), r = Math.max(p.r, 1), cos = Math.max(Math.abs(p.nr), 0.3), d = 0.5;
  let at = here, pt = theta, ps = s, turn = 0;
  for (let k = 0; k < 2; k++) {
    const a = t.terraceAt(pt + d / r, ps), b = t.terraceAt(pt, ps + d);
    if (!a || !b || a.tier !== at.tier || b.tier !== at.tier) return null; // on a terrace's brink
    const gu = (a.level - at.level) / d, gv = (b.level - at.level) / (d * cos), g = Math.hypot(gu, gv);
    if (!(g > 1e-6)) return null;
    // How far across the terrace's ledge the spot is, and the nearest row's line from it.
    const x = ((at.level / at.step - at.tier) * at.step) / g, off = (Math.floor(x / rowGap) + 0.5) * rowGap - x;
    if (k === 0 && Math.abs(off) >= spacing / 2) return null;
    pt += (off * gu) / g / r; ps += (off * gv) / g / cos; turn = Math.atan2(gu, -gv);
    const next = t.terraceAt(pt, ps);
    if (!next || next.tier !== here.tier) return null;
    at = next;
  }
  return { theta: pt, s: ps, turn };
}

/** The level run's samples along the profile (m), and how steep a slope it counts (|nr|, the cosine from level, at least). */
const RUN_STEP = 2;
const RUN_STEEPEST = 0.3;

/**
 * How far one walks on level ground for each metre along the profile, summed from the wild end (`u`), and back (`s`):
 * 1 on the floor, 1 / cos of the slope up an endcap (gravity points away from the axis there, so level ground is a
 * terrace's ledge at one radius). A terrace's ledge covers only that share of the profile's length, so rows of plants
 * spaced by `u` stand their spacing apart on it. Made once per profile (a few hundred kB at most).
 */
export const levelRunOf: (profile: Habitat['profile']) => { u(s: number): number; s(u: number): number } = kept((profile) => {
  const n = Math.ceil(profile.length / RUN_STEP) + 1, us = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const s = Math.min(profile.length, (i - 0.5) * RUN_STEP), nr = Math.abs(profile.at(s).nr);
    us[i] = us[i - 1] + RUN_STEP / Math.max(nr, RUN_STEEPEST);
  }
  const u = (s: number): number => {
    const f = Math.min(n - 1, Math.max(0, s / RUN_STEP)), i = Math.min(n - 2, Math.floor(f));
    return us[i] + (us[i + 1] - us[i]) * (f - i);
  };
  const back = (v: number): number => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (us[m] <= v) lo = m; else hi = m; }
    return (lo + (v - us[lo]) / Math.max(us[hi] - us[lo], 1e-9)) * RUN_STEP;
  };
  return { u, s: back };
});

/** How far a plant trained in a row (vines) turns off it at most (radians). */
const TRAINED_TWIST = 0.12;

/** Debris at least this tall (m, the smallest of its kind) stands out of the snow: boulders, not stones. */
const OUT_OF_SNOW = 0.8;
/** The share of boulders the snow buries above the snow line: the rest stand out of it. */
const BURIED = 0.97;

/**
 * Whether the Mountain's snow keeps a plant or a stone off a point (gen/snow.ts, by gravity: the snow line's band),
 * with `chance` its own number (0 … 1): above the line nothing grows and no small stones lie (under the snow, or on
 * walls too steep to hold them); a few boulders stand out of it.
 */
function snowKeepsOff(ecology: Ecology, sp: Species, theta: number, s: number, ground: number, chance: number): boolean {
  const above = ecology.snowAt(theta, s, ground);
  if (above === 0) return false;
  return chance < (sp.what === 'debris' && sp.spec.height[0] >= OUT_OF_SNOW ? BURIED * above : above);
}

/** A planted cell from its plants' floats per shape. */
/**
 * A sphere round everything a cell draws, relative to its origin: about its plants' feet (the origin is on the profile,
 * which on a hill lies far below them), out to the farthest, and up past the tallest (`tallest` m). For frustum culling.
 */
export function cellSphere(cell: PlantCell, tallest: number): { middle: Vec3; radius: number } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const data of cell.instances) for (let i = 0; i < data.length; i += PLANT_STRIDE) for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c], data[i + c]); hi[c] = Math.max(hi[c], data[i + c]);
  }
  if (!(lo[0] <= hi[0])) return { middle: [0, 0, 0], radius: tallest };
  return { middle: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + tallest * 1.2 };
}

function finished(t: Ecology['terrain'], k: CellKey, b: { theta0: number; theta1: number; s0: number; s1: number }, origin: Vec3, lists: number[][]): PlantCell {
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
  // Two steps over the ground, around the axis and along the profile, each in the frame (x, z, up). Where the ground's
  // height changes around the axis on a steep endcap, the step around moves along z as well, so the plane through
  // both steps is solved for, not read off each step alone.
  const groundStep = (th0: number, s0: number, th1: number, s1: number): [number, number, number] => {
    const a = toWorld(profile, { theta: th0, s: s0, h: t.heightAt(th0, s0) }), b = toWorld(profile, { theta: th1, s: s1, h: t.heightAt(th1, s1) });
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    return [dx * side[0] + dy * side[1], dz, dx * up[0] + dy * up[1]];
  };
  const dth = d / Math.max(profile.at(s).r, 1e-6), s0 = Math.max(0, s - d), s1 = Math.min(profile.length, s + d);
  const [ux, uz, uu] = groundStep(theta - dth, s, theta + dth, s), [vx, vz, vu] = groundStep(theta, s0, theta, s1);
  // up = tx·x + tz·z through both steps.
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-9) return [0, 0];
  const clamp = (v: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));
  return [clamp((uu * vz - uz * vu) / det), clamp((ux * vu - uu * vx) / det)];
}

/** How steep the ground is at a point (0 flat … 1 a wall), from its height a step either way (m). */
export function slopeAt(ecology: Ecology, theta: number, s: number, ground: number, step: number): number {
  return groundSlope(normalAt(ecology, theta, s, ground, step), theta);
}

/** The ground's unit normal at a point (world, into the air), from its height a step either way (m). */
export function normalAt(ecology: Ecology, theta: number, s: number, ground: number, step: number): Vec3 {
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
  return n;
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
