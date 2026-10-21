/**
 * The terrain's tile tree: one quadtree over the interior's (θ, s) grid, which wraps around the axis. The profile is
 * cut into bands along s; each band has as many root tiles around as its circumference needs (fewer near the axis,
 * like longitude lines at a pole). A tile splits into four until its error on screen is under a pixel or two, so the
 * far side overhead stays coarse and the ground underfoot gets fine.
 *
 * A built tile is a grid of points on the ground, kept relative to its own origin so that a renderer drawing
 * everything relative to the camera never loses precision (docs/ARCHITECTURE.md, "Where does the camera sit?").
 * Edges between tiles of different size are hidden by skirts: a strip hanging down from each edge. Pure: no three.js.
 */
import { toWorld, type Vec3 } from '../blueprint';
import type { Terrain } from './terrain';

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
}

/** A node of the tree: root (band, column), then `level` halvings, at (i, j) within the root (i around, j along). */
export interface TileKey {
  band: number;
  column: number;
  level: number;
  i: number;
  j: number;
}

export const keyId = (k: TileKey): string => `${k.band}:${k.column}:${k.level}:${k.i}:${k.j}`;

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
  return { bands, rootSize, maxLevel };
}

/** The (θ, s) rectangle a node covers. */
export function bounds(layout: TileLayout, k: TileKey): { theta0: number; theta1: number; s0: number; s1: number } {
  const band = layout.bands[k.band];
  const dTheta = (2 * Math.PI) / band.columns / (1 << k.level);
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

export function children(k: TileKey): TileKey[] {
  const l = k.level + 1, i = k.i * 2, j = k.j * 2;
  return [
    { ...k, level: l, i, j }, { ...k, level: l, i: i + 1, j },
    { ...k, level: l, i, j: j + 1 }, { ...k, level: l, i: i + 1, j: j + 1 },
  ];
}

/** The node one level up (a root's parent is itself). */
export function parent(k: TileKey): TileKey {
  return k.level === 0 ? k : { ...k, level: k.level - 1, i: k.i >> 1, j: k.j >> 1 };
}

/** A sphere around a node's ground (world axes), allowing for the relief. */
export function sphere(terrain: Terrain, layout: TileLayout, k: TileKey): { center: Vec3; radius: number } {
  const b = bounds(layout, k);
  const { profile, params } = terrain.habitat;
  const tc = (b.theta0 + b.theta1) / 2, sc = (b.s0 + b.s1) / 2;
  const center = toWorld(profile, { theta: tc, s: sc, h: 0 });
  let radius = 0;
  for (const s of [b.s0, sc, b.s1]) {
    for (const t of [b.theta0, tc, b.theta1]) {
      const p = toWorld(profile, { theta: t, s, h: 0 });
      radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
    }
  }
  const relief = Math.max(params.relief.hills, params.relief.terraceStep, params.relief.ringLake?.depth ?? 0);
  return { center, radius: radius + relief };
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

export interface Selection {
  /** The tiles to draw this frame: together they cover the whole interior once. */
  draw: TileKey[];
  /** Tiles that should exist but are not built yet, most needed first. */
  want: TileKey[];
}

/**
 * Choose the tiles for a view: split a tile while its error (how far its grid strays from the true ground, measured
 * when it was built) looks bigger than `maxPixels` from `eye` (with `pixelsPerRadian` = screen height / vertical
 * field of view), provided all four children are built. `errorOf` gives a built tile's error, undefined if not built.
 */
export function select(terrain: Terrain, layout: TileLayout, eye: Vec3, pixelsPerRadian: number, maxPixels: number, errorOf: (k: TileKey) => number | undefined, sphereOf = spheres(terrain, layout)): Selection {
  const ready = (k: TileKey): boolean => errorOf(k) !== undefined;
  const draw: TileKey[] = [];
  const want: { k: TileKey; need: number }[] = [];
  const visit = (k: TileKey): void => {
    if (!ready(k)) { want.push({ k, need: Infinity }); return; }
    const sp = sphereOf(k);
    const d = Math.max(1, Math.hypot(eye[0] - sp.center[0], eye[1] - sp.center[1], eye[2] - sp.center[2]) - sp.radius);
    const pixels = (errorOf(k)! / d) * pixelsPerRadian;
    if (pixels <= maxPixels || k.level >= layout.maxLevel) { draw.push(k); return; }
    const kids = children(k);
    const missing = kids.filter((c) => !ready(c));
    if (missing.length) {
      draw.push(k);
      for (const c of missing) want.push({ k: c, need: pixels });
      return;
    }
    for (const c of kids) visit(c);
  };
  for (const r of roots(layout)) visit(r);
  want.sort((a, b) => b.need - a.need);
  return { draw, want: want.map((w) => w.k) };
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
   * no pop. Zero on points the parent shares.
   */
  morph: Float32Array;
  index: Uint32Array;
  /** How far the grid strays from the true ground between its points (m): its error on screen decides splitting. */
  error: number;
  /** The ring lake's water over this tile, if any: positions and normals relative to the same origin. */
  water: { positions: Float32Array; normals: Float32Array; index: Uint32Array } | null;
}

/** Bytes a built tile holds, for the memory watchdog. */
export function tileBytes(t: TileMesh): number {
  let b = t.positions.byteLength + t.normals.byteLength + t.colors.byteLength + t.morph.byteLength + t.index.byteLength;
  if (t.water) b += t.water.positions.byteLength + t.water.normals.byteLength + t.water.index.byteLength;
  return b;
}

/** Build a tile's ground (and the lake's water over it). */
export function buildTile(terrain: Terrain, layout: TileLayout, k: TileKey): TileMesh {
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
  for (let j = 0; j <= N; j++) {
    const s = Math.min(profile.length, Math.max(0, b.s0 + j * dS));
    const pp = profile.at(s);
    for (let i = 0; i <= N; i++) {
      const w = ((j + 1) * W + (i + 1)) * 3, v = (j * row + i) * 3;
      positions[v] = world[w] - origin[0]; positions[v + 1] = world[w + 1] - origin[1]; positions[v + 2] = world[w + 2] - origin[2];
      // Normal from the neighbours: (along θ) × (along s), which faces the air.
      const ax = world[w + 3] - world[w - 3], ay = world[w + 4] - world[w - 2], az = world[w + 5] - world[w - 1];
      const up = w + W * 3, dn = w - W * 3;
      const bx = world[up] - world[dn], by = world[up + 1] - world[dn + 1], bz = world[up + 2] - world[dn + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      const theta = b.theta0 + i * dT;
      // Where the grid collapses (a tile touching the axis), fall back to the profile's normal.
      const air = [pp.nr * Math.cos(theta), pp.nr * Math.sin(theta), pp.nz];
      if (len > 1e-9) { nx /= len; ny /= len; nz /= len; } else { [nx, ny, nz] = air; }
      if (nx * air[0] + ny * air[1] + nz * air[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      normals[v] = nx; normals[v + 1] = ny; normals[v + 2] = nz;
      // Slope: how far the ground tilts from the profile's own direction (0 flat, 1 a wall); the profile's slope too.
      const tilt = 1 - (nx * air[0] + ny * air[1] + nz * air[2]);
      const slope = Math.min(1, Math.max(Math.abs(pp.nz), tilt * 3));
      terrain.colorAt(theta, s, heights[(j + 1) * W + (i + 1)], slope, colors, v);
    }
  }

  // Morph targets: the parent's grid has every other point of this one, and its cells split along the same diagonal
  // (from (i+1, j) to (i, j+1)), so the parent's surface at a point between its points is the mean of two of them.
  const morph = new Float32Array(count * 3);
  const at = (i: number, j: number): number => ((j + 1) * W + (i + 1)) * 3;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const oddI = i & 1, oddJ = j & 1;
      if (!oddI && !oddJ) continue;
      const [p, q] = oddI && oddJ ? [at(i + 1, j - 1), at(i - 1, j + 1)] : oddI ? [at(i - 1, j), at(i + 1, j)] : [at(i, j - 1), at(i, j + 1)];
      const w = at(i, j), v = (j * row + i) * 3;
      for (let c = 0; c < 3; c++) morph[v + c] = (world[p + c] + world[q + c]) / 2 - world[w + c];
    }
  }

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
      morph[v + c] = morph[src + c];
    }
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
      error = Math.max(error, Math.hypot(ex, ey, ez));
    }
  }
  // A tile that has children never claims to be finer than its cells can show at all.
  error = Math.max(error, cellSize(layout, k) * 0.02);

  return { key: k, origin, positions, normals, colors, morph, index: Uint32Array.from(index), error, water: buildWater(terrain, b, origin) };
}

/** The lake's surface over a tile's rectangle: a grid at the water's level, fine enough to follow the curve. */
function buildWater(terrain: Terrain, b: { theta0: number; theta1: number; s0: number; s1: number }, origin: Vec3): TileMesh['water'] {
  const lake = terrain.lake;
  if (!lake) return null;
  const s0 = Math.max(b.s0, lake.s - lake.halfWidth), s1 = Math.min(b.s1, lake.s + lake.halfWidth);
  if (s1 <= s0) return null;
  const { profile } = terrain.habitat;
  const N = 16, row = N + 1;
  const positions = new Float32Array(row * row * 3), normals = new Float32Array(row * row * 3);
  for (let j = 0; j <= N; j++) {
    const s = s0 + ((s1 - s0) * j) / N;
    const pp = profile.at(s);
    for (let i = 0; i <= N; i++) {
      const theta = b.theta0 + ((b.theta1 - b.theta0) * i) / N;
      const p = toWorld(profile, { theta, s, h: lake.level });
      const v = (j * row + i) * 3;
      positions[v] = p[0] - origin[0]; positions[v + 1] = p[1] - origin[1]; positions[v + 2] = p[2] - origin[2];
      normals[v] = pp.nr * Math.cos(theta); normals[v + 1] = pp.nr * Math.sin(theta); normals[v + 2] = pp.nz;
    }
  }
  const index = new Uint32Array(N * N * 6);
  let n = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * row + i, bb = a + 1, d = a + row, e = d + 1;
    index[n++] = a; index[n++] = d; index[n++] = bb; index[n++] = bb; index[n++] = d; index[n++] = e;
  }
  return { positions, normals, index };
}
