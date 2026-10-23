import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { terrainOf } from './worlds';
import { riverPoint, sampleS } from '../src/gen/rivers';
import { buildWater } from '../src/gen/water';

for (const { name } of MATRIX) test(`Waterfall (${name}): closed water sections have depth, spray, and identical tile joins`, () => {
  const original = terrainOf(name), h = original.habitat;
  // A steep three-sample reach in each habitat, including blueprints whose natural rivers have no falls.
  const source = original.rivers[0];
  if (!source) { assert.ok(!original.lake, 'without a lake there are no rivers or falls'); return; }
  // (Out of the lakes on the floor, where a river runs under the lake's own water.)
  let i = Math.floor(source.count / 2);
  for (let k = 0; k < source.count / 2 && original.form.fromWater(riverPoint(source, sampleS(source, i)).theta, sampleS(source, i)) < source.step * 4; k++) i = Math.floor(source.count / 2) + (k % 2 ? k : -k);
  const r = { ...source, steep: source.steep.slice() };
  r.steep.fill(1, i - 2, i + 3);
  const t = { ...original, rivers: [r] };
  const s = r.s0 + i * r.step, a = riverPoint(r, s), width = a.halfWidth * 3 / h.radius;
  const tile = { theta0: a.theta - width, theta1: a.theta + width, s0: s - r.step, s1: s + r.step, cell: a.halfWidth / 8, drawn: t.heightAt };
  const left = buildWater(t, { ...tile, s1: s }, [0, 0, 0])!, right = buildWater(t, { ...tile, s0: s }, [0, 0, 0])!;
  for (const w of [left, right]) {
    assert.ok(w.positions.every(Number.isFinite) && w.normals.every(Number.isFinite));
    assert.ok(w.index.every((n) => n < w.positions.length / 3));
    assert.ok(Array.from(w.flow).some((v, k) => k % 4 === 3 && v < 0), 'spray is actual three-dimensional geometry');
    assert.ok(w.positions.byteLength + w.normals.byteLength + w.flow.byteLength + w.dir.byteLength + w.index.byteLength < 250000, 'small per-segment geometry cost');
  }
  const join = (w: typeof left): Set<string> => {
    const points = new Set<string>();
    for (let n = 0; n < w.positions.length / 3; n++) if (Math.abs(w.flow[n * 4 + 1] - a.run) < 0.01 && w.flow[n * 4 + 3] >= 0) points.add(Array.from(w.positions.slice(n * 3, n * 3 + 3)).map((v) => v.toFixed(3)).join(','));
    return points;
  };
  assert.deepEqual(join(left), join(right), 'adjacent tiles meet at the same volume cross-section');
  // More than the original five points: each stream has a closed, non-flat eight-sided section plus its end cap.
  assert.ok(join(left).size >= 45);
});
