import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOINT, LIMB, SLOT, STAND_IN_ATTRIBUTES, STAND_IN_STRIDE, hexColor, packColor, standInArrays } from '../src/gen/standIn';

test('stand-in: one body of height 1, feet on the ground, every part dressed and on its limb', () => {
  const a = standInArrays(), n = a.positions.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, a.positions[i * 3 + 1]); hi = Math.max(hi, a.positions[i * 3 + 1]); }
  assert.ok(Math.abs(lo) < 1e-6, `soles at ${lo}`);
  assert.ok(hi > 0.99 && hi < 1.01, `crown at ${hi}`);
  const slots = new Set(Object.values(SLOT)), limbs = new Set(Object.values(LIMB));
  for (let i = 0; i < n; i++) {
    assert.ok(slots.has(a.parts[i * 2] as never) && limbs.has(a.parts[i * 2 + 1] as never));
    assert.ok(Math.abs(Math.hypot(a.normals[i * 3], a.normals[i * 3 + 1], a.normals[i * 3 + 2]) - 1) < 1e-5);
  }
  for (const i of a.index) assert.ok(i < n);
  // Legs below the hips, arms below the shoulders, each limb on its own side.
  for (let i = 0; i < n; i++) {
    const limb = a.parts[i * 2 + 1], x = a.positions[i * 3], y = a.positions[i * 3 + 1];
    if (limb === LIMB.thighL || limb === LIMB.shinL) assert.ok(x > 0 && y <= JOINT.hip.y);
    if (limb === LIMB.thighR || limb === LIMB.shinR) assert.ok(x < 0 && y <= JOINT.hip.y);
    if (limb === LIMB.armL || limb === LIMB.forearmL) assert.ok(x > 0 && y <= JOINT.shoulder.y);
  }
  assert.equal(STAND_IN_ATTRIBUTES.length * 4, STAND_IN_STRIDE);
});

test('stand-in: a colour packs into one float and back', () => {
  for (const hex of ['#000000', '#ffffff', '#3566a8', '#a3161d']) {
    const c = hexColor(hex), v = packColor(c);
    assert.ok(Number.isInteger(v) && v < 2 ** 24 && Math.fround(v) === v);
    assert.deepEqual([v % 256, Math.floor(v / 256) % 256, Math.floor(v / 65536)].map((x) => x / 255), c);
  }
});
