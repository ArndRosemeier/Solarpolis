import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, BARK_STRIPS, LITE_DETAIL, type TreeModel } from '../src/gen/trees';
import { barkAtlas } from '../src/gen/foliage';
import { PLANT_FORMS } from '../src/blueprint';

/** The tallest point of a mesh. */
function top(p: Float32Array): number {
  let t = 0;
  for (let i = 1; i < p.length; i += 3) t = Math.max(t, p[i]);
  return t;
}

const tris = (m: { index: Uint32Array }) => m.index.length / 3;

for (const form of PLANT_FORMS) {
  test(`trees (${form}): full, light and hull build one unit high, finite, in budget, the same each time`, () => {
    const full = buildTree(form, 7, 0), lite = buildTree(form, 7, 0, LITE_DETAIL);
    const meshes = (t: TreeModel) => [t.wood, t.leaves, t.hull];
    for (const t of [full, lite]) for (const m of meshes(t)) {
      assert.ok(tris(m) > 0, `${form}: empty mesh`);
      for (const a of Object.values(m)) assert.ok((a as Float32Array).every(Number.isFinite), `${form}: finite`);
      for (const i of m.index) assert.ok(i < m.positions.length / 3, `${form}: index in range`);
    }
    const tall = Math.max(top(full.wood.positions), top(full.leaves.positions));
    assert.ok(tall > 0.97 && tall < 1.05, `${form} is one unit high: ${tall}`);
    assert.ok(tris(full.wood) + tris(full.leaves) <= 8000, `${form}: ${tris(full.wood)} + ${tris(full.leaves)} triangles`);
    assert.ok(tris(lite.wood) + tris(lite.leaves) <= 2600 && tris(lite.leaves) <= tris(full.leaves), `${form} light: ${tris(lite.wood)} + ${tris(lite.leaves)}`);
    assert.ok(tris(full.hull) <= 100, `${form} hull: ${tris(full.hull)}`);
    // Bark strips and leaf cells: wood uv.x is strip * 16 + u, leaf uvs lie in the atlas.
    for (let i = 0; i < full.wood.uvs.length; i += 2) assert.ok(full.wood.uvs[i] >= 0 && full.wood.uvs[i] < BARK_STRIPS * 16, `${form}: bark strip`);
    assert.ok(full.leaves.uvs.every((u) => u >= 0 && u <= 1), `${form}: leaf uv`);
    assert.ok(full.leaves.tint.every((v) => v >= 0 && v <= 1) && full.leaves.occ.every((v) => v >= 0 && v <= 1), `${form}: tint, occlusion`);
    assert.ok(full.canopy.every((c) => c > 0 && c < 1) && full.crown > 0, `${form}: canopy colour, crown`);
    // What the far hull is matched against (render/plants.ts matchLeaves): the cards' shading, the hull's own colour.
    assert.ok(full.leaf.shade.every((v) => v > 0.4 && v < 1.2) && full.hullColor.every((v) => v > 0 && v < 1) && full.leaf.cell >= 0 && full.leaf.cell < 16, `${form}: leaf look`);
    // The far hull is about as big as the plant it stands for, so nothing swells as it comes close (Arnd: shrubs did).
    const size = (p: Float32Array) => {
      let w = 0, h = 0;
      for (let i = 0; i < p.length; i += 3) { w = Math.max(w, Math.hypot(p[i], p[i + 2])); h = Math.max(h, p[i + 1]); }
      return { w, h };
    };
    const hull = size(full.hull.positions), leaves = size(full.leaves.positions);
    assert.ok(hull.h > 0.8 * leaves.h && hull.h < 1.1 * leaves.h && hull.w > 0.65 * leaves.w && hull.w < 1.1 * leaves.w, `${form} hull ${hull.w.toFixed(2)}×${hull.h.toFixed(2)}, leaves ${leaves.w.toFixed(2)}×${leaves.h.toFixed(2)}`);
  });
}

test('trees: same seed, same tree; another variant, another tree', () => {
  const a = buildTree('oak', 3, 1), b = buildTree('oak', 3, 1), c = buildTree('oak', 3, 2);
  assert.deepEqual(a.leaves.positions, b.leaves.positions);
  assert.notDeepEqual(a.wood.positions, c.wood.positions);
});

test('bark atlas: every strip, colour and normal map, normals pointing out of the bark', () => {
  const at = barkAtlas(16, 32);
  assert.equal(at.width, 16 * BARK_STRIPS);
  assert.equal(at.color.length, at.width * at.height * 4);
  for (let i = 0; i < at.normal.length; i += 4) assert.ok(at.normal[i + 2] > 128, 'normal faces out');
  assert.deepEqual(barkAtlas(16, 32).color, at.color, 'the same each time');
});
