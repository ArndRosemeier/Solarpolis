import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, toWorld } from '../src/blueprint';
import { terrainOf } from './worlds';
import { underOf } from '../src/gen/under';
import { underFloorAt, underPlinth } from '../src/gen/underMesh';
import { nearestExitCourt } from '../src/gen/exitCourt';
import { neighbourAt, neighboursAt, neighbourhoodBytes, shedNeighbourhoods } from '../src/sim/neighbourhood';
import { footingOf, personKey, residentOf } from '../src/sim';
import { stayingBelow } from '../src/sim/population';
import { WALK } from '../src/gen/homes';

for (const { name } of MATRIX) {
  test(`neighbourhood (${name}): stable residents walk dry frontages, on the living floor, with reproducible routines`, () => {
    const t = terrainOf(name), h = t.habitat, u = underOf(h), m = u.hamlets[0];
    const clock = h.params.day.length * h.params.day.daylight * 0.25, near = { ...m.site, radius: u.bay * 4 };
    const found = neighboursAt(t, clock, near), ids = new Set(found.map((p) => p.resident));
    assert.ok(found.length > 0);
    assert.equal(ids.size, found.length);
    assert.deepEqual(neighboursAt(t, clock, near), found);
    assert.ok(found.some((p) => p.moving));
    const roster = new Set(stayingBelow(h, 0, m.court));
    for (const p of found.filter((p) => p.court === m.court).slice(0, 30)) {
      assert.ok(roster.has(p.resident));
      assert.equal(residentOf(h, p.resident).home, m.court);
      assert.equal(personKey(p), personKey(neighbourAt(t, clock, p)!));
      const foot = footingOf(t, p, null, 1.7);
      if (residentOf(h, p.resident).body !== 'drone') assert.equal(foot.h, underFloorAt(t, p.theta, p.s));
      assert.equal(foot.swim, false);
      const bay = u.bayAt(p.theta, p.s)!, centre = u.centreOf(bay.i, bay.j);
      assert.notEqual(u.useAt(bay.i, bay.j), 'cistern');
      const x = p.s - centre.s + u.bay / 2, y = Math.atan2(Math.sin(p.theta - centre.theta), Math.cos(p.theta - centre.theta)) * h.radius + u.dTheta * h.radius / 2;
      const gap = underPlinth(h) + WALK * h.params.landmarks!.handrail;
      assert.ok(Math.min(x, u.bay - x, y, u.dTheta * h.radius - y) < gap, 'outside the buildings');
      assert.ok(Math.hypot(Math.min(x, u.bay - x), Math.min(y, u.dTheta * h.radius - y)) > underPlinth(h), 'clear of pillars');
      const next = neighbourAt(t, clock + 0.1, p);
      if (p.moving && next?.moving) {
        const a = toWorld(h.profile, { ...p, h: foot.h }), b = toWorld(h.profile, { ...next, h: footingOf(t, next, null, 1.7).h });
        assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) < p.speed * 0.13, 'continuous movement');
      }
    }
    assert.ok(neighbourhoodBytes(t) < 8 * 1024 * 1024);
    shedNeighbourhoods(t);
    assert.equal(neighbourhoodBytes(t), 0);
    if (name === 'small') assert.deepEqual(neighboursAt(t, clock, near), found, 'eviction changes no identities or places');
  });

  test(`exit court (${name}): usable lift, wrapped direction and distance, not a decorative well`, () => {
    const t = terrainOf(name), m = underOf(t.habitat).hamlets[0];
    const a = nearestExitCourt(t, m.site.theta, m.site.s)!;
    const b = nearestExitCourt(t, m.site.theta + 2 * Math.PI, m.site.s)!;
    assert.ok(a.doors.below);
    assert.equal(a.court, b.court);
    assert.ok(Math.abs(a.distance - b.distance) < 1e-6);
    assert.ok(a.distance < 2 * t.habitat.params.under.bay);
    assert.ok(nearestExitCourt(t, a.theta, a.s)!.distance < 1e-6);
  });
}
