/**
 * The gravity the player feels, and the meter that shows it (Arnd, 2026-10-22: make the spin's gravity educational).
 * test/running.test.ts checks the physics against the same `feltGravity`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, toWorld, type Vec3 } from '../src/blueprint';
import { feltGravity, gravityReading, spinwardAt, upAt } from '../src/world/motion';
import { describeGravity } from '../src/app/gravityMeter';

for (const { name, params } of MATRIX) {
  const h = derive(params), s = (h.profile.floorStart + h.profile.floorEnd) / 2;
  const at = toWorld(h.profile, { theta: 1, s, h: 0 }), spin = spinwardAt(at)!, V = h.spin * h.radius;
  const moving = (v: number, along = 0): Vec3 => [spin[0] * v, spin[1] * v, along];

  test(`felt gravity (${name}): the spin's at rest, heavier with it, lighter against it, the same along the axis`, () => {
    const g = h.gravityAt(h.radius);
    assert.ok(Math.abs(feltGravity(h, at, [0, 0, 0]) - g) < 1e-9 * g);
    assert.ok(Math.abs(feltGravity(h, at, moving(0, 30)) - g) < 1e-9 * g, 'along the axis');
    const v = 0.2 * V;
    assert.ok(Math.abs(feltGravity(h, at, moving(v)) - 1.44 * g) < 1e-9 * g, 'with the spin: (1.2)²');
    assert.ok(Math.abs(feltGravity(h, at, moving(-v)) - 0.64 * g) < 1e-9 * g, 'against it: (0.8)²');
    assert.ok(feltGravity(h, at, moving(-V)) < 1e-9 * g, 'as fast as the floor, against it: weightless');
    // Higher up (nearer the axis) the spin presses less, as the radius.
    const up = toWorld(h.profile, { theta: 1, s, h: 0.1 * h.radius });
    assert.ok(Math.abs(feltGravity(h, up, [0, 0, 0]) - 0.9 * g) < 1e-6 * g, 'a tenth of the radius up: 0.9');
  });

  test(`gravity meter (${name}): the arrow points spinward, the words say why`, () => {
    // Looking along the axis toward the port end (+z), spinward is to the left; looking spinward, straight ahead.
    const up = upAt(at)!;
    assert.ok(Math.abs(gravityReading(h, at, [0, 0, 0], [0, 0, 1], up, 'foot').arrow + Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(gravityReading(h, at, [0, 0, 0], spin, up, 'foot').arrow) < 1e-9);

    const against = describeGravity(gravityReading(h, at, moving(-0.2 * V), [0, 0, 1], up, 'foot'));
    assert.equal(against.value, `${(0.64 * h.gravityAt(h.radius) / 9.81).toFixed(2)} g`);
    assert.equal(against.state, 'Against the spin −36%');
    assert.match(against.reason, /slower than the floor/);
    assert.ok(against.change < 0);
    const withIt = describeGravity(gravityReading(h, at, moving(0.2 * V), [0, 0, 1], up, 'air'));
    assert.equal(withIt.state, 'In the air: with the spin +44%');
    assert.match(withIt.reason, /faster than the floor/);

    const high = toWorld(h.profile, { theta: 1, s, h: 0.3 * h.radius });
    const resting = describeGravity(gravityReading(h, high, [0, 0, 0], [0, 0, 1], upAt(high)!, 'fly'));
    assert.equal(resting.state, 'Flying: higher up −30%');
    assert.match(resting.reason, /Nearer the axis/);
    assert.equal(describeGravity(gravityReading(h, at, moving(0, 5), [0, 0, 1], up, 'foot')).state, 'Standing still or along the axis');
  });
}
