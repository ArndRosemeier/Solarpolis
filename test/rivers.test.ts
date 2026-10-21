import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, validate, withParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { riverPoint, type River } from '../src/gen/rivers';
import { buildWater } from '../src/gen/water';
import { bounds, buildTile, children, makeLayout, roots, type TileKey } from '../src/gen/tiles';

/** How far in from the hull a height above the profile at s is: what water runs down. */
const elevationOf = (h: ReturnType<typeof derive>, s: number, height: number) => {
  const p = h.profile.at(s);
  return h.radius - p.r - height * p.nr;
};

/** Samples in the order the water passes them. */
const downstream = (r: River) => Array.from({ length: r.count }, (_, n) => (r.from === 'wild' ? n : r.count - 1 - n));

for (const { name, params } of MATRIX) {
  test(`rivers (${name}): fall from springs on the endcaps into the lake, never uphill, in channels they carved`, () => {
    const h = derive(params), t = makeTerrain(h), spec = params.relief.rivers;
    if (!spec || !t.lake) { assert.equal(t.rivers.length, 0, 'no lake, no rivers'); return; }
    assert.equal(t.rivers.length, spec.count);
    const lake = t.lake, { profile } = h;
    for (const r of t.rivers) {
      const order = downstream(r), first = order[0], last = order[order.length - 1];
      const springS = r.s0 + first * r.step, mouthS = r.s0 + last * r.step;
      assert.ok(r.from === 'wild' ? springS < profile.floorStart : springS > profile.floorEnd, 'the spring is on its endcap');
      assert.ok(Math.abs(mouthS - lake.s) < lake.halfWidth, 'the mouth is in the lake');
      assert.ok(Math.abs(r.surface[last] - lake.level) < 1e-6, 'at the lake, the lake\'s level');
      let before = Infinity, run = -1;
      for (const i of order) {
        const e = elevationOf(h, r.s0 + i * r.step, r.surface[i]);
        assert.ok(e <= before + 1e-6, `the water never climbs (${e} after ${before})`);
        assert.ok(r.run[i] > run - 1e-9 && Number.isFinite(r.steep[i]) && r.steep[i] >= 0, 'run grows downstream');
        before = e; run = r.run[i];
      }
      // Its channel: deep in the middle, banks above the water at the edge; one stands (swims) on the water.
      let deep = 0, banks = 0, n = 0;
      for (let i = 1; i < r.count - 1; i += Math.max(1, Math.floor(r.count / 40))) {
        const s = r.s0 + i * r.step;
        if (Math.abs(s - lake.s) < lake.halfWidth * 1.5) continue;
        const mid = riverPoint(r, s), rad = profile.at(s).r;
        const ground = t.heightAt(mid.theta, s);
        if (ground < mid.surface - r.depth * 0.5) deep++;
        const side = t.heightAt(mid.theta + (mid.halfWidth * 1.05) / rad, s);
        if (side >= mid.surface - 1e-3) banks++;
        if (Math.abs(t.standAt(mid.theta, s) - mid.surface) < 1e-6) n++;
      }
      assert.ok(deep >= 38 && banks >= 36 && n >= 38, `deep ${deep}, banks ${banks}, on the water ${n} of 40`);
    }
    // Same habitat, same rivers.
    assert.deepEqual(makeTerrain(derive(params)).rivers[0].theta, t.rivers[0].theta);
  });

  test(`river water (${name}): ribbons over the channel at the water's level, facing the air, flowing downstream`, () => {
    const h = derive(params), t = makeTerrain(h);
    if (!t.rivers.length) return;
    const r = t.rivers[0], i = Math.floor(r.count * 0.6), s = r.s0 + i * r.step, mid = riverPoint(r, s);
    const rad = h.profile.at(s).r, half = (mid.halfWidth * 30) / rad;
    // A fine tile around the river (cells far finer than it), whose own ground is the true ground.
    const tile = { theta0: mid.theta - half, theta1: mid.theta + half, s0: s - mid.halfWidth * 30, s1: s + mid.halfWidth * 30, cell: mid.halfWidth / 8, drawn: t.heightAt };
    const w = buildWater(t, tile, [0, 0, 0])!;
    assert.ok(w && w.index.length > 0, 'water over the river');
    for (const a of [w.positions, w.normals, w.flow, w.dir]) assert.ok(a.every(Number.isFinite), 'finite');
    let wet = 0, middle = 0, faces = 0;
    for (let v = 0; v < w.positions.length / 3; v++) {
      const p = fromWorld(h.profile, w.positions[v * 3], w.positions[v * 3 + 1], w.positions[v * 3 + 2]);
      const at = riverPoint(r, p.s);
      assert.ok(Math.abs(p.h - at.surface) < 0.05 + at.halfWidth * 0.02, `at the water's level (${p.h} vs ${at.surface})`);
      if (Math.abs(w.flow[v * 4]) < 0.6) { middle++; if (p.h > t.heightAt(p.theta, p.s)) wet++; }
      assert.ok(w.flow[v * 4 + 2] > 0 && Math.abs(Math.hypot(w.dir[v * 4], w.dir[v * 4 + 1], w.dir[v * 4 + 2]) - 1) < 1e-4, 'it flows');
    }
    // Triangles wind toward their normals (faces look into the air).
    for (let f = 0; f < w.index.length; f += 3) {
      const [a, b, c] = [w.index[f], w.index[f + 1], w.index[f + 2]].map((k) => [w.positions[k * 3], w.positions[k * 3 + 1], w.positions[k * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const k = w.index[f] * 3;
      if (n[0] * w.normals[k] + n[1] * w.normals[k + 1] + n[2] * w.normals[k + 2] > 0) faces++;
    }
    assert.equal(faces, w.index.length / 3, 'every face looks into the air');
    assert.ok(middle > 0 && wet > middle * 0.9, `the middle of the ribbon is over its channel (${wet} of ${middle})`);
    // Downstream: the run grows the way the water points.
    const v0 = 2, v1 = v0 + 5; // the middle points of two cross-sections in a row
    const step = [w.positions[v1 * 3] - w.positions[v0 * 3], w.positions[v1 * 3 + 1] - w.positions[v0 * 3 + 1], w.positions[v1 * 3 + 2] - w.positions[v0 * 3 + 2]];
    const along = step[0] * w.dir[v0 * 4] + step[1] * w.dir[v0 * 4 + 1] + step[2] * w.dir[v0 * 4 + 2];
    assert.ok(Math.sign(along) === Math.sign(w.flow[v1 * 4 + 1] - w.flow[v0 * 4 + 1]), 'dir points downstream');
  });
}

test('river water: far away, a river lies over the coarse ground its tile draws (it never sinks under a hillside)', () => {
  const h = derive(MATRIX[0].params), t = makeTerrain(h), eco = makeEcology(t), layout = makeLayout(t);
  const r = t.rivers[0], i = Math.floor(r.count * 0.5), s = r.s0 + i * r.step, theta = r.theta[i];
  const holds = (k: TileKey) => { const b = bounds(layout, k); const u = ((theta - b.theta0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return s >= b.s0 && s < b.s1 && u < b.theta1 - b.theta0; };
  let key = roots(layout).find(holds)!;
  key = children(layout, key).find(holds)!;
  const tile = buildTile(eco, layout, key);
  assert.ok(tile.water, 'the river is drawn on a tile two kilometres wide');
  const w = tile.water!;
  let over = 0;
  const n = w.positions.length / 3;
  for (let v = 0; v < n; v++) {
    const p = fromWorld(h.profile, w.positions[v * 3] + tile.origin[0], w.positions[v * 3 + 1] + tile.origin[1], w.positions[v * 3 + 2] + tile.origin[2]);
    // Over the tile's own grid: compare with the grid point nearest (the grid is the ground drawn there).
    if (p.h >= t.heightAt(p.theta, p.s) - 0.5) over++;
  }
  assert.ok(over > n * 0.9, `${over} of ${n} water points over the ground`);
});

test('rivers: they wet their banks (reeds and willows grow there) and need a lake narrower than them to be valid', () => {
  const h = derive(MATRIX[0].params), t = makeTerrain(h), eco = makeEcology(t), { profile } = h;
  let near = 0, far = 0, n = 0;
  for (const r of t.rivers) for (let i = 0; i < r.count; i += 97) {
    const s = r.s0 + i * r.step;
    if (s < profile.floorStart || s > profile.floorEnd || Math.abs(s - t.lake!.s) < t.lake!.halfWidth * 4) continue;
    const mid = riverPoint(r, s), rad = profile.at(s).r;
    const at = (out: number) => { const th = mid.theta + (mid.halfWidth + out) / rad; return eco.moistureAt(th, s, t.heightAt(th, s)); };
    near += at(5); far += at(400); n++;
  }
  assert.ok(n > 20 && near / n > far / n + 0.15, `moisture ${(near / n).toFixed(2)} on the banks, ${(far / n).toFixed(2)} 400 m off`);
  const ids = (p: Parameters<typeof withParams>[0]) => validate(derive(withParams(p))).map((f) => `${f.severity}:${f.id}`);
  const relief = MATRIX[0].params.relief;
  assert.ok(ids({ relief: { ...relief, rivers: { count: 4, width: 600, depth: 2 } } }).includes('invalid:relief'), 'wider than the lake');
  assert.ok(ids({ relief: { ...relief, rivers: { count: 2.5, width: 10, depth: 2 } } }).includes('invalid:relief'), 'a whole count');
  assert.deepEqual(ids({ relief: { ...relief, rivers: null } }), ids({}), 'none is fine');
});
