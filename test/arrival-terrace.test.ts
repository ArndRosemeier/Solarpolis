import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, validate } from '../src/blueprint';
import { arrivalTerraceOf, revealAt, REVEAL_SECONDS } from '../src/world/arrival';
import { liftStairOf, rampOf, stairStandAt, stairTopAt } from '../src/gen/liftStair';
import { EYE_HEIGHT, VIEW_FOV, Walker } from '../src/world/walker';
import { habitatOf } from './worlds';

for (const { name } of MATRIX) test(`arrival terrace (${name}): reveal stays above a real landing and hands over without a camera jump`, () => {
  const h = habitatOf(name), terrace = arrivalTerraceOf(h), stair = liftStairOf(h);
  if (!stair) { assert.equal(terrace, null, 'a blueprint without a Lift Stair keeps its existing hub arrival'); return; }
  assert.ok(terrace);
  const q = terrace.platform, ramp = rampOf(h), lastLeg = stair.legs[stair.legs.length - 1];
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
