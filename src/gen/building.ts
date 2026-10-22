/**
 * Walled blocks under the vaults (houses, gen/homeMesh.ts; the hamlets' halls, gen/hallMesh.ts), built in their bay's
 * frame (x along the axis, y around, z the height over the profile) into the bay's shape, for the Understorey's VAULT
 * kind: a block stands level on a stone plinth, its walls of its build with windows and doors in them (steps down from
 * a door where the floor falls away), a parapet round its roof terrace; and the low walls round a yard, stepping with
 * the floor.
 *
 * Every level is the same block (CLAUDE.md rule 16: the same size, colour and outline): far draws its walls whole with
 * the windows and doors just proud of them, mid opens the walls round them and gives the roof its terrace and the doors
 * their steps, near sets the openings back in their reveals with sills, bands the storeys and copes the walls. A
 * window is mapped across and up itself for its frame and bars (`windowPane`, render/builtShaders.ts). Sizes are human
 * (`landmarks.handrail`). Pure.
 */
import { FINISH } from './pavilion';
import { along, shade, type RGB, type Shape } from './shapes';
import type { Rect } from './homes';
import type { Levels } from './underLevels';
import type { Vec3 } from '../blueprint';

export type BuildDetail = 'far' | 'mid' | 'near';
/** A bay's levels anywhere in its frame. */
export type LevelsAt = (x: number, y: number) => Levels;

/** The plinth's stone (linear albedo). */
export const PLINTH: RGB = [0.46, 0.44, 0.4];

/** Sizes in handrails. */
const H = {
  /** The plinth's step out from the walls and how deep it goes in; the parapet's thickness and height. */
  plinthOut: 0.15, bury: 0.3, parapet: 0.3, parapetHigh: 1,
  /** An opening's reveal, a sill's reach and depth (near). */
  reveal: 0.22, sillOut: 0.08, sillHigh: 0.07,
  /** Far: how far the openings stand proud of the wall (no hole cut). */
  proud: 0.03,
  /** A storey band's reach and height (near). */
  band: 0.08, bandHigh: 0.16,
  /** A stair's riser and tread. */
  riser: 0.16, tread: 0.28,
  /** A yard wall's thickness, its stepped runs' longest piece (far, else), its coping (near). */
  wall: 0.3, run: 12, step: 6, coping: 0.06, copingHigh: 0.07,
} as const;
/** A yard wall's thickness and a roof's parapet height, in handrails. */
export const WALL = H.wall;
export const PARAPET = H.parapetHigh;

/** A window or a door in a wall: along it from its start (m), from … to in height (absolute), its colour and finish. */
export interface Opening {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  col: RGB;
  finish: number;
  door: boolean;
}

/** One of a block's four walls: its start, the way it runs, the way it faces, its length. */
export interface Side {
  o: [number, number];
  t: [number, number];
  n: [number, number];
  length: number;
}

/** A block's four walls, always in this order: facing −y, +y, −x, +x. */
export function sidesOf(b: Rect): Side[] {
  const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
  return [
    { o: [b.x0, b.y0], t: [1, 0], n: [0, -1], length: dx },
    { o: [b.x0, b.y1], t: [1, 0], n: [0, 1], length: dx },
    { o: [b.x0, b.y0], t: [0, 1], n: [-1, 0], length: dy },
    { o: [b.x1, b.y0], t: [0, 1], n: [1, 0], length: dy },
  ];
}

/** A walled block: its footprint, ground floor level, storeys, walls' colour and finish, and its openings per side (as `sidesOf`). */
export interface Block {
  body: Rect;
  base: number;
  storeys: number;
  storey: number;
  col: RGB;
  finish: number;
  openings: readonly (readonly Opening[])[];
}

/** A point on a side: `u` along it, `out` out from it, at height z. */
const UP: Vec3 = [0, 0, 1];
export const onSide = (s: Side, u: number, out: number, z: number): Vec3 => along([s.o[0], s.o[1], 0], [s.t[0], s.t[1], 0], u, [s.n[0], s.n[1], 0], out, UP, z);

/** An upright box (open underneath) from its extents in the bay's frame. */
export function upright(sh: Shape, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB): void {
  sh.block([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], col, true);
}

/** A flat piece of a side, u0 … u1 along it, z0 … z1, `out` out from it, facing the way the side does. */
function patch(sh: Shape, s: Side, u0: number, u1: number, z0: number, z1: number, out: number, col: RGB): void {
  sh.faceToward(onSide(s, u0, out, z0), onSide(s, u1, out, z0), onSide(s, u1, out, z1), onSide(s, u0, out, z1), [s.n[0], s.n[1], 0], col);
}

/**
 * A window's pane or a door (`o`), `out` out from its side: a window mapped across and up itself (0 … 1, for its frame
 * and bars in the VAULT kind), a door by its plane, as the timber it is.
 */
function pane(sh: Shape, s: Side, o: Opening, out: number): void {
  sh.finish = o.finish;
  if (o.door) { patch(sh, s, o.u0, o.u1, o.z0, o.z1, out, o.col); return; }
  const n: Vec3 = [s.n[0], s.n[1], 0];
  sh.smoothGrid(1, 1, (a, b) => ({ p: onSide(s, b ? o.u1 : o.u0, out, a ? o.z1 : o.z0), n, uv: [b, a] }), o.col);
}

/** A wall from z0 to z1 with holes where its openings are: strips between the openings' edges, filled round them. */
function wallAround(sh: Shape, s: Side, z0: number, z1: number, openings: readonly Opening[], col: RGB): void {
  const e = 1e-6, cuts = [...new Set([0, s.length, ...openings.flatMap((o) => [o.u0, o.u1])])].sort((a, b) => a - b);
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < e) continue;
    let z = z0;
    for (const o of openings.filter((p) => p.u0 <= a + e && p.u1 >= b - e).sort((p, q) => p.z0 - q.z0)) {
      if (o.z0 > z + e) patch(sh, s, a, b, z, o.z0, 0, col);
      z = o.z1;
    }
    if (z1 > z + e) patch(sh, s, a, b, z, z1, 0, col);
  }
}

/** An opening set back in the wall (near): its reveals round it and the glass or door at the back. */
function setBack(sh: Shape, s: Side, o: Opening, wallCol: RGB, wallFinish: number, hr: number): void {
  const d = H.reveal * hr, t: Vec3 = [s.t[0], s.t[1], 0];
  sh.finish = wallFinish;
  const q = (u: number, out: number, z: number): Vec3 => onSide(s, u, out, z);
  sh.faceToward(q(o.u0, 0, o.z0), q(o.u0, -d, o.z0), q(o.u0, -d, o.z1), q(o.u0, 0, o.z1), t, wallCol);
  sh.faceToward(q(o.u1, 0, o.z0), q(o.u1, -d, o.z0), q(o.u1, -d, o.z1), q(o.u1, 0, o.z1), [-t[0], -t[1], 0], wallCol);
  sh.faceToward(q(o.u0, 0, o.z1), q(o.u1, 0, o.z1), q(o.u1, -d, o.z1), q(o.u0, -d, o.z1), [0, 0, -1], wallCol);
  if (!o.door) sh.faceToward(q(o.u0, 0, o.z0), q(o.u1, 0, o.z0), q(o.u1, -d, o.z0), q(o.u0, -d, o.z0), [0, 0, 1], wallCol);
  pane(sh, s, o, -d);
  if (o.door) return;
  // The sill, reaching out under it.
  sh.finish = FINISH.stone;
  const a = onSide(s, o.u0 - H.sillOut * hr, 0, 0), b = onSide(s, o.u1 + H.sillOut * hr, H.sillOut * hr, 0);
  upright(sh, Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), o.z0 - H.sillHigh * hr, o.z0, PLINTH);
}

/** The steps from a door down to the floor in front (`steps` of them over `depth` out from the plinth). */
function stair(sh: Shape, s: Side, o: Opening, from: number, to: number, out0: number, depth: number, steps: number, bottom: number): void {
  for (let k = 0; k < steps; k++) {
    const a = onSide(s, o.u0, out0 + (k * depth) / steps, 0), b = onSide(s, o.u1, out0 + ((k + 1) * depth) / steps, 0);
    upright(sh, Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), bottom, from - ((from - to) * k) / steps, PLINTH);
  }
}

/**
 * A low wall's run from (x0, y0) to (x1, y1) (its middle line, along x or y) `high` over the floor, stepping with it at
 * the detail's piece length, coped up close.
 */
export function wallRun(sh: Shape, x0: number, y0: number, x1: number, y1: number, high: number, hr: number, levelsAt: LevelsAt, col: RGB, detail: BuildDetail): void {
  const len = Math.hypot(x1 - x0, y1 - y0), pieces = Math.max(1, Math.ceil(len / ((detail === 'far' ? H.run : H.step) * hr))), coped = detail === 'near';
  const half = (H.wall * hr) / 2, along = x0 === x1 ? 'y' : 'x';
  for (let k = 0; k < pieces; k++) {
    const a = k / pieces, b = (k + 1) / pieces;
    const ax = x0 + (x1 - x0) * a, ay = y0 + (y1 - y0) * a, bx = x0 + (x1 - x0) * b, by = y0 + (y1 - y0) * b;
    const fa = levelsAt(ax, ay).floor, fb = levelsAt(bx, by).floor, top = levelsAt((ax + bx) / 2, (ay + by) / 2).floor + high;
    const bottom = Math.min(fa, fb) - H.bury * hr;
    const [lx0, lx1, ly0, ly1] = along === 'x' ? [Math.min(ax, bx), Math.max(ax, bx), ay - half, ay + half] : [ax - half, ax + half, Math.min(ay, by), Math.max(ay, by)];
    upright(sh, lx0, lx1, ly0, ly1, bottom, top, col);
    if (coped) {
      const c = H.coping * hr, [cx0, cx1, cy0, cy1] = along === 'x' ? [lx0, lx1, ly0 - c, ly1 + c] : [lx0 - c, lx1 + c, ly0, ly1];
      upright(sh, cx0, cx1, cy0, cy1, top, top + H.copingHigh * hr, shade(col, 0.85));
    }
  }
}


/**
 * A block into a bay's shape (its frame), at a detail: its plinth down into the floor at its lowest, its walls and what
 * is in them, steps down from each door, its roof (whole far off, a terrace inside its parapet nearer) and its storey
 * bands (near). The shape's finish is left as it was.
 */
export function blockShape(sh: Shape, block: Block, levelsAt: LevelsAt, hr: number, detail: BuildDetail): void {
  const before = sh.finish;
  const b = block.body, sides = sidesOf(b), base = block.base;
  const top = base + block.storeys * block.storey, crown = top + H.parapetHigh * hr;
  // The plinth, down into the floor at its lowest.
  const low = Math.min(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => levelsAt(x, y).floor));
  const po = H.plinthOut * hr;
  sh.finish = FINISH.stone;
  upright(sh, b.x0 - po, b.x1 + po, b.y0 - po, b.y1 + po, low - H.bury * hr, base, PLINTH);
  // The walls and what is in them.
  sides.forEach((s, k) => {
    const open = block.openings[k];
    sh.finish = block.finish;
    if (detail === 'far') {
      patch(sh, s, 0, s.length, base, crown, 0, block.col);
      for (const o of open) pane(sh, s, o, H.proud * hr);
    } else {
      wallAround(sh, s, base, crown, open, block.col);
      for (const o of open) {
        if (detail === 'near') setBack(sh, s, o, block.col, block.finish, hr);
        else pane(sh, s, o, 0);
      }
    }
    // The door's steps down to the floor in front of it.
    const door = open.find((o) => o.door);
    if (door) {
      const floorOut = (out: number): number => { const p = onSide(s, (door.u0 + door.u1) / 2, out, 0); return levelsAt(p[0], p[1]).floor; };
      const floor = floorOut(po + H.tread * hr), rise = base - floor;
      if (rise > H.riser * hr * 0.5) {
        const steps = Math.ceil(rise / (H.riser * hr)), shown = detail === 'far' ? Math.min(2, steps) : steps, depth = steps * H.tread * hr;
        sh.finish = FINISH.stone;
        stair(sh, s, door, base, floor, po, depth, shown, Math.min(floor, floorOut(po + depth)) - H.bury * hr);
      }
    }
  });
  // The roof: whole far off; a terrace inside its parapet nearer.
  sh.finish = block.finish;
  const corners = (inset: number, z: number): Vec3[] => [[b.x0 + inset, b.y0 + inset, z], [b.x1 - inset, b.y0 + inset, z], [b.x1 - inset, b.y1 - inset, z], [b.x0 + inset, b.y1 - inset, z]];
  if (detail === 'far') {
    const [p0, p1, p2, p3] = corners(0, crown);
    sh.faceToward(p0, p1, p2, p3, [0, 0, 1], block.col);
  } else {
    const t = H.parapet * hr, outer = corners(0, crown), inner = corners(t, crown), floor = corners(t, top);
    for (let k = 0; k < 4; k++) {
      const m = (k + 1) % 4, mid: Vec3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, top];
      sh.faceToward(outer[k], outer[m], inner[m], inner[k], [0, 0, 1], block.col);
      const c = [(inner[k][0] + inner[m][0]) / 2, (inner[k][1] + inner[m][1]) / 2];
      sh.faceToward(floor[k], floor[m], inner[m], inner[k], [mid[0] - c[0], mid[1] - c[1], 0], block.col);
    }
    sh.faceToward(floor[0], floor[1], floor[2], floor[3], [0, 0, 1], shade(block.col, 0.8));
  }
  // Bands at each storey and under the parapet (near).
  if (detail === 'near') {
    const r = H.band * hr, hb = H.bandHigh * hr;
    for (let k = 1; k <= block.storeys; k++) {
      const z = base + k * block.storey;
      upright(sh, b.x0 - r, b.x1 + r, b.y0 - r, b.y0, z - hb / 2, z + hb / 2, block.col);
      upright(sh, b.x0 - r, b.x1 + r, b.y1, b.y1 + r, z - hb / 2, z + hb / 2, block.col);
      upright(sh, b.x0 - r, b.x0, b.y0, b.y1, z - hb / 2, z + hb / 2, block.col);
      upright(sh, b.x1, b.x1 + r, b.y0, b.y1, z - hb / 2, z + hb / 2, block.col);
    }
  }
  sh.finish = before;
}
