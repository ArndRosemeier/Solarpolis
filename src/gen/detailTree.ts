/**
 * The one way detail comes in as the eye comes closer: a quadtree of tiles over a grid of cells (a surface's bays or
 * plates, a truss's bays, a dish's petals), split where a tile is near the eye for its size. Every detailed part of a
 * habitat seen from outside (gen/hullDetail.ts, gen/hullParts.ts) lays its cells out as a `Grid` and its tiles come
 * from `wantedCells`; a tile's key says which cells it covers, so a builder can cut its parts to it exactly. Pure.
 */

/** A tile: 2^level cells a side; the cell column and row of its first corner (multiples of the size, may be fractions). */
export interface TileKey {
  level: number;
  i: number;
  j: number;
}

/** Cells around (u, wrapping when `wrap`, like the angle around a drum) and along (v), each `edgeU` × `edgeV` m. */
export interface Grid {
  nU: number;
  nV: number;
  wrap: boolean;
  edgeU: number;
  edgeV: number;
  /** Levels of the largest and the smallest tiles. */
  root: number;
  finest: number;
}

/** Where the eye is over a grid: in cells across and along (may lie outside it), and its height above the surface (m). */
export interface GridEye {
  u: number;
  v: number;
  h: number;
}

/** A tile splits while the eye is nearer than SPLIT × its edge; root tiles are wanted within ROOT_REACH × theirs. */
export const SPLIT = 1.4;
export const ROOT_REACH = 2.5;

export interface WantedTile {
  key: TileKey;
  /** From the eye to the tile's rectangle (m). */
  distance: number;
  /** Drawn itself (true), or split into its four children. */
  leaf: boolean;
}

/** How far the root tiles of a grid are wanted (m): beyond, the part's own far form stands alone. */
export const reachOf = (g: Grid): number => ROOT_REACH * Math.pow(2, g.root) * Math.max(g.edgeU, g.edgeV);

/** The tiles a tile splits into (those inside the grid). */
export function childrenOf(g: Grid, k: TileKey): TileKey[] {
  const half = Math.pow(2, k.level - 1);
  return [[0, 0], [1, 0], [0, 1], [1, 1]]
    .map(([a, b]) => ({ level: k.level - 1, i: k.i + a * half, j: k.j + b * half }))
    .filter((c) => c.i < g.nU && c.j < g.nV);
}

/**
 * The quadtree around an eye: every tile visited, split where it looks big. The leaves cover the grid near the eye
 * exactly once. Coarsest first, nearest first within a level.
 */
export function wantedCells(g: Grid, eye: GridEye): WantedTile[] {
  const out: WantedTile[] = [];
  const reach = reachOf(g);
  if (eye.h > reach) return out;
  const gap = (x: number): number => (g.wrap ? Math.min(Math.abs(x), g.nU - Math.abs(x)) : Math.abs(x));
  const u = g.wrap ? ((eye.u % g.nU) + g.nU) % g.nU : eye.u;
  const dist = (k: TileKey): number => {
    const size = Math.pow(2, k.level), i1 = Math.min(k.i + size, g.nU), j1 = Math.min(k.j + size, g.nV);
    const du = u >= k.i && u <= i1 ? 0 : Math.min(gap(u - k.i), gap(u - i1)) * g.edgeU;
    const dv = eye.v < k.j ? (k.j - eye.v) * g.edgeV : eye.v > j1 ? (eye.v - j1) * g.edgeV : 0;
    return Math.hypot(eye.h, du, dv);
  };
  const visit = (k: TileKey): void => {
    const d = dist(k), split = k.level > g.finest && d < SPLIT * Math.pow(2, k.level) * Math.max(g.edgeU, g.edgeV);
    out.push({ key: k, distance: d, leaf: !split });
    if (split) for (const c of childrenOf(g, k)) visit(c);
  };
  const root = Math.pow(2, g.root), roots = Math.ceil(g.nU / root), span = Math.ceil(ROOT_REACH) + 1;
  const ri = Math.floor(u / root), rj = Math.floor(eye.v / root), seen = new Set<number>();
  for (let a = -span; a <= span; a++) {
    const I = g.wrap ? (((ri + a) % roots) + roots) % roots : ri + a;
    if (I < 0 || I >= roots || seen.has(I)) continue;
    seen.add(I);
    for (let b = -span; b <= span; b++) {
      const J = (rj + b) * root;
      if (J < 0 || J >= g.nV) continue;
      const k = { level: g.root, i: I * root, j: J };
      if (dist(k) < reach) visit(k);
    }
  }
  return out.sort((x, y) => y.key.level - x.key.level || x.distance - y.distance);
}

export const tileId = (k: TileKey): string => `${k.level}:${k.i}:${k.j}`;

/**
 * A tile's rectangle in one cell's units (0–1 across and along), and what it owns of that cell: a point if it lies
 * inside (half-open, so each point has one owner; closed at the grid's far edges, `endU`/`endV`).
 */
export interface CellCut {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Whether the tile reaches the grid's last column (u) and row (v) at this cell's far edge. */
  endU: boolean;
  endV: boolean;
  ownsX(x: number): boolean;
  ownsY(y: number): boolean;
  /** An interval [a, b] (cell units) cut to the tile, or null. */
  clipX(a: number, b: number): [number, number] | null;
  clipY(a: number, b: number): [number, number] | null;
}

/** The cells a tile covers, each with its cut. */
export function cellsOf(g: Grid, k: TileKey): { i: number; j: number; cut: CellCut }[] {
  const size = Math.pow(2, k.level), I1 = Math.min(k.i + size, g.nU), J1 = Math.min(k.j + size, g.nV);
  const out: { i: number; j: number; cut: CellCut }[] = [];
  for (let i = Math.floor(k.i); i < Math.ceil(I1); i++) {
    for (let j = Math.floor(k.j); j < Math.ceil(J1); j++) {
      const x0 = Math.max(0, k.i - i), x1 = Math.min(1, I1 - i), y0 = Math.max(0, k.j - j), y1 = Math.min(1, J1 - j);
      if (x0 >= x1 || y0 >= y1) continue;
      const endU = !g.wrap && i === g.nU - 1 && x1 === 1, endV = j === g.nV - 1 && y1 === 1;
      const clip = (a: number, b: number, lo: number, hi: number): [number, number] | null => (Math.max(a, lo) < Math.min(b, hi) ? [Math.max(a, lo), Math.min(b, hi)] : null);
      out.push({
        i, j,
        cut: {
          x0, x1, y0, y1, endU, endV,
          ownsX: (x) => (x >= x0 && x < x1) || (endU && x === 1),
          ownsY: (y) => (y >= y0 && y < y1) || (endV && y === 1),
          clipX: (a, b) => clip(a, b, x0, x1),
          clipY: (a, b) => clip(a, b, y0, y1),
        },
      });
    }
  }
  return out;
}

/**
 * What to draw of the wanted tiles, given which are built: each leaf, or where a tile's children are not all built
 * yet, the tile itself, so the cover never shows a hole while the eye moves in. `complete` when every root tile is
 * covered.
 */
export function coverOf(wanted: readonly WantedTile[], built: (id: string) => boolean): { drawn: WantedTile[]; complete: boolean } {
  const byId = new Map(wanted.map((w) => [tileId(w.key), w]));
  const kids = (k: TileKey): WantedTile[] => {
    const h = Math.pow(2, k.level - 1);
    return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => byId.get(tileId({ level: k.level - 1, i: k.i + a * h, j: k.j + b * h }))).filter((w): w is WantedTile => !!w);
  };
  // Whether a tile's whole area can be drawn from built tiles at it or below it.
  const ready = new Map<string, boolean>();
  const isReady = (w: WantedTile): boolean => {
    const id = tileId(w.key);
    let r = ready.get(id);
    if (r === undefined) {
      r = built(id) || (!w.leaf && kids(w.key).every(isReady));
      ready.set(id, r);
    }
    return r;
  };
  const drawn: WantedTile[] = [];
  const draw = (w: WantedTile): void => {
    if (!w.leaf && kids(w.key).every(isReady)) { for (const c of kids(w.key)) draw(c); return; }
    if (built(tileId(w.key))) { drawn.push(w); return; }
    if (!w.leaf) for (const c of kids(w.key)) draw(c);
  };
  const roots = wanted.filter((w) => w.key.level === wanted[0]?.key.level);
  for (const w of roots) draw(w);
  return { drawn, complete: roots.length > 0 && roots.every(isReady) };
}
