/**
 * The plan's paths made into ground (gen/plan.ts has them as lines): the Sunwalk, the ways between the entrances and
 * the trail up the Mountain, each as a run of straight pieces filed in a grid over the unrolled floor, so any point
 * finds the path beside it in one cell. The terrain levels the ground across them (`gradePath`), the ecology lays their
 * surface (`pathCover`, by the district each piece runs through), scatter keeps plants off them.
 *
 * Each path has an author: the Sunwalk is the habitat mind's own, pale dressed stone the whole way; a way is laid by
 * the district it crosses, in that district's material (`STYLE_LAND[style].way`), so its surface changes at a border;
 * the trail is the Mountain's, beaten earth over rock. Pure.
 */
import { smoothstep } from '@futuremagic/core';
import { STYLE_LAND, type DistrictStyle, type FloorLayer, type Habitat } from '../blueprint';
import { kept } from './kept';
import { planOf, type PathKind } from './plan';

const TURN = 2 * Math.PI;

/** How the ground meets a path: its shoulders at most this steep, at least `share` of its width, at most `most`. */
export const SHOULDER = { slope: (30 * Math.PI) / 180, share: 0.5, most: 3 };
/** How much higher a path's middle is than its edges, as a share of its half width (so rain runs off). */
export const CROWN = 0.025;
/** How far apart, in path widths, the level of a path is taken along it (it follows the land's swells, not its tufts). */
export const LEVEL_STEP = 6;

export interface PathHit {
  kind: PathKind;
  /** The path's width (m). */
  width: number;
  /** How far the point lies from the path's middle line (m, ≥ 0). */
  distance: number;
  /** The nearest point of the middle line. */
  theta: number;
  s: number;
  /** The surface laid there: by the district the piece runs through (a way), or the path's own. */
  layer: FloorLayer;
  /** The style of the district the piece runs through, or null (the Sunwalk, the trail, the reserve). */
  style: DistrictStyle | null;
  /** Which straight piece of the paths it is, and how far along it the nearest point lies (0 … 1). */
  piece: number;
  along: number;
}

export interface PathNet {
  /** How many straight pieces the paths are made of. */
  readonly pieces: number;
  /**
   * The path nearest a point, measured to its edge, within `reach` m of that edge (default: the path's shoulders,
   * `SHOULDER.most` widths), or null.
   */
  pathAt(theta: number, s: number, reach?: number): PathHit | null;
  /** How long a piece is (m), and the point `t` (0 … 1) along it. */
  lengthOf(piece: number): number;
  pointOf(piece: number, t: number): { theta: number; s: number };
}

/** The surface of the paths that are not laid by a district. */
const OWN: Record<PathKind, FloorLayer> = { sunwalk: 'gravel', way: 'dirt', trail: 'dirt' };

function makePathNet(h: Habitat): PathNet {
  const plan = planOf(h), R = h.radius, circumference = TURN * R, { floorStart, floorEnd } = h.profile;
  // Pieces as flat arrays: start (u, s) unrolled, direction, length, width, kind, layer, style.
  const kinds: PathKind[] = [], layers: FloorLayer[] = [], styles: (DistrictStyle | null)[] = [];
  const u0: number[] = [], s0: number[] = [], du: number[] = [], ds: number[] = [], width: number[] = [];
  for (const path of plan.paths) {
    const p = path.points;
    for (let i = 2; i < p.length; i += 2) {
      const a = p[i - 2] * R, b = p[i] * R;
      if (b === a && p[i + 1] === p[i - 1]) continue;
      // The district at the piece's middle lays it (ways only).
      const district = path.kind === 'way' ? plan.districtAt((p[i - 2] + p[i]) / 2, (p[i - 1] + p[i + 1]) / 2) : null;
      kinds.push(path.kind);
      styles.push(district ? district.style : null);
      layers.push(district ? STYLE_LAND[district.style].way : OWN[path.kind]);
      u0.push(a); s0.push(p[i - 1]); du.push(b - a); ds.push(p[i + 1] - p[i - 1]); width.push(path.width);
    }
  }
  const n = kinds.length;
  // The grid: every piece filed in each cell within its reach (its shoulders), so a point finds every piece whose
  // shoulders it is on in its own cell. Cells about the widest reach across, lists as typed arrays.
  const reachOf = (k: number): number => width[k] * (0.5 + SHOULDER.most);
  let most = 1, least = Infinity;
  for (let k = 0; k < n; k++) { most = Math.max(most, reachOf(k)); least = Math.min(least, width[k] * SHOULDER.most); }
  const cell = most * 2, columns = Math.max(1, Math.floor(circumference / cell)), size = circumference / columns;
  const corner = Math.sqrt(size * size + cell * cell) / 2;
  const cellKey = (column: number, row: number): number => row * columns + (((column % columns) + columns) % columns);
  const lengthSq = new Float64Array(n), middle = new Float64Array(n);
  for (let k = 0; k < n; k++) { lengthSq[k] = du[k] * du[k] + ds[k] * ds[k]; middle[k] = u0[k] + du[k] / 2; }
  /** How far along piece k (0 … 1) the point nearest (u, s) lies. */
  const along = (k: number, u: number, s: number): number =>
    lengthSq[k] > 0 ? Math.min(1, Math.max(0, ((u - u0[k]) * du[k] + (s - s0[k]) * ds[k]) / lengthSq[k])) : 0;
  const lists = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const r = reachOf(k);
    const c0 = Math.floor((Math.min(u0[k], u0[k] + du[k]) - r) / size), c1 = Math.floor((Math.max(u0[k], u0[k] + du[k]) + r) / size);
    const r0 = Math.floor((Math.min(s0[k], s0[k] + ds[k]) - r) / cell), r1 = Math.floor((Math.max(s0[k], s0[k] + ds[k]) + r) / cell);
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= Math.min(c1, c0 + columns - 1); column++) {
      // Only cells the reach really touches (a long diagonal piece passes most of its box by).
      const cu = (column + 0.5) * size, cs = (row + 0.5) * cell, t = along(k, cu, cs);
      const gu = cu - u0[k] - du[k] * t, gs = cs - s0[k] - ds[k] * t;
      if (gu * gu + gs * gs > (r + corner) ** 2) continue;
      const key = cellKey(column, row), list = lists.get(key);
      if (list) list.push(k); else lists.set(key, [k]);
    }
  }
  // Which cells hold any piece, a bit each: most points are on no path, and this says so before any lookup.
  const rows = Math.ceil(h.profile.length / cell) + 1, used = new Uint32Array(Math.ceil((rows * columns) / 32));
  const filed = new Map<number, Int32Array>();
  for (const [key, list] of lists) {
    filed.set(key, Int32Array.from(list));
    if (key >= 0 && key < rows * columns) used[key >>> 5] |= 1 << (key & 31);
  }
  const cells = rows * columns, perSize = 1 / size, perCell = 1 / cell;
  const pathAt = (theta: number, s: number, reach?: number): PathHit | null => {
    if (!n) return null;
    const u = (theta - TURN * Math.floor(theta / TURN)) * R;
    if (reach === undefined) {
      // The usual question (the ground's height): one cell, and most cells hold no path at all.
      const key = Math.floor(s * perCell) * columns + Math.min(columns - 1, Math.floor(u * perSize));
      if (key >= 0 && key < cells && !(used[key >>> 5] & (1 << (key & 31)))) return null;
    }
    // Within a piece's shoulders one cell holds it; a wider reach looks in the cells around too, as far as it passes
    // the narrowest shoulders (a piece may then be met twice, which changes nothing).
    const extra = reach === undefined ? 0 : Math.max(0, reach - least);
    const c0 = Math.floor((u - extra) / size), c1 = Math.floor((u + extra) / size);
    const r0 = Math.floor((s - extra) / cell), r1 = Math.floor((s + extra) / cell);
    // Around the axis an angle is shorter up the endcaps, where the ground is nearer the axis.
    const narrow = s < floorStart || s > floorEnd ? h.profile.at(s).r / R : 1;
    let best = -1, bestRank = Infinity, bestEdge = Infinity, bestT = 0, bestShift = 0;
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) {
      const key = cellKey(column, row);
      if (key >= 0 && key < cells && !(used[key >>> 5] & (1 << (key & 31)))) continue;
      const list = filed.get(key);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        // The point's u nearest the piece (the floor wraps around the axis).
        const shift = circumference * Math.round((middle[k] - u) / circumference), pu = u + shift;
        const t = along(k, pu, s), gu = (pu - u0[k] - du[k] * t) * narrow, gs = s - s0[k] - ds[k] * t;
        const half = width[k] / 2, edge = Math.sqrt(gu * gu + gs * gs) - half;
        // Where paths overlap (a way joining the Sunwalk), the wider one is the ground.
        const rank = edge < 0 ? edge - width[k] : edge;
        if (rank < bestRank && edge < (reach ?? width[k] * SHOULDER.most)) { best = k; bestRank = rank; bestEdge = edge; bestT = t; bestShift = shift; }
      }
    }
    if (best < 0) return null;
    return {
      kind: kinds[best], width: width[best], distance: bestEdge + width[best] / 2,
      theta: (u0[best] + du[best] * bestT - bestShift) / R, s: s0[best] + ds[best] * bestT, layer: layers[best], style: styles[best],
      piece: best, along: bestT,
    };
  };
  const lengthOf = (k: number): number => Math.sqrt(lengthSq[k]);
  const pointOf = (k: number, t: number): { theta: number; s: number } => ({ theta: (u0[k] + du[k] * t) / R, s: s0[k] + ds[k] * t });
  return { pieces: n, pathAt, lengthOf, pointOf };
}

/** The habitat's paths, made into a grid once and kept. */
export const pathsOf: (h: Habitat) => PathNet = kept(makePathNet);

/**
 * The ground at a point beside a path: level across the path at `level` (the land at its middle line), crowned a little,
 * then the shoulders down or up to the land (`ground`) no steeper than `SHOULDER.slope` where there is room.
 */
export function gradePath(ground: number, level: number, hit: PathHit): number {
  const half = hit.width / 2, d = hit.distance;
  if (d <= half) return level + CROWN * half * (1 - (d / half) ** 2);
  const up = ground - level;
  const shoulder = Math.min(hit.width * SHOULDER.most, Math.max(hit.width * SHOULDER.share, Math.abs(up) / Math.tan(SHOULDER.slope)));
  const t = (d - half) / shoulder;
  return t >= 1 ? ground : level + up * smoothstep(0, 1, t);
}

/**
 * How much of a patch `cell` m across, centred `distance` m from a path's middle line, the path covers (0 … 1): its
 * width over the patch, so from afar a path a few metres wide is a faint line of the right colour, never a dotted one.
 */
export function pathCover(hit: PathHit, cell: number): number {
  const half = Math.max(cell / 2, 0.1), w = hit.width / 2, d = hit.distance;
  return Math.min(1, Math.max(0, (Math.min(d + half, w) - Math.max(d - half, -w)) / (2 * half)));
}

/**
 * The point of the nearest path of a kind to (θ, s), and the way along it there (a unit step in θ·R and s), or null:
 * the debug menu's Go entries. Walks every point of those paths, so not for the frame loop.
 */
export function nearestOnPath(h: Habitat, kind: PathKind, theta: number, s: number): { theta: number; s: number; way: [number, number] } | null {
  const R = h.radius;
  let best: { theta: number; s: number; way: [number, number] } | null = null, gap = Infinity;
  for (const path of planOf(h).paths) {
    if (path.kind !== kind) continue;
    const p = path.points;
    for (let i = 2; i < p.length; i += 2) {
      const a = p[i] - theta, u = (a - TURN * Math.round(a / TURN)) * R, v = p[i + 1] - s, d = u * u + v * v;
      if (d >= gap) continue;
      const du = (p[i] - p[i - 2]) * R, ds = p[i + 1] - p[i - 1], l = Math.sqrt(du * du + ds * ds) || 1;
      gap = d;
      best = { theta: p[i], s: p[i + 1], way: [du / l, ds / l] };
    }
  }
  return best;
}
