/** The spindle's bore (src/render/bore.ts): walls and lamps inside the tube, over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { boreShapes } from '../src/render/bore';

for (const { name, params } of MATRIX) {
  test(`bore (${name}): walls face the axis from inside the tube, the sleeve has its window, lamps along both parts`, () => {
    const h = derive(params), b = h.exterior.spindle.bore, s = boreShapes(h);
    const check = (shape: typeof s.still.walls, z0: number, z1: number): void => {
      for (let v = 0; v < shape.vertices; v++) {
        const x = shape.pos[v * 3], y = shape.pos[v * 3 + 1], z = shape.pos[v * 3 + 2] + b.bearing, r = Math.hypot(x, y);
        assert.ok(r <= b.radius * (1 + 1e-6) && z >= z0 - 1e-6 && z <= z1 + 1e-6, `${name}: a vertex outside the tube at r ${r}, z ${z}`);
        // Nothing faces out of the tube: every normal points in, or along it.
        const n = [shape.nrm[v * 3], shape.nrm[v * 3 + 1]];
        if (r > b.radius * 0.995) assert.ok(n[0] * x + n[1] * y <= 1e-6, `${name}: a wall faces out`);
      }
    };
    check(s.still.walls, b.bearing, b.to);
    check(s.turning.walls, b.from, b.bearing);
    check(s.still.lamps, b.bearing, b.to);
    check(s.turning.lamps, b.from, b.bearing);
    assert.ok(s.still.lamps.vertices > 0 && s.turning.lamps.vertices > 0);
    // The window: the sleeve leaves wall panels out where the still part has all of them per row.
    const rows = (z0: number, z1: number): number => Math.max(1, Math.round((z1 - z0) / b.radius));
    const panels = (shape: typeof s.still.walls): number => shape.idx.length;
    assert.ok(panels(s.turning.walls) / rows(b.from, b.bearing) < panels(s.still.walls) / rows(b.bearing, b.to), `${name}: no window`);
  });
}
