/**
 * The climate catalogue: what `HabitatParams.climate` names. A climate is a designed one (the habitat chooses its
 * weather and its land, design doc), so it is a list of biomes with where each one is planted: how wet, how high up
 * the endcaps, how steep. The ecology stage (`gen/ecology.ts`) lays them out over the land; the plants that make each
 * biome come with the scattering stage.
 *
 * Plain data, like the parameters. Sizes are shares of the habitat (of its radius, its relief), never metres for one
 * habitat, so the same climate dresses a 200 m cylinder and a 12 km one.
 */

export type Rgb = readonly [number, number, number];

export interface BiomeSpec {
  name: string;
  /** Linear RGB of its ground cover seen from a distance, and how much that varies across a patch (share). */
  color: Rgb;
  vary: number;
  /** Where it is planted: moisture (0 dry … 1 waterlogged), height above the floor (share of the radius), as [low, high]. */
  moisture: readonly [number, number];
  height: readonly [number, number];
  /** The steepest ground it holds (0 flat … 1 a wall). */
  slope: number;
  /** How much of the land that suits it it takes, relative to the others. */
  share: number;
}

export interface Climate {
  name: string;
  /** One line for the Lab. */
  description: string;
  biomes: readonly BiomeSpec[];
  /** How wet the land is on average, before the lake and the endcaps wet or dry it (0 … 1). */
  wetness: number;
  /** How big one planted patch is, as a share of the radius: woods, meadows, reed beds. */
  patch: number;
  /** How sharp the edges between patches are (1 soft … 12 hedge-sharp); designed land has clear edges. */
  edges: number;
  /** Bare ground: rock on steep slopes, sand at the waterline, the lake's bed. */
  rock: Rgb;
  shore: Rgb;
  bed: Rgb;
}

export const CLIMATES: Readonly<Record<string, Climate>> = {
  'temperate-mild': {
    name: 'temperate-mild',
    description: 'English parkland: meadows and broadleaf woods on the floor, reeds by the water, pines and heath up the endcaps',
    wetness: 0.48,
    patch: 0.25,
    edges: 8,
    biomes: [
      { name: 'meadow', color: [0.16, 0.32, 0.08], vary: 0.12, moisture: [0.25, 0.7], height: [0, 0.2], slope: 0.6, share: 1.2 },
      { name: 'woodland', color: [0.05, 0.14, 0.04], vary: 0.1, moisture: [0.35, 0.8], height: [0, 0.3], slope: 0.7, share: 1 },
      { name: 'wetland', color: [0.2, 0.26, 0.09], vary: 0.15, moisture: [0.75, 1], height: [0, 0.05], slope: 0.25, share: 0.8 },
      { name: 'pinewood', color: [0.03, 0.09, 0.05], vary: 0.08, moisture: [0.15, 0.7], height: [0.12, 0.6], slope: 0.8, share: 1 },
      { name: 'heath', color: [0.2, 0.17, 0.09], vary: 0.15, moisture: [0, 0.32], height: [0.3, 1], slope: 0.85, share: 1 },
    ],
    rock: [0.28, 0.26, 0.22],
    shore: [0.42, 0.38, 0.27],
    bed: [0.18, 0.2, 0.16],
  },
  mediterranean: {
    name: 'mediterranean',
    description: 'Dry hills: golden grass and olive groves on the floor, holm oak and maquis, umbrella pines and bare rock up the endcaps',
    wetness: 0.28,
    patch: 0.2,
    edges: 6,
    biomes: [
      { name: 'dry grass', color: [0.33, 0.27, 0.1], vary: 0.15, moisture: [0, 0.55], height: [0, 0.25], slope: 0.6, share: 1.2 },
      { name: 'olive grove', color: [0.13, 0.16, 0.07], vary: 0.1, moisture: [0.2, 0.6], height: [0, 0.15], slope: 0.4, share: 0.9 },
      { name: 'holm oak', color: [0.05, 0.1, 0.04], vary: 0.08, moisture: [0.4, 0.9], height: [0, 0.35], slope: 0.7, share: 0.8 },
      { name: 'maquis', color: [0.1, 0.13, 0.06], vary: 0.15, moisture: [0.1, 0.5], height: [0.15, 0.8], slope: 0.85, share: 1 },
      { name: 'umbrella pines', color: [0.06, 0.11, 0.05], vary: 0.1, moisture: [0.2, 0.6], height: [0.1, 0.5], slope: 0.6, share: 0.7 },
    ],
    rock: [0.36, 0.32, 0.26],
    shore: [0.5, 0.45, 0.33],
    bed: [0.2, 0.22, 0.17],
  },
};

/** The climate a habitat names, or null when the catalogue has no such climate. */
export function climateOf(name: string): Climate | null {
  return Object.hasOwn(CLIMATES, name) ? CLIMATES[name] : null;
}
