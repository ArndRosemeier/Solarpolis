import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, fromWorld, toWorld, withParams, type Vec3 } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { buildPatch } from '../src/gen/patch';
import { coast, upAt } from '../src/world/motion';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';
import { HUMAN, JUMP_SPEED } from '../src/physics/character';

/** Step for `seconds`, or until `each` says stop. */
const run = (world: PhysicsWorld, seconds: number, each?: () => boolean | void): void => {
  for (let i = 0; i < Math.round(seconds / PHYSICS_STEP); i++) { if (each?.() === true) return; world.advance(PHYSICS_STEP); }
};

for (const { name, params } of MATRIX) {
  // Flat ground: only the turning frame moves the body sideways.
  const h = derive(withParams({ relief: { hills: 0, ringLake: null, terraceStep: params.relief.terraceStep, rivers: null } }, params));
  const t = makeTerrain(h);
  const s = (h.profile.floorStart + h.profile.floorEnd) / 2;

  test(`character (${name}): stands, walks along the ground, and a jump lands where the turning frame says`, async () => {
    const world = await PhysicsWorld.create(h);
    world.setGround(buildPatch(t, 0, s, 64, 2));
    const c = world.addCharacter(toWorld(h.profile, { theta: 0, s, h: 0.05 }));
    run(world, 0.5);
    assert.ok(c.grounded, 'grounded');
    assert.ok(Math.abs(fromWorld(h.profile, ...c.feet()).h) < 0.1, `feet on the ground: ${fromWorld(h.profile, ...c.feet()).h}`);
    assert.deepEqual(c.up.map((x) => Math.round(x * 1e6) / 1e6), upAt(c.feet())!.map((x) => Math.round(x * 1e6) / 1e6));

    // Walk 2 s at 3 m/s along +z: about 6 m, still on the ground.
    const z0 = c.feet()[2];
    run(world, 2, () => { c.stride.walk = [0, 0, 3]; });
    c.stride.walk = [0, 0, 0];
    assert.ok(Math.abs(c.feet()[2] - z0 - 6) < 0.3, `walked ${c.feet()[2] - z0} m`);
    assert.ok(c.grounded, 'still grounded');
    run(world, 0.25);

    // Jump straight up: the reference integrator says where it comes down (Coriolis puts it a little antispinward).
    const from = c.feet(), up = upAt(from)!;
    const expect = coast(h, from, [up[0] * JUMP_SPEED, up[1] * JUMP_SPEED, 0], 30, 1 / 480, (p, v) => v[0] * up[0] + v[1] * up[1] < 0 && Math.hypot(p[0], p[1]) >= Math.hypot(from[0], from[1]));
    c.stride.jump = true;
    let top = 0, air = 0;
    run(world, 30, () => {
      if (air > 0 && c.grounded) return true;
      top = Math.max(top, fromWorld(h.profile, ...c.feet()).h);
      air += PHYSICS_STEP;
    });
    const g = h.gravityAt(h.radius);
    assert.ok(Math.abs(top - (JUMP_SPEED ** 2) / (2 * g)) < 0.06, `apex ${top} vs ${(JUMP_SPEED ** 2) / (2 * g)}`);
    assert.ok(Math.abs(air - expect.t) < 0.05, `in the air ${air} s vs ${expect.t} s`);
    // Sideways (around the axis) the drift is the turning frame's alone; along up a step of motion is the grain.
    const landed = c.feet(), side: Vec3 = [-up[1], up[0], 0];
    const drift = (p: Vec3): number => (p[0] - from[0]) * side[0] + (p[1] - from[1]) * side[1];
    assert.ok(drift(expect.p) < 0, 'the reference lands antispinward');
    assert.ok(Math.abs(drift(landed) - drift(expect.p)) < 0.1 * Math.abs(drift(expect.p)) + 0.003, `drift ${drift(landed)} vs ${drift(expect.p)}`);
    assert.ok(Math.hypot(...([0, 1, 2].map((k) => landed[k] - expect.p[k]) as Vec3)) < 2 * JUMP_SPEED * PHYSICS_STEP + 0.02, 'lands where the reference lands');
    world.dispose();
  });
}

test('character (reference): floats in the lake with the head out', async () => {
  const h = derive(REFERENCE);
  const t = makeTerrain(h);
  const lake = t.lake!;
  const world = await PhysicsWorld.create(h);
  world.setGround(buildPatch(t, 0, lake.s, 32, 2));
  const c = world.addCharacter(toWorld(h.profile, { theta: 0, s: lake.s, h: lake.level - 0.5 }), t.waterDepth);
  run(world, 6);
  assert.ok(c.swimming, 'swimming');
  const under = t.waterDepth(c.feet()) / HUMAN.height;
  assert.ok(under > 0.75 && under < 0.95, `share under water ${under}`);
  world.dispose();
});
