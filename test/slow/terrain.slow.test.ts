import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, toWorld } from '../../src/blueprint';
import { makeTerrain } from '../../src/gen/terrain';
import { makeEcology } from '../../src/gen/ecology';
import { makeLayout, bounds, buildTile, select, keyId, type TileKey, type TileFit } from '../../src/gen/tiles';
import { startOf, EYE_HEIGHT } from '../../src/world/walker';

// Slow (builds hundreds of tiles per habitat): run with `npm run test:slow`, not in CI's 2-minute check.
const PX_PER_RAD = 1440 / (70 * Math.PI / 180);

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const t = makeTerrain(h), eco = makeEcology(t);
  const layout = makeLayout(t);
  const start = startOf(h.profile);
  // On the floor, and where the sunline meets each endcap (the axis at the wild end, the hub at the port end).
  const spots = [['on the floor', start.s], ['at the wild endcap\'s tip', 20], ['at the port endcap\'s hub', h.profile.length - 20]] as const;
  let onFloor = 0;
  for (const [where, s] of spots) test(`tiles (${name}): ${where}, fine tiles underfoot, coarse ones overhead, within the draw budget`, () => {
    const at = { ...start, s };
    const eye = toWorld(h.profile, { ...at, h: t.standAt(at.theta, at.s) + EYE_HEIGHT });
    // Build what the selection asks for, round by round, as the renderer does.
    const built = new Map<string, TileFit>();
    const errorOf = (k: TileKey) => built.get(keyId(k));
    let sel = select(t, layout, eye, PX_PER_RAD, 2, errorOf);
    for (let round = 0; round < 40 && sel.want.length; round++) {
      for (const k of sel.want) { const b = buildTile(eco, layout, k); built.set(keyId(k), { error: b.error, low: b.low, high: b.high }); }
      sel = select(t, layout, eye, PX_PER_RAD, 2, errorOf);
    }
    // The plan's budget is about 1,000 terrain tiles; the large habitat's tall hills need a little more (still within 1,500 draws).
    // At an endcap's tip the eye sees the whole floor around it: within twice the floor's (before the rings near the
    // axis were split only along s, tens of thousands).
    if (s === start.s) onFloor = sel.draw.length;
    assert.ok(sel.draw.length <= (s === start.s ? 1200 : 2 * onFloor), `${sel.draw.length} tiles drawn`);
    assert.equal(sel.want.length, 0);
    const levels = sel.draw.map((k) => k.level);
    assert.ok(Math.max(...levels) >= Math.min(layout.maxLevel, 4), `fine underfoot (deepest ${Math.max(...levels)})`);
    console.log(`  ${name} ${where}: ${sel.draw.length} tiles drawn, ${built.size} built, deepest level ${Math.max(...levels)} of ${layout.maxLevel}`);
    // Every point of the interior is covered by exactly one drawn tile: the areas add up.
    let area = 0;
    for (const k of sel.draw) { const b = bounds(layout, k); area += (b.theta1 - b.theta0) * (b.s1 - b.s0); }
    assert.ok(Math.abs(area - 2 * Math.PI * h.profile.length) < 1e-6 * area);
    assert.equal(new Set(sel.draw.map(keyId)).size, sel.draw.length);
  });
}

test('tiles: a warm tile builds within its budget (40 ms on the reference habitat)', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), eco = makeEcology(t), layout = makeLayout(t);
  // A worker builds hundreds of tiles; the first few also pay for compiling the code, so they are not counted.
  for (let i = 0; i < 8; i++) buildTile(eco, layout, { band: 3, column: 10 + i, level: 2, i: 1, j: 1 });
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    buildTile(eco, layout, { band: 3, column: i, level: 2, i: 1, j: 1 });
    times.push(performance.now() - t0);
  }
  const ms = times.sort((a, b) => a - b)[2];
  assert.ok(ms < 40, `${ms.toFixed(1)} ms per tile (median of 5, warm)`);
});
