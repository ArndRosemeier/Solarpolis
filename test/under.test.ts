import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, REFERENCE } from '../src/blueprint';
import { planOf } from '../src/gen/plan';
import { pathsOf } from '../src/gen/paths';
import { makeUnder, sharesOf, underOf, type Under } from '../src/gen/under';
import { terrainOf } from './worlds';

const TURN = 2 * Math.PI;

test('under: the pillars are as thick as the land over a bay asks, thicker for wider bays, heavier land and weaker stone', () => {
  const ref = derive(REFERENCE).pillars;
  // About 2 m across in the reference, held against crushing and buckling with the stone's safety factor.
  assert.ok(ref.radius > 0.7 && ref.radius < 1.4, `reference pillar radius ${ref.radius.toFixed(2)} m`);
  const st = REFERENCE.under.stone;
  assert.ok(Math.PI * ref.radius ** 2 * st.strength >= ref.load * st.safetyFactor * (1 - 1e-9), 'does not crush');
  assert.ok(ref.load > REFERENCE.under.land * REFERENCE.under.bay ** 2 * ref.gravity, 'carries its own weight as well as the land');
  const wider = derive(withParams({ under: { ...REFERENCE.under, bay: 45 } })).pillars.radius;
  const heavier = derive(withParams({ under: { ...REFERENCE.under, land: 18000 } })).pillars.radius;
  const weaker = derive(withParams({ under: { ...REFERENCE.under, stone: { ...st, strength: st.strength / 4 } } })).pillars.radius;
  const lighter = derive(withParams({ floorGravity: 3 })).pillars.radius;
  assert.ok(wider > ref.radius && heavier > ref.radius && weaker > ref.radius && lighter < ref.radius, `${wider} ${heavier} ${weaker} ${lighter} vs ${ref.radius}`);
  // Stone too weak for the bay: the habitat cannot exist.
  const crushed = derive(withParams({ under: { ...REFERENCE.under, stone: { ...st, strength: 1e5 } } }));
  assert.ok(validate(crushed).some((f) => f.id === 'under' && f.severity === 'invalid'));
});


/** Bays of a hamlet's square, as far out as its edge can swing. */
function* around(under: Under, m: Under['hamlets'][number]): Generator<{ i: number; j: number; d: number }> {
  const r = Math.ceil(m.edge * 1.4) + 1, R = under.habitat.radius;
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = m.i + di, j = m.j + dj;
    if (j < 0 || j >= under.along) continue;
    const c = under.centreOf(i, j), du = (((c.theta - m.site.theta + Math.PI) % TURN + TURN) % TURN - Math.PI) * R;
    yield { i, j, d: Math.hypot(du, c.s - m.site.s) / under.bay };
  }
}

for (const { name } of MATRIX) {
  // Made when its tests run (not on import): the Understorey of the habitat whose terrain the other tests share.
  let made: Under | null = null;
  const of = (): { under: Under; h: Under['habitat']; plan: ReturnType<typeof planOf>; u: Under['habitat']['params']['under'] } => {
    made ??= underOf(terrainOf(name).habitat);
    return { under: made, h: made.habitat, plan: planOf(made.habitat), u: made.habitat.params.under };
  };

  test(`under (${name}): the pillars hold, and their bays close round the axis and fill the floor`, () => {
    const { under, h, u } = of();
    assert.ok(!validate(h).some((f) => f.id === 'under'), 'no finding about the Understorey');
    assert.ok(Math.abs(under.around * under.dTheta - TURN) < 1e-9);
    assert.ok(Math.abs(under.dTheta * h.radius - u.bay) < u.bay * 0.05, 'a bay is as wide as it is long');
    assert.ok(under.along * u.bay <= h.profile.floorEnd - h.profile.floorStart + 1e-6 && (under.along + 1) * u.bay > h.profile.floorEnd - h.profile.floorStart);
    const b = under.bayAt(1, h.profile.floorStart + u.bay)!, c = under.centreOf(b.i, b.j);
    assert.deepEqual(under.bayAt(c.theta, c.s), b);
    assert.equal(under.bayAt(0, h.profile.floorStart - 1), null, 'no bays under the endcaps yet');
  });

  test(`under (${name}): every court is the door of a hamlet: wellhead, a ring of halls, homes in lanes`, () => {
    const { under, h, plan, u } = of();
    const courts = plan.sites.filter((x) => x.kind === 'entrance');
    assert.equal(under.hamlets.length, courts.length);
    const people = h.params.population / courts.length;
    for (const m of under.hamlets) {
      assert.equal(m.site, courts[m.court], 'in the plan\'s order of entrances');
      assert.ok(Math.abs(m.households * u.household.people - people) < 1e-6);
      assert.equal(under.useAt(m.i, m.j), 'well', `hamlet ${m.court} has its wellhead under its court`);
      assert.equal(under.hamletOf(m.i, m.j), m);
      assert.ok(m.well < m.hall && m.hall < m.edge);
    }
    for (const m of under.hamlets.slice(0, 6)) {
      let homes = 0;
      for (const { i, j, d } of around(under, m)) {
        const use = under.useAt(i, j), own = under.hamletOf(i, j) === m;
        if (use === 'home') homes += own ? 1 : 0;
        if (!own) continue;
        if (d < m.well - 0.75) assert.equal(use, 'well');
        else if (d > m.well + 0.75 && d < m.hall - 0.75) assert.equal(use, 'hall', `bay ${d.toFixed(1)} bays out of hamlet ${m.court}`);
        else if (d > m.hall + 0.75 && use !== 'gallery') {
          assert.ok(use === 'home' || use === 'lane', `${use} among the homes of hamlet ${m.court}`);
          const di = i - m.i, dj = j - m.j, onLine = di % u.lanes === 0 || dj % u.lanes === 0;
          assert.equal(use === 'lane', onLine, 'lanes every few bay lines, crossing at the wellhead');
        }
      }
      // Homes for every household, give or take the galleries through them and the edge's swing.
      const want = m.households * u.household.bays;
      assert.ok(homes > want * 0.6 && homes < want * 1.5, `hamlet ${m.court}: ${homes} home bays for ${want.toFixed(0)} wanted`);
    }
  });

  test(`under (${name}): galleries under the ways, cisterns between the hamlets, the works under the reserve, the lake's own`, () => {
    const { under, h, plan, u } = of();
    const paths = pathsOf(h), shares = sharesOf(under, 7);
    for (let j = 0; j < under.along; j += 11) for (let i = 0; i < under.around; i += 13) {
      const use = under.useAt(i, j), { theta, s } = under.centreOf(i, j);
      const wet = plan.inWater(theta, s);
      if (s < plan.reserveEnd && !wet) assert.equal(use, 'works');
      if (wet) assert.equal(use, 'lake');
      if (use === 'gallery') {
        const hit = paths.pathAt(theta, s, u.bay / 2);
        assert.ok(hit && hit.kind !== 'trail' && hit.distance <= u.bay / 2 + 1e-9, 'a gallery runs under a way or the Sunwalk');
      }
      if (use === 'cistern') assert.equal(under.hamletOf(i, j), null, 'no cistern in a hamlet');
    }
    // As much water as asked of the worked floor, give or take the rings' rounding and blocks with no room (a small
    // habitat's hamlets leave little).
    const worked = 1 - shares.works - shares.lake;
    assert.ok(shares.cistern > u.cisterns * worked * 0.3 && shares.cistern < u.cisterns * worked * 1.3, `cisterns ${(shares.cistern * 100).toFixed(1)}% of the bays`);
    assert.ok(shares.home > 0.02 && shares.dim > 0.1 && shares.gallery > 0, 'homes, the Dim and galleries all there');
  });
}

test('under (small): the same habitat always gets the same Understorey', () => {
  const params = MATRIX.find((m) => m.name === 'small')!.params, a = makeUnder(derive(params)), b = underOf(terrainOf('small').habitat);
  for (let j = 0; j < a.along; j += 3) for (let i = 0; i < a.around; i += 3) assert.equal(a.useAt(i, j), b.useAt(i, j));
});
