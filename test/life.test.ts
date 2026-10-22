import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, REFERENCE } from '../src/blueprint';
import { fromLake, planOf } from '../src/gen/plan';
import { pathsOf } from '../src/gen/paths';
import { floorGap, peopleAt, personKey, residentOf, shuffleOf, talkerAt, venuesOf, walksOf, whereIs, type Person } from '../src/sim';
import { habitatOf } from './worlds';

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
  const h = habitatOf(name), day = params.day.length, R = h.radius;
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
    // Anyone found is found again on their own, now and a minute on, walking as fast as they said.
    for (const p of a) assert.deepEqual(whereIs(h, at(6), p), p);
    for (const p of a.filter((q) => q.moving).slice(0, 50)) {
      const q = whereIs(h, at(6) + 60, p);
      if (q?.moving) assert.ok(near(p, q) <= p.speed * 60 + 1, `${p.activity} moved ${near(p, q).toFixed(0)} m in a minute at ${p.speed.toFixed(2)} m/s`);
    }
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

  test(`life (${name}): parties come up together, walk two abreast and stand in rings facing in`, () => {
    const parties = new Map<string, Person[]>();
    for (const t of [at(5), at(8)]) for (const p of (whole ? peopleAt(h, t) : sample(t)).filter((q) => q.court >= 0)) {
      const key = `${t}:${personKey({ court: p.court, outing: p.outing - p.member })}`;
      const list = parties.get(key) ?? [];
      list.push(p);
      parties.set(key, list);
    }
    let rings = 0, together = 0, groups = 0;
    for (const list of parties.values()) {
      const size = list[0].size;
      assert.ok(list.every((p) => p.size === size && p.member < size), 'a party disagrees on its size');
      if (list.length < 2 || list.length !== size) continue;
      groups++;
      // Everyone near the first: walking a few steps apart, staying within their shape (a ring to dance in is the widest).
      const far = Math.max(...list.map((p) => near(p, list[0])));
      if (far <= 4 + 2.5 * size) together++;
      if (list.some((p) => p.moving || p.act !== 'talk') || !['meet', 'gather'].includes(list[0].activity)) continue;
      // A talking ring (talking now, not looking about or off on a stroll): each faces its middle.
      const R0 = list[0];
      const xy = list.map((p) => { const d = p.theta - R0.theta; return [p.s - R0.s, (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * R]; });
      const mx = xy.reduce((a, q) => a + q[0], 0) / size, my = xy.reduce((a, q) => a + q[1], 0) / size;
      list.forEach((p, k) => {
        const to = [mx - xy[k][0], my - xy[k][1]], l = Math.hypot(to[0], to[1]);
        assert.ok((to[0] * Math.cos(p.heading) + to[1] * Math.sin(p.heading)) / l > 0.95, `someone in a ring of ${size} faces away from it`);
      });
      rings++;
      // One of them speaks at a time, the same one for all of them.
      const talker = talkerAt(list[0], at(8));
      assert.ok(talker >= 0 && talker < size && list.every((p) => talkerAt(p, at(8)) === talker));
    }
    assert.ok(groups > 0 && together >= groups * 0.9, `${together} of ${groups} parties together`);
    if (whole) assert.ok(rings > 0, 'no talking rings');
  });

  test(`life (${name}): every court has a green; few spend their outing in a court`, () => {
    const v = venuesOf(h);
    assert.ok(v.byCourt.every((ks) => ks.some((k) => v.venues[k].kind === 'green')), 'a court without a green');
    const out = sample(at(8)), inCourts = out.filter((p) => p.activity === 'meet' || p.activity === 'bench').length;
    assert.ok(inCourts < out.length * 0.3, `${inCourts} of ${out.length} up are in the courts`);
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
