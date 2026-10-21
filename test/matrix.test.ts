/**
 * The blueprint matrix (src/blueprint/reference.ts): every habitat in it must pass the same invariants, so code that
 * only works at the reference size fails here. New stages add their invariants to this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, validate, isValid, toWorld, fromWorld, groundNormal, MATRIX } from '../src/blueprint';

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const P = h.profile;

  test(`matrix ${name}: valid, with gravity at the floor equal to the parameter`, () => {
    assert.ok(isValid(validate(h)), validate(h).map((f) => f.message).join('; '));
    assert.ok(Math.abs(h.gravityAt(h.radius) - params.floorGravity) < 1e-9);
  });

  test(`matrix ${name}: the profile runs from the wild axis along the floor to the port hub`, () => {
    const start = P.at(0), end = P.at(P.length);
    assert.ok(Math.abs(start.z) < 1e-9 && Math.abs(start.r) < 1e-9, 'starts on the axis at the wild wall');
    assert.ok(Math.abs(end.z - h.length) < 1e-6 && Math.abs(end.r - params.hubRadius) < 1e-6, 'ends at the hub at the port wall');
    assert.ok(P.floorStart > 0 && P.floorEnd > P.floorStart && P.floorEnd < P.length);
    const mid = P.at((P.floorStart + P.floorEnd) / 2);
    assert.ok(Math.abs(mid.r - h.radius) < 1e-6 && Math.abs(mid.nr + 1) < 1e-9, 'the floor lies at R, its up pointing at the axis');
    let lastZ = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const p = P.at((P.length * i) / 200);
      assert.ok(p.z >= lastZ - 1e-9, 'z never runs backwards');
      assert.ok(p.r >= -1e-9 && p.r <= h.radius + 1e-6, 'r stays between the axis and the floor');
      assert.ok(Math.abs(Math.hypot(p.nz, p.nr) - 1) < 1e-9, 'unit normal');
      lastZ = p.z;
    }
  });

  test(`matrix ${name}: world and interior coordinates convert back and forth`, () => {
    // Above and below the curve, on the floor and the endcap slopes (terraces sink a slope's ground below its curve).
    const lifts = [Math.min(50, h.radius * 0.05), -Math.min(90, h.radius * 0.03)];
    const pts = [0.05, 0.3, 0.5, 0.9, 0.97].flatMap((f) => [0.1, 2.5, 5.9].flatMap((theta) => lifts.map((lift) => ({ theta, s: P.length * f, h: lift }))));
    for (const q of pts) {
      const [x, y, z] = toWorld(P, q);
      const back = fromWorld(P, x, y, z);
      assert.ok(Math.abs(back.theta - q.theta) < 1e-9, `θ ${q.theta} → ${back.theta}`);
      assert.ok(Math.abs(back.s - q.s) < 1e-6 * h.radius, `s ${q.s} → ${back.s}`);
      assert.ok(Math.abs(back.h - q.h) < 1e-6 * h.radius, `h ${q.h} → ${back.h}`);
      const n = groundNormal(P, q.theta, q.s);
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
    }
  });
}
