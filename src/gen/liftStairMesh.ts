/**
 * The Lift Stair's meshes (gen/liftStair.ts lays it out): tiles of a quadtree over the ramp (gen/detailTree.ts), each
 * holding the parts it owns, more of them the smaller the tile, so detail keeps coming in as the eye comes closer and
 * the whole stair is there from across the habitat:
 *
 * - far (tiles of more than about a hundred handrails): each leg's run of steps as a slab under its nosing line, its
 *   parapets as walls, the platforms with their parapets;
 * - mid (down to twenty handrails): every step, tread and riser, its parapets per step; lamps on the platforms and
 *   landings;
 * - near: bronze nosings on the steps, copings on the parapets, handrails along them.
 *
 * The root tiles are the far form and are always drawn where nothing finer is (render/liftStair.ts). A part belongs
 * to the tile its middle lies in, so neighbouring tiles at any two levels never draw it twice; a run of steps cut by a
 * tile's edge is closed there with a wall, under the nosing line, that the neighbour's steps stand in front of.
 *
 * Every wall goes `BURY` under the ground, so the stair stands in the slope, never on it. Positions are relative to
 * the tile's frame (`placeAt` at its middle: x along the axis, z up), so planes read as floors and walls for the
 * BUILT kind's patterns. `buildStairSolid` is what the physics stands on, near a point. Pure.
 */
import { v3cross, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, type Habitat } from '../blueprint';
import { Shape, bytesOf, intoPlace, type MappedArrays, type Place, type RGB } from './shapes';
import { wantedCells, type Grid, type GridEye, type TileKey, type WantedTile } from './detailTree';
import { legShapesOf, lineAt, liftStairOf, onLeg, rampOf, type LegShape, type LiftStair, type PlanPoint, type Ramp, type StairPlatform } from './liftStair';
import { placeAt } from './landmarks';
import { FINISH } from './pavilion';
import { kept } from './kept';

/** What a builder makes: a tile's detail, the physics' solid parts, or only a count of what a tile holds. */
export type StairDetail = 'far' | 'mid' | 'near' | 'solid' | 'count';

/** Linear albedo: the walls' stone, the treads' and floors' paler paving, bronze, the lamps' glass. */
const STONE: RGB = [0.5, 0.47, 0.42];
const PAVING: RGB = [0.58, 0.55, 0.5];
const BRONZE: RGB = [0.22, 0.15, 0.08];
const GLASS: RGB = [0.8, 0.78, 0.7];

/** How far every wall reaches under the ground (handrails). */
const BURY = 2;
/** A cell of the grid, and the largest tiles' level: 4 handrails a cell, 64 cells a root tile. */
const CELL = 4;
const ROOT = 6;
const FINEST = 2;
/** Tiles larger than this many handrails show the far form; larger than `NEAR`, single steps; smaller, everything. */
const FAR = 100;
const NEAR = 20;
/** Lamps: their post's height and radius, the lantern's half size (handrails). */
const LAMP = 2.2;
const POST = 0.06;
const LANTERN = 0.14;

/** The detail of a tile of this level. */
export function stairDetailOf(level: number): Exclude<StairDetail, 'solid'> {
  const edge = Math.pow(2, level) * CELL;
  return edge > FAR ? 'far' : edge > NEAR ? 'mid' : 'near';
}

/** The ramp's cells: across it (u, from its spinward-negative edge) and up it along the profile (v, from the forecourt). */
export interface StairGrid extends Grid {
  /** The profile point of row 0, and the ramp's half width (m). */
  sBase: number;
  half: number;
}

/** A habitat's stair grid, or null without a stair (made once). */
export const stairGridOf: (h: Habitat) => StairGrid | null = kept((h: Habitat) => {
  const st = liftStairOf(h);
  if (!st) return null;
  const ramp = rampOf(h), c = CELL * st.handrail, half = ramp.halfWidth;
  const sBase = ramp.sOf(st.platforms[0].z0), sTop = ramp.sOf(st.platforms[st.platforms.length - 1].z1);
  return { nU: Math.ceil((2 * half) / c), nV: Math.ceil((sTop - sBase) / c) + 1, wrap: false, edgeU: c, edgeV: c, root: ROOT, finest: FINEST, sBase, half };
});

/** The cell (u, v) of a plan point (may lie outside the grid). */
function cellOf(ramp: Ramp, g: StairGrid, p: PlanPoint): [number, number] {
  return [(p[1] + g.half) / g.edgeU, (ramp.sOf(p[0]) - g.sBase) / g.edgeV];
}

/** Whether a tile owns a cell: the one tile of its level the cell lies in (cells off the grid go to its edge tiles). */
function owns(g: StairGrid, k: TileKey, [u, v]: [number, number]): boolean {
  const size = Math.pow(2, k.level);
  const cu = Math.min(g.nU - 1e-9, Math.max(0, u)), cv = Math.min(g.nV - 1e-9, Math.max(0, v));
  return cu >= k.i && cu < k.i + size && cv >= k.j && cv < k.j + size;
}

/** A box in plan holding every point a tile owns (z along, w across). */
function boxOf(ramp: Ramp, g: StairGrid, k: TileKey): [number, number, number, number] {
  const size = Math.pow(2, k.level), j0 = k.j === 0 ? -1e9 : k.j, j1 = k.j + size >= g.nV ? 1e9 : k.j + size;
  const i0 = k.i === 0 ? -1e9 : k.i, i1 = k.i + size >= g.nU ? 1e9 : k.i + size;
  const z = (j: number): number => (Math.abs(j) > 1e8 ? Math.sign(j) * 1e12 : ramp.zOf(g.sBase + j * g.edgeV));
  return [z(j0), z(j1), i0 * g.edgeU - g.half, i1 * g.edgeU - g.half];
}

/** The root tiles: the whole stair at its far detail. */
export function stairRoots(g: StairGrid): TileKey[] {
  const size = Math.pow(2, g.root), out: TileKey[] = [];
  for (let j = 0; j < g.nV; j += size) for (let i = 0; i < g.nU; i += size) out.push({ level: g.root, i, j });
  return out;
}

/**
 * The tiles wanted around an eye (world, m): the quadtree of `wantedCells` over the ramp, its distance measured over
 * the face (the profile's arc) and out from it. Coarsest first, nearest first.
 */
export function stairTilesFor(h: Habitat, eye: Vec3): WantedTile[] {
  const g = stairGridOf(h), st = liftStairOf(h);
  if (!g || !st) return [];
  const ramp = rampOf(h), at = fromWorld(h.profile, eye[0], eye[1], eye[2]);
  const middle = ramp.middleAt(ramp.zOf(at.s)), r = Math.max(h.profile.at(at.s).r, 1);
  const d = at.theta - middle, w = Math.atan2(Math.sin(d), Math.cos(d)) * r;
  const e: GridEye = { u: (w + g.half) / g.edgeU, v: (at.s - g.sBase) / g.edgeV, h: Math.max(0, at.h - st.clearance - st.handrail) };
  return wantedCells(g, e);
}

/** How many of the stair's parts a tile holds. */
export interface StairParts {
  platforms: number;
  aprons: number;
  steps: number;
}

/** A built tile: its key, its frame, the mesh (BUILT: mapped, with finishes), and what it holds. */
export interface StairTile {
  key: TileKey;
  origin: Place;
  mesh: MappedArrays;
  parts: StairParts;
}

export const stairTileBytes = (t: StairTile): number => bytesOf([t.mesh.positions, t.mesh.normals, t.mesh.uvs, t.mesh.finishes, t.mesh.index, ...(t.mesh.colors ? [t.mesh.colors] : [])]);

/** The tile of a habitat's stair at a key. */
export function buildStairTile(h: Habitat, key: TileKey): StairTile {
  const st = liftStairOf(h), g = stairGridOf(h);
  if (!st || !g) throw new Error('buildStairTile: this habitat has no Lift Stair');
  const ramp = rampOf(h), size = Math.pow(2, key.level);
  const w = (key.i + size / 2) * g.edgeU - g.half, s = Math.min(h.profile.length, g.sBase + (key.j + size / 2) * g.edgeV);
  const z = ramp.zOf(s), origin = placeAt(h, ramp.middleAt(z) + w / Math.max(ramp.radiusAt(z), 1), s, 0);
  const b = new StairBuilder(st, ramp, (p) => intoPlace(origin, p), stairDetailOf(key.level));
  b.lay((p) => owns(g, key, cellOf(ramp, g, p)), boxOf(ramp, g, key));
  return { key, origin, mesh: b.shape.mappedArrays(), parts: b.parts };
}

/** What a tile of a habitat's stair holds, without building it. */
export function stairPartsIn(h: Habitat, key: TileKey): StairParts {
  const st = liftStairOf(h), g = stairGridOf(h);
  if (!st || !g) return { platforms: 0, aprons: 0, steps: 0 };
  const ramp = rampOf(h), b = new StairBuilder(st, ramp, (p) => p, 'count');
  b.lay((p) => owns(g, key, cellOf(ramp, g, p)), boxOf(ramp, g, key));
  return b.parts;
}

/**
 * The parts of a habitat's stair one stands on or bumps into near a point (world, m), within `reach` of it, relative
 * to it: treads and risers, aprons, platforms and their parapets. Null where none are near.
 */
export function buildStairSolid(h: Habitat, origin: Vec3, reach: number): { positions: Float32Array; index: Uint32Array } | null {
  const st = liftStairOf(h);
  if (!st) return null;
  const ramp = rampOf(h);
  const near = (p: PlanPoint): boolean => {
    const q = ramp.world(p[0], p[1], ramp.groundAt(p[0]));
    return Math.hypot(q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]) < reach;
  };
  const b = new StairBuilder(st, ramp, (p) => v3sub(p, origin), 'solid');
  b.lay(near);
  if (!b.shape.idx.length) return null;
  const a = b.shape.arrays();
  return { positions: a.positions, index: a.index };
}

/** Builds the parts a tile owns at one detail, in plan (z along, w across, e up), into a frame. */
class StairBuilder {
  readonly shape = new Shape(8, true, true);
  private readonly hr: number;
  private readonly bury: number;

  constructor(private readonly st: LiftStair, private readonly ramp: Ramp, private readonly local: (world: Vec3) => Vec3, private readonly detail: StairDetail) {
    this.hr = st.handrail;
    this.bury = BURY * st.handrail;
  }

  /** The parts built: platforms, aprons, steps. */
  readonly parts: StairParts = { platforms: 0, aprons: 0, steps: 0 };

  /**
   * Build the parts whose middles `mine` takes; `box` (z0, z1, w0, w1 in plan), when given, holds every such middle, so
   * legs and platforms wholly outside it are passed over.
   */
  lay(mine: (p: PlanPoint) => boolean, box?: [number, number, number, number]): void {
    const st = this.st, pad = st.width;
    const away = (z0: number, z1: number, w0: number, w1: number): boolean => !!box && (z1 + pad < box[0] || z0 - pad > box[1] || w1 + pad < box[2] || w0 - pad > box[3]);
    const count = this.detail === 'count';
    for (const q of st.platforms) if (!away(q.z0, q.z1, q.w0, q.w1) && mine([(q.z0 + q.z1) / 2, (q.w0 + q.w1) / 2])) { if (!count) this.platform(q); this.parts.platforms++; }
    for (const s of legShapesOf(st)) {
      const l = s.leg;
      if (away(Math.min(l.from.z, l.to.z), Math.max(l.from.z, l.to.z), Math.min(l.from.w, l.to.w), Math.max(l.from.w, l.to.w))) continue;
      for (const ap of s.aprons) {
        const c = ap.corners, mid: PlanPoint = [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3];
        if (mine(mid)) { if (!count) this.apron(s, ap); this.parts.aprons++; }
      }
      // Runs of consecutive steps this tile owns.
      let first = -1;
      for (let k = 0; k <= s.steps.length; k++) {
        const own = k < s.steps.length && mine(onLeg(s, (s.steps[k].a0 + s.steps[k].a1) / 2, 0));
        if (own && first < 0) first = k;
        if (!own && first >= 0) { if (!count) this.run(s, first, k - 1); this.parts.steps += k - first; first = -1; }
      }
    }
  }

  /** A plan point in the tile's frame. */
  private toFrame(z: number, w: number, e: number): Vec3 {
    return this.local(this.ramp.world(z, w, e));
  }

  /** Where the ground is under a plan point, less how far walls go into it. */
  private foot(p: PlanPoint): number {
    return this.ramp.groundAt(p[0]) - this.bury;
  }

  /** A quad from plan corners (z, w, e), counter-clockwise seen from outside; its normal from its corners. */
  private face(a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: RGB, finish: number): void {
    const A = this.toFrame(...a), B = this.toFrame(...b), C = this.toFrame(...c), D = this.toFrame(...d);
    const n = v3norm(v3cross(v3sub(C, A), v3sub(D, B)));
    this.shape.finish = finish;
    this.shape.quad(A, B, C, D, n, col);
  }

  /**
   * A wall along the plan edge p → q (the solid on its left, seen from above), from `bottom` to `top` at each end. Its
   * face looks to the right of p → q.
   */
  private wall(p: PlanPoint, q: PlanPoint, bottom: [number, number], top: [number, number], col: RGB = STONE): void {
    this.face([p[0], p[1], bottom[0]], [q[0], q[1], bottom[1]], [q[0], q[1], top[1]], [p[0], p[1], top[0]], col, FINISH.stone);
  }

  /** A level or sloping top over a plan polygon of 3 or 4 corners, counter-clockwise from above, at heights `e`. */
  private top(corners: readonly PlanPoint[], e: readonly number[], col: RGB = PAVING): void {
    const c = corners.map((p, i): Vec3 => [p[0], p[1], e[i]]);
    if (c.length === 4) this.face(c[0], c[1], c[2], c[3], col, FINISH.stone);
    else this.face(c[0], c[1], c[2], c[2], col, FINISH.stone);
  }

  /** A block on a plan polygon (counter-clockwise from above) from `bottom` to `top` at each corner: its top and walls. */
  private block(corners: readonly PlanPoint[], bottom: readonly number[], top: readonly number[], col: RGB = STONE, walls = corners.map(() => true)): void {
    this.top(corners, top, col);
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      if (walls[i]) this.wall(corners[i], corners[j], [bottom[i], bottom[j]], [top[i], top[j]], STONE);
    }
  }

  /** A lamp standing at a plan point on a floor at height e: a bronze post and a lantern of glass in a bronze cap. */
  private lamp(p: PlanPoint, e: number): void {
    if (this.detail !== 'mid' && this.detail !== 'near') return;
    const hr = this.hr, base = this.toFrame(p[0], p[1], e);
    const up = v3norm(v3sub(this.toFrame(p[0], p[1], e + 1), base)), ax = v3norm(v3sub(this.toFrame(p[0] + 1, p[1], e), base));
    const ay = v3cross(up, ax);
    this.shape.finish = FINISH.bronze;
    this.shape.prism(base, ax, ay, up, POST * hr, LAMP * hr, this.detail === 'near' ? 8 : 4, BRONZE);
    const top = (k: number): Vec3 => [base[0] + up[0] * k * hr, base[1] + up[1] * k * hr, base[2] + up[2] * k * hr];
    this.shape.finish = FINISH.ceramic;
    this.shape.block(top(LAMP + LANTERN), ax, ay, up, [LANTERN * hr, LANTERN * hr, LANTERN * hr], GLASS);
    this.shape.finish = FINISH.bronze;
    this.shape.block(top(LAMP + 2 * LANTERN + 0.03), ax, ay, up, [LANTERN * hr * 1.3, LANTERN * hr * 1.3, 0.03 * hr], BRONZE);
  }

  /** A platform: its floor and the walls under it down into the slope, its parapets where no leg meets it, lamps. */
  private platform(q: StairPlatform): void {
    const ground = (z: number): number => this.ramp.groundAt(z) - this.bury;
    const corners: PlanPoint[] = [[q.z0, q.w0], [q.z1, q.w0], [q.z1, q.w1], [q.z0, q.w1]];
    this.block(corners, corners.map((c) => ground(c[0])), corners.map(() => q.e), PAVING);
    const p = this.st.parapet, hr = this.hr;
    // The parapets along each edge, less the openings where legs meet it.
    const open = this.openings(q);
    const edges: { from: PlanPoint; to: PlanPoint; inward: PlanPoint; key: 'z0' | 'z1' | 'w0' | 'w1' }[] = [
      { from: [q.z0, q.w1], to: [q.z0, q.w0], inward: [1, 0], key: 'z0' },
      { from: [q.z1, q.w0], to: [q.z1, q.w1], inward: [-1, 0], key: 'z1' },
      { from: [q.z0 + p, q.w0], to: [q.z1 - p, q.w0], inward: [0, 1], key: 'w0' },
      { from: [q.z1 - p, q.w1], to: [q.z0 + p, q.w1], inward: [0, -1], key: 'w1' },
    ];
    for (const ed of edges) {
      const alongZ = ed.key === 'w0' || ed.key === 'w1', k = alongZ ? 0 : 1;
      const lo = Math.min(ed.from[k], ed.to[k]), hi = Math.max(ed.from[k], ed.to[k]);
      for (const [a, b] of cut([lo, hi], open[ed.key])) {
        if (b - a < p) continue;
        const edgePoint = (x: number, inset: number): PlanPoint => (alongZ ? [x, ed.from[1] + ed.inward[1] * inset] : [ed.from[0] + ed.inward[0] * inset, x]);
        // Counter-clockwise from above: outer edge one way, inner edge back.
        const outer = [edgePoint(a, 0), edgePoint(b, 0)], inner = [edgePoint(b, p), edgePoint(a, p)];
        let poly: PlanPoint[] = [outer[0], outer[1], inner[0], inner[1]];
        if (area(poly) < 0) poly = poly.reverse();
        this.parapet(poly, q.e, q.e + hr);
      }
    }
    // Lamps at the corners of its downhill edge, and its uphill edge on the larger ones.
    const inset = p + hr * 0.4;
    for (const z of [q.z0 + inset, ...(q.z1 - q.z0 > this.st.width * 1.5 ? [q.z1 - inset] : [])]) for (const w of [q.w0 + inset, q.w1 - inset]) this.lamp([z, w], q.e);
  }

  /** A parapet block on a plan polygon (counter-clockwise from above), from a floor at `e` to `top`, and its coping. */
  private parapet(poly: readonly PlanPoint[], e: number | readonly number[], top: number | readonly number[]): void {
    const bottoms = typeof e === 'number' ? poly.map(() => e) : e, tops = typeof top === 'number' ? poly.map(() => top) : top;
    this.block(poly, bottoms, tops, STONE);
    if (this.detail === 'near') this.coping(poly, tops);
  }

  /** A coping stone over a parapet's top: a little wider than it, and a little higher. */
  private coping(poly: readonly PlanPoint[], tops: readonly number[]): void {
    const hr = this.hr, grow = hr * 0.04, rise = hr * 0.08;
    // Each corner out along both its edges' normals.
    const out = poly.map((p, i): PlanPoint => {
      const n1 = outward(poly[(i + poly.length - 1) % poly.length], p), n2 = outward(p, poly[(i + 1) % poly.length]);
      return [p[0] + (n1[0] + n2[0]) * grow, p[1] + (n1[1] + n2[1]) * grow];
    });
    this.block(out, tops.map((t) => t - rise * 0.5), tops.map((t) => t + rise), STONE);
  }

  /** Where legs meet a platform's edges: intervals along each edge (z along a side, w along an end) left open. */
  private openings(q: StairPlatform): Record<'z0' | 'z1' | 'w0' | 'w1', [number, number][]> {
    const out: Record<'z0' | 'z1' | 'w0' | 'w1', [number, number][]> = { z0: [], z1: [], w0: [], w1: [] };
    const eps = 1e-6;
    for (const s of legShapesOf(this.st)) {
      const half = s.leg.width / 2;
      for (const [end, a] of [[s.leg.from, 0], [s.leg.to, s.run]] as const) {
        const onIt = end.alongZ ? Math.abs(end.w - q.w0) < eps || Math.abs(end.w - q.w1) < eps : Math.abs(end.z - q.z0) < eps || Math.abs(end.z - q.z1) < eps;
        if (!onIt || end.z < q.z0 - eps || end.z > q.z1 + eps || end.w < q.w0 - eps || end.w > q.w1 + eps) continue;
        // Where the leg's two sides cross the face, on the coordinate along it.
        const k = end.alongZ ? 1 : 0, key = end.alongZ ? (Math.abs(end.w - q.w0) < eps ? 'w0' : 'w1') : Math.abs(end.z - q.z0) < eps ? 'z0' : 'z1';
        const xs = [-1, 1].map((sd) => {
          const c = Math.abs(s.dir[k]) > 1e-9 ? a - (s.left[k] * sd * half) / s.dir[k] : a;
          return onLeg(s, c, sd * half)[1 - k];
        });
        out[key].push([Math.min(...xs), Math.max(...xs)]);
      }
    }
    return out;
  }

  /** An apron: its level triangle, and the wall and parapet along its long edge. */
  private apron(s: LegShape, ap: { corners: [PlanPoint, PlanPoint, PlanPoint]; e: number; side: number; a0: number; a1: number }): void {
    let tri: PlanPoint[] = [...ap.corners];
    if (area(tri) < 0) tri = tri.reverse();
    this.top(tri, [ap.e, ap.e, ap.e]);
    this.side(s, ap.side, ap.a0, ap.a1, () => ap.e, ap.e + this.hr, ap.e + this.hr);
  }

  /**
   * One side of a leg from `a0` to `a1` along it: the outer wall from the ground to the parapet's top, the parapet's top
   * and its inner face down to the floor (`floor` along it), and at `near`, its coping and handrail.
   */
  private side(s: LegShape, sd: number, a0: number, a1: number, floor: (a: number) => number, top0: number, top1: number): void {
    const half = s.leg.width / 2, p = this.st.parapet, hr = this.hr;
    const o0 = onLeg(s, a0, sd * half), o1 = onLeg(s, a1, sd * half), i0 = onLeg(s, a0, sd * (half - p)), i1 = onLeg(s, a1, sd * (half - p));
    // Counter-clockwise from above: on the left side (+) the outer edge runs back, on the right it runs forward.
    const poly: PlanPoint[] = sd > 0 ? [i0, i1, o1, o0] : [o0, o1, i1, i0];
    const bottom = sd > 0 ? [floor(a0), floor(a1), this.foot(o1), this.foot(o0)] : [this.foot(o0), this.foot(o1), floor(a1), floor(a0)];
    const top = [top0, top1, top1, top0];
    // Its inner and outer faces; its ends run on into the next piece.
    this.block(poly, bottom, top, STONE, [true, false, true, false]);
    if (this.detail !== 'near') return;
    this.coping(poly, top);
    // The handrail: a bronze bar against the parapet's inner face, a little under its top.
    const t = hr * 0.035, drop = hr * 0.12;
    const r0 = onLeg(s, a0, sd * (half - p)), r1 = onLeg(s, a1, sd * (half - p)), q0 = onLeg(s, a0, sd * (half - p - 2 * t)), q1 = onLeg(s, a1, sd * (half - p - 2 * t));
    const bar: PlanPoint[] = sd > 0 ? [q0, q1, r1, r0] : [r0, r1, q1, q0];
    this.solidBlock(bar, top.map((e) => e - drop - t), top.map((e) => e - drop + t), BRONZE, FINISH.bronze);
  }

  /** A closed block of four plan corners (counter-clockwise from above), bottom and all: a bar, a nosing. */
  private solidBlock(corners: readonly PlanPoint[], bottom: readonly number[], top: readonly number[], col: RGB, finish: number): void {
    const c = (i: number, e: readonly number[]): Vec3 => [corners[i][0], corners[i][1], e[i]];
    this.face(c(0, top), c(1, top), c(2, top), c(3, top), col, finish);
    this.face(c(0, bottom), c(3, bottom), c(2, bottom), c(1, bottom), col, finish);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.face(c(i, bottom), c(j, bottom), c(j, top), c(i, top), col, finish);
    }
  }

  /** A run of a leg's steps, `first` to `last`: as a slab far off, else step by step. */
  private run(s: LegShape, first: number, last: number): void {
    const steps = s.steps, half = s.leg.width / 2, p = this.st.parapet, hr = this.hr, r = s.leg.riser;
    const A0 = steps[first].a0, A1 = steps[last].a1;
    // The parapets: their tops a handrail over the nosing line, broken where it breaks.
    const cuts = [A0, ...s.line.map((b) => b[0]).filter((a) => a > A0 + 1e-6 && a < A1 - 1e-6), A1];
    if (this.detail !== 'far') {
      // Step by step: in `near` the parapets per step (their copings and handrails follow each one).
      for (const sd of [-1, 1]) {
        if (this.detail === 'near') {
          for (let k = first; k <= last; k++) this.side(s, sd, steps[k].a0, steps[k].a1, () => steps[k].top, lineAt(s, steps[k].a0) + hr, lineAt(s, steps[k].a1) + hr);
        } else {
          for (let c = 0; c + 1 < cuts.length; c++) {
            const a0 = cuts[c], a1 = cuts[c + 1];
            // The inner face reaches down under the treads (the nosing line less a riser lies below every one).
            this.side(s, sd, a0, a1, (a) => lineAt(s, a) - r, lineAt(s, a0) + hr, lineAt(s, a1) + hr);
          }
        }
      }
      for (let k = first; k <= last; k++) {
        const st = steps[k], in0 = onLeg(s, st.a0, -(half - p)), in1 = onLeg(s, st.a0, half - p), out1 = onLeg(s, st.a1, half - p), out0 = onLeg(s, st.a1, -(half - p));
        // The tread, and the riser below its front edge (reaching down behind the step before, so no gap shows).
        this.top([in0, out0, out1, in1], [st.top, st.top, st.top, st.top]);
        this.wall(in1, in0, [st.top - 2 * r, st.top - 2 * r], [st.top, st.top], PAVING);
        if (this.detail === 'near') this.nosing(s, st.a0, st.top);
        if (st.landing) for (const sd of [-1, 1]) this.lamp(onLeg(s, (st.a0 + st.a1) / 2 + s.leg.tread / 2, sd * (half - p - hr * 0.3)), st.top);
      }
    } else {
      // Far: a slab under the nosing line between the parapets, with them as walls.
      for (const sd of [-1, 1]) for (let c = 0; c + 1 < cuts.length; c++) this.side(s, sd, cuts[c], cuts[c + 1], (a) => lineAt(s, a), lineAt(s, cuts[c]) + hr, lineAt(s, cuts[c + 1]) + hr);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const a0 = cuts[c], a1 = cuts[c + 1], e0 = lineAt(s, a0), e1 = lineAt(s, a1);
        this.top([onLeg(s, a0, -(half - p)), onLeg(s, a1, -(half - p)), onLeg(s, a1, half - p), onLeg(s, a0, half - p)], [e0, e1, e1, e0]);
      }
    }
    // Where the run ends inside the leg, a wall across it under the nosing line (the neighbour's steps stand before it).
    const lastStep = steps.length - 1;
    for (const [a, ahead] of [[A0, false], [A1, true]] as const) {
      if ((!ahead && first === 0) || (ahead && last === lastStep)) continue;
      // Up to under its own first riser (which reaches down to two risers under its tread), or its last tread.
      const own = this.detail === 'far' ? lineAt(s, a) + r : ahead ? steps[last].top : steps[first].top - 2 * r;
      const l = onLeg(s, a, -(half - p)), rr = onLeg(s, a, half - p), e = own;
      if (ahead) this.wall(l, rr, [this.foot(l), this.foot(rr)], [e, e]);
      else this.wall(rr, l, [this.foot(rr), this.foot(l)], [e, e]);
    }
  }

  /** A bronze nosing along a step's front edge: a strip just proud of the tread and the riser. */
  private nosing(s: LegShape, a: number, top: number): void {
    const half = s.leg.width / 2 - this.st.parapet, hr = this.hr, d = hr * 0.04, up = hr * 0.008, fwd = hr * 0.008;
    const p0 = onLeg(s, a - fwd, -half), p1 = onLeg(s, a - fwd, half), q1 = onLeg(s, a + d, half), q0 = onLeg(s, a + d, -half);
    const below = [top - d, top - d, top - d, top - d], above = [top + up, top + up, top + up, top + up];
    this.solidBlock(area([p0, q0, q1, p1]) > 0 ? [p0, q0, q1, p1] : [p1, q1, q0, p0], below, above, BRONZE, FINISH.bronze);
  }
}

/** The outward normal of a counter-clockwise polygon's edge a → b (to its right). */
function outward(a: PlanPoint, b: PlanPoint): PlanPoint {
  const dz = b[0] - a[0], dw = b[1] - a[1], l = Math.hypot(dz, dw) || 1;
  return [dw / l, -dz / l];
}

/** Twice a plan polygon's signed area: positive counter-clockwise (z right, w up). */
function area(poly: readonly PlanPoint[]): number {
  let n = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; n += a[0] * b[1] - b[0] * a[1]; }
  return n;
}

/** An interval less some others: the pieces left. */
function cut([lo, hi]: [number, number], holes: readonly [number, number][]): [number, number][] {
  let parts: [number, number][] = [[lo, hi]];
  for (const [a, b] of holes) parts = parts.flatMap(([x, y]): [number, number][] => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as [number, number]] : []), ...(b < y ? [[b, y] as [number, number]] : [])]));
  return parts;
}
