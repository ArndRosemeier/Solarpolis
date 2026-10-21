/**
 * Validity checks of a habitat (design doc, "Validity checks"). The generator refuses an `invalid` habitat and
 * passes an `unusual` one through with its findings shown, so small and odd cylinders stay possible.
 */
import type { Habitat } from './derive';
import { CLIMATES, climateOf } from './climates';

export type Severity = 'invalid' | 'unusual';

export interface Finding {
  id: 'spin' | 'hull' | 'hull-thick' | 'axis-air' | 'haze' | 'heat' | 'light' | 'layers' | 'population' | 'sunline' | 'relief' | 'day' | 'brims' | 'collectors' | 'climate';
  severity: Severity;
  message: string;
}

/** Above this people feel the spin when they turn their heads. */
export const COMFORT_RPM = 2;
/** Below this share of the floor pressure the axis no longer works as a flyable sky. */
export const FLYABLE_AXIS_PRESSURE = 0.5;
/** Beyond this diameter the far side fades into the haze and the overhead view changes character (m). */
export const HAZE_DIAMETER = 20000;
/** Radiator fins larger than this multiple of the two endcap discs are a defining feature of the habitat. */
export const BIG_FINS = 10;
/** A hull thicker than this share of the radius is a structure of its own. */
export const THICK_HULL = 0.002;

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const km = (m: number): string => `${(m / 1000).toFixed(1)} km`;

export function validate(h: Habitat): Finding[] {
  const out: Finding[] = [];
  const p = h.params;
  if (h.rpm > COMFORT_RPM) out.push({ id: 'spin', severity: 'unusual', message: `spins at ${h.rpm.toFixed(2)} rpm: people feel the rotation when they turn their heads (comfort limit ${COMFORT_RPM} rpm)` });
  if (!Number.isFinite(h.hullThickness)) {
    out.push({ id: 'hull', severity: 'invalid', message: `no hull of this material holds at radius ${km(h.radius)}: the largest is ${km(h.maxRadius)}` });
  } else if (h.hullThickness > THICK_HULL * h.radius) {
    out.push({ id: 'hull-thick', severity: 'unusual', message: `the hull must be ${h.hullThickness.toFixed(0)} m thick: close to the material's limit (largest radius ${km(h.maxRadius)})` });
  }
  const axisAir = h.pressureAt(0) / p.air.floorPressure;
  if (axisAir < FLYABLE_AXIS_PRESSURE) out.push({ id: 'axis-air', severity: 'unusual', message: `the axis has ${pct(axisAir)} of the floor's air pressure: too thin for the flyable sky ocean` });
  if (2 * h.radius > HAZE_DIAMETER) out.push({ id: 'haze', severity: 'unusual', message: `at ${km(2 * h.radius)} across, the far side fades into the haze` });
  const ex = h.exterior;
  if (!ex.fits) out.push({ id: 'brims', severity: 'invalid', message: `${p.exterior.maxBrims} brims per end out to ${p.exterior.brimReach}× the radius cannot shed ${(h.heat / 1e9).toFixed(1)} GW: allow more or wider brims, or run the radiators hotter` });
  else if (ex.brimsPerEnd > 1) out.push({ id: 'brims', severity: 'unusual', message: `needs ${ex.brimsPerEnd} stacked radiator brims per end: they shape the habitat's look` });
  const bm = p.exterior.brimMaterial;
  if (ex.brimStress > bm.strength / bm.safetyFactor) out.push({ id: 'brims', severity: 'invalid', message: `the brim tips move at ${ex.brimTipSpeed.toFixed(0)} m/s: more than the brim material can hold together` });
  if (h.radiatorToEndcaps > BIG_FINS) out.push({ id: 'heat', severity: 'unusual', message: `radiators need ${h.radiatorToEndcaps.toFixed(1)}× the endcap area: large fins shape the habitat's look` });
  if (h.sunlight < h.lightPower) out.push({ id: 'light', severity: 'invalid', message: `collects ${(h.sunlight / 1e9).toFixed(1)} GW of sunlight but its floor needs ${(h.lightPower / 1e9).toFixed(1)} GW of light: add collectors` });
  if (h.collectorShare > 1) out.push({ id: 'collectors', severity: 'invalid', message: `the piped light needs ${pct(h.collectorShare)} of the collecting skin as light collectors: pipe less light, or add collectors` });
  else if (h.collectorShare > 0.8) out.push({ id: 'collectors', severity: 'unusual', message: `light collectors take ${pct(h.collectorShare)} of the skin, so little is left for solar cells` });
  const stack = h.layers.hull - h.layers.surface;
  if (stack >= h.radius * 0.5) out.push({ id: 'layers', severity: 'invalid', message: `the layers under the floor (${stack.toFixed(0)} m) take up half the radius or more` });
  if (!(p.sunlineRadius > 0 && p.sunlineRadius < p.hubRadius)) out.push({ id: 'sunline', severity: 'invalid', message: `the sunline (${p.sunlineRadius} m) must be thinner than the dock hub it ends in (${p.hubRadius} m)` });
  const d = p.day;
  if (!(d.length > 0 && d.daylight > 0 && d.daylight < 1 && d.peakWidth > 0 && d.base >= 0 && d.base <= 1 && d.night >= 0 && d.night < 1)) {
    out.push({ id: 'day', severity: 'invalid', message: 'the day needs a length > 0, daylight and night between 0 and 1, a bright stretch wider than 0 and a base share from 0 to 1' });
  }
  const rl = p.relief, floor = h.profile.floorEnd - h.profile.floorStart;
  if (!(rl.hills >= 0 && rl.terraceStep > 0) || (rl.ringLake && !(rl.ringLake.width > 0 && rl.ringLake.depth > 0 && rl.ringLake.width < floor / 2)))
    out.push({ id: 'relief', severity: 'invalid', message: 'the relief needs hills ≥ 0, a terrace step > 0, and a ring lake narrower than half the floor' });
  if (!climateOf(p.climate)) out.push({ id: 'climate', severity: 'invalid', message: `no climate "${p.climate}" in the catalogue (${Object.keys(CLIMATES).join(', ')})` });
  if (!(p.population >= 0)) out.push({ id: 'population', severity: 'invalid', message: 'the population must not be negative' });
  return out;
}

/** Whether a habitat may be generated (it may still be unusual). */
export function isValid(findings: Finding[]): boolean {
  return !findings.some((f) => f.severity === 'invalid');
}
