import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, REFERENCE } from '../src/blueprint';
import { fromLake, planOf } from '../src/gen/plan';
import { pathsOf } from '../src/gen/paths';
import { floorGap, peopleAt, residentOf, shuffleOf, venuesOf, walksOf, type Person } from '../src/sim';

const HOUR = 3600;

test('life: a day shuffle sends every resident to one slot and back', () => {
  for (const n of [1, 2, 7, 1000, 4097]) {
    const sh = shuffleOf(n, 12345), seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const j = sh.permute(i);
      assert.ok(j >= 0 && j < n);
      seen.add(j);
      assert.equal(sh.unpermute(j), i);
    }
    assert.equal(seen.size, n);
  }
});

test('life: a habitat without sensible life parameters is invalid', () => {
  assert.ok(validate(derive(withParams({ life: { ...REFERENCE.life, outings: 1.5 } }))).some((f) => f.id === 'life' && f.severity === 'invalid'));
  assert.ok(validate(derive(withParams({ life: { ...REFERENCE.life, walk: 0 } }))).some((f) => f.id === 'life'));
  assert.ok(!validate(derive(REFERENCE)).some((f) => f.id === 'life'));
});

for (const { name, params } of MATRIX) {
  const h = derive(params), day = params.day.length, R = h.radius;
  /** Clock times on day 3, hours after dawn. */
  const at = (hours: number): number => 3 * day + hours * HOUR;
  const whole = name === 'small' || name === 'long';
  const near = (p: { theta: number; s: number }, q: { theta: number; s: number }): number => floorGap(R, p.theta, p.s, q.theta, q.s);

  test(`life (${name}): the same seed and clock give the same people, each in one place`, () => {
    const court = venuesOf(h).courts[0], area = { theta: court.theta, s: court.s, radius: params.life.reach * 2 };
    // A habitat made again (nothing kept) gives the same people; the big ones only once, to stay in the CI budget.
    const again = whole ? derive(params) : h;
    const a = peopleAt(h, at(6), area), b = peopleAt(again, at(6), area);
    assert.deepEqual(a.map((p) => [p.resident, p.theta, p.s, p.activity]), b.map((p) => [p.resident, p.theta, p.s, p.activity]));
    assert.equal(new Set(a.map((p) => p.resident)).size, a.length, 'someone is in two places at once');
    assert.deepEqual(residentOf(h, 17), residentOf(again, 17));
    for (const p of a) assert.ok(Number.isFinite(p.theta) && Number.isFinite(p.s) && Number.isFinite(p.heading));
  });

  if (name !== 'large') test(`life (${name}): asking for an area finds everyone the whole habitat has there`, () => {
    const v = venuesOf(h), court = v.courts[Math.floor(v.courts.length / 2)];
    const area = { theta: court.theta, s: court.s, radius: Math.min(params.life.reach, params.plan.entranceSpacing) };
    const t = at(7);
    const some = peopleAt(h, t, area);
    const all = peopleAt(h, t).filter((p) => near(p, area) <= area.radius);
    assert.deepEqual(some.map((p) => p.resident).sort((x, y) => x - y), all.map((p) => p.resident).sort((x, y) => x - y));
  });

  test(`life (${name}): people follow the light down the tube, walk the paths and keep out of the lake`, () => {
    const lake = planOf(h).lake, paths = pathsOf(h), v = venuesOf(h);
    const morning = whole ? peopleAt(h, at(3)) : sample(at(3)), evening = whole ? peopleAt(h, at(11)) : sample(at(11));
    const mean = (ps: Person[]): number => ps.reduce((a, p) => a + p.s, 0) / Math.max(1, ps.length);
    assert.ok(morning.length > 0 && evening.length > 0, 'nobody is out');
    if (whole) assert.ok(mean(evening) > mean(morning), `the crowd stays at ${mean(evening).toFixed(0)} m from ${mean(morning).toFixed(0)} m`);
    let walkers = 0, onPaths = 0;
    for (const p of [...morning, ...evening]) {
      if (lake && !['swim', 'gather', 'sunwalk', 'walk'].includes(p.activity)) assert.ok(fromLake(lake, p.s) >= 0, `someone ${p.activity}s in the lake`);
      if (p.activity !== 'walk') continue;
      walkers++;
      // On the paths, or on the last stretch over the land from where they leave the paths to their place.
      const net = walksOf(h), stretch = v.byCourt[p.court].some((k) => {
        const x = v.venues[k], leave = { theta: net.theta(x.vertex), s: net.s(x.vertex) };
        return near(p, x) <= near(leave, x) + x.spread + 1;
      });
      if (paths.pathAt(p.theta, p.s, 30) || stretch) onPaths++;
    }
    assert.ok(walkers === 0 || onPaths === walkers, `${walkers - onPaths} of ${walkers} walkers off the paths, far from their place`);
    assert.ok(v.venues.every((x) => x.vertex >= 0 && x.vertex < walksOf(h).size));
  });

  function sample(t: number): Person[] {
    const v = venuesOf(h), out: Person[] = [];
    for (let k = 0; k < v.courts.length; k += Math.max(1, Math.floor(v.courts.length / 6))) {
      const c = v.courts[k];
      out.push(...peopleAt(h, t, { theta: c.theta, s: c.s, radius: params.plan.entranceSpacing }));
    }
    return out;
  }

  if (whole) test(`life (${name}): about one in ten up on the land at the busiest hour, few at night, the Stair full at dusk`, () => {
    const share = (hours: number): number => peopleAt(h, at(hours)).length / params.population;
    const busiest = Math.max(...[4, 7, 10].map(share)), night = share(params.day.daylight * 24 + 4);
    assert.ok(busiest > 0.04 && busiest < 0.2, `${(busiest * 100).toFixed(1)} % at the busiest`);
    assert.ok(night < busiest / 4, `${(night * 100).toFixed(1)} % at night`);
    const dusk = peopleAt(h, at(params.day.daylight * 24 - 0.5)).filter((p) => p.activity === 'watch').length;
    const noon = peopleAt(h, at(6)).filter((p) => p.activity === 'watch').length;
    assert.ok(dusk > noon * 3 && dusk > 0, `${dusk} watch the dusk from the Stair, ${noon} at noon`);
  });
}
