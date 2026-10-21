/**
 * The water over a terrain tile: the ring lake's surface and the rivers' ribbons (`rivers.ts`), in one mesh, so a tile
 * draws its water once. Every point carries how the water moves there (`flow`: across the river, how far downstream,
 * how fast, how steep) and which way it runs (`dir`), for the water's ripples, white water and glints (`WATER` in
 * render/materials.ts). The lake lies still.
 *
 * A river's ribbon in a tile is its middle line clipped to the tile's (θ, s) rectangle, sampled every power-of-two
 * number of the river's own samples (so the levels nest), about twice per cell along the river. Neighbouring tiles cut
 * the line at the same edges, so the pieces meet. Where the tile's cells are wider than the river, its ground cannot
 * show the channel, so the ribbon is lifted over the ground the tile draws there (`drawn`): far away a river stays a
 * river instead of sinking under a coarse hillside. Pure.
 */
import { groundNormal, toWorld, wrapAngle, type Vec3 } from '../blueprint';
import type { Terrain } from './terrain';
import { riverPoint as sample, type River, type RiverPoint as Along } from './rivers';

export interface WaterMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Per point: across the river (−1 … 1, 0 in the middle and on the lake), run downstream (m), speed (m/s), steepness. */
  flow: Float32Array;
  /** Per point: the way the water runs (world axes, unit), and the river's half width there (m; 0 on the lake). */
  dir: Float32Array;
  index: Uint32Array;
}

/** A tile's rectangle, its cells, and the height its own ground is drawn at (incl. the parent's, while it morphs). */
export interface WaterTile {
  theta0: number;
  theta1: number;
  s0: number;
  s1: number;
  /** Cell edge along s and around (m, around at the tile's middle). */
  cell: number;
  drawn: (theta: number, s: number) => number;
}

/** Cells along each side of the lake's grid in one tile. */
const LAKE_CELLS = 16;
/** How fast a river runs on its slow stretches (m/s), and how much a fall adds, by the root of its steepness. */
const SLOW = 0.5, RUSH = 9, FASTEST = 7;

/** How fast water runs where it falls `steep` m per m. */
export const speedOf = (steep: number): number => Math.min(FASTEST, SLOW + RUSH * Math.sqrt(Math.max(0, steep)));

class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly flow: number[] = [];
  readonly dir: number[] = [];
  readonly index: number[] = [];
  get points(): number { return this.positions.length / 3; }
  point(p: Vec3, origin: Vec3, n: Vec3, flow: readonly number[], dir: readonly number[]): void {
    this.positions.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.flow.push(flow[0], flow[1], flow[2], flow[3]);
    this.dir.push(dir[0], dir[1], dir[2], dir[3]);
  }
  /**
   * Quads between two rows of `across + 1` points starting at a and b (b the farther along s, each row in rising θ):
   * they face the air, as the ground's faces do.
   */
  strip(a: number, b: number, across: number): void {
    for (let k = 0; k < across; k++) {
      const p = a + k, q = a + k + 1, r = b + k, t = b + k + 1;
      this.index.push(p, r, q, q, r, t);
    }
  }
  done(): WaterMesh | null {
    if (!this.index.length) return null;
    return {
      positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals),
      flow: Float32Array.from(this.flow), dir: Float32Array.from(this.dir), index: Uint32Array.from(this.index),
    };
  }
}

/** The water over a tile: the lake's surface and the rivers' ribbons, relative to the tile's origin; null if dry. */
export function buildWater(terrain: Terrain, tile: WaterTile, origin: Vec3): WaterMesh | null {
  const out = new Builder();
  lakeOver(terrain, tile, origin, out);
  for (const river of terrain.rivers) riverOver(terrain, river, tile, origin, out);
  return out.done();
}

/** The lake's surface over a tile's rectangle: a grid at the water's level, fine enough to follow the curve. */
function lakeOver(terrain: Terrain, b: WaterTile, origin: Vec3, out: Builder): void {
  const lake = terrain.lake;
  if (!lake) return;
  const s0 = Math.max(b.s0, lake.s - lake.halfWidth), s1 = Math.min(b.s1, lake.s + lake.halfWidth);
  if (s1 <= s0) return;
  const { profile } = terrain.habitat;
  const N = LAKE_CELLS, row = N + 1, first = out.points, still = [0, 0, 0, 0];
  for (let j = 0; j <= N; j++) {
    const s = s0 + ((s1 - s0) * j) / N;
    for (let i = 0; i <= N; i++) {
      const theta = b.theta0 + ((b.theta1 - b.theta0) * i) / N;
      out.point(toWorld(profile, { theta, s, h: lake.level }), origin, groundNormal(profile, theta, s), still, [0, 0, 1, 0]);
    }
  }
  for (let j = 0; j < N; j++) out.strip(first + j * row, first + (j + 1) * row, N);
}

/** A river's ribbon over a tile: its middle line clipped to the tile, each run of it a strip of cross-sections. */
function riverOver(terrain: Terrain, r: River, b: WaterTile, origin: Vec3, out: Builder): void {
  const lake = terrain.lake;
  // From the spring to the lake's edge (the lake's own grid takes over there).
  let lo = r.s0, hi = r.s0 + r.step * (r.count - 1);
  if (lake) { if (r.from === 'wild') hi = Math.min(hi, lake.s - lake.halfWidth); else lo = Math.max(lo, lake.s + lake.halfWidth); }
  const sA = Math.max(lo, b.s0), sB = Math.min(hi, b.s1);
  if (!(sB > sA)) return;
  // Every k-th sample (k a power of two), about two per cell; plus the cuts at the tile's edges.
  const k = 2 ** Math.max(0, Math.floor(Math.log2(b.cell / 2 / r.step)));
  const along: Along[] = [sample(r, sA)];
  const gap = r.step * k;
  for (let n = Math.floor((sA - r.s0) / gap) + 1; r.s0 + n * gap < sB; n++) along.push(sample(r, r.s0 + n * gap));
  along.push(sample(r, sB));
  const span = b.theta1 - b.theta0;
  // How far around from θ0, within half a turn either side of the tile's middle (so a line crossing θ0 from below
  // comes in from negative u).
  const u = (theta: number) => { const x = wrapAngle(theta - b.theta0); return x > span / 2 + Math.PI ? x - 2 * Math.PI : x; };
  // Walk the line (in rising s); keep the pieces inside [θ0, θ1].
  let open = -1; // the first point of the cross-section the strip has reached, or −1 if none is open
  for (let n = 0; n + 1 < along.length; n++) {
    const a = along[n], c = along[n + 1];
    const ua = u(a.theta);
    const du = c.theta - a.theta;
    // The share of the segment inside: where u is within [0, span].
    let t0 = 0, t1 = 1;
    if (du !== 0) {
      const tLo = (0 - ua) / du, tHi = (span - ua) / du;
      t0 = Math.max(0, Math.min(tLo, tHi)); t1 = Math.min(1, Math.max(tLo, tHi));
    } else if (ua < 0 || ua > span) { t1 = -1; }
    if (!(t1 > t0)) { open = -1; continue; }
    const at = (t: number): Along => (t <= 0 ? a : t >= 1 ? c : sample(r, a.s + (c.s - a.s) * t));
    if (open < 0 || t0 > 0) open = section(terrain, r, b, at(t0), origin, out);
    const next = section(terrain, r, b, at(t1), origin, out);
    out.strip(open, next, ACROSS);
    open = t1 < 1 ? -1 : next;
  }
}

/** Pieces across a ribbon: enough for its edges to follow a coarse tile's ground, and for the shallows' shading. */
const ACROSS = 4;

/** One cross-section of a river at a point of its middle line; returns its first point's index. */
function section(terrain: Terrain, r: River, b: WaterTile, a: Along, origin: Vec3, out: Builder): number {
  const { profile } = terrain.habitat;
  const p = profile.at(a.s), rad = Math.max(p.r, 1e-6);
  // Downstream: along the line, in the world (the next point minus this one).
  const ds = Math.max(r.step * 0.5, 0.25) * (r.from === 'wild' ? 1 : -1);
  const n2 = sample(r, Math.min(r.s0 + r.step * (r.count - 1), Math.max(r.s0, a.s + ds)));
  const here = toWorld(profile, { theta: a.theta, s: a.s, h: a.surface }), there = toWorld(profile, { theta: n2.theta, s: n2.s, h: n2.surface });
  let dx = there[0] - here[0], dy = there[1] - here[1], dz = there[2] - here[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  // Too coarse to carve the channel cleanly (fewer than about eight cells across it, and a coarser parent's while it
  // morphs): lift the water over the ground the tile draws. Only the finest tiles, near the eye, keep it at its level
  // between banks that rise out of it.
  const coarse = b.cell > a.halfWidth * 0.25, lift = 0.05 + b.cell * 0.02;
  const first = out.points;
  for (let j = 0; j <= ACROSS; j++) {
    const x = -1 + (2 * j) / ACROSS, theta = a.theta + (x * a.halfWidth) / rad;
    const h = coarse ? Math.max(a.surface, b.drawn(theta, a.s) + lift) : a.surface;
    // Up: the profile's normal, tipped forward as the water falls (a falling surface faces downstream).
    let [nx, ny, nz] = groundNormal(profile, theta, a.s);
    const dot = nx * dx + ny * dy + nz * dz;
    nx -= dx * dot; ny -= dy * dot; nz -= dz * dot;
    const nl = Math.hypot(nx, ny, nz) || 1;
    out.point(toWorld(profile, { theta, s: a.s, h }), origin, [nx / nl, ny / nl, nz / nl], [x, a.run, speedOf(a.steep), a.steep], [dx, dy, dz, a.halfWidth]);
  }
  return first;
}
