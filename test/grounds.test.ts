import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams } from '../src/blueprint';
import { terrainOf } from './worlds';
import { COURT, GROUND, WAY_CLEAR, courtCap, entrancesOf, fromLake, planOf } from '../src/gen/plan';

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
      // Its line keeps clear; the way swings off its line by a tenth of its length at most.
      const swing = Math.hypot(wrap(q[last] - q[0]) * R, q[last + 1] - q[1]) * 0.1;
      for (const g of heights) {
        // No nearer than its clearance, or than its own ends (an entrance at a Height's foot).
        const from = (i: number): number => Math.hypot(wrap(q[i] - g.theta) * R, q[i + 1] - g.s);
        const keep = Math.min(g.radius * WAY_CLEAR, from(0), from(last)) - swing - 1e-6;
        for (let i = 0; i < q.length; i += 2) assert.ok(from(i) >= keep, `a way ${from(i).toFixed(0)} m from a Height reaching ${g.radius.toFixed(0)} m`);
      }
    }
    const walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const r of rings) assert.ok(walk[1] < r.s && walk[walk.length - 1] > r.s, 'the Sunwalk runs over every Ring');
    // Each way joins the net where it starts (a point of the Sunwalk or of another way, clear of that way's court) and
    // ends at an entrance.
    const key = (theta: number, s: number): string => `${Math.round(wrap(theta) * R * 100)}:${Math.round(s * 100)}`;
    const entrances = new Set(entrancesOf(plan).map((e) => key(e.theta, e.s))), joins = new Set<string>();
    for (let i = 0; i < walk.length; i += 2) joins.add(key(walk[i], walk[i + 1]));
    for (const w of ways) for (let i = 0; i < w.points.length; i += 2) joins.add(key(w.points[i], w.points[i + 1]));
    for (const w of ways) {
      const q = w.points;
      assert.ok(entrances.has(key(q[q.length - 2], q[q.length - 1])), 'a way that ends at no entrance');
      assert.ok(joins.has(key(q[0], q[1])) && (!params.landmarks || !entrances.has(key(q[0], q[1]))), 'a way that joins nothing, or starts in a court');
    }
    // And it goes round every court but its ends' (nobody walks down into another court, over its well).
    if (!params.landmarks) return;
    const cell = params.plan.entranceSpacing, rows = new Map<number, ReturnType<typeof entrancesOf>>();
    for (const e of entrancesOf(plan)) { const r = Math.floor(e.s / cell); rows.set(r, [...(rows.get(r) ?? []), e]); }
    const clear = (e: { size: number }): number => e.size + COURT.clear * params.landmarks!.handrail + params.plan.pathWidth.way;
    for (const w of ways) {
      const q = w.points, ends = [key(q[0], q[1]), key(q[q.length - 2], q[q.length - 1])];
      for (let i = 0; i + 3 < q.length; i += 2) {
        const r = Math.floor(q[i + 1] / cell);
        for (const e of [-1, 0, 1].flatMap((d) => rows.get(r + d) ?? [])) {
          if (ends.includes(key(e.theta, e.s))) continue;
          const pu = wrap(q[i + 2] - q[i]) * R, pv = q[i + 3] - q[i + 1], eu = wrap(e.theta - q[i]) * R, ev = e.s - q[i + 1];
          const k = Math.min(1, Math.max(0, (eu * pu + ev * pv) / Math.max(pu * pu + pv * pv, 1e-9)));
          assert.ok(Math.hypot(eu - pu * k, ev - pv * k) >= clear(e) - 1e-6, 'a way through another court');
        }
      }
    }
  });

  test(`landforms (${name}): the terrain raises them, a Ring's front in terraces, and the Sunwalk crosses each at a gentle saddle`, () => {
    const t = terrainOf(name);
    for (const g of heights) assert.ok(Math.abs(t.builtAt(g.theta, g.s) - g.height) < g.height * 0.01, 'a Height\'s top as high as planned');
    const walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const r of rings) {
      const ridge = wrap(plan.valleyAt(0, r.s) + Math.PI / plan.valleys), s0 = plan.ringLine(r, ridge);
      assert.ok(t.builtAt(ridge, s0) >= r.height * 0.99 - plan.landformAt(ridge, s0)!.room, 'its crest as high as planned (over the lower room)');
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
    const cap = courtCap(h), walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const e of entrancesOf(plan)) {
      const on = plan.landformAt(e.theta, e.s);
      assert.ok(!on || on.top <= cap + 1e-9, `an entrance ${on?.top.toFixed(0)} m up a ${on?.form.kind}`);
      // And its court clear of the Sunwalk (its line between the two points either side along the axis).
      let i = 0;
      while (i + 3 < walk.length && walk[i + 3] < e.s) i += 2;
      const f = (e.s - walk[i + 1]) / Math.max(walk[i + 3] - walk[i + 1], 1e-9), line = walk[i] + wrap(walk[i + 2] - walk[i]) * f;
      if (params.landmarks) assert.ok(Math.abs(wrap(e.theta - line)) * R >= e.size + params.plan.pathWidth.sunwalk / 2, 'a court on the Sunwalk');
    }
  });

  test(`landforms (${name}): the rooms between the Rings step down to the lake, level between, the ends equally high`, () => {
    const { floorStart } = h.profile, lake = plan.lake, fall = spec.fall ?? 0;
    const wild = rings.filter((r) => r.up < 0), port = rings.filter((r) => r.up > 0);
    if (!lake || !fall || !wild.length || !port.length) {
      for (const r of rings) assert.equal(r.step, 0, 'no step without a lake on both sides');
      for (let i = 0; i < 16; i++) assert.equal(plan.roomAt(i, floorStart + ((floorEnd - floorStart) * i) / 16), 0, 'level rooms');
      return;
    }
    for (const r of rings) {
      assert.equal(r.up, r.s < lake.s ? -1 : 1, 'up the step is away from the lake');
      assert.ok(r.step > 0 && r.step <= GROUND.stepMax * r.height + 1e-9, `a step of ${r.step.toFixed(1)} m, under the saddle`);
    }
    const total = (side: typeof rings): number => side.reduce((sum, r) => sum + r.step, 0);
    assert.ok(Math.abs(total(wild) - total(port)) < 1e-6, 'both ends of the floor equally high over the lake');
    assert.ok(Math.abs(total(wild) - Math.min((fall * rings.length) / 2, GROUND.stepMax * Math.min(wild.length, port.length)) * spec.ring * R) < 1e-6, 'as far as the blueprint says');
    for (let q = 0; q < 8; q++) {
      const theta = (q / 8) * TURN + 0.3;
      assert.equal(plan.roomAt(theta, floorStart), 0, 'the wild end at the top');
      assert.equal(plan.roomAt(theta, floorEnd), 0, 'the port end at the top');
      assert.ok(Math.abs(plan.roomAt(theta, lake.s) + total(wild)) < 1e-6, 'the lake in the lowest room');
      // Level between the Rings, away from their lines; one step lower past each, toward the lake.
      const lines = rings.map((r) => ({ r, s: plan.ringLine(r, theta) }));
      for (const [i, { r, s }] of lines.entries()) {
        const c = r.step * GROUND.lip, before = plan.roomAt(theta, s - c - 1e-6), after = plan.roomAt(theta, s + c + 1e-6);
        assert.ok(Math.abs(after - before - r.up * r.step) < 1e-6, 'a step at each Ring, down toward the lake');
        const next = lines[i + 1]?.s ?? floorEnd;
        for (let k = 1; k < 4; k++) assert.equal(plan.roomAt(theta, s + c + ((next - s - 2 * c) * k) / 4), after, 'level between');
      }
    }
    assert.equal(lake.level, planOf(h).lake!.level, 'the same lake every time');
  });

  test(`landforms (${name}): each river falls its step where it breaks through a Ring`, () => {
    const t = terrainOf(name);
    let falls = 0, crossings = 0;
    for (const river of t.rivers) {
      for (const r of rings) {
        if (!r.step) continue;
        // Where the river's middle crosses the Ring's line (they wander, so sample by sample), then the water just above
        // the step and where it lands: most of the step falls there, the rest in rapids as the room's land allows.
        const side = (i: number): number => Math.sign((river.s0 + i * river.step - plan.ringLine(r, river.theta[i])) * r.up);
        const reach = Math.ceil((r.step * GROUND.lip) / river.step) + 2;
        for (let i = 1; i < river.count; i++) {
          if (side(i) === side(i - 1) || i - reach < 0 || i + reach >= river.count) continue;
          const up = r.up > 0 ? i + reach : i - 1 - reach, down = r.up > 0 ? i - 1 - reach : i + reach;
          const fell = river.surface[up] - river.surface[down];
          crossings++;
          assert.ok(fell >= 0, 'water never runs up');
          if (fell >= r.step * 0.5) falls++;
        }
      }
    }
    assert.ok(falls >= Math.floor(crossings * 0.75), `${falls} falls of at least half a step at ${crossings} crossings`);
    if (rings.some((r) => r.step > 0) && t.rivers.length && params.relief.rivers) assert.ok(crossings > 0, 'the rivers break through the Rings');
  });
}

test('landforms: none without them in the blueprint; invalid ones are refused', () => {
  const p = MATRIX[0].params, none = derive(withParams({ relief: { ...p.relief, landforms: null } }));
  assert.equal(planOf(none).grounds.length, 0);
  assert.equal(planOf(none).landformAt(0, (none.profile.floorStart + none.profile.floorEnd) / 2), null);
  const bad = derive(withParams({ relief: { ...p.relief, landforms: { ring: 0.3, ringEvery: 1, height: 0.2, heights: 1.5 } } }));
  assert.ok(validate(bad).some((x) => x.id === 'relief' && x.severity === 'invalid'));
  const steep = derive(withParams({ relief: { ...p.relief, landforms: { ...p.relief.landforms!, fall: 0.3 } } }));
  assert.ok(validate(steep).some((x) => x.id === 'relief' && x.severity === 'invalid'), 'a fall over 0.2');
  const level = planOf(derive(withParams({ relief: { ...p.relief, landforms: { ...p.relief.landforms!, fall: 0 } } })));
  assert.ok(level.grounds.every((g) => g.step === 0), 'level rooms without a fall');
});
