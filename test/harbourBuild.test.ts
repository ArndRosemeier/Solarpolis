import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { HARBOUR, berthX, fleetOf } from '../src/gen/harbours';
import { buildHarbour, harbourKeepsClear, harbourSites, harbourTop, landingOf } from '../src/gen/harbourBuild';
import { childrenOf, rootTiles, type TileKey } from '../src/gen/detailTree';
import { keptClear, landmarkTopAt } from '../src/gen/landmarks';
import { buildPatch } from '../src/gen/patch';
import { floorAt, floorPoint } from '../src/gen/shapes';
import { BOAT_KINDS } from '../src/gen/boat';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

for (const { name } of MATRIX) {
  test(`harbours built (${name}): whole at every detail, finer up close; tiles own each once; one stands on them, plants keep off`, () => {
    const t = terrainOf(name), h = t.habitat, all = fleetOf(h).harbours, g = harbourSites.gridOf(t);
    if (!all.length) return;
    assert.ok(g, 'a grid');
    const roots = rootTiles(g), owned = roots.map((k) => harbourSites.thingsIn(t, k));
    assert.equal(owned.reduce((n, x) => n + x.length, 0), all.length, 'the roots own every harbour once');
    const hb = all[0], hr = hb.handrail;
    const counts = (['far', 'mid', 'near'] as const).map((detail) => {
      const a = buildHarbour(t, hb, detail).mappedArrays();
      assert.ok(a.positions.every(Number.isFinite) && a.normals.every(Number.isFinite), `${detail}: finite`);
      const w = windingOk(a.positions, a.normals, a.index);
      assert.equal(w.bad, 0, `${detail}: ${w.bad} of ${w.total} faces wound against their normals`);
      return w.total;
    });
    assert.ok(counts[0] > 0 && counts[1] > counts[0] && counts[2] > counts[1], `${counts.join(' < ')} triangles`);
    // The finest tile holding it, bent onto the floor.
    const busy = roots[owned.findIndex((x) => x.includes(0))];
    let k: TileKey = busy;
    while (k.level > g.finest) k = childrenOf(g, k).find((c) => harbourSites.thingsIn(t, c).includes(0))!;
    const tile = harbourSites.buildTile(t, k);
    assert.equal(tile.count, harbourSites.thingsIn(t, k).length);
    assert.equal(windingOk(tile.mesh.positions, tile.mesh.normals, tile.mesh.index).bad, 0, 'bent onto the floor, still wound right');
    // One stands on its landing, its pier, its pontoon and a finger; not beside the pier, nor in a berth.
    const float = HARBOUR.float * hr, berth = hb.berths[0], boat = fleetOf(h).boats[berth.boat];
    const spots: [number, number, number | null][] = [
      [hb.pontoon / 2, 0, HARBOUR.deck * hr], [hb.pontoon + hr, (hb.y0 + hb.y1) / 2 + hr / 2, float], [hb.pontoon + HARBOUR.pontoon * hr + 0.5, hb.fingers[0].y, float],
      [hb.pontoon / 2, HARBOUR.pier * hr, null], [berthX(hb, boat.kind), berth.y, null],
    ];
    for (const [x, y, want] of spots) {
      const at = floorAt(h, hb.frame, x, y), top = harbourSites.topAt(t, at.theta, at.s);
      if (want === null) { assert.equal(top, null, `nothing to stand on at (${x.toFixed(1)}, ${y.toFixed(1)})`); continue; }
      assert.ok(top !== null && Math.abs(top - (hb.frame.height + want)) < 1e-6, `on it at (${x.toFixed(1)}, ${y.toFixed(1)})`);
      assert.equal(landmarkTopAt(t, at.theta, at.s), top, 'the view stands people on it');
    }
    // The landing meets the ground; the pier comes down to the pontoon.
    const land = floorAt(h, hb.frame, landingOf(hb), 0), ground = t.heightAt(land.theta, land.s) - hb.frame.height;
    assert.ok(harbourTop(t, hb, landingOf(hb), 0)! >= ground - 1e-9 && harbourTop(t, hb, landingOf(hb), 0)! - Math.max(ground, HARBOUR.deck * hr) < 1e-9, 'on the ground at the landing');
    assert.ok(Math.abs(harbourTop(t, hb, hb.pontoon, 0)! - float) < 1e-9, 'down to the pontoon');
    // No plants on it, nor in its berths.
    const home = floorAt(h, hb.frame, berthX(hb, boat.kind), berth.y), pier = floorAt(h, hb.frame, -hr, 0);
    for (const p of [home, pier]) assert.ok(harbourKeepsClear(t, p.theta, p.s) && keptClear(t, p.theta, p.s), 'no plants');
    const away = floorAt(h, hb.frame, -10 * hr - BOAT_KINDS.skiff.length, 0);
    assert.ok(!harbourKeepsClear(t, away.theta, away.s), 'plants inland');
    // Its decks reach the physics.
    const solids = harbourSites.solids(t, floorPoint(h, hb.frame, [hb.pontoon, 0, 0]), 10);
    assert.ok(solids.length >= 1 && solids.every((a) => a.index.length > 0 && a.positions.every(Number.isFinite)), 'solid');
    const at = floorAt(h, hb.frame, hb.pontoon / 2, 0), plain = Math.pow(Math.round(20 / 2), 2) * 2, patch = buildPatch(t, at.theta, at.s, 20, 2);
    assert.ok(patch.index.length / 3 > plain, `${patch.index.length / 3} triangles in the patch`);
  });
}
