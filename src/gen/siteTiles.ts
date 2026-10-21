/**
 * Things built at sites spread over the floor (the entrance courts, the river crossings) stream in tiles of one
 * `detailTree` grid laid over the floor's sites: columns around the axis (wrapping), rows along it from just before the
 * first site to just past the last. A tile owns the sites whose middle lies in it, and builds each at the detail its
 * size calls for (far, mid, near by its edge in handrails); `solid` is what the physics touches. Each thing is built in
 * its own frame lying on the floor (`FloorFrame`, gen/shapes.ts) and bent into its tile with `bendInto`. Pure.
 */
import { fromWorld, wrapAngle, type Habitat, type Vec3 } from '../blueprint';
import { wantedCells, type Grid, type GridEye, type TileKey, type WantedTile } from './detailTree';

/** The detail a site's thing is built at; `solid` is what the physics touches. */
export type SiteDetail = 'far' | 'mid' | 'near' | 'solid';

/** A site on the floor: its middle, and how far its thing reaches from it (m). */
export interface Site {
  theta: number;
  s: number;
  reach: number;
}

export interface SiteGrid extends Grid {
  /** Where the grid's first row starts along the profile (m). */
  sBase: number;
}

/** A tile's detail by its edge (handrails): near up to the first, mid up to the second, far beyond. */
const NEAR_EDGE = 190;
const MID_EDGE = 750;
const TAU = 2 * Math.PI;

/** The grid over some sites (null for none): square cells `cell` m a side, roots 2^`root` cells, the finest 2^`finest`. */
export function siteGrid(h: Habitat, sites: readonly Site[], cell: number, root: number, finest: number): SiteGrid | null {
  if (!sites.length) return null;
  const big = Math.max(...sites.map((x) => x.reach)), sBase = Math.min(...sites.map((x) => x.s)) - big;
  const span = Math.max(...sites.map((x) => x.s)) + big - sBase, nU = Math.max(1, Math.round((TAU * h.radius) / cell));
  return { nU, nV: Math.max(1, Math.ceil(span / cell)), wrap: true, edgeU: (TAU * h.radius) / nU, edgeV: cell, root, finest, sBase };
}

/** The detail a tile of a level is built at, by its edge in `unit`s (the handrail). */
export function siteDetailOf(g: SiteGrid, level: number, unit: number): Exclude<SiteDetail, 'solid'> {
  const edge = (Math.pow(2, level) * g.edgeV) / unit;
  return edge <= NEAR_EDGE ? 'near' : edge <= MID_EDGE ? 'mid' : 'far';
}

/** The sites a tile owns: those whose middle lies in it (by index). */
export function sitesIn(g: SiteGrid, sites: readonly Site[], key: TileKey): number[] {
  const size = Math.pow(2, key.level), out: number[] = [];
  sites.forEach((x, i) => {
    const u = (wrapAngle(x.theta) / TAU) * g.nU, v = (x.s - g.sBase) / g.edgeV;
    if (u >= key.i && u < key.i + size && v >= key.j && v < key.j + size) out.push(i);
  });
  return out;
}

/** The tiles wanted around an eye (world, m): the quadtree over the floor, coarsest first, nearest first. */
export function siteTilesFor(h: Habitat, g: SiteGrid, eye: Vec3): WantedTile[] {
  const at = fromWorld(h.profile, eye[0], eye[1], eye[2]);
  const e: GridEye = { u: (wrapAngle(at.theta) / TAU) * g.nU, v: (at.s - g.sBase) / g.edgeV, h: Math.max(0, at.h) };
  return wantedCells(g, e);
}

/** A tile's middle on the floor (θ, s): the frame its things are bent into. */
export function siteTileMiddle(g: SiteGrid, key: TileKey): { theta: number; s: number } {
  const size = Math.pow(2, key.level), u = key.i + size / 2, v = Math.min(g.nV, key.j + size / 2);
  return { theta: (u / g.nU) * TAU, s: g.sBase + v * g.edgeV };
}

/** The sites within `reach` of a point of the world (by index): for the physics' patches. */
export function sitesNear(h: Habitat, sites: readonly Site[], at: Vec3, reach: number): number[] {
  const p = fromWorld(h.profile, at[0], at[1], at[2]), out: number[] = [];
  sites.forEach((x, i) => {
    const d = p.theta - x.theta, around = Math.atan2(Math.sin(d), Math.cos(d)) * h.profile.at(x.s).r;
    if (Math.hypot(around, p.s - x.s) <= reach + x.reach) out.push(i);
  });
  return out;
}
