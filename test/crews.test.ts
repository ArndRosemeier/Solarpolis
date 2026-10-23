import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { crewOf, crewRoute, crewsAt, crewsOf, crewWindow, crewMemberAt, SETTLE } from '../src/sim/crews';
import { fleetOf } from '../src/gen/harbours';
import { BOAT_KINDS, BOAT_KIND_LIST, seatsOf } from '../src/gen/boat';
import { harbourSites } from '../src/gen/harbourBuild';
import { boatAt, outingOf } from '../src/sim/sailing';
import { peopleAt, personKey, partyMembers, residentOf, stayingBelow, whereIs } from '../src/sim/population';
import { pointAlong, floorGap } from '../src/sim/walks';
import { footingOf } from '../src/sim/footing';
import { MEAN_HEIGHT } from '../src/gen/standIn';
import { terrainOf } from './worlds';

test('crews: every design has a place aboard for each of its largest crew, sailing and at rest', () => {
  for (const kind of BOAT_KIND_LIST) {
    const seats = seatsOf(kind), spec = BOAT_KINDS[kind];
    for (const list of [seats.still, seats.sailing]) {
      assert.ok(list.length >= spec.crew[1], `${kind}: ${list.length} places for ${spec.crew[1]}`);
      for (const seat of list) assert.ok(Math.abs(seat.x) < spec.beam / 2 && Math.abs(seat.z) < spec.length / 2 && seat.y > 0, `${kind}: aboard`);
    }
  }
});

for (const { name, params } of MATRIX) {
  test(`crews (${name}): every boat has its own residents, who walk to their berth, sail aboard it and walk home`, () => {
    const t = terrainOf(name), h = t.habitat, c = crewsOf(h), fleet = fleetOf(h), L = params.day.length, R = h.radius;
    // The last residents, one crew per boat, each living under a court.
    assert.equal(c.crews.length, fleet.boats.length, 'a crew for every boat');
    assert.equal(c.first + c.sailors, Math.floor(params.population), 'the last residents');
    c.crews.forEach((crew, k) => {
      assert.equal(crew.boat, k);
      if (k) assert.equal(crew.first, c.crews[k - 1].first + c.crews[k - 1].size, 'one after another');
      assert.ok(crew.size >= 1 && crew.size <= 12);
      assert.equal(residentOf(h, crew.first).home, crew.court, 'they live under their court');
    });
    // A sample of boats on their first day out from the fifth on.
    const step = Math.max(1, Math.floor(c.crews.length / 6));
    let followed = 0;
    for (let k = 0; k < c.crews.length; k += step) {
      const crew = c.crews[k], boat = fleet.boats[crew.boat];
      let day = 5;
      while (!outingOf(h, boat, day) && day < 25) day++;
      const o = outingOf(h, boat, day), w = crewWindow(h, crew, day, t);
      if (!o || !w) continue;
      followed++;
      assert.ok(w.start >= day * L && w.end < (day + 1) * L, 'their day on the water ends the day it began');
      // Aboard all the while it is out, each in their own place, on its deck (heeled and lifted as it is).
      for (let u = o.start; u < o.end; u += (o.end - o.start) / 9) {
        const b = boatAt(h, boat, u), crewed = crewsAt(h, u, { theta: b.theta, s: b.s, radius: 30 }, t).filter((p) => p.boat === crew.boat);
        assert.equal(crewed.length, crew.size, 'all aboard');
        assert.equal(new Set(crewed.map((p) => `${p.seat}`)).size, crew.size, 'each in their own place');
        for (const p of crewed) {
          assert.ok(p.activity === 'sail' && !p.moving && p.deck !== undefined && Math.abs(p.deck - b.level) < 4, `on its deck (${(p.deck! - b.level).toFixed(2)} m)`);
          assert.ok(floorGap(R, p.theta, p.s, b.theta, b.s) < 20, 'on the boat');
          if (residentOf(h, p.resident).body !== 'drone') assert.equal(footingOf(t, p, null, MEAN_HEIGHT).h, p.deck, 'standing on it, never swimming');
          assert.deepEqual(whereIs(h, u, p, t), p, 'found again');
        }
        assert.deepEqual(partyMembers(h, u, crewed[0]), Array.from({ length: crew.size }, (_, m) => crew.first + m));
      }
      const route = crewRoute(h, t, crew);
      if (boat.harbour < 0) {
        // At a buoy: aboard while it is out, nowhere else.
        assert.equal(crewMemberAt(h, o.start - 1, crew, 0, t), null);
        continue;
      }
      assert.ok(route && route.length > 0, 'a way to the berth');
      // Their way: over the land and along the paths, out over the pier and the pontoon; never through the water.
      const land = (u: number, s: number): boolean => t.standAt(u, s) - t.heightAt(u, s) < 0.1 || harbourSites.topAt(t, u, s) !== null;
      for (let d = 0; d <= route.length; d += 2) { const p = pointAlong(route, R, d); assert.ok(land(p.theta, p.s), `${name}: the way to boat ${crew.boat} goes through the water ${d.toFixed(0)} m along`); }
      const end = pointAlong(route, R, route.length);
      assert.ok(harbourSites.topAt(t, end.theta, end.s) !== null, 'it ends on the pontoon');
      // Walking there before it casts off, aboard SETTLE s before, home after.
      const out = crewMemberAt(h, o.start - SETTLE - 30, crew, 0, t), back = crewMemberAt(h, o.end + SETTLE + 30, crew, 0, t);
      assert.ok(out && out.moving && out.seat === undefined && back && back.moving && back.seat === undefined, 'walking to it and home');
      assert.ok(crewMemberAt(h, o.start - SETTLE + 1, crew, crew.size - 1, t)?.seat, 'the last of them aboard before it casts off');
      assert.equal(crewMemberAt(h, w.start - 1, crew, 0, t), null);
      assert.equal(crewMemberAt(h, w.end + 1, crew, 0, t), null);
      // Not below on their day out; below on a day their boat stays in.
      assert.ok(!stayingBelow(h, day, crew.court).includes(crew.first));
      let idle = day + 1;
      while (outingOf(h, boat, idle) && idle < day + 30) idle++;
      if (!outingOf(h, boat, idle)) assert.ok(stayingBelow(h, idle, crew.court).includes(crew.first), 'below on a day it stays in');
    }
    assert.ok(followed >= 1, 'some crews go out');
    // Nobody else is dealt a sailor; everyone found once, by their own key.
    const crew = c.crews[0], boat = fleet.boats[crew.boat];
    let day = 5;
    while (!outingOf(h, boat, day) && day < 25) day++;
    const o = outingOf(h, boat, day)!, b = boatAt(h, boat, (o.start + o.end) / 2);
    const area = { theta: b.theta, s: b.s, radius: Math.min(params.life.reach, 400) }, ps = peopleAt(h, (o.start + o.end) / 2, area, t);
    for (const p of ps) assert.ok((p.boat !== undefined) === (p.resident >= c.first), 'sailors only sail');
    assert.equal(new Set(ps.map((p) => p.resident)).size, ps.length, 'someone is in two places at once');
    assert.equal(new Set(ps.map(personKey)).size, ps.length, 'keys apart');
    assert.ok(crewOf(h, 0) === crew);
  });
}
