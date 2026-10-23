/**
 * The water over a terrain tile: the ring lake's surface, the lakes' on the floor (gen/plan.ts, `meres`) and the rivers'
 * ribbons (`rivers.ts`), in one mesh, so a tile draws its water once. Every point carries how the water moves there (`flow`: across the river, how far downstream,
 * how fast, how steep) and which way it runs (`dir`), for the water's ripples, white water and glints (`WATER` in
 * render/materials.ts). The lakes lie still. A lake's grid follows its shore: the points of a cell its water reaches
 * that lie past the shore are drawn in onto it, along the line from the lake's middle, so its outline is smooth at any
 * level; a river through a lake runs under it, and its ribbon stops at the shores.
 *
 * A river's ribbon in a tile is its middle line clipped to the tile's (θ, s) rectangle, sampled every power-of-two
 * number of the river's own samples (so the levels nest), about twice per cell along the river. Neighbouring tiles cut
 * the line at the same edges, so the pieces meet. Where the tile's cells are wider than the river, its ground cannot
 * show the channel, so the ribbon is lifted over the ground the tile draws there (`drawn`): far away a river stays a
 * river instead of sinking under a coarse hillside. Pure.
 */
import { groundNormal, toWorld, wrapAngle, type Vec3 } from '../blueprint';
import type { Terrain } from './terrain';
import { mereEdge, mereReach, type Mere } from './plan';
import { riverPoint as sample, sampleS, type River, type RiverPoint as Along } from './rivers';
import { v3cross, v3dot, v3norm, v3sub } from '@futuremagic/core';

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
  for (const m of terrain.meres) mereOver(terrain, m, tile, origin, out);
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

/**
 * A lake's surface over a tile's rectangle: a grid at the water's level over the part of its footprint in the tile, each
 * point past the shore of a cell the water reaches drawn in onto the shore; cells wholly ashore left out.
 */
function mereOver(terrain: Terrain, m: Mere, b: WaterTile, origin: Vec3, out: Builder): void {
  const { profile } = terrain.habitat, R = terrain.habitat.radius, reach = mereReach(m);
  const s0 = Math.max(b.s0, m.s - reach), s1 = Math.min(b.s1, m.s + reach);
  if (s1 <= s0) return;
  // Its middle round the axis brought next to the tile's (within half a turn of its middle).
  const mid = (b.theta0 + b.theta1) / 2, theta = mid + wrapAngle(m.theta - mid + Math.PI) - Math.PI;
  const t0 = Math.max(b.theta0, theta - reach / R), t1 = Math.min(b.theta1, theta + reach / R);
  if (t1 <= t0) return;
  const N = LAKE_CELLS, row = N + 1;
  const edge = new Float64Array(row * row), at = new Float64Array(row * row * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * row + i, th = t0 + ((t1 - t0) * i) / N, s = s0 + ((s1 - s0) * j) / N, e = mereEdge(m, R, th, s);
    edge[k] = e;
    // Past the shore: in along the line from its middle onto the shore.
    const du = (th - theta) * R, dv = s - m.s, r = Math.hypot(du, dv), f = e > 0 && r > 0 ? Math.max(0, 1 - e / r) : 1;
    at[k * 2] = theta + (du * f) / R; at[k * 2 + 1] = m.s + dv * f;
  }
  // Only the points of the cells drawn, each once.
  const still = [0, 0, 0, 0], made = new Int32Array(row * row).fill(-1);
  const pointOf = (k: number): number => {
    if (made[k] < 0) {
      made[k] = out.points;
      out.point(toWorld(profile, { theta: at[k * 2], s: at[k * 2 + 1], h: m.level }), origin, groundNormal(profile, at[k * 2], at[k * 2 + 1]), still, [0, 0, 1, 0]);
    }
    return made[k];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * row + i;
    if (Math.min(edge[k], edge[k + 1], edge[k + row], edge[k + row + 1]) >= 0) continue;
    const p = pointOf(k), q = pointOf(k + 1), r = pointOf(k + row), t = pointOf(k + row + 1);
    out.index.push(p, r, q, q, r, t);
  }
}

/**
 * Where a river runs through the lakes on the floor: the stretches of its s (from, to, …) where its middle line is in a
 * lake's water, each end found to a hundredth of a sample apart; kept per river.
 */
const wetRuns = new WeakMap<River, Float64Array>();
function wetOf(terrain: Terrain, r: River): Float64Array {
  let runs = wetRuns.get(r);
  if (runs) return runs;
  const R = terrain.habitat.radius, list: number[] = [];
  const wet = (s: number): boolean => {
    const theta = sample(r, s).theta;
    return terrain.meres.some((m) => Math.abs(s - m.s) < mereReach(m) && mereEdge(m, R, theta, s) < 0);
  };
  const cut = (a: number, b: number): number => {
    const from = wet(a);
    for (let k = 0; k < 12; k++) { const c = (a + b) / 2; if (wet(c) === from) a = c; else b = c; }
    return (a + b) / 2;
  };
  if (terrain.meres.length) {
    let was = wet(r.s0), start = r.s0;
    for (let i = 1; i < r.count; i++) {
      const s = sampleS(r, i), now = wet(s);
      if (now === was) continue;
      const c = cut(s - r.step, s);
      if (now) start = c; else list.push(start, c);
      was = now;
    }
    if (was) list.push(start, r.s0 + r.step * (r.count - 1));
  }
  runs = Float64Array.from(list);
  wetRuns.set(r, runs);
  return runs;
}

/** A river's ribbon over a tile: its middle line clipped to the tile, each run of it a strip of cross-sections. */
function riverOver(terrain: Terrain, r: River, b: WaterTile, origin: Vec3, out: Builder): void {
  const lake = terrain.lake;
  // From the spring to the lake's edge (the lake's own grid takes over there), but through the lakes on the floor.
  let lo = r.s0, hi = r.s0 + r.step * (r.count - 1);
  if (lake) { if (r.from === 'wild') hi = Math.min(hi, lake.s - lake.halfWidth); else lo = Math.max(lo, lake.s + lake.halfWidth); }
  const wet = wetOf(terrain, r);
  for (let k = 0; k <= wet.length; k += 2) {
    const a = k === 0 ? lo : Math.max(lo, wet[k - 1]), c = k < wet.length ? Math.min(hi, wet[k]) : hi;
    if (c > a) ribbonOver(terrain, r, b, origin, out, a, c);
  }
}

/** A river's ribbon over a tile, between lo and hi along s. */
function ribbonOver(terrain: Terrain, r: River, b: WaterTile, origin: Vec3, out: Builder, lo: number, hi: number): void {
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
    if (Math.max(at(t0).steep, at(t1).steep) > 0.35) fallVolume(terrain, r, b, at(t0), at(t1), origin, out);
    open = t1 < 1 ? -1 : next;
  }
}

/** Pieces across a ribbon: enough for its edges to follow a coarse tile's ground, and for the shallows' shading. */
const ACROSS = 4;

/** Five overlapping ropes give a fall a closed cross-section instead of a paper edge.
 * Width and depth come from its river; all LODs use the same section and run coordinates. */
const FALL_STREAMS = 5, FALL_SIDES = 8;
function fallVolume(t: Terrain, river: River, tile: WaterTile, a: Along, b: Along, origin: Vec3, out: Builder): void {
  const h = t.habitat, dir = flowDirection(t, river, a);
  const makeRing = (at: Along, stream: number): { start: number; centre: Vec3; up: Vec3; thick: number } => {
    const radial = groundNormal(h.profile, at.theta, at.s), flow = flowDirection(t, river, at);
    const up = v3norm(radial.map((v, k) => v - flow[k] * v3dot(radial, flow)) as Vec3);
    const side = v3norm(v3cross(flow, up));
    // Side follows increasing theta, independent of which end the river flows from.
    const around: Vec3 = [-Math.sin(at.theta), Math.cos(at.theta), 0];
    if (v3dot(side, around) < 0) for (let k = 0; k < 3; k++) side[k] *= -1;
    const x = -1 + (2 * (stream + 0.5)) / FALL_STREAMS, width = at.halfWidth * 1.06 / FALL_STREAMS;
    const falling = Math.min(1, Math.max(0, (at.steep - 0.2) / 0.7));
    const depth = Math.min(river.depth * 0.65, width * 0.7);
    const thick = Math.max(0.015, depth * falling * (0.8 + 0.2 * Math.sin(at.run / Math.max(width, 0.1) * 2 + stream * 2.4)));
    const theta = at.theta + x * at.halfWidth / Math.max(1, h.profile.at(at.s).r);
    const level = tile.cell > at.halfWidth * 0.25 ? Math.max(at.surface, tile.drawn(theta, at.s) + 0.05 + tile.cell * 0.02) : at.surface;
    const centre = toWorld(h.profile, { theta, s: at.s, h: level });
    const start = out.points;
    for (let k = 0; k < FALL_SIDES; k++) {
      const angle = 2 * Math.PI * k / FALL_SIDES, c = Math.cos(angle), s = Math.sin(angle);
      const normal = v3norm(up.map((v, q) => v * s / thick + side[q] * c / width) as Vec3);
      const p = centre.map((v, q) => v + side[q] * c * width + up[q] * (s + 0.15) * thick) as Vec3;
      out.point(p, origin, normal, [x + c / FALL_STREAMS, at.run, speedOf(at.steep), at.steep], [...flow, at.halfWidth]);
    }
    return { start, centre, up, thick };
  };
  const triangle = (a: number, b: number, c: number): void => {
    const point = (k: number) => out.positions.slice(k * 3, k * 3 + 3) as Vec3;
    const n = v3cross(v3sub(point(b), point(a)), v3sub(point(c), point(a)));
    const facing = out.normals.slice(a * 3, a * 3 + 3) as Vec3;
    out.index.push(a, ...(v3dot(n, facing) >= 0 ? [b, c] : [c, b]));
  };
  for (let stream = 0; stream < FALL_STREAMS; stream++) {
    const first = makeRing(a, stream), last = makeRing(b, stream);
    for (let k = 0; k < FALL_SIDES; k++) {
      const next = (k + 1) % FALL_SIDES;
      triangle(first.start + k, last.start + k, first.start + next);
      triangle(first.start + next, last.start + k, last.start + next);
    }
    // End faces close pieces at tile boundaries; coincident neighbours meet at identical run coordinates.
    for (const [ring, at, sign] of [[first, a, -1], [last, b, 1]] as const) {
      const outward = dir.map((v) => v * sign * (river.from === 'wild' ? 1 : -1)) as Vec3;
      const centre = out.points;
      out.point(ring.centre.map((v, q) => v + ring.up[q] * ring.thick * 0.15) as Vec3, origin, outward, [0, at.run, speedOf(at.steep), at.steep], [...dir, at.halfWidth]);
      for (let k = 0; k < FALL_SIDES; k++) triangle(centre, ring.start + k, ring.start + (k + 1) % FALL_SIDES);
    }
    // Detached spray in front of the ropes: tiny closed ellipsoids, carried along by WATER's spray phase.
    // Their negative steepness tags only the motion; shading uses its magnitude.
    if (tile.cell < Math.min(a.halfWidth, b.halfWidth) && Math.min(first.thick, last.thick) > 0.1) {
      const up = v3norm(first.up.map((v, k) => v + last.up[k]) as Vec3), side = v3norm(v3cross(dir, up));
      const thickness = (first.thick + last.thick) / 2, radius = thickness * 0.18;
      const mid = first.centre.map((v, k) => (v + last.centre[k]) / 2 + up[k] * thickness * (1.8 + 0.4 * Math.sin(a.run + stream))) as Vec3;
      const start = out.points;
      for (const [axis, size] of [[side, radius], [up, radius], [dir, radius * 2.5]] as const) for (const sign of [-1, 1]) {
        out.point(mid.map((v, k) => v + axis[k] * size * sign) as Vec3, origin, axis.map((v) => v * sign) as Vec3,
          [0, (a.run + b.run) / 2, speedOf(a.steep), -Math.max(a.steep, b.steep)], [...dir, a.halfWidth]);
      }
      for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) triangle(start + x, start + y, start + z);
    }
  }
}

/** Downstream, shared by the surface and the fall's volume. */
function flowDirection(t: Terrain, r: River, a: Along): Vec3 {
  const ds = Math.max(r.step * 0.5, 0.25) * (r.from === 'wild' ? 1 : -1);
  const next = sample(r, Math.min(r.s0 + r.step * (r.count - 1), Math.max(r.s0, a.s + ds)));
  const p = t.habitat.profile;
  return v3norm(v3sub(toWorld(p, { theta: next.theta, s: next.s, h: next.surface }), toWorld(p, { theta: a.theta, s: a.s, h: a.surface })));
}

/** One cross-section of a river at a point of its middle line; returns its first point's index. */
function section(terrain: Terrain, r: River, b: WaterTile, a: Along, origin: Vec3, out: Builder): number {
  const { profile } = terrain.habitat;
  const p = profile.at(a.s), rad = Math.max(p.r, 1e-6);
  // Downstream: along the line, in the world (the next point minus this one).
  const [dx, dy, dz] = flowDirection(terrain, r, a);
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
