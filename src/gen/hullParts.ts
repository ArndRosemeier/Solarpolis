/**
 * The habitat's hardware up close (Arnd, 2026-10-21: details all the way down, on the hull as much as inside): the
 * despun spindle's plating, the berth arms and the mast as real trusses, the antennas' dishes. Each is a detail part:
 * a grid of cells (gen/detailTree.ts) placed in the body's frame or the spindle's, and the tiles over it hold more
 * parts the smaller they are (`partDetail`):
 *
 * - Spindle plating (cells: plates about `exterior.parts.plate` a side, flat, lifted so each touches the spindle):
 *   0 plates, ring frames and stringers; 1 seams between the plates, hatches, lights on the nodes; 2 the plates' edges,
 *   conduits along the stringers, handrails; 3 rivets, conduit clamps, the handrails' feet.
 * - Trusses (cells: bays as long as the truss is wide; square for the berth arms, triangular for the mast):
 *   0 chords, battens, diagonals, end plates; 1 tubes, the arms' walkway, a cable tray; 2 gusset plates, cables,
 *   handrails, lights; 3 bolts, a grating deck, cable ties.
 * - Dishes (cells: petals around times rings out): 0 the bowl and its feed rod; 1 petals with gaps, ribs, ring
 *   stiffeners, the rim, the feed's struts and horn; 2 the petals' actuators; 3 rivets.
 *
 * The skin (gen/hullDetail.ts) is the first part. Tiles of these parts never cut a cell (their smallest tiles are one
 * cell), so each cell's parts go to the one tile holding it. A truss's or a dish's root tile is the whole part: the
 * far view draws that tile itself (render/hull.ts), so nothing changes form when the detail comes in. Positions are
 * relative to the tile's origin; built in a part's own frame and turned into the habitat's. Pure: no three.js.
 */
import { Rng, deriveSeed, hash3f, v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { Shape, bytesOf, intoPlace, outOfPlace, type Place, type RGB } from './shapes';

export type { Place };
import { cellsOf, wantedCells, type Grid, type GridEye, type TileKey, type WantedTile } from './detailTree';
import { buildHullTile, skinEye, skinGrid, type HullTile } from './hullDetail';
import type { Skin } from './skin';

/** Which frame a part is drawn in: the spinning body's, or the despun spindle's. */
export type PartFrame = 'body' | 'spindle';


interface Common {
  id: string;
  frame: PartFrame;
  grid: Grid;
  place: Place;
}

/**
 * The detailed parts. Plating: the spindle's side, around its axis (the place is the frame itself). Truss: along its
 * local z from its foot, `width` across. Dish: looking out along its local z from its foot, the bowl `boom` out.
 */
export type DetailPart =
  | (Common & { kind: 'skin' })
  | (Common & { kind: 'plating'; radius: number; from: number; to: number })
  | (Common & { kind: 'truss'; section: 'square' | 'triangle'; length: number; width: number; walkway: boolean })
  | (Common & { kind: 'dish'; diameter: number; boom: number });

/** A built tile of a part: its glass (the skin's only, SKIN_DETAIL) and its parts (HARDWARE). */
export interface PartTile {
  part: string;
  key: TileKey;
  /** The tile's origin in the part's frame (m); every position below is relative to it. */
  origin: Vec3;
  glass: HullTile['glass'] | null;
  parts: HullTile['parts'];
}

/**
 * What a tile of this level holds (0–3, the lists above): tiles of two cells a side and less the most. As on the skin,
 * each detail comes in on tiles twice as large as its size alone would ask for (Arnd, 2026-10-21: details need to pop
 * up earlier).
 */
export const partDetail = (level: number): 0 | 1 | 2 | 3 => (level >= 4 ? 0 : level === 3 ? 1 : level === 2 ? 2 : 3);

/** The spindle's plating: root tiles 2^5 plates a side. */
const PLATING_ROOT = 5;

/**
 * The design, as shares of the cell's size: P a plate (plating, and the dishes' rivets), w a truss's width, d a
 * dish's diameter; H the handrail's height (`exterior.parts.handrail`) for what people hold.
 */
export const PLATING = {
  /** Thickness of a plate (P), the seam between two (P), ring frames and stringers every this many plates. */
  thick: 0.012,
  seam: 0.005,
  every: 4,
  ring: { width: 0.05, height: 0.05, flange: 0.12, flangeHeight: 0.006 },
  stringer: { width: 0.035, height: 0.035 },
  /** Share of plates that are hatches; a hatch's size (H) and rim (P). */
  hatches: 0.02,
  hatch: { width: 0.8, length: 1.2, rim: 0.04, rimHeight: 0.008 },
  /** Light housings on the nodes (P). */
  light: { radius: 0.025, height: 0.03 },
  /** Conduits beside each stringer: radius (P), clamps every this share of a plate. */
  conduit: 0.008,
  clampEvery: 0.25,
  /** A handrail along every this many plates around; posts (H). */
  railEvery: 8,
  post: 0.02,
  rail: 0.025,
  /** Rivets along each plate's edges (P). */
  rivet: { every: 0.06, inset: 0.025, radius: 0.004, height: 0.0025 },
} as const;

export const TRUSS = {
  /** Chords (half size), battens, diagonals (w). */
  chord: 0.035,
  batten: 0.022,
  diagonal: 0.018,
  /** End plates' thickness (w). */
  plate: 0.02,
  /** Gusset plates at the nodes: size and thickness (w); bolts on them (w). */
  gusset: 0.2,
  gussetThick: 0.006,
  bolt: 0.006,
  boltHeight: 0.004,
  /** The arms' walkway: deck thickness (w), grating bars every this share of H, posts every this many H. */
  deck: 0.012,
  grating: 0.12,
  postEvery: 1.4,
  /** The cable tray on one face: half width, wall (w); its cables (w), ties every this share of a bay. */
  tray: 0.06,
  trayWall: 0.012,
  cable: 0.007,
  tieEvery: 0.1,
  /** Lights on every other node (w). */
  light: 0.02,
} as const;

export const DISH = {
  /** The focus this share of d above the bowl's middle; the bowl's thickness, gaps between petals (d). */
  focal: 0.4,
  thick: 0.006,
  gap: 0.003,
  /** Ribs behind the petals, the rim (d). */
  rib: 0.02,
  rim: 0.008,
  /** The feed: boom and rod (d, as the far view), struts from this share of the radius, horn (d). */
  boom: 0.015,
  strutsAt: 0.6,
  strut: 0.004,
  horn: { length: 0.06, mouth: 0.025, throat: 0.008 },
  hub: 0.06,
  /** Actuators behind the petals' corners (d). */
  actuator: 0.004,
} as const;

const COLOR: Record<string, RGB> = {
  plate: [0.52, 0.52, 0.53],
  plateNew: [0.62, 0.62, 0.6],
  backing: [0.06, 0.06, 0.065],
  ring: [0.4, 0.4, 0.41],
  stringer: [0.44, 0.44, 0.45],
  hatch: [0.46, 0.45, 0.41],
  handle: [0.72, 0.6, 0.12],
  light: [0.9, 0.9, 0.85],
  conduit: [0.24, 0.23, 0.21],
  clamp: [0.18, 0.18, 0.19],
  rivet: [0.62, 0.62, 0.64],
  rail: [0.75, 0.62, 0.1],
  arm: [0.55, 0.55, 0.56],
  mast: [0.32, 0.31, 0.3],
  gusset: [0.42, 0.42, 0.43],
  bolt: [0.6, 0.6, 0.62],
  deck: [0.28, 0.28, 0.29],
  tray: [0.2, 0.2, 0.21],
  cable: [0.06, 0.06, 0.065],
  tie: [0.5, 0.48, 0.2],
  dish: [0.8, 0.8, 0.78],
  rib: [0.6, 0.6, 0.6],
  feed: [0.7, 0.7, 0.72],
  horn: [0.74, 0.68, 0.48],
};

const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];

/** The antennas: dishes on the despun spindle's tip, one on the mast's tip, and the mast's three whips' lengths. */
export function antennas(h: Habitat): { dishes: { id: string; frame: PartFrame; diameter: number; boom: number; place: Place }[]; whips: number[] } {
  const x = h.exterior, s = x.spindle, ant = h.params.exterior.antennas, hub = h.params.hubRadius;
  const rng = new Rng(deriveSeed(h.seed, 'exterior', 'antennas'));
  const dishes = [];
  for (let k = 0; k < ant.count; k++) {
    const a = ((k + rng.range(-0.2, 0.2)) / ant.count) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const size = ant.dish * hub * rng.range(0.4, 1), tilt = rng.range(0.25, 0.9);
    // Looking out along the axis, tipped outward by `tilt`.
    const ez: Vec3 = [ca * Math.sin(tilt), sa * Math.sin(tilt), Math.cos(tilt)], ey: Vec3 = [-sa, ca, 0];
    dishes.push({ id: `dish${k}`, frame: 'spindle' as const, diameter: size, boom: size * 0.35, place: { ex: v3cross(ey, ez), ey, ez, at: [ca * s.radius * 0.6, sa * s.radius * 0.6, s.to] as Vec3 } });
  }
  const md = ant.dish * hub * 0.5;
  dishes.push({ id: 'mastDish', frame: 'body' as const, diameter: md, boom: md * 0.4, place: { ex: X, ey: [0, -1, 0] as Vec3, ez: [0, 0, -1] as Vec3, at: [0, 0, x.mast.from] as Vec3 } });
  return { dishes, whips: [0, 1, 2].map(() => hub * rng.range(0.4, 0.8)) };
}

/** Root level holding a whole part of n cells. */
const wholeRoot = (n: number): number => Math.max(1, Math.ceil(Math.log2(n)));

/** Every detailed part of a habitat: the skin first, then the spindle's plating, the berth arms, the mast, the dishes. */
export function detailParts(h: Habitat, skin: Skin): DetailPart[] {
  const x = h.exterior, s = x.spindle, P = h.params.exterior.parts.plate;
  const identity: Place = { ex: X, ey: Y, ez: Z, at: [0, 0, 0] };
  const parts: DetailPart[] = [{ id: 'skin', kind: 'skin', frame: 'body', grid: skinGrid(skin), place: identity }];

  const nU = Math.max(8, Math.round((2 * Math.PI * s.radius) / P)), nV = Math.max(1, Math.round((s.to - s.from) / P));
  parts.push({ id: 'plating', kind: 'plating', frame: 'spindle', radius: s.radius, from: s.from, to: s.to, place: identity, grid: { nU, nV, wrap: true, edgeU: (2 * Math.PI * s.radius) / nU, edgeV: (s.to - s.from) / nV, root: PLATING_ROOT, finest: 0 } });

  const truss = (id: string, frame: PartFrame, section: 'square' | 'triangle', length: number, width: number, walkway: boolean, place: Place): DetailPart => {
    const bay = section === 'square' ? width : (width / 2) * Math.sqrt(3), n = Math.max(2, Math.round(length / bay));
    return { id, kind: 'truss', frame, section, length, width, walkway, place, grid: { nU: 1, nV: n, wrap: false, edgeU: width, edgeV: length / n, root: wholeRoot(n), finest: 0 } };
  };
  const arms = s.arms;
  for (let i = 0; i < s.berthArms; i++) {
    const a = (i / s.berthArms) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    // Out from the spindle's skin, up to the docking collar (render/hull.ts) that sits over its last half width.
    parts.push(truss(`arm${i}`, 'spindle', 'square', arms.length - arms.width / 2, arms.width, true, { ex: [-sa, ca, 0], ey: Z, ez: [ca, sa, 0], at: [ca * s.radius, sa * s.radius, arms.z] }));
  }
  const m = x.mast;
  parts.push(truss('mast', 'body', 'triangle', x.wildFace - m.from, 2 * m.radius, false, { ex: X, ey: [0, -1, 0], ez: [0, 0, -1], at: [0, 0, x.wildFace] }));

  for (const d of antennas(h).dishes) {
    const r = d.diameter / 2, nU = Math.max(8, 4 * Math.round((Math.PI * d.diameter) / (4 * P))), nV = Math.max(2, Math.round(r / P));
    parts.push({ id: d.id, kind: 'dish', frame: d.frame, diameter: d.diameter, boom: d.boom, place: d.place, grid: { nU, nV, wrap: true, edgeU: (Math.PI * d.diameter) / nU, edgeV: r / nV, root: wholeRoot(Math.max(nU, nV)), finest: 0 } });
  }
  return parts;
}

/** The root tile that holds all of a truss or a dish (the far view draws it). */
export const wholeTile = (p: DetailPart): TileKey => ({ level: p.grid.root, i: 0, j: 0 });

/** Where an eye (the part's frame, m) is over the part's grid. */
export function partEye(p: DetailPart, skin: Skin, eye: Vec3): GridEye {
  const g = p.grid;
  if (p.kind === 'skin') return skinEye(skin, eye);
  const q = intoPlace(p.place, eye), rho = Math.hypot(q[0], q[1]), turn = Math.atan2(q[1], q[0]) / (2 * Math.PI), u = (turn - Math.floor(turn)) * g.nU;
  if (p.kind === 'plating') return { u, v: (q[2] - p.from) / g.edgeV, h: Math.max(0, rho - p.radius) };
  if (p.kind === 'truss') return { u: 0.5, v: q[2] / g.edgeV, h: Math.max(0, rho - p.width / 2) };
  // A dish: the nearer of its bowl and its feed (the feed belongs to the middle cell).
  const r = p.diameter / 2, f = DISH.focal * p.diameter, zb = p.boom + Math.min(rho, r) ** 2 / (4 * f);
  const bowl = Math.abs(q[2] - zb), feed = Math.hypot(rho, Math.max(0, -q[2], q[2] - (p.boom + f)));
  if (feed < Math.hypot(bowl, Math.max(0, rho - r))) return { u: 0.5, v: 0.5, h: feed };
  return { u, v: rho / g.edgeV, h: bowl };
}

/** How far an eye (the part's frame, m) is from the part's grid (m): its tiles come within `reachOf(grid)`. */
export function partDistance(p: DetailPart, skin: Skin, eye: Vec3): number {
  const g = p.grid, e = partEye(p, skin, eye), out = (x: number, n: number): number => Math.max(0, -x, x - n);
  return Math.hypot(e.h, g.wrap ? 0 : out(e.u, g.nU) * g.edgeU, out(e.v, g.nV) * g.edgeV);
}

/** A part's tiles around an eye (its frame, m). */
export const partTiles = (p: DetailPart, skin: Skin, eye: Vec3): WantedTile[] => wantedCells(p.grid, partEye(p, skin, eye));

/** A tile's middle in the part's own axes. */
function middleOf(p: DetailPart, k: TileKey): Vec3 {
  const g = p.grid, size = Math.pow(2, k.level), ci = (k.i + Math.min(k.i + size, g.nU)) / 2, cj = (k.j + Math.min(k.j + size, g.nV)) / 2;
  if (p.kind === 'truss' || p.kind === 'skin') return [0, 0, cj * g.edgeV];
  const a = (ci / g.nU) * 2 * Math.PI;
  if (p.kind === 'plating') return [Math.cos(a) * p.radius, Math.sin(a) * p.radius, p.from + cj * g.edgeV];
  const rho = cj * g.edgeV;
  return [Math.cos(a) * rho, Math.sin(a) * rho, p.boom + (rho * rho) / (4 * DISH.focal * p.diameter)];
}

/** One tile of a part. */
export function buildPartTile(h: Habitat, skin: Skin, p: DetailPart, key: TileKey): PartTile {
  if (p.kind === 'skin') {
    const t = buildHullTile(skin, key);
    return { part: p.id, key, origin: t.origin, glass: t.glass, parts: t.parts };
  }
  const origin = outOfPlace(p.place, middleOf(p, key)), shape = new Shape(16, true), detail = partDetail(key.level);
  const cells = cellsOf(p.grid, key).map(({ i, j }) => [i, j] as const);
  if (p.kind === 'plating') plating(shape, h, p, cells, detail);
  else if (p.kind === 'truss') truss(shape, h, p, cells.map(([, j]) => j), detail);
  else dish(shape, h, p, cells, detail);
  const out = new Shape(4, true);
  out.append(shape, p.place.ex, p.place.ey, p.place.ez, v3sub(p.place.at, origin));
  const a = out.arrays();
  return { part: p.id, key, origin, glass: null, parts: { positions: a.positions, normals: a.normals, colors: a.colors ?? new Float32Array(0), index: a.index } };
}

/** Bytes a built tile holds. */
export function partTileBytes(t: PartTile): number {
  const g = t.glass ? [t.glass.positions, t.glass.normals, t.glass.grid, t.glass.index] : [];
  return bytesOf([...g, t.parts.positions, t.parts.normals, t.parts.colors, t.parts.index]);
}

/** A bar from a to b: a box `r` thick (half size), or with `tube` an eight-sided tube of radius r. */
function rod(sh: Shape, a: Vec3, b: Vec3, r: number, col: RGB, tube: boolean): void {
  const d = v3sub(b, a), len = v3len(d);
  if (len < 1e-9) return;
  const ex = v3scale(d, 1 / len), p1 = v3norm(v3cross(ex, Math.abs(ex[2]) < 0.9 ? Z : X)), p2 = v3cross(ex, p1);
  if (tube) sh.prism(a, p1, p2, ex, r, len, 8, col);
  else sh.block(v3scale(v3add(a, b), 0.5), ex, p1, p2, [len / 2, r, r], col);
}

/** A flat quad, wound to face `n`. */
function facing(sh: Shape, a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col: RGB): void {
  const f = v3cross(v3sub(c, a), v3sub(d, b));
  const nn = v3len(f) > 1e-12 ? v3norm(f) : n;
  if (v3dot(nn, n) >= 0) sh.quad(a, b, c, d, nn, col);
  else sh.quad(a, d, c, b, v3scale(nn, -1), col);
}

/** The spindle's plates (the spindle's frame). */
function plating(sh: Shape, h: Habitat, p: Extract<DetailPart, { kind: 'plating' }>, cells: readonly (readonly [number, number])[], detail: number): void {
  const g = p.grid, P = h.params.exterior.parts.plate, H = h.params.exterior.parts.handrail, D = PLATING;
  const seed = deriveSeed(h.seed, 'spindle', 'plates'), t = P * D.thick, low = t * 0.2;
  const dth = (2 * Math.PI) / g.nU, L = g.edgeV, W = 2 * p.radius * Math.sin(dth / 2);
  for (const [i, j] of cells) {
    const th = (i + 0.5) * dth, out: Vec3 = [Math.cos(th), Math.sin(th), 0], around: Vec3 = [-Math.sin(th), Math.cos(th), 0], back = v3scale(around, -1);
    const mid: Vec3 = [out[0] * p.radius, out[1] * p.radius, p.from + (j + 0.5) * L];
    // A point of the plate: x across and y along (0–1), w out from the spindle (m).
    const pt = (x: number, y: number, w: number): Vec3 => [0, 1, 2].map((a) => mid[a] + around[a] * (x - 0.5) * W + Z[a] * (y - 0.5) * L + out[a] * w) as Vec3;
    const xs = (m: number): number => m / W, ys = (m: number): number => m / L;
    const stringer = i % D.every === 0, ring = j % D.every === 0, end = j === g.nV - 1;
    const tint = hash3f(seed, i, j, 0), renewed = hash3f(seed, i, j, 1) < 0.05;
    const col = (renewed ? COLOR.plateNew : COLOR.plate).map((c) => c * (0.84 + 0.24 * tint)) as RGB;
    const hatch = !stringer && !ring && hash3f(seed, i, j, 2) < D.hatches;

    // The plate: whole from afar, then with its seams over a dark backing, then with its edges.
    const s = detail >= 1 ? P * D.seam * 0.5 : 0, x0 = xs(s), x1 = 1 - xs(s), y0 = ys(s), y1 = 1 - ys(s);
    if (detail >= 1) sh.quad(pt(0, 0, low), pt(1, 0, low), pt(1, 1, low), pt(0, 1, low), out, COLOR.backing);
    sh.quad(pt(x0, y0, t), pt(x1, y0, t), pt(x1, y1, t), pt(x0, y1, t), out, col);
    if (detail >= 2) {
      const edge = (a: [number, number], b: [number, number], n: Vec3): void => facing(sh, pt(a[0], a[1], low), pt(b[0], b[1], low), pt(b[0], b[1], t), pt(a[0], a[1], t), n, col);
      edge([x0, y0], [x1, y0], v3scale(Z, -1));
      edge([x1, y1], [x0, y1], Z);
      edge([x0, y1], [x0, y0], back);
      edge([x1, y0], [x1, y1], around);
    }

    // Ring frames across at the plate's start (and at the spindle's tip), stringers along at its side.
    const R = D.ring, rw = P * R.width, rh = P * R.height;
    const ringAt = (y: number): void => {
      sh.block(pt(0.5, y, t + rh / 2), around, Z, out, [W / 2, rw / 2, rh / 2], COLOR.ring, true);
      if (detail >= 2) sh.block(pt(0.5, y, t + rh + (P * R.flangeHeight) / 2), around, Z, out, [W / 2, (P * R.flange) / 2, (P * R.flangeHeight) / 2], COLOR.ring, true);
    };
    if (ring) ringAt(0);
    if (end) ringAt(1);
    const sw = P * D.stringer.width, sth = P * D.stringer.height;
    if (stringer) sh.block(pt(0, 0.5, t + sth / 2), Z, back, out, [L / 2, sw / 2, sth / 2], COLOR.stringer, true);
    if (detail >= 1 && stringer && ring) sh.prism(pt(0, 0, t + rh), around, Z, out, P * D.light.radius, P * D.light.height, 8, COLOR.light);

    // Conduits beside the stringer, clamped down.
    if (detail >= 2 && stringer) {
      const cr = P * D.conduit;
      for (const side of [-1, 1]) {
        const x = xs(side * (sw / 2 + cr * 1.6));
        sh.prism(pt(x, 0, t + cr), out, around, Z, cr, L, 8, COLOR.conduit);
        if (detail < 3) continue;
        for (let k = 0; k < 1 / D.clampEvery; k++) {
          const y = (k + 0.5) * D.clampEvery;
          sh.block(pt(x, y, t + cr), around, Z, out, [cr * 1.5, P * 0.006, cr * 1.15], COLOR.clamp, true);
          sh.prism(pt(x + xs(side * cr * 2), y, t), around, Z, out, P * D.rivet.radius, P * D.rivet.height * 1.5, 6, COLOR.rivet);
        }
      }
    }

    // A hatch: its rim, a handle, two hinges.
    if (detail >= 1 && hatch) {
      const hw = (H * D.hatch.width) / 2, hl = (H * D.hatch.length) / 2, rim = P * D.hatch.rim, rhh = P * D.hatch.rimHeight;
      for (const sgn of [-1, 1]) {
        sh.block(pt(0.5 + xs(sgn * hw), 0.5, t + rhh / 2), Z, back, out, [hl, rim / 2, rhh / 2], COLOR.hatch, true);
        sh.block(pt(0.5, 0.5 + ys(sgn * hl), t + rhh / 2), around, Z, out, [hw, rim / 2, rhh / 2], COLOR.hatch, true);
      }
      if (detail >= 2) rod(sh, pt(0.5 - xs(hw * 0.3), 0.5 - ys(hl * 0.7), t + H * 0.06), pt(0.5 + xs(hw * 0.3), 0.5 - ys(hl * 0.7), t + H * 0.06), H * 0.012, COLOR.handle, true);
      if (detail >= 3) for (const sgn of [-1, 1]) sh.prism(pt(0.5 + xs(sgn * hw * 0.6), 0.5 + ys(hl), t), around, Z, out, rim * 0.6, rhh * 2, 8, COLOR.clamp);
    }

    // A handrail along the spindle, on posts, for people working outside.
    if (detail >= 2 && i % D.railEvery === D.railEvery / 2) {
      const pr = H * D.post;
      for (const y of [0.25, 0.75]) {
        sh.prism(pt(0.5, y, t), around, Z, out, pr, H, 8, COLOR.rail);
        if (detail >= 3) {
          sh.block(pt(0.5, y, t + P * 0.002), around, Z, out, [pr * 3, pr * 3, P * 0.002], COLOR.clamp, true);
          for (const sgn of [-1, 1]) sh.prism(pt(0.5 + xs(sgn * pr * 2), y, t + P * 0.004), around, Z, out, P * D.rivet.radius, P * D.rivet.height, 6, COLOR.rivet);
        }
      }
      sh.prism(pt(0.5, 0, t + H), out, around, Z, H * D.rail, L, 8, COLOR.rail);
    }

    // Rivets along the plate's edges.
    if (detail >= 3) {
      const rv = D.rivet, inset = P * rv.inset, rr = P * rv.radius, rh2 = P * rv.height;
      const row = (n: number, point: (f: number) => Vec3): void => { for (let k = 0; k < n; k++) sh.prism(point((k + 0.5) / n), around, Z, out, rr, rh2, 6, COLOR.rivet); };
      const nx = Math.max(1, Math.floor(W / (P * rv.every))), ny = Math.max(1, Math.floor(L / (P * rv.every)));
      for (const y of [y0 + ys(inset), y1 - ys(inset)]) row(nx, (f) => pt(x0 + xs(inset) + f * (x1 - x0 - 2 * xs(inset)), y, t));
      for (const x of [x0 + xs(inset), x1 - xs(inset)]) row(ny, (f) => pt(x, y0 + ys(inset) + f * (y1 - y0 - 2 * ys(inset)), t));
    }
  }
}

/** A truss's bays (its own axes: z along from the foot, the section across). */
function truss(sh: Shape, h: Habitat, p: Extract<DetailPart, { kind: 'truss' }>, bays: readonly number[], detail: number): void {
  const w = p.width, T = TRUSS, H = h.params.exterior.parts.handrail, b = p.grid.edgeV, n = p.grid.nV;
  const col = p.frame === 'spindle' ? COLOR.arm : COLOR.mast, c = w * T.chord, tube = detail >= 1;
  // The section's corners, counter-clockwise, the chords' middle lines inside the envelope.
  const corners: [number, number][] = p.section === 'square'
    ? [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * (w / 2 - c), y * (w / 2 - c)])
    : [0, 1, 2].map((k) => { const a = Math.PI / 2 + (k * 2 * Math.PI) / 3; return [Math.cos(a) * (w / 2 - c), Math.sin(a) * (w / 2 - c)]; });
  const m = corners.length, node = (k: number, z: number): Vec3 => [corners[k % m][0], corners[k % m][1], z];
  // Face k from corner k to k + 1: its direction, outward normal and middle line.
  const face = (k: number): { dir: Vec3; n: Vec3; mid: [number, number] } => {
    const a = corners[k % m], q = corners[(k + 1) % m], dir = v3norm([q[0] - a[0], q[1] - a[1], 0]);
    return { dir, n: [dir[1], -dir[0], 0], mid: [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2] };
  };
  for (const j of bays) {
    const z0 = j * b, z1 = z0 + b, zm = (z0 + z1) / 2, last = j === n - 1;
    for (let k = 0; k < m; k++) {
      // The chord, the batten at the bay's start (and at the tip), the face's diagonal, turning each bay.
      if (tube) rod(sh, node(k, z0), node(k, z1), c, col, true);
      else sh.block([corners[k][0], corners[k][1], zm], X, Y, Z, [c, c, b / 2], col);
      rod(sh, node(k, z0), node(k + 1, z0), w * T.batten, col, tube);
      if (last) rod(sh, node(k, z1), node(k + 1, z1), w * T.batten, col, tube);
      const up = (j + k) % 2 === 0;
      rod(sh, node(up ? k : k + 1, z0), node(up ? k + 1 : k, z1), w * T.diagonal, col, tube);
      if (detail < 2) continue;
      // Gusset plates on the face at both its nodes, bolted on.
      const f = face(k), gs = w * T.gusset, gt = w * T.gussetThick;
      for (const [corner, sgn] of [[k, 1], [k + 1, -1]] as const) {
        for (const z of last ? [z0, z1] : [z0]) {
          const o = v3add(v3add(node(corner, z), v3scale(f.dir, sgn * (gs / 2 - c))), v3scale(f.n, c + gt / 2));
          sh.block(o, f.dir, Z, f.n, [gs / 2, gs / 2, gt / 2], COLOR.gusset);
          if (detail < 3) continue;
          for (const [a, e] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sh.prism(v3add(v3add(o, v3scale(f.dir, a * gs * 0.25)), v3add(v3scale(Z, e * gs * 0.25), v3scale(f.n, gt / 2))), f.dir, Z, f.n, w * T.bolt, w * T.boltHeight, 6, COLOR.bolt);
        }
      }
    }
    // End plates: the foot's, against the spindle or the wild face, and the tip's.
    const thick = w * T.plate;
    if (j === 0) sh.block([0, 0, thick / 2], X, Y, Z, [w * 0.55, w * 0.55, thick / 2], col);
    if (last) sh.block([0, 0, z1 - thick / 2], X, Y, Z, [w * 0.5, w * 0.5, thick / 2], col);

    if (detail >= 2 && j % 2 === 0) {
      const o = node(0, z0), dirOut = v3norm([o[0], o[1], 0]), side = v3norm(v3cross(Z, dirOut));
      sh.prism(v3add(o, v3scale(dirOut, c)), side, Z, dirOut, w * T.light, w * T.light, 8, COLOR.light);
    }
    if (detail < 1) continue;

    // The cable tray on the face after the first, its cables and ties.
    const tf = face(1), tc: Vec3 = [tf.mid[0] + tf.n[0] * (c + w * T.trayWall), tf.mid[1] + tf.n[1] * (c + w * T.trayWall), zm];
    sh.block(tc, tf.dir, Z, tf.n, [w * T.tray, b / 2, w * T.trayWall * 0.3], COLOR.tray);
    if (detail >= 2) {
      for (const sgn of [-1, 1]) sh.block(v3add(tc, v3add(v3scale(tf.dir, sgn * w * T.tray), v3scale(tf.n, w * T.trayWall * 0.5))), tf.dir, Z, tf.n, [w * 0.002, b / 2, w * T.trayWall * 0.5], COLOR.tray);
      const cr = w * T.cable;
      for (const r of [-1, 0, 1]) sh.prism(v3add(v3add(tc, v3scale(tf.dir, r * cr * 2.2)), v3add(v3scale(tf.n, cr), [0, 0, -b / 2])), tf.n, tf.dir, Z, cr, b, 8, COLOR.cable);
      if (detail >= 3) {
        for (let k = 0; k < 1 / T.tieEvery; k++) sh.block(v3add(v3add(tc, v3scale(tf.n, cr)), [0, 0, -b / 2 + (k + 0.5) * T.tieEvery * b]), tf.dir, Z, tf.n, [cr * 3.6, w * 0.002, cr * 1.15], COLOR.tie);
      }
    }

    // The walkway on the arms' first face: a deck (a grating up close), and handrails on both edges.
    if (!p.walkway) continue;
    const wf = face(0), dk = w * T.deck, ww = Math.min(w / 2, H), deckAt = (s: number, u: number): Vec3 => [wf.mid[0] + wf.dir[0] * s + wf.n[0] * (c + u), wf.mid[1] + wf.dir[1] * s + wf.n[1] * (c + u), 0];
    if (detail < 3) sh.block(v3add(deckAt(0, dk / 2), [0, 0, zm]), wf.dir, Z, wf.n, [ww / 2, b / 2, dk / 2], COLOR.deck);
    else {
      for (const s of [-1, 1]) sh.block(v3add(deckAt((s * ww) / 2, dk / 2), [0, 0, zm]), wf.dir, Z, wf.n, [dk / 2, b / 2, dk / 2], COLOR.deck);
      const bars = Math.max(1, Math.round(b / (H * T.grating)));
      for (let k = 0; k < bars; k++) sh.block(v3add(deckAt(0, dk / 2), [0, 0, z0 + ((k + 0.5) / bars) * b]), wf.dir, Z, wf.n, [ww / 2, dk * 0.25, dk / 2], COLOR.deck);
    }
    if (detail < 2) continue;
    const posts = Math.max(1, Math.round(b / (H * T.postEvery))), pr = H * PLATING.post;
    for (const s of [-1, 1]) {
      const base = deckAt((s * ww) / 2, dk);
      for (let k = 0; k < posts; k++) sh.prism(v3add(base, [0, 0, z0 + ((k + 0.5) / posts) * b]), wf.dir, Z, wf.n, pr, H, 8, COLOR.rail);
      sh.prism(v3add(v3add(base, v3scale(wf.n, H)), [0, 0, z0]), wf.n, wf.dir, Z, H * PLATING.rail, b, 8, COLOR.rail);
    }
  }
}

/** A dish's cells (its own axes: looking out along z, the bowl `boom` out from its foot). */
function dish(sh: Shape, h: Habitat, p: Extract<DetailPart, { kind: 'dish' }>, cells: readonly (readonly [number, number])[], detail: number): void {
  const d = p.diameter, r = d / 2, f = DISH.focal * d, g = p.grid, P = h.params.exterior.parts.plate, D = DISH;
  const zAt = (rho: number): number => p.boom + (rho * rho) / (4 * f);
  /** Inward normal of the bowl (towards the focus) at radius rho, angle a. */
  const normal = (rho: number, a: number): Vec3 => v3norm([(-rho / (2 * f)) * Math.cos(a), (-rho / (2 * f)) * Math.sin(a), 1]);
  const on = (rho: number, a: number, off: number): Vec3 => v3add([rho * Math.cos(a), rho * Math.sin(a), zAt(rho)], v3scale(normal(rho, a), off));
  const tk = d * D.thick;
  for (const [i, j] of cells) {
    const da = (2 * Math.PI) / g.nU, a0 = i * da, a1 = a0 + da, am = a0 + da / 2, p0 = j * g.edgeV, p1 = p0 + g.edgeV;
    // The petal: front and back, apart from its neighbours by a gap up close.
    const gp = detail >= 1 ? (d * D.gap) / 2 : 0, q0 = p0 + (j > 0 ? gp : 0), q1 = p1 - gp, ga = gp / Math.max((p0 + p1) / 2, gp * 4);
    const b0 = a0 + ga, b1 = a1 - ga, n = normal((q0 + q1) / 2, am);
    facing(sh, on(q0, b0, 0), on(q1, b0, 0), on(q1, b1, 0), on(q0, b1, 0), n, COLOR.dish);
    facing(sh, on(q0, b0, -tk), on(q0, b1, -tk), on(q1, b1, -tk), on(q1, b0, -tk), v3scale(n, -1), COLOR.dish);
    if (detail >= 1) {
      // A rib behind the petal's edge, a ring stiffener every other ring, the rim.
      const rib = d * D.rib, tangent: Vec3 = [-Math.sin(a0), Math.cos(a0), 0];
      const ra = on(p0, a0, -tk - rib / 2), rb = on(p1, a0, -tk - rib / 2), along = v3norm(v3sub(rb, ra)), up = v3cross(along, tangent);
      sh.block(v3scale(v3add(ra, rb), 0.5), along, tangent, up, [v3len(v3sub(rb, ra)) / 2, rib * 0.15, rib / 2], COLOR.rib);
      if (j > 0 && j % 2 === 0) rod(sh, on(p0, a0, -tk - rib / 2), on(p0, a1, -tk - rib / 2), rib * 0.3, COLOR.rib, false);
      if (j === g.nV - 1) rod(sh, on(p1, a0, d * D.rim * 0.5), on(p1, a1, d * D.rim * 0.5), d * D.rim, COLOR.rib, detail >= 2);
    }
    if (detail >= 2) {
      const up = v3scale(normal(p1, a0), -1), ex: Vec3 = [-Math.sin(a0), Math.cos(a0), 0];
      sh.prism(on(p1, a0, -tk), ex, v3cross(up, ex), up, d * D.actuator, d * D.actuator * 3, 6, COLOR.clamp);
    }
    if (detail >= 3) {
      // Rivets along the petal's two radial edges.
      const count = Math.max(1, Math.floor((q1 - q0) / (P * PLATING.rivet.every)));
      for (const a of [b0 + ga, b1 - ga]) {
        for (let k = 0; k < count; k++) {
          const rho = q0 + ((k + 0.5) / count) * (q1 - q0), nn = normal(rho, a), ex = v3norm(v3cross([-Math.sin(a), Math.cos(a), 0], nn));
          sh.prism(on(rho, a, 0), ex, v3cross(nn, ex), nn, P * PLATING.rivet.radius, P * PLATING.rivet.height, 6, COLOR.rivet);
        }
      }
    }

    // The middle cell holds the boom, the hub and the feed.
    if (i !== 0 || j !== 0) continue;
    const bw = d * D.boom;
    sh.block([0, 0, p.boom / 2], X, Y, Z, [bw * 2, bw * 2, p.boom / 2], COLOR.feed);
    if (detail < 1) { sh.block([0, 0, p.boom + f / 2], X, Y, Z, [bw, bw, f / 2], COLOR.feed); continue; }
    const hub = d * D.hub, top = p.boom + f, horn = D.horn;
    sh.band(p.boom - d * 0.03, hub, p.boom + d * 0.005, hub, 0, 1, COLOR.feed);
    sh.band(p.boom - d * 0.03, 0, p.boom - d * 0.03, hub, -1, 0, COLOR.feed);
    // The horn opens down towards the bowl: outside, inside, and its back; up close a flange round its mouth.
    const zm = top - d * horn.length, rm = d * horn.mouth, rt = d * horn.throat, sl = Math.hypot(rm - rt, top - zm);
    sh.band(zm, rm, top, rt, (rm - rt) / sl, (top - zm) / sl, COLOR.horn);
    sh.band(top, rt, zm, rm, -(rm - rt) / sl, -(top - zm) / sl, COLOR.horn);
    // Three struts from the bowl to the horn's side, clamped on.
    const zs = (zm + top) / 2, rs = (rm + rt) / 2;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, end: Vec3 = [Math.cos(a) * rs, Math.sin(a) * rs, zs];
      rod(sh, on(r * D.strutsAt, a, 0), end, d * D.strut, COLOR.feed, true);
      if (detail >= 2) rod(sh, v3add(end, [Math.cos(a) * d * D.strut * 3, Math.sin(a) * d * D.strut * 3, 0]), end, d * D.strut * 1.8, COLOR.clamp, false);
    }
    if (detail >= 2) {
      const fl = rm * 1.2, ft = d * 0.002;
      sh.band(zm, rm, zm, fl, -1, 0, COLOR.horn);
      sh.band(zm, fl, zm + ft, fl, 0, 1, COLOR.horn);
      if (detail >= 3) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * 2 * Math.PI, c: Vec3 = [Math.cos(a) * (rm + fl) / 2, Math.sin(a) * (rm + fl) / 2, zm];
          sh.prism(c, [Math.cos(a), Math.sin(a), 0], [Math.sin(a), -Math.cos(a), 0], [0, 0, -1], P * PLATING.rivet.radius * 1.5, P * PLATING.rivet.height * 2, 6, COLOR.rivet);
        }
      }
    }
    sh.band(top, rt, top, 0, 1, 0, COLOR.horn);
  }
}
