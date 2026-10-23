/**
 * The paths as a net people walk (design "Who is out on the land"): the plan's Sunwalk, ways and trail
 * (gen/plan.ts) joined where they meet. The ways are the shortest net from every entrance to the Sunwalk and the trail
 * leaves from the Sunwalk's start, so the whole net is a tree: between two of its points there is one way, found by
 * climbing from both toward the root until they meet. Routes come out as polylines over the floor, θ unwrapped so a
 * route never jumps a turn. Pure, made once per habitat.
 */
import { kept } from '../gen/kept';
import { planOf } from '../gen/plan';
import type { Habitat } from '../blueprint';

const TURN = 2 * Math.PI;

/** How far apart two points of the floor are (m), over the floor unrolled (the short way round the axis). */
export function floorGap(R: number, theta0: number, s0: number, theta1: number, s1: number): number {
  const d = theta1 - theta0;
  return Math.hypot((d - TURN * Math.round(d / TURN)) * R, s1 - s0);
}

/** The Sunwalk's points (θ, s, …, one per step along the axis), or null in a plan without one. */
export const sunwalkOf: (h: Habitat) => Float64Array | null = kept((h: Habitat) => planOf(h).paths.find((p) => p.kind === 'sunwalk')?.points ?? null);

/** Points of two paths closer than this (m) are one point of the net. */
const JOIN = 0.05;

export interface Route {
  /** θ, s, θ, s, … from start to end (θ unwrapped). */
  points: Float64Array;
  /** Distance walked to each point (m, over the floor unrolled). */
  along: Float64Array;
  /** The whole length (m). */
  length: number;
}

export interface WalkNet {
  /** How many points the net has. */
  readonly size: number;
  theta(v: number): number;
  s(v: number): number;
  /** The point of the net at a place, or -1 (an entrance is the end of its way). */
  vertexAt(theta: number, s: number): number;
  /** The point of the net nearest a place (over the floor unrolled). */
  vertexNear(theta: number, s: number): number;
  /** The way from one point of the net to another, along the paths. */
  between(a: number, b: number): Route;
}

function makeWalkNet(h: Habitat): WalkNet {
  const R = h.radius, circumference = TURN * R;
  const ts: number[] = [], ss: number[] = [], index = new Map<string, number>();
  const keyOf = (theta: number, s: number): string => {
    let u = (theta - TURN * Math.floor(theta / TURN)) * R;
    if (u > circumference - JOIN) u -= circumference;
    return `${Math.round(u / JOIN)}:${Math.round(s / JOIN)}`;
  };
  const vertex = (theta: number, s: number): number => {
    const key = keyOf(theta, s);
    let v = index.get(key);
    if (v === undefined) { v = ts.length; ts.push(theta - TURN * Math.floor(theta / TURN)); ss.push(s); index.set(key, v); }
    return v;
  };
  const links: number[][] = [];
  for (const path of planOf(h).paths) {
    const p = path.points;
    let last = -1;
    for (let i = 0; i < p.length; i += 2) {
      const v = vertex(p[i], p[i + 1]);
      while (links.length <= v) links.push([]);
      if (last >= 0 && last !== v) { links[last].push(v); links[v].push(last); }
      last = v;
    }
  }
  // The tree: parents toward the Sunwalk's start (the first point of the first path), found breadth first. A point
  // the search never reaches (no way joins it) is its own root, and routes from it go straight.
  const n = ts.length, parent = new Int32Array(n).fill(-1), depth = new Int32Array(n).fill(-1);
  for (let root = 0; root < n; root++) {
    if (depth[root] >= 0) continue;
    depth[root] = 0;
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      for (const w of links[v]) if (depth[w] < 0) { depth[w] = depth[v] + 1; parent[w] = v; queue.push(w); }
    }
  }
  const unrolled = (a: number, b: number): number => floorGap(R, ts[a], ss[a], ts[b], ss[b]);
  const between = (a: number, b: number): Route => {
    // Climb the deeper end until both are as deep, then both until they meet.
    const up: number[] = [], down: number[] = [];
    let x = a, y = b;
    while (x !== y && x >= 0 && y >= 0) {
      if (depth[x] >= depth[y]) { up.push(x); x = parent[x]; } else { down.push(y); y = parent[y]; }
    }
    const chain = x === y && x >= 0 ? [...up, x, ...down.reverse()] : [a, b];
    const points = new Float64Array(chain.length * 2), along = new Float64Array(chain.length);
    let theta = ts[chain[0]];
    points[0] = theta; points[1] = ss[chain[0]];
    for (let i = 1; i < chain.length; i++) {
      const d = ts[chain[i]] - ts[chain[i - 1]];
      theta += d - TURN * Math.round(d / TURN);
      points[i * 2] = theta; points[i * 2 + 1] = ss[chain[i]];
      along[i] = along[i - 1] + unrolled(chain[i - 1], chain[i]);
    }
    return { points, along, length: along[chain.length - 1] };
  };
  // Points filed in square cells over the floor unrolled, so the nearest is found by looking ring by ring.
  const cell = Math.max(1, h.params.plan.entranceSpacing / 2), columns = Math.max(1, Math.ceil(circumference / cell));
  const cells = new Map<number, number[]>();
  const columnOf = (theta: number): number => Math.min(columns - 1, Math.floor(((theta - TURN * Math.floor(theta / TURN)) * R) / cell));
  const rowOf = (s: number): number => Math.floor(s / cell);
  for (let v = 0; v < n; v++) {
    const key = rowOf(ss[v]) * columns + columnOf(ts[v]);
    const list = cells.get(key);
    if (list) list.push(v); else cells.set(key, [v]);
  }
  const rows = Math.ceil(h.profile.length / cell) + 1;
  const vertexNear = (theta: number, s: number): number => {
    const c0 = columnOf(theta), r0 = rowOf(s);
    let best = -1, gap = Infinity;
    for (let ring = 0; ring <= Math.max(rows, columns); ring++) {
      // Once a point is found, one more ring can still hold a nearer one (a cell's corner is farther than its side).
      if (best >= 0 && (ring - 1) * cell > Math.sqrt(gap)) break;
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const list = cells.get((r0 + dr) * columns + (((c0 + dc) % columns) + columns) % columns);
        if (!list) continue;
        for (const v of list) {
          const d = ts[v] - theta, u = (d - TURN * Math.round(d / TURN)) * R, w = ss[v] - s, g = u * u + w * w;
          if (g < gap) { gap = g; best = v; }
        }
      }
      if (2 * ring + 1 >= columns && ring > rows) break;
    }
    return Math.max(0, best);
  };
  return {
    size: n,
    theta: (v) => ts[v],
    s: (v) => ss[v],
    vertexAt: (theta, s) => index.get(keyOf(theta, s)) ?? -1,
    vertexNear,
    between,
  };
}

/** The habitat's walk net, made once and kept. */
export const walksOf: (h: Habitat) => WalkNet = kept(makeWalkNet);

/** Where a route is `d` m along it (clamped to its ends), and the way it heads there (radians over the floor: 0 toward
 * the port end, +π/2 spinward). */
export function pointAlong(route: Route, R: number, d: number): { theta: number; s: number; heading: number } {
  const { points: p, along } = route, last = along.length - 1;
  if (last <= 0) return { theta: p[0], s: p[1], heading: 0 };
  const x = Math.min(route.length, Math.max(0, d));
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (along[m] <= x) lo = m; else hi = m; }
  const span = along[hi] - along[lo], t = span > 0 ? (x - along[lo]) / span : 0;
  const t0 = p[lo * 2], s0 = p[lo * 2 + 1], t1 = p[hi * 2], s1 = p[hi * 2 + 1];
  return { theta: t0 + (t1 - t0) * t, s: s0 + (s1 - s0) * t, heading: Math.atan2((t1 - t0) * R, s1 - s0) };
}

/** A route through points (θ, s, …). */
export function routeThrough(h: Habitat, points: Float64Array): Route {
  const n = points.length / 2, along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot((points[i * 2] - points[i * 2 - 2]) * h.radius, points[i * 2 + 1] - points[i * 2 - 1]);
  return { points, along, length: n ? along[n - 1] : 0 };
}

