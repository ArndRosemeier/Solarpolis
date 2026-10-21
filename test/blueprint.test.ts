import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, validate, isValid, withParams, REFERENCE } from '../src/blueprint';

const ref = derive(REFERENCE);
const near = (got: number, want: number, rel: number, what: string): void =>
  assert.ok(Math.abs(got - want) <= Math.abs(want) * rel, `${what}: got ${got}, want ${want} ± ${rel * 100}%`);

test('blueprint: the reference habitat gives the design doc numbers', () => {
  near(ref.period, 127, 0.01, 'rotation period (s)');
  near(ref.rpm, 0.47, 0.02, 'rpm');
  near(ref.floorSpeed, 198, 0.01, 'floor speed (m/s)');
  near(ref.floorArea / 1e6, 754, 0.01, 'floor area (km²)');
  near(ref.pressureAt(0) / REFERENCE.air.floorPressure, 0.79, 0.01, 'axis pressure share');
  near(ref.gravityAt(ref.radius / 2), 9.81 / 2, 1e-9, 'gravity halfway to the axis');
  near(ref.dropOffset(10), 0.5, 0.06, 'drop offset from 10 m (m)');
  near(ref.dropOffset(100), 15, 0.05, 'drop offset from 100 m (m)');
  near(ref.paddingMass / 1e12, 4.3, 0.05, 'padding (billion t)');
  near(ref.solarPower / 1e9, 165, 0.03, 'solar power (GW)');
  near(ref.lightPower / 1e9, 75, 0.02, 'light (GW)');
  assert.ok(ref.hullThickness > 1 && ref.hullThickness < 5, `a hull a few metres thick, got ${ref.hullThickness}`);
  assert.deepEqual(validate(ref), []);
});

test('blueprint: gravity at the floor is the parameter, and a 100 m tower top is 2.5% lighter', () => {
  near(ref.gravityAt(ref.radius), REFERENCE.floorGravity, 1e-12, 'floor gravity');
  near(1 - ref.gravityAt(ref.radius - 100) / ref.gravityAt(ref.radius), 0.025, 1e-9, 'tower top');
});

test('blueprint: the layers stack outward in order, living layer slightly heavier than the floor', () => {
  const l = ref.layers;
  const order = [l.surface, l.ceilingDeck, l.living, l.floorDeck, l.service, l.hull, l.padding, l.solarSkin, l.outer];
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `layer ${i} lies outside layer ${i - 1}`);
  const mid = (l.living + l.floorDeck) / 2;
  near(ref.gravityAt(mid) / ref.gravityAt(l.surface) - 1, 0.005, 0.25, 'living layer gravity excess');
});

test('blueprint: validity flags each limit, and refuses only what cannot exist', () => {
  const ids = (p: Parameters<typeof withParams>[0]) => validate(derive(withParams(p))).map((f) => `${f.severity}:${f.id}`);
  assert.deepEqual(ids({ radius: 150, length: 1000, hubRadius: 5, sunlineRadius: 2 }), ['unusual:spin']);
  assert.deepEqual(ids({ hubRadius: 10 }), ['invalid:sunline'], 'the sunline ends in the hub, so it is thinner');
  assert.ok(ids({ radius: 20000, length: 60000 }).includes('invalid:hull'));
  assert.ok(ids({ radius: 20000, length: 60000, hull: { density: 1600, strength: 6e9, safetyFactor: 1.5 } }).includes('unusual:axis-air'));
  assert.ok(ids({ sunDistanceAu: 5.2 }).includes('invalid:light'));
  assert.ok(!ids({ sunDistanceAu: 5.2, collectorRatio: 40 }).includes('invalid:light'));
  assert.equal(isValid(validate(derive(withParams({ sunDistanceAu: 5.2 })))), false);
});

test('blueprint: an end-on axis gets about a fifth of the side-on sunlight', () => {
  const endOn = derive(withParams({ axisOrientation: 'end-on' }));
  near(endOn.sunlight / ref.sunlight, 0.2, 0.35, 'end-on share');
});

test('blueprint: impossible parameters throw instead of making a habitat', () => {
  assert.throws(() => derive(withParams({ radius: 0 })), /positive/);
  assert.throws(() => derive(withParams({ length: 3000 })), /no floor/);
  assert.throws(() => derive(withParams({ hubRadius: 5000 })), /hub radius/);
});
