import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams } from '../src/blueprint';
import { GROUND, courtCap, entrancesOf, fromLake, planOf } from '../src/gen/plan';

const TURN = 2 * Math.PI;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);

for (const { name, params } of MATRIX) {
  const h = derive(params), plan = planOf(h), spec = params.relief.landforms!, R = h.radius, { floorEnd } = h.profile;
  const rings = plan.grounds.filter((g) => g.kind === 'ring'), heights = plan.grounds.filter((g) => g.kind === 'height');

  test(`landforms (${name}): Rings across the worked floor, apart, clear of the lake; Heights on the ridges, tallest first`, () => {
    assert.ok(rings.length >= 1, 'at least one Ring');
    assert.ok(heights.length >= 1 && heights.length <= spec.heights, `${heights.length} Heights of ${spec.heights}`);
    plan.grounds.forEach((g, i) => assert.equal(g.id, i));
    for (const [i, r] of rings.entries()) {
      assert.ok(Math.abs(r.height - spec.ring * R) < 1e-9, 'as high as the blueprint says');
      assert.ok(r.s - r.radius > plan.reserveEnd - GROUND.wander * R && r.s + r.radius < floorEnd + GROUND.wander * R, 'on the worked floor');
      if (plan.lake) assert.ok(Math.abs(r.s - plan.lake.s) >= plan.lake.halfWidth, 'not in the lake');
      if (i) assert.ok(r.s > rings[i - 1].s, 'in order along the axis');
    }
    for (const [i, g] of heights.entries()) {
      assert.ok(g.height <= spec.height * R + 1e-9 && (i === 0 || g.height < heights[i - 1].height), 'the tallest first');
      assert.ok(g.s - g.radius >= plan.reserveEnd && g.s + g.radius <= floorEnd && fromLake(plan.lake, g.s) >= g.radius, 'on the worked floor, off the lake');
      assert.ok(plan.ridgeAt(g.theta, g.s) > 0.9, 'on a ridge between valleys');
      for (const o of heights.slice(0, i)) assert.ok(Math.hypot(wrap(o.theta - g.theta) * R, o.s - g.s) >= o.radius + g.radius, 'apart');
    }
  });

  test(`landforms (${name}): a Height's plateau at its full height, a Ring's crest over the ridges and saddles over the valleys, open where rivers run`, () => {
    for (const g of heights) {
      const on = plan.landformAt(g.theta, g.s)!;
      assert.ok(on && Math.abs(on.top - g.height) < 1e-6 && on.share === 1, 'its plateau');
      assert.equal(plan.landformAt(g.theta, g.s + g.radius * 1.01)?.form === g ? 'on' : 'off', 'off', 'nothing past its foot');
    }
    for (const r of rings) {
      // Over a ridge between two valleys (where no river runs): the crest, at its full height.
      const ridge = wrap(plan.valleyAt(0, r.s) + Math.PI / plan.valleys), s = plan.ringLine(r, ridge), on = plan.landformAt(ridge, s);
      assert.ok(on && on.form.kind === 'ring' && on.top >= r.height * 0.999 - 1e-9, `its crest ${on?.top.toFixed(1)} of ${r.height}`);
      // Over the main valley's Sunwalk side: a saddle, lower than the crest.
      const walk = plan.valleyAt(0, r.s) + (0.25 * Math.PI) / plan.valleys, saddle = plan.landformAt(walk, plan.ringLine(r, walk));
      assert.ok(!saddle || saddle.top < r.height * 0.7, 'a saddle where the Sunwalk crosses');
      // Steep toward the port, long toward the wild end.
      const fall = (d: number): number => plan.landformAt(ridge, s + d)?.top ?? 0;
      assert.ok(fall(r.height * 0.6) < fall(-r.height * 0.6), 'its steep face looks to the port');
      assert.notEqual(plan.landformAt(ridge, s - r.radius)?.form, r, 'nothing of it past its long slope');
      // Where a river runs through, the land is open.
      for (const river of plan.rivers) {
        const s0 = plan.ringLine(r, plan.routeOf(river, r.s)), theta = plan.routeOf(river, s0), at = plan.landformAt(theta, s0);
        assert.ok(!at || at.form.kind !== 'ring' || at.top < 1e-6, `a gorge for the ${river.role}`);
      }
    }
  });

  test(`landforms (${name}): entrances keep to the landforms' feet, never their tops or faces`, () => {
    const cap = courtCap(h);
    for (const e of entrancesOf(plan)) {
      const on = plan.landformAt(e.theta, e.s);
      assert.ok(!on || on.top <= cap + 1e-9, `an entrance ${on?.top.toFixed(0)} m up a ${on?.form.kind}`);
    }
  });
}

test('landforms: none without them in the blueprint; invalid ones are refused', () => {
  const p = MATRIX[0].params, none = derive(withParams({ relief: { ...p.relief, landforms: null } }));
  assert.equal(planOf(none).grounds.length, 0);
  assert.equal(planOf(none).landformAt(0, (none.profile.floorStart + none.profile.floorEnd) / 2), null);
  const bad = derive(withParams({ relief: { ...p.relief, landforms: { ring: 0.3, ringEvery: 1, height: 0.2, heights: 1.5 } } }));
  assert.ok(validate(bad).some((x) => x.id === 'relief' && x.severity === 'invalid'));
});
