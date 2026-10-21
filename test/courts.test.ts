import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, type HabitatParams } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { buildCourt, buildCourtTile, courtDetailOf, courtGridOf, courtLayoutOf, courtTopAt, courtWorld, courtsIn, rimAt, type CourtLayout } from '../src/gen/courts';
import { childrenOf, rootTiles, type TileKey } from '../src/gen/detailTree';
import { keptClear, landmarkTopAt } from '../src/gen/landmarks';
import { buildPatch } from '../src/gen/patch';
import { riserAt } from '../src/gen/liftStair';
import { windingOk } from './meshChecks';

const terrains = new Map<string, Terrain>();
const terrainOf = (name: string, params: HabitatParams): Terrain => {
  let t = terrains.get(name);
  if (!t) { t = makeTerrain(derive(params)); terrains.set(name, t); }
  return t;
};

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
    if (!params.landmarks) { assert.equal(courtGridOf(t), null); return; }
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
    const t = terrainOf(name, params), g = courtGridOf(t);
    if (!g) return;
    const roots = rootTiles(g), owned = roots.map((k) => courtsIn(t, k));
    assert.equal(owned.reduce((n, x) => n + x.length, 0), t.courts.length, 'the roots own every court once');
    assert.equal(new Set(owned.flat()).size, t.courts.length);
    const busy = roots[owned.findIndex((x) => x.length > 0)];
    assert.equal(childrenOf(g, busy).reduce((n, k) => n + courtsIn(t, k).length, 0), courtsIn(t, busy).length, 'children own what their root does');
    assert.equal(courtDetailOf(g, g.root, t.habitat.params.landmarks!.handrail), 'far');
    assert.equal(courtDetailOf(g, g.finest, t.habitat.params.landmarks!.handrail), 'near');
    const l = courtLayoutOf(t, courtsIn(t, busy)[0])!;
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
    while (k.level > g.finest) k = childrenOf(g, k).find((c) => courtsIn(t, c).includes(t.courts.indexOf(l.court)))!;
    const tile = buildCourtTile(t, k), m = tile.mesh;
    assert.equal(tile.courts, courtsIn(t, k).length);
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, 'bent onto the floor, still wound right');
    const edge = Math.pow(2, k.level) * Math.max(g.edgeU, g.edgeV);
    assert.ok(m.positions.every((x) => Math.abs(x) < edge * 2 + l.outer), 'in the tile\'s frame');
  });

  test(`courts (${name}): one stands on the paving, the walk and the landing; the physics meets the walls; plants keep off`, () => {
    const t = terrainOf(name, params), h = t.habitat;
    if (!courtGridOf(t)) return;
    const l = courtLayoutOf(t, 0)!, c = l.court;
    const at = (r: number, a: number, z = 0) => fromWorld(h.profile, ...courtWorld(h, c, [Math.cos(a) * r, Math.sin(a) * r, z]));
    const mid = at((l.well + l.kerb + l.face) / 2, l.portal.angle), well = at(0, 0), walk = at((l.face + l.outer) / 2, l.portal.angle), land = at((l.inner + l.face) / 2, (l.landing.a0 + l.landing.a1) / 2);
    const near = (x: number | null, y: number): boolean => x !== null && Math.abs(x - y) < l.handrail * 0.02;
    assert.ok(near(courtTopAt(t, mid.theta, mid.s), c.floor + l.pave), 'on the paving');
    const glass = courtTopAt(t, well.theta, well.s);
    assert.ok(glass !== null && glass > c.floor && glass < c.floor + l.pave, 'on the light well\'s glass, over the dug floor');
    assert.ok(near(courtTopAt(t, walk.theta, walk.s), c.floor + rimAt(l, l.portal.angle) + l.coping), 'on the walk');
    assert.ok(near(courtTopAt(t, land.theta, land.s), c.floor + l.landing.top), 'on the landing');
    assert.equal(landmarkTopAt(t, mid.theta, mid.s), courtTopAt(t, mid.theta, mid.s), 'the view stands people on it');
    assert.ok(keptClear(t, mid.theta, mid.s) && keptClear(t, walk.theta, walk.s), 'no plants in it or on its walk');
    const outside = at(c.radius * 3, 0);
    if (!t.courtAt(outside.theta, outside.s)) assert.equal(courtTopAt(t, outside.theta, outside.s), null);
    // A patch at the portal holds the court's walls and doors besides its ground.
    const plain = Math.pow(Math.round(20 / 2), 2) * 2, p = at(l.face, l.portal.angle), patch = buildPatch(t, p.theta, p.s, 20, 2);
    assert.ok(patch.index.length / 3 > plain + 50, `${patch.index.length / 3} triangles in the patch`);
  });
}
