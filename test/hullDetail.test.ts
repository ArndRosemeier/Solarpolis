/** The skin's detail tiles up close (src/gen/hullDetail.ts) and the pure shape builder (src/gen/shapes.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { makeSkin, type Skin } from '../src/gen/skin';
import { ROOT_LEVEL, buildHullTile, bayEdge, detailOf, finestLevel, hullTileBytes, railTop, tileOrigin, wantedTiles, type HullTile, type HullTileKey } from '../src/gen/hullDetail';
import type { Vec3 } from '@futuremagic/core';

/** Every triangle's winding agrees with its normal (front faces outward), and the share of them that are not slivers. */
function windingOk(pos: Float32Array, nrm: Float32Array, idx: Uint32Array): { bad: number; total: number } {
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) continue;
    const k = idx[t] * 3;
    if ((n[0] * nrm[k] + n[1] * nrm[k + 1] + n[2] * nrm[k + 2]) / len < 0.5) bad++;
  }
  return { bad, total: idx.length / 3 };
}

/** Glass area of a tile (m²). */
function glassArea(t: HullTile): number {
  const p = t.glass.positions, idx = t.glass.index;
  let area = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
  }
  return area;
}

const children = (k: HullTileKey): HullTileKey[] => {
  const h = Math.pow(2, k.level - 1);
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => ({ level: k.level - 1, i: k.i + a * h, j: k.j + b * h }));
};

/** An eye `height` m above the skin at the middle of bay (i, j). */
const eyeOver = (s: Skin, i: number, j: number, height: number): Vec3 => {
  const th = ((i + 0.5) / s.nTheta) * 2 * Math.PI, r = s.radius + height;
  return [Math.cos(th) * r, Math.sin(th) * r, s.z0 + ((j + 0.5) / s.nZ) * (s.z1 - s.z0)];
};

for (const { name, params } of MATRIX) {
  const s = makeSkin(derive(params));
  // A bay next to a drone track (column 0 holds one), in the middle of the drum.
  const J = Math.floor(s.nZ / 2);

  test(`hull detail (${name}): the leaves around an eye cover the skin near it exactly once, finer near the eye`, () => {
    const eye = eyeOver(s, 0, J, 1);
    const wanted = wantedTiles(s, eye), leaves = wanted.filter((w) => w.leaf);
    assert.ok(leaves.some((w) => w.key.level === finestLevel(s)), 'the finest tiles under the eye');
    assert.ok(leaves.some((w) => w.key.level === ROOT_LEVEL), 'root tiles further out');
    const P = bayEdge(s), dz = (s.z1 - s.z0) / s.nZ;
    // Points of the skin around the eye, within a root tile's reach: each in exactly one leaf.
    for (let a = -40; a <= 40; a++) {
      for (let b = -40; b <= 40; b += 5) {
        const fi = ((0.5 + (a * 3.7) / P) % s.nTheta + s.nTheta) % s.nTheta, fj = J + 0.5 + (b * 3.1) / dz;
        if (fj < 0 || fj >= s.nZ) continue;
        const holding = leaves.filter((w) => {
          const size = Math.pow(2, w.key.level);
          return fi >= w.key.i && fi < Math.min(w.key.i + size, s.nTheta) && fj >= w.key.j && fj < Math.min(w.key.j + size, s.nZ);
        });
        assert.equal(holding.length, 1, `point (${fi.toFixed(3)}, ${fj.toFixed(3)}) in ${holding.length} leaves`);
      }
    }
    // Far above the skin, no tiles at all: the drum's own shader draws it.
    assert.equal(wantedTiles(s, eyeOver(s, 0, J, 1e5)).length, 0);
  });

  test(`hull detail (${name}): smaller tiles hold more parts per square metre, faces wound outward, glass above the drum`, () => {
    let last = 0;
    for (let level = ROOT_LEVEL; level >= finestLevel(s); level--) {
      const size = Math.pow(2, level), key = { level, i: 8, j: J };
      const t = buildHullTile(s, key);
      const area = Math.min(size, s.nTheta) * bayEdge(s) * Math.min(size, s.nZ - J) * ((s.z1 - s.z0) / s.nZ);
      const density = (t.parts.index.length + t.glass.index.length) / 3 / area;
      assert.ok(density > last * 1.2 || detailOf(s, level) === detailOf(s, level + 1), `level ${level}: ${density.toFixed(3)} triangles/m² after ${last.toFixed(3)}`);
      last = density;
      for (const m of [t.parts, t.glass]) {
        const w = windingOk(m.positions, m.normals, m.index);
        assert.equal(w.bad, 0, `level ${level}: ${w.bad} of ${w.total} faces wound inward`);
      }
      // Relative to the tile's origin: small numbers, so float32 keeps them to the millimetre.
      const reach = 2 * Math.max(size * bayEdge(s), s.trackWidth);
      for (const v of t.parts.positions) assert.ok(Math.abs(v) < reach, `level ${level}: position ${v} far from its origin`);
      const o = tileOrigin(s, key), g = t.glass.positions;
      for (let k = 0; k < g.length; k += 3) {
        const r = Math.hypot(g[k] + o[0], g[k + 1] + o[1]);
        assert.ok(r > s.radius, `level ${level}: glass at ${r} below the drum's ${s.radius}`);
      }
      const mod = t.glass.grid;
      for (let k = 0; k < mod.length; k += 4) {
        assert.ok(mod[k + 2] >= -1e-3 && mod[k + 2] <= s.modules + 1e-3 && mod[k + 3] >= -1e-3 && mod[k + 3] <= s.modules + 1e-3, 'module coordinates inside the grid');
      }
      assert.ok(hullTileBytes(t) > 0);
    }
  });

  test(`hull detail (${name}): a tile's glass is its children's, so levels swap without gaps or double glass`, () => {
    for (let level = 1; level > finestLevel(s); level--) {
      const key = { level, i: 0, j: J }, kids = children(key);
      if (detailOf(s, level) !== detailOf(s, level - 1)) continue;
      const whole = glassArea(buildHullTile(s, key)), parts = kids.reduce((n, k) => n + glassArea(buildHullTile(s, k)), 0);
      assert.ok(Math.abs(whole - parts) <= whole * 1e-6, `level ${level}: ${whole} m² of glass, its children ${parts}`);
    }
  });

  test(`hull detail (${name}): the drones ride on the rails`, () => {
    assert.ok(railTop(s) > 0 && railTop(s) < s.droneSize * 0.2);
  });
}
