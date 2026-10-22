/**
 * The Understorey's structure as meshes (design "The Understorey: life below the land", 2026-10-22): the pillar forest
 * every place below is made of. Each bay of the plan's grid (gen/under.ts) at the levels the land sets
 * (gen/underLevels.ts):
 *
 * - a paved floor;
 * - a pillar at its corner, cast stone: a square plinth, a round shaft (a moulded base up close), a bronze lamp ring
 *   under the capital, the capital flaring out to where the vault springs;
 * - the fan vault: from each of its four pillars a quarter of a conoid, its horizontal sections circles, rising from
 *   the capital (upright there) to the ceiling (level there) at half a bay out, ribs along it and a ring rib round its
 *   top up close; between the four, the flat spandrel at the ceiling;
 * - at the floor's two ends, a wall from floor to ceiling.
 *
 * The lamps light it: each ring throws most of its light up into the vaults, the rest all round (`glow`, baked per
 * vertex, as the light at each point relative to the floor in the middle of a level bay, through the mist below,
 * `under.mist`). The VAULT kind (render/materials.ts) draws it.
 *
 * Tiles over the grid (`underGridOf`, gen/detailTree.ts) stream in around the eye while it is below the land
 * (`underTilesFor`), far, mid and near detail by a tile's size, every level the same size and light, so they hand over
 * without a step. `underSolid` gives the physics the floors, pillars and end walls near a point. Pure.
 */
import { v3cross, v3dot, v3madd, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, toWorld, wrapAngle, type Habitat } from '../blueprint';
import { kept, keptEach } from './kept';
import { wantedCells, type Grid, type TileKey, type WantedTile } from './detailTree';
import { FINISH } from './pavilion';
import { Shape, bendInto, outOfPlace, placeAt, type FloorFrame, type MappedArrays, type Place, type RGB } from './shapes';
import type { Terrain } from './terrain';
import { levelsOf, type Levels, type UnderLevels } from './underLevels';
import { courtLayoutOf, lightWellOf } from './courts';
import { underOf, type Under } from './under';
import { skyOverBay } from './skies';

export type UnderDetail = 'far' | 'mid' | 'near';

/** A tile of the Understorey: its key, the frame its mesh is in, the mesh, and the lamps' light at each vertex. */
export interface UnderTile {
  key: TileKey;
  origin: Place;
  mesh: MappedArrays;
  /** Two numbers a vertex: the lamps' light (1 on the floor mid-bay under level land), and the day's light down a well (a share of the day's on the land). */
  glow: Float32Array;
}

/** The pillar's parts, in pillar radii. */
const PILLAR = {
  /** The plinth's half side, its height over the floor, how deep it goes in. */
  plinth: 1.35, plinthHigh: 0.55, bury: 0.6,
  /** The moulded base on the plinth (up close): its radius and height. */
  torus: 1.14, torusHigh: 0.28,
  /** The capital: where it springs into the vault (its radius) and its height; the necking ring at its foot (up close). */
  capital: 1.3, capitalHigh: 0.9, neck: 1.08, neckHigh: 0.12,
  /** The lamp ring: its outer radius, its height, the gap between it and the capital. */
  lamp: 1.45, lampHigh: 0.22, lampBelow: 0.3,
  /** The vault's ribs up close: width and depth; the ring rib round a conoid's top. */
  rib: 0.24, ribDeep: 0.12, ring: 0.4, ringDeep: 0.16,
};

/** What each detail draws: shaft sides, segments of a quarter circle, rows up a conoid, ribs a quarter, floor cells a side, spandrel rings, mouldings. */
const DETAIL: Readonly<Record<UnderDetail, { shaft: number; arc: number; rows: number; ribs: number; floor: number; rings: number; moulded: boolean }>> = {
  near: { shaft: 24, arc: 8, rows: 8, ribs: 4, floor: 8, rings: 4, moulded: true },
  mid: { shaft: 12, arc: 4, rows: 4, ribs: 0, floor: 4, rings: 2, moulded: false },
  far: { shaft: 6, arc: 2, rows: 2, ribs: 0, floor: 2, rings: 1, moulded: false },
};

/** Cast stone (the founders'), the paving, the vaults' plaster-pale stone, bronze, a lamp's glowing face (linear albedo). */
const STONE: RGB = [0.5, 0.47, 0.42];
const PAVING: RGB = [0.4, 0.38, 0.35];
const VAULT: RGB = [0.58, 0.55, 0.5];
const BRONZE: RGB = [0.22, 0.15, 0.08];
const LAMP: RGB = [1, 0.92, 0.78];
/** A light well's glass seen from below: the day's own colour (the VAULT kind lights it by the day above). */
const SKY: RGB = [1, 1, 1];

/** The lamps' warm light (linear RGB): the VAULT kind's tint, and the light the player's body gets below (render/lights.ts). */
export const LAMPLIGHT: RGB = [1, 0.86, 0.68];

/**
 * The openings through the vault (light wells, lifts) take at most this share of the flat ceiling's least radius at a
 * bay's middle (where the fan vaults leave the deck bare), a well narrowing from the court's glass above if it must; of the day's light on the glass,
 * this share comes down the shaft; the floor gives back this share of what falls on it, from a pool this much wider
 * than the oculus per metre of the room's height. The bronze lip round the oculus: its width and depth.
 */
const OPENING_ROOM = 0.8;
const WELL_PASS = 0.8;
const FLOOR_BACK = 0.35;
const POOL_SPREAD = 0.5;
const LIP = { width: 0.5, deep: 0.2 };
/**
 * A court's lift below, in handrails: an open bronze cage from floor to vault, its side, its corner posts, the bands
 * round it at every `every` up, the lattice's bars, the panels below the first band (`door` high, the doorway's
 * height on the side toward the court), the clearance round it in the vault's opening, and how far its shaft rises
 * over the court's level (over the cabin's roof waiting there: from the top of the shaft one sees no vault from above).
 */
export const LIFT = { side: 3, post: 0.16, band: 0.09, every: 2.8, bar: 0.05, door: 2.6, clear: 0.35, head: 3 };
/** Facets across a rib's rounded section; how far its normals lean out of the surface even where it meets it. */
const RIB_SECTION = 4;
const RIB_LEAN = 0.6;
/** Tiles of 2^ROOT bays a side are the coarsest. */
const ROOT = 3;
/** The lamps: how much of a ring's light goes all round (the rest up, toward the vault), and how much comes back off every surface. */
const LAMP_ALL_ROUND = 0.3;
const BOUNCE = 0.3;
/**
 * A ring's glowing face is large, so a surface right by it is lit as by a broad source, not a point: its light falls
 * as 1 / (d² + SOURCE²) (m), and none is lit brighter than BRIGHTEST times the floor mid-bay.
 */
const SOURCE = 2;
const BRIGHTEST = 8;
/** Pillars each way from a bay whose lamps light it (those further off, through the mist, add little). */
const LAMP_REACH = 2;

/** The Understorey's grid of tiles: its bays, wrapping round the axis. */
export const underGridOf: (h: Habitat) => Grid = kept((h: Habitat): Grid => {
  const u = underOf(h);
  return { nU: u.around, nV: u.along, wrap: true, edgeU: u.dTheta * h.radius, edgeV: u.bay, root: ROOT, finest: 0 };
});

/** The detail a tile is built at, by its size. */
export const underDetailOf = (key: TileKey): UnderDetail => (key.level === 0 ? 'near' : key.level === 1 ? 'mid' : 'far');

/** Whether a world point lies under the land, inside the Understorey's ceiling (or in the deck over it). */
export function isBelow(t: Terrain, p: Vec3): boolean {
  const at = fromWorld(t.habitat.profile, p[0], p[1], p[2]), u = underOf(t.habitat);
  if (at.s < u.s0 || at.s > u.s0 + u.along * u.bay) return false;
  return at.h < levelsOf(t).levelAt(at.theta, at.s).ceiling + t.habitat.params.layers.ceilingDeck;
}

/** The tiles the eye wants: around it while it is below the land, none while it is up on it. */
export function underTilesFor(t: Terrain, eye: Vec3): WantedTile[] {
  if (!isBelow(t, eye)) return [];
  const h = t.habitat, u = underOf(h), at = fromWorld(h.profile, eye[0], eye[1], eye[2]), lv = levelsOf(t).levelAt(at.theta, at.s);
  return wantedCells(underGridOf(h), { u: wrapAngle(at.theta) / u.dTheta, v: (at.s - u.s0) / u.bay, h: Math.max(0, lv.floor - at.h, at.h - lv.ceiling) });
}

/** Sizes of one habitat's pillars (m). */
interface Sizes {
  rp: number;
  /** A conoid's radius at the top (half the shorter side of a bay), its radius where it springs. */
  top: number;
  spring: number;
  /** The bay's length along and width around. */
  along: number;
  around: number;
}

const sizesOf = kept((h: Habitat): Sizes => {
  const u = underOf(h), rp = h.pillars.radius, around = u.dTheta * h.radius;
  return { rp, top: Math.min(u.bay, around) / 2, spring: PILLAR.capital * rp, along: u.bay, around };
});

/**
 * A shaft up from a bay's middle through the vault, the deck and the soil: its radius in the vault, its radius and
 * height at the top, and what closes it there (a light well's glass, bright with the day; a lift's head, stone).
 */
interface Shaft {
  radius: number;
  topRadius: number;
  top: number;
  cap: 'sky' | 'stone';
}

/**
 * A court's lift, down in the next bay the way its portal faces (bay i, j): the way back toward the court's bay (the
 * bay's frame: x along the axis, y round it), its cage's side.
 */
export interface UnderLift {
  i: number;
  j: number;
  toward: [number, number];
  side: number;
  /** The height its doors open at above (the court's paving). */
  above: number;
}

/** What comes down through the vault over a bay: a court's light well, or its lift. */
interface Opening {
  shaft: Shaft;
  lift: UnderLift | null;
}

/** The light wells by bay (`key`): one under every court's glass (none without courts), made once per terrain. */
const wellsOf = kept((t: Terrain): Map<number, { court: number; shaft: Shaft }> => {
  const h = t.habitat, u = underOf(h), s = sizesOf(h), out = new Map<number, { court: number; shaft: Shaft }>();
  if (!h.params.landmarks || t.courts.length !== u.hamlets.length) return out;
  for (const m of u.hamlets) {
    const w = lightWellOf(h, t.courts[m.court])!;
    out.set(u.key(m.i, m.j), { court: m.court, shaft: { radius: Math.min(w.radius, openingRoom(s)), topRadius: w.radius, top: w.height, cap: 'sky' } });
  }
  return out;
});

/** The flat ceiling at a bay's middle, where the fan vaults leave the deck bare: no opening may take more of it. */
const openingRoom = (s: Sizes): number => (Math.hypot(s.along, s.around) / 2 - s.top) * OPENING_ROOM;

/** A court's lift below (its index among the terrain's courts), or null where it has none; laid out when first asked for. */
export const underLiftOf: (t: Terrain, court: number) => UnderLift | null = keptEach(layLift);

function layLift(t: Terrain, court: number): UnderLift | null {
  const h = t.habitat, u = underOf(h), hr = h.params.landmarks?.handrail, m = u.hamlets[court], l = hr && m && t.courts.length === u.hamlets.length ? courtLayoutOf(t, court) : null;
  if (!hr || !l) return null;
  // In the next bay the portal faces (x along the axis, y round it), if it lies on the floor and no well takes it.
  const a = l.portal.angle, di = Math.round(Math.sin(a)), dj = Math.round(Math.cos(a)), i = m.i + di, j = m.j + dj;
  if (j < 0 || j >= u.along || wellsOf(t).has(u.key(i, j))) return null;
  const room = openingRoom(sizesOf(h)), side = Math.min(LIFT.side * hr, (room - LIFT.clear * hr) * Math.SQRT2);
  return { i, j, toward: [0 - dj, 0 - di], side, above: t.courts[court].floor + l.pave };
}

/** The lift whose cage stands in bay (i, j) (any i: it wraps), with its court's index, or null: a court's lift stands next to the court's own bay. */
export function underLiftIn(t: Terrain, i: number, j: number): { court: number; lift: UnderLift } | null {
  const u = underOf(t.habitat), wells = wellsOf(t), key = u.key(i, j);
  if (wells.has(key)) return null;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = wells.get(u.key(i + di, j + dj)), lift = next ? underLiftOf(t, next.court) : null;
    if (next && lift && lift.j === j && u.key(lift.i, lift.j) === key) return { court: next.court, lift };
  }
  return null;
}

/** What comes down through the vault over bay (i, j) (any i: it wraps): a court's light well, or a lift whose court is next to it. */
function openingOver(t: Terrain, i: number, j: number): Opening | null {
  const u = underOf(t.habitat), well = wellsOf(t).get(u.key(i, j));
  if (well) return { shaft: well.shaft, lift: null };
  const lift = underLiftIn(t, i, j)?.lift;
  if (!lift) return null;
  const hr = t.habitat.params.landmarks!.handrail, radius = (lift.side / 2) * Math.SQRT2 + LIFT.clear * hr;
  return { shaft: { radius, topRadius: radius, top: lift.above + LIFT.head * hr, cap: 'stone' }, lift };
}

/** The lamp ring's middle height over a pillar's floor. */
const lampHeight = (lv: Levels, rp: number): number => lv.springing - (PILLAR.capitalHigh + PILLAR.lampBelow + PILLAR.lampHigh / 2) * rp;

/** A bay's four corners' levels, and the levels anywhere in it (its frame: x along the axis, y around, from its first corner). */
interface Bay {
  i: number;
  j: number;
  corners: [Levels, Levels, Levels, Levels];
  at(x: number, y: number): Levels;
}

function bayOf(lv: UnderLevels, s: Sizes, i: number, j: number): Bay {
  // Corners in the bay's frame: (0, 0), (along, 0), (0, around), (along, around).
  const c: [Levels, Levels, Levels, Levels] = [lv.at(i, j), lv.at(i, j + 1), lv.at(i + 1, j), lv.at(i + 1, j + 1)];
  const inBay = (x: number, y: number): Levels => {
    const fx = x / s.along, fy = y / s.around;
    const mix = (k: keyof Levels): number => (1 - fy) * ((1 - fx) * c[0][k] + fx * c[1][k]) + fy * ((1 - fx) * c[2][k] + fx * c[3][k]);
    return { ceiling: mix('ceiling'), springing: mix('springing'), floor: mix('floor') };
  };
  return { i, j, corners: c, at: inBay };
}

/** A unit normal facing `toward` from a surface's two tangents. */
function normalOf(a: Vec3, b: Vec3, toward: Vec3): Vec3 {
  const n = v3norm(v3cross(a, b));
  return v3dot(n, toward) >= 0 ? n : [-n[0], -n[1], -n[2]];
}

/**
 * One pillar at the origin of its own frame (z: height over the profile): plinth, shaft, base and necking up close,
 * lamp ring, capital. Its floor and springing are its corner's.
 */
function pillar(sh: Shape, lv: Levels, rp: number, d: (typeof DETAIL)[UnderDetail]): void {
  const n = d.shaft, f = lv.floor, P = PILLAR;
  const lathe = (z0: number, r0: number, z1: number, r1: number, col: RGB): void => {
    const dz = z1 - z0, dr = r1 - r0, l = Math.hypot(dz, dr) || 1;
    sh.arc(z0, r0, z1, r1, -dr / l, dz / l, 0, 2 * Math.PI, n, col);
  };
  /** A flat ring at height z between two radii, facing up or down. */
  const annulus = (z: number, r0: number, r1: number, up: boolean, col: RGB): void => {
    if (up) sh.arc(z, r1, z, r0, 1, 0, 0, 2 * Math.PI, n, col); else sh.arc(z, r0, z, r1, -1, 0, 0, 2 * Math.PI, n, col);
  };
  sh.finish = FINISH.stone;
  const top = f + P.plinthHigh * rp;
  sh.block([0, 0, (top + f - P.bury * rp) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [P.plinth * rp, P.plinth * rp, (top - f + P.bury * rp) / 2], STONE, true);
  let foot = top;
  if (d.moulded) {
    // The base: a round step and a roll on the plinth.
    lathe(top, P.torus * rp, top + P.torusHigh * rp * 0.4, P.torus * rp, STONE);
    annulus(top + P.torusHigh * rp * 0.4, rp * 1.04, P.torus * rp, true, STONE);
    lathe(top + P.torusHigh * rp * 0.4, rp * 1.04, top + P.torusHigh * rp, rp, STONE);
    foot = top + P.torusHigh * rp;
  }
  const capFoot = lv.springing - P.capitalHigh * rp;
  lathe(foot, rp, capFoot, rp, STONE);
  if (d.moulded) {
    lathe(capFoot - P.neckHigh * rp, P.neck * rp, capFoot, P.neck * rp, STONE);
    annulus(capFoot - P.neckHigh * rp, rp, P.neck * rp, false, STONE);
    annulus(capFoot, rp, P.neck * rp, true, STONE);
  }
  lathe(capFoot, rp, lv.springing, P.capital * rp, STONE);
  // The lamp ring: a bronze housing round the shaft, glowing on top (up into the vault) and underneath.
  const l1 = capFoot - P.lampBelow * rp, l0 = l1 - P.lampHigh * rp;
  sh.finish = FINISH.bronze;
  lathe(l0, P.lamp * rp, l1, P.lamp * rp, BRONZE);
  sh.finish = FINISH.lamp;
  annulus(l1, rp, P.lamp * rp, true, LAMP);
  annulus(l0, rp, P.lamp * rp, false, LAMP);
}

/**
 * A quarter conoid of the fan vault, from the pillar at (px, py) of a bay (its frame), over the angles a0 … a0 + π/2
 * (from +x toward +y): its sections are circles about the pillar, from the capital's radius at the springing (upright
 * there) to `top` at the ceiling (level there). `spot(t, a)`: t from 0 at the springing to 1 at the top, a the angle.
 */
function conoid(bay: Bay, s: Sizes, px: number, py: number): { spot: (t: number, a: number) => Vec3; facing: (t: number, a: number) => Vec3; meridian: (t: number, a: number) => Vec3 } {
  const zs = bay.at(px, py).springing;
  const onVault = (t: number, a: number): Vec3 => {
    const q = (t * Math.PI) / 2, r = s.spring + (s.top - s.spring) * (1 - Math.cos(q)), ca = Math.cos(a), sa = Math.sin(a);
    const zc = bay.at(px + s.top * ca, py + s.top * sa).ceiling;
    return [px + r * ca, py + r * sa, zs + (zc - zs) * Math.sin(q)];
  };
  const e = 1e-4;
  const meridian = (t: number, a: number): Vec3 => v3norm(v3sub(onVault(Math.min(1, t + e), a), onVault(Math.max(0, t - e), a)));
  const circle = (t: number, a: number): Vec3 => v3norm(v3sub(onVault(t, a + e), onVault(t, a - e)));
  // Facing the room: out from the pillar and down.
  const facing = (t: number, a: number): Vec3 => normalOf(meridian(t, a), circle(t, a), [Math.cos(a), Math.sin(a), -1]);
  return { spot: onVault, facing, meridian };
}

/** One bay of the structure, built in its own frame. */
function buildBay(sh: Shape, lv: UnderLevels, s: Sizes, i: number, j: number, d: (typeof DETAIL)[UnderDetail]): void {
  const u = lv.under, bay = bayOf(lv, s, i, j), A = s.along, W = s.around, quarter = Math.PI / 2, opening = openingOver(lv.terrain, i, j);
  // The floor, paved.
  sh.finish = FINISH.stone;
  sh.smoothGrid(d.floor, d.floor, (a, b) => {
    const x = (b / d.floor) * A, y = (a / d.floor) * W, e = 0.01;
    const dzx = (bay.at(x + e, y).floor - bay.at(x - e, y).floor) / (2 * e), dzy = (bay.at(x, y + e).floor - bay.at(x, y - e).floor) / (2 * e);
    return { p: [x, y, bay.at(x, y).floor], n: v3norm([-dzx, -dzy, 1]), uv: [x, y] };
  }, PAVING);
  // The four quarter conoids, each from its pillar into the bay.
  const corners: [number, number, number][] = [[0, 0, 0], [A, 0, quarter], [A, W, 2 * quarter], [0, W, 3 * quarter]];
  const rim: [number, number][] = [];
  for (const [px, py, a0] of corners) {
    const c = conoid(bay, s, px, py);
    sh.finish = FINISH.stone;
    sh.smoothGrid(d.rows, d.arc, (a, b) => {
      const t = a / d.rows, ang = a0 + (b / d.arc) * quarter;
      const p = c.spot(t, ang);
      return { p, n: c.facing(t, ang), uv: [ang * Math.hypot(p[0] - px, p[1] - py), p[2]] };
    }, VAULT);
    for (let b = 0; b <= d.arc; b++) {
      const p = c.spot(1, a0 + (b / d.arc) * quarter);
      rim.push([p[0], p[1]]);
    }
    if (d.ribs) {
      // Ribs up the conoid, and a ring rib round its top.
      for (let k = 0; k < d.ribs; k++) rib(sh, (t) => c.spot(t, a0 + ((k + 0.5) / d.ribs) * quarter), (t) => c.facing(t, a0 + ((k + 0.5) / d.ribs) * quarter), d.rows, PILLAR.rib * s.rp, PILLAR.ribDeep * s.rp);
      const ringAt = (t: number): number => a0 + t * quarter;
      ribAcross(sh, (t) => c.spot(1, ringAt(t)), (t) => c.meridian(1, ringAt(t)), d.arc * 2, PILLAR.ring * s.rp, PILLAR.ringDeep * s.rp);
    }
  }
  // The spandrel: the ceiling between the four conoids, from the bay's middle out to their rims (and along the edges
  // where a long bay's conoids do not meet).
  const mx = A / 2, my = W / 2;
  if (A > 2 * s.top + 1e-6) for (const y of [0, W]) rim.push([mx, y]);
  if (W > 2 * s.top + 1e-6) for (const x of [0, A]) rim.push([x, my]);
  const ring = rim
    .map(([x, y]) => ({ x, y, a: Math.atan2(y - my, x - mx) }))
    .sort((p, q) => p.a - q.a)
    .filter((p, k, all) => k === 0 || Math.hypot(p.x - all[k - 1].x, p.y - all[k - 1].y) > 1e-6);
  if (Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 1e-6) ring.pop();
  ring.push(ring[0]);
  // Under a court, the spandrel opens round its light well's oculus (or its lift's shaft, a bay over): each ray from
  // the bay's middle starts there.
  const hole = opening?.shaft.radius ?? 0;
  const onRay = (b: number, k: number): Vec3 => {
    const dx = ring[b].x - mx, dy = ring[b].y - my, f = hole / Math.hypot(dx, dy) + (1 - hole / Math.hypot(dx, dy)) * k;
    const x = mx + dx * f, y = my + dy * f;
    return [x, y, bay.at(x, y).ceiling];
  };
  // A hamlet's bays show its sky there (gen/skies.ts); the wellhead and the bays outside a hamlet keep their stone.
  const sky = skyOverBay(lv.terrain.habitat, i, j);
  sh.finish = sky < 0 ? FINISH.stone : FINISH.screen + sky;
  sh.smoothGrid(d.rings, ring.length - 1, (a, b) => {
    const p = onRay(b, a / d.rings), e = 0.01, x = p[0], y = p[1];
    const dzx = (bay.at(x + e, y).ceiling - bay.at(x - e, y).ceiling) / (2 * e), dzy = (bay.at(x, y + e).ceiling - bay.at(x, y - e).ceiling) / (2 * e);
    return { p, n: v3norm([dzx, dzy, -1]), uv: [x, y] };
  }, VAULT);
  if (opening) shaftUp(sh, opening.shaft, ring.length - 1, (b) => onRay(b, 0), [mx, my], d);
  if (opening?.lift) liftCage(sh, bay, opening.lift, lv.terrain.habitat.params.landmarks!.handrail, [mx, my], d);
  // The pillar at the bay's first corner (and, on the last row, the one at its far end).
  const placePillar = (x: number, y: number, levels: Levels): void => {
    const p = new Shape(d.shaft, true, true);
    pillar(p, levels, s.rp, d);
    sh.append(p, [1, 0, 0], [0, 1, 0], [0, 0, 1], [x, y, 0]);
  };
  placePillar(0, 0, bay.corners[0]);
  if (j === u.along - 1) placePillar(A, 0, bay.corners[1]);
  // The end walls, floor to ceiling, facing in.
  sh.finish = FINISH.stone;
  for (const [x, end] of [[0, j === 0], [A, j === u.along - 1]] as const) {
    if (!end) continue;
    const inward = x === 0 ? 1 : -1;
    sh.smoothGrid(1, d.floor, (a, b) => {
      const y = (b / d.floor) * W, lvl = bay.at(x, y);
      return { p: [x, y, a ? lvl.ceiling : lvl.floor], n: [inward, 0, 0], uv: [y, a ? lvl.ceiling - lvl.floor : 0] };
    }, STONE);
  }
}

/**
 * A shaft over a bay's middle (`mid`, in the bay's frame), from its rim in the vault (`rim(b)`, the spandrel's inner
 * ring, so the two meet exactly) up through the deck and the soil: a stone lining (widening to a light well's glass),
 * closed at the top by the glass, bright with the day, or by the lift's stone head; a bronze lip round it up close.
 */
function shaftUp(sh: Shape, shaft: Shaft, rays: number, rim: (b: number) => Vec3, mid: [number, number], d: (typeof DETAIL)[UnderDetail]): void {
  const rows = d.rings;
  sh.finish = FINISH.stone;
  sh.smoothGrid(rows, rays, (a, b) => {
    const p = rim(b), dx = p[0] - mid[0], dy = p[1] - mid[1], l = Math.hypot(dx, dy), k = a / rows;
    const r = shaft.radius + (shaft.topRadius - shaft.radius) * k, rise = shaft.top - p[2];
    return {
      p: [mid[0] + (dx / l) * r, mid[1] + (dy / l) * r, p[2] + rise * k],
      n: v3norm([(-dx / l) * rise, (-dy / l) * rise, shaft.topRadius - shaft.radius]),
      uv: [Math.atan2(dy, dx) * r, p[2] + rise * k],
    };
  }, VAULT);
  const cap = new Shape(d.shaft, true, true);
  cap.finish = shaft.cap === 'sky' ? FINISH.sky : FINISH.stone;
  cap.arc(shaft.top, 0, shaft.top, shaft.topRadius, -1, 0, 0, 2 * Math.PI, d.shaft, shaft.cap === 'sky' ? SKY : STONE);
  sh.append(cap, [1, 0, 0], [0, 1, 0], [0, 0, 1], [mid[0], mid[1], 0]);
  if (!d.moulded) return;
  // The lip: round the rim, half on the ceiling, half over the opening's edge.
  sh.finish = FINISH.bronze;
  const onRim = (t: number): Vec3 => {
    const b = Math.min(rays - 1e-9, t * rays), k = Math.floor(b), f = b - k, p = rim(k), q = rim(k + 1);
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  };
  const radial = (t: number): Vec3 => { const p = onRim(t); return v3norm([p[0] - mid[0], p[1] - mid[1], 0]); };
  strip(sh, onRim, () => [0, 0, -1], radial, rays * 2, LIP.width, LIP.deep, BRONZE);
}

/**
 * A court's lift cage over a bay's middle (`mid`): four bronze posts from the floor up into the shaft, bands round it
 * every few metres, bronze panels below the first band but for the doorway on the side toward the court, and up
 * close a lattice of crossed bars in each panel above.
 */
function liftCage(sh: Shape, bay: Bay, lift: UnderLift, hr: number, mid: [number, number], d: (typeof DETAIL)[UnderDetail]): void {
  const f: Vec3 = [lift.toward[0], lift.toward[1], 0], v: Vec3 = [-lift.toward[1], lift.toward[0], 0], z: Vec3 = [0, 0, 1], h = lift.side / 2, L = LIFT;
  const cornerAt = (a: number, b: number): [number, number] => {
    const p = v3madd(v3madd([mid[0], mid[1], 0], f, a * h), v, b * h);
    return [p[0], p[1]];
  };
  const centre = bay.at(mid[0], mid[1]), floor = centre.floor, ceiling = centre.ceiling;
  sh.finish = FINISH.bronze;
  // The posts, each from the floor under it into the shaft.
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const [x, y] = cornerAt(a, b), lvl = bay.at(x, y), top = lvl.ceiling + LIP.deep * 2;
    sh.block([x, y, (lvl.floor + top) / 2], f, v, z, [(L.post * hr) / 2, (L.post * hr) / 2, (top - lvl.floor) / 2], BRONZE);
  }
  // The sides: from the corner (a0, b0) to (a1, b1), and the way out of the cage there.
  const sides: { from: [number, number]; to: [number, number]; out: Vec3; door: boolean }[] = [
    { from: [1, -1], to: [1, 1], out: f, door: true },
    { from: [1, 1], to: [-1, 1], out: v, door: false },
    { from: [-1, 1], to: [-1, -1], out: [-f[0], -f[1], 0], door: false },
    { from: [-1, -1], to: [1, -1], out: [-v[0], -v[1], 0], door: false },
  ];
  const levels: number[] = [];
  for (let zb = floor + L.door * hr; zb < ceiling - L.every * hr * 0.5; zb += L.every * hr) levels.push(zb);
  for (const side of sides) {
    const [x0, y0] = cornerAt(...side.from), [x1, y1] = cornerAt(...side.to), dir = v3norm([x1 - x0, y1 - y0, 0]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const zb of levels) sh.block([cx, cy, zb], dir, v3cross(z, dir), z, [h, (L.band * hr) / 2, (L.band * hr) / 2], BRONZE);
    // Below the first band: a panel, but for the doorway.
    if (!side.door) {
      const l0 = bay.at(x0, y0).floor, l1 = bay.at(x1, y1).floor, top = levels[0] ?? floor + L.door * hr;
      sh.faceToward([x0, y0, l0], [x1, y1, l1], [x1, y1, top], [x0, y0, top], side.out, BRONZE);
      sh.faceToward([x0, y0, l0], [x0, y0, top], [x1, y1, top], [x1, y1, l1], [-side.out[0], -side.out[1], 0], BRONZE);
    }
    if (!d.moulded) continue;
    // The lattice: two crossed bars in each panel between bands.
    for (let k = 0; k + 1 < levels.length; k++) {
      const z0 = levels[k], z1 = levels[k + 1], len = Math.hypot(2 * h, z1 - z0);
      for (const sgn of [1, -1]) {
        const ax = v3norm([dir[0] * 2 * h * sgn, dir[1] * 2 * h * sgn, z1 - z0]), up = v3norm(v3cross(ax, side.out));
        sh.block([cx, cy, (z0 + z1) / 2], ax, side.out, up, [len / 2, (L.bar * hr) / 2, (L.bar * hr) / 2], BRONZE);
      }
    }
  }
}

/** A rib along a curve (`at(t)`, t from 0 to 1) on a surface (`normal(t)`): `width` across, standing `deep` off it. */
function rib(sh: Shape, at: (t: number) => Vec3, normal: (t: number) => Vec3, steps: number, width: number, deep: number): void {
  const side = (t: number): Vec3 => {
    const e = 1e-3, dir = v3norm(v3sub(at(Math.min(1, t + e)), at(Math.max(0, t - e))));
    return v3norm(v3cross(normal(t), dir));
  };
  strip(sh, at, normal, side, steps, width, deep);
}

/** A rib across a curve's direction (a ring rib): `across(t)` is the way its width runs. */
function ribAcross(sh: Shape, at: (t: number) => Vec3, across: (t: number) => Vec3, steps: number, width: number, deep: number): void {
  const down = (t: number): Vec3 => {
    const e = 1e-3, dir = v3norm(v3sub(at(Math.min(1, t + e)), at(Math.max(0, t - e))));
    const n = v3norm(v3cross(dir, across(t)));
    return n[2] <= 0 ? n : [-n[0], -n[1], -n[2]];
  };
  strip(sh, at, down, across, steps, width, deep);
}

/**
 * A moulding of rounded section along a curve: it rises out of the surface on both sides (`width` apart along `side`)
 * to its crown `deep` off along `out`, its normals turning smoothly from the sides to the crown, so it catches the
 * lamps' light as stone does and never shows a hard dark edge.
 */
function strip(sh: Shape, at: (t: number) => Vec3, out: (t: number) => Vec3, side: (t: number) => Vec3, steps: number, width: number, deep: number, col: RGB = VAULT): void {
  const h = width / 2, n = RIB_SECTION;
  sh.smoothGrid(n, steps, (a, b) => {
    const t = b / steps, phi = (a / n) * Math.PI, p = at(t), o = out(t), e = side(t);
    const w = h * Math.cos(phi), d = deep * Math.sin(phi), lean = Math.max(Math.sin(phi), RIB_LEAN);
    return {
      p: [p[0] + e[0] * w + o[0] * d, p[1] + e[1] * w + o[1] * d, p[2] + e[2] * w + o[2] * d],
      n: v3norm([e[0] * Math.cos(phi) + o[0] * lean, e[1] * Math.cos(phi) + o[1] * lean, e[2] * Math.cos(phi) + o[2] * lean]),
      uv: [t * steps, a / n],
    };
  }, col);
}

/** The bays a tile covers. */
function baysOf(u: Under, key: TileKey): { i: number; j: number }[] {
  const size = Math.pow(2, key.level), out: { i: number; j: number }[] = [];
  for (let j = key.j; j < Math.min(key.j + size, u.along); j++) for (let i = key.i; i < Math.min(key.i + size, u.around); i++) out.push({ i, j });
  return out;
}

/** The frame a bay is built in: its first corner on the profile, x along the axis, y around. */
const bayFrame = (u: Under, i: number, j: number): FloorFrame => ({ theta: i * u.dTheta, s: u.s0 + j * u.bay, height: 0, heading: 0 });

/** The tile of the Understorey at a key, at the detail for its size (or `detail`, to compare the levels). */
export function buildUnderTile(t: Terrain, key: TileKey, detail: UnderDetail = underDetailOf(key)): UnderTile {
  const h = t.habitat, lv = levelsOf(t), u = lv.under, s = sizesOf(h), d = DETAIL[detail];
  const size = Math.pow(2, key.level);
  const mid = { theta: (key.i + Math.min(size, u.around - key.i) / 2) * u.dTheta, s: u.s0 + (key.j + Math.min(size, u.along - key.j) / 2) * u.bay };
  const origin = placeAt(h, mid.theta, mid.s, lv.levelAt(mid.theta, mid.s).floor);
  const out = new Shape(d.shaft, true, true), glow: number[] = [];
  for (const { i, j } of baysOf(u, key)) {
    const b = new Shape(d.shaft, true, true), first = out.vertices;
    buildBay(b, lv, s, i, j, d);
    bendInto(out, h, bayFrame(u, i, j), b, origin);
    bakeGlow(lv, s, i, j, origin, out, first, glow);
  }
  return { key, origin, mesh: out.mappedArrays(), glow: new Float32Array(glow) };
}

/** A lamp ring: its middle (world) and the way up there. */
interface Lamp {
  at: Vec3;
  up: Vec3;
}

/** The lamps that light bay (i, j). */
function lampsNear(lv: UnderLevels, s: Sizes, i0: number, j0: number): Lamp[] {
  const u = lv.under, h = lv.terrain.habitat, out: Lamp[] = [];
  for (let j = Math.max(0, j0 - LAMP_REACH); j <= Math.min(u.along, j0 + 1 + LAMP_REACH); j++) {
    for (let i = i0 - LAMP_REACH; i <= i0 + 1 + LAMP_REACH; i++) {
      const theta = i * u.dTheta, lvl = lv.at(i, j);
      out.push({ at: toWorld(h.profile, { theta, s: u.s0 + j * u.bay, h: lampHeight(lvl, s.rp) }), up: [-Math.cos(theta), -Math.sin(theta), 0] });
    }
  }
  return out;
}

/**
 * The light of lamps at a point with normal n (world): each ring as the side of it facing the point, a share all
 * round and the rest up, falling with the square of the distance and through the mist (extinction per metre `sigma`).
 */
function lampLight(lamps: readonly Lamp[], p: Vec3, n: Vec3, ringRadius: number, sigma: number, reach: number): number {
  let e = 0;
  for (const l of lamps) {
    const D = v3sub(l.at, p), dd = v3dot(D, D);
    if (dd > reach * reach) continue;
    // The side of the ring facing the point.
    const up = v3dot(D, l.up), H: Vec3 = [D[0] - l.up[0] * up, D[1] - l.up[1] * up, D[2] - l.up[2] * up], hl = Math.hypot(H[0], H[1], H[2]);
    const k = hl > 1e-6 ? ringRadius / hl : 0;
    const d: Vec3 = [D[0] - H[0] * k, D[1] - H[1] * k, D[2] - H[2] * k], dist = Math.max(0.3, Math.hypot(d[0], d[1], d[2]));
    const cosine = v3dot(n, d) / dist;
    if (cosine <= 0) continue;
    // From the lamp toward the point: up is where most of its light goes.
    const upward = -v3dot(d, l.up) / dist;
    e += (LAMP_ALL_ROUND + (1 - LAMP_ALL_ROUND) * Math.max(0, upward)) * cosine * Math.exp(-sigma * dist) / (dist * dist + SOURCE * SOURCE);
  }
  return e;
}

/** The lamps' light on the floor in the middle of a level bay, which every glow is measured against. */
const floorLight = kept((h: Habitat): number => {
  const u = underOf(h), s = sizesOf(h), L = h.params.layers;
  const lv: Levels = { ceiling: 0, floor: -L.living, springing: -L.living + h.params.under.spring * L.living };
  const lamps: Lamp[] = [];
  for (let j = -LAMP_REACH; j <= LAMP_REACH + 1; j++) for (let i = -LAMP_REACH; i <= LAMP_REACH + 1; i++) lamps.push({ at: [j * s.along, i * s.around, lampHeight(lv, s.rp)], up: [0, 0, 1] });
  return lampLight(lamps, [s.along / 2, s.around / 2, lv.floor], [0, 0, 1], PILLAR.lamp * s.rp, sigmaOf(h), (LAMP_REACH + 0.5) * u.bay);
});

/** The mist's extinction per metre: a quarter of the light left over `under.mist`. */
const sigmaOf = (h: Habitat): number => Math.log(4) / h.params.under.mist;

/** A light well as its light sees it: the oculus (world, its middle in the vault), the way down there, its radius and the exitance of its light (a share of the day's on the land); the pool of it on the floor, shining back up. */
interface WellLight {
  at: Vec3;
  down: Vec3;
  radius: number;
  exitance: number;
  pool: Vec3;
  poolRadius: number;
  poolExitance: number;
}

/** The wells that light bay (i, j): over it and its neighbours (further off, a well's light is spent). */
function wellsNear(lv: UnderLevels, i0: number, j0: number): WellLight[] {
  const t = lv.terrain, h = t.habitat, u = lv.under, out: WellLight[] = [];
  for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
    const w = openingOver(t, i, j)?.shaft;
    if (!w || w.cap !== 'sky') continue;
    const c = u.centreOf(i, j), l = lv.levelAt(c.theta, c.s), room = l.ceiling - l.floor;
    const exitance = WELL_PASS * (w.topRadius / w.radius) ** 2, poolRadius = w.radius + POOL_SPREAD * room;
    // What reaches the floor comes back off it from the pool: the oculus's whole flux, spread over the pool.
    const poolExitance = FLOOR_BACK * exitance * (w.radius / poolRadius) ** 2;
    out.push({
      at: toWorld(h.profile, { theta: c.theta, s: c.s, h: l.ceiling }), down: [Math.cos(c.theta), Math.sin(c.theta), 0], radius: w.radius, exitance,
      pool: toWorld(h.profile, { theta: c.theta, s: c.s, h: l.floor }), poolRadius, poolExitance,
    });
  }
  return out;
}

/** Light at a point (normal n) from a round Lambertian source of `radius` and `exitance` at `at`, facing `facing`. */
function discLight(at: Vec3, facing: Vec3, radius: number, exitance: number, p: Vec3, n: Vec3, sigma: number): number {
  const D = v3sub(at, p), d = Math.hypot(D[0], D[1], D[2]);
  if (d < 1e-6) return 0;
  const out = -v3dot(facing, D) / d, cosine = v3dot(n, D) / d;
  return out > 0 && cosine > 0 ? exitance * ((radius * radius * out * cosine) / (d * d + radius * radius)) * Math.exp(-sigma * d) : 0;
}

/** The day's light down the wells at a point (normal n), as a share of the day's light on the land: from the oculus, and back off its pool. */
function wellLight(wells: readonly WellLight[], p: Vec3, n: Vec3, sigma: number): number {
  let e = 0;
  for (const w of wells) {
    e += discLight(w.at, w.down, w.radius, w.exitance, p, n, sigma);
    e += discLight(w.pool, [-w.down[0], -w.down[1], -w.down[2]], w.poolRadius, w.poolExitance, p, n, sigma);
  }
  return e;
}

/**
 * The glow of bay (i, j)'s vertices in a shape (from `first` on, in the tile's frame `origin`), onto `glow`: each one's
 * lamp light relative to the floor mid-bay, with the light back off every surface, and the day's light down the wells
 * near it (a share of the day's on the land).
 */
function bakeGlow(lv: UnderLevels, s: Sizes, i: number, j: number, origin: Place, m: Shape, first: number, glow: number[]): void {
  const h = lv.terrain.habitat, lamps = lampsNear(lv, s, i, j), wells = wellsNear(lv, i, j), ref = floorLight(h), sigma = sigmaOf(h), reach = (LAMP_REACH + 0.5) * lv.under.bay;
  const ringRadius = PILLAR.lamp * s.rp, P = m.pos, N = m.nrm;
  for (let v = first; v < m.vertices; v++) {
    const p = outOfPlace(origin, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    const nw: Vec3 = [0, 1, 2].map((a) => origin.ex[a] * nx + origin.ey[a] * ny + origin.ez[a] * nz) as Vec3;
    glow.push(
      Math.min(BRIGHTEST, (lampLight(lamps, p, nw, ringRadius, sigma, reach) + BOUNCE * ref) / ((1 + BOUNCE) * ref)),
      wells.length ? Math.min(1, wellLight(wells, p, nw, sigma)) : 0,
    );
  }
}

/**
 * The Understorey's solid parts near a world point, for the physics: the floors, the pillars (plinth and shaft), the
 * lifts' cages and the end walls of the bays within `size` of it, relative to `origin`.
 */
export function underSolid(t: Terrain, origin: Vec3, size: number): { positions: Float32Array; index: Uint32Array } {
  const h = t.habitat, lv = levelsOf(t), u = lv.under, s = sizesOf(h), at = fromWorld(h.profile, origin[0], origin[1], origin[2]);
  const ci = Math.floor(wrapAngle(at.theta) / u.dTheta), cj = Math.floor((at.s - u.s0) / u.bay), reach = Math.ceil(size / 2 / u.bay) + 1;
  const place: Place = { at: origin, ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };
  const out = new Shape(8, false);
  for (let j = Math.max(0, cj - reach); j <= Math.min(u.along - 1, cj + reach); j++) for (let i = ci - reach; i <= ci + reach; i++) {
    const bay = bayOf(lv, s, i, j), b = new Shape(8, false), A = s.along, W = s.around;
    b.smoothGrid(2, 2, (a, c) => {
      const x = (c / 2) * A, y = (a / 2) * W;
      return { p: [x, y, bay.at(x, y).floor], n: [0, 0, 1], uv: [0, 0] };
    });
    const post = (x: number, y: number, lvl: Levels): void => {
      const top = lvl.floor + PILLAR.plinthHigh * s.rp;
      b.block([x, y, (top + lvl.floor - PILLAR.bury * s.rp) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [PILLAR.plinth * s.rp, PILLAR.plinth * s.rp, (top - lvl.floor + PILLAR.bury * s.rp) / 2], [1, 1, 1], true);
      b.prism([x, y, top], [1, 0, 0], [0, 1, 0], [0, 0, 1], s.rp, lvl.springing - top, 8, [1, 1, 1]);
    };
    post(0, 0, bay.corners[0]);
    if (j === u.along - 1) post(A, 0, bay.corners[1]);
    // A court's lift cage: its posts, bands and panels (the doorway open).
    const lift = openingOver(t, i, j)?.lift;
    if (lift) liftCage(b, bay, lift, h.params.landmarks!.handrail, [A / 2, W / 2], DETAIL.far);
    for (const [x, end] of [[0, j === 0], [A, j === u.along - 1]] as const) {
      if (!end) continue;
      const l0 = bay.at(x, 0), l1 = bay.at(x, W);
      b.faceToward([x, 0, l0.floor], [x, W, l1.floor], [x, W, l1.ceiling], [x, 0, l0.ceiling], [x === 0 ? 1 : -1, 0, 0]);
    }
    bendInto(out, h, bayFrame(u, i, j), b, place);
  }
  return out.solid();
}

/** Where something standing below at (θ, s) rests: the Understorey's floor there (height over the profile). */
export const underFloorAt = (t: Terrain, theta: number, s: number): number => levelsOf(t).levelAt(theta, s).floor;
