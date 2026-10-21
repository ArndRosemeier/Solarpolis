/**
 * One terrain and one ecology per habitat for the whole test run (the suite runs in one process), so test files reuse
 * what others built rather than build the land again. A test that checks a build is the same every time builds its own.
 */
import { MATRIX, derive, type HabitatParams } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { makeEcology, type Ecology } from '../src/gen/ecology';

const terrains = new Map<string, Terrain>(), ecologies = new Map<string, Ecology>();

/** The terrain of a habitat by its name (a `MATRIX` entry's, or any name given with its params). */
export function terrainOf(name: string, params: HabitatParams = MATRIX.find((m) => m.name === name)!.params): Terrain {
  let t = terrains.get(name);
  if (!t) { t = makeTerrain(derive(params)); terrains.set(name, t); }
  return t;
}

/** The ecology over that terrain. */
export function ecologyOf(name: string, params?: HabitatParams): Ecology {
  let e = ecologies.get(name);
  if (!e) { e = makeEcology(terrainOf(name, params)); ecologies.set(name, e); }
  return e;
}
