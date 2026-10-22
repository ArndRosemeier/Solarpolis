/**
 * The places people make in the land (Solarpolis design, "A land people make": places), placed by rules, never by hand:
 * each kind of place has where it belongs (its district's style, its gravity band, how near an entrance, how level the
 * ground), the candidates are scored and the best taken, seeded. Each place brings its land: the climate grows it as a
 * biome of its own (`Climate.places`; those biomes are `placed`, so they grow nowhere else), laid over whatever the land
 * would have grown there (gen/ecology.ts `biomesAt`), so the ground, its floor, its plants and its colour from afar all
 * agree.
 *
 * For now the planted places:
 *
 * - orchards: blocks of fruit trees in rows near the entrances of the orchard commons, on level ground, clear of water,
 *   the courts and each other; `LandPlan.places.orchard` long;
 * - the Vine face's parcels: the Gate's wine country. Its lower terraces (down where gravity is above `VINE_TOP` of the
 *   floor's) are cut into parcels `LandPlan.places.parcel` wide around the axis, terrace by terrace; each is vines, an
 *   orchard or a mown meadow, so the face reads as a patchwork of rows from anywhere in the habitat.
 *
 * Pure: runs in the generation workers.
 */
import { Rng, deriveSeed, hash3f, smoothstep } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { fromLake, planOf, type District } from './plan';
import { kept } from './kept';
import { fileUnder, floorGrid } from './floorGrid';

export type PlaceKind = 'orchard' | 'vineyard';

/** A planted block on the floor: its middle, its half sizes (m: around the axis, along it), its district. */
export interface Plot {
  kind: PlaceKind;
  theta: number;
  s: number;
  halfAround: number;
  halfAlong: number;
  district: number;
}

export interface Places {
  /** The planted blocks on the floor (the Vine face's parcels follow its terraces: `placeAt`). */
  plots: readonly Plot[];
  /**
   * The planted place over a point and how much of the point it holds (0 … 1, falling to 0 over `EDGE` m at its edge, a
   * mown headland), or null where none is.
   */
  placeAt(theta: number, s: number): { kind: PlaceKind; share: number } | null;
}

/** The Vine face is planted where gravity is at least this share of the floor's: its lower terraces. */
export const VINE_TOP = 0.55;
/** The shares of the Vine face's parcels that are vines and orchards; the rest are mown meadow. */
export const PARCELS = { vineyard: 0.55, orchard: 0.2 } as const;
/** How wide a place's edge is (m): a mown strip where its rows end. */
export const EDGE = 2;
/** Orchards: how far from their entrance (as shares of the entrance spacing), and how many tries for each. */
const NEAR = [0.1, 0.3] as const;
const TRIES = 6;

/** The places of a terrain (made once per terrain, then kept). */
export const placesOf: (t: Terrain) => Places = kept(makePlaces);

function makePlaces(t: Terrain): Places {
  const h = t.habitat, R = h.radius, plan = planOf(h), spec = h.params.plan, size = spec.places.orchard;
  const TURN = 2 * Math.PI, lake = t.lake;
  const gap = (a: number, b: number): number => { const d = a - b; return (d - TURN * Math.round(d / TURN)) * R; };
  const plots: Plot[] = [];
  const rng = new Rng(deriveSeed(h.seed, 'places', 'orchards'));
  /**
   * How well a block of district `d` fits at (θ, s), or −1 where it may not go: wholly inside its district (clear of the
   * tree belts on the borders), dry, clear of courts and other blocks, on level ground. The cheap checks first.
   */
  const fit = (d: District, theta: number, s: number, halfAround: number, halfAlong: number): number => {
    const reach = Math.hypot(halfAround, halfAlong);
    if (s - halfAlong < plan.reserveEnd || s + halfAlong > h.profile.floorEnd) return -1;
    if (fromLake(lake, s) < halfAlong + size * 0.5) return -1;
    for (const p of plots) if (Math.abs(gap(p.theta, theta)) < p.halfAround + halfAround + EDGE * 2 && Math.abs(p.s - s) < p.halfAlong + halfAlong + EDGE * 2) return -1;
    if (!plan.inside(d, theta, s, reach * 1.3)) return -1;
    const corners: [number, number][] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) corners.push([theta + (i * halfAround) / R, s + j * halfAlong]);
    if (corners.some(([pt, ps]) => t.riverAt(pt, ps) || t.courtAt(pt, ps) || plan.districtAt(pt, ps) !== d)) return -1;
    let lo = Infinity, hi = -Infinity;
    for (const [pt, ps] of corners) {
      const g = t.heightAt(pt, ps);
      if (lake && g < lake.level) return -1;
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    // The rise across it, as a slope: an orchard wants ground a ladder can stand on.
    const slope = (hi - lo) / (reach * 2);
    return slope > 0.15 ? -1 : 1 - slope / 0.15;
  };
  for (const d of plan.districts) {
    if (d.style !== 'orchard') continue;
    for (const e of d.entrances) {
      // One block by each entrance, two where the land is most tended.
      const count = d.care > 0.7 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        let best: Plot | null = null, score = 0;
        for (let k = 0; k < TRIES; k++) {
          const a = rng.range(0, TURN), r = rng.range(NEAR[0], NEAR[1]) * spec.entranceSpacing;
          const halfAlong = size * rng.range(0.4, 0.6), halfAround = size * rng.range(0.28, 0.45);
          const theta = e.theta + (Math.sin(a) * r) / R, s = e.s + Math.cos(a) * r;
          const f = fit(d, theta, s, halfAround, halfAlong);
          if (f > score) { score = f; best = { kind: 'orchard', theta, s, halfAround, halfAlong, district: d.id }; }
        }
        if (best) plots.push(best);
      }
    }
  }

  // The blocks filed by every cell of the floor's grid they touch, so a point looks in one cell.
  const grid = floorGrid(R, Math.max(size * 2, 1)), filed = new Map<number, Plot[]>();
  for (const p of plots) {
    const c = grid.column(p.theta), reach = Math.ceil(p.halfAround / grid.size);
    for (let row = grid.row(p.s - p.halfAlong); row <= grid.row(p.s + p.halfAlong); row++) {
      for (let column = c - reach; column <= c + reach; column++) fileUnder(filed, grid.key(column, row), p);
    }
  }
  const wrapped = (theta: number): number => theta - TURN * Math.floor(theta / TURN);

  const parcelSeed = deriveSeed(h.seed, 'places', 'parcels'), parcel = spec.places.parcel;
  const placeAt = (theta: number, s: number): { kind: PlaceKind; share: number } | null => {
    if (s > h.profile.floorEnd) {
      // The Vine face: which terrace, which parcel around the axis, and what the parcel is.
      const terrace = t.terraceAt(theta, s);
      if (!terrace || terrace.face !== 'vine') return null;
      const r = h.profile.at(s).r, g = r / R;
      if (g < VINE_TOP - 0.02) return null;
      const u = (wrapped(theta) * r) / parcel, slot = Math.floor(u), f = hash3f(parcelSeed, terrace.tier, slot, 0);
      const kind: PlaceKind | null = f < PARCELS.vineyard ? 'vineyard' : f < PARCELS.vineyard + PARCELS.orchard ? 'orchard' : null;
      if (!kind) return null;
      const inside = Math.min(u - slot, 1 - (u - slot)) * parcel;
      const share = smoothstep(0, EDGE, inside) * smoothstep(0.5, 0.9, terrace.body) * smoothstep(VINE_TOP - 0.02, VINE_TOP + 0.02, g);
      return share > 0 ? { kind, share } : null;
    }
    if (!plots.length) return null;
    const list = filed.get(grid.key(grid.column(theta), grid.row(s)));
    if (!list) return null;
    for (const p of list) {
      const across = p.halfAround - Math.abs(gap(theta, p.theta)), along = p.halfAlong - Math.abs(s - p.s);
      if (across <= 0 || along <= 0) continue;
      return { kind: p.kind, share: smoothstep(0, EDGE, Math.min(across, along)) };
    }
    return null;
  };
  return { plots, placeAt };
}

/**
 * The nearest place of a kind from (θ, s), well inside it (its whole share), with the way to look there (a unit step in
 * metres along θ·r and s): down an orchard block's length, along a vineyard's rows (around the axis). For the debug
 * menu's Go entries and the shots. Searches the floor's blocks and the Vine face's lower terraces, where `level` says
 * the ground is a ledge one can stand on (not a terrace's wall).
 */
export function nearestPlace(t: Terrain, kind: PlaceKind, theta: number, s: number, level: (theta: number, s: number) => boolean = () => true): { theta: number; s: number; way: [number, number] } | null {
  const h = t.habitat, R = h.radius, P = h.profile, places = placesOf(t), TURN = 2 * Math.PI;
  let best: { theta: number; s: number; way: [number, number] } | null = null, gap = Infinity;
  const consider = (pt: number, ps: number, way: [number, number]): void => {
    const a = pt - theta, u = (a - TURN * Math.round(a / TURN)) * Math.max(P.at(ps).r, 1), v = ps - s, d = u * u + v * v;
    if (d < gap) { gap = d; best = { theta: pt, s: ps, way }; }
  };
  for (const p of places.plots) if (p.kind === kind) consider(p.theta, p.s, [0, 1]);
  // The Vine face, on a lattice a parcel wide: the middle of each parcel found whole.
  const step = h.params.plan.places.parcel;
  for (let ps = P.floorEnd + step / 2; ps < P.length && P.at(ps).r / R >= VINE_TOP; ps += step / 4) {
    const r = P.at(ps).r, n = Math.max(1, Math.round((TURN * r) / step));
    for (let i = 0; i < n; i++) {
      const pt = ((i + 0.5) / n) * TURN, here = places.placeAt(pt, ps);
      if (here && here.kind === kind && here.share >= 1 && level(pt, ps)) consider(pt, ps, [1, 0]);
    }
  }
  return best;
}

/** The foot of the Vine face's middle (where the floor meets it), or null where the Gate has no Vine face. */
export function vineFaceFoot(t: Terrain): { theta: number; s: number } | null {
  const face = t.form.faces.find((f) => f.kind === 'vine');
  return face ? { theta: t.form.valleyAt(face.index, t.habitat.profile.floorEnd), s: t.habitat.profile.floorEnd } : null;
}
