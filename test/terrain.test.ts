import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeLayout, roots, bounds, buildTile, select, children, TILE_CELLS, type TileKey } from '../src/gen/tiles';

const PX_PER_RAD = 1440 / (70 * Math.PI / 180);

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const t = makeTerrain(h);
  const layout = makeLayout(t);

  test(`terrain (${name}): wraps around the axis, stays within its relief, and the lake holds water`, () => {
    const rl = params.relief;
    for (let k = 0; k < 200; k++) {
      const theta = k * 2.399, s = (k / 200) * h.profile.length;
      assert.ok(Math.abs(t.heightAt(theta, s) - t.heightAt(theta + 2 * Math.PI, s)) < 1e-6, 'no seam at θ = 2π');
      const g = t.heightAt(theta, s);
      assert.ok(g <= Math.max(rl.hills, rl.terraceStep) * 1.2 + 0.5 && g >= -(rl.ringLake?.depth ?? 0) - Math.max(rl.terraceStep, 1) - 0.5, `height ${g} at ${s}`);
    }
    if (rl.ringLake) {
      assert.ok(t.lake, 'a ring lake');
      const lake = t.lake!;
      assert.ok(lake.s - lake.halfWidth > h.profile.floorStart && lake.s + lake.halfWidth < h.profile.floorEnd, 'on the floor');
      for (const theta of [0, 2, 4]) {
        assert.ok(t.heightAt(theta, lake.s) < lake.level - lake.depth * 0.5, 'deep in the middle');
        assert.equal(t.standAt(theta, lake.s), lake.level, 'one stands (swims) on the water');
      }
    } else assert.equal(t.lake, null);
  });

  test(`tiles (${name}): bands cover the profile, neighbours meet, faces look into the air`, () => {
    assert.equal(layout.bands[0].s0, 0);
    assert.ok(Math.abs(layout.bands[layout.bands.length - 1].s1 - h.profile.length) < 1e-6);
    const rs = roots(layout);
    assert.ok(rs.length >= 8 && rs.length <= 120, `${rs.length} roots`);
    // Two neighbours around the axis, at a fine level on the floor, share their edge points exactly.
    const band = layout.bands.findIndex((b) => b.s0 <= h.profile.floorStart + 1 && b.s1 > h.profile.floorStart + 1) + 1;
    const level = Math.min(3, layout.maxLevel);
    const a: TileKey = { band, column: 0, level, i: 0, j: 0 }, b: TileKey = { ...a, i: 1 };
    const ta = buildTile(t, layout, a), tb = buildTile(t, layout, b);
    const row = TILE_CELLS + 1;
    for (let j = 0; j <= TILE_CELLS; j += 8) {
      const va = (j * row + TILE_CELLS) * 3, vb = (j * row) * 3;
      for (let c = 0; c < 3; c++) {
        const wa = ta.origin[c] + ta.positions[va + c], wb = tb.origin[c] + tb.positions[vb + c];
        assert.ok(Math.abs(wa - wb) < 2e-3 + Math.abs(wa) * 2e-7, `edge point ${j} axis ${c}: ${wa} vs ${wb}`);
      }
    }
    // Normals face the air (towards the axis on the floor).
    for (let v = 0; v < row * row; v += 97) {
      const x = ta.origin[0] + ta.positions[v * 3], y = ta.origin[1] + ta.positions[v * 3 + 1];
      const r = Math.hypot(x, y);
      assert.ok((-x * ta.normals[v * 3] - y * ta.normals[v * 3 + 1]) / r > 0.5);
    }
    // Children exactly tile their parent.
    const p = bounds(layout, a), kids = children(a).map((k) => bounds(layout, k));
    assert.equal(Math.min(...kids.map((k) => k.theta0)), p.theta0);
    assert.ok(Math.abs(Math.max(...kids.map((k) => k.s1)) - p.s1) < 1e-9);
  });

}

test('tiles: nothing built yet means the roots are wanted first; a tile builds within its budget', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), layout = makeLayout(t);
  const sel = select(t, layout, [h.radius - 2, 0, h.length / 2], PX_PER_RAD, 2, () => undefined);
  assert.equal(sel.draw.length, 0);
  assert.equal(sel.want.length, roots(layout).length);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) buildTile(t, layout, { band: 3, column: i, level: 2, i: 1, j: 1 });
  const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 40, `${ms.toFixed(1)} ms per tile`);
});
