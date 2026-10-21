/**
 * Habitat parameters in the URL, so a link is a habitat: `?habitat=large` picks one of the blueprint matrix, and
 * short keys override single numbers (`R`, `L`, `g` in g, `au`, `seed`, ...). Only values that differ from the preset
 * are written back, so links stay short. Pure: tested headless (test/params.test.ts).
 */
import { MATRIX, REFERENCE, type HabitatParams } from '../blueprint';

/** URL key, how to read it from the parameters, and how to write it into a copy. */
interface UrlField {
  key: string;
  get: (p: HabitatParams) => number;
  set: (p: HabitatParams, v: number) => HabitatParams;
}

const G = 9.80665;

export const URL_FIELDS: UrlField[] = [
  { key: 'R', get: (p) => p.radius, set: (p, v) => ({ ...p, radius: v }) },
  { key: 'L', get: (p) => p.length, set: (p, v) => ({ ...p, length: v }) },
  { key: 'g', get: (p) => p.floorGravity / G, set: (p, v) => ({ ...p, floorGravity: v * G }) },
  { key: 'au', get: (p) => p.sunDistanceAu, set: (p, v) => ({ ...p, sunDistanceAu: v }) },
  { key: 'endon', get: (p) => (p.axisOrientation === 'end-on' ? 1 : 0), set: (p, v) => ({ ...p, axisOrientation: v ? 'end-on' : 'side-on' }) },
  { key: 'col', get: (p) => p.collectorRatio, set: (p, v) => ({ ...p, collectorRatio: v }) },
  { key: 'light', get: (p) => p.lightTarget, set: (p, v) => ({ ...p, lightTarget: v }) },
  { key: 'shield', get: (p) => p.shieldingDensity / 1000, set: (p, v) => ({ ...p, shieldingDensity: v * 1000 }) },
  { key: 'living', get: (p) => p.layers.living, set: (p, v) => ({ ...p, layers: { ...p.layers, living: v } }) },
  { key: 'hullGPa', get: (p) => p.hull.strength / 1e9, set: (p, v) => ({ ...p, hull: { ...p.hull, strength: v * 1e9 } }) },
  { key: 'hub', get: (p) => p.hubRadius, set: (p, v) => ({ ...p, hubRadius: v }) },
  { key: 'sunline', get: (p) => p.sunlineRadius, set: (p, v) => ({ ...p, sunlineRadius: v }) },
  { key: 'pop', get: (p) => p.population, set: (p, v) => ({ ...p, population: Math.round(v) }) },
  { key: 'seed', get: (p) => p.seed, set: (p, v) => ({ ...p, seed: Math.trunc(v) }) },
];

/** The preset a URL names (`habitat=`), the reference when it names none or an unknown one. */
export function presetOf(search: URLSearchParams): { name: string; params: HabitatParams } {
  const name = search.get('habitat');
  return MATRIX.find((m) => m.name === name) ?? { name: 'reference', params: REFERENCE };
}

/** The habitat a URL describes: its preset with the URL's overrides on top. Bad numbers are ignored. */
export function habitatFromUrl(search: URLSearchParams): HabitatParams {
  let p = presetOf(search).params;
  for (const f of URL_FIELDS) {
    const raw = search.get(f.key);
    if (raw === null || raw.trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) p = f.set(p, v);
  }
  return p;
}

/** The URL query for a habitat: the preset's name and the fields that differ from it, rounded to 4 significant digits. */
export function habitatToUrl(preset: string, p: HabitatParams): string {
  const base = MATRIX.find((m) => m.name === preset)?.params ?? REFERENCE;
  const q = new URLSearchParams();
  if (preset !== 'reference') q.set('habitat', preset);
  for (const f of URL_FIELDS) {
    const v = f.get(p);
    if (Math.abs(v - f.get(base)) > Math.abs(f.get(base)) * 1e-9) q.set(f.key, String(Number(v.toPrecision(4))));
  }
  return q.toString();
}
