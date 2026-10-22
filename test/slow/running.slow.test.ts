/**
 * Many fast runs (slow: a few seconds): over flat ground on several rows of every habitat in the `MATRIX`, and in all
 * directions from spots all over the reference's floor (hills, valleys, rivers, courts). Nothing may throw the runner
 * up: before the fix (2026-10-22) 97 of 192 reference runs were popped up a seam, and the worst flew 7 m high.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, toWorld, withParams, type Vec3 } from '../../src/blueprint';
import { makeTerrain } from '../../src/gen/terrain';
import { buildPatch } from '../../src/gen/patch';
import { upAt } from '../../src/world/motion';
import { PhysicsWorld } from '../../src/physics/world';
import { RUN, around, rise } from '../runs';

for (const { name, params } of MATRIX) {
  const h = derive(withParams({ relief: { hills: 0, ringLake: null, terraceStep: params.relief.terraceStep, massif: 0, rivers: null }, landmarks: null }, params));
  const t = makeTerrain(h);
  const s = (h.profile.floorStart + h.profile.floorEnd) / 2 + Math.min(1234, (h.profile.floorEnd - h.profile.floorStart) / 4);
  test(`running (${name}): fast runs over flat ground on many rows stay on it`, async () => {
    for (const theta of [0.5, 2, 4]) {
      const world = await PhysicsWorld.create(h);
      world.setGround(buildPatch(t, theta, s, 96, 1));
      for (const ds of [-36, -12, 12, 36]) for (const sign of [-1, 1]) {
        const start = theta - (sign * 30) / h.radius;
        const c = world.addCharacter(toWorld(h.profile, { theta: start, s: s + ds, h: t.heightAt(start, s + ds) + 0.05 }));
        world.advance(0.1);
        const lift = rise(world, c, t, () => around(c, sign), RUN, 1.5);
        assert.ok(lift < 0.1, `θ ${theta}, ${ds} m along, ${sign > 0 ? 'spinward' : 'antispinward'}: rose ${lift.toFixed(2)} m`);
      }
      world.dispose();
    }
  });
}

test('running (reference): fast runs every way over the whole floor are never thrown up', async () => {
  const h = derive(REFERENCE), t = makeTerrain(h);
  const { floorStart, floorEnd } = h.profile;
  for (let k = 0; k < 24; k++) {
    const theta = (k * 2.39996) % (2 * Math.PI), s = floorStart + 300 + ((k * 0.618034) % 1) * (floorEnd - floorStart - 600);
    const world = await PhysicsWorld.create(h);
    world.setGround(buildPatch(t, theta, s, 192, 1));
    for (let dir = 0; dir < 8; dir++) {
      const c = world.addCharacter(toWorld(h.profile, { theta, s, h: t.standAt(theta, s) + 0.05 }), t.waterDepth);
      world.advance(0.25);
      const a = (dir * Math.PI) / 4;
      const way = (): Vec3 => { const up = upAt(c.feet())!; return [Math.sin(a) * up[1], -Math.sin(a) * up[0], Math.cos(a)]; };
      const lift = rise(world, c, t, way, RUN, 2);
      assert.ok(lift < 0.3, `θ ${theta.toFixed(2)}, s ${s.toFixed(0)}, heading ${dir * 45}°: rose ${lift.toFixed(2)} m`);
    }
    world.dispose();
  }
});
