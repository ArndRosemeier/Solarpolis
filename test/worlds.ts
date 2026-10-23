/**
 * One terrain and one ecology per habitat for the whole test run (the suite runs in one process), so test files reuse
 * what others built rather than build the land again. A test that checks a build is the same every time builds its own.
 */
import { MATRIX, derive, withParams, type Habitat, type HabitatParams } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { makeEcology, nearestWood, type Ecology } from '../src/gen/ecology';
import { plantsOf } from '../src/gen/scatter';
import { nestsNear, type Nest } from '../src/sim/birds';

const habitats = new Map<string, Habitat>(), terrains = new Map<string, Terrain>(), ecologies = new Map<string, Ecology>();

/** The habitat by its name (a `MATRIX` entry's, or any name given with its params), so its plan is made once too. */
export function habitatOf(name: string, params: HabitatParams = MATRIX.find((m) => m.name === name)!.params): Habitat {
  let h = habitats.get(name);
  if (!h) { h = derive(params); habitats.set(name, h); }
  return h;
}

/** The terrain of a habitat by its name (a `MATRIX` entry's, or any name given with its params). */
export function terrainOf(name: string, params: HabitatParams = MATRIX.find((m) => m.name === name)!.params): Terrain {
  let t = terrains.get(name);
  if (!t) { t = makeTerrain(habitatOf(name, params)); terrains.set(name, t); }
  return t;
}

/** The ecology over that terrain. */
export function ecologyOf(name: string, params?: HabitatParams): Ecology {
  let e = ecologies.get(name);
  if (!e) { e = makeEcology(terrainOf(name, params)); ecologies.set(name, e); }
  return e;
}

/** The ecology of the reference habitat in another climate (the reference itself in its own). */
export function climateOf(climate: string): Ecology {
  const ref = MATRIX[0];
  return climate === ref.params.climate ? ecologyOf(ref.name) : ecologyOf(`${ref.name}, ${climate}`, withParams({ climate }, ref.params));
}

/**
 * A `MATRIX` habitat with flat land: no hills, lake, massif, rivers or landmarks (whose courts dig into it), so only
 * the turning frame moves what crosses it.
 */
export function flatOf(name: string): Terrain {
  const params = MATRIX.find((m) => m.name === name)!.params;
  return terrainOf(`${name}, flat`, withParams({ relief: { hills: 0, ringLake: null, terraceStep: params.relief.terraceStep, massif: 0, rivers: null }, landmarks: null }, params));
}

/** The birds round the nearest wood to the middle of a habitat's floor (a small patch, to stay in the CI budget). */
const woodBirds = new Map<string, { nests: Nest[]; theta: number; s: number } | null>();
export const BIRDS_RADIUS = 70;
export function woodBirdsOf(name: string): { nests: Nest[]; theta: number; s: number } | null {
  if (woodBirds.has(name)) return woodBirds.get(name)!;
  const e = ecologyOf(name), { profile } = e.terrain.habitat;
  const w = nearestWood(e, 0.5, (profile.floorStart + profile.floorEnd) / 2, 3000, 0.5);
  const found = w && { nests: nestsNear(e, plantsOf(e), w.theta, w.s, BIRDS_RADIUS), theta: w.theta, s: w.s };
  woodBirds.set(name, found);
  return found;
}
