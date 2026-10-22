/**
 * The Understorey's bays: the grid of pillars the whole living layer stands on (design "The Understorey: life below
 * the land", 2026-10-22). The floor's grid (gen/floorGrid.ts) at `under.bay`: bays as long along the floor, as many
 * round the axis as close the circle at least that wide, the rows centred on the flat floor. Everything that meets the
 * structure finds its bay here: the layer's plan (gen/under.ts), its levels and meshes, and the plan of the land,
 * which sets each entrance court over a bay's middle, where the vault reaches the deck and a light well can come down
 * through it. Pure.
 */
import type { Habitat } from '../blueprint';
import { kept } from './kept';
import { floorGrid } from './floorGrid';

export interface Bays {
  /** Bays round the axis (a whole number, so the grid closes) and along the floor. */
  readonly around: number;
  readonly along: number;
  /** One bay's angle round the axis, its length along the floor (m), and where the first row begins along the profile. */
  readonly dTheta: number;
  readonly bay: number;
  readonly s0: number;
  /** A bay's key (any i: it wraps round the axis). */
  key(i: number, j: number): number;
  /** The bay a point of the floor lies over, or null beyond the floor (the endcaps). */
  bayAt(theta: number, s: number): { i: number; j: number } | null;
  /** A bay's middle (any i: it wraps round the axis). */
  centreOf(i: number, j: number): { theta: number; s: number };
  /** The middle of the bay nearest a point, its row kept between `sMin` and `sMax` (by default the floor's). */
  middleNear(theta: number, s: number, sMin?: number, sMax?: number): { theta: number; s: number };
}

/** A habitat's bays, made once and kept. */
export const baysOf: (h: Habitat) => Bays = kept((h: Habitat): Bays => {
  const { floorStart, floorEnd } = h.profile, bay = h.params.under.bay, grid = floorGrid(h.radius, bay);
  const around = grid.columns, dTheta = (2 * Math.PI) / around, column = grid.column;
  const along = Math.max(1, Math.floor((floorEnd - floorStart) / bay));
  const s0 = floorStart + (floorEnd - floorStart - along * bay) / 2;
  const centreOf = (i: number, j: number): { theta: number; s: number } => ({ theta: ((((i % around) + around) % around) + 0.5) * dTheta, s: s0 + (j + 0.5) * bay });
  return {
    around, along, dTheta, bay, s0, centreOf, key: grid.key,
    bayAt(theta, s) {
      const j = Math.floor((s - s0) / bay);
      return j < 0 || j >= along ? null : { i: column(theta), j };
    },
    middleNear(theta, s, sMin = s0, sMax = s0 + along * bay) {
      // The rows whose middles lie within the range (at least the nearest one, if none does).
      const first = Math.max(0, Math.ceil((sMin - s0) / bay - 0.5)), last = Math.min(along - 1, Math.floor((sMax - s0) / bay - 0.5));
      const j = Math.floor((s - s0) / bay), row = first <= last ? Math.min(last, Math.max(first, j)) : Math.min(along - 1, Math.max(0, j));
      return centreOf(column(theta), row);
    },
  };
});
