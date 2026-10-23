import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, validate, withParams } from '../src/blueprint';
import { entrancesOf, fromLake, makePlan, mereEdge, mereReach, mereShore, planOf, type Mere } from '../src/gen/plan';
import { riverAt, riverPoint } from '../src/gen/rivers';
import { buildWater } from '../src/gen/water';
import { terrainOf } from './worlds';

const TURN = 2 * Math.PI;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);
/** A point on the line out from a lake's middle at angle `a` of its own frame, `k` times as far out as its outline there. */
const outFrom = (m: Mere, R: number, a: number, k: number): { theta: number; s: number } => {
  const x = Math.cos(a) * m.along * k, y = Math.sin(a) * m.across * k;
  return { theta: m.theta + (x * m.sin + y * m.cos) / R, s: m.s + x * m.cos - y * m.sin };
};

for (const { name, params } of MATRIX) {
  test(`lakes (${name}): the great lake and the smaller ones lie on the floor, apart, off the ring lake and the landforms`, () => {
    const h = terrainOf(name).habitat, plan = planOf(h), spec = params.relief.lakes, R = h.radius, { profile } = h;
    if (!spec) { assert.equal(plan.meres.length, 0); return; }
    const greats = plan.meres.filter((m) => m.kind === 'great');
    assert.equal(greats.length, spec.great ? 1 : 0, 'one great lake');
    assert.equal(plan.meres[0].kind, spec.great ? 'great' : 'mere', 'the great lake first');
    assert.ok(plan.meres.length - greats.length >= Math.min(1, spec.count) && plan.meres.length - greats.length <= spec.count, 'the smaller ones');
    const great = greats[0];
    if (great) {
      // At the Mountain's foot, down the main valley: the reserve's water.
      assert.ok(great.s < plan.reserveEnd + great.along && great.wild === 1, 'in the reserve, natural');
      assert.ok(great.along >= (spec.great!.length * R) / 2 * 0.4, 'not shrunk past two fifths');
      assert.ok(Math.abs(wrap(great.theta - plan.valleyAt(0, great.s))) * R < great.across, 'over the main valley');
    }
    plan.meres.forEach((m, i) => {
      const reach = mereReach(m), shore = mereShore(m);
      assert.equal(m.id, i);
      assert.ok(m.depth > 0 && Number.isFinite(m.level) && shore > 0 && m.wild >= 0 && m.wild <= 1, 'whole');
      assert.ok(m.s - reach > profile.floorStart && m.s + reach < profile.floorEnd, 'on the floor');
      if (plan.lake) assert.ok(fromLake(plan.lake, m.s) > reach, 'off the ring lake');
      for (const o of plan.meres.slice(i + 1)) {
        assert.ok(Math.hypot(wrap(o.theta - m.theta) * R, o.s - m.s) > reach + mereReach(o), 'apart');
      }
      // Its water stands in its room: no Ring or Height rises in it or on its shore.
      for (let q = 0; q < 16; q++) {
        const p = outFrom(m, R, (q / 16) * TURN, 0.9);
        assert.equal(plan.landformAt(p.theta, p.s), null, 'off the landforms');
      }
      // Its outline: the middle well in, the shore out along every line from it, inside its reach.
      assert.ok(mereEdge(m, R, m.theta, m.s) < 0, 'its middle is water');
      for (let q = 0; q < 32; q++) {
        const a = (q / 32) * TURN;
        assert.ok(mereEdge(m, R, outFrom(m, R, a, 0.55).theta, outFrom(m, R, a, 0.55).s) < 0, 'in half way out');
        const far = { theta: m.theta + (Math.sin(a) * (reach + 1)) / R, s: m.s + Math.cos(a) * (reach + 1) };
        assert.ok(mereEdge(m, R, far.theta, far.s) > 0, 'out past its reach');
      }
      // The plan's own questions agree.
      assert.ok(plan.inWater(m.theta, m.s) && plan.mereAt(m.theta, m.s)?.mere === m, 'found where it is');
    });
    // Same habitat, same lakes.
    if (name === 'small') assert.deepEqual(makePlan(derive(params)).meres, plan.meres);
  });

  test(`lakes (${name}): the ground holds their water, shelving to their depth; one swims on it`, () => {
    const t = terrainOf(name), R = t.habitat.radius;
    for (const m of t.meres) {
      const bed = t.heightAt(m.theta, m.s);
      assert.ok(bed < m.level - m.depth * 0.5 && bed > m.level - m.depth - 1e-6, `deep in the middle (${bed} under ${m.level})`);
      assert.equal(t.standAt(m.theta, m.s), m.level, 'one swims on its surface');
      let dry = 0;
      for (let q = 0; q < 24; q++) {
        const a = (q / 24) * TURN;
        // Just past the shore, and a shore's width out: the land never dips under the water (it would spill).
        for (const out of [1, mereShore(m) * 0.5, mereShore(m) * 1.2]) {
          const k = 1 + out / Math.hypot(Math.cos(a) * m.along, Math.sin(a) * m.across);
          const p = outFrom(m, R, a, k);
          if (mereEdge(m, R, p.theta, p.s) <= 0 || riverAt(t.rivers, p.theta, p.s, mereShore(m))) continue; // (a bay's headland; where a river runs in or out)
          assert.ok(t.heightAt(p.theta, p.s) >= m.level - 1e-6, `the shore holds (${t.heightAt(p.theta, p.s)} under ${m.level})`);
          dry++;
        }
      }
      assert.ok(dry > 12, `its shore stands round it (${dry})`);
    }
  });
}

test('lakes: the great river runs through the great lake at its level; courts, works and district middles keep out of them', () => {
  const name = MATRIX[0].name, t = terrainOf(name), plan = planOf(t.habitat), great = plan.meres[0];
  assert.equal(great.kind, 'great');
  // The great river runs down the main valley from the Mountain: through the great lake, on its surface.
  let through = 0;
  for (const r of t.rivers) for (let i = 0; i < r.count; i += 4) {
    const s = r.s0 + i * r.step, at = riverPoint(r, s), hit = plan.mereAt(at.theta, s);
    if (!hit || hit.mere !== great || hit.edge > -at.halfWidth * 4) continue;
    through++;
    assert.ok(Math.abs(at.surface - great.level) < 1e-6, 'the river rests at the lake\'s level');
  }
  assert.ok(through > 10, `a river through the great lake (${through} samples)`);
  for (const c of entrancesOf(plan)) assert.ok(!plan.inWater(c.theta, c.s, c.size), 'a court on dry land');
  for (const w of plan.works) assert.ok(!plan.inWater(w.theta, w.s, w.radius), 'a work on dry land');
  for (const d of plan.districts) assert.ok(!plan.meres.some((m) => mereEdge(m, t.habitat.radius, d.theta, d.s) < 0), 'a district\'s middle on land');
});

test('lakes: their water is drawn at their level, over the water only', () => {
  const t = terrainOf(MATRIX[0].name), h = t.habitat, R = h.radius;
  for (const m of t.meres.slice(1)) {
    const reach = mereReach(m) * 1.2;
    const tile = { theta0: m.theta - reach / R, theta1: m.theta + reach / R, s0: m.s - reach, s1: m.s + reach, cell: reach / 32, drawn: t.heightAt };
    const w = buildWater(t, tile, [0, 0, 0]);
    assert.ok(w && w.index.length > 0, 'water over the lake');
    let inside = 0;
    for (let v = 0; v < w.positions.length / 3; v++) {
      const p = fromWorld(h.profile, w.positions[v * 3], w.positions[v * 3 + 1], w.positions[v * 3 + 2]);
      if (t.form.mereAt(p.theta, p.s, 1) === null) continue; // (a river's water)
      assert.ok(Math.abs(p.h - m.level) < 0.05, `at the lake's level (${p.h} vs ${m.level})`);
      assert.ok(mereEdge(m, R, p.theta, p.s) < 1, 'not out on the land');
      inside++;
    }
    assert.ok(inside > 50, `its surface (${inside} points)`);
  }
});

test('lakes: sized by the blueprint, and validated', () => {
  const ids = (p: Parameters<typeof withParams>[0]) => validate(derive(withParams(p))).map((f) => `${f.severity}:${f.id}`);
  const relief = MATRIX[0].params.relief, lakes = relief.lakes!;
  assert.ok(ids({ relief: { ...relief, lakes: { ...lakes, count: 1.5 } } }).includes('invalid:relief'), 'a whole count');
  assert.ok(ids({ relief: { ...relief, lakes: { ...lakes, size: 0.9 } } }).includes('invalid:relief'), 'too big');
  assert.ok(ids({ relief: { ...relief, lakes: { ...lakes, great: { length: 3, width: 0.4 } } } }).includes('invalid:relief'), 'too long');
  assert.deepEqual(ids({ relief: { ...relief, lakes: null } }), ids({}), 'none is fine');
  const small = MATRIX[1].params;
  const none = makePlan(derive(withParams({ relief: { ...small.relief, lakes: { ...small.relief.lakes!, great: null, count: 0 } } }, small)));
  assert.equal(none.meres.length, 0, 'none asked, none made');
});
