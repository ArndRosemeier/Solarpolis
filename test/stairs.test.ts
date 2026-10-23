/**
 * Climbing steps (Arnd, 2026-10-23: "stairs are a problem for the character to climb"). The legs take a step up as
 * high as their work lifts the body where it is (`stepUpAt`): half a metre at 1 g, more as the weight fades, so every
 * riser the habitat builds by gravity (`riserAt`: the Lift Stair, the courts' stairs) is a step, not a wall. The real
 * stairs are climbed in test/slow/stairs.slow.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, type Vec3 } from '../src/blueprint';
import type { GroundPatch } from '../src/gen/patch';
import { riserAt, TREAD } from '../src/gen/liftStair';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';
import { HUMAN, stepUpAt } from '../src/physics/character';
import { habitatOf } from './worlds';

/**
 * A ground patch of `n` steps (`riser` high, `tread` deep, 3 m wide) up along +z from a level floor, around the world
 * point (0, −r, 0), where up is +y; and its origin.
 */
function stairsAt(r: number, riser: number, tread: number, n: number): GroundPatch {
  const P: number[] = [], I: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => { const k = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  quad([-20, 0, -20], [-20, 0, 2], [20, 0, 2], [20, 0, -20]);
  for (let i = 0; i < n; i++) {
    const z = 2 + i * tread, y0 = i * riser, y1 = (i + 1) * riser;
    quad([-1.5, y0, z], [-1.5, y1, z], [1.5, y1, z], [1.5, y0, z]);
    quad([-1.5, y1, z], [-1.5, y1, z + tread], [1.5, y1, z + tread], [1.5, y1, z]);
  }
  quad([-1.5, n * riser, 2 + n * tread], [-1.5, n * riser, 30], [1.5, n * riser, 30], [1.5, n * riser, 2 + n * tread]);
  return { theta: 0, s: 0, origin: [0, -r, 0], size: 64, below: false, positions: new Float32Array(P), index: new Uint32Array(I), trunks: new Float32Array(0) };
}

/** Walk at `speed` along +z from the floor for up to `seconds`: how high the feet got. */
function climb(world: PhysicsWorld, r: number, speed: number, seconds: number, top: number): number {
  const c = world.addCharacter([0, -r, 0]);
  for (let i = 0; i < 20; i++) world.advance(PHYSICS_STEP);
  let high = 0;
  for (let t = 0; t < seconds && high < top - 0.05; t += PHYSICS_STEP) {
    c.stride.walk = [0, 0, speed];
    world.advance(PHYSICS_STEP);
    high = Math.max(high, c.feet()[1] + r);
  }
  return high;
}

test('step up: half a metre at 1 g, higher as the weight fades, never above the body; every riser built by gravity is a step', () => {
  assert.ok(Math.abs(stepUpAt(9.81) - 0.5) < 1e-9);
  assert.ok(Math.abs(stepUpAt(9.81 / 2) - 1) < 1e-9);
  assert.equal(stepUpAt(0), HUMAN.height);
  for (const { name } of MATRIX) {
    const h = habitatOf(name), hr = h.params.landmarks?.handrail ?? 1.1, g0 = h.gravityAt(h.radius);
    for (let g = 0.01; g <= 1.5; g += 0.01) assert.ok(riserAt(hr, g) < stepUpAt(g * g0), `${name}: a ${riserAt(hr, g).toFixed(2)} m riser at ${g.toFixed(2)} g`);
  }
});

for (const { name } of MATRIX) {
  const h = habitatOf(name), hr = h.params.landmarks?.handrail ?? 1.1, R = h.radius;

  test(`stairs (${name}): the feet climb the floor's stairs at a walk, short treads too, and a knee-high ledge; not a wall`, async () => {
    const world = await PhysicsWorld.create(h);
    for (const [riser, tread] of [[riserAt(hr, 1), TREAD * hr], [0.16, 0.28], [0.45, 0.5]]) {
      world.setGround(stairsAt(R, riser, tread, 4));
      const high = climb(world, R, 2, 4, 4 * riser);
      assert.ok(high > 4 * riser - 0.05, `${riser.toFixed(2)} m risers, ${tread.toFixed(2)} m treads: up ${high.toFixed(2)} m of ${(4 * riser).toFixed(2)}`);
    }
    // Higher than the legs take at 1 g: a ledge to jump onto, not a step.
    world.setGround(stairsAt(R, 0.7, 1, 1));
    assert.ok(climb(world, R, 2, 1.5, 0.7) < 0.1, 'a 0.7 m ledge stops a walker at 1 g');
    world.dispose();
  });

  test(`stairs (${name}): nearer the axis, where the body weighs 0.75 g, a ledge the floor's legs refuse is a step`, async () => {
    // At 0.75 of the radius the spin presses 0.75 g: the Lift Stair's risers there, and 0.6 m (the legs take 0.5 at 1 g).
    const r = 0.75 * R, world = await PhysicsWorld.create(h);
    for (const riser of [riserAt(hr, 0.75), 0.6]) {
      world.setGround(stairsAt(r, riser, TREAD * hr, 3));
      const high = climb(world, r, 2, 4, 3 * riser);
      assert.ok(high > 3 * riser - 0.05, `${riser.toFixed(2)} m risers at 0.75 g: up ${high.toFixed(2)} m`);
    }
    world.dispose();
  });
}
