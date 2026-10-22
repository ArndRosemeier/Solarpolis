import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, REFERENCE } from '../src/blueprint';
import { GRAVITY_BANDS, lakeOf, makePlan, planOf, type Plan } from '../src/gen/plan';
import { baysOf } from '../src/gen/bays';
import { habitatOf, terrainOf } from './worlds';

const TURN = 2 * Math.PI;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);

/** Distance over the floor between two points (unrolled), in metres. */
function apart(plan: Plan, a: { theta: number; s: number }, b: { theta: number; s: number }): number {
  return Math.hypot(wrap(a.theta - b.theta) * plan.habitat.radius, a.s - b.s);
}

const plans = MATRIX.map(({ name }) => ({ name, plan: planOf(habitatOf(name)) }));

for (const { name, plan } of plans) {
  const h = plan.habitat, { profile } = h;

  test(`plan (${name}): the same habitat always gets the same plan`, () => {
    const again = makePlan(derive(h.params));
    assert.deepEqual(again.districts.map((d) => [d.theta, d.s, d.style, d.entrances.length]), plan.districts.map((d) => [d.theta, d.s, d.style, d.entrances.length]));
    assert.deepEqual(again.sites.map((s) => [s.kind, s.theta, s.s]), plan.sites.map((s) => [s.kind, s.theta, s.s]));
    assert.equal(again.paths.length, plan.paths.length);
  });

  test(`plan (${name}): care rises from the wild reserve to the port, gravity fades up both endcaps`, () => {
    let last = -1;
    for (let i = 0; i <= 400; i++) {
      const s = (profile.length * i) / 400, c = plan.careAt(s);
      assert.ok(c >= last - 1e-12 && c >= 0 && c <= 1, `care at ${s.toFixed(0)}: ${c} after ${last}`);
      last = c;
    }
    assert.ok(plan.careAt(profile.floorStart) < 0.05 && plan.careAt(plan.reserveEnd) <= 0.2 + 1e-9, 'the reserve is wild');
    assert.ok(plan.careAt(profile.length) > 0.99, 'the hub is the most tended');
    assert.equal(plan.bandAt((profile.floorStart + profile.floorEnd) / 2), 'foot', 'the floor has full gravity');
    assert.equal(plan.bandAt(1), 'top', 'the top of the Mountain is nearly weightless');
    assert.equal(plan.bandAt(profile.length - 1), 'top', 'so is the hub');
    assert.ok(plan.gravityAt(profile.floorStart * 0.5) < 1 && plan.gravityAt(profile.floorStart * 0.5) > GRAVITY_BANDS[2] * 0.1);
  });

  test(`plan (${name}): valleys evenly round the axis, ridges halfway between`, () => {
    const s = (profile.floorStart + profile.floorEnd) / 2;
    for (let k = 0; k < plan.valleys; k++) {
      const mid = plan.valleyAt(k, s), at = plan.acrossAt(mid, s);
      assert.equal(at.valley, k);
      assert.ok(Math.abs(at.across) < 1e-9, `valley ${k}'s middle is its floor`);
      if (plan.valleys > 1) {
        const ridge = (mid + plan.valleyAt((k + 1) % plan.valleys, s) + (k + 1 === plan.valleys ? TURN : 0)) / 2;
        assert.ok(Math.abs(plan.acrossAt(ridge, s).across) > 0.99, `a ridge after valley ${k}`);
      }
    }
  });

  test(`plan (${name}): the Gate has one face per valley and one Stair face; the Mountain has its summit up the main valley`, () => {
    assert.equal(plan.faces.length, plan.valleys);
    assert.equal(plan.faces.filter((f) => f.kind === 'stair').length, 1);
    for (const f of plan.faces) assert.equal(plan.faceAt(f.theta, profile.length), f);
    assert.ok(Math.abs(wrap(plan.mountain.summit - plan.valleyAt(0, 0))) < 1e-9);
    assert.ok(Math.abs(Math.abs(wrap(plan.mountain.cirque - plan.mountain.summit)) - Math.PI) < 1e-9);
  });

  test(`plan (${name}): rivers with a role each, from their springs on the endcaps`, () => {
    const lake = lakeOf(h), count = lake ? h.params.relief.rivers?.count ?? 0 : 0;
    assert.equal(plan.rivers.length, count);
    if (count) assert.equal(plan.rivers[0].role, 'great');
    if (count > 1) assert.equal(plan.rivers[1].role, 'canal');
    for (const r of plan.rivers) {
      assert.ok(r.from === 'wild' ? r.spring < profile.floorStart : r.spring > profile.floorEnd, `${r.role} springs on its endcap`);
      assert.ok(r.valley >= 0 && r.valley < plan.valleys);
      if (r.role === 'canal') assert.equal(r.meander, 0, 'the canal runs straight');
    }
  });

  test(`plan (${name}): districts fill the worked floor, as many as the population asks, no two neighbours alike`, () => {
    const wanted = Math.max(1, Math.round(h.params.population / h.params.plan.districtPeople));
    assert.ok(plan.districts.length >= wanted * 0.6 && plan.districts.length <= wanted * 1.5 + 1, `${plan.districts.length} districts for ${wanted} wanted`);
    for (const d of plan.districts) {
      assert.ok(d.s >= plan.reserveEnd && d.s <= profile.floorEnd, 'a district lies on the worked floor');
      if (plan.culture.styles.length > 8) continue;
      for (const n of d.neighbours) assert.notEqual(plan.districts[n].style, d.style, `districts ${d.id} and ${n} share a style`);
    }
    // Every point of the worked floor (off the lake) belongs to a district whose seed is about the nearest: the borders
    // bend with the land, by less than a fifth of a district's side. borderAt agrees, and its edge is where the
    // district changes: a step across a border starts and ends within a step of it.
    const side = Math.sqrt((TURN * h.radius * (profile.floorEnd - plan.reserveEnd)) / plan.districts.length);
    let crossed = 0;
    for (let i = 0; i < 300; i++) {
      const theta = (i * 2.399963) % TURN, s = plan.reserveEnd + ((i * 0.618034) % 1) * (profile.floorEnd - plan.reserveEnd);
      const d = plan.districtAt(theta, s);
      if (plan.lake && Math.abs(s - plan.lake.s) < plan.lake.halfWidth) { assert.equal(d, null); assert.equal(plan.borderAt(theta, s), null); continue; }
      assert.ok(d, `a district at ${theta.toFixed(2)}, ${s.toFixed(0)}`);
      const best = Math.min(...plan.districts.map((k) => apart(plan, k, { theta, s })));
      assert.ok(apart(plan, d, { theta, s }) <= best + side * 0.4, 'about the nearest seed');
      const b = plan.borderAt(theta, s)!;
      assert.equal(b.district, d);
      assert.ok(b.edge >= 0);
      const step = side * 0.02, next = plan.districtAt(theta + step / h.radius, s);
      if (next && next !== d && plan.districts.length > 1) {
        crossed++;
        assert.ok(b.edge < step * 1.5 && plan.borderAt(theta + step / h.radius, s)!.edge < step * 1.5, `a border ${b.edge.toFixed(1)} m away`);
      }
    }
    if (plan.districts.length > 4) assert.ok(crossed > 0, 'some steps cross a border');
    // Each valley has a character: most of its districts keep to its styles.
    if (plan.districts.length >= 2 * plan.valleys) {
      const themed = plan.districts.filter((d) => plan.culture.valleys[plan.faces[plan.acrossAt(d.theta, d.s).valley].kind].includes(d.style)).length;
      assert.ok(themed / plan.districts.length > 0.6, `${themed} of ${plan.districts.length} districts keep to their valley's character`);
    }
    assert.equal(plan.districtAt(0, profile.floorStart * 0.5), null, 'no district on the Mountain');
    assert.equal(plan.districtAt(0, (profile.floorStart + plan.reserveEnd) / 2), null, 'none in the reserve');
  });

  test(`plan (${name}): entrances in their own districts, apart, off the lake and the worked floor's ends, each over a bay's middle`, () => {
    const entrances = plan.sites.filter((s) => s.kind === 'entrance'), margin = h.params.plan.entranceSpacing * 0.15, bays = baysOf(h);
    assert.equal(entrances.length, plan.districts.reduce((a, d) => a + d.entrances.length, 0));
    for (const d of plan.districts) assert.ok(d.entrances.length >= 1, `district ${d.id} has a way down`);
    for (const e of entrances) {
      assert.equal(plan.districtAt(e.theta, e.s)?.id, e.district);
      // Over the middle of a bay below, where the court's light well comes down through the vault.
      const b = bays.bayAt(e.theta, e.s), c = b && bays.centreOf(b.i, b.j);
      assert.ok(c && Math.abs(wrap(c.theta - e.theta)) * h.radius < 1e-6 && Math.abs(c.s - e.s) < 1e-6, 'an entrance off its bay\'s middle');
      if (plan.lake) assert.ok(Math.abs(e.s - plan.lake.s) >= plan.lake.halfWidth);
      // Never dug into the Gate's foot, nor right at the reserve's edge.
      assert.ok(e.s >= plan.reserveEnd + margin - 1e-6 && e.s <= profile.floorEnd - margin + 1e-6, `an entrance ${(profile.floorEnd - e.s).toFixed(0)} m from the floor's end`);
    }
  });

  test(`plan (${name}): landmarks where the plan keeps them`, () => {
    const at = (kind: string) => plan.sites.find((s) => s.kind === kind);
    const stair = at('lift-stair'), hut = at('summit-hut'), grove = at('founders-grove'), pavilion = at('lake-pavilion');
    assert.ok(stair && Math.abs(stair.s - profile.floorEnd) < 1e-6 && plan.faceAt(stair.theta, stair.s).kind === 'stair', 'the Lift Stair climbs the Stair face');
    assert.ok(hut && hut.s < profile.floorStart, 'the summit hut is on the Mountain');
    assert.ok(grove && grove.s > plan.reserveEnd && grove.s < profile.floorEnd, "the founders' grove is on the worked floor");
    if (plan.lake) {
      assert.ok(pavilion && Math.abs(pavilion.s - plan.lake.s) < 1e-6, 'the pavilion stands in the lake');
      // Open water around it: no river mouth within twice its size.
      for (const r of plan.rivers) assert.ok(Math.abs(wrap(plan.routeOf(r, plan.lake.s) - pavilion.theta)) * h.radius > pavilion.size * 2, `the ${r.role} enters the lake away from the pavilion`);
    } else assert.equal(pavilion, undefined);
  });

  test(`plan (${name}): the Sunwalk runs the floor's length and every entrance is on the net`, () => {
    const walk = plan.paths.find((p) => p.kind === 'sunwalk');
    assert.ok(walk);
    const pts = walk.points, n = pts.length / 2;
    assert.ok(Math.abs(pts[1] - profile.floorStart) < 1e-6 && Math.abs(pts[pts.length - 1] - profile.floorEnd) < 1e-6, 'from the Mountain to the Gate');
    for (let i = 1; i < n; i++) assert.ok(apart(plan, { theta: pts[2 * i - 2], s: pts[2 * i - 1] }, { theta: pts[2 * i], s: pts[2 * i + 1] }) < (profile.floorEnd - profile.floorStart) / 50, 'no gap');
    const ways = plan.paths.filter((p) => p.kind === 'way');
    const entrances = plan.sites.filter((s) => s.kind === 'entrance');
    assert.equal(ways.length, entrances.length, 'a spanning tree: one way into each entrance');
    for (const w of ways) {
      const a = w.points[1], b = w.points[3];
      if (plan.lake) assert.ok(!(Math.min(a, b) < plan.lake.s && Math.max(a, b) > plan.lake.s), 'no way across the lake');
    }
  });
}

test('plan: an unknown culture or a plan without valleys is invalid', () => {
  assert.ok(validate(derive(withParams({ culture: 'nowhere' }))).some((f) => f.id === 'culture' && f.severity === 'invalid'));
  assert.ok(validate(derive(withParams({ plan: { ...REFERENCE.plan, valleys: 0 } }))).some((f) => f.id === 'plan' && f.severity === 'invalid'));
  assert.ok(!validate(derive(REFERENCE)).some((f) => f.id === 'plan' || f.id === 'culture'));
});

test('plan: the terrain keeps the plan\'s lake', () => {
  for (const { name } of MATRIX) {
    const t = terrainOf(name);
    assert.deepEqual(t.lake, lakeOf(t.habitat));
  }
});
