import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams } from '../src/blueprint';
import { SKIES, hamletSkiesOf, skyOverBay } from '../src/gen/skies';
import { underOf } from '../src/gen/under';
import { planOf } from '../src/gen/plan';
import { FINISH } from '../src/gen/pavilion';
import { buildUnderTile } from '../src/gen/underMesh';
import { SKY_DRAWN } from '../src/render/hamletSkies';
import { terrainOf } from './worlds';

test('skies: the shader draws the catalogue in its order', () => {
  assert.deepEqual([...SKY_DRAWN], SKIES.map((s) => s.name));
});

test('skies: screen dimensions are valid across habitats; empty panels and oversized joints are rejected', () => {
  for (const { params } of MATRIX) {
    const check = (screen: typeof params.under.screen): boolean => validate(derive(withParams({ under: { ...params.under, screen } }, params)))
      .some((f) => f.severity === 'invalid' && f.message.startsWith('ceiling screens'));
    assert.equal(check(params.under.screen), false);
    assert.equal(check({ width: 3, height: 2, joint: 0.03 }), false);
    for (const screen of [
      { ...params.under.screen, width: 0 }, { ...params.under.screen, height: -1 },
      { ...params.under.screen, width: Infinity }, { ...params.under.screen, height: NaN },
      { ...params.under.screen, joint: 0 }, { ...params.under.screen, joint: params.under.screen.height },
    ]) assert.equal(check(screen), true);
  }
});

for (const { name } of MATRIX) {
  test(`skies (${name}): each hamlet picks one by its district's style, the same every time, and shows it over its bays but the wellhead`, () => {
    const t = terrainOf(name), h = t.habitat, u = underOf(h), skies = hamletSkiesOf(h);
    if (!u.hamlets.length) return;
    assert.equal(skies.length, u.hamlets.length);
    assert.ok(skies.every((k) => k >= 0 && k < SKIES.length));
    // Seeded: the same habitat picks the same.
    assert.deepEqual(hamletSkiesOf({ ...h }), skies);
    // Over many hamlets, several skies; and the styles differ in what they pick.
    if (u.hamlets.length >= 40) assert.ok(new Set(skies).size >= 4, `${new Set(skies).size} skies over ${u.hamlets.length} hamlets`);
    // The glass deck in some hamlets, not all (Arnd: "a good idea but too uniform").
    const glass = skies.filter((k) => SKIES[k].name === 'glass').length;
    if (u.hamlets.length >= 100) assert.ok(glass > 0 && glass < 0.4 * u.hamlets.length, `${glass} glass decks over ${u.hamlets.length} hamlets`);
    const plan = planOf(h);
    for (const m of u.hamlets.slice(0, 30)) {
      const style = plan.districts[m.district].style, sky = SKIES[skies[m.court]].name;
      if (style === 'grove') assert.ok(sky === 'canopy' || sky === 'open' || sky === 'glass', `a grove hamlet under ${sky}`);
      if (style === 'stone' || style === 'makers') assert.notEqual(sky, 'glass', 'stone and makers keep to authored skies');
      assert.equal(skyOverBay(h, m.i, m.j), -1, 'the wellhead keeps its stone round the real light');
    }
    // A hamlet's home bay shows its sky on its spandrel; a bay of the Dim shows none.
    const m = u.hamlets[Math.floor(u.hamlets.length / 2)];
    let home: { i: number; j: number } | null = null, dim: { i: number; j: number } | null = null;
    for (let r = 1; r < 14 && (!home || !dim); r++) for (const [di, dj] of [[r, 1], [-r, 2], [1, r], [2, -r], [r, r], [-r, -r]]) {
      const i = m.i + di, j = m.j + dj, use = j >= 0 && j < u.along ? u.useAt(i, j) : null;
      if (use === 'home' && u.hamletOf(i, j) === m && !home) home = { i, j };
      if (use === 'dim' && !dim) dim = { i, j };
    }
    assert.ok(home || u.hamlets.length < 10, 'a home bay found');
    if (home) {
      assert.equal(skyOverBay(h, home.i, home.j), skies[m.court]);
      const f = buildUnderTile(t, { level: 0, i: home.i, j: home.j }).mesh.finishes;
      assert.ok(f.some((x) => x === FINISH.screen + skies[m.court]), 'its spandrel is screen');
    }
    if (dim) assert.equal(skyOverBay(h, dim.i, dim.j), -1);
  });
}
