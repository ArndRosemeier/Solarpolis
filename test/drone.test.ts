import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES } from '@actors/drone';
import { MATRIX, derive } from '../src/blueprint';
import { KIT, LIGHT_SCALE, STROBE_CODE, designGuess, designsOf, droneDesign, type DesignMesh } from '../src/gen/drone';
import { simplify, type Shape } from '../src/gen/simplify';
import { ROLES } from '../src/sim';

/** A box of `n`×`n` quads a side, in one colour, as a shape. */
function box(n: number): Shape {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1, sign = face & 1 ? -1 : 1, u = (axis + 1) % 3, v = (axis + 2) % 3, base = pos.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const p = [0, 0, 0], q = [0, 0, 0];
      p[axis] = sign; p[u] = (2 * i) / n - 1; p[v] = (2 * j) / n - 1; q[axis] = sign;
      pos.push(...p); nrm.push(...q);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = base + i * (n + 1) + j;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const count = pos.length / 3;
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), colors: new Float32Array(count * 4).fill(0.5), parts: new Float32Array(count * 4), index: Uint32Array.from(idx) };
}

const extent = (p: Float32Array): [number[], number[]] => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]); }
  return [lo, hi];
};

test('simplify: a finely cut box becomes a coarse one of the same size and colour, every triangle whole', () => {
  const fine = box(16), coarse = simplify(fine, 0.5);
  assert.ok(coarse.index.length < fine.index.length / 10, `${coarse.index.length / 3} triangles`);
  const [lo, hi] = extent(coarse.positions);
  for (let k = 0; k < 3; k++) assert.ok(lo[k] <= -0.7 && hi[k] >= 0.7, 'keeps its size');
  for (const v of coarse.colors) assert.equal(v === 0 || v === 0.5, true);
  for (let t = 0; t < coarse.index.length; t += 3) assert.ok(new Set(coarse.index.slice(t, t + 3)).size === 3);
  assert.ok(Math.max(...coarse.index) < coarse.positions.length / 3);
});

/** The opaque paint's mean colour, by vertex (enough to compare two levels of one drone). */
function meanPaint(m: DesignMesh): number[] {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < m.paint.length; i += 4) if (m.paint[i + 3] === 0) { for (let k = 0; k < 3; k++) sum[k] += m.paint[i + k] / 255; n++; }
  return sum.map((v) => v / Math.max(1, n));
}

MATRIX.forEach(({ name, params }, i) => {
  const role = ROLES[i % ROLES.length];
  test(`drone (${name}): a ${role}'s design: its kit, moving rotors and strobes, its lights, and a coarse level that matches it`, () => {
    const d = droneDesign(derive(params), role, 0);
    assert.equal(d.role, role);
    assert.ok(KIT[role].archetypes.some((a) => d.name.includes(ARCHETYPES[a].name)), d.name);
    for (const m of [d.body, d.veil, d.coarse.body, d.coarse.veil]) {
      const n = m.positions.length / 3;
      assert.equal(m.normals.length, n * 3);
      assert.equal(m.paint.length, n * 4);
      assert.equal(m.spin.length, n * 4);
      assert.ok(m.index.every((k) => k < n));
    }
    const w = Array.from({ length: d.body.spin.length / 4 }, (_, k) => d.body.spin[k * 4 + 3]);
    assert.ok(w.some((x) => x !== 0 && Math.abs(x) < STROBE_CODE), 'something spins');
    assert.ok(w.every((x) => Math.abs(x) < STROBE_CODE || x <= -STROBE_CODE - 1), 'strobes are coded past every spin');
    const lights = Array.from({ length: d.body.paint.length / 4 }, (_, k) => d.body.paint[k * 4 + 3]).filter((a) => a > 0 && a < 255);
    assert.ok(lights.length > 0 && lights.every((a) => (a / 255) * LIGHT_SCALE <= 5.01), 'lights, no brighter than the kit makes them');
    // The coarse level: far fewer triangles, the same size and colour.
    assert.ok(d.coarse.body.index.length < d.body.index.length / 3, `${d.coarse.body.index.length / 3} of ${d.body.index.length / 3} triangles`);
    const [lo, hi] = extent(d.body.positions), [clo, chi] = extent(d.coarse.body.positions);
    for (let k = 0; k < 3; k++) {
      const size = hi[k] - lo[k];
      assert.ok(chi[k] - clo[k] >= 0.85 * size && clo[k] >= lo[k] - 1e-3 && chi[k] <= hi[k] + 1e-3, `axis ${k}: ${(chi[k] - clo[k]).toFixed(2)} of ${size.toFixed(2)} m`);
    }
    const a = meanPaint(d.body), b = meanPaint(d.coarse.body);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 0.08, `colour ${a.map((v) => v.toFixed(2))} vs ${b.map((v) => v.toFixed(2))}`);
    assert.ok(d.min[1] >= -1e-6 && d.max[1] > d.hover * 0.5, 'stands on its own ground point');
    assert.ok(d.albedo.every((v) => v > 0 && v < 1));
  });
});

test('drone bodies people wear: their own designs, small, and their far look guessed near what they are', () => {
  const h = derive(MATRIX.find((m) => m.name === 'small')!.params);
  assert.equal(designsOf(h, 'person'), h.params.life.drones.bodies);
  const d = droneDesign(h, 'person', 0), g = designGuess(h, 'person', 0);
  assert.ok(KIT.person.archetypes.some((a) => d.name.includes(ARCHETYPES[a].name)), d.name);
  const ext = d.max.map((v, k) => v - d.min[k]), across = Math.hypot(ext[0], ext[2]) / Math.SQRT2;
  assert.ok(Math.max(...ext) < 1.6, `no bigger than a person is wide: ${ext.map((v) => v.toFixed(2))}`);
  // The guess stands in for about a pixel, until the built design's measure replaces it.
  assert.ok(g.height > ext[1] / 2.5 && g.height < ext[1] * 2.5, `height ${g.height.toFixed(2)} for ${ext[1].toFixed(2)}`);
  assert.ok(g.across > across / 2.5 && g.across < across * 2.5, `across ${g.across.toFixed(2)} for ${across.toFixed(2)}`);
  assert.ok(g.albedo.every((v) => v >= 0 && v <= 1));
});
