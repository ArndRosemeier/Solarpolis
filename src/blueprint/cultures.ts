/**
 * The culture catalogue: what `HabitatParams.culture` names. A culture is how the people of a habitat (and its minds)
 * like to shape their land: the styles their districts make their commons in (gen/plan.ts gives each district one).
 * Each style says how much care it takes, so styles that need daily tending gather near the port end and the ones
 * that let the land be gather toward the reserve.
 *
 * Plain data, like the parameters and the climates. A style names what is done with the land, not its plants: the
 * climate decides what grows, the style what people make of it.
 */
import type { FloorLayer } from './climates';

/** The styles a district can shape its commons in. */
export const DISTRICT_STYLES = ['orchard', 'water', 'stone', 'grove', 'herd', 'play', 'makers', 'let-go'] as const;
export type DistrictStyle = (typeof DISTRICT_STYLES)[number];

export interface StyleSpec {
  style: DistrictStyle;
  /** What it looks like, in a line. */
  description: string;
  /** The care (0 wild … 1 most tended, `Plan.careAt`) where it is at home: it is chosen most there, less toward the edges. */
  care: readonly [number, number];
  /** How often it is chosen, relative to the culture's other styles. */
  weight: number;
}

/**
 * What a style makes of its district's land, in terms any climate can grow (gen/ecology.ts): how much of the ground
 * its trees' crowns cover (`cover`, 0 open … 1 closed wood; null leaves the climate's mix as it falls), how big its
 * planted patches are against the climate's (`grain`), how much wetter it keeps its ground (`wet`, moisture), and how
 * strongly it holds to all that (`hold`, 0 … 1: a district that let its land go holds to nothing), and what its ways
 * are laid with (`way`, a floor layer: gen/paths.ts), so a way's surface changes where it crosses into another district.
 */
export interface StyleLand {
  cover: number | null;
  grain: number;
  wet: number;
  hold: number;
  way: FloorLayer;
}

export const STYLE_LAND: Readonly<Record<DistrictStyle, StyleLand>> = {
  // Fruit trees stand apart over mown meadow, in small blocks; its ways are mown grass.
  orchard: { cover: 0.4, grain: 0.35, wet: 0, hold: 0.85, way: 'grass' },
  // Ponds, reed islands and canals: the ground kept wet.
  water: { cover: null, grain: 0.5, wet: 0.35, hold: 0.7, way: 'gravel' },
  // Dry stone, gravel and moss under a few old trees: mostly open; its ways are laid stone.
  stone: { cover: 0.1, grain: 0.5, wet: -0.1, hold: 0.85, way: 'rock' },
  // Halls of living trees and avenues: closed woods in big stands; its ways are soft with leaf litter.
  grove: { cover: 1, grain: 0.9, wet: 0, hold: 0.9, way: 'litter' },
  // Wood pasture: open grazing with trees in clumps, in wide sweeps; its ways are droves of trodden earth.
  herd: { cover: 0.2, grain: 1.4, wet: 0, hold: 0.8, way: 'dirt' },
  // Fields, courts and a festival meadow: open ground; its ways are fine pale sand.
  play: { cover: 0, grain: 1.5, wet: -0.05, hold: 0.95, way: 'sand' },
  // Workshops and sculpture walks in open ground with a few trees.
  makers: { cover: 0.15, grain: 0.7, wet: 0, hold: 0.8, way: 'gravel' },
  // Let go: the climate's own mix, in its own patches.
  'let-go': { cover: null, grain: 1, wet: 0, hold: 0, way: 'dirt' },
};

/** The kinds of the port endcap's faces (gen/plan.ts): each valley is named for the face it runs into. */
export const FACE_KINDS = ['stair', 'vine', 'water'] as const;
export type FaceKind = (typeof FACE_KINDS)[number];

export interface Culture {
  name: string;
  description: string;
  styles: readonly StyleSpec[];
  /**
   * Each valley's character, by the face it runs into: the styles its districts favour, so a valley reads as one
   * long room with a ruling idea while its districts still differ from each other.
   */
  valleys: Readonly<Record<FaceKind, readonly DistrictStyle[]>>;
}

export const CULTURES: Readonly<Record<string, Culture>> = {
  reference: {
    name: 'reference',
    description: 'The first habitat\'s people: makers, growers and walkers, fond of old trees and long tables',
    styles: [
      { style: 'orchard', description: 'fruit groves in rows, flower meadows mown by the season, long tables under the trees', care: [0.45, 1], weight: 1.2 },
      { style: 'water', description: 'ponds, reed islands, small canals and bathing places', care: [0.25, 1], weight: 1 },
      { style: 'stone', description: 'dry stone, raked gravel, moss, a few very old trees', care: [0.5, 1], weight: 0.7 },
      { style: 'grove', description: 'halls grown from living trees, tree avenues, canopy walks', care: [0.35, 0.95], weight: 1 },
      { style: 'herd', description: 'open wood pasture with grazing herds, drove ways and field shelters', care: [0.1, 0.65], weight: 1 },
      { style: 'play', description: 'fields, courts and tracks, a festival meadow', care: [0.55, 1], weight: 0.8 },
      { style: 'makers', description: 'kilns, open-air workshops and sculpture walks', care: [0.5, 1], weight: 0.8 },
      { style: 'let-go', description: 'a district that chose to let its land go wild again', care: [0, 0.5], weight: 0.6 },
    ],
    valleys: {
      // The main valley, walked end to end on the Sunwalk: old trees, fruit and festivals.
      stair: ['orchard', 'grove', 'play', 'stone'],
      // The working valley under the vine terraces: herds, makers, orchards.
      vine: ['herd', 'makers', 'orchard', 'let-go'],
      // The valley of the canal: water gardens, stone and moss, groves.
      water: ['water', 'stone', 'grove', 'let-go'],
    },
  },
};

/** The culture a habitat names, or null when the catalogue has no such culture. */
export function cultureOf(name: string): Culture | null {
  return Object.hasOwn(CULTURES, name) ? CULTURES[name] : null;
}
