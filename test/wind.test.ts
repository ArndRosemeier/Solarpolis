import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, validate, withParams } from '../src/blueprint';
import { brightCentre, dayPhase } from '../src/world/sunline';
import { breezeAt, sunBreezeAt, windAt } from '../src/world/wind';
import { habitatOf } from './worlds';

for (const { name, params } of MATRIX) {
  test(`wind (${name}): the habitat's breeze, swinging over days, the same at the same place and time`, () => {
    const h = habitatOf(name), w = params.air.wind, L = params.day.length, { floorStart, floorEnd } = h.profile;
    // Over many days the breeze averages out near the habitat's own, never blowing backwards on it for long.
    let along = 0, around = 0, n = 0, min = Infinity, max = 0;
    for (let t = 0; t < 40 * L; t += L / 8, n++) {
      const b = breezeAt(h, t);
      along += b.along; around += b.around;
      const k = Math.hypot(b.along, b.around) / Math.hypot(w.along, w.around);
      min = Math.min(min, k); max = Math.max(max, k);
    }
    const mean = Math.hypot(w.along, w.around);
    assert.ok(Math.hypot(along / n - w.along, around / n - w.around) < mean * 0.3, `the mean breeze (${(along / n).toFixed(2)}, ${(around / n).toFixed(2)})`);
    assert.ok(min > 0.2 && max < 1.8 && max - min > 0.3, `it swings (${min.toFixed(2)} … ${max.toFixed(2)} of itself)`);
    // At a place: gusts stronger and weaker than the breeze, and turning it, changing over a minute and a few hundred metres.
    const s = (floorStart + floorEnd) / 2, t0 = 3.4 * L;
    const a = windAt(h, t0, 1, s), again = windAt(h, t0, 1, s), later = windAt(h, t0 + 60, 1, s), away = windAt(h, t0, 1 + 600 / h.radius, s);
    assert.deepEqual(a, again, 'the same every time');
    for (const x of [a, later, away]) assert.ok(Number.isFinite(x.along) && Number.isFinite(x.around));
    assert.ok(Math.hypot(a.along - later.along, a.around - later.around) > 0.01 && Math.hypot(a.along - away.along, a.around - away.around) > 0.01, 'gusts');
    let lo = Infinity, hi = 0;
    for (let k = 0; k < 400; k++) {
      const x = windAt(h, t0 + k * 37, (k * 0.37) % 6.28, floorStart + ((k * 7919) % 1000) / 1000 * (floorEnd - floorStart)), sp = Math.hypot(x.along, x.around);
      lo = Math.min(lo, sp); hi = Math.max(hi, sp);
    }
    assert.ok(hi < (mean * 1.8 + params.air.wind.sun) * (1 + params.air.wind.gust * 1.6) && hi > lo * 1.3, `gusts within reason (${lo.toFixed(1)} … ${hi.toFixed(1)} m/s)`);
  });
}

test('wind: the bright stretch draws the air along the axis toward it by day, and not at night', () => {
  const h = habitatOf(MATRIX[0].name), { length, daylight, peakWidth } = h.params.day, { floorStart, floorEnd } = h.profile;
  const t = length * daylight * 0.5, centre = brightCentre(h, dayPhase(h, t)) * h.params.length;
  // (The floor's s and the axis's z run together on the floor.)
  const zOf = (s: number) => h.profile.at(s).z, sOf = (z: number) => floorStart + (z - zOf(floorStart));
  const below = sOf(centre - peakWidth * h.params.length), above = sOf(centre + peakWidth * h.params.length);
  assert.ok(below > floorStart && above < floorEnd);
  assert.ok(Math.abs(sunBreezeAt(h, t, below) - h.params.air.wind.sun) < 0.05, 'toward it from the wild side, at its strongest a stretch away');
  assert.ok(Math.abs(sunBreezeAt(h, t, above) + h.params.air.wind.sun) < 0.05, 'toward it from the port side');
  assert.ok(Math.abs(sunBreezeAt(h, t, sOf(centre))) < 0.05, 'calm under its middle');
  assert.equal(sunBreezeAt(h, length * (daylight + 0.1), below), 0, 'none at night');
  // A habitat without it, and the blueprint's checks.
  const still = derive(withParams({ air: { ...REFERENCE.air, wind: { along: 0, around: 0, gust: 0, sun: 0 } } }));
  assert.deepEqual(windAt(still, t, 1, below), { along: 0, around: 0 }, 'still air');
  const ids = (wind: typeof REFERENCE.air.wind) => validate(derive(withParams({ air: { ...REFERENCE.air, wind } }))).map((f) => f.id);
  assert.ok(ids({ ...REFERENCE.air.wind, gust: 1.5 }).includes('wind'), 'gusts at most the breeze');
  assert.ok(ids({ ...REFERENCE.air.wind, sun: -1 }).includes('wind'), 'no negative sun breeze');
  assert.ok(!ids(REFERENCE.air.wind).includes('wind'));
});
