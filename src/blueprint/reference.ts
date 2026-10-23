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
  air: { floorPressure: 101325, temperature: 288, gasConstant: 287, hazeDistance: 60000, wind: { along: 4.5, around: 2, gust: 0.35, sun: 2.5 } },
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
  collectorEfficiency: 0.6,
  radiator: { emissivity: 0.9, temperature: 330 },
  hubRadius: 60,
  sunlineRadius: 15,
  endcaps: { wild: { reach: 0.6, rise: 1.6 }, port: { reach: 0.5, rise: 1.8 } },
  relief: { hills: 60, ringLake: { width: 500, depth: 15 }, terraceStep: 150, massif: 300, rivers: { count: 6, width: 14, depth: 1.6 }, landforms: { ring: 0.1, ringEvery: 1.1, height: 0.33, heights: 2, works: 0.06, wild: 3, signature: 3, fall: 0.08 }, lakes: { great: { length: 0.9, width: 0.42 }, count: 3, size: 0.09, depth: 0.018 } },
  // Fair-weather cumulus: bases at 1.2 km, a third of the sky, a light breeze down the axis.
  clouds: { base: 1200, thickness: 450, cover: 0.3, size: 700, wind: { along: 7, around: 3 } },
  // The largest landmark about as wide as a cathedral is long.
  landmarks: { size: 120, handrail: 1.1 },
  // An Earth day, two thirds lit; the bright stretch a seventh of the length; a dim blue-hour glow at night.
  day: { length: 86400, daylight: 0.65, peakWidth: 0.14, base: 0.3, night: 0.03 },
  exterior: { brimReach: 1.6, brimSpacing: 0.4, maxBrims: 8, brimThickness: 2, brimMaterial: { density: 1800, strength: 3e9, safetyFactor: 1.5 }, spindleLength: 0.25, mastLength: 0.05, berthArms: 6, bore: 0.12, keepOut: 500, panel: 40, campaign: { around: 12, along: 30 }, panelLife: 120, starfloors: 0.004, drones: { trackEvery: 24, spacing: 2500, size: 3, speed: 1.5 }, antennas: { count: 5, dish: 0.6 }, parts: { module: 2.5, cell: 0.156, plate: 3, handrail: 1.1 } },
  climate: 'temperate-mild',
  // The sample habitat's Mind (docs/design/README.md, 2026-10-23).
  mind: 'A Little More Room Than Strictly Necessary',
  // Three valleys (O'Neill's three land strips), the wild fifth of the floor a reserve, districts of ten thousand.
  plan: { valleys: 3, reserve: 0.22, districtPeople: 10000, entranceSpacing: 1200, spiral: 0.6, pathWidth: { sunwalk: 12, way: 3, trail: 1.2 }, places: { orchard: 120, parcel: 150, hall: 72 } },
  // Bays of 30 m between pillars of cast regolith; two people to a household, half a bay of home each.
  under: { bay: 30, stone: { density: 2600, strength: 8e7, modulus: 4e10, safetyFactor: 3 }, land: 9000, spring: 0.65, household: { people: 2.1, bays: 0.5 }, halls: 0.25, lanes: 4, cisterns: 0.04, grade: 0.125, lamp: 0.1, mist: 150, screen: { width: 2.4, height: 1.2, joint: 0.04 } },
  population: 300000,
  // About one in ten residents up on the land on a fine afternoon, for two and a half hours; most keep a rhythm. Half
  // the parties are one person, a third two, a few up to six (so about three in ten people come alone); a court is a
  // stop of half an hour.
  life: { outings: 0.35, stay: 9000, pause: 1800, parties: [0.5, 0.33, 0.09, 0.05, 0.02, 0.01], regulars: 0.6, sunwalk: 0.03, night: 0.04, shells: 0.15, minds: 0.3, walk: 1.3, reach: 1500,
    drones: { couriers: 1, tenders: 1, surveyors: 2, lifters: 6, gliders: 0.4, guardians: 0.2, cruise: 12, lane: 35, round: 1200, designs: 2, persons: 0.08, bodies: 6 },
    animals: { squirrels: 8, range: 25, out: 0.7, deer: 7, herd: 8, roam: 400 },
    birds: { woods: 4, territory: 30, larks: 0.4, owls: 4, swallows: 8, swifts: 40, starlings: 2500 },
    talk: { words: 15, dots: 40, parties: 4, read: 14, quiet: 30 },
    sailing: { boats: 6, outings: 0.4, stay: 7200 } },
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
  { name: 'small', params: withParams({ radius: 200, length: 1500, hubRadius: 10, sunlineRadius: 3, relief: { hills: 8, ringLake: { width: 40, depth: 4 }, terraceStep: 20, massif: 25, rivers: { count: 2, width: 3, depth: 0.5 }, landforms: { ring: 0.08, ringEvery: 1.5, height: 0.2, heights: 1, works: 0.06, wild: 3, signature: 3, fall: 0.08 }, lakes: { great: { length: 0.9, width: 0.42 }, count: 1, size: 0.15, depth: 0.025 } }, clouds: null, landmarks: { size: 18, handrail: 1.1 }, plan: { valleys: 2, reserve: 0.25, districtPeople: 10000, entranceSpacing: 400, spiral: 0.6, pathWidth: { sunwalk: 6, way: 2, trail: 1 }, places: { orchard: 30, parcel: 40, hall: 30 } }, under: { ...REFERENCE.under, bay: 20 }, population: peopleFor(200, 1500), seed: 2 }) },
  { name: 'large', params: withParams({ radius: 12000, length: 60000, hubRadius: 150, sunlineRadius: 40, relief: { hills: 150, ringLake: { width: 1500, depth: 25 }, terraceStep: 300, massif: 800, rivers: { count: 10, width: 30, depth: 3 }, landforms: { ring: 0.05, ringEvery: 0.7, height: 0.25, heights: 3, works: 0.02, wild: 3, signature: 3, fall: 0.08 }, lakes: { great: { length: 0.7, width: 0.3 }, count: 6, size: 0.06, depth: 0.012 } }, clouds: { base: 2500, thickness: 900, cover: 0.45, size: 1800, wind: { along: 9, around: -4 } }, air: { ...REFERENCE.air, wind: { along: 4, around: -2, gust: 0.4, sun: 3.5 } }, landmarks: { size: 220, handrail: 1.1 }, plan: { valleys: 4, reserve: 0.2, districtPeople: 12000, entranceSpacing: 1500, spiral: 0.6, pathWidth: { sunwalk: 16, way: 4, trail: 1.5 }, places: { orchard: 160, parcel: 220, hall: 96 } }, under: { ...REFERENCE.under, bay: 36 }, population: peopleFor(12000, 60000), seed: 3 }) },
  { name: 'long', params: withParams({ radius: 2000, length: 40000, hubRadius: 40, sunlineRadius: 10, relief: { hills: 30, ringLake: null, terraceStep: 100, massif: 150, rivers: null, landforms: { ring: 0.1, ringEvery: 2, height: 0.3, heights: 3, works: 0.06, wild: 3, signature: 3, fall: 0.08 }, lakes: { great: { length: 0.9, width: 0.42 }, count: 4, size: 0.12, depth: 0.02 } }, clouds: { base: 600, thickness: 250, cover: 0.25, size: 450, wind: { along: -6, around: 2 } }, air: { ...REFERENCE.air, wind: { along: -2.5, around: 1, gust: 0.3, sun: 2 } }, landmarks: { size: 90, handrail: 1.1 }, population: peopleFor(2000, 40000), seed: 4 }) },
];
