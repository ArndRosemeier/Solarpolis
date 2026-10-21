import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, type Vec3 } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { Flyer, MIN_CLEARANCE } from '../src/world/flyer';
import { Walker } from '../src/world/walker';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const inward = (p: Vec3): Vec3 => { const r = Math.hypot(p[0], p[1]); return [-p[0] / r, -p[1] / r, 0]; };

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const t = makeTerrain(h);

  test(`flyer (${name}): stays above the ground, climbs to the axis and rolls over it smoothly, lands facing its way`, () => {
    const walker = new Walker(h.profile, undefined, t.standAt);
    const f = new Flyer(h.profile, walker.view(), t.standAt);
    // Diving into the ground stops a little above it.
    f.turn(0, -1.4);
    for (let i = 0; i < 100; i++) f.step({ forward: 1, right: 0, up: -1 }, 0.05);
    assert.ok(f.clearance() >= MIN_CLEARANCE - 1e-6, `clearance ${f.clearance()}`);
    // Climb straight up toward the axis and on past it: up turns at a bounded rate and never jumps.
    const dt = 0.05;
    let prev = f.up, crossed = false;
    for (let i = 0; i < 4000 && !crossed; i++) {
      f.step({ forward: 0, right: 0, up: 1 }, dt);
      const turn = Math.acos(Math.min(1, dot(prev, f.up)));
      assert.ok(turn <= 1.2 * dt + 1e-6, `up turned ${turn} in one step`);
      prev = f.up;
      if (Math.hypot(f.eye[0], f.eye[1]) > h.radius * 0.3 && dot(f.up, inward(f.eye)) < 0) crossed = true;
    }
    assert.ok(crossed, 'flew across the axis');
    for (let i = 0; i < 200; i++) f.step({ forward: 0, right: 0, up: 0 }, dt);
    assert.ok(dot(f.up, inward(f.eye)) > 0.999, 'up settles toward the axis again');
    assert.ok(Math.abs(Math.hypot(...f.look) - 1) < 1e-9);
    // Landing: on the ground under the flyer, facing the way it looked along the ground.
    f.turn(0.7, 0);
    const at = fromWorld(h.profile, ...f.eye);
    walker.land(at.theta, at.s, f.look);
    const w = walker.view();
    const flat = (v: Vec3): Vec3 => { const d = dot(v, w.up); const x: Vec3 = [v[0] - d * w.up[0], v[1] - d * w.up[1], v[2] - d * w.up[2]]; const l = Math.hypot(...x); return [x[0] / l, x[1] / l, x[2] / l]; };
    assert.ok(dot(flat(w.look), flat(f.look)) > 0.99, 'landed facing the flight direction');
  });
}
