import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORER, vesselPlan, VesselDrive, type VesselRecipe } from '../src/space/vessel';
import { VesselPassenger } from '../src/space/vesselPassenger';
import { TOUR_SHIP } from '../src/space/voyage';

const variants: VesselRecipe[] = [
  { ...EXPLORER, id: 'compact', radius: 8, deckHeight: 3.2, decks: EXPLORER.decks.slice(0, 2) },
  EXPLORER,
  TOUR_SHIP,
  { ...EXPLORER, id: 'extended', radius: 18, deckHeight: 5, decks: [...EXPLORER.decks, ...EXPLORER.decks] },
];
for (const recipe of variants) test(`ship recipe (${recipe.id}): every room fits the pressure hull and keeps the circulation core clear`, () => {
  const p = vesselPlan(recipe), keys = new Set<string>();
  for (const part of p.shape.parts) if (part.role === 'tank' && part.shape === 'cylinder')
    assert.ok(part.to + part.radius * .4 < p.start, 'tank shoulder must stay outside passenger decks');
  assert.ok(p.start > .8 * p.shape.params.length && p.end < .961 * p.shape.params.length);
  for (const d of p.decks) {
    assert.ok(d.ceiling - d.floor >= 2.9);
    for (const b of [...d.walls, ...d.furnishings]) {
      assert.ok(!keys.has(b.id)); keys.add(b.id);
      assert.ok(b.center[0] - b.half[0] >= d.floor - 1e-7 && b.center[0] + b.half[0] <= d.ceiling + 1e-7, b.id);
      for (const y of [-1, 1]) for (const z of [-1, 1])
        assert.ok(Math.hypot(b.center[1] + y * b.half[1], b.center[2] + z * b.half[2]) < p.radius, `${b.id} extends outside pressure hull`);
      assert.ok(Math.hypot(Math.max(0, Math.abs(b.center[1]) - b.half[1]), Math.max(0, Math.abs(b.center[2]) - b.half[2])) > recipe.shaft, `${b.id} obstructs lift`);
    }
  }
});

test('ship drive: reaction mass, acceleration and velocity follow the rocket equation, including exhaustion partway through a step', () => {
  const spec = { dryMass: 1000, propellant: 100, thrust: 200, exhaustVelocity: 1000 };
  const ship = new VesselDrive(spec); ship.burning = true; ship.advance(600);
  assert.equal(ship.fuel, 0); assert.equal(ship.acceleration, 0); assert.equal(ship.burning, false);
  assert.ok(Math.abs(ship.speed - 1000 * Math.log(1.1)) < 1e-10);
  const split = new VesselDrive(spec); split.burning = true;
  for (let i = 0; i < 6000; i++) split.advance(.1);
  assert.ok(Math.abs(ship.distance - split.distance) < .001);
  const speed = ship.speed, from = ship.distance; ship.advance(100);
  assert.equal(ship.speed, speed); assert.ok(Math.abs(ship.distance - from - speed * 100) < 1e-8);
});

test('passenger: freefall preserves drift and thrust alone settles a guest toward an aft deck', () => {
  const plan = vesselPlan(EXPLORER), p = new VesselPassenger(plan), idle = { forward: 0, right: 0, up: 0, fast: false };
  p.eye = [plan.start + 2, 0, -4]; p.velocity = [0, 0, .4];
  for (let i = 0; i < 10; i++) p.step(idle, .1, 0, [], false);
  assert.ok(Math.abs(p.eye[2] + 3.6) < 1e-10); assert.equal(p.eye[0], plan.start + 2);
  for (let i = 0; i < 100; i++) p.step(idle, .02, 2.9, [], false);
  assert.ok(p.eye[0] >= plan.start + 1.64 && p.eye[0] < plan.start + 1.67);
  assert.equal(p.velocity[0], 0);
});

for (const recipe of variants) test(`ship access (${recipe.id}): all recipe decks connect through the lift`, () => {
  const plan = vesselPlan(recipe), p = new VesselPassenger(plan), idle = { forward: 0, right: 0, up: 0, fast: false };
  for (let index = 0; index < plan.decks.length; index++) {
    assert.ok(p.takeLift(index));
    for (let i = 0; i < 250; i++) p.step(idle, .02, 0, [], false);
    assert.equal(p.deck, index); assert.equal(p.riding, false);
    assert.ok(Math.abs(p.eye[0] - plan.decks[index].floor - 1.65) < 1e-7);
  }
});

test('ship recipe: malformed dimensions and propulsion fail before allocating geometry', () => {
  for (const recipe of [{ ...EXPLORER, radius: 1 }, { ...EXPLORER, decks: [] }, { ...EXPLORER, drive: { ...EXPLORER.drive, exhaustVelocity: 0 } }])
    assert.throws(() => vesselPlan(recipe), RangeError);
});
