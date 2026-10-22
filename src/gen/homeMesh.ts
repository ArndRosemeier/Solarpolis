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
 * The house is a walled block (gen/building.ts `blockShape`, which keeps every level the same house) and its yard's
 * walls `wallRun`s. Sizes are human (`landmarks.handrail`). Pure.
 */
import { Rng } from '@futuremagic/core';
import { FINISH } from './pavilion';
import { shade, type RGB, type Shape } from './shapes';
import { YARD_WALL, type Build, type House } from './homes';
import { WALL, blockShape, sidesOf, upright, wallRun, type Block, type BuildDetail, type LevelsAt, type Opening } from './building';

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
/** A wall's colour (one of its build's, tinted) and finish, drawn from `rng`. */
export function builtLook(build: Build, rng: Rng): { col: RGB; finish: number } {
  const b = BUILT[build];
  return { col: shade(rng.pick(b.col), 1 + rng.range(-TINT, TINT)), finish: b.finish };
}
/** The doors (oiled wood), a lit room's light through its window, and an unlit or empty one's dark glass. */
export const DOOR: RGB = [0.28, 0.18, 0.11];
export const ROOM: RGB = [1, 0.74, 0.46];
const DARK: RGB = [0.05, 0.05, 0.055];
/** Of a lived-in house's windows, the share lit. */
const LIT = 0.7;

/** Sizes in handrails. */
const H = {
  /** Window rhythm along a wall, a window's width and height, its sill over the storey's floor. */
  rhythm: 2.6, window: 1.1, windowHigh: 2.2, sill: 0.9,
  /** The door's width and height. */
  door: 1.2, doorHigh: 2.5,
  /** The yard's gate, the gate's piers and how much higher than the wall they stand, how deep they go in. */
  gate: 1.6, pier: 0.25, pierHigh: 0.3, bury: 0.3,
} as const;

/** The house as a block: its walls' colour and finish, its windows and door per side (the same at every level: drawn from its seed). */
function blockOf(house: House, hr: number): Block {
  const rng = new Rng(house.seed), { col, finish } = builtLook(house.build, rng);
  const doorSide = house.door < 0 ? 0 : 1;
  const openings = sidesOf(house.body).map((s, side) => {
    const n = Math.max(1, Math.floor(s.length / (H.rhythm * hr))), out: Opening[] = [];
    const w = Math.min(H.window * hr, (0.55 * s.length) / n), door = Math.floor(n / 2);
    for (let k = 0; k < house.storeys; k++) {
      const f = house.base + k * house.storey;
      for (let m = 0; m < n; m++) {
        const c = (s.length * (m + 0.5)) / n;
        if (side === doorSide && k === 0 && m === door) {
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
  return { body: house.body, base: house.base, storeys: house.storeys, storey: house.storey, col, finish, openings };
}

/** Its yard's walls round the plot, the gate (`gate`, along x) in the wall on the door's side. */
function yardWalls(sh: Shape, house: House, hr: number, levelsAt: LevelsAt, col: RGB, gate: number, detail: BuildDetail): void {
  const p = house.plot, half = (WALL * hr) / 2, g = (H.gate * hr) / 2, high = YARD_WALL * hr;
  const front = house.door > 0 ? p.y1 - half : p.y0 + half, back = house.door > 0 ? p.y0 + half : p.y1 - half;
  // The runs either side of the gate end inside its piers.
  const pier = g + H.pier * hr;
  wallRun(sh, p.x0, front, gate - pier, front, high, hr, levelsAt, col, detail);
  wallRun(sh, gate + pier, front, p.x1, front, high, hr, levelsAt, col, detail);
  wallRun(sh, p.x0, back, p.x1, back, high, hr, levelsAt, col, detail);
  for (const x of [p.x0 + half, p.x1 - half]) wallRun(sh, x, p.y0 + 2 * half, x, p.y1 - 2 * half, high, hr, levelsAt, col, detail);
  // The gate's piers.
  const w = (WALL / 2 + H.pier) * hr, top = levelsAt(gate, front).floor + (YARD_WALL + H.pierHigh) * hr, bottom = levelsAt(gate, front).floor - H.bury * hr;
  for (const x of [gate - g - H.pier * hr, gate + g + H.pier * hr]) upright(sh, x - H.pier * hr, x + H.pier * hr, front - w, front + w, bottom, top, col);
}

/**
 * One house into a bay's shape (its frame), at a detail; `levelsAt` the bay's levels anywhere, `hr` the handrail. The
 * shape's finish is left as it was.
 */
export function houseShape(sh: Shape, house: House, levelsAt: LevelsAt, hr: number, detail: BuildDetail): void {
  const before = sh.finish, block = blockOf(house, hr);
  blockShape(sh, block, levelsAt, hr, detail);
  // The yard's walls, the gate in line with the door.
  const door = block.openings[house.door < 0 ? 0 : 1].find((o) => o.door), b = house.body;
  sh.finish = block.finish;
  yardWalls(sh, house, hr, levelsAt, shade(block.col, 0.92), b.x0 + (door ? (door.u0 + door.u1) / 2 : (b.x1 - b.x0) / 2), detail);
  sh.finish = before;
}

/** One house's solid parts into a bay's shape (its frame), for the physics: the house and its plinth, the yard's walls, the steps. */
export function houseSolid(sh: Shape, house: House, levelsAt: LevelsAt, hr: number): void {
  houseShape(sh, house, levelsAt, hr, 'far');
}
