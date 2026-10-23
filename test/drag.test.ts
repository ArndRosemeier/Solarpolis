/**
 * The air and the legs (Arnd, 2026-10-23): the air turns with the habitat and drags on anything moving through it, and
 * on foot the legs push through their grip, friction times the weight the body feels, so the spin's felt gravity and
 * the Coriolis force reach the feet too (test/character.test.ts runs the legs in the physics).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, toWorld, type Vec3 } from '../src/blueprint';
import { airDrag, coast, spinwardAt, upAt } from '../src/world/motion';
import { HUMAN_DRAG, legs } from '../src/physics/character';
import { habitatOf } from './worlds';

const near = (a: Vec3, b: Vec3, e = 1e-9): void => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < e, `${a} vs ${b}`);

test('legs: they push along the ground up to their reach, never into it, and what they cannot take back skids', () => {
  const n: Vec3 = [0, 1, 0];
  near(legs([0, -0.1, 0], [3, 0, 0], n, 5), [3, -0.1, 0]);
  near(legs([0, 0, 0], [3, 0, 4], n, 1), [0.6, 0, 0.8]);
  near(legs([10, 0, 0], [0, 0, 0], n, 2), [8, 0, 0]);
});

for (const { name } of MATRIX) {
  const h = habitatOf(name), s = (h.profile.floorStart + h.profile.floorEnd) / 2;
  const floor = toWorld(h.profile, { theta: 1, s, h: 0 }), up = upAt(floor)!, spin = spinwardAt(floor)!;

  test(`air drag (${name}): a falling body tops out as a skydiver does, and the air thins toward the axis`, () => {
    const g = h.gravityAt(h.radius), rho = h.airDensityAt(h.radius);
    assert.ok(Math.abs(rho - 1.225) < 0.01, `floor air ${rho} kg/m³`);
    assert.ok(h.airDensityAt(0) < rho && Math.abs(h.airDensityAt(0) / rho - h.pressureAt(0) / h.pressureAt(h.radius)) < 1e-12);
    // Falling at the speed where drag holds the weight: 2 g / (ρ k).
    const v = Math.sqrt((2 * g) / (rho * HUMAN_DRAG));
    assert.ok(v > 50 && v < 60, `terminal ${v} m/s`);
    near(airDrag(h, floor, [up[0] * -v, up[1] * -v, 0], HUMAN_DRAG), [up[0] * g, up[1] * g, 0], 1e-9 * g);
  });

  test(`air drag (${name}): thrown against the spin at the floor's own speed, the air brings it down soon and near`, () => {
    const V = h.spin * h.radius, start = toWorld(h.profile, { theta: 1, s, h: 2 });
    const v: Vec3 = [-spin[0] * V + up[0] * 5, -spin[1] * V + up[1] * 5, 0];
    // Down on the floor wherever it comes down (moving out from the axis, at the floor's radius).
    const down = (p: Vec3, w: Vec3): boolean => p[0] * w[0] + p[1] * w[1] > 0 && Math.hypot(p[0], p[1]) >= h.radius;
    const air = coast(h, start, v, 120, 1 / 120, down, HUMAN_DRAG), vacuum = coast(h, start, v, 120, 1 / 120, down);
    assert.ok(air.t < vacuum.t / 2, `down after ${air.t.toFixed(1)} s, in a vacuum ${vacuum.t.toFixed(1)} s`);
    // Seen from outside it hangs still in a vacuum; in the air it is carried round with the habitat.
    assert.ok(Math.hypot(...air.v) < 0.6 * V, `lands at ${Math.hypot(...air.v).toFixed(0)} m/s of ${V.toFixed(0)}`);
  });
}
