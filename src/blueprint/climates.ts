/**
 * The climate catalogue: what `HabitatParams.climate` names. A climate is a designed one (the habitat chooses its
 * weather and its land, design doc), so it is a list of biomes with where each one is planted: how wet, how high up
 * the endcaps, how steep, and which plants make it. The ecology stage (`gen/ecology.ts`) lays the biomes out over the
 * land; the scatter stage (`gen/scatter.ts`) plants each biome's plants in it.
 *
 * Plain data, like the parameters. Sizes of the land are shares of the habitat (of its radius, its relief), never
 * metres for one habitat, so the same climate dresses a 200 m cylinder and a 12 km one. Plants are living things and
 * keep their own sizes in metres: an oak is an oak in any habitat.
 */

export type Rgb = readonly [number, number, number];

/** The shapes plants are built in (`gen/plants.ts`). */
export type PlantForm = 'broadleaf' | 'conifer' | 'umbrella' | 'shrub' | 'reeds';

export interface PlantSpec {
  name: string;
  form: PlantForm;
  /** Full-grown height range (m). */
  height: readonly [number, number];
  /** Mean distance between neighbours where the biome is pure (m). */
  spacing: number;
  /** Planted in rows (groves, orchards) rather than as they fall. */
  rows?: boolean;
  /** Linear RGB of the bark and of the leaves. */
  bark: Rgb;
  leaf: Rgb;
}

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
  /** What grows in it (grass comes from the ground cover). */
  plants: readonly PlantSpec[];
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
      { name: 'meadow', color: [0.16, 0.32, 0.08], vary: 0.12, moisture: [0.25, 0.7], height: [0, 0.2], slope: 0.6, share: 1.2, plants: [{ name: 'hawthorn', form: 'shrub', height: [1.5, 3.5], spacing: 28, bark: [0.08, 0.06, 0.04], leaf: [0.07, 0.17, 0.04] }] },
      { name: 'woodland', color: [0.05, 0.14, 0.04], vary: 0.1, moisture: [0.35, 0.8], height: [0, 0.3], slope: 0.7, share: 1, plants: [{ name: 'oak', form: 'broadleaf', height: [14, 24], spacing: 10, bark: [0.14, 0.11, 0.08], leaf: [0.05, 0.13, 0.03] }, { name: 'hazel', form: 'shrub', height: [2, 4], spacing: 9, bark: [0.1, 0.08, 0.06], leaf: [0.07, 0.16, 0.04] }] },
      { name: 'wetland', color: [0.2, 0.26, 0.09], vary: 0.15, moisture: [0.75, 1], height: [0, 0.05], slope: 0.25, share: 0.8, plants: [{ name: 'reeds', form: 'reeds', height: [1.5, 2.6], spacing: 1.6, bark: [0.2, 0.18, 0.08], leaf: [0.18, 0.22, 0.07] }, { name: 'willow', form: 'broadleaf', height: [7, 12], spacing: 30, bark: [0.1, 0.09, 0.07], leaf: [0.1, 0.18, 0.06] }] },
      { name: 'pinewood', color: [0.03, 0.09, 0.05], vary: 0.08, moisture: [0.15, 0.7], height: [0.12, 0.6], slope: 0.8, share: 1, plants: [{ name: 'pine', form: 'conifer', height: [16, 28], spacing: 7, bark: [0.13, 0.07, 0.04], leaf: [0.02, 0.08, 0.04] }] },
      { name: 'heath', color: [0.2, 0.17, 0.09], vary: 0.15, moisture: [0, 0.32], height: [0.3, 1], slope: 0.85, share: 1, plants: [{ name: 'heather', form: 'shrub', height: [0.4, 1], spacing: 2.5, bark: [0.08, 0.06, 0.05], leaf: [0.16, 0.08, 0.12] }, { name: 'juniper', form: 'conifer', height: [3, 7], spacing: 25, bark: [0.1, 0.07, 0.05], leaf: [0.03, 0.09, 0.05] }] },
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
      { name: 'dry grass', color: [0.33, 0.27, 0.1], vary: 0.15, moisture: [0, 0.55], height: [0, 0.25], slope: 0.6, share: 1.2, plants: [{ name: 'broom', form: 'shrub', height: [0.8, 1.6], spacing: 18, bark: [0.08, 0.07, 0.04], leaf: [0.1, 0.13, 0.03] }] },
      { name: 'olive grove', color: [0.13, 0.16, 0.07], vary: 0.1, moisture: [0.2, 0.6], height: [0, 0.15], slope: 0.4, share: 0.9, plants: [{ name: 'olive', form: 'broadleaf', height: [4, 7], spacing: 9, rows: true, bark: [0.12, 0.1, 0.08], leaf: [0.12, 0.15, 0.09] }] },
      { name: 'holm oak', color: [0.05, 0.1, 0.04], vary: 0.08, moisture: [0.4, 0.9], height: [0, 0.35], slope: 0.7, share: 0.8, plants: [{ name: 'holm oak', form: 'broadleaf', height: [8, 15], spacing: 9, bark: [0.07, 0.06, 0.05], leaf: [0.03, 0.08, 0.03] }, { name: 'myrtle', form: 'shrub', height: [1.5, 3], spacing: 8, bark: [0.09, 0.07, 0.05], leaf: [0.05, 0.11, 0.03] }] },
      { name: 'maquis', color: [0.1, 0.13, 0.06], vary: 0.15, moisture: [0.1, 0.5], height: [0.15, 0.8], slope: 0.85, share: 1, plants: [{ name: 'rosemary and cistus', form: 'shrub', height: [0.6, 2], spacing: 3, bark: [0.09, 0.08, 0.06], leaf: [0.08, 0.11, 0.05] }] },
      { name: 'umbrella pines', color: [0.06, 0.11, 0.05], vary: 0.1, moisture: [0.2, 0.6], height: [0.1, 0.5], slope: 0.6, share: 0.7, plants: [{ name: 'stone pine', form: 'umbrella', height: [12, 20], spacing: 14, bark: [0.14, 0.08, 0.05], leaf: [0.04, 0.1, 0.04] }] },
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
