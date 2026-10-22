import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import {
  PART, STYLE_CROSSING, buildCrossing, crossingKeepsClear, crossingSites, crossingTop, crossingsOf,
  deckTop, groundAt, logTopAt, soffitAt, type Crossing,
} from '../src/gen/crossings';
import { childrenOf, rootTiles, type TileKey } from '../src/gen/detailTree';
import { keptClear, landmarkTopAt } from '../src/gen/landmarks';
import { buildPatch } from '../src/gen/patch';
import { floorAt, floorPoint } from '../src/gen/shapes';
import { siteDetailOf } from '../src/gen/siteTiles';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

/** Points across a crossing's water. */
const overWater = (c: Crossing, n = 24): number[] => Array.from({ length: n + 1 }, (_, i) => c.wet[0] + ((c.wet[1] - c.wet[0]) * i) / n);

for (const { name, params } of MATRIX) {
  test(`crossings (${name}): where a way fords a river, built the way its district builds, from dry bank to dry bank`, () => {
    const t = terrainOf(name, params), h = t.habitat, all = crossingsOf(t);
    if (!params.landmarks || !t.rivers.length) { assert.equal(all.length, 0); assert.equal(crossingSites.gridOf(t), null); return; }
    assert.ok(all.length > 0, 'the ways cross the rivers somewhere');
    for (const c of all) {
      const hr = c.handrail;
      const want = c.style ? STYLE_CROSSING[c.style] : 'timber';
      assert.ok(c.kind === want || (want === 'log' && c.kind === 'stepping' && c.wet[1] - c.wet[0] > PART.logMax * hr), `${c.style}: ${c.kind}`);
      // Over the water at its middle, on dry ground at both ends.
      const mid = floorAt(h, c.frame, 0, 0);
      assert.ok(t.riverAt(mid.theta, mid.s), 'over the river');
      for (const x of [-c.half, c.half]) {
        const p = floorAt(h, c.frame, x, 0);
        assert.equal(t.riverAt(p.theta, p.s), null, `its ${x < 0 ? 'near' : 'far'} end on dry ground`);
      }
      assert.ok(c.ends.every((e, i) => e >= (i ? c.ground[c.ground.length - 1] : c.ground[0]) && e > 0), 'it meets the banks, above the water');
    }
  });

  test(`crossings (${name}): arches and beams clear the water, the deck sits on its banks, stones stand out of the stream`, () => {
    const t = terrainOf(name, params);
    for (const c of crossingsOf(t)) {
      const hr = c.handrail, eps = 1e-6;
      if (c.kind === 'arch') {
        const over = (PART.ring + PART.fill) * hr;
        assert.ok(c.arches.length >= 1);
        for (const a of c.arches) {
          const m = (a.x0 + a.x1) / 2;
          assert.ok(a.x1 - a.x0 <= PART.arch * hr + eps, `an opening of ${(a.x1 - a.x0).toFixed(2)} m`);
          assert.ok(a.rise >= Math.min((a.x1 - a.x0) / 2, PART.archClear * hr) - eps, `a crown ${a.rise.toFixed(2)} m over the water`);
          assert.ok(Math.abs(soffitAt(a, m)! - a.rise) < eps && Math.abs(soffitAt(a, a.x0)!) < eps && Math.abs(soffitAt(a, a.x1)!) < eps, 'a segment through both springings');
          for (let k = 0; k <= 8; k++) {
            const x = a.x0 + ((a.x1 - a.x0) * k) / 8;
            assert.ok(deckTop(c, x) - soffitAt(a, x)! >= over - eps, 'the ring and its fill under the deck');
          }
        }
        // The arches cover the water.
        assert.ok(c.arches[0].x0 <= c.wet[0] && c.arches[c.arches.length - 1].x1 >= c.wet[1]);
      }
      if (c.kind === 'timber') {
        const depth = (PART.plank + PART.stringer) * hr, mid = (c.wet[0] + c.wet[1]) / 2;
        for (const x of overWater(c)) assert.ok(deckTop(c, x) - depth >= PART.timberClear * hr * 0.25 - eps, `beams over the water at ${x.toFixed(1)}`);
        assert.ok(deckTop(c, mid) - depth >= PART.timberClear * hr - eps, 'full clearance mid-stream');
        assert.ok(c.bents.length >= 2 && Math.abs(c.bents[0] - c.wet[0]) < eps && Math.abs(c.bents[c.bents.length - 1] - c.wet[1]) < eps, 'a bent at each bank');
        for (let i = 1; i < c.bents.length; i++) assert.ok(c.bents[i] - c.bents[i - 1] <= PART.bay * hr + eps, 'bays no wider than a bay');
      }
      if (c.kind === 'arch' || c.kind === 'timber') {
        // Its hump stays a walkable slope, and the deck never dives into the banks.
        for (let i = 0; i <= 32; i++) {
          const x = -c.half + (2 * c.half * i) / 32;
          assert.ok(groundAt(c, x) - deckTop(c, x) < 0.35 * hr, `the deck over the ground at ${x.toFixed(1)}`);
        }
        assert.ok(c.hump <= c.half * 0.5, `a hump of ${c.hump.toFixed(2)} m over ${(2 * c.half).toFixed(1)} m`);
      }
      if (c.kind === 'stepping') {
        assert.ok(c.stones.length >= 1);
        for (const st of c.stones) assert.ok(st.top > 0.1 * hr && st.top > groundAt(c, st.x), 'out of the water');
        const xs = [c.wet[0], ...c.stones.map((s) => s.x), c.wet[1]];
        for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] <= PART.stride * hr * 1.5, 'a stride apart');
      }
      if (c.kind === 'log') {
        assert.ok(c.wet[1] - c.wet[0] <= PART.logMax * hr);
        for (const x of overWater(c)) assert.ok(logTopAt(c, x) - 2 * PART.log * hr > 0, 'the log above the water');
      }
    }
  });

  test(`crossings (${name}): tiles own each crossing once; each is whole at every detail, finer up close`, () => {
    const t = terrainOf(name, params), g = crossingSites.gridOf(t), all = crossingsOf(t);
    if (!g) return;
    const roots = rootTiles(g), owned = roots.map((k) => crossingSites.thingsIn(t, k));
    assert.equal(owned.reduce((n, x) => n + x.length, 0), all.length, 'the roots own every crossing once');
    assert.equal(new Set(owned.flat()).size, all.length);
    const hr = t.habitat.params.landmarks!.handrail;
    assert.equal(siteDetailOf(g, g.root, hr), 'far');
    assert.equal(siteDetailOf(g, g.finest, hr), 'near');
    // One of each kind there is, at every detail.
    for (const c of new Map(all.map((c) => [c.kind, c])).values()) {
      const counts = (['far', 'mid', 'near'] as const).map((detail) => {
        const a = buildCrossing(c, detail).mappedArrays();
        assert.ok(a.positions.every(Number.isFinite) && a.normals.every(Number.isFinite), `${c.kind} ${detail}: finite`);
        const w = windingOk(a.positions, a.normals, a.index);
        assert.equal(w.bad, 0, `${c.kind} ${detail}: ${w.bad} of ${w.total} faces wound against their normals`);
        return w.total;
      });
      assert.ok(counts[0] > 0 && counts[1] >= counts[0] && counts[2] > counts[1], `${c.kind}: ${counts.join(' < ')} triangles`);
    }
    // The finest tile holding a crossing, bent onto the floor: still wound to its normals, near its origin.
    const busy = roots[owned.findIndex((x) => x.length > 0)], i = crossingSites.thingsIn(t, busy)[0];
    let k: TileKey = busy;
    while (k.level > g.finest) k = childrenOf(g, k).find((c) => crossingSites.thingsIn(t, c).includes(i))!;
    const tile = crossingSites.buildTile(t, k), m = tile.mesh;
    assert.equal(tile.count, crossingSites.thingsIn(t, k).length);
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, 'bent onto the floor, still wound right');
    const edge = Math.pow(2, k.level) * Math.max(g.edgeU, g.edgeV);
    assert.ok(m.positions.every((x) => Math.abs(x) < edge * 2 + all[i].half * 2), 'in the tile\'s frame');
  });

  test(`crossings (${name}): one stands on them, the physics meets them, plants keep off`, () => {
    const t = terrainOf(name, params), h = t.habitat;
    for (const c of new Map(crossingsOf(t).map((c) => [c.kind, c])).values()) {
      const [x, y] = c.kind === 'stepping' ? [c.stones[0].x, c.stones[0].y] : [0, 0], at = floorAt(h, c.frame, x, y), top = crossingTop(c, x, y);
      assert.ok(top !== null, `${c.kind}: something to stand on`);
      const want = c.frame.height + top;
      assert.ok(Math.abs(crossingSites.topAt(t, at.theta, at.s)! - want) < c.handrail * 0.01, `${c.kind}: on it`);
      assert.equal(landmarkTopAt(t, at.theta, at.s), crossingSites.topAt(t, at.theta, at.s), `${c.kind}: the view stands people on it`);
      assert.ok(crossingKeepsClear(t, at.theta, at.s) && keptClear(t, at.theta, at.s), `${c.kind}: no plants on it`);
      if (c.kind === 'arch' || c.kind === 'timber') {
        const off = floorAt(h, c.frame, 0, c.width / 2 + 3 * c.handrail);
        assert.equal(crossingSites.topAt(t, off.theta, off.s), null, 'nothing beside it');
      }
      // Its solid parts reach the physics: in the world near it, and in a patch around it.
      const solids = crossingSites.solids(t, floorPoint(h, c.frame, [0, 0, 0]), 10);
      assert.ok(solids.length >= 1 && solids.every((a) => a.index.length > 0 && a.positions.every(Number.isFinite)), `${c.kind}: solid`);
      const plain = Math.pow(Math.round(20 / 2), 2) * 2, patch = buildPatch(t, at.theta, at.s, 20, 2);
      assert.ok(patch.index.length / 3 > plain, `${c.kind}: ${patch.index.length / 3} triangles in the patch`);
    }
  });
}
