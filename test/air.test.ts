import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, toWorld, validate, withParams } from '../src/blueprint';
import { planOf } from '../src/gen/plan';
import { ROLES, fleetOf, flierAt, venuesOf, type Flier } from '../src/sim';
import { terrainOf } from './worlds';

const TURN = 2 * Math.PI;

test('air: a habitat without sensible drone parameters is invalid', () => {
  const drones = (change: Partial<typeof REFERENCE.life.drones>) => withParams({ life: { ...REFERENCE.life, drones: { ...REFERENCE.life.drones, ...change } } });
  for (const bad of [{ couriers: -1 }, { cruise: 0 }, { lane: REFERENCE.radius }, { designs: 0 }, { designs: 1.5 }, { round: 0 }])
    assert.ok(validate(derive(drones(bad))).some((f) => f.id === 'life' && f.severity === 'invalid'), JSON.stringify(bad));
  assert.ok(!validate(derive(REFERENCE)).some((f) => f.id === 'life'));
});

for (const { name, params } of MATRIX) {
  const d = params.life.drones;

  test(`air (${name}): drones by what there is to do, each role in its designs`, () => {
    const t = terrainOf(name), h = t.habitat, fleet = fleetOf(t), plan = planOf(h);
    const count = (role: string): number => fleet.filter((j) => j.role === role).length;
    const courts = venuesOf(h).courts.length;
    assert.ok(count('courier') >= Math.floor(d.couriers) * courts && count('courier') <= Math.ceil(d.couriers) * courts);
    const floor = h.profile.floorEnd - h.profile.floorStart;
    assert.equal(count('glider'), Math.round((d.gliders * floor) / 1000));
    if (plan.sites.some((x) => x.kind === 'lift-stair')) assert.ok(count('lifter') >= Math.floor(d.lifters));
    if (plan.sites.some((x) => x.kind === 'summit-hut')) assert.ok(count('guardian') >= 2 && count('surveyor') >= Math.floor(d.surveyors));
    for (const j of fleet) assert.ok(ROLES.includes(j.role) && Number.isInteger(j.design) && j.design >= 0 && j.design < d.designs);
    assert.equal(fleetOf(t), fleet, 'made once per terrain');
  });

  test(`air (${name}): every drone somewhere in the air of the habitat, over the ground, clear of the sunline, moving no faster than it says`, () => {
    const t = terrainOf(name), h = t.habitat, fleet = fleetOf(t), { profile } = h;
    // A share of the big fleets, to stay in the CI budget; every role is in it.
    const step = Math.max(1, Math.floor(fleet.length / 150)), ids = fleet.map((_, i) => i).filter((i) => i % step === 0 || fleet[i].role !== fleet[i - 1]?.role);
    const roles = new Set<string>();
    for (const id of ids) for (let k = 0; k < 12; k++) {
      const time = 3 * params.day.length + k * 997.3, a: Flier = flierAt(t, id, time), b = flierAt(t, id, time + 0.5);
      roles.add(a.role);
      assert.deepEqual(flierAt(t, id, time), a, 'the same clock gives the same place');
      assert.ok([a.theta, a.s, a.h, a.heading, a.speed, a.climb].every(Number.isFinite), `${a.role} ${id}`);
      assert.ok(a.s >= 0 && a.s <= profile.length);
      assert.ok(a.h >= t.standAt(a.theta, a.s) - 1e-6, `${a.role} ${id} under the ground`);
      const w = toWorld(profile, a), fromAxis = Math.hypot(w[0], w[1]);
      assert.ok(fromAxis > 4 * h.params.sunlineRadius, `${a.role} ${id} in the sunline (${fromAxis.toFixed(0)} m from the axis)`);
      assert.ok(a.speed <= d.cruise * 1.05, `${a.role} ${id} at ${a.speed.toFixed(1)} m/s`);
      // Half a second on, it has gone no further than its speed takes it (over the floor, at its height).
      const dt = b.theta - a.theta, ring = Math.max(1, fromAxis);
      const moved = Math.hypot((dt - TURN * Math.round(dt / TURN)) * ring, b.s - a.s);
      assert.ok(moved <= Math.max(a.speed, b.speed, d.cruise * 0.1) * 0.5 * 1.6 + 0.05, `${a.role} ${id} jumped ${moved.toFixed(2)} m`);
      if (a.doing === 'rest') assert.ok(a.speed === 0 && Math.abs(a.h - t.standAt(a.theta, a.s)) < 1e-6, 'a resting drone sits on the ground');
    }
    assert.deepEqual([...roles].sort(), [...new Set(fleet.map((j) => j.role))].sort());
  });
}
