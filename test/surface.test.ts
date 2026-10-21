import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld } from '../src/blueprint';
import { buildSurface, gridSize } from '../src/gen/surface';

// A small budget keeps the test fast; the sizing rule is the same at any budget.
const CELLS = 4000;

for (const { name, params } of MATRIX) {
  const h = derive(params);
  test(`surface (${name}): the grid lies on the profile, faces the air, and keeps to its budget`, () => {
    const g = buildSurface(h, CELLS);
    assert.ok(g.columns * g.rows < CELLS * 1.3, `${g.columns} × ${g.rows} cells`);
    const cellAround = (2 * Math.PI * h.radius) / g.columns, cellAlong = h.profile.length / g.rows;
    assert.ok(cellAround / cellAlong > 0.7 && cellAround / cellAlong < 1.4, 'cells are about square');
    const ring = g.columns + 1;
    for (let v = 0; v < g.positions.length / 3; v += 37) {
      const [x, y, z] = [g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]];
      const at = fromWorld(h.profile, x, y, z);
      assert.ok(Math.abs(at.h) < h.radius * 1e-5 + 0.05, `vertex ${v} is ${at.h} m off the profile`);
      const n = Math.hypot(g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]);
      assert.ok(Math.abs(n - 1) < 1e-5);
      for (let k = 0; k < 3; k++) assert.ok(g.colors[v * 3 + k] >= 0 && g.colors[v * 3 + k] <= 1);
    }
    // Every triangle's winding agrees with the normals: its face looks into the air.
    for (let t = 0; t < g.index.length; t += 3 * 101) {
      const [a, b, c] = [g.index[t], g.index[t + 1], g.index[t + 2]];
      const P = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
      const [pa, pb, pc] = [P(a), P(b), P(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const dot = face[0] * g.normals[a * 3] + face[1] * g.normals[a * 3 + 1] + face[2] * g.normals[a * 3 + 2];
      if (Math.hypot(...face) > 1e-6) assert.ok(dot > 0, `triangle ${t / 3} faces the ground`);
    }
    assert.equal(g.index.length, g.columns * g.rows * 6);
    assert.ok(Math.max(...g.index) < g.positions.length / 3);
    assert.equal(ring * (g.rows + 1) * 3, g.positions.length);
  });
}

test('surface: the same habitat gives the same colours (seeded), another seed others', () => {
  const [a, b] = [buildSurface(derive(MATRIX[0].params), 2000), buildSurface(derive(MATRIX[0].params), 2000)];
  assert.deepEqual(a.colors, b.colors);
  const c = buildSurface(derive({ ...MATRIX[0].params, seed: 99 }), 2000);
  assert.notDeepEqual(a.colors, c.colors);
});

test('surface: a bigger habitat gets bigger cells from the same budget', () => {
  const sizes = MATRIX.map(({ params }) => gridSize(derive(params)).cell);
  const areas = MATRIX.map(({ params }) => { const h = derive(params); return h.radius * h.profile.length; });
  for (let i = 0; i < sizes.length; i++) for (let j = 0; j < sizes.length; j++) if (areas[i] > areas[j]) assert.ok(sizes[i] > sizes[j]);
});
