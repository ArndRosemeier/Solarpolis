/**
 * Running fast (Arnd, 2026-10-22: "on the floor I sometimes get airborne from running fast and go down slowly like in
 * moon gravity"). The ground's seams, kerbs and banks may nudge the body up a few centimetres in a step; that must
 * never turn into a launch. What stays is the turning frame's own effect: running antispinward really is lighter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, toWorld, withParams, type Vec3 } from '../src/blueprint';
import { buildPatch } from '../src/gen/patch';
import { coast, feltGravity, spinwardAt, upAt } from '../src/world/motion';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';
import { JUMP_SPEED, afterMove } from '../src/physics/character';
import { makeTerrain } from '../src/gen/terrain';
import { RUN, around, rise } from './runs';

test('afterMove: the controller stops a body but never throws it', () => {
  const up: Vec3 = [0, 1, 0];
  const near = (a: Vec3, b: Vec3): void => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9, `${a} vs ${b}`);
  // A step that pops the body 10 cm up at a run keeps none of that lift.
  near(afterMove([40, -0.1, 0], [33, 12, 0], up), [33, 0, 0]);
  // A jump keeps its rise; the ground stopping a fall keeps the stop; a ceiling takes the rise away.
  near(afterMove([0, 3.2, 0], [0, 3.2, 0], up), [0, 3.2, 0]);
  near(afterMove([0, -5, 0], [0, 0, 0], up), [0, 0, 0]);
  near(afterMove([0, 3, 0], [0, 1, 0], up), [0, 1, 0]);
  // A snap down a kerb is no fall, and sliding never gains speed.
  near(afterMove([10, -0.1, 0], [10, -30, 0], up), [10, -0.1, 0]);
  const slid = afterMove([0, -1, 0], [3, -3, 0], up);
  assert.ok(Math.hypot(...slid) <= 1 + 1e-12, `slid at ${Math.hypot(...slid)}`);
});

for (const { name, params } of MATRIX) {
  // Flat land: any lift is the controller's alone.
  const h = derive(withParams({ relief: { hills: 0, ringLake: null, terraceStep: params.relief.terraceStep, massif: 0, rivers: null }, landmarks: null }, params));
  const t = makeTerrain(h);
  const s = (h.profile.floorStart + h.profile.floorEnd) / 2 + Math.min(1234, (h.profile.floorEnd - h.profile.floorStart) / 4);

  test(`running (${name}): a fast run over flat ground stays on it, both ways around`, async () => {
    const world = await PhysicsWorld.create(h);
    world.setGround(buildPatch(t, 4, s, 64, 1));
    // One row across the patch (test/slow/running.slow.test.ts runs many): before the fix the reference's runner
    // caught on a seam here and flew 3 m high.
    for (const sign of [-1, 1]) {
      const start = 4 - (sign * 30) / h.radius;
      const c = world.addCharacter(toWorld(h.profile, { theta: start, s: s - 12, h: t.heightAt(start, s - 12) + 0.05 }));
      world.advance(0.1);
      const lift = rise(world, c, t, () => around(c, sign), RUN, 1.5);
      assert.ok(lift < 0.1, `${sign > 0 ? 'spinward' : 'antispinward'}: rose ${lift.toFixed(2)} m`);
    }
    world.dispose();
  });

  test(`running (${name}): at a run, a jump antispinward hangs longer, exactly as the turning frame says`, async () => {
    const world = await PhysicsWorld.create(h);
    world.setGround(buildPatch(t, 4, s, 192, 2));
    // As fast as a run, but well short of the floor's own speed around the axis (on a small habitat a run nearly is).
    const speed = Math.min(RUN, 0.25 * h.spin * h.radius);
    const times: number[] = [];
    for (const sign of [-1, 1]) {
      const c = world.addCharacter(toWorld(h.profile, { theta: 4, s, h: t.heightAt(4, s) + 0.05 }));
      rise(world, c, t, () => around(c, sign), speed, 0.3);
      const from = c.feet(), up = upAt(from)!, d = around(c, sign);
      const r0 = Math.hypot(from[0], from[1]);
      const expect = coast(h, from, [d[0] * speed + up[0] * JUMP_SPEED, d[1] * speed + up[1] * JUMP_SPEED, 0], 30, 1 / 480, (p, v) => v[0] * up[0] + v[1] * up[1] < 0 && Math.hypot(p[0], p[1]) >= r0);
      c.stride.jump = true;
      let air = 0;
      for (let i = 0; i < 30 / PHYSICS_STEP; i++) {
        c.stride.walk = [d[0] * speed, d[1] * speed, 0];
        world.advance(PHYSICS_STEP);
        if (air > 0.1 && c.grounded) break;
        air += PHYSICS_STEP;
      }
      assert.ok(Math.abs(air - expect.t) < 0.05, `${sign > 0 ? 'spinward' : 'antispinward'}: in the air ${air} s vs ${expect.t} s`);
      times.push(air);
    }
    // Moving against the spin takes away from the speed that makes gravity: what the gravity meter shows.
    const floor = toWorld(h.profile, { theta: 4, s, h: 0 }), spin = spinwardAt(floor)!;
    const g = (v: number): number => feltGravity(h, floor, [spin[0] * v, spin[1] * v, 0]);
    assert.ok(times[0] > times[1], `antispinward ${times[0]} s vs spinward ${times[1]} s`);
    assert.ok(Math.abs(times[0] / times[1] - g(speed) / g(-speed)) < 0.1 * (g(speed) / g(-speed)), `ratio ${times[0] / times[1]} vs ${g(speed) / g(-speed)}`);
    world.dispose();
  });
}
