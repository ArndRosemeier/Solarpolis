/**
 * The hamlets' houses as meshes (gen/homes.ts lays them out): built in their bay's frame (x along the axis, y around,
 * z the height over the profile), into the bay's shape, for the Understorey's VAULT kind.
 *
 * A house stands level on a stone plinth: its walls of its build (`FINISH`: cast stone, panels, brick, pale stone,
 * plaster, rammed earth, timber), its windows in a rhythm on every side, one door toward the wellhead with steps down
 * to its yard where the floor falls away, a parapet round its roof terrace. A walled yard lies in front, the gate in
 * line with the door. A lived-in house's windows glow with its rooms' light (`FINISH.window`, the vertex colour the
 * light: some rooms lit, some not); an empty one's are dark.
 *
 * Every level is the same house (CLAUDE.md rule 16: the same size, colour and outline): far draws its walls whole with
 * the windows and door just proud of them, mid opens the walls round them and gives the roof its terrace and the walls
 * their steps, near sets the windows back in their reveals with sills, bands the storeys and copes the yard walls.
 * Sizes are human (`landmarks.handrail`). Pure.
 */
import { Rng } from '@futuremagic/core';
import { FINISH } from './pavilion';
import { along, shade, type RGB, type Shape } from './shapes';
import type { Build, House } from './homes';
import { PARAPET, YARD_WALL } from './homes';
import type { Levels } from './underLevels';
import type { Vec3 } from '../blueprint';

export type HouseDetail = 'far' | 'mid' | 'near';

/** Each build's colour (linear albedo) and finish; plaster comes in the district's washes. */
const BUILT: Readonly<Record<Build, { col: readonly RGB[]; finish: number }>> = {
  cast: { col: [[0.52, 0.5, 0.46]], finish: FINISH.stone },
  panel: { col: [[0.66, 0.66, 0.64], [0.6, 0.62, 0.63]], finish: FINISH.panel },
  brick: { col: [[0.42, 0.2, 0.13], [0.38, 0.22, 0.16], [0.46, 0.26, 0.17]], finish: FINISH.brick },
  stone: { col: [[0.62, 0.58, 0.5], [0.66, 0.63, 0.56]], finish: FINISH.stone },
  plaster: { col: [[0.78, 0.72, 0.6], [0.75, 0.62, 0.5], [0.72, 0.66, 0.62], [0.68, 0.7, 0.62], [0.8, 0.78, 0.72]], finish: FINISH.plaster },
  earth: { col: [[0.5, 0.36, 0.24], [0.56, 0.42, 0.3]], finish: FINISH.earth },
  timber: { col: [[0.42, 0.3, 0.2], [0.36, 0.26, 0.17]], finish: FINISH.timber },
};
/** How far a house's colour strays from its build's (±, a share). */
const TINT = 0.06;
/** The plinth, the doors (oiled wood) and a lit room's light through its window, and an unlit or empty one's dark glass. */
const PLINTH: RGB = [0.46, 0.44, 0.4];
const DOOR: RGB = [0.28, 0.18, 0.11];
const ROOM: RGB = [1, 0.74, 0.46];
const DARK: RGB = [0.05, 0.05, 0.055];
/** Of a lived-in house's windows, the share lit. */
const LIT = 0.7;

/** Sizes in handrails. */
const H = {
  /** Window rhythm along a wall, a window's width and height, its sill over the storey's floor. */
  rhythm: 2.6, window: 1.1, windowHigh: 2.2, sill: 0.9,
  /** The door's width and height. */
  door: 1.2, doorHigh: 2.5,
  /** The plinth's step out from the walls and how deep it goes in; the parapet's thickness. */
  plinthOut: 0.15, bury: 0.3, parapet: 0.3,
  /** A window's reveal, its sill's reach and depth (near). */
  reveal: 0.22, sillOut: 0.08, sillHigh: 0.07,
  /** Far: how far the windows stand proud of the wall (no hole cut). */
  proud: 0.03,
  /** A storey band's reach and height (near). */
  band: 0.08, bandHigh: 0.16,
  /** A stair's riser and tread. */
  riser: 0.16, tread: 0.28,
  /** The yard wall's thickness, its stepped runs' longest piece (far, else), the gate, the gate piers, the coping (near). */
  wall: 0.3, run: 12, step: 6, gate: 1.6, pier: 0.25, pierHigh: 0.3, coping: 0.06, copingHigh: 0.07,
} as const;

/** A window or a door in a wall: along it from its start (m), from … to in height (absolute), its colour and finish. */
interface Opening {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  col: RGB;
  finish: number;
  door: boolean;
}

/** One of a house's four walls: its start, the way it runs, the way it faces, its length. */
interface Side {
  o: [number, number];
  t: [number, number];
  n: [number, number];
  length: number;
  door: boolean;
}

function sidesOf(house: House): Side[] {
  const b = house.body, dx = b.x1 - b.x0, dy = b.y1 - b.y0;
  return [
    { o: [b.x0, b.y0], t: [1, 0], n: [0, -1], length: dx, door: house.door < 0 },
    { o: [b.x0, b.y1], t: [1, 0], n: [0, 1], length: dx, door: house.door > 0 },
    { o: [b.x0, b.y0], t: [0, 1], n: [-1, 0], length: dy, door: false },
    { o: [b.x1, b.y0], t: [0, 1], n: [1, 0], length: dy, door: false },
  ];
}

/** A point on a side: `u` along it, `out` out from it, at height z. */
const UP: Vec3 = [0, 0, 1];
const onSide = (s: Side, u: number, out: number, z: number): Vec3 => along([s.o[0], s.o[1], 0], [s.t[0], s.t[1], 0], u, [s.n[0], s.n[1], 0], out, UP, z);

/** Its walls' colour and finish, and its windows and door per side (the same at every level: drawn from its seed). */
function looksOf(house: House, hr: number): { col: RGB; finish: number; openings: Opening[][] } {
  const rng = new Rng(house.seed), built = BUILT[house.build];
  const col = shade(rng.pick(built.col), 1 + rng.range(-TINT, TINT));
  const openings = sidesOf(house).map((s) => {
    const n = Math.max(1, Math.floor(s.length / (H.rhythm * hr))), out: Opening[] = [];
    const w = Math.min(H.window * hr, (0.55 * s.length) / n), door = Math.floor(n / 2);
    for (let k = 0; k < house.storeys; k++) {
      const f = house.base + k * house.storey;
      for (let m = 0; m < n; m++) {
        const c = (s.length * (m + 0.5)) / n;
        if (s.door && k === 0 && m === door) {
          const dw = Math.min(H.door * hr, 0.8 * s.length / n);
          out.push({ u0: c - dw / 2, u1: c + dw / 2, z0: f, z1: f + Math.min(H.doorHigh * hr, house.storey - 0.5 * hr), col: DOOR, finish: FINISH.timber, door: true });
          continue;
        }
        const lit = house.lived && rng.chance(LIT);
        out.push({
          u0: c - w / 2, u1: c + w / 2, z0: f + H.sill * hr, z1: f + Math.min((H.sill + H.windowHigh) * hr, house.storey - 0.4 * hr),
          col: lit ? shade(ROOM, rng.range(0.7, 1.1)) : DARK, finish: FINISH.window, door: false,
        });
      }
    }
    return out;
  });
  return { col, finish: built.finish, openings };
}

/** An upright box (open underneath) from its extents in the bay's frame. */
function upright(sh: Shape, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB): void {
  sh.block([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], col, true);
}

/** A flat piece of a side, u0 … u1 along it, z0 … z1, `out` out from it, facing `facing` (its normal in the plane). */
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

/** A yard wall's run from (x0, y0) to (x1, y1) (its middle line), stepping with the floor, `pieces` of it. */
function wallRun(sh: Shape, x0: number, y0: number, x1: number, y1: number, pieces: number, hr: number, levelsAt: (x: number, y: number) => Levels, col: RGB, coped: boolean): void {
  const half = (H.wall * hr) / 2, along = x0 === x1 ? 'y' : 'x';
  for (let k = 0; k < pieces; k++) {
    const a = k / pieces, b = (k + 1) / pieces;
    const ax = x0 + (x1 - x0) * a, ay = y0 + (y1 - y0) * a, bx = x0 + (x1 - x0) * b, by = y0 + (y1 - y0) * b;
    const fa = levelsAt(ax, ay).floor, fb = levelsAt(bx, by).floor, top = levelsAt((ax + bx) / 2, (ay + by) / 2).floor + YARD_WALL * hr;
    const bottom = Math.min(fa, fb) - H.bury * hr;
    const [lx0, lx1, ly0, ly1] = along === 'x' ? [Math.min(ax, bx), Math.max(ax, bx), ay - half, ay + half] : [ax - half, ax + half, Math.min(ay, by), Math.max(ay, by)];
    upright(sh, lx0, lx1, ly0, ly1, bottom, top, col);
    if (coped) {
      const c = H.coping * hr, [cx0, cx1, cy0, cy1] = along === 'x' ? [lx0, lx1, ly0 - c, ly1 + c] : [lx0 - c, lx1 + c, ly0, ly1];
      upright(sh, cx0, cx1, cy0, cy1, top, top + H.copingHigh * hr, shade(col, 0.85));
    }
  }
}

/** Its yard's walls round the plot, the gate (`gate`, along x) in the wall on the door's side. */
function yardWalls(sh: Shape, house: House, hr: number, levelsAt: (x: number, y: number) => Levels, col: RGB, gate: number, detail: HouseDetail): void {
  const p = house.plot, half = (H.wall * hr) / 2, g = (H.gate * hr) / 2, coped = detail === 'near';
  const pieces = (len: number): number => Math.max(1, Math.ceil(len / ((detail === 'far' ? H.run : H.step) * hr)));
  const front = house.door > 0 ? p.y1 - half : p.y0 + half, back = house.door > 0 ? p.y0 + half : p.y1 - half;
  // The runs either side of the gate end inside its piers.
  const pier = g + H.pier * hr;
  wallRun(sh, p.x0, front, gate - pier, front, pieces(gate - pier - p.x0), hr, levelsAt, col, coped);
  wallRun(sh, gate + pier, front, p.x1, front, pieces(p.x1 - gate - pier), hr, levelsAt, col, coped);
  wallRun(sh, p.x0, back, p.x1, back, pieces(p.x1 - p.x0), hr, levelsAt, col, coped);
  for (const x of [p.x0 + half, p.x1 - half]) wallRun(sh, x, p.y0 + 2 * half, x, p.y1 - 2 * half, pieces(p.y1 - p.y0), hr, levelsAt, col, coped);
  // The gate's piers.
  const w = (H.wall / 2 + H.pier) * hr, top = levelsAt(gate, front).floor + (YARD_WALL + H.pierHigh) * hr, bottom = levelsAt(gate, front).floor - H.bury * hr;
  for (const x of [gate - g - H.pier * hr, gate + g + H.pier * hr]) upright(sh, x - H.pier * hr, x + H.pier * hr, front - w, front + w, bottom, top, col);
}

/**
 * One house into a bay's shape (its frame), at a detail; `levelsAt` the bay's levelsAt anywhere, `hr` the handrail. The
 * shape's finish is left as it was.
 */
export function houseShape(sh: Shape, house: House, levelsAt: (x: number, y: number) => Levels, hr: number, detail: HouseDetail): void {
  const before = sh.finish, b = house.body, look = looksOf(house, hr), sides = sidesOf(house);
  const top = house.base + house.storeys * house.storey, crown = top + PARAPET * hr;
  // The plinth, down into the floor at its lowest.
  const low = Math.min(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => levelsAt(x, y).floor));
  const po = H.plinthOut * hr;
  sh.finish = FINISH.stone;
  upright(sh, b.x0 - po, b.x1 + po, b.y0 - po, b.y1 + po, low - H.bury * hr, house.base, PLINTH);
  // The walls and what is in them.
  sides.forEach((s, k) => {
    const open = look.openings[k];
    sh.finish = look.finish;
    if (detail === 'far') {
      patch(sh, s, 0, s.length, house.base, crown, 0, look.col);
      for (const o of open) pane(sh, s, o, H.proud * hr);
    } else {
      wallAround(sh, s, house.base, crown, open, look.col);
      for (const o of open) {
        if (detail === 'near') setBack(sh, s, o, look.col, look.finish, hr);
        else pane(sh, s, o, 0);
      }
    }
    // The door's steps down to the floor in front of it.
    const door = open.find((o) => o.door);
    if (door) {
      const floorOut = (out: number): number => { const p = onSide(s, (door.u0 + door.u1) / 2, out, 0); return levelsAt(p[0], p[1]).floor; };
      const floor = floorOut(po + H.tread * hr), rise = house.base - floor;
      if (rise > H.riser * hr * 0.5) {
        const steps = Math.ceil(rise / (H.riser * hr)), shown = detail === 'far' ? Math.min(2, steps) : steps, depth = steps * H.tread * hr;
        sh.finish = FINISH.stone;
        stair(sh, s, door, house.base, floor, po, depth, shown, Math.min(floor, floorOut(po + depth)) - H.bury * hr);
      }
    }
  });
  // The roof: whole far off; a terrace inside its parapet nearer.
  sh.finish = look.finish;
  const corners = (inset: number, z: number): Vec3[] => [[b.x0 + inset, b.y0 + inset, z], [b.x1 - inset, b.y0 + inset, z], [b.x1 - inset, b.y1 - inset, z], [b.x0 + inset, b.y1 - inset, z]];
  if (detail === 'far') {
    const [p0, p1, p2, p3] = corners(0, crown);
    sh.faceToward(p0, p1, p2, p3, [0, 0, 1], look.col);
  } else {
    const t = H.parapet * hr, outer = corners(0, crown), inner = corners(t, crown), floor = corners(t, top);
    for (let k = 0; k < 4; k++) {
      const m = (k + 1) % 4, mid: Vec3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, top];
      sh.faceToward(outer[k], outer[m], inner[m], inner[k], [0, 0, 1], look.col);
      const c = [(inner[k][0] + inner[m][0]) / 2, (inner[k][1] + inner[m][1]) / 2];
      sh.faceToward(floor[k], floor[m], inner[m], inner[k], [mid[0] - c[0], mid[1] - c[1], 0], look.col);
    }
    sh.faceToward(floor[0], floor[1], floor[2], floor[3], [0, 0, 1], shade(look.col, 0.8));
  }
  // Bands at each storey and under the parapet (near).
  if (detail === 'near') {
    const r = H.band * hr, hb = H.bandHigh * hr;
    for (let k = 1; k <= house.storeys; k++) {
      const z = house.base + k * house.storey;
      upright(sh, b.x0 - r, b.x1 + r, b.y0 - r, b.y0, z - hb / 2, z + hb / 2, look.col);
      upright(sh, b.x0 - r, b.x1 + r, b.y1, b.y1 + r, z - hb / 2, z + hb / 2, look.col);
      upright(sh, b.x0 - r, b.x0, b.y0, b.y1, z - hb / 2, z + hb / 2, look.col);
      upright(sh, b.x1, b.x1 + r, b.y0, b.y1, z - hb / 2, z + hb / 2, look.col);
    }
  }
  // The yard's walls, the gate in line with the door.
  const front = sides.findIndex((s) => s.door), door = look.openings[front]?.find((o) => o.door);
  sh.finish = look.finish;
  yardWalls(sh, house, hr, levelsAt, shade(look.col, 0.92), b.x0 + (door ? (door.u0 + door.u1) / 2 : (b.x1 - b.x0) / 2), detail);
  sh.finish = before;
}

/** One house's solid parts into a bay's shape (its frame), for the physics: the house and its plinth, the yard's walls, the steps. */
export function houseSolid(sh: Shape, house: House, levelsAt: (x: number, y: number) => Levels, hr: number): void {
  houseShape(sh, house, levelsAt, hr, 'far');
}
