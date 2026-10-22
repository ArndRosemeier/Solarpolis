import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams } from '../src/blueprint';
import { terrainOf } from './worlds';
import { GROUND, WAY_CLEAR, courtCap, entrancesOf, fromLake, planOf } from '../src/gen/plan';

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
      // Its slope, as the terrain cuts its rock by it: the rise of its surface.
      const s1 = g.s + g.radius * 0.5, e = g.radius * 1e-4, at = plan.landformAt(g.theta, s1)!;
      const rise = ((plan.landformAt(g.theta, s1 + e)?.top ?? 0) - (plan.landformAt(g.theta, s1 - e)?.top ?? 0)) / (2 * e);
      if (at.form === g) assert.ok(Math.abs(at.slope - Math.abs(rise)) < Math.abs(rise) * 0.02, `slope ${at.slope.toFixed(3)} for ${rise.toFixed(3)}`);
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
      for (const d of [r.height * 0.5, -r.height * 2]) {
        const e = r.height * 1e-4, rise = (fall(d + e) - fall(d - e)) / (2 * e), at = plan.landformAt(ridge, s + d)!;
        assert.ok(Math.abs(at.slope - Math.abs(rise)) < Math.abs(rise) * 0.1 + 1e-3, `slope ${at.slope.toFixed(3)} for ${rise.toFixed(3)}`);
      }
      assert.ok(fall(r.height * 0.6) < fall(-r.height * 0.6), 'its steep face looks to the port');
      assert.notEqual(plan.landformAt(ridge, s - r.radius)?.form, r, 'nothing of it past its long slope');
      // Where a river runs through, the land is open.
      for (const river of plan.rivers) {
        const s0 = plan.ringLine(r, plan.routeOf(river, r.s)), theta = plan.routeOf(river, s0), at = plan.landformAt(theta, s0);
        assert.ok(!at || at.form.kind !== 'ring' || at.top < 1e-6, `a gorge for the ${river.role}`);
      }
    }
  });

  test(`landforms (${name}): a way keeps to its room between the Rings and goes round the Heights; the Sunwalk crosses each Ring`, () => {
    const ways = plan.paths.filter((p) => p.kind === 'way');
    for (const w of ways) {
      const q = w.points, last = q.length - 2;
      for (const r of rings) {
        const a = q[1] - plan.ringLine(r, q[0]), b = q[last + 1] - plan.ringLine(r, q[last]);
        assert.ok(a * b > 0, `a way from s ${q[1].toFixed(0)} to ${q[last + 1].toFixed(0)} over the Ring at ${r.s.toFixed(0)}`);
      }
      for (const g of heights) for (let i = 0; i < q.length; i += 2) {
        const off = Math.hypot(wrap(q[i] - g.theta) * R, q[i + 1] - g.s);
        assert.ok(off >= g.radius * WAY_CLEAR * 0.85, `a way ${off.toFixed(0)} m from a Height reaching ${g.radius.toFixed(0)} m`);
      }
    }
    const walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const r of rings) assert.ok(walk[1] < r.s && walk[walk.length - 1] > r.s, 'the Sunwalk runs over every Ring');
    // Each way joins the net where it starts (a point of the Sunwalk or an entrance) and ends at an entrance.
    const key = (theta: number, s: number): string => `${Math.round(wrap(theta) * R * 100)}:${Math.round(s * 100)}`;
    const entrances = new Set(entrancesOf(plan).map((e) => key(e.theta, e.s))), joins = new Set(entrances);
    for (let i = 0; i < walk.length; i += 2) joins.add(key(walk[i], walk[i + 1]));
    for (const w of ways) {
      const q = w.points;
      assert.ok(joins.has(key(q[0], q[1])) && entrances.has(key(q[q.length - 2], q[q.length - 1])), 'a way that joins nothing');
    }
  });

  test(`landforms (${name}): the terrain raises them, a Ring's front in terraces, and the Sunwalk crosses each at a gentle saddle`, () => {
    const t = terrainOf(name);
    for (const g of heights) assert.ok(Math.abs(t.builtAt(g.theta, g.s) - g.height) < g.height * 0.01, 'a Height\'s top as high as planned');
    const walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const r of rings) {
      const ridge = wrap(plan.valleyAt(0, r.s) + Math.PI / plan.valleys), s0 = plan.ringLine(r, ridge);
      assert.ok(t.builtAt(ridge, s0) >= r.height * 0.99, 'its crest as high as planned');
      // Down its front over a ridge: ledges and walls, not one even slope.
      const n = 160, run = r.height * (GROUND.face + GROUND.crest), angles: number[] = [];
      let prev = t.heightAt(ridge, s0);
      for (let i = 1; i <= n; i++) {
        const g = t.heightAt(ridge, s0 + (run * i) / n);
        angles.push(Math.atan(Math.abs(g - prev) / (run / n)));
        prev = g;
      }
      const ledges = angles.filter((a) => a < 0.2).length, walls = angles.filter((a) => a > 0.9).length;
      assert.ok(ledges > n * 0.15 && walls > n * 0.25, `${ledges} ledges and ${walls} walls of ${n} steps down its front`);
      // The Sunwalk over its saddle: no steeper than an eighth.
      let most = 0;
      for (let i = 2; i < walk.length; i += 2) {
        if (Math.abs(walk[i + 1] - r.s) > r.radius || (t.builtAt(walk[i - 2], walk[i - 1]) <= 0 && t.builtAt(walk[i], walk[i + 1]) <= 0)) continue;
        const a = t.heightAt(walk[i - 2], walk[i - 1]), b = t.heightAt(walk[i], walk[i + 1]);
        most = Math.max(most, Math.abs(b - a) / Math.hypot(wrap(walk[i] - walk[i - 2]) * R, walk[i + 1] - walk[i - 1]));
      }
      assert.ok(most < 0.13, `the Sunwalk climbs ${most.toFixed(3)} over a Ring`);
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
