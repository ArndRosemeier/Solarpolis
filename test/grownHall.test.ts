import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, climateOf } from '../src/blueprint';
import { HALL, hallGroundAt, plantedCanopy, plantedLawn, plantingsOf, scatterKeepsOff } from '../src/gen/planted';
import { LIMB, buildHall, daisOf, halfArch, hallKeepsClear, hallSites } from '../src/gen/grownHall';
import { planOf } from '../src/gen/plan';
import { pathsOf } from '../src/gen/paths';
import { childrenOf, rootTiles, type TileKey } from '../src/gen/detailTree';
import { keptClear, landmarkTopAt } from '../src/gen/landmarks';
import { buildPatch } from '../src/gen/patch';
import { floorAt, floorPoint } from '../src/gen/shapes';
import { siteDetailOf } from '../src/gen/siteTiles';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

for (const { name, params } of MATRIX) {
  test(`grown halls (${name}): one in each grove district that has room, its trees planted on level, dry ground clear of the paths`, () => {
    const t = terrainOf(name, params), h = t.habitat, plan = planOf(h), p = plantingsOf(t), paths = pathsOf(h);
    const groves = plan.districts.filter((d) => d.style === 'grove' && d.entrances.length);
    assert.ok(p.halls.length <= groves.length, 'at most one hall a grove district');
    if (groves.length) assert.ok(p.halls.length > 0, `${groves.length} grove districts, and not one hall`);
    const spec = climateOf(params.climate)!.hall;
    if (p.halls.length) assert.ok(p.species.some((x) => x.name === spec.name), 'its trees are planted plants');
    for (const hall of p.halls) {
      assert.equal(plan.districts[hall.district].style, 'grove');
      assert.ok(hall.bays >= 3 && hall.columns.length === 2 * (hall.bays + 1));
      assert.ok(Math.abs(hall.span - hall.height * HALL.span) < 1e-9 && Math.abs(hall.bay - hall.height * HALL.bay) < 1e-9, 'sized from its trees');
      const planted = p.bySpecies.get(spec.name)!;
      let lo = Infinity, hi = -Infinity;
      for (const c of hall.columns) {
        const at = floorAt(h, hall.frame, c.x, c.y);
        assert.ok(Math.abs(at.theta - c.tree.theta) < 1e-9 && Math.abs(at.s - c.tree.s) < 1e-9, 'its tree stands at its column');
        assert.ok(planted.includes(c.tree));
        assert.equal(plan.districtAt(at.theta, at.s)?.id, hall.district, 'in its district');
        assert.equal(t.riverAt(at.theta, at.s), null);
        assert.equal(t.courtAt(at.theta, at.s), null);
        assert.equal(paths.pathAt(at.theta, at.s, 1.5), null, 'no tree on a path');
        assert.ok(Math.abs(t.heightAt(at.theta, at.s) - hall.frame.height - c.ground) < 1e-6);
        assert.ok(Math.abs(hallGroundAt(hall, c.x, c.y) - c.ground) < 0.15, 'its sampled ground agrees');
        lo = Math.min(lo, c.ground); hi = Math.max(hi, c.ground);
      }
      assert.ok((hi - lo) / (2 * hall.half) <= 0.08 + 1e-9, 'all but level');
    }
  });

  test(`grown halls (${name}): the vault springs from the trunks, stays inside the nave and under the crowns, high over the floor`, () => {
    const t = terrainOf(name, params);
    for (const hall of plantingsOf(t).halls) {
      const H = hall.height;
      for (let line = 0; line <= hall.bays; line++) {
        const l = hall.columns[line * 2], r = hall.columns[line * 2 + 1];
        const crownZ = Math.max(l.ground, r.ground) + LIMB.spring * H + (LIMB.rise * hall.span) / 2;
        assert.ok(crownZ < H * 0.75 + Math.max(l.ground, r.ground), 'the vault under the crowns');
        for (const c of [l, r]) {
          const pts = halfArch([c.x, c.y, c.ground + LIMB.spring * H], [c.x, 0, crownZ], 12);
          assert.ok(Math.abs(pts[12][1]) < 1e-9 && Math.abs(pts[12][2] - crownZ) < 1e-9, 'it reaches the crown');
          for (let k = 1; k <= 12; k++) {
            assert.ok(pts[k][2] >= pts[k - 1][2] - 1e-9, 'it only rises');
            assert.ok(Math.abs(pts[k][1]) <= hall.span / 2 + 1e-9, 'inside the nave');
          }
          // It leaves the trunk upright.
          assert.ok(Math.abs(pts[1][1] - pts[0][1]) < (pts[1][2] - pts[0][2]) * 0.6);
        }
      }
      assert.ok(LIMB.arcade * H > 2.5, 'one walks under the arcade');
      const d = daisOf(hall);
      assert.ok(d.top > hallGroundAt(hall, (d.x0 + d.x1) / 2, 0), 'the dais stands up out of the floor');
    }
  });

  test(`grown halls (${name}): tiles own each hall once; whole at every detail, finer up close`, () => {
    const t = terrainOf(name, params), g = hallSites.gridOf(t), halls = plantingsOf(t).halls;
    if (!halls.length) { assert.equal(g, null); return; }
    assert.ok(g);
    const roots = rootTiles(g), owned = roots.map((k) => hallSites.thingsIn(t, k));
    assert.equal(owned.reduce((n, x) => n + x.length, 0), halls.length, 'the roots own every hall once');
    assert.equal(new Set(owned.flat()).size, halls.length);
    const hr = t.habitat.params.landmarks!.handrail;
    assert.equal(siteDetailOf(g, g.root, hr), 'far');
    assert.equal(siteDetailOf(g, g.finest, hr), 'near');
    let last = 0;
    for (const detail of ['far', 'mid', 'near'] as const) {
      const a = buildHall(halls[0], detail).mappedArrays();
      assert.ok(a.positions.every(Number.isFinite) && a.normals.every(Number.isFinite), `${detail}: finite`);
      const w = windingOk(a.positions, a.normals, a.index);
      assert.equal(w.bad, 0, `${detail}: ${w.bad} of ${w.total} faces wound against their normals`);
      assert.ok(w.total > last * 2, `${detail}: ${w.total} triangles, finer than ${last}`);
      last = w.total;
    }
    const busy = roots[owned.findIndex((x) => x.length > 0)], i = hallSites.thingsIn(t, busy)[0];
    let k: TileKey = busy;
    while (k.level > g.finest) k = childrenOf(g, k).find((c) => hallSites.thingsIn(t, c).includes(i))!;
    const tile = hallSites.buildTile(t, k), m = tile.mesh;
    assert.equal(tile.count, hallSites.thingsIn(t, k).length);
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, 'bent onto the floor, still wound right');
    const edge = Math.pow(2, k.level) * Math.max(g.edgeU, g.edgeV);
    assert.ok(m.positions.every((x) => Math.abs(x) < edge * 2 + halls[i].half * 2), 'in the tile\'s frame');
  });

  test(`grown halls (${name}): one stands on the dais; the physics meets the table and screens; a lawn floor, nothing scattered in it, a roof from afar`, () => {
    const t = terrainOf(name, params), h = t.habitat, hall = plantingsOf(t).halls[0];
    if (!hall) return;
    const d = daisOf(hall), on = floorAt(h, hall.frame, (d.x0 + d.x1) / 2, 0);
    assert.ok(Math.abs(hallSites.topAt(t, on.theta, on.s)! - (hall.frame.height + d.top)) < 0.02, 'on the dais');
    assert.equal(landmarkTopAt(t, on.theta, on.s), hallSites.topAt(t, on.theta, on.s), 'the view stands people on it');
    const nave = floorAt(h, hall.frame, 0, hall.span * 0.3);
    assert.equal(hallSites.topAt(t, nave.theta, nave.s), null, 'on the ground elsewhere in the nave');
    const table = floorAt(h, hall.frame, 0, 0);
    assert.ok(hallKeepsClear(t, table.theta, table.s) && keptClear(t, table.theta, table.s), 'nothing grows through the table');
    assert.ok(!hallKeepsClear(t, nave.theta, nave.s), 'grass in the nave');
    assert.ok(scatterKeepsOff(t, nave.theta, nave.s), 'no scattered tree or bush in the nave');
    assert.equal(plantedLawn(t, nave.theta, nave.s), 1, 'its floor a lawn');
    const roof = plantedCanopy(t, nave.theta, nave.s);
    assert.ok(roof && roof.cover > 0.99 && roof.height === hall.height, 'its crowns a roof from afar');
    const solids = hallSites.solids(t, floorPoint(h, hall.frame, [0, 0, 0]), 10);
    assert.ok(solids.length === 1 && solids[0].index.length > 0 && solids[0].positions.every(Number.isFinite));
    const plain = Math.pow(Math.round(20 / 2), 2) * 2, patch = buildPatch(t, table.theta, table.s, 20, 2);
    assert.ok(patch.index.length / 3 > plain, `${patch.index.length / 3} triangles in the patch`);
  });
}
