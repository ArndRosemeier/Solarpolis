import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive } from '../src/blueprint';
import { angleDiff } from '@futuremagic/core';
import { BOAT_KINDS, BOAT_KIND_LIST } from '../src/gen/boat';
import { HARBOUR, berthX, depthAt, fleetOf, inBasin, inBasinFrame, offShore, seaRoom, type Harbour } from '../src/gen/harbours';
import { planOf } from '../src/gen/plan';
import { floorAt } from '../src/gen/shapes';
import { habitatOf } from './worlds';

for (const { name } of MATRIX) {
  test(`harbours (${name}): every boat berthed in water deep enough, stern to a pontoon, its way out clear into its sailing water`, () => {
    const h = habitatOf(name), fleet = fleetOf(h), plan = planOf(h), R = h.radius;
    const at = (hb: Harbour, x: number, y: number) => { const p = floorAt(h, hb.frame, x, y); return inBasinFrame(fleet.basins[hb.basin], p.theta, p.s); };
    // The reference has harbours round the ring lake and on the great lake; most boats lie at a berth.
    if (name === 'reference') {
      for (const kind of ['ring', 'great'] as const) assert.ok(fleet.harbours.some((x) => fleet.basins[x.basin].kind === kind), `a harbour on the ${kind} lake`);
    }
    assert.ok(fleet.boats.filter((b) => b.harbour >= 0).length >= fleet.boats.length * 0.5, 'most at a berth');
    for (const hb of fleet.harbours) {
      const b = fleet.basins[hb.basin], hr = hb.handrail;
      assert.ok(hb.berths.length >= 1 && hb.berths.length <= HARBOUR.most, 'berths');
      // Its pier leaves the shore; its pontoon floats.
      const root = inBasinFrame(b, hb.frame.theta, hb.frame.s);
      assert.ok(Math.abs(offShore(b, root.u, root.v)) < 0.5, `on the shore (${offShore(b, root.u, root.v).toFixed(2)} m)`);
      for (const y of [hb.y0, hb.y1]) {
        const p = at(hb, hb.pontoon, y);
        assert.ok(offShore(b, p.u, p.v) > 0, 'the pontoon in the water');
      }
      // Berths along the pontoon one after another, within it, no two over each other.
      const ys = hb.berths.map((x) => x.y);
      ys.forEach((y, i) => { if (i) assert.ok(y - ys[i - 1] >= (hb.berths[i].width + hb.berths[i - 1].width) / 2 - 1e-9, 'apart'); });
      assert.ok(hb.y0 <= ys[0] - hb.berths[0].width / 2 && ys[ys.length - 1] + hb.berths[ys.length - 1].width / 2 <= hb.y1 + 1e-9, 'on the pontoon');
      assert.equal(hb.fingers.length, hb.berths.length + 1, 'a finger each side of each berth');
      // Clear of the courts, landmarks and halls.
      const mid = floorAt(h, hb.frame, hb.reach / 2, 0);
      for (const site of plan.sites) assert.ok(Math.hypot(angleDiff(0, site.theta - mid.theta) * R, site.s - mid.s) > site.size, `clear of the ${site.kind}`);
      // Clear of every other harbour.
      for (const other of fleet.harbours) {
        if (other === hb || other.basin !== hb.basin) continue;
        const o = floorAt(h, other.frame, other.reach / 2, 0);
        assert.ok(Math.hypot(angleDiff(0, o.theta - mid.theta) * R, o.s - mid.s) > (hb.y1 - hb.y0 + other.y1 - other.y0) / 2, 'harbours apart');
      }
      for (const berth of hb.berths) {
        const boat = fleet.boats[berth.boat], spec = BOAT_KINDS[boat.kind], x = berthX(hb, boat.kind);
        assert.equal(boat.harbour, hb.id);
        assert.ok(berth.width >= spec.beam + 2 * HARBOUR.beside * hr, 'room beside it');
        // Lying there, bow out: in water, deep enough under all of it.
        const home = at(hb, x, berth.y);
        assert.ok(Math.hypot(home.u - boat.home.u, home.v - boat.home.v) < 1e-6 && boat.berthHeading === hb.frame.heading, 'its berth');
        for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const p = at(hb, x + (dx * spec.length) / 2, berth.y + (dy * spec.beam) / 2);
          assert.ok(depthAt(b, p.u, p.v) >= spec.draft, `${boat.kind}: ${depthAt(b, p.u, p.v).toFixed(2)} m of water`);
        }
        // Its way out, straight on from its bow, runs in the water to its sailing water.
        assert.ok(inBasin(b, boat.out.u, boat.out.v, seaRoom(b, boat.kind)), 'out in its sailing water');
        for (let k = 0; k <= 20; k++) {
          const u = boat.home.u + ((boat.out.u - boat.home.u) * k) / 20, v = boat.home.v + ((boat.out.v - boat.home.v) * k) / 20;
          assert.ok(offShore(b, u, v) > spec.beam / 2, 'its way out in the water');
        }
        // Boats under sail keep clear of it: no part of it lies in any design's sailing water.
        for (const kind of BOAT_KIND_LIST) {
          for (const dx of [-1, 1]) {
            const p = at(hb, x + (dx * spec.length) / 2, berth.y);
            assert.ok(!inBasin(b, p.u, p.v, seaRoom(b, kind)), `a ${kind} under sail keeps clear of a ${boat.kind} at its berth`);
          }
        }
      }
    }
  });
}

test('harbours: the same every time', () => {
  const params = MATRIX.find((m) => m.name === 'small')!.params;
  const a = fleetOf(habitatOf('small')), b = fleetOf(derive(params));
  assert.deepEqual(b.harbours, a.harbours);
  assert.deepEqual(b.boats, a.boats);
  for (const kind of BOAT_KIND_LIST) assert.ok(BOAT_KINDS[kind].motor > 0 && BOAT_KINDS[kind].draft > 0);
});
