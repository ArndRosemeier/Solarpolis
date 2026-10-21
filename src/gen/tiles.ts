/**
 * The terrain's tile tree: one quadtree over the interior's (θ, s) grid, which wraps around the axis. The profile is
 * cut into bands along s; each band has as many root tiles around as its circumference needs (fewer near the axis,
 * like longitude lines at a pole). A tile splits until its error on screen is under a pixel or two, so the far side
 * overhead stays coarse and the ground underfoot gets fine.
 *
 * A tile splits in two along s always, and in two around the axis only where its row is wide enough (`splitsAround`):
 * the endcaps' rings shrink to nothing at the axis, and halving every tile around as well would cut them into
 * slivers there (a 60° wedge at a cone's tip still halved eight times), thousands of them around the eye wherever the
 * sunline meets an endcap. So tiles stay about square everywhere, like the bands' own columns.
 *
 * A built tile is a grid of points on the ground, kept relative to its own origin so that a renderer drawing
 * everything relative to the camera never loses precision (docs/ARCHITECTURE.md, "Where does the camera sit?").
 * Edges between tiles of different size are hidden by skirts: a strip hanging down from each edge. Pure: no three.js.
 */
import { groundNormal, toWorld, wrapAngle, type Vec3 } from '../blueprint';
import { groundSlope, type Terrain } from './terrain';
import { horizonAt } from './horizon';
import type { Ecology } from './ecology';
import { buildWater, type WaterMesh } from './water';

/** Cells along each side of a tile. */
export const TILE_CELLS = 64;

export interface Band {
  s0: number;
  s1: number;
  /** Root tiles around the axis in this band. */
  columns: number;
}

export interface TileLayout {
  bands: Band[];
  /** Root tile size along s (m), about the same around. */
  rootSize: number;
  /** Deepest level: its cells are no finer than `finest` (m). */
  maxLevel: number;
  /** Per band, per level, per row j: how many times that row's tiles are halved around the axis (`splitsAround`). */
  around: Uint8Array[][];
}

/**
 * A node of the tree: root (band, column), then `level` halvings along s, at (i, j) within the root (j along, i around;
 * i counts the row's own halvings around, `splitsAround`).
 */
export interface TileKey {
  band: number;
  column: number;
  level: number;
  i: number;
  j: number;
}

export const keyId = (k: TileKey): string => `${k.band}:${k.column}:${k.level}:${k.i}:${k.j}`;

/**
 * A point's rise over the ground around it (as a slope: + on ridges, − in hollows), at its tile's scale and its
 * parent's, packed into one float of the `morph` attribute's fourth place: each in 256 steps over ±`RISE_RANGE`.
 */
export const RISE_RANGE = 0.5;
export function packRelief(own: number, parent: number): number {
  const step = (k: number): number => Math.min(255, Math.max(0, Math.round(127.5 + (k / RISE_RANGE) * 127.5)));
  return step(own) * 256 + step(parent);
}
export function unpackRelief(w: number): [number, number] {
  const a = Math.floor(w / 256), b = w - a * 256;
  return [((a - 127.5) / 127.5) * RISE_RANGE, ((b - 127.5) / 127.5) * RISE_RANGE];
}

/** Horizon angles are baked every this many cells (TILE_CELLS must divide by it). */
const HORIZON_STEP = 8;

/**
 * A tile's cells may span at most this many pixels on screen before it splits, however flat the ground: the woods'
 * edges, the rivers and banks, and the light on the relief are carried by the points, so a flat far tile must still be
 * fine enough for them (docs/far-view.md). Its shape alone (`error`) would leave the far side at the roots' cells.
 */
export const CELL_PIXELS = 12;
/**
 * ...and need never be finer than this many pixels, however rough the ground: a rock wall's error does not shrink as
 * its tile splits (no grid of heights draws a wall until its cells are narrower than the wall is wide), so its error
 * alone would split every tile that sees a cliff down to the finest level (near the foot of the Gate: 4,214 tiles drawn,
 * 2026-10-21). Up close every tile is at the finest level anyway.
 */
export const FINEST_CELL_PIXELS = 4;

/** The pixels a tile's error may cover at full detail (`select`'s `maxPixels` is this, or more when a view is over its budget). */
export const ERROR_PIXELS = 2;

/**
 * The size on the ground (m) a tile's split is judged by: its error, but at most what its cells would show at
 * `FINEST_CELL_PIXELS`, and at least what they show at `CELL_PIXELS` (at `ERROR_PIXELS`' scale: a `maxPixels` above
 * it makes all three coarser together). `select` and the geomorph's hand-over distance use the same.
 */
export function splitError(layout: TileLayout, k: TileKey, error: number): number {
  const cell = cellSize(layout, k) * ERROR_PIXELS;
  return Math.max(Math.min(error, cell / FINEST_CELL_PIXELS), cell / CELL_PIXELS);
}

/** Root tiles in the whole tree, about: enough that the far side is covered, few enough to build at load. */
const ROOTS = 48;
/** The finest cell edge (m): a step's length, enough for paths and banks; detail below that is the shaders' job. */
const FINEST = 0.5;

export function makeLayout(terrain: Terrain): TileLayout {
  const { profile, radius } = terrain.habitat;
  const area = 2 * Math.PI * radius * profile.length;
  const rows = Math.max(2, Math.round(profile.length / Math.sqrt(area / ROOTS)));
  const rootSize = profile.length / rows;
  const bands: Band[] = [];
  for (let b = 0; b < rows; b++) {
    const s0 = b * rootSize, s1 = (b + 1) * rootSize;
    // The widest circle in the band sets how many tiles go around it.
    const widest = Math.max(profile.circumference(s0), profile.circumference(s1), profile.circumference((s0 + s1) / 2));
    bands.push({ s0, s1, columns: Math.max(1, Math.round(widest / rootSize)) });
  }
  const maxLevel = Math.max(0, Math.ceil(Math.log2(rootSize / TILE_CELLS / FINEST)));
  // Halvings around per row: as many as keep the row's tiles at least about as wide (at their widest circle) as they
  // are long, but never fewer than the parent row's (tiles only split) nor more than one more (one split per level).
  const around = bands.map((b) => {
    const levels: Uint8Array[] = [Uint8Array.of(0)];
    for (let l = 1; l <= maxLevel; l++) {
      const rows = 1 << l, ds = (b.s1 - b.s0) / rows, row = new Uint8Array(rows);
      for (let j = 0; j < rows; j++) {
        const s0 = b.s0 + j * ds, s1 = s0 + ds;
        const widest = Math.max(profile.circumference(s0), profile.circumference(s1), profile.circumference((s0 + s1) / 2));
        const want = Math.round(Math.log2(Math.max(1e-9, widest / b.columns / ds)));
        const up = levels[l - 1][j >> 1];
        row[j] = Math.min(up + 1, Math.max(up, want));
      }
      levels.push(row);
    }
    return levels;
  });
  return { bands, rootSize, maxLevel, around };
}

/** How many times a node's row is halved around the axis (its `level` along s; equal to it on the floor). */
export function splitsAround(layout: TileLayout, k: { band: number; level: number; j: number }): number {
  return layout.around[k.band][k.level][k.j];
}

/** The (θ, s) rectangle a node covers. */
export function bounds(layout: TileLayout, k: TileKey): { theta0: number; theta1: number; s0: number; s1: number } {
  const band = layout.bands[k.band];
  const dTheta = (2 * Math.PI) / band.columns / (1 << splitsAround(layout, k));
  const dS = (band.s1 - band.s0) / (1 << k.level);
  const theta0 = (2 * Math.PI * k.column) / band.columns + k.i * dTheta;
  const s0 = band.s0 + k.j * dS;
  return { theta0, theta1: theta0 + dTheta, s0, s1: s0 + dS };
}

export function roots(layout: TileLayout): TileKey[] {
  const out: TileKey[] = [];
  layout.bands.forEach((b, band) => { for (let c = 0; c < b.columns; c++) out.push({ band, column: c, level: 0, i: 0, j: 0 }); });
  return out;
}

/** The node's children: its two rows along s, each in one or two tiles around (four on the floor, two at the axis). */
export function children(layout: TileLayout, k: TileKey): TileKey[] {
  const level = k.level + 1, here = splitsAround(layout, k), out: TileKey[] = [];
  for (const j of [k.j * 2, k.j * 2 + 1]) {
    if (splitsAround(layout, { band: k.band, level, j }) > here) out.push({ ...k, level, i: k.i * 2, j }, { ...k, level, i: k.i * 2 + 1, j });
    else out.push({ ...k, level, i: k.i, j });
  }
  return out;
}

/** Whether a node's parent was halved around to make it (else only along s). */
export function splitAround(layout: TileLayout, k: TileKey): boolean {
  return k.level > 0 && splitsAround(layout, k) > splitsAround(layout, { band: k.band, level: k.level - 1, j: k.j >> 1 });
}

/** The node one level up (a root's parent is itself). */
export function parent(layout: TileLayout, k: TileKey): TileKey {
  return k.level === 0 ? k : { ...k, level: k.level - 1, i: splitAround(layout, k) ? k.i >> 1 : k.i, j: k.j >> 1 };
}

/**
 * A sphere around a node's ground at h = 0 (world axes). A built tile's own `relief` widens it in `select`: each tile
 * measures its own, so a flat meadow underfoot is not taken to be as near as the tallest terrace anywhere could be.
 */
export function sphere(terrain: Terrain, layout: TileLayout, k: TileKey): { center: Vec3; radius: number } {
  const b = bounds(layout, k);
  const { profile } = terrain.habitat;
  const tc = (b.theta0 + b.theta1) / 2, sc = (b.s0 + b.s1) / 2;
  const center = toWorld(profile, { theta: tc, s: sc, h: 0 });
  let radius = 0;
  for (const s of [b.s0, sc, b.s1]) {
    for (const t of [b.theta0, tc, b.theta1]) {
      const p = toWorld(profile, { theta: t, s, h: 0 });
      radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
    }
  }
  return { center, radius };
}

/** `sphere`, remembered per tile: the tree is walked every frame. */
export function spheres(terrain: Terrain, layout: TileLayout): (k: TileKey) => { center: Vec3; radius: number } {
  const memo = new Map<string, { center: Vec3; radius: number }>();
  return (k) => {
    const id = keyId(k);
    let sp = memo.get(id);
    if (!sp) { sp = sphere(terrain, layout, k); memo.set(id, sp); }
    return sp;
  };
}

/** Size of a node's cells along s (m): its error if drawn instead of its children. */
export function cellSize(layout: TileLayout, k: TileKey): number {
  return layout.rootSize / (1 << k.level) / TILE_CELLS;
}

/** What the selection needs of a built tile. */
export interface TileFit {
  /** How far its grid strays from the true ground (m). */
  error: number;
  /** How far its ground lies off h = 0 at most (m). */
  relief: number;
}

export interface Selection {
  /** The tiles to draw this frame: together they cover the whole interior once. */
  draw: TileKey[];
  /**
   * Built tiles the view needs besides those it draws: the ones split to reach them, and the children already built
   * of a tile drawn while its other children are built. A cache must keep these too, or the view falls back to coarse
   * tiles, or never gets all four children at once.
   */
  keep: TileKey[];
  /** Tiles that should exist but are not built yet, most needed first. */
  want: TileKey[];
}

/**
 * Choose the tiles for a view: split a tile while its error (how far its grid strays from the true ground, measured
 * when it was built) looks bigger than `maxPixels` from `eye` (with `pixelsPerRadian` = screen height / vertical
 * field of view), or its cells look bigger than `CELL_PIXELS` (`splitError`), provided all its children are built. `fitOf` gives a
 * built tile's error and relief (`TileMesh` has both), undefined if not built.
 */
export function select(terrain: Terrain, layout: TileLayout, eye: Vec3, pixelsPerRadian: number, maxPixels: number, fitOf: (k: TileKey) => TileFit | undefined, sphereOf = spheres(terrain, layout)): Selection {
  const ready = (k: TileKey): boolean => fitOf(k) !== undefined;
  const draw: TileKey[] = [], keep: TileKey[] = [];
  const want: { k: TileKey; need: number }[] = [];
  const visit = (k: TileKey): void => {
    const fit = fitOf(k);
    if (!fit) { want.push({ k, need: Infinity }); return; }
    const sp = sphereOf(k);
    const d = Math.max(1, Math.hypot(eye[0] - sp.center[0], eye[1] - sp.center[1], eye[2] - sp.center[2]) - sp.radius - fit.relief);
    // How far over its limits the tile is: its error, or its cells.
    const pixels = (splitError(layout, k, fit.error) / d) * pixelsPerRadian;
    if (pixels <= maxPixels || k.level >= layout.maxLevel) { draw.push(k); return; }
    const kids = children(layout, k);
    const missing = kids.filter((c) => !ready(c));
    if (missing.length) {
      draw.push(k);
      for (const c of kids) if (ready(c)) keep.push(c); else want.push({ k: c, need: pixels });
      return;
    }
    keep.push(k);
    for (const c of kids) visit(c);
  };
  for (const r of roots(layout)) visit(r);
  want.sort((a, b) => b.need - a.need);
  return { draw, keep, want: want.map((w) => w.k) };
}

/**
 * Keeps the tiles a view uses within its share of the cache's bytes: after each frame the view reports the bytes of
 * the built tiles it drew or kept, and while they are over `high` of the budget the selection's pixel error is let
 * grow (`scale`, ×1.05 a frame: small steps, so it stops near what the view needs), coarser tiles standing in; under
 * `low` it eases back to 1. Coarser by ×1.05 is about 10 % fewer tiles, so the gap between the two holds it still. Whatever the ground
 * (a cliff's error does not shrink as tiles split), the view's memory stays bounded, and nothing is evicted that a
 * view still uses.
 */
export class LodBudget {
  /** Multiplies the selection's `maxPixels`. */
  scale = 1;
  constructor(readonly bytes: number, private readonly high = 0.8, private readonly low = 0.6, private readonly most = 64) {}

  /** After a frame: the bytes of the built tiles the view drew or kept. Returns the scale for the next frame. */
  update(used: number): number {
    if (used > this.bytes * this.high) this.scale = Math.min(this.most, this.scale * 1.05);
    else if (used < this.bytes * this.low && this.scale > 1) this.scale = Math.max(1, this.scale / 1.02);
    return this.scale;
  }
}

export interface TileMesh {
  key: TileKey;
  /** World position the tile's points are relative to (float64). */
  origin: Vec3;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /**
   * Geomorphing: per point, the offset from where it is to where the parent tile's coarser surface lies at the same
   * (θ, s). A renderer blends towards it as the tile nears the distance where its parent takes over, so the swap shows
   * no pop. Zero on points the parent shares. Fourth: the point's rise over the ground around it, at this tile's scale
   * and the parent's (`packRelief`), blended the same way.
   */
  morph: Float32Array;
  /**
   * Per point, four numbers: the terrain's horizon angles toward the port and the wild end (gen/horizon.ts), its
   * sunline shadow; then the woods as the far view draws them (`Ecology.colorAt`'s `wood`): the share of the ground
   * the crowns cover (0 … 1) and how far apart the trees stand (m). One attribute, as WebGPU allows 8 vertex buffers.
   */
  horizon: Float32Array;
  /** Per point, the woods' canopy over it seen from afar (`Ecology.colorAt`): the crowns' linear RGB and height (m). */
  canopy: Float32Array;
  /** Per point, the shares of the floor layers (`FLOOR_LAYERS`, 0 … 255): the first four, then the other four. */
  floorA: Uint8Array;
  floorB: Uint8Array;
  index: Uint32Array;
  /** How far the grid strays from the true ground between its points (m): its error on screen decides splitting. */
  error: number;
  /** How far its ground (and anything between its points) lies off h = 0 at most (m): how much nearer than its flat sphere it can be. */
  relief: number;
  /** The water over this tile (the lake, the rivers: `gen/water.ts`), if any, relative to the same origin. */
  water: WaterMesh | null;
}

/** Bytes a built tile holds, for the memory watchdog. */
export function tileBytes(t: TileMesh): number {
  let b = t.positions.byteLength + t.normals.byteLength + t.colors.byteLength + t.morph.byteLength + t.horizon.byteLength + t.canopy.byteLength + t.floorA.byteLength + t.floorB.byteLength + t.index.byteLength;
  if (t.water) for (const a of [t.water.positions, t.water.normals, t.water.flow, t.water.dir, t.water.index]) b += a.byteLength;
  return b;
}

/** Build a tile's ground (and the water over it). */
export function buildTile(ecology: Ecology, layout: TileLayout, k: TileKey): TileMesh {
  const terrain = ecology.terrain;
  const { profile } = terrain.habitat;
  const b = bounds(layout, k);
  const N = TILE_CELLS, row = N + 1;
  const dT = (b.theta1 - b.theta0) / N, dS = (b.s1 - b.s0) / N;
  const origin = toWorld(profile, { theta: (b.theta0 + b.theta1) / 2, s: (b.s0 + b.s1) / 2, h: 0 });

  // Heights on the grid plus a one-cell border, so every normal uses its true neighbours.
  const W = N + 3;
  const world = new Float64Array(W * W * 3);
  const heights = new Float64Array(W * W);
  for (let jj = 0; jj < W; jj++) {
    const s = Math.min(profile.length, Math.max(0, b.s0 + (jj - 1) * dS));
    for (let ii = 0; ii < W; ii++) {
      const theta = b.theta0 + (ii - 1) * dT;
      const h = terrain.heightAt(theta, s);
      heights[jj * W + ii] = h;
      const p = toWorld(profile, { theta, s, h });
      world.set(p, (jj * W + ii) * 3);
    }
  }

  const skirt = 4 * N;
  const count = row * row + skirt + 4;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const canopy = new Float32Array(count * 4);
  const woodAt = new Float32Array(count * 2);
  const floor = new Uint8Array(count * 8);
  for (let j = 0; j <= N; j++) {
    const s = Math.min(profile.length, Math.max(0, b.s0 + j * dS));
    for (let i = 0; i <= N; i++) {
      const w = ((j + 1) * W + (i + 1)) * 3, v = (j * row + i) * 3;
      positions[v] = world[w] - origin[0]; positions[v + 1] = world[w + 1] - origin[1]; positions[v + 2] = world[w + 2] - origin[2];
      // Normal from the neighbours: (along θ) × (along s), which faces the air.
      const ax = world[w + 3] - world[w - 3], ay = world[w + 4] - world[w - 2], az = world[w + 5] - world[w - 1];
      const up = w + W * 3, dn = w - W * 3;
      const bx = world[up] - world[dn], by = world[up + 1] - world[dn + 1], bz = world[up + 2] - world[dn + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const theta = b.theta0 + i * dT;
      // Where the grid collapses (a tile touching the axis), fall back to the profile's normal.
      const air = groundNormal(profile, theta, s);
      if (len > 1e-9) { nx /= len; ny /= len; nz /= len; } else { [nx, ny, nz] = air; }
      if (nx * air[0] + ny * air[1] + nz * air[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      normals[v] = nx; normals[v + 1] = ny; normals[v + 2] = nz;
      const slope = groundSlope([nx, ny, nz], theta);
      ecology.colorAt(theta, s, heights[(j + 1) * W + (i + 1)], slope, colors, v, canopy, floor, woodAt);
    }
  }

  // Morph targets: the parent's grid has every other point of this one (along s, and around where the parent was
  // halved around too), and its cells split along the same diagonal (from (i+1, j) to (i, j+1)), so the parent's
  // surface at a point between its points is the mean of two of them.
  const morph = new Float32Array(count * 4);
  const at = (i: number, j: number): number => ((j + 1) * W + (i + 1)) * 3;
  const halvedAround = splitAround(layout, k);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const oddI = halvedAround ? i & 1 : 0, oddJ = j & 1;
      if (!oddI && !oddJ) continue;
      const [p, q] = oddI && oddJ ? [at(i + 1, j - 1), at(i - 1, j + 1)] : oddI ? [at(i - 1, j), at(i + 1, j)] : [at(i, j - 1), at(i, j + 1)];
      const w = at(i, j), v = (j * row + i) * 4;
      for (let c = 0; c < 3; c++) morph[v + c] = (world[p + c] + world[q + c]) / 2 - world[w + c];
    }
  }

  // Hollows and ridges (docs/far-view.md): how far each point stands above or below the ground around it, as a slope,
  // at two and four cells out, and for the parent at four and eight (its cells are twice as big). GROUND darkens hollows
  // and lightens ridges by it, at whatever scale the tile shows, and blends to the parent's with the morph.
  const OUT = 8, WW = N + 1 + 2 * OUT;
  const wide = new Float64Array(WW * WW);
  for (let jj = 0; jj < WW; jj++) {
    const s = Math.min(profile.length, Math.max(0, b.s0 + (jj - OUT) * dS));
    for (let ii = 0; ii < WW; ii++) {
      const i = ii - OUT, j = jj - OUT;
      wide[jj * WW + ii] = i >= -1 && i <= N + 1 && j >= -1 && j <= N + 1 ? heights[(j + 1) * W + (i + 1)] : terrain.heightAt(b.theta0 + i * dT, s);
    }
  }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const, RADII = [2, 4, 8];
  // Per row: each (radius, direction)'s offset in `wide` and one over its distance (m).
  const offset = new Int32Array(RADII.length * DIRS.length), inv = new Float64Array(offset.length), rise = new Float64Array(RADII.length);
  RADII.forEach((r, n) => DIRS.forEach(([di, dj], d) => { offset[n * DIRS.length + d] = (dj * WW + di) * r; }));
  for (let j = 0; j <= N; j++) {
    const across = dT * Math.max(profile.at(Math.min(profile.length, Math.max(0, b.s0 + j * dS))).r, 1e-3);
    RADII.forEach((r, n) => DIRS.forEach(([di, dj], d) => { inv[n * DIRS.length + d] = 1 / DIRS.length / Math.hypot(di * r * across, dj * r * dS); }));
    for (let i = 0; i <= N; i++) {
      const c = (j + OUT) * WW + i + OUT, h = wide[c];
      for (let n = 0; n < RADII.length; n++) {
        let k = 0;
        for (let d = 0; d < DIRS.length; d++) k += (h - wide[c + offset[n * DIRS.length + d]]) * inv[n * DIRS.length + d];
        rise[n] = k;
      }
      morph[(j * row + i) * 4 + 3] = packRelief((rise[0] + rise[1]) / 2, (rise[1] + rise[2]) / 2);
    }
  }

  // Horizons on a coarse grid (they change slowly: hills, banks, the endcaps), bilinear in between.
  const horizon = new Float32Array(count * 4);
  const H = TILE_CELLS / HORIZON_STEP, hrow = H + 1, coarse = new Float32Array(hrow * hrow * 2);
  for (let j = 0; j <= H; j++) {
    const s = Math.min(profile.length, Math.max(0, b.s0 + j * HORIZON_STEP * dS));
    for (let i = 0; i <= H; i++) coarse.set(horizonAt(terrain, b.theta0 + i * HORIZON_STEP * dT, s), (j * hrow + i) * 2);
  }
  for (let j = 0; j <= N; j++) {
    const cj = Math.min(H - 1, Math.floor(j / HORIZON_STEP)), fj = j / HORIZON_STEP - cj;
    for (let i = 0; i <= N; i++) {
      const ci = Math.min(H - 1, Math.floor(i / HORIZON_STEP)), fi = i / HORIZON_STEP - ci;
      const a = (cj * hrow + ci) * 2, bb = a + 2, d = a + hrow * 2, e = d + 2, v = (j * row + i) * 4;
      for (let c = 0; c < 2; c++) {
        horizon[v + c] = (coarse[a + c] * (1 - fi) + coarse[bb + c] * fi) * (1 - fj) + (coarse[d + c] * (1 - fi) + coarse[e + c] * fi) * fj;
      }
    }
  }

  // The woods, after the horizons.
  for (let v = 0; v < row * row; v++) { horizon[v * 4 + 2] = Math.min(1, woodAt[v * 2]); horizon[v * 4 + 3] = woodAt[v * 2 + 1]; }

  // Skirts: each edge point again, sunk below the ground by about a cell, so a coarser neighbour's gap is covered.
  const edge: number[] = [];
  for (let i = 0; i < N; i++) edge.push(i);                       // s0 edge
  for (let j = 0; j < N; j++) edge.push(j * row + N);             // θ1 edge
  for (let i = N; i > 0; i--) edge.push(N * row + i);             // s1 edge
  for (let j = N; j > 0; j--) edge.push(j * row);                 // θ0 edge
  const sink = Math.max(dS, dT * profile.at((b.s0 + b.s1) / 2).r) * 0.5 + 0.5;
  edge.forEach((e, n) => {
    const v = (row * row + n) * 3, src = e * 3;
    for (let c = 0; c < 3; c++) {
      positions[v + c] = positions[src + c] - normals[src + c] * sink;
      normals[v + c] = normals[src + c];
      colors[v + c] = colors[src + c];
    }
    for (let c = 0; c < 4; c++) morph[(row * row + n) * 4 + c] = morph[e * 4 + c];
    for (let c = 0; c < 4; c++) canopy[(row * row + n) * 4 + c] = canopy[e * 4 + c];
    for (let c = 0; c < 8; c++) floor[(row * row + n) * 8 + c] = floor[e * 8 + c];
    for (let c = 0; c < 4; c++) horizon[(row * row + n) * 4 + c] = horizon[e * 4 + c];
  });

  const index: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * row + i, bb = a + 1, d = a + row, e = d + 1;
      // Faces look into the air: (along s) × (along θ) at the first vertex, as in the coarse surface.
      index.push(a, d, bb, bb, d, e);
    }
  }
  // Skirt quads, both faces (a two-sided strip seen from either neighbour).
  for (let n = 0; n < edge.length; n++) {
    const a = edge[n], bb = edge[(n + 1) % edge.length], sa = row * row + n, sb = row * row + ((n + 1) % edge.length);
    index.push(a, sa, bb, bb, sa, sb, a, bb, sa, bb, sb, sa);
  }

  // The error: at cell centres (every other one), the true ground against the cell's four corners averaged. This
  // catches both the relief between the points and the cylinder's own curve across the cell.
  let error = 0;
  for (let j = 0; j < N; j += 2) {
    const s = Math.min(profile.length, b.s0 + (j + 0.5) * dS);
    for (let i = 0; i < N; i += 2) {
      const theta = b.theta0 + (i + 0.5) * dT;
      const p = toWorld(profile, { theta, s, h: terrain.heightAt(theta, s) });
      const c = [((j + 1) * W + (i + 1)) * 3, ((j + 1) * W + (i + 2)) * 3, ((j + 2) * W + (i + 1)) * 3, ((j + 2) * W + (i + 2)) * 3];
      const ex = p[0] - (world[c[0]] + world[c[1]] + world[c[2]] + world[c[3]]) / 4;
      const ey = p[1] - (world[c[0] + 1] + world[c[1] + 1] + world[c[2] + 1] + world[c[3] + 1]) / 4;
      const ez = p[2] - (world[c[0] + 2] + world[c[1] + 2] + world[c[2] + 2] + world[c[3] + 2]) / 4;
      error = Math.max(error, Math.sqrt(ex * ex + ey * ey + ez * ez));
    }
  }
  // A tile that has children never claims to be finer than its cells can show at all.
  error = Math.max(error, cellSize(layout, k) * 0.02);
  let relief = 0;
  for (const g of heights) relief = Math.max(relief, Math.abs(g));
  relief += error;

  // The floor shares as two four-channel attributes.
  const floorA = new Uint8Array(count * 4), floorB = new Uint8Array(count * 4);
  for (let v = 0; v < count; v++) for (let c = 0; c < 4; c++) { floorA[v * 4 + c] = floor[v * 8 + c]; floorB[v * 4 + c] = floor[v * 8 + 4 + c]; }
  // The water: where the cells are too coarse for a river's channel, it lies over the ground drawn here, this tile's or
  // its parent's (every other point along s, and around if it was halved around; the same diagonals) while it morphs.
  const drawn = (theta: number, s: number): number => {
    let x = wrapAngle(theta - b.theta0);
    if (x > Math.PI + (b.theta1 - b.theta0) / 2) x -= 2 * Math.PI;
    const fi = Math.min(N + 1, Math.max(-1, x / dT)), fj = Math.min(N + 1, Math.max(-1, (s - b.s0) / dS));
    const on = (si: number, sj: number): number => {
      // The cell under the point, on this grid (border points included) or the parent's (even points only).
      const cell = (f: number, step: number): number => Math.min(step === 1 ? N : N - 2, Math.max(step === 1 ? -1 : 0, Math.floor(f / step) * step));
      const ci = cell(fi, si), cj = cell(fj, sj);
      const u = (fi - ci) / si, v = (fj - cj) / sj;
      const hAt = (i: number, j: number) => heights[(j + 1) * W + (i + 1)];
      const a = hAt(ci, cj), bb = hAt(ci + si, cj), d = hAt(ci, cj + sj), e = hAt(ci + si, cj + sj);
      return u + v <= 1 ? a + (bb - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (bb - e) * (1 - v);
    };
    return Math.max(on(1, 1), on(halvedAround ? 2 : 1, 2));
  };
  const cell = Math.max(dS, dT * profile.at((b.s0 + b.s1) / 2).r);
  const water = buildWater(terrain, { ...b, cell, drawn }, origin);
  return { key: k, origin, positions, normals, colors, morph, horizon, canopy, floorA, floorB, index: Uint32Array.from(index), error, relief, water };
}
