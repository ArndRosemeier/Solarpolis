/** The notice to newcomers at the port door (src/gen/welcomeSign.ts), over the matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { arrivalTerraceOf, porchOf } from '../src/gen/arrivalTerrace';
import { liftStairOf, rampOf } from '../src/gen/liftStair';
import { STANDARD_G, gText, welcomeSignOf } from '../src/gen/welcomeSign';
import { habitatOf } from './worlds';

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('welcome sign: gravities print as the notice writes them', () => {
  assert.equal(gText(0.0396), '0.04 g');
  assert.equal(gText(0.0392), '0.039 g');
  assert.equal(gText(1.00034), '1 g');
  assert.equal(gText(0.951), '0.95 g');
});

for (const { name } of MATRIX) {
  test(`welcome sign (${name}): over the walk from the port door, facing it, saying how light it is here`, () => {
    const h = habitatOf(name), terrace = arrivalTerraceOf(h), st = liftStairOf(h), sign = welcomeSignOf(h);
    if (!terrace || !st) { assert.equal(sign, null); return; }
    assert.ok(sign, 'a light landing has its notice');
    const q = terrace.platform, hr = st.handrail, porch = porchOf(q, hr, st.parapet), f = sign.plan;
    // Under the porch, between its posts, over everyone's head.
    assert.ok(f.z > q.z0 && f.z < porch.back && f.w0 > porch.posts[0] && f.w1 < porch.posts[1]);
    assert.ok(f.e0 - q.e > 2 && f.e1 > f.e0, `its foot ${(f.e0 - q.e).toFixed(2)} m over the floor`);
    assert.ok(sign.width > 1 && Math.abs(sign.height - (f.e1 - f.e0)) < 1e-9);
    // Its axes: unit, at right angles, its face toward the door, up away from the floor.
    for (const [a, b] of [[sign.ex, sign.ey], [sign.ey, sign.ez], [sign.ez, sign.ex]]) assert.ok(Math.abs(dot(a, b)) < 1e-9);
    for (const a of [sign.ex, sign.ey, sign.ez]) assert.ok(Math.abs(dot(a, a) - 1) < 1e-9);
    const ramp = rampOf(h), door = ramp.world(terrace.door, (q.w0 + q.w1) / 2, q.e + 1.6), up = ramp.world(f.z, (f.w0 + f.w1) / 2, f.e1 + 1);
    assert.ok(dot(sign.ez, door.map((v, k) => v - sign.at[k])) > 0, 'faces the door');
    assert.ok(dot(sign.ey, up.map((v, k) => v - sign.at[k])) > 0, 'reads upright');
    // What it says: the gravity here, as the habitat has it.
    const here = h.gravityAt(Math.hypot(terrace.feet[0], terrace.feet[1])) / STANDARD_G;
    assert.ok(Math.abs(sign.here - here) < 1e-12 && sign.here < 0.5 * sign.floor);
    const text = sign.lines.map((l) => l.text).join('\n');
    assert.ok(text.includes(gText(sign.here)) && text.includes(gText(sign.floor)), text);
    assert.ok(text.includes(`1/${Math.round(sign.floor / sign.here)}`), text);
    assert.ok(text.toUpperCase().includes(h.params.mind.toUpperCase()));
    assert.equal(sign.lines.filter((l) => l.heading).length, 1);
  });
}
