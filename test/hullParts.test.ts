/** The hardware up close (src/gen/hullParts.ts) and the detail tree under it (src/gen/detailTree.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { makeSkin } from '../src/gen/skin';
import { buildPartTile, detailParts, partDetail, partEye, partTileBytes, partTiles, wholeTile, type DetailPart } from '../src/gen/hullParts';
import { cellsOf, coverOf, tileId, wantedCells, type Grid } from '../src/gen/detailTree';
import { v3add, v3scale, type Vec3 } from '@futuremagic/core';
import { windingOk } from './meshChecks';

/** A point of a part's own axes in its frame. */
const placed = (p: DetailPart, q: Vec3): Vec3 => v3add(p.place.at, v3add(v3scale(p.place.ex, q[0]), v3add(v3scale(p.place.ey, q[1]), v3scale(p.place.ez, q[2]))));

/** An eye `h` m off the part, near its middle (its own axes, then its frame). */
function eyeNear(p: DetailPart, h: number): Vec3 {
  if (p.kind === 'plating') return [p.radius + h, 0, (p.from + p.to) / 2];
  if (p.kind === 'truss') return placed(p, [p.width / 2 + h, 0, p.length / 2]);
  if (p.kind === 'dish') { const rho = p.diameter * 0.3; return placed(p, [rho, 0, p.boom + (rho * rho) / (1.6 * p.diameter) + h]); }
  return [0, 0, 0];
}

test('detail tree: the leaves of an open grid cover it once near the eye, and a cover never doubles up', () => {
  const g: Grid = { nU: 1, nV: 19, wrap: false, edgeU: 7, edgeV: 7, root: 5, finest: 0 };
  const leaves = wantedCells(g, { u: 0.5, v: 9.5, h: 1 }).filter((w) => w.leaf);
  for (let v = 0.25; v < g.nV; v += 0.5) {
    const holding = leaves.filter((w) => { const s = Math.pow(2, w.key.level); return v >= w.key.j && v < Math.min(w.key.j + s, g.nV); });
    assert.equal(holding.length, 1, `row ${v} in ${holding.length} leaves`);
  }
  // With nothing built the cover is empty and incomplete; with only the root it is the root; with all, the leaves.
  const wanted = wantedCells(g, { u: 0.5, v: 9.5, h: 1 }), root = tileId(wanted[0].key);
  assert.deepEqual(coverOf(wanted, () => false), { drawn: [], complete: false });
  const some = coverOf(wanted, (id) => id === root);
  assert.equal(some.drawn.length, 1);
  assert.ok(some.complete);
  const all = coverOf(wanted, () => true);
  assert.equal(all.drawn.length, leaves.length);
});

for (const { name, params } of MATRIX) {
  const h = derive(params), skin = makeSkin(h), parts = detailParts(h, skin).filter((p) => p.kind !== 'skin');
  const kinds = new Set(parts.map((p) => p.kind));

  test(`hull parts (${name}): plating, berth arms, the mast and every dish are detailed`, () => {
    assert.deepEqual([...kinds].sort(), ['dish', 'plating', 'truss']);
    assert.equal(parts.filter((p) => p.id.startsWith('arm')).length, h.exterior.spindle.berthArms);
    assert.equal(parts.filter((p) => p.kind === 'dish').length, params.exterior.antennas.count + 1);
    assert.equal(new Set(parts.map((p) => p.id)).size, parts.length, 'ids unique');
  });

  test(`hull parts (${name}): finer tiles near the part, none far from it; a truss's or dish's root holds all of it`, () => {
    for (const p of parts) {
      const near = partTiles(p, skin, eyeNear(p, 0.5));
      assert.ok(near.some((w) => w.leaf && w.key.level === p.grid.finest), `${p.id}: one-cell tiles under an eye 0.5 m off`);
      assert.ok(partEye(p, skin, eyeNear(p, 0.5)).h < 0.6, `${p.id}: the eye is 0.5 m off`);
      assert.equal(partTiles(p, skin, eyeNear(p, 1e5)).length, 0, `${p.id}: nothing from 100 km`);
      if (p.kind !== 'plating') assert.equal(cellsOf(p.grid, wholeTile(p)).length, p.grid.nU * p.grid.nV, `${p.id}: the root holds every cell`);
    }
  });

  test(`hull parts (${name}): smaller tiles hold more per cell, wound outward, small positions`, () => {
    for (const kind of kinds) {
      const p = parts.find((x) => x.kind === kind)!;
      let last = 0;
      for (let level = Math.min(p.grid.root, 4); level >= p.grid.finest; level--) {
        const key = { level, i: 0, j: 0 }, t = buildPartTile(h, skin, p, key);
        const tris = t.parts.index.length / 3, cells = cellsOf(p.grid, key).length, density = tris / cells;
        assert.ok(tris > 0, `${p.id} level ${level}: empty`);
        assert.ok(density > last * 1.2 || partDetail(level) === partDetail(level + 1), `${p.id} level ${level}: ${density.toFixed(1)} triangles a cell after ${last.toFixed(1)}`);
        last = density;
        const w = windingOk(t.parts.positions, t.parts.normals, t.parts.index);
        assert.equal(w.bad, 0, `${p.id} level ${level}: ${w.bad} of ${w.total} faces wound inward`);
        const reach = 2 * Math.pow(2, level) * Math.max(p.grid.edgeU, p.grid.edgeV) + (p.kind === 'dish' ? p.diameter : 0);
        for (const v of t.parts.positions) assert.ok(Math.abs(v) < reach, `${p.id} level ${level}: position ${v} far from its origin`);
        assert.ok(partTileBytes(t) > 0);
      }
    }
  });
}
