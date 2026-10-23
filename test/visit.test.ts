import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, isValid, scaleBlueprint, validate } from '../src/blueprint';
import { AU, DAY, REFERENCE_SPACE } from '../src/space';
import { REFERENCE_SYSTEM, TRAVEL_WAYS, blueprintOf, makeLedger, tripTime, tripsTo, placeInWords } from '../src/system';

const ledger = makeLedger(REFERENCE_SPACE, REFERENCE_SYSTEM);

test('scaleBlueprint: every habitat of the matrix, a quarter smaller and a little larger (the largest is near its hull’s limit), is still a lawful habitat at the same density', () => {
  for (const { name, params } of MATRIX) {
    for (const k of [0.75, 1.08]) {
      const p = scaleBlueprint(params, params.radius * k, params.length * k, params.seed + 1);
      assert.ok(isValid(validate(derive(p))), `${name} ×${k}`);
      assert.equal(p.seed, params.seed + 1);
      assert.ok(Math.abs(p.population / (p.radius * p.length) / (params.population / (params.radius * params.length)) - 1) < 1e-3, `${name} ×${k}: density`);
      assert.ok(Math.abs(p.hubRadius / p.radius - params.hubRadius / params.radius) < 1e-12, `${name} ×${k}: hub`);
    }
    assert.deepEqual(scaleBlueprint(params, params.radius, params.length, params.seed), params, `${name}: at its own size it is itself`);
  }
});

test('tripTime: a burn all the way turns over halfway; past cruise it coasts; a sail is slower than a coasting torch, a hurry fastest', () => {
  const w = { accel: 2, cruise: Infinity };
  assert.ok(Math.abs(tripTime(1e6, w) - 2 * Math.sqrt(1e6 / 2)) < 1e-9);
  const c = { accel: 1, cruise: 100 };
  // Speeding up to 100 m/s takes 5 km, slowing down another 5: the rest is coasted.
  assert.ok(Math.abs(tripTime(1e5, c) - (1e5 / 100 + 100)) < 1e-9);
  assert.ok(Math.abs(tripTime(1e4, c) - 200) < 1e-9, 'just reaching cruise: both regimes agree');
  const t = REFERENCE_SYSTEM.travel;
  for (const d of [4e8, 0.5 * AU, 2 * AU, 30 * AU]) {
    const [sail, coast, hurry] = TRAVEL_WAYS.map((way) => tripTime(d, t[way]));
    assert.ok(sail > coast && coast > hurry, `${d / AU} AU: ${sail / DAY} > ${coast / DAY} > ${hurry / DAY} days`);
  }
});

test('trips: from home, the far habitats take longer, every way; from where one is to there is from there back', () => {
  const near = tripsTo(ledger, 'home', 'l5-1', 0), far = tripsTo(ledger, 'home', 'velloran', 0);
  assert.ok(near.distance < far.distance);
  for (const way of TRAVEL_WAYS) assert.ok(near.times[way] < far.times[way], way);
  const back = tripsTo(ledger, 'velloran', 'home', 0);
  assert.ok(Math.abs(back.distance - far.distance) < 1);
});

test('blueprintOf: each habitat big enough to walk in gets the sample blueprint at its size, its seed, Mind and people; settlements none', () => {
  assert.equal(blueprintOf(ledger, 'home'), ledger.space.home);
  assert.equal(blueprintOf(ledger, 'nowhere'), null);
  let walked = 0, seen = 0;
  for (let k = 0; k < ledger.count; k += 431) {
    const h = ledger.nth(k), p = blueprintOf(ledger, h.id);
    seen++;
    assert.ok(placeInWords(h).length > 0, h.id);
    if (h.form === 'surface') { assert.equal(p, null, h.id); continue; }
    if (h.radius >= 600) assert.ok(p, `${h.id}: R ${h.radius.toFixed(0)} m`);
    if (!p) continue;
    walked++;
    assert.ok(isValid(validate(derive(p))), h.id);
    assert.equal(p.radius, h.radius);
    assert.equal(p.seed, h.seed);
    assert.equal(p.mind, h.mind);
    assert.equal(p.population, h.population);
  }
  assert.ok(walked > seen * 0.8, `${walked} of ${seen}`);
});
