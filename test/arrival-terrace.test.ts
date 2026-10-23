import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, validate } from '../src/blueprint';
import { arrivalTerraceOf, revealAt, REVEAL_CHASE, REVEAL_SECONDS } from '../src/world/arrival';
import { liftStairOf, rampOf, stairStandAt, stairTopAt } from '../src/gen/liftStair';
import { EYE_HEIGHT, VIEW_FOV, Walker } from '../src/world/walker';
import { habitatOf } from './worlds';

for (const { name } of MATRIX) test(`arrival terrace (${name}): reveal stays above a real landing and hands over without a camera jump`, () => {
  const h = habitatOf(name), terrace = arrivalTerraceOf(h), stair = liftStairOf(h);
  if (!stair) { assert.equal(terrace, null, 'a blueprint without a Lift Stair keeps its existing hub arrival'); return; }
  assert.ok(terrace);
  const q = terrace.platform, ramp = rampOf(h), lastLeg = stair.topLeg;
  assert.deepEqual(terrace.exit, [lastLeg.to.z, lastLeg.to.w], 'directions lead to the actual opening');
  for (let t = 0; t <= REVEAL_SECONDS; t += 0.25) {
    const frame = revealAt(h, terrace, t), plan = ramp.plan(frame.eye);
    assert.ok(frame.eye.every(Number.isFinite) && frame.look.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...frame.look) - 1) < 1e-8);
    assert.ok(plan.z > q.z0 + terrace.handrail && plan.z < q.z1 - terrace.handrail);
    assert.ok(plan.w > q.w0 + stair.parapet && plan.w < q.w1 - stair.parapet);
    assert.ok(Math.abs(plan.e - q.e - EYE_HEIGHT) < 1e-7, 'eyes stay at walking height');
    assert.equal(stairTopAt(stair, [plan.z, plan.w]), q.e, 'every cinematic frame has the landing underneath');
  }
  const end = revealAt(h, terrace, REVEAL_SECONDS), at = fromWorld(h.profile, ...terrace.feet);
  assert.equal(end.fov, VIEW_FOV, 'the reveal widens into the walking view, not past it');
  assert.ok(stairStandAt(h, at.theta, at.s) !== null, 'normal walking also finds the landing');
  const walker = new Walker(h.profile);
  walker.place(at.theta, at.s, end.heading); walker.follow(terrace.feet); walker.pitch = end.pitch;
  const actual = walker.view();
  for (const key of ['eye', 'look', 'up'] as const) for (let k = 0; k < 3; k++) assert.ok(Math.abs(actual[key][k] - end[key][k]) < 1e-7);
});

test('arrival: the welcome names the habitat by its own Mind, and a habitat without one is invalid', () => {
  for (const { params } of MATRIX) assert.ok(params.mind.trim().length > 0);
  assert.ok(validate(derive({ ...MATRIX[0].params, mind: ' ' })).some((f) => f.id === 'mind' && f.severity === 'invalid'));
  assert.ok(!validate(derive(MATRIX[0].params)).some((f) => f.id === 'mind'));
});

for (const { name } of MATRIX) test(`arrival (${name}): the newcomer walks out with the camera behind, never back through the door`, () => {
  const h = habitatOf(name), terrace = arrivalTerraceOf(h);
  if (!terrace) return;
  const q = terrace.platform, ramp = rampOf(h);
  let walked = 0, timed = 0, last = revealAt(h, terrace, 0);
  for (let t = 0.1; t <= REVEAL_SECONDS + 1e-9; t += 0.1) {
    const f = revealAt(h, terrace, t), feet = ramp.plan(f.feet), eye = ramp.plan(f.eye);
    assert.ok(Math.abs(feet.e - q.e) < 1e-7 && Math.abs(eye.e - q.e - EYE_HEIGHT) < 1e-7, 'the body stands on the landing, its eyes over it');
    assert.ok(Math.abs(Math.hypot(...f.front) - 1) < 1e-9 && Math.abs(f.front[0] * f.up[0] + f.front[1] * f.up[1] + f.front[2] * f.up[2]) < 1e-9, 'it faces along the floor');
    // The camera: `chase` behind the eyes along the look, in front of the door.
    const camera = ramp.plan(f.eye.map((v, k) => v - f.look[k] * f.chase) as [number, number, number]);
    assert.ok((terrace.door - camera.z) * Math.sign(terrace.start[0] - terrace.finish[0]) > 0.2, 'the camera stays in front of the door');
    assert.ok(f.chase >= 0.5 && f.chase <= REVEAL_CHASE.to + 1e-9);
    walked += Math.hypot(...f.feet.map((v, k) => v - last.feet[k])); timed += (f.speed + last.speed) / 2 * 0.1; last = f;
    assert.ok(f.speed >= 0 && f.speed < 3, 'a walk, not a run');
  }
  assert.ok(walked > Math.abs(terrace.finish[0] - terrace.start[0]) - 1e-6, 'it walks from the door to the overlook');
  assert.ok(Math.abs(timed - walked) < walked * 0.01, 'at the speed its legs are animated for');
  assert.equal(revealAt(h, terrace, 0).speed, 0);
  assert.equal(revealAt(h, terrace, REVEAL_SECONDS).speed, 0, 'standing when the walking view takes over');
});

for (const { name } of MATRIX) test(`arrival (${name}): the capsule berth is clear of the walk, the rails and the porch`, () => {
  const h = habitatOf(name), terrace = arrivalTerraceOf(h), stair = liftStairOf(h);
  if (!terrace || !stair || stair.threshold) return; // with galleries, on the lowest of them (threshold.test.ts)
  const q = terrace.platform, b = terrace.berth;
  if (!b) { assert.ok(q.w1 - q.w0 < 2 * (stair.parapet + 2.75 * terrace.handrail) + 1e-9 || q.z1 - q.z0 < 12 * terrace.handrail, 'only a landing too small has none'); return; }
  const c = rampOf(h).plan(b.at);
  assert.ok(Math.abs(c.e - q.e) < 1e-7, 'on the floor');
  assert.ok(b.clear >= 3, 'room for a capsule');
  assert.ok(c.w - b.clear >= q.w0 + stair.parapet - 1e-9 && c.w + b.clear <= q.w1 - stair.parapet + 1e-9 && c.z - b.clear >= q.z0 + stair.parapet - 1e-9, 'inside the parapets');
  assert.ok(c.z + b.clear < terrace.finish[0], 'short of where the walk ends');
  assert.ok(c.z + b.clear < q.z1 - (q.z1 - q.z0) * 0.52 - terrace.handrail * 0.13, 'clear of the porch and its canopy');
  // The lamps at the landing's front corners stand outside it.
  const inset = stair.parapet + terrace.handrail * 0.4;
  for (const w of [q.w0 + inset, q.w1 - inset]) assert.ok(Math.hypot(q.z0 + inset - c.z, w - c.w) > b.clear, 'clear of the lamps');
  const up = [-b.at[0], -b.at[1], 0], u = Math.hypot(...up);
  assert.ok(Math.abs(Math.hypot(...b.out) - 1) < 1e-9 && Math.abs((b.out[0] * up[0] + b.out[1] * up[1]) / u) < 1e-9, 'its door faces along the floor');
});
