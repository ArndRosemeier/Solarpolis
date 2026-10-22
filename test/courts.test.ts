import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld } from '../src/blueprint';
import type { Terrain } from '../src/gen/terrain';
import { buildCourt, courtLayoutOf, courtPassageOf, courtSites, courtWorld, rimAt, type CourtLayout } from '../src/gen/courts';
import { floorAt } from '../src/gen/shapes';
import { floorGap, peopleAt, venuesOf } from '../src/sim';
import { childrenOf, rootTiles, type TileKey } from '../src/gen/detailTree';
import { keptClear, landmarkTopAt } from '../src/gen/landmarks';
import { buildPatch } from '../src/gen/patch';
import { riserAt } from '../src/gen/liftStair';
import { siteDetailOf } from '../src/gen/siteTiles';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';


/** Up to `n` of a terrain's courts, spread over all of them. */
const someOf = (t: Terrain, n: number): CourtLayout[] => {
  const step = Math.max(1, Math.floor(t.courts.length / n)), out: CourtLayout[] = [];
  for (let i = 0; i < t.courts.length; i += step) { const l = courtLayoutOf(t, i); assert.ok(l, `court ${i} laid out`); out.push(l); }
  return out;
};

/** The angle a sits at from lo, going up (0 … 2π). */
const from = (a: number, lo: number): number => ((((a - lo) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));

for (const { name, params } of MATRIX) {
  test(`courts (${name}): a landing at the rim's lowest point, stairs down to the paving at even risers, the portal clear of them, the walk over the ground`, () => {
    const t = terrainOf(name, params), h = t.habitat;
    if (!params.landmarks) { assert.equal(courtSites.gridOf(t), null); return; }
    assert.ok(t.courts.length > 0, 'the plan has entrances');
    for (const l of someOf(t, 12)) {
      const hr = l.handrail, c = l.court, min = Math.min(...l.rim);
      assert.ok(Math.abs(l.landing.top - (min + l.coping)) < 1e-9, 'the landing is flush with the walk where the rim is lowest');
      assert.ok(l.stairs.length >= 1 && l.stairs.length <= 2);
      const g = (h.profile.at(c.s).r - c.floor) / h.profile.at(c.s).r;
      for (const st of l.stairs) {
        const tops = [l.landing.top, ...st.steps.map((s) => s.top), l.pave], risers = tops.slice(1).map((x, i) => tops[i] - x);
        for (const r of risers) assert.ok(Math.abs(r - risers[0]) < 1e-9 && r > 0 && r <= riserAt(hr, g) * 1.5, `even risers (${r.toFixed(3)} m)`);
        for (const s of st.steps) assert.ok(Math.sign(s.a1 - s.a0) === st.dir, 'steps run their stair\'s way');
      }
      // The stairs and the portal share the round without meeting.
      const span = l.used[1] - l.used[0], p = from(l.portal.angle, l.used[0]);
      assert.ok(span > 0 && span < 2 * Math.PI, `the stairs take ${span.toFixed(2)} rad`);
      assert.ok(p > span, 'the portal stands clear of the stairs');
      assert.ok(l.portal.high >= 2 * hr, 'a door one walks through');
      assert.ok(l.portal.high + 0.55 * hr <= rimAt(l, l.portal.angle) + l.coping, 'the lintel stays under the walk');
      // The walk lies on the ground all round: never under it, at the rim or at its outer edge.
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * 2 * Math.PI, top = rimAt(l, a) + l.coping;
        for (const r of [c.radius, l.outer]) {
          const ground = t.heightAt(c.theta + (r * Math.sin(a)) / h.profile.at(c.s).r, c.s + r * Math.cos(a)) - c.floor;
          assert.ok(top >= ground, `walk ${top.toFixed(2)} over ground ${ground.toFixed(2)} at ${a.toFixed(2)}`);
        }
      }
    }
  });

  test(`courts (${name}): tiles own each court once, and a court is whole at every detail, finer up close`, () => {
    const t = terrainOf(name, params), g = courtSites.gridOf(t);
    if (!g) return;
    const roots = rootTiles(g), owned = roots.map((k) => courtSites.thingsIn(t, k));
    assert.equal(owned.reduce((n, x) => n + x.length, 0), t.courts.length, 'the roots own every court once');
    assert.equal(new Set(owned.flat()).size, t.courts.length);
    const busy = roots[owned.findIndex((x) => x.length > 0)];
    assert.equal(childrenOf(g, busy).reduce((n, k) => n + courtSites.thingsIn(t, k).length, 0), courtSites.thingsIn(t, busy).length, 'children own what their root does');
    assert.equal(siteDetailOf(g, g.root, t.habitat.params.landmarks!.handrail), 'far');
    assert.equal(siteDetailOf(g, g.finest, t.habitat.params.landmarks!.handrail), 'near');
    const l = courtLayoutOf(t, courtSites.thingsIn(t, busy)[0])!;
    let last = 0;
    for (const detail of ['far', 'mid', 'near'] as const) {
      const a = buildCourt(l, detail).mappedArrays();
      assert.ok(a.positions.every(Number.isFinite) && a.normals.every(Number.isFinite), `${detail}: finite`);
      const w = windingOk(a.positions, a.normals, a.index);
      assert.equal(w.bad, 0, `${detail}: ${w.bad} of ${w.total} faces wound against their normals`);
      assert.ok(w.total > last * 1.5, `${detail}: ${w.total} triangles, finer than ${last}`);
      last = w.total;
    }
    // The finest tile holding that court, bent onto the floor: still wound to its normals, and near its origin.
    let k: TileKey = busy;
    while (k.level > g.finest) k = childrenOf(g, k).find((c) => courtSites.thingsIn(t, c).includes(t.courts.indexOf(l.court)))!;
    const tile = courtSites.buildTile(t, k), m = tile.mesh;
    assert.equal(tile.count, courtSites.thingsIn(t, k).length);
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, 'bent onto the floor, still wound right');
    const edge = Math.pow(2, k.level) * Math.max(g.edgeU, g.edgeV);
    assert.ok(m.positions.every((x) => Math.abs(x) < edge * 2 + l.outer), 'in the tile\'s frame');
  });

  test(`courts (${name}): one stands on the paving, the walk and the landing; the physics meets the walls; plants keep off`, () => {
    const t = terrainOf(name, params), h = t.habitat;
    if (!courtSites.gridOf(t)) return;
    const l = courtLayoutOf(t, 0)!, c = l.court;
    const at = (r: number, a: number, z = 0) => fromWorld(h.profile, ...courtWorld(h, c, [Math.cos(a) * r, Math.sin(a) * r, z]));
    const mid = at((l.well + l.kerb + l.face) / 2, l.portal.angle), well = at(0, 0), walk = at((l.face + l.outer) / 2, l.portal.angle), land = at((l.inner + l.face) / 2, (l.landing.a0 + l.landing.a1) / 2);
    const near = (x: number | null, y: number): boolean => x !== null && Math.abs(x - y) < l.handrail * 0.02;
    assert.ok(near(courtSites.topAt(t, mid.theta, mid.s), c.floor + l.pave), 'on the paving');
    const glass = courtSites.topAt(t, well.theta, well.s);
    assert.ok(glass !== null && glass > c.floor && glass < c.floor + l.pave, 'on the light well\'s glass, over the dug floor');
    assert.ok(near(courtSites.topAt(t, walk.theta, walk.s), c.floor + rimAt(l, l.portal.angle) + l.coping), 'on the walk');
    assert.ok(near(courtSites.topAt(t, land.theta, land.s), c.floor + l.landing.top), 'on the landing');
    assert.equal(landmarkTopAt(t, mid.theta, mid.s), courtSites.topAt(t, mid.theta, mid.s), 'the view stands people on it');
    assert.ok(keptClear(t, mid.theta, mid.s) && keptClear(t, walk.theta, walk.s), 'no plants in it or on its walk');
    const outside = at(c.radius * 3, 0);
    if (!t.courtAt(outside.theta, outside.s)) assert.equal(courtSites.topAt(t, outside.theta, outside.s), null);
    // A patch at the portal holds the court's walls and doors besides its ground.
    const plain = Math.pow(Math.round(20 / 2), 2) * 2, p = at(l.face, l.portal.angle), patch = buildPatch(t, p.theta, p.s, 20, 2);
    assert.ok(patch.index.length / 3 > plain + 50, `${patch.index.length / 3} triangles in the patch`);
  });
}

for (const { name, params } of MATRIX) {
  test(`courts (${name}): people come up out of the lift, climb a stair and leave over the walk, never over the well`, () => {
    const t = terrainOf(name, params), h = t.habitat, R = h.radius, v = venuesOf(h);
    if (!params.landmarks) { assert.equal(courtPassageOf(t, 0), null); return; }
    assert.deepEqual(t.courts.map((c) => [c.theta, c.s]), v.courts.map((c) => [c.theta, c.s]), 'the terrain digs the venues\' courts, in their order');
    const step = Math.max(1, Math.floor(t.courts.length / 12));
    for (let i = 0; i < t.courts.length; i += step) {
      const l = courtLayoutOf(t, i)!, c = l.court, pass = courtPassageOf(t, i)!, n = pass.length / 2;
      const gap = (k: number): number => floorGap(R, c.theta, c.s, pass[k * 2], pass[k * 2 + 1]);
      // Out of the portal's doors; out past the walk; never on the seat round the well.
      const door = floorAt(h, { theta: c.theta, s: c.s, height: c.floor, heading: 0 }, l.face * Math.cos(l.portal.angle), l.face * Math.sin(l.portal.angle));
      assert.ok(floorGap(R, door.theta, door.s, pass[0], pass[1]) < 2 * l.handrail, 'the way starts at the portal');
      assert.ok(gap(n - 1) > l.outer, 'the way ends past the walk');
      for (let k = 0; k < n; k++) assert.ok(gap(k) > l.well + l.kerb && gap(k) <= l.outer + l.handrail + 1e-6, 'the way keeps off the well and in the court');
      // It climbs to the landing: the highest top along it is the landing's.
      let top = -Infinity;
      for (let k = 0; k < n - 1; k++) top = Math.max(top, (landmarkTopAt(t, pass[k * 2], pass[k * 2 + 1]) ?? -Infinity) - c.floor);
      assert.ok(Math.abs(top - l.landing.top) < 0.05 * l.handrail, `up to the landing (${top.toFixed(2)} of ${l.landing.top.toFixed(2)} m)`);
    }
    // Nobody up on the land walks over a court's well: walkers in a court are on its way through (round a few courts).
    const day = params.day.length;
    for (let i = 0; i < t.courts.length; i += step * 4) {
      const c = v.courts[i], well = courtLayoutOf(t, i)!.well;
      for (const p of peopleAt(h, 3 * day + 7 * 3600, { theta: c.theta, s: c.s, radius: c.size }, t)) {
        if (p.moving) assert.ok(floorGap(R, c.theta, c.s, p.theta, p.s) > well, 'someone walks over a light well');
      }
    }
  });
}
