/**
 * The Understorey's plan: what lies under the land, bay by bay (design "The Understorey: life below the land",
 * 2026-10-22). The land rests on pillars on a grid of bays (`HabitatParams.under.bay`) running round the axis and along
 * the floor; every bay is the same pillars and vault, filled with one use:
 *
 *   well     the wellhead: the square under an entrance court, where the court's light well drops real light;
 *   hall     the ring of halls round it (kitchens, baths, shops, stages), the hamlet's commons;
 *   home     homes, a household's walled house of tall rooms under the vaults;
 *   lane     the lanes left open between them, every `under.lanes` bay lines, crossing at the wellhead;
 *   gallery  the indoor streets between hamlets, under the land's Sunwalk and ways;
 *   cistern  pillared water halls: the water the habitat moves to keep its spin balanced, warmed on its way to the radiators;
 *   lake     under the ring lake or a lake on the floor: a gallery whose ceiling is the lake's glass bed;
 *   works    under the reserve: the habitat mind's own (no hamlets there, as there are no entrances);
 *   dim      the rest: open pillar forest, lit low.
 *
 * Each entrance court of the land plan (`planOf(h).sites`, kind 'entrance', in that order: the same order as the
 * courts residents live under in src/sim) is the door of a hamlet: its people (the population shared evenly over the
 * courts), their households (`under.household`), the bays their homes take, and the halls those need, laid out in
 * rings round the wellhead with a seeded wobble at the edge. A bay belongs to the nearest court's hamlet only.
 * Cisterns are square blocks of bays in rings round the axis, evenly along the worked floor, as many as `under.cisterns` asks.
 *
 * Pure and seeded; nothing is stored per bay: `useAt` works any bay out on its own, so a habitat of millions of bays
 * costs only its hamlets. Distances are over the unrolled floor (θ times the radius, and s). How high the layer lies
 * follows the land over it: that is the terrain's (`levelsOf`, gen/underLevels.ts). Later steps add more of what the
 * terrain decides (great rooms under hills, root bells).
 */
import { angleDiff, deriveSeed, Rng } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { kept } from './kept';
import { baysOf, type Bays } from './bays';
import { fileUnder, floorGrid } from './floorGrid';
import { entrancesOf, planOf, type Site } from './plan';
import { pathsOf } from './paths';

const TURN = 2 * Math.PI;

export type BayUse = 'well' | 'hall' | 'home' | 'lane' | 'gallery' | 'cistern' | 'lake' | 'works' | 'dim';
export const BAY_USES: readonly BayUse[] = ['well', 'hall', 'home', 'lane', 'gallery', 'cistern', 'lake', 'works', 'dim'];

/** How far a hamlet's edge swings in and out round it, as a share of its mean radius, and the swings' harmonics. */
const WOBBLE = 0.18;
const HARMONICS = [2, 3, 5] as const;

/** One hamlet, under one entrance court. Radii are in bays, measured from the court's middle. */
export interface Hamlet {
  /** Its court: the index among the plan's entrances, and the site. */
  court: number;
  site: Site;
  district: number;
  /** The bay its court's middle lies over. */
  i: number;
  j: number;
  people: number;
  households: number;
  /** The wellhead's radius (the court's own, at least three quarters of a bay), the halls' ring, the homes' mean edge. */
  well: number;
  hall: number;
  edge: number;
  /** The edge's swings: amplitude and phase per harmonic (`HARMONICS`). */
  swing: readonly { k: number; a: number; phase: number }[];
}

export interface Under extends Bays {
  readonly habitat: Habitat;
  readonly hamlets: readonly Hamlet[];
  /** What a bay is used for (any i: it wraps round the axis; j outside the floor is 'works'). */
  useAt(i: number, j: number): BayUse;
  /** The hamlet a bay belongs to (the nearest court's, if the bay lies within its edge), or null. */
  hamletOf(i: number, j: number): Hamlet | null;
}

/**
 * A hamlet's bays, ring by ring out from its middle to `most` bays away (nearest first), with their offsets from its
 * middle: the one way to look round a hamlet.
 */
export function* baysOfHamlet(u: Under, m: Hamlet, most: number): Generator<{ i: number; j: number; di: number; dj: number }> {
  for (let r = 0; r <= most; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = m.i + di, j = m.j + dj;
    if (u.hamletOf(i, j) === m) yield { i, j, di, dj };
  }
}

/** The share of each use over a habitat's bays, counted on every `step`-th bay round and along. */
export function sharesOf(under: Under, step = 1): Record<BayUse, number> {
  const out = Object.fromEntries(BAY_USES.map((u) => [u, 0])) as Record<BayUse, number>;
  let n = 0;
  for (let j = 0; j < under.along; j += step) for (let i = 0; i < under.around; i += step) { out[under.useAt(i, j)]++; n++; }
  for (const u of BAY_USES) out[u] /= Math.max(1, n);
  return out;
}

/** A hamlet's edge in the direction φ (radians, from +θ toward +s), in bays. */
export const edgeAt = (hamlet: Hamlet, phi: number): number => {
  let w = 0;
  for (const { k, a, phase } of hamlet.swing) w += a * Math.cos(k * phi + phase);
  return hamlet.edge * (1 + w);
};

/** The Understorey's plan of a habitat, made once and kept. */
export const underOf: (h: Habitat) => Under = kept(makeUnder);

export function makeUnder(h: Habitat): Under {
  const u = h.params.under, plan = planOf(h), paths = pathsOf(h), R = h.radius, { floorStart, floorEnd } = h.profile;
  const bays = baysOf(h), { bay, around, along, bayAt, centreOf } = bays;
  const lake = plan.lake;

  // The hamlets: each court's people in households, their homes and halls in rings round the wellhead.
  const courts = entrancesOf(plan);
  const people = courts.length ? h.params.population / courts.length : 0;
  const open = 1 - ((u.lanes - 1) / u.lanes) ** 2;
  const hamlets: Hamlet[] = courts.map((site, court) => {
    const households = people / u.household.people, homes = households * u.household.bays, halls = homes * u.halls;
    const well = Math.max(site.size / bay, 0.75);
    const hall = Math.sqrt(well * well + halls / Math.PI);
    const edge = Math.sqrt(hall * hall + homes / (1 - open) / Math.PI);
    const rng = new Rng(deriveSeed(h.seed, 'under', 'hamlet', court));
    const swing = HARMONICS.map((k) => ({ k, a: (WOBBLE / HARMONICS.length) * rng.range(0.4, 1.6), phase: rng.range(0, TURN) }));
    const at = bayAt(site.theta, site.s) ?? { i: 0, j: 0 };
    return { court, site, district: site.district, i: at.i, j: at.j, people, households, well, hall, edge, swing };
  });
  // Filed by where their courts lie, so a bay looks only at the courts near it.
  let reach = 0;
  for (const m of hamlets) reach = Math.max(reach, m.edge * (1 + WOBBLE * 1.6) * bay);
  const grid = floorGrid(R, Math.max(reach, bay, h.params.plan.entranceSpacing / 2)), filed = new Map<number, Hamlet[]>();
  for (const m of hamlets) fileUnder(filed, grid.key(grid.column(m.site.theta), grid.row(m.site.s)), m);

  /** The nearest court's hamlet to a point, with the distance (bays) and direction to it, or null with none in reach. */
  const nearest = (theta: number, s: number): { m: Hamlet; d: number; phi: number } | null => {
    const c = grid.column(theta), r = grid.row(s);
    let best: Hamlet | null = null, bd = Infinity, bu = 0, bs = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const list = filed.get(grid.key(c + dc, r + dr));
      if (!list) continue;
      for (const m of list) {
        const du = angleDiff(m.site.theta, theta) * R, ds = s - m.site.s, d = Math.hypot(du, ds);
        if (d < bd) { bd = d; best = m; bu = du; bs = ds; }
      }
    }
    return best ? { m: best, d: bd / bay, phi: Math.atan2(bs, bu) } : null;
  };
  const inHamlet = (i: number, j: number): { m: Hamlet; d: number } | null => {
    const { theta, s } = centreOf(i, j), near = nearest(theta, s);
    return near && near.d < edgeAt(near.m, near.phi) ? near : null;
  };
  const isGallery = (theta: number, s: number, half: number): boolean => {
    const hit = paths.pathAt(theta, s, half);
    return !!hit && hit.kind !== 'trail' && hit.distance <= half;
  };
  const mod = (x: number, n: number): number => ((x % n) + n) % n;

  /** A bay's use before the cisterns are laid out. */
  const baseUse = (i: number, j: number): BayUse => {
    const { theta, s } = centreOf(i, j);
    if (plan.fromWater(theta, s) < 0) return 'lake';
    if (s < plan.reserveEnd) return 'works';
    const near = inHamlet(i, j);
    if (near) {
      if (near.d < near.m.well) return 'well';
      if (near.d < near.m.hall) return 'hall';
    }
    if (isGallery(theta, s, bay / 2)) return 'gallery';
    if (!near) return 'dim';
    const di = mod(i - near.m.i + Math.floor(around / 2), around) - Math.floor(around / 2), dj = j - near.m.j;
    return mod(di, u.lanes) === 0 || mod(dj, u.lanes) === 0 ? 'lane' : 'home';
  };

  // Cisterns: square blocks of bays, about a quarter of the entrance spacing across, in rings round the axis evenly
  // along the worked floor: ballast must sit evenly round the axis, and at many places along it, for the habitat mind to
  // trim the spin by moving water between them. Each ring holds two per valley (at least three), staggered from the
  // ring before; as many rings as `under.cisterns` of the worked floor asks. A cistern moves to the nearest block clear
  // of every hamlet's furthest edge and every gallery when its own place is taken.
  const k = Math.max(2, Math.round(h.params.plan.entranceSpacing / bay / 4));
  const blocksAround = Math.ceil(around / k), halfDiagonal = (Math.SQRT2 * k * bay) / 2;
  const blockMiddle = (bi: number, bj: number): { theta: number; s: number } => centreOf(bi * k + (k - 1) / 2, bj * k + (k - 1) / 2);
  const clear = (bi: number, bj: number): boolean => {
    const { theta, s } = blockMiddle(bi, bj);
    if (bj < 0 || (bj + 1) * k > along || s - halfDiagonal < plan.reserveEnd || plan.fromWater(theta, s) < halfDiagonal) return false;
    const near = nearest(theta, s);
    if (near && near.d * bay - halfDiagonal < near.m.edge * (1 + WOBBLE * 1.6) * bay) return false;
    return !isGallery(theta, s, halfDiagonal + bay / 2);
  };
  const workStart = Math.max(plan.reserveEnd, floorStart), workLength = Math.max(0, floorEnd - workStart - (lake ? 2 * lake.halfWidth : 0));
  const perRing = Math.max(3, 2 * plan.valleys), workedBays = around * (workLength / bay);
  const rings = Math.round((u.cisterns * workedBays) / (perRing * k * k));
  const cisterns = new Set<number>();
  for (let r = 0; r < rings; r++) {
    // Rings evenly over the worked floor, its length counted without the lake.
    let s = workStart + ((r + 0.5) * workLength) / rings;
    if (lake && s > lake.s - lake.halfWidth) s += 2 * lake.halfWidth;
    for (let m = 0; m < perRing; m++) {
      const theta = plan.phase + ((m + (r % 2) / 2) * TURN) / perRing, at = bayAt(theta, s);
      if (!at) continue;
      const bi0 = Math.floor(at.i / k), bj0 = Math.floor(at.j / k);
      search: for (let ring = 0; ring <= 3; ring++) for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const bi = mod(bi0 + di, blocksAround), bj = bj0 + dj, key = bj * blocksAround + bi;
        if (!cisterns.has(key) && clear(bi, bj)) { cisterns.add(key); break search; }
      }
    }
  }
  const isCistern = (i: number, j: number): boolean => cisterns.has(Math.floor(j / k) * blocksAround + Math.floor(mod(i, around) / k));

  const useAt = (i: number, j: number): BayUse => {
    if (j < 0 || j >= along) return 'works';
    const base = baseUse(i, j);
    return base === 'dim' && isCistern(i, j) ? 'cistern' : base;
  };
  const hamletOf = (i: number, j: number): Hamlet | null => {
    const { theta, s } = centreOf(i, j);
    if (j < 0 || j >= along || plan.fromWater(theta, s) < 0 || s < plan.reserveEnd) return null;
    return inHamlet(i, j)?.m ?? null;
  };

  return {
    ...bays, habitat: h,
    hamlets, useAt, hamletOf,
  };
}
