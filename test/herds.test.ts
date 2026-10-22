import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { planOf } from '../src/gen/plan';
import { localNoon } from '../src/sim/population';
import { DEER_LAG, DEER_WALK, HERD_MOST, crownsOf, deerAt, deerLand, floorGap, herdsNear, type Herd } from '../src/sim';
import { ecologyOf } from './worlds';

const RADIUS = 1000;

/** The herds round the middle of each habitat's wild reserve (a small area, to stay in the CI budget). */
const near = new Map<string, { herds: Herd[]; theta: number; s: number }>();
function herdsOf(name: string): { herds: Herd[]; theta: number; s: number } {
  let found = near.get(name);
  if (!found) {
    const e = ecologyOf(name), h = e.terrain.habitat, s = (h.profile.floorStart + planOf(h).reserveEnd) / 2;
    found = { herds: herdsNear(e, 1, s, RADIUS), theta: 1, s };
    near.set(name, found);
  }
  return found;
}

for (const { name, params } of MATRIX) {
  test(`herds (${name}): deer live in herds on their land, the same every time`, () => {
    const e = ecologyOf(name), h = e.terrain.habitat, { herds, theta, s } = herdsOf(name), roam = params.life.animals.roam;
    if (name !== 'small') assert.ok(herds.length > 0, 'the reserve has deer');
    assert.deepEqual(herdsNear(e, theta, s, RADIUS), herds, 'the same every time');
    assert.equal(new Set(herds.map((x) => x.id)).size, herds.length, 'each its own');
    for (const herd of herds) {
      const r = Math.max(1, h.profile.at(herd.s).r);
      assert.ok(herd.size >= 2 && herd.size <= HERD_MOST, `a herd of ${herd.size}`);
      assert.ok(floorGap(r, theta, s, herd.theta, herd.s) <= RADIUS + 1, 'within reach of where they were asked for');
      assert.ok(deerLand(h, herd.theta, herd.s), 'home on deer land');
      for (const list of [herd.cover, herd.graze]) for (let i = 0; i < list.length; i += 2) {
        assert.ok(deerLand(h, list[i], list[i + 1]), 'its places on deer land');
        assert.ok(floorGap(r, herd.theta, herd.s, list[i], list[i + 1]) <= roam + 1, 'within its roam');
      }
    }
  });

  test(`herds (${name}): deer graze in the open in the morning and evening, lie up under the trees round the light's peak`, () => {
    const e = ecologyOf(name), t = e.terrain, h = t.habitat, crowns = crownsOf(e), L = params.day.length, dusk = params.day.daylight * L;
    let atNoon = 0, inCover = 0, atDusk = 0, inOpen = 0;
    for (const herd of herdsOf(name).herds.slice(0, 6)) {
      const noon = 7 * L + localNoon(h, herd.s) * L, evening = 7 * L + dusk - 0.03 * dusk, last = herd.size - 1;
      // Only herds that found both kinds of place round home.
      if (herd.cover[0] === herd.theta && herd.cover[1] === herd.s) continue;
      if (herd.graze[0] === herd.theta && herd.graze[1] === herd.s) continue;
      for (const i of [0, last]) {
        const a = deerAt(t, herd, i, noon + i * DEER_LAG), b = deerAt(t, herd, i, evening + i * DEER_LAG);
        atNoon++;
        if (a.speed === 0 && crowns(a.theta, a.s, t.heightAt(a.theta, a.s)) >= 0.35) inCover++;
        atDusk++;
        if (b.doing !== 'walk' || b.speed < DEER_WALK) if (crowns(b.theta, b.s, t.heightAt(b.theta, b.s)) <= 0.35) inOpen++;
      }
    }
    // Where the land has no woods (the large habitat's reserve is open grassland), herds lie up in the open.
    if (name === 'reference') assert.ok(atNoon > 0, 'some herds with both kinds of place');
    if (atNoon === 0) return;
    assert.ok(inCover >= 0.75 * atNoon, `${inCover} of ${atNoon} lying up in cover at noon`);
    assert.ok(inOpen >= 0.75 * atDusk, `${inOpen} of ${atDusk} out in the open before dusk`);
  });

  test(`herds (${name}): a deer goes no faster than a herd walks and closes up, all day and over midnight`, () => {
    const t = ecologyOf(name).terrain, h = t.habitat, L = params.day.length, herd = herdsOf(name).herds[0];
    if (!herd) return;
    const r = Math.max(1, h.profile.at(herd.s).r), step = 4;
    // Walking, plus closing up into file from the edge of the herd (at most 3.5 m × √size over 8 s).
    const fastest = DEER_WALK + (3.5 * Math.sqrt(herd.size)) / 8 + 0.05;
    for (const i of [0, herd.size - 1]) {
      let was = deerAt(t, herd, i, 3 * L), wet = 0, n = 0;
      for (let time = 3 * L + step; time <= 4 * L + 60; time += step) {
        const d = deerAt(t, herd, i, time);
        assert.ok(floorGap(r, was.theta, was.s, d.theta, d.s) <= fastest * step, `deer ${i} jumps ${floorGap(r, was.theta, was.s, d.theta, d.s).toFixed(1)} m at ${(time - 3 * L).toFixed(0)} s (${was.doing} → ${d.doing})`);
        assert.ok(d.since >= 0 && Number.isFinite(d.heading));
        if (t.standAt(d.theta, d.s) > t.heightAt(d.theta, d.s) + 0.3) wet++;
        n++;
        was = d;
      }
      assert.ok(wet <= 0.02 * n, `deer ${i} in deep water ${wet} of ${n} times`);
    }
  });
}
