import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, validate, withParams } from '../src/blueprint';
import { nearestWood } from '../src/gen/ecology';
import { plantsOf, standsIn } from '../src/gen/scatter';
import { RUN, SLOT, densNear, floorGap, squirrelAt, type Den } from '../src/sim';
import { ecologyOf } from './worlds';

test('fauna: a habitat without sensible animal parameters is invalid', () => {
  const animals = (change: Partial<typeof REFERENCE.life.animals>) => withParams({ life: { ...REFERENCE.life, animals: { ...REFERENCE.life.animals, ...change } } });
  for (const bad of [{ squirrels: -1 }, { range: 0 }, { out: 1.5 }, { out: -0.1 }])
    assert.ok(validate(derive(animals(bad))).some((f) => f.id === 'life' && f.severity === 'invalid'), JSON.stringify(bad));
});

const RADIUS = 40;

/** The squirrels round the nearest wood to the middle of the floor (a small area, to stay in the CI budget). */
const woods = new Map<string, { dens: Den[]; theta: number; s: number } | null>();
function woodsOf(name: string): { dens: Den[]; theta: number; s: number } | null {
  if (woods.has(name)) return woods.get(name)!;
  const e = ecologyOf(name), { profile } = e.terrain.habitat;
  const w = nearestWood(e, 0.5, (profile.floorStart + profile.floorEnd) / 2, 3000, 0.5);
  const found = w && { dens: densNear(e, plantsOf(e), w.theta, w.s, RADIUS), theta: w.theta, s: w.s };
  woods.set(name, found);
  return found;
}

for (const { name, params } of MATRIX) {
  test(`fauna (${name}): squirrels live in the woods, each at a tree that is drawn, the same every time`, () => {
    const e = ecologyOf(name), t = e.terrain, R = t.habitat.radius, found = woodsOf(name);
    if (!found) return;
    const { dens, theta, s } = found;
    assert.ok(dens.length > 0, 'a wood has squirrels');
    assert.deepEqual(densNear(e, plantsOf(e), theta, s, RADIUS), dens, 'the same every time');
    assert.equal(new Set(dens.map((d) => d.id)).size, dens.length, 'each its own');
    const plants = plantsOf(e);
    for (const d of dens.slice(0, 4)) {
      assert.ok(floorGap(R, theta, s, d.theta, d.s) <= RADIUS);
      // Its tree is one the scatter plants (a plant of the climate stands right there).
      const r = Math.max(1, t.habitat.profile.at(d.s).r), b = { theta0: d.theta - 0.01 / r, theta1: d.theta + 0.01 / r, s0: d.s - 0.01, s1: d.s + 0.01 };
      let at = 0;
      for (const sp of plants) if (sp.what === 'plant' || sp.what === 'planted') standsIn(e, sp, b, 0, () => { at++; });
      assert.ok(at > 0, `a tree at ${d.theta.toFixed(5)}, ${d.s.toFixed(2)}`);
    }
  });

  test(`fauna (${name}): squirrels are down on the ground by day only, round their trees, on dry ground, no faster than they run`, () => {
    const t = ecologyOf(name).terrain, h = t.habitat, found = woodsOf(name);
    if (!found) return;
    const day = params.day.length, range = params.life.animals.range;
    let down = 0;
    for (const den of found.dens.slice(0, 6)) {
      const r = Math.max(1, h.profile.at(den.s).r);
      assert.equal(squirrelAt(t, den, 5 * day + (params.day.daylight + 0.1) * day), null, 'up in its tree at night');
      for (let k = 0; k < 40; k++) {
        const time = 5 * day + k * (params.day.daylight * day / 40) + 3.7, a = squirrelAt(t, den, time);
        if (!a) continue;
        down++;
        assert.ok(floorGap(r, den.theta, den.s, a.theta, a.s) <= range + 1, 'within its range');
        assert.ok(t.standAt(a.theta, a.s) <= t.heightAt(a.theta, a.s) + 0.05 || a.speed > 0, 'on dry ground at its spots');
        assert.ok(a.speed <= RUN && a.since >= 0 && a.since <= SLOT);
        const b = squirrelAt(t, den, time + 0.1);
        if (b) assert.ok(floorGap(r, a.theta, a.s, b.theta, b.s) <= RUN * 0.1 + 1e-6, 'moves no faster than it runs');
      }
    }
    assert.ok(down > 0, 'some are down in the day');
  });
}
