import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v3len, v3sub, v3cross, v3dot } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { REFERENCE_SPACE, makeSpace, julianDay, AU } from '../src/space';
import { ephemerisAt, SolarSystem, type EphemerisPack } from '../src/space/solarSystem';
import type { MoonRecord, SmallRecord } from '../src/space/solarData';
import { asteroid, asteroidPosition, KIRKWOOD } from '../src/space/asteroids';
import { apply } from '../src/space/pose';
import { polePlane, eccentricAnomaly } from '../src/space/orbits';
import { SUN } from '../src/space/constants';
import { sunlightFrom, type SkyView } from '../src/space/sky';
import { rayLuminance, exposureFor, DARKEST } from '../src/render/exposure';

const data = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const pack = data<EphemerisPack>('../public/space/ephemeris.json');
const moons = data<MoonRecord[]>('../public/space/moons.json');
const system = new SolarSystem(pack, moons, data<SmallRecord[]>('../public/space/small-bodies.json'));
const jd = julianDay(3026, 3, 1);

test('solar ephemeris: independent withheld Horizons samples agree to within one kilometre', () => {
  const fixtures = data<{ body: string; jd: number; km: [number, number, number] }[]>('./fixtures/solar-vectors.json');
  for (const sample of fixtures) {
    const found = ephemerisAt(pack, sample.body, sample.jd);
    const error = v3len(v3sub(found, sample.km.map(x => x * 1000) as [number, number, number]));
    assert.ok(error < 1000, `${sample.body}: ${error} m`);
  }
  assert.throws(() => ephemerisAt(pack, 'mars', pack.start - 1), RangeError);
  assert.throws(() => ephemerisAt(pack, 'mars', pack.stop + 1), RangeError);
});

test('solar ephemeris: segments join without visible jumps and Earth retains the lunar barycentre correction', () => {
  for (const [id, b] of Object.entries(pack.bodies)) {
    const boundary = pack.start + b.span * 12;
    assert.ok(v3len(v3sub(ephemerisAt(pack, id, boundary - 1e-8), ephemerisAt(pack, id, boundary + 1e-8))) < 1000, id);
  }
  assert.ok(v3len(v3sub(system.position('earth', jd), ephemerisAt(pack, 'emb', jd))) > 4000000);
  const speed = v3len(system.velocity('earth', jd));
  assert.ok(speed > 28000 && speed < 31000);
});

test('solar catalogue: all imported satellites have unique frames and bounded, correctly oriented ellipses', () => {
  assert.equal(moons.length, 461);
  assert.equal(system.moons.size, 465);
  assert.equal(system.byId.size, system.bodies.length);
  assert.equal(system.bodies.filter(b => b.kind === 'planet').length, 8);
  assert.equal(system.bodies.filter(b => b.kind === 'dwarf').length, 5);
  for (const [id, m] of system.moons) {
    for (const date of [jd, jd + 83]) {
      const distance = v3len(system.moonOffset(id, date));
      assert.ok(distance > m.a * 1000 * (1 - m.e) * .98 && distance < m.a * 1000 * (1 + m.e) * 1.02, `${m.name}: ${distance}`);
    }
  }
  const triton = 'moon-801', orbitNorth = apply(polePlane(299.36, 43.46), [0, 0, 1]);
  assert.ok(v3dot(v3cross(system.moonOffset(triton, jd), system.moonOffset(triton, jd + .001)), orbitNorth) < 0, 'Triton must orbit retrograde');
});

for (const { name, params } of MATRIX) test(`solar frames (${name}): local precision survives Neptune-scale separation`, () => {
  const space = makeSpace({ ...REFERENCE_SPACE, home: params }, system);
  const time = (jd - space.params.epochJd) * 86400;
  for (const body of system.bodies) assert.ok(space.frames.has(body.id), body.id);
  const origin = space.frames.position([0, 0, 0], 'neptune', 'sun', time);
  assert.ok(v3len(origin) > 29 * AU && v3len(origin) < 31 * AU);
  const local: [number, number, number] = [.001, .002, .003];
  const round = space.frames.position(space.frames.position(local, space.home.bodyFrame, space.home.spindleFrame, time), space.home.spindleFrame, space.home.bodyFrame, time);
  assert.ok(v3len(v3sub(local, round)) < 1e-8);
});

test('asteroids: deterministic populations follow size laws, resonance gaps and sparse astronomical spacing', () => {
  let gaps = 0, total = 0;
  for (let k = 0; k < 2000; k++) {
    const a = asteroid(1, 'main', k);
    assert.ok(a.a >= 2.1 && a.a <= 3.3 && a.e < .33 && a.i <= .5);
    if (KIRKWOOD.some(g => Math.abs(a.a - g) < .018)) gaps++;
    total++;
    if (k < 10) assert.deepEqual(a, asteroid(1, 'main', k));
    const r = v3len(asteroidPosition(a, jd, 0));
    assert.ok(r >= a.a * AU * (1 - a.e) * .999 && r <= a.a * AU * (1 + a.e) * 1.001);
  }
  assert.ok(gaps / total < .015, 'resonant semi-major axes should be strongly depleted');
  assert.ok(asteroid(1, 'main', 100).body.radius > asteroid(1, 'main', 100000).body.radius);
  assert.notDeepEqual(asteroid(1, 'main', 5), asteroid(2, 'main', 5));
});

test('Kepler solver: eccentric and retrograde orbit inputs retain the equation over centuries', () => {
  for (const e of [0, .2, .751, .99]) for (const m of [-1e6, -.01, 0, 3, 1e6]) {
    const E = eccentricAnomaly(m, e), reduced = Math.atan2(Math.sin(m), Math.cos(m));
    assert.ok(Math.abs(E - e * Math.sin(E) - reduced) < 1e-10);
  }
});

test('solar lighting: foreground planets eclipse the Sun; bodies beyond it do not', () => {
  const sun: [number, number, number] = [AU, 0, 0], away: [number, number, number] = [0, AU, 0];
  assert.equal(sunlightFrom(sun, away, away, [{ center: [1e8, 0, 0], radius: 7e7 }]), 0);
  assert.equal(sunlightFrom(sun, away, away, [{ center: [2 * AU, 0, 0], radius: 7e7 }]), 1);
});

test('solar exposure: the resolved Sun keeps its surface brightness from Earth to close observation', () => {
  const disc = (distance: number) => {
    const sky: SkyView = { sunDir: [1, 0, 0], sunDistance: distance, sunRadius: Math.asin(SUN.radius / distance), sunlight: 1,
      earth: { center: [0, AU, 0], radius: 6e6, axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      moon: { center: [0, AU, 0], radius: 1e6, axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] } };
    const meter = { sky, hulls: [], earthshine: 0 };
    const brightness = rayLuminance(meter, [1, 0, 0]);
    const exposure = exposureFor(meter, [[1, 0, 0], [0, 0, 1]], DARKEST.plain);
    assert.ok(exposure * brightness < 1.51);
    assert.ok(rayLuminance(meter, [0, 0, 1]) === 0);
    return brightness;
  };
  assert.ok(Math.abs(disc(AU) / disc(SUN.radius * 4.5) - 1) < 1e-10);
});
