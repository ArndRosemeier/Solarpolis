/** The spindle's bore (src/render/bore.ts): walls and lamps inside the tube, over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { BORE_HALL, BoreMeshes, boreShapes, boreWindow } from '../src/render/bore';
import { BORE_POOLS } from '../src/render/hullShaders';
import { BORE, LAMP } from '../src/render/materials';

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
    // The window: nothing of the sleeve's wall in front of it, while the still part's wall is whole at its angle.
    const win = boreWindow(h), am = (win.a0 + win.a1) / 2, zm = (win.z0 + win.z1) / 2;
    const covers = (shape: typeof s.still.walls, z: number): boolean => {
      for (let t = 0; t < shape.idx.length; t += 3) {
        const v = [0, 1, 2].map((k) => shape.idx[t + k] * 3), p = [0, 1, 2].map((c) => v.reduce((n, i) => n + shape.pos[i + c], 0) / 3);
        const a = Math.atan2(p[1], p[0]);
        if (Math.hypot(p[0], p[1]) > b.radius * 0.98 && Math.abs(a - am) < (win.a1 - win.a0) * 0.3 && Math.abs(p[2] - z) < (win.z1 - win.z0) * 0.7) return true;
      }
      return false;
    };
    assert.ok(!covers(s.turning.walls, zm), `${name}: no window`);
    assert.ok(covers(s.still.walls, (b.to - b.bearing) / 2), `${name}: the still part's wall has a hole`);
    // A hall, not a pipe: hoops of light along both parts.
    const hoops = (shape: typeof s.still.lamps): number => new Set(Array.from({ length: shape.vertices }, (_, v) => shape.pos[v * 3 + 2]).filter((z) => Math.abs(Math.round(z / (BORE_HALL.pitch * b.radius)) * BORE_HALL.pitch * b.radius - z) < b.radius * 0.03).map((z) => Math.round(z / (BORE_HALL.pitch * b.radius)))).size;
    assert.ok(hoops(s.still.lamps) >= Math.floor((b.to - b.bearing) / (BORE_HALL.pitch * b.radius)) - 1, `${name}: hoops along the still part`);
  });
}

test('bore: each mesh carries exactly its kind\'s attributes (anything else is a shader the Stage never warmed)', () => {
  const meshes = new BoreMeshes(derive(MATRIX[0].params), 'test').all;
  for (const m of meshes) {
    const kind = m.material === LAMP.material ? LAMP : BORE;
    assert.deepEqual(Object.keys(m.geometry.attributes).sort(), [...kind.attributes].sort(), m.name);
  }
});

test('bore: the hoops\' pools of light average to the bore\'s light, so the exposure meter sees it as before', () => {
  const n = 2000, { base, pool, reach } = BORE_POOLS;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += base + pool * Math.exp(-((((k + 0.5) / n - 0.5) / reach) ** 2));
  assert.ok(Math.abs(sum / n - 1) < 0.01, `mean ${sum / n}`);
});
