/**
 * The space model (src/space): calendar, ephemeris against known events, the frame tree, and the Necklace over the
 * whole blueprint matrix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3dot, v3len, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, toWorld } from '../src/blueprint';
import {
  AU, DAY, calendarOf, earthAt, moonFromEarthAt, julianDay, makeSpace, geostationaryRadius, siderealTimeAt, obliquityAt, REFERENCE_SPACE,
  type Space,
} from '../src/space';

const D = Math.PI / 180;
const near = (got: number, want: number, tol: number, what: string): void =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} ± ${tol}`);

/** Clock time of a calendar date in a space. */
const tOf = (s: Space, y: number, m: number, d: number): number => (julianDay(y, m, d) - s.params.epochJd) * DAY;

test('space: Julian dates match Meeus', () => {
  assert.equal(julianDay(2000, 1, 1.5), 2451545);
  near(julianDay(1957, 10, 4.81), 2436116.31, 1e-9, 'Sputnik');
  near(julianDay(1987, 1, 27), 2446822.5, 1e-9, 'Meeus 7.a');
  // And back: Meeus 7.c, and a date in the game's century.
  assert.deepEqual(calendarOf(2436116.31), { year: 1957, month: 10, day: calendarOf(2436116.31).day });
  near(calendarOf(2436116.31).day, 4.81, 1e-6, 'Sputnik, back');
  const c = calendarOf(julianDay(3026, 3, 1.6));
  assert.deepEqual([c.year, c.month], [3026, 3]);
  near(c.day, 1.6, 1e-6, 'March 3026, back');
});

test('space: Earth is at perihelion in early January and aphelion in early July (2026)', () => {
  near(v3len(earthAt(julianDay(2026, 1, 3.7))) / AU, 0.98330, 0.0002, 'perihelion distance (AU)');
  near(v3len(earthAt(julianDay(2026, 7, 6.8))) / AU, 1.01666, 0.0002, 'aphelion distance (AU)');
});

test('space: the Sun crosses the equator at the 2026 March equinox and peaks at the June solstice', () => {
  const s = makeSpace(REFERENCE_SPACE);
  const dec = (t: number): number => Math.asin(v3norm(s.frames.position([0, 0, 0], 'sun', 'earth.fixed', t))[2]) / D;
  near(dec(tOf(s, 2026, 3, 20 + (14 + 46 / 60) / 24)), 0, 0.03, 'declination at the equinox (°)');
  near(dec(tOf(s, 2026, 6, 21 + (8 + 24 / 60) / 24)), 23.436, 0.03, 'declination at the solstice (°)');
});

test('space: the Moon is full at the March 2026 lunar eclipse and new at the August 2026 solar eclipse', () => {
  const elongation = (jd: number): number => {
    const sun = v3norm(v3sub([0, 0, 0], earthAt(jd))), moon = v3norm(moonFromEarthAt(jd));
    return Math.acos(v3dot(sun, moon)) / D;
  };
  near(elongation(julianDay(2026, 3, 3 + 11.6 / 24)), 180, 2, 'elongation at full moon (°)');
  near(elongation(julianDay(2026, 8, 12 + 17.6 / 24)), 0, 2, 'elongation at new moon (°)');
  for (let d = 0; d < 28; d += 0.5) {
    const r = v3len(moonFromEarthAt(julianDay(3026, 1, 1 + d))) / 1000;
    assert.ok(r > 355000 && r < 407500, `Moon distance ${r} km`);
  }
});

test('space: Earth turns once per sidereal day, and its tilt has eased slightly by 3026', () => {
  near(siderealTimeAt(2451545) / D, 280.46061837, 1e-6, 'sidereal time at J2000 (°)');
  const jd = REFERENCE_SPACE.epochJd;
  near((((siderealTimeAt(jd + 0.99726957) - siderealTimeAt(jd)) / D + 360) % 360), 0, 0.01, 'one sidereal day (°)');
  near(obliquityAt(jd) / D, 23.31, 0.02, 'obliquity in 3026 (°)');
  for (let m = 1; m <= 12; m++) {
    const r = v3len(earthAt(julianDay(3026, m, 1))) / AU;
    assert.ok(r > 0.98 && r < 1.02, `Earth–Sun distance in 3026 ${r} AU`);
  }
});

test('space: the frame tree converts back and forth, and stays exact inside a habitat', () => {
  const s = makeSpace(REFERENCE_SPACE);
  const p: Vec3 = [1234.5, -321.25, 17000.125];
  const t = 3.7e7;
  for (const to of ['sun', 'earth', 'earth.fixed', 'moon', 'necklace-3.body']) {
    const back = s.frames.position(s.frames.position(p, 'home.body', to, t), to, 'home.body', t);
    assert.ok(v3len(v3sub(back, p)) < (to === 'sun' ? 1e-3 : 1e-6), `round trip through ${to}: ${v3len(v3sub(back, p))} m`);
  }
  const inOrbit = s.frames.position(p, 'home.body', 'home.orbit', t);
  near(v3len(inOrbit) ** 2, p[0] ** 2 + p[1] ** 2 + (p[2] - s.home.habitat.length / 2) ** 2, 1e-3, 'distances from the centre survive');
});

test('space: the Necklace is the same for the same seed, buildable, and evenly spread', () => {
  const a = makeSpace(REFERENCE_SPACE), b = makeSpace(REFERENCE_SPACE);
  assert.deepEqual(a.habitats.map((h) => [h.longitude, h.params.radius, h.spinPhase]), b.habitats.map((h) => [h.longitude, h.params.radius, h.spinPhase]));
  assert.equal(a.habitats.length, REFERENCE_SPACE.necklace.count);
  assert.equal(a.home.params, REFERENCE_SPACE.home);
  const step = (2 * Math.PI) / REFERENCE_SPACE.necklace.count;
  a.habitats.forEach((h, i) => assert.ok(Math.abs(h.longitude - REFERENCE_SPACE.necklace.homeLongitude - i * step) <= 0.31 * step, `slot ${i}`));
  const other = makeSpace({ ...REFERENCE_SPACE, seed: 2 });
  assert.notDeepEqual(other.habitats.map((h) => h.params.radius), a.habitats.map((h) => h.params.radius));
});

for (const { name, params } of MATRIX) {
  const s = makeSpace({ ...REFERENCE_SPACE, home: params });
  const h = s.home.habitat;
  const t0 = 1.234e8;

  test(`space ${name}: the habitat holds its geostationary slot over its longitude`, () => {
    const at = (t: number): Vec3 => s.frames.position([0, 0, 0], s.home.orbitFrame, 'earth.fixed', t);
    near(v3len(at(t0)) / 1000, 42164, 1, 'orbit radius (km)');
    near(geostationaryRadius() / 1000, 42164, 1, 'geostationary radius (km)');
    assert.ok(v3len(v3sub(at(t0), at(t0 + 3.3 * DAY))) < 1e-3, 'stays over the same point of Earth');
  });

  test(`space ${name}: the Sun stays side-on to the axis all year`, () => {
    for (let m = 0; m < 12; m++) {
      const t = t0 + m * 30.4 * DAY;
      const sun = v3norm(s.frames.position([0, 0, 0], 'sun', s.home.bodyFrame, t));
      assert.ok(Math.abs(sun[2]) < 1e-3, `Sun's angle off the spin plane in month ${m}: ${Math.asin(sun[2]) / D}°`);
    }
  });

  test(`space ${name}: the floor turns at the spin rate, once per period`, () => {
    const floor = toWorld(h.profile, { theta: 1, s: (h.profile.floorStart + h.profile.floorEnd) / 2, h: 0 });
    const pos = (t: number): Vec3 => s.frames.position(floor, s.home.bodyFrame, s.home.orbitFrame, t);
    const dt = 1e-3;
    near(v3len(v3sub(pos(t0 + dt), pos(t0))) / dt, h.floorSpeed, h.floorSpeed * 1e-4, 'floor speed (m/s)');
    assert.ok(v3len(v3sub(pos(t0 + h.period), pos(t0))) < 1e-4 * h.radius, 'back after one period');
    near(v3len(pos(t0)) ** 2, h.radius ** 2 + (h.length / 2 - floor[2]) ** 2, 1e-3 * h.radius ** 2, 'the floor point keeps its distance from the centre');
  });
}
