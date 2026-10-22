/**
 * Running fast into a river (Arnd, 2026-10-22: low gravity "on one side of the central river"): water brakes a fast body
 * hard, and the bank beyond throws nobody into the air.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE, toWorld, type Habitat } from '../src/blueprint';
import { buildPatch } from '../src/gen/patch';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';
import type { Terrain } from '../src/gen/terrain';
import { terrainOf } from './worlds';
import { RUN, around, rise } from './runs';

/** The middle of the reference's first river, halfway along it, and a body standing `out` metres from it. */
function riverSide(h: Habitat, t: Terrain, out: number): { theta: number; s: number; start: number } {
  const river = t.rivers[0];
  const i = Math.floor(river.count / 2), s = river.s0 + i * river.step;
  const theta = river.theta[i], r = h.profile.at(s).r;
  return { theta, s, start: theta + (river.halfWidth[i] + out) / r };
}

const t = terrainOf('reference', REFERENCE), h = t.habitat;

test('running (reference): a run into the river stops in the water, and its far bank throws nobody', async () => {
  const { theta, s, start } = riverSide(h, t, 20);
  const world = await PhysicsWorld.create(h);
  world.setGround(buildPatch(t, theta, s, 64, 1));
  const c = world.addCharacter(toWorld(h.profile, { theta: start, s, h: t.standAt(start, s) + 0.05 }), t.waterDepth);
  world.advance(0.25);
  // Antispinward (toward smaller θ) straight across: the lighter way, where the bank used to fling runners 8 m up.
  let wet = 0, fastest = 0;
  const lift = rise(world, c, t, () => around(c, -1), RUN, 1.5, () => {
    if (c.swimming) wet += PHYSICS_STEP;
    if (wet > 0.3) fastest = Math.max(fastest, Math.hypot(...c.velocity));
  });
  assert.ok(wet > 0, 'the runner reached deep water');
  assert.ok(fastest < 3, `still ${fastest.toFixed(1)} m/s after 0.3 s in the water`);
  assert.ok(lift < 0.3, `rose ${lift.toFixed(2)} m`);
  world.dispose();
});
