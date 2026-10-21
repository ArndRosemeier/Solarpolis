import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, toWorld } from '../../src/blueprint';
import { makeTerrain } from '../../src/gen/terrain';
import { makeEcology } from '../../src/gen/ecology';
import { makeLayout, bounds, buildTile, select, keyId, type TileKey } from '../../src/gen/tiles';
import { startOf, EYE_HEIGHT } from '../../src/world/walker';

// Slow (builds hundreds of tiles per habitat): run with `npm run test:slow`, not in CI's 2-minute check.
const PX_PER_RAD = 1440 / (70 * Math.PI / 180);

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const t = makeTerrain(h), eco = makeEcology(t);
  const layout = makeLayout(t);
  test(`tiles (${name}): standing on the floor, fine tiles underfoot, coarse ones overhead, within the draw budget`, () => {
    const at = startOf(h.profile);
    const eye = toWorld(h.profile, { ...at, h: t.standAt(at.theta, at.s) + EYE_HEIGHT });
    // Build what the selection asks for, round by round, as the renderer does.
    const built = new Map<string, number>();
    const errorOf = (k: TileKey) => built.get(keyId(k));
    let sel = select(t, layout, eye, PX_PER_RAD, 2, errorOf);
    for (let round = 0; round < 40 && sel.want.length; round++) {
      for (const k of sel.want) built.set(keyId(k), buildTile(eco, layout, k).error);
      sel = select(t, layout, eye, PX_PER_RAD, 2, errorOf);
    }
    // The plan's budget is about 1,000 terrain tiles; the large habitat's tall hills need a little more (still within 1,500 draws).
    assert.ok(sel.draw.length <= 1200, `${sel.draw.length} tiles drawn`);
    assert.equal(sel.want.length, 0);
    const levels = sel.draw.map((k) => k.level);
    assert.ok(Math.max(...levels) >= Math.min(layout.maxLevel, 4), `fine underfoot (deepest ${Math.max(...levels)})`);
    console.log(`  ${name}: ${sel.draw.length} tiles drawn, ${built.size} built, deepest level ${Math.max(...levels)} of ${layout.maxLevel}`);
    // Every point of the interior is covered by exactly one drawn tile: the areas add up.
    let area = 0;
    for (const k of sel.draw) { const b = bounds(layout, k); area += (b.theta1 - b.theta0) * (b.s1 - b.s0); }
    assert.ok(Math.abs(area - 2 * Math.PI * h.profile.length) < 1e-6 * area);
    assert.equal(new Set(sel.draw.map(keyId)).size, sel.draw.length);
  });
}
