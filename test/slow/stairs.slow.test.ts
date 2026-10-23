/**
 * Climbing the habitat's real stairs (slow: a few seconds per habitat). The Lift Stair at its foot, halfway and near
 * its top, where a riser is a metre or more in a fraction of a g, and the courts' stairs from the paving up to their
 * landing. Before the body took its own steps (2026-10-23), Rapier's autostep stalled on most of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, type Vec3 } from '../../src/blueprint';
import { legShapesOf, liftStairOf, onLeg, rampOf } from '../../src/gen/liftStair';
import { buildStairSolid } from '../../src/gen/liftStairMesh';
import { courtLayoutOf, courtSites, courtWorld } from '../../src/gen/courts';
import { buildPatch } from '../../src/gen/patch';
import { PhysicsWorld, PHYSICS_STEP } from '../../src/physics/world';
import type { Character } from '../../src/physics/character';
import { terrainOf } from '../worlds';

/** Walk at `speed` through `points` in turn (within 0.35 m of each) for up to `seconds`: how many it reached. */
function walkThrough(world: PhysicsWorld, c: Character, points: Vec3[], speed: number, seconds: number): number {
  let k = 0;
  for (let t = 0; t < seconds && k < points.length; t += PHYSICS_STEP) {
    const f = c.feet(), g = points[k], d: Vec3 = [g[0] - f[0], g[1] - f[1], g[2] - f[2]], n = Math.hypot(...d);
    if (n < 0.35) { k++; continue; }
    c.stride.walk = [(d[0] / n) * speed, (d[1] / n) * speed, (d[2] / n) * speed];
    world.advance(PHYSICS_STEP);
  }
  return k;
}

for (const { name, params } of MATRIX) {
  test(`stairs (${name}): one walks up the Lift Stair, at its foot, halfway and near the top`, async () => {
    const t = terrainOf(name, params), h = t.habitat, st = liftStairOf(h);
    if (!st) return;
    const ramp = rampOf(h), legs = legShapesOf(st), world = await PhysicsWorld.create(h);
    for (const i of [0, Math.floor(legs.length / 2), legs.length - 2]) {
      const s = legs[i], steps = s.steps.slice(0, 9);
      const points = steps.map((k) => { const p = onLeg(s, (k.a0 + k.a1) / 2, 0); return ramp.world(p[0], p[1], k.top); });
      const p0 = onLeg(s, (steps[0].a0 + steps[0].a1) / 2, 0), start = ramp.world(p0[0], p0[1], steps[0].top + 0.05);
      world.setGround({ ...buildStairSolid(h, start, 40)!, theta: 0, s: 0, origin: start, size: 80, below: false, trunks: new Float32Array() });
      const c = world.addCharacter(start);
      for (let k = 0; k < 20; k++) world.advance(PHYSICS_STEP);
      const reached = walkThrough(world, c, points, 3, 15);
      assert.equal(reached, points.length, `leg ${i} of ${legs.length} (risers ${s.leg.riser.toFixed(2)} m): reached step ${reached} of ${points.length}`);
    }
    world.dispose();
  });

  test(`stairs (${name}): one walks up a court's stair from the paving to the landing`, async () => {
    const t = terrainOf(name, params), h = t.habitat;
    if (!courtSites.gridOf(t)) return;
    const world = await PhysicsWorld.create(h);
    for (const i of [0, Math.floor(t.courts.length / 2)]) {
      const l = courtLayoutOf(t, i)!, steps = l.stairs[0].steps, r = (l.inner + l.face) / 2;
      const at = (a: number, z: number): Vec3 => courtWorld(h, l.court, [Math.cos(a) * r, Math.sin(a) * r, z]);
      const last = steps[steps.length - 1], landing = (l.landing.a0 + l.landing.a1) / 2;
      const points = [...[...steps].reverse().map((s) => at((s.a0 + s.a1) / 2, s.top)), at(landing, l.landing.top)];
      const where = fromWorld(h.profile, ...points[0]);
      world.setGround(buildPatch(t, where.theta, where.s, 64, 2));
      const c = world.addCharacter(at(last.a1 + (last.a1 - last.a0) * 1.5, l.pave + 0.05));
      for (let k = 0; k < 20; k++) world.advance(PHYSICS_STEP);
      const reached = walkThrough(world, c, points, 2, 20);
      assert.equal(reached, points.length, `court ${i}: reached ${reached} of ${points.length} (${steps.length} steps and the landing)`);
    }
    world.dispose();
  });
}
