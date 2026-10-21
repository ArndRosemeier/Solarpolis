import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, toWorld, withParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { buildPatch } from '../src/gen/patch';
import { coast } from '../src/world/motion';
import { PhysicsWorld } from '../src/physics/world';

for (const { name, params } of MATRIX) {
  // Flat ground, so the landing spot is only the turning frame's doing.
  const h = derive(withParams({ relief: { hills: 0, ringLake: null, terraceStep: params.relief.terraceStep, rivers: null } }, params));
  const t = makeTerrain(h);
  const s = (h.profile.floorStart + h.profile.floorEnd) / 2;
  const height = Math.min(50, h.radius * 0.2);

  test(`motion (${name}): a dropped ball lands antispinward by the blueprint's drop offset`, () => {
    const start = toWorld(h.profile, { theta: 0, s, h: height });
    const end = coast(h, start, [0, 0, 0], 60, 1 / 480, (p) => Math.hypot(p[0], p[1]) >= h.radius);
    const theta = Math.atan2(end.p[1], end.p[0]);
    assert.ok(theta < 0, 'lands behind (antispinward)');
    assert.ok(Math.abs(-theta * h.radius - h.dropOffset(height)) < 0.02 * h.dropOffset(height) + 0.01, `${-theta * h.radius} vs ${h.dropOffset(height)}`);
  });

  test(`physics (${name}): Rapier in the turning frame drops a ball the same way and it comes to rest`, async () => {
    const world = await PhysicsWorld.create(h);
    world.setGround(buildPatch(t, 0, s, 192, 2));
    const radius = 0.25;
    const id = world.addBall(toWorld(h.profile, { theta: 0, s, h: height + radius }), [0, 0, 0], radius);
    let landed: number | null = null;
    for (let i = 0; i < 120 * 20 && landed === null; i++) {
      world.advance(1 / 120);
      const b = world.states().find((x) => x.id === id)!;
      const at = fromWorld(h.profile, ...b.position);
      if (at.h < radius + 0.05) landed = at.theta > Math.PI ? at.theta - 2 * Math.PI : at.theta;
    }
    assert.ok(landed !== null, 'landed');
    const off = -landed! * h.radius, want = h.dropOffset(height);
    assert.ok(Math.abs(off - want) < 0.05 * want + 0.05, `Rapier ${off} vs ${want}`);
    for (let i = 0; i < 120 * 10; i++) world.advance(1 / 120);
    const b = world.states().find((x) => x.id === id);
    assert.ok(b && Math.hypot(...b.velocity) < 0.5, 'at rest on the ground, not through it');
    assert.ok(fromWorld(h.profile, ...b!.position).h > 0, 'above the ground');
    world.dispose();
  });
}
