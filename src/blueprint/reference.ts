/**
 * The reference habitat (the design doc's 8 km by 30 km cylinder) and the blueprint matrix: four very different
 * habitats that every test and screenshot run goes through, so a constant that only works for the reference breaks
 * one of the others (docs/ARCHITECTURE.md, "Is this number allowed to be a constant?").
 */
import type { HabitatParams } from './params';

/** The design doc's reference instance: O'Neill's Island Three size at 1 AU, side-on to the Sun. */
export const REFERENCE: HabitatParams = {
  radius: 4000,
  length: 30000,
  floorGravity: 9.81,
  sunDistanceAu: 1,
  axisOrientation: 'side-on',
  air: { floorPressure: 101325, temperature: 288, gasConstant: 287 },
  layers: { soilMin: 1, soilMax: 5, ceilingDeck: 3, living: 20, floorDeck: 2, service: 10, solarSkin: 0.5 },
  // Refined asteroid steel, as the design doc has it.
  hull: { density: 7800, strength: 1.5e9, safetyFactor: 1.5 },
  interiorLoad: 20000,
  shieldingDensity: 5000,
  paddingDensity: 1800,
  collectorRatio: 1,
  solarEfficiency: 0.5,
  lightTarget: 100,
  pipedLight: 0.5,
  radiator: { emissivity: 0.9, temperature: 330 },
  hubRadius: 60,
  sunlineRadius: 15,
  endcaps: { wild: { reach: 0.6, rise: 1.6 }, port: { reach: 0.5, rise: 1.8 } },
  relief: { hills: 60, ringLake: { width: 500, depth: 15 }, terraceStep: 150 },
  exterior: { brimReach: 1.6, brimSpacing: 0.4, maxBrims: 8, brimThickness: 2, brimMaterial: { density: 1800, strength: 3e9, safetyFactor: 1.5 }, spindleLength: 0.25, mastLength: 0.05, berthArms: 6 },
  climate: 'temperate-mild',
  population: 300000,
  age: 200,
  culture: 'reference',
  seed: 1,
};

/** A copy of the reference with some fields replaced (nested groups are replaced whole). */
export function withParams(change: Partial<HabitatParams>, base: HabitatParams = REFERENCE): HabitatParams {
  return { ...base, ...change };
}

/** People per km² of floor in the reference, used to size the others. */
const DENSITY = REFERENCE.population / ((2 * Math.PI * REFERENCE.radius * REFERENCE.length) / 1e6);
const peopleFor = (radius: number, length: number): number => Math.round(DENSITY * (2 * Math.PI * radius * length) / 1e6);

/** The blueprint matrix: the reference, a small fast spinner, a large one at the hull's limit, a long thin one. */
export const MATRIX: { name: string; params: HabitatParams }[] = [
  { name: 'reference', params: REFERENCE },
  { name: 'small', params: withParams({ radius: 200, length: 1500, hubRadius: 10, sunlineRadius: 3, relief: { hills: 8, ringLake: { width: 40, depth: 4 }, terraceStep: 20 }, population: peopleFor(200, 1500), seed: 2 }) },
  { name: 'large', params: withParams({ radius: 12000, length: 60000, hubRadius: 150, sunlineRadius: 40, relief: { hills: 150, ringLake: { width: 1500, depth: 25 }, terraceStep: 300 }, population: peopleFor(12000, 60000), seed: 3 }) },
  { name: 'long', params: withParams({ radius: 2000, length: 40000, hubRadius: 40, sunlineRadius: 10, relief: { hills: 30, ringLake: null, terraceStep: 100 }, population: peopleFor(2000, 40000), seed: 4 }) },
];
