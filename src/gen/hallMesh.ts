/**
 * The hamlets' halls as meshes (gen/halls.ts says which hall each hall bay holds): built in their bay's frame (x along
 * the axis, y around, z the height over the profile) into the bay's shape, for the Understorey's VAULT kind. Each
 * faces the wellhead (`doorToward`), and is built in its district's way (`buildOfStyle`), its timber oiled, its
 * stone the plinths'.
 *
 *   kitchen  an open hall on posts under a flat roof, three long tables with their benches, a hearth at the back
 *            glowing, its hood up through the roof;
 *   bath     a raised pool inside a stone kerb, a low wall round it with a gate toward the wellhead, a bath house behind;
 *   shop     a tall workshop with wide doors lit from within and high windows (a forge's chimney in a makers' district);
 *   stage    a stage and its back wall at the far side, tiers of benches rising toward the wellhead;
 *   minds    a round pavilion on posts, its walls panels of cool light, a shallow roof;
 *   commons  tables and benches about the floor, two stalls under canopies.
 *
 * Every level is the same hall (CLAUDE.md rule 16): the walled parts go through `blockShape`; the rest is the same
 * boxes at every level, the posts rounder nearer. `hallSolid` gives the physics its posts, walls, tables and benches.
 * Sizes are human (`landmarks.handrail`). Pure.
 */
import { deriveSeed, Rng } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { FINISH } from './pavilion';
import { Shape, shade, type RGB } from './shapes';
import { buildOfStyle, doorToward, styleOf, WALK, type Rect } from './homes';
import { builtLook, DOOR, ROOM } from './homeMesh';
import { PLINTH, WALL, blockShape, cornerLevels, sidesOf, upright, wallRun, type BuildDetail, type LevelsAt, type Opening } from './building';
import type { HallKind } from './halls';
import { underOf } from './under';

/** Sizes in handrails. */
const H = {
  /** A storey of a hall; head room left under the vaults' springing. */
  storey: 5, headroom: 2,
  /** An open hall's posts: their radius and spacing; its roof slab's thickness and overhang. */
  post: 0.2, every: 4.5, slab: 0.45, eaves: 0.5,
  /** A table's width, height and top's thickness; a bench's width and height; the gap between table and bench. */
  table: 0.9, tableHigh: 0.68, top: 0.06, bench: 0.35, benchHigh: 0.42, gap: 0.25,
  /** The hearth: its width, depth and height; its glowing mouth; its hood's width. */
  hearth: 4, hearthDeep: 1.6, hearthHigh: 2.2, mouth: 1.6, mouthHigh: 1, hood: 1.4,
  /** The pool's kerb: its height and thickness; the water's depth below its top. */
  kerb: 0.5, kerbWide: 0.4, water: 0.1,
  /** A workshop's doors: width and height; its high windows. */
  shopDoor: 3, shopDoorHigh: 3.6, high: 1.2,
  /** A forge's chimney: its radius and how far it rises over the roof. */
  chimney: 0.5, chimneyHigh: 3,
  /** The stage: its depth, height, its back wall's height; a tier's depth and rise. */
  stageDeep: 6, stageHigh: 1.1, backHigh: 6, tier: 0.9, rise: 0.38,
  /** Steps up onto the stage: their width and tread; the nosing's and coping's lip (near). */
  stepWide: 1.2, tread: 0.3, trim: 0.06,
  /** The minds' pavilion: its posts, their count, its walls' height, its roof's rise. */
  rooms: 10, wallHigh: 3, roofRise: 1.6,
  /** A stall: its size and height. */
  stall: 3, stallHigh: 2.6,
  /** How deep posts and walls go into the floor. */
  bury: 0.3,
} as const;

/** Oiled timber, a canopy's cloth, a minds' panel's cool light, the water (linear). */
const TIMBER: RGB = [0.36, 0.25, 0.16];
const CLOTH: readonly RGB[] = [[0.55, 0.22, 0.16], [0.3, 0.42, 0.5], [0.62, 0.52, 0.28], [0.35, 0.45, 0.3]];
const COOL: RGB = [0.72, 0.86, 1];
const WATER: RGB = [0.12, 0.22, 0.24];
/** A hearth's fire. */
const FIRE: RGB = [1, 0.62, 0.3];

/** How round a post is at each detail. */
const SIDES: Readonly<Record<BuildDetail, number>> = { far: 6, mid: 8, near: 12 };

/** Where a hall stands in its bay and what it faces. */
interface Ground {
  /** The ground it takes (inside the walks beside the pillars), the way to the wellhead (±y), the floor's highest in it. */
  r: Rect;
  toward: -1 | 1;
  base: number;
  /** The most it may rise over its base and still stay under the vaults' springing (with head room). */
  room: number;
  levelsAt: LevelsAt;
  hr: number;
  detail: BuildDetail;
  rng: Rng;
  build: { col: RGB; finish: number };
  makers: boolean;
}

/** A post from the floor at (x, y) up to z. */
function post(sh: Shape, g: Ground, x: number, y: number, z: number, col: RGB): void {
  const f = g.levelsAt(x, y).floor - H.bury * g.hr;
  sh.prism([x, y, f], [1, 0, 0], [0, 1, 0], [0, 0, 1], H.post * g.hr, z - f, SIDES[g.detail], col);
}

/** A table with a bench along each side, along x from x0 to x1 at y, standing on the floor there. */
function table(sh: Shape, g: Ground, x0: number, x1: number, y: number): void {
  const hr = g.hr, f = g.levelsAt((x0 + x1) / 2, y).floor, w = (H.table * hr) / 2;
  sh.finish = FINISH.timber;
  upright(sh, x0, x1, y - w, y + w, f + (H.tableHigh - H.top) * hr, f + H.tableHigh * hr, TIMBER, true);
  // Its trestles, and the benches.
  for (const x of [x0 + 0.4 * hr, x1 - 0.4 * hr]) upright(sh, x - 0.05 * hr, x + 0.05 * hr, y - w * 0.8, y + w * 0.8, f - H.bury * hr, f + (H.tableHigh - H.top) * hr, shade(TIMBER, 0.8));
  for (const s of [-1, 1]) {
    const y0 = y + s * (w + H.gap * hr), y1 = y0 + s * H.bench * hr;
    upright(sh, x0, x1, Math.min(y0, y1), Math.max(y0, y1), f - H.bury * hr, f + H.benchHigh * hr, shade(TIMBER, 0.9));
  }
}

/** A flat roof slab over a rect at z, its eaves out over it. */
function slab(sh: Shape, g: Ground, r: Rect, z: number, col: RGB): void {
  const e = H.eaves * g.hr;
  upright(sh, r.x0 - e, r.x1 + e, r.y0 - e, r.y1 + e, z, z + H.slab * g.hr, col, true);
}

/** The y nearer (`near`) or further from the wellhead across a rect, `inset` in from its edge. */
const sideY = (g: Ground, r: Rect, near: boolean, inset = 0): number => ((g.toward > 0) === near ? r.y1 - inset : r.y0 + inset);

function kitchen(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, high = Math.min(2 * H.storey * hr, g.room - H.slab * hr), z = g.base + high;
  // The posts round it, the roof on them.
  sh.finish = g.build.finish;
  const nx = Math.max(2, Math.round((r.x1 - r.x0) / (H.every * hr))), ny = Math.max(2, Math.round((r.y1 - r.y0) / (H.every * hr)));
  for (let k = 0; k <= nx; k++) for (const y of [r.y0, r.y1]) post(sh, g, r.x0 + ((r.x1 - r.x0) * k) / nx, y, z, g.build.col);
  for (let k = 1; k < ny; k++) for (const x of [r.x0, r.x1]) post(sh, g, x, r.y0 + ((r.y1 - r.y0) * k) / ny, z, g.build.col);
  slab(sh, g, r, z, g.build.col);
  // The hearth at the back, its fire, its hood up through the roof.
  const back = sideY(g, r, false, H.hearthDeep * hr / 2 + 0.6 * hr), mx = (r.x0 + r.x1) / 2, f = g.levelsAt(mx, back).floor;
  const hx = (H.hearth * hr) / 2, hy = (H.hearthDeep * hr) / 2;
  sh.finish = FINISH.stone;
  upright(sh, mx - hx, mx + hx, back - hy, back + hy, f - H.bury * hr, f + H.hearthHigh * hr, PLINTH);
  upright(sh, mx - (H.hood * hr) / 2, mx + (H.hood * hr) / 2, back - hy * 0.6, back + hy * 0.6, f + H.hearthHigh * hr, z + H.slab * hr + 0.6 * hr, shade(PLINTH, 0.9));
  // The fire's mouth on the hearth's face toward the tables.
  const face = g.toward > 0 ? back + hy + 0.01 * hr : back - hy - 0.01 * hr, m = (H.mouth * hr) / 2, mz = f + 0.4 * hr;
  sh.finish = FINISH.lamp;
  sh.faceToward([mx - m, face, mz], [mx + m, face, mz], [mx + m, face, mz + H.mouthHigh * hr], [mx - m, face, mz + H.mouthHigh * hr], [0, g.toward, 0], FIRE);
  // Three long tables between the hearth and the square.
  const y0 = sideY(g, r, true, 2 * hr), y1 = back + (g.toward > 0 ? 1 : -1) * (hy + 2 * hr);
  for (let k = 0; k < 3; k++) table(sh, g, r.x0 + 1.5 * hr, r.x1 - 1.5 * hr, y0 + ((y1 - y0) * (k + 0.5)) / 3);
}

function bath(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, hw = (WALL * hr) / 2, wall = 1.2 * hr, gate = (r.x0 + r.x1) / 2, gw = 1.6 * hr;
  sh.finish = FINISH.stone;
  // The low wall round it, the gate toward the wellhead.
  const front = sideY(g, r, true, hw), back = sideY(g, r, false, hw);
  wallRun(sh, r.x0, front, gate - gw, front, wall, hr, g.levelsAt, PLINTH, g.detail);
  wallRun(sh, gate + gw, front, r.x1, front, wall, hr, g.levelsAt, PLINTH, g.detail);
  for (const x of [r.x0 + hw, r.x1 - hw]) wallRun(sh, x, r.y0 + 2 * hw, x, r.y1 - 2 * hw, wall, hr, g.levelsAt, PLINTH, g.detail);
  // The bath house along the back: one storey, windows lit, its door toward the pool.
  const depth = Math.min(6 * hr, (r.y1 - r.y0) * 0.3), body: Rect = g.toward > 0
    ? { x0: r.x0 + 0.6 * hr, x1: r.x1 - 0.6 * hr, y0: r.y0 + 0.6 * hr, y1: r.y0 + 0.6 * hr + depth }
    : { x0: r.x0 + 0.6 * hr, x1: r.x1 - 0.6 * hr, y0: r.y1 - 0.6 * hr - depth, y1: r.y1 - 0.6 * hr };
  void back;
  walled(sh, g, body, 1, 'windows');
  // The pool, raised in its kerb, between the house and the gate.
  const near = sideY(g, r, true, 3 * hr), far = g.toward > 0 ? body.y1 + 2 * hr : body.y0 - 2 * hr;
  const pool: Rect = { x0: r.x0 + 3 * hr, x1: r.x1 - 3 * hr, y0: Math.min(near, far), y1: Math.max(near, far) };
  const floors = cornerLevels(pool, g.levelsAt).map((l) => l.floor), top = Math.max(...floors) + H.kerb * hr, low = Math.min(...floors) - H.bury * hr;
  const k = H.kerbWide * hr;
  sh.finish = FINISH.stone;
  upright(sh, pool.x0, pool.x1, pool.y0, pool.y0 + k, low, top, PLINTH);
  upright(sh, pool.x0, pool.x1, pool.y1 - k, pool.y1, low, top, PLINTH);
  upright(sh, pool.x0, pool.x0 + k, pool.y0 + k, pool.y1 - k, low, top, PLINTH);
  upright(sh, pool.x1 - k, pool.x1, pool.y0 + k, pool.y1 - k, low, top, PLINTH);
  sh.finish = FINISH.water;
  const w = top - H.water * hr;
  sh.smoothGrid(1, 1, (a, b) => ({ p: [b ? pool.x1 - k : pool.x0 + k, a ? pool.y1 - k : pool.y0 + k, w], n: [0, 0, 1], uv: [b ? pool.x1 - k : pool.x0 + k, a ? pool.y1 - k : pool.y0 + k] }), WATER);
}

/** A walled block of `storeys` on `body`, level on its highest floor: lit windows all round, a door (or a shop's wide doors) toward the wellhead. */
function walled(sh: Shape, g: Ground, body: Rect, storeys: number, kind: 'windows' | 'shop'): { crown: number } {
  const hr = g.hr, storey = H.storey * hr * (kind === 'shop' ? 1.3 : 1);
  const base = Math.max(...cornerLevels(body, g.levelsAt).map((l) => l.floor));
  const front = g.toward > 0 ? 1 : 0;
  const openings = sidesOf(body).map((s, k): Opening[] => {
    const out: Opening[] = [];
    if (kind === 'shop' && k === front) {
      // Two wide doors, the shop's light through them.
      for (const c of [s.length / 3, (2 * s.length) / 3]) out.push({ u0: c - (H.shopDoor * hr) / 2, u1: c + (H.shopDoor * hr) / 2, z0: base, z1: base + H.shopDoorHigh * hr, col: ROOM, finish: FINISH.window, door: false });
      return out;
    }
    const n = Math.max(1, Math.floor(s.length / (2.8 * hr)));
    for (let f = 0; f < storeys; f++) for (let m = 0; m < n; m++) {
      const c = (s.length * (m + 0.5)) / n, z = base + f * storey;
      if (k === front && f === 0 && m === Math.floor(n / 2)) { out.push({ u0: c - 0.6 * hr, u1: c + 0.6 * hr, z0: z, z1: z + 2.5 * hr, col: DOOR, finish: FINISH.timber, door: true }); continue; }
      const z0 = kind === 'shop' ? z + storey - (H.high + 0.6) * hr : z + 0.9 * hr, z1 = kind === 'shop' ? z + storey - 0.6 * hr : z + 3.2 * hr;
      out.push({ u0: c - 0.55 * hr, u1: c + 0.55 * hr, z0, z1, col: shade(ROOM, g.rng.range(0.75, 1.05)), finish: FINISH.window, door: false });
    }
    return out;
  });
  blockShape(sh, { body, base, storeys, storey, col: g.build.col, finish: g.build.finish, openings }, g.levelsAt, hr, g.detail);
  return { crown: base + storeys * storey + hr };
}

function shop(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, inset = 0.8 * hr;
  const body: Rect = { x0: r.x0 + inset, x1: r.x1 - inset, y0: r.y0 + inset + (g.toward > 0 ? 0 : 3 * hr), y1: r.y1 - inset - (g.toward > 0 ? 3 * hr : 0) };
  const { crown } = walled(sh, g, body, 1, 'shop');
  if (!g.makers) return;
  // The forge's chimney, at the back.
  sh.finish = FINISH.brick;
  const x = body.x1 - 2 * hr, y = sideY(g, body, false, 1.5 * hr);
  sh.prism([x, y, crown - hr], [1, 0, 0], [0, 1, 0], [0, 0, 1], H.chimney * hr, H.chimneyHigh * hr + hr, SIDES[g.detail], [0.4, 0.2, 0.14]);
}

function stage(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, mx = (r.x0 + r.x1) / 2, half = (r.x1 - r.x0) * 0.35;
  // The stage and its back wall at the far side.
  const s0 = sideY(g, r, false), s1 = s0 + (g.toward > 0 ? 1 : -1) * H.stageDeep * hr;
  const f = Math.max(g.levelsAt(mx - half, s0).floor, g.levelsAt(mx + half, s0).floor, g.levelsAt(mx, s1).floor);
  sh.finish = FINISH.timber;
  upright(sh, mx - half, mx + half, Math.min(s0, s1), Math.max(s0, s1), f - H.bury * hr, f + H.stageHigh * hr, TIMBER);
  sh.finish = g.build.finish;
  const wb = s0 + (g.toward > 0 ? -1 : 1) * 0.4 * hr;
  const back = f + Math.min(H.backHigh * hr, g.room);
  upright(sh, mx - half - hr, mx + half + hr, Math.min(s0, wb), Math.max(s0, wb), f - H.bury * hr, back, g.build.col);
  const out = g.toward > 0 ? 1 : -1;
  if (g.detail !== 'far') {
    // Steps up onto the stage at both ends of its front.
    sh.finish = FINISH.timber;
    const n = Math.max(2, Math.round(H.stageHigh / H.rise)), w = (H.stepWide * hr) / 2;
    for (const x of [mx - half + w + 0.4 * hr, mx + half - w - 0.4 * hr]) for (let k = 0; k < n; k++) {
      const a = s1 + out * (n - 1 - k) * H.tread * hr, b = a + out * H.tread * hr;
      upright(sh, x - w, x + w, Math.min(a, b), Math.max(a, b), g.levelsAt(x, b).floor - H.bury * hr, f + ((k + 1) / n) * H.stageHigh * hr - 0.02 * hr, shade(TIMBER, 0.9));
    }
  }
  if (g.detail === 'near') {
    // The stage's nosing along its front, the back wall's coping.
    const e = H.trim * hr;
    upright(sh, mx - half - e, mx + half + e, Math.min(s1 - out * e, s1 + out * e), Math.max(s1 - out * e, s1 + out * e), f + (H.stageHigh - 0.12) * hr, f + H.stageHigh * hr + e, shade(TIMBER, 0.75), true);
    sh.finish = g.build.finish;
    upright(sh, mx - half - hr - e, mx + half + hr + e, Math.min(s0, wb) - e, Math.max(s0, wb) + e, back, back + 0.15 * hr, shade(g.build.col, 0.85), true);
  }
  // Tiers of benches rising toward the wellhead.
  sh.finish = FINISH.stone;
  const from = s1 + out * 3 * hr, to = sideY(g, r, true), rows = Math.max(1, Math.floor(Math.abs(to - from) / (H.tier * hr)));
  for (let k = 0; k < rows; k++) {
    const a = from + (to - from) * (k / rows), b = from + (to - from) * ((k + 1) / rows), w = half * (1 + (0.4 * k) / rows);
    const fl = Math.min(g.levelsAt(mx - w, a).floor, g.levelsAt(mx + w, b).floor);
    upright(sh, mx - w, mx + w, Math.min(a, b), Math.max(a, b), fl - H.bury * hr, f + (H.benchHigh + k * H.rise) * hr, shade(PLINTH, 1 - 0.02 * (k % 2)));
  }
}

function minds(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, R = Math.min(r.x1 - r.x0, r.y1 - r.y0) * 0.32;
  const n = H.rooms, high = Math.min(H.storey * hr, g.room), z = g.base + high;
  // Its posts round, and between them its walls: panels of light over a low base.
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, b = ((k + 1) / n) * 2 * Math.PI;
    sh.finish = FINISH.timber;
    post(sh, g, cx + R * Math.cos(a), cy + R * Math.sin(a), z, TIMBER);
    const rimAt = (t: number, zz: number): [number, number, number] => [cx + R * Math.cos(t), cy + R * Math.sin(t), zz];
    const out: [number, number, number] = [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0], f = g.base;
    sh.finish = g.build.finish;
    sh.faceToward(rimAt(a, f - H.bury * hr), rimAt(b, f - H.bury * hr), rimAt(b, f + 0.8 * hr), rimAt(a, f + 0.8 * hr), out, g.build.col);
    sh.finish = FINISH.window;
    sh.smoothGrid(1, 1, (u, v) => ({ p: rimAt(v ? b : a, f + (u ? H.wallHigh : 0.8) * hr), n: out, uv: [v, u] }), COOL);
  }
  // Its shallow roof: a ring over the posts, rising to its middle.
  const roof = new Shape(SIDES[g.detail] * 2, true, true);
  roof.finish = g.build.finish;
  const seg = SIDES[g.detail] * 2;
  const rim = R + H.eaves * hr, rise = H.roofRise * hr, l = Math.hypot(rim, rise);
  roof.arc(z, 0, z, rim, -1, 0, 0, 2 * Math.PI, seg, shade(g.build.col, 0.85));
  roof.arc(z, rim, z + rise, 0, rim / l, rise / l, 0, 2 * Math.PI, seg, g.build.col);
  sh.append(roof, [1, 0, 0], [0, 1, 0], [0, 0, 1], [cx, cy, 0]);
}

function commons(sh: Shape, g: Ground): void {
  const hr = g.hr, r = g.r, rng = g.rng;
  // Tables in a loose grid, each a little turned out of line.
  const cols = 2, rows = 3, cw = (r.x1 - r.x0) / cols, rh = (r.y1 - r.y0) / rows;
  for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
    if (a === 1 && b === 1) continue;
    const x = r.x0 + cw * (a + 0.5) + rng.range(-0.15, 0.15) * cw, y = r.y0 + rh * (b + 0.5) + rng.range(-0.15, 0.15) * rh, l = rng.range(0.3, 0.45) * cw;
    table(sh, g, x - l, x + l, y);
  }
  // Two stalls under canopies.
  for (const [fx, fy] of [[0.25, 0.5], [0.75, 0.5]] as const) {
    const x = r.x0 + (r.x1 - r.x0) * fx, y = r.y0 + (r.y1 - r.y0) * fy, s = (H.stall * hr) / 2, f = g.levelsAt(x, y).floor, top = f + H.stallHigh * hr;
    sh.finish = FINISH.timber;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) upright(sh, x + dx * s - 0.06 * hr, x + dx * s + 0.06 * hr, y + dy * s - 0.06 * hr, y + dy * s + 0.06 * hr, g.levelsAt(x + dx * s, y + dy * s).floor - H.bury * hr, top, TIMBER);
    upright(sh, x - s, x + s, y - s * 0.5, y + s * 0.5, f - H.bury * hr, f + 0.9 * hr, TIMBER);
    // Its goods on the counter (drawn at every level, built from mid on, so every level is the same stall).
    const goods = [0, 1, 2].map((k) => ({ x: x + s * (k - 1) * 0.6, w: rng.range(0.2, 0.35) * hr, high: rng.range(0.2, 0.45) * hr, col: shade(rng.pick(CLOTH), rng.range(0.7, 1)) }));
    if (g.detail !== 'far') for (const o of goods) upright(sh, o.x - o.w, o.x + o.w, y - o.w, y + o.w, f + 0.9 * hr, f + 0.9 * hr + o.high, o.col, true);
    sh.finish = FINISH.plaster;
    const cloth = rng.pick(CLOTH), c = s + 0.2 * hr;
    upright(sh, x - c, x + c, y - c, y + c, top, top + 0.08 * hr, cloth, true);
    // Near: the canopy's valance hanging round its edge.
    if (g.detail === 'near') for (const [x0, x1, y0, y1] of [[x - c, x + c, y - c, y - c + 0.03 * hr], [x - c, x + c, y + c - 0.03 * hr, y + c], [x - c, x - c + 0.03 * hr, y - c, y + c], [x + c - 0.03 * hr, x + c, y - c, y + c]]) {
      upright(sh, x0, x1, y0, y1, top - 0.3 * hr, top, shade(cloth, 0.9), true);
    }
  }
}

const DRAW: Readonly<Record<HallKind, (sh: Shape, g: Ground) => void>> = { kitchen, bath, shop, stage, minds, commons };

/**
 * Hall `kind` in bay (i, j) into the bay's shape (its frame `along` × `around`, the pillars' plinths reaching `plinth`
 * into it), at a detail; `levelsAt` the bay's levels anywhere. The shape's finish is left as it was.
 */
export function hallShape(sh: Shape, h: Habitat, kind: HallKind, i: number, j: number, along: number, around: number, plinth: number, levelsAt: LevelsAt, detail: BuildDetail): void {
  const u = underOf(h), m = u.hamletOf(i, j), hr = h.params.landmarks?.handrail;
  if (!m || !hr) return;
  const clear = plinth + WALK * hr, r: Rect = { x0: clear, x1: along - clear, y0: clear, y1: around - clear };
  const corners = cornerLevels(r, levelsAt);
  const base = Math.max(...corners.map((l) => l.floor)), room = Math.min(...corners.map((l) => l.springing)) - base - H.headroom * hr;
  const rng = new Rng(deriveSeed(h.seed, 'under', 'hall', i, j)), style = styleOf(h, m);
  const before = sh.finish;
  DRAW[kind](sh, { r, toward: doorToward(u, m, i), base, room, levelsAt, hr, detail, rng, build: builtLook(buildOfStyle(style), rng), makers: style === 'makers' });
  sh.finish = before;
}

/** A hall's solid parts into a bay's shape, for the physics: as drawn far off. */
export function hallSolid(sh: Shape, h: Habitat, kind: HallKind, i: number, j: number, along: number, around: number, plinth: number, levelsAt: LevelsAt): void {
  hallShape(sh, h, kind, i, j, along, around, plinth, levelsAt, 'far');
}
