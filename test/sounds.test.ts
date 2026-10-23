import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { BEDS, callsIn, lightAt, soundscapeAt, stepSurfaceAt, strideAt, type Listener } from '../src/sim/sounds';
import { landmarksOf } from '../src/gen/landmarks';
import { planOf } from '../src/gen/plan';
import { ecologyOf, woodBirdsOf } from './worlds';

const EYE = 1.7;

/** A listener standing at (θ, s) on the ground there. */
function standing(e: ReturnType<typeof ecologyOf>, theta: number, s: number, below = false): Listener {
  const ground = e.terrain.standAt(theta, s);
  return { theta, s, h: ground + EYE, ground, below, speed: 0 };
}

/** The first clock time (s) in the first day at which the light over s has risen to `level`. */
function lightRisenTo(e: ReturnType<typeof ecologyOf>, s: number, level: number): number {
  const h = e.terrain.habitat, day = h.params.day.length;
  for (let t = 0; t < day; t += 60) if (lightAt(h, s, t) >= level) return t;
  return NaN;
}

for (const { name } of MATRIX) {
  test(`sounds (${name}): every bed has a weight in 0 … 1, the same every time, and nothing of the land is heard below`, () => {
    const e = ecologyOf(name), p = e.terrain.habitat.profile, s = (p.floorStart + p.floorEnd) / 2;
    const t = lightRisenTo(e, s, 0.5), l = standing(e, 1, s);
    const a = soundscapeAt(e, t, l), b = soundscapeAt(e, t, l);
    assert.deepEqual(a, b);
    for (const bed of BEDS) assert.ok(a.beds[bed] >= 0 && a.beds[bed] <= 1, `${bed} ${a.beds[bed]}`);
    assert.ok(BEDS.some((bed) => a.beds[bed] > 0.05), 'the land is heard by day');
    const under = soundscapeAt(e, t, { ...l, below: true });
    for (const bed of BEDS) assert.equal(under.beds[bed], 0, bed);
  });

  test(`sounds (${name}): the lake is heard on its shore and not far from it; the air thins toward the axis`, () => {
    const e = ecologyOf(name), t = e.terrain, h = t.habitat, p = h.profile;
    const noon = (h.params.day.length * h.params.day.daylight) / 2;
    if (t.lake) {
      const shore = t.lake.s + t.lake.halfWidth + 2;
      assert.ok(soundscapeAt(e, noon, standing(e, 0.3, shore)).beds.lake > 0.5, 'on the shore');
      const far = t.lake.s > p.length / 2 ? p.floorStart + 50 : p.floorEnd - 50;
      assert.ok(soundscapeAt(e, noon, standing(e, 0.3, far)).beds.lake < 0.02, 'far from it');
    }
    const floor = soundscapeAt(e, noon, standing(e, 0.3, (p.floorStart + p.floorEnd) / 2));
    assert.ok(Math.abs(floor.air - 1) < 0.02, `air on the floor ×${floor.air}`);
    // Up the wild endcap, where the wall comes within 40% of the radius of the axis.
    let s = 0;
    while (s < p.floorStart && p.at(s).r < 0.4 * h.radius) s += 5;
    const high = soundscapeAt(e, noon, standing(e, 0.3, s));
    assert.ok(high.air < floor.air, `thinner air up the endcap (×${high.air})`);
    assert.ok(high.beds['wind-high'] > 0.3, 'thin wind up there');
  });

  test(`sounds (${name}): the dawn chorus comes with the light, from the wild end to the port end; none at night`, () => {
    const e = ecologyOf(name), p = e.terrain.habitat.profile, h = e.terrain.habitat;
    const wild = p.floorStart + 0.2 * (p.floorEnd - p.floorStart), port = p.floorStart + 0.8 * (p.floorEnd - p.floorStart);
    const tw = lightRisenTo(e, wild, 0.3), tp = lightRisenTo(e, port, 0.3);
    assert.ok(tw < tp, 'the light reaches the wild end first');
    const atWild = soundscapeAt(e, tw, standing(e, 0.2, wild)), atPort = soundscapeAt(e, tw, standing(e, 0.2, port));
    assert.ok(atWild.birds > 0.8, `the chorus at the wild end (${atWild.birds})`);
    assert.ok(atPort.birds < atWild.birds, 'the port end is still waiting for it');
    const night = h.params.day.length * (h.params.day.daylight + (1 - h.params.day.daylight) / 2);
    assert.equal(soundscapeAt(e, night, standing(e, 0.2, wild)).birds, 0);
  });

  test(`sounds (${name}): calls are the birds' songs, the same however the time is cut, only owls at night, none below`, () => {
    const e = ecologyOf(name), h = e.terrain.habitat, wood = woodBirdsOf(name);
    if (!wood) return;
    const { nests, theta, s } = wood, t0 = lightRisenTo(e, s, 0.3), l = standing(e, theta, s);
    const whole = callsIn(e, nests, t0, t0 + 60, l);
    assert.ok(whole.length > 0, 'the dawn chorus is heard in a wood');
    const cut = [...callsIn(e, nests, t0, t0 + 25, l), ...callsIn(e, nests, t0 + 25, t0 + 60, l)];
    assert.deepEqual(cut, whole);
    for (const c of whole) assert.ok(c.t >= t0 && c.t < t0 + 60);
    const night = h.params.day.length * (h.params.day.daylight + (1 - h.params.day.daylight) / 2);
    for (const c of callsIn(e, nests, night, night + 600, l)) assert.equal(c.kind, 'owl');
    assert.deepEqual(callsIn(e, nests, t0, t0 + 60, { ...l, below: true }), []);
  });

  test(`sounds (${name}): a foot lands on the floor below, water in the lake, stone in a court`, () => {
    const e = ecologyOf(name), t = e.terrain;
    const c = t.courts[0];
    assert.equal(stepSurfaceAt(e, c.theta, c.s, 0, true), 'floor');
    if (t.lake) assert.equal(stepSurfaceAt(e, 0.4, t.lake.s, t.lake.level - 0.5, false), 'water');
    assert.equal(stepSurfaceAt(e, c.theta, c.s, t.heightAt(c.theta, c.s), false), 'stone');
  });
}

test('sounds: each landmark is heard at it and not far off: water under the pavilion, banners at the hut, the grove\'s oaks', () => {
  for (const { name } of MATRIX) {
    const e = ecologyOf(name), t = e.terrain, h = t.habitat, p = h.profile, noon = (h.params.day.length * h.params.day.daylight) / 2;
    const at = (theta: number, s: number, feet = t.heightAt(theta, s)): Listener => ({ theta, s, h: feet + EYE, ground: feet, below: false, speed: 0 });
    const away = at(1, p.floorStart + 0.5 * (p.floorEnd - p.floorStart));
    for (const m of landmarksOf(t)) {
      const near = soundscapeAt(e, noon, at(m.theta, m.s, m.level + 0.5));
      if (m.kind === 'pavilion') assert.ok(near.beds.piers > 0.5 && soundscapeAt(e, noon, at(m.theta + Math.PI, m.s)).beds.piers < 0.05, `${name}: piers`);
      else assert.ok(near.beds.flags > 0.2, `${name}: banners at the hut ${near.beds.flags}`);
    }
    const grove = planOf(h).sites.find((x) => x.kind === 'founders-grove');
    if (grove) assert.ok(soundscapeAt(e, noon, at(grove.theta, grove.s)).beds.oaks > 0.1, `${name}: the grove's oaks`);
    const far = soundscapeAt(e, noon, away);
    assert.ok(far.beds.flags < 0.05 && (!grove || Math.abs(grove.s - away.s) < grove.size || far.beds.oaks === 0), `${name}: not heard from the floor's middle`);
  }
});

test('sounds: strides lengthen and slow as gravity falls', () => {
  const floor = strideAt(1.4, 9.81);
  assert.ok(floor > 0.6 && floor < 0.85, `a walk on the floor: ${floor} m`);
  assert.ok(strideAt(1.4, 2) > floor, 'longer near the axis');
  assert.ok(strideAt(4, 9.81) > floor, 'longer running');
});
