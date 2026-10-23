import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, toWorld, validate, withParams, type Vec3 } from '../src/blueprint';
import { BIRDS } from '../src/gen/birds';
import { nearestFloor } from '../src/gen/ecology';
import { plantsOf, standsIn } from '../src/gen/scatter';
import { open } from '../src/sim/fauna';
import { birdAt, floorGap, lightAt, songsIn, wingsFor, type Nest } from '../src/sim';
import { BIRDS_RADIUS, ecologyOf, woodBirdsOf } from './worlds';

const G = 9.81;

test('birds: a habitat without sensible bird parameters is invalid', () => {
  const birds = (change: Partial<typeof REFERENCE.life.birds>) => withParams({ life: { ...REFERENCE.life, birds: { ...REFERENCE.life.birds, ...change } } });
  for (const bad of [{ woods: -1 }, { territory: 0 }, { larks: -1 }, { owls: -1 }])
    assert.ok(validate(derive(birds(bad))).some((f) => f.id === 'life' && f.severity === 'invalid'), JSON.stringify(bad));
});

/** The first clock time (s) of the first day at which the light over s has risen to `level`, and the middle of the night. */
function dawnAt(e: ReturnType<typeof ecologyOf>, s: number, level: number): number {
  const h = e.terrain.habitat;
  for (let t = 0; t < h.params.day.length; t += 60) if (lightAt(h, s, t) >= level) return t;
  return NaN;
}
const nightOf = (e: ReturnType<typeof ecologyOf>): number => {
  const d = e.terrain.habitat.params.day;
  return d.length * (d.daylight + (1 - d.daylight) / 2);
};

/** A lark living on the nearest meadow to the middle of the floor (larks are few: one is set there to watch). */
const meadows = new Map<string, Nest[]>();
function larksOf(name: string): Nest[] {
  let larks = meadows.get(name);
  if (!larks) {
    const e = ecologyOf(name), t = e.terrain, { profile } = t.habitat;
    const m = nearestFloor(e, 2, (profile.floorStart + profile.floorEnd) / 2, 'grass', 3000, 0.8);
    larks = m ? [{ id: 1, kind: 'lark', theta: m.theta, s: m.s, seed: 1234567, size: 1, look: 0, perches: [], roost: { theta: m.theta, s: m.s, h: t.standAt(m.theta, m.s), ground: true } }] : [];
    meadows.set(name, larks);
  }
  return larks;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

for (const { name } of MATRIX) {
  test(`birds (${name}): songbirds live in the woods, each round a tree that is drawn, its perches near it`, () => {
    const e = ecologyOf(name), t = e.terrain, found = woodBirdsOf(name);
    if (!found) return;
    const { nests, theta, s } = found, R = t.habitat.radius, songbirds = nests.filter((n) => !BIRDS[n.kind].night && n.kind !== 'lark');
    assert.ok(songbirds.length > 0, 'a wood has birds');
    assert.equal(new Set(nests.map((n) => n.id)).size, nests.length, 'each its own');
    const plants = plantsOf(e);
    for (const n of nests) assert.ok(floorGap(R, theta, s, n.theta, n.s) <= BIRDS_RADIUS);
    for (const n of nests) if (n.kind === 'lark') assert.ok(open(t, n.theta, n.s), 'larks live in the open');
    for (const n of songbirds.slice(0, 4)) {
      // Its home is a tree the scatter plants (a plant of the climate stands right there).
      const r = Math.max(1, t.habitat.profile.at(n.s).r), b = { theta0: n.theta - 0.01 / r, theta1: n.theta + 0.01 / r, s0: n.s - 0.01, s1: n.s + 0.01 };
      let here = 0;
      for (const sp of plants) standsIn(e, sp, b, 0, () => { here++; });
      assert.ok(here > 0, `${n.kind}'s home is a tree`);
      assert.ok(n.perches.length >= 1);
      for (const p of n.perches) {
        assert.ok(floorGap(r, n.theta, n.s, p.theta, p.s) <= t.habitat.params.life.birds.territory, 'its perches are near its home');
        assert.ok(p.h > t.heightAt(p.theta, p.s), 'a perch is above the ground');
      }
      assert.ok(n.roost.h > t.heightAt(n.theta, n.s) && n.roost.h < n.perches[0].h, 'it roosts in its home tree, below its top');
    }
  });

  test(`birds (${name}): a bird moves smoothly, never faster than it flies; out by day, at roost by night (owls the other way)`, () => {
    const e = ecologyOf(name), t = e.terrain, found = woodBirdsOf(name);
    if (!found) return;
    const nests = [...found.nests.slice(0, 5), ...larksOf(name).slice(0, 1)], dawn = dawnAt(e, found.s, 0.3);
    for (const n of nests) {
      const spec = BIRDS[n.kind];
      let was = birdAt(t, n, dawn);
      for (let k = 1; k <= 1500; k++) {
        const time = dawn + k * 0.1, b = birdAt(t, n, time), speed = dist(b.at, was.at) / 0.1;
        assert.ok(speed < spec.cruise * 1.3 + 1, `${n.kind} at ${time.toFixed(1)}: ${speed.toFixed(1)} m/s (${was.doing} → ${b.doing})`);
        for (const v of [b.fwd, b.up]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6);
        was = b;
      }
      assert.deepEqual(birdAt(t, n, dawn + 123.4), birdAt(t, n, dawn + 123.4), 'the same every time');
      const night = birdAt(t, n, nightOf(e));
      assert.equal(night.doing === 'roost', !spec.night, `${n.kind} at night: ${night.doing}`);
    }
  });

  test(`birds (${name}): the songs are sung by birds on their posts, as the chorus comes with the light`, () => {
    const e = ecologyOf(name), t = e.terrain, found = woodBirdsOf(name);
    if (!found) return;
    const dawn = dawnAt(e, found.s, 0.3);
    let songs = 0;
    for (const n of found.nests) {
      const whole = songsIn(t, n, dawn, dawn + 120);
      assert.deepEqual([...songsIn(t, n, dawn, dawn + 50), ...songsIn(t, n, dawn + 50, dawn + 120)], whole, 'the same however the time is cut');
      for (const song of whole) {
        const b = birdAt(t, n, song.t);
        assert.equal(b.doing === 'sing' || n.kind === 'lark', true, `${n.kind} sings on its post (${b.doing})`);
        assert.ok(dist(song.at, b.at) < b.length, 'the song comes from the bird');
        songs++;
      }
    }
    assert.ok(songs > 0, 'the woods sing at dawn');
  });

  test(`birds (${name}): a lark rises singing high over its meadow and drops the last metres with wings closed`, () => {
    const e = ecologyOf(name), t = e.terrain, lark = larksOf(name)[0];
    if (!lark) return;
    const dawn = dawnAt(e, lark.s, 0.3), { profile } = t.habitat;
    let high = 0, dropped = false, sangAloft = 0;
    for (let time = dawn; time < dawn + 2 * 3600; time += 3) {
      const b = birdAt(t, lark, time);
      const p = Math.hypot(b.at[0], b.at[1]), ground = profile.at(lark.s).r - t.standAt(lark.theta, lark.s);
      high = Math.max(high, ground - p);
      if (b.doing === 'drop') { dropped = true; assert.ok(b.fold > 0.8, 'wings closed as it drops'); }
    }
    for (const song of songsIn(t, lark, dawn, dawn + 2 * 3600)) {
      const doing = birdAt(t, lark, song.t).doing;
      assert.ok(doing === 'climb' || doing === 'hover', `a lark sings in the air (${doing})`);
      sangAloft++;
    }
    assert.ok(high > 25, `it rises high (${high.toFixed(0)} m)`);
    assert.ok(dropped && sangAloft > 0);
  });

  test(`birds (${name}): wings carry the spin's apparent gravity: heavier flying spinward, pushed sideways climbing, lighter toward the axis`, () => {
    const h = ecologyOf(name).terrain.habitat, spec = BIRDS.blackbird, R = h.radius;
    const p = toWorld(h.profile, { theta: 0.3, s: h.profile.length / 2, h: 5 }), r = Math.hypot(p[0], p[1]);
    const up: Vec3 = [-p[0] / r, -p[1] / r, 0], spinward: Vec3 = [up[1] * Math.sign(h.spin), -up[0] * Math.sign(h.spin), 0];
    // Hanging still: it carries the floor's gravity there.
    const still = wingsFor(h, spec, p, [0, 0, 0], [0, 0, 0], spinward);
    assert.ok(Math.abs(still.load * G - h.gravityAt(r)) < 1e-6 * G);
    assert.ok(Math.abs(still.up[0] - up[0]) < 1e-9 && Math.abs(still.up[1] - up[1]) < 1e-9, 'its lift is up');
    // Level flight round the floor at v: its path curves toward the axis (v²/r), so it carries (ωr ± v)²/r.
    const v = spec.cruise, level = (dir: number): number => {
      const vel: Vec3 = [spinward[0] * v * dir, spinward[1] * v * dir, 0], a: Vec3 = [up[0] * (v * v) / r, up[1] * (v * v) / r, 0];
      return wingsFor(h, spec, p, vel, a, spinward).load * G;
    };
    const w = Math.abs(h.spin);
    assert.ok(Math.abs(level(1) - (w * r + v) ** 2 / r) < 1e-6, 'spinward: heavier');
    assert.ok(Math.abs(level(-1) - (w * r - v) ** 2 / r) < 1e-6, 'against the spin: lighter');
    assert.ok(level(1) > still.load * G && level(-1) < still.load * G);
    // Climbing straight up, Coriolis pushes it sideways by 2ωv: its wings must push back.
    const climb = wingsFor(h, spec, p, [up[0] * 3, up[1] * 3, 0], [0, 0, 0], spinward);
    const side = climb.need[0] * spinward[0] + climb.need[1] * spinward[1];
    assert.ok(Math.abs(Math.abs(side) - 2 * w * 3) < 1e-6, `pushed sideways (${side})`);
    // Near the axis it carries less and beats slower, for all the thinner air.
    const nearAxis = toWorld(h.profile, { theta: 0.3, s: h.profile.length / 2, h: R * 0.8 });
    const light = wingsFor(h, spec, nearAxis, [0, 0, 0], [0, 0, 0], spinward);
    assert.ok(light.load < still.load * 0.3 && light.beat < still.beat, `${light.load} g, ${light.beat} beats/s`);
  });
}
