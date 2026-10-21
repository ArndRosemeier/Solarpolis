import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld } from '../src/blueprint';
import { Walker, EYE_HEIGHT } from '../src/world/walker';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

for (const { name, params } of MATRIX) {
  const h = derive(params);
  test(`walker (${name}): on the floor, up points at the axis and forward runs to the port end`, () => {
    const w = new Walker(h.profile);
    const v = w.view();
    const r = Math.hypot(v.eye[0], v.eye[1]);
    assert.ok(Math.abs(r - (h.radius - EYE_HEIGHT)) < 1e-6 * h.radius);
    assert.ok(dot(v.up, [-v.eye[0] / r, -v.eye[1] / r, 0]) > 0.9999, 'up is towards the axis');
    assert.ok(v.look[2] > 0.9999, 'heading 0 looks towards the port end (+z)');
    assert.ok(Math.abs(Math.hypot(...v.look) - 1) < 1e-9 && Math.abs(Math.hypot(...v.up) - 1) < 1e-9);
  });

  test(`walker (${name}): right is right, steps keep to the ground, and turning is smooth`, () => {
    const w = new Walker(h.profile);
    const v0 = w.view();
    const right = cross(v0.look, v0.up);
    w.step({ forward: 0, right: 1 }, 10);
    const v1 = w.view();
    const moved = [v1.eye[0] - v0.eye[0], v1.eye[1] - v0.eye[1], v1.eye[2] - v0.eye[2]];
    assert.ok(dot(moved, right) > 0, 'a step right moves to the screen\'s right');
    const rightHere = cross(v1.look, v1.up);
    w.turn(Math.PI / 2, 0);
    const v2 = w.view();
    assert.ok(dot(v2.look, rightHere) > 0.999, 'turning a quarter right looks where right was');
    for (let i = 0; i < 50; i++) w.step({ forward: 1, right: 0.3 }, 7);
    const at = fromWorld(h.profile, ...w.view().eye);
    assert.ok(Math.abs(at.h - EYE_HEIGHT) < 1e-3, 'still at eye height above the ground');
  });

  test(`walker (${name}): on an endcap slope, up leans towards the open side`, () => {
    const w = new Walker(h.profile, { theta: 1, s: h.profile.floorStart / 2, h: EYE_HEIGHT });
    const v = w.view();
    assert.ok(v.up[2] > 0.05, 'on the wild slope, up leans towards the port end');
    assert.ok(Math.abs(dot(v.up, v.look)) < 1e-9, 'level look is along the ground');
  });
}
