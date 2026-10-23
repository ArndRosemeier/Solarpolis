/**
 * Voyages live outside the fast CI budget: planning one tour takes over a second (the lunar tour was over its own
 * 500 ms budget in the fast suite and pushed it past 30 s on slower runners, 2026-10-23), the catalogue audit minutes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolarSystem } from '../../src/space/solarSystem';
import { makeSpace, REFERENCE_SPACE, julianDay, DAY } from '../../src/space';
import { planVoyage, TOUR_SHIP, TOUR_RESERVE, voyageAt } from '../../src/space/voyage';

const data = (name: string) => JSON.parse(readFileSync(new URL(`../../public/space/${name}.json`, import.meta.url), 'utf8'));
const system = new SolarSystem(data('ephemeris'), data('moons'), data('small-bodies'));
const space = makeSpace(REFERENCE_SPACE, system);
const start = (julianDay(3026, 3, 1) - space.params.epochJd) * DAY;

test('every catalogue destination supports a finite-fuel return tour at the reference epoch', () => {
  const failures: string[] = [];
  for (const [index, b] of system.bodies.filter(b => b.kind !== 'star').entries()) {
    try {
      const p = planVoyage(space, system, b.id, start);
      assert.ok(p.end > p.start && p.finalFuel >= TOUR_SHIP.drive.propellant * TOUR_RESERVE);
    } catch (e) { failures.push(`${b.name}: ${String(e)}`); }
    if (index % 50 === 0) console.log(`Catalogue audit: ${index + 1} destinations checked, ${failures.length} failures`);
  }
  assert.deepEqual(failures, []);
});

test('lunar passenger tour matches moving arrivals, makes two laps, retains reserve and returns to the cylinder', () => {
  const p = planVoyage(space, system, 'moon', start);
  assert.ok(Math.abs((p.orbit.end - p.orbit.start) / p.orbit.period - 2) < 1e-10);
  assert.ok(p.finalFuel >= TOUR_SHIP.drive.propellant * TOUR_RESERVE);
  for (const l of [...p.outbound, ...p.inbound]) {
    assert.ok(l.flight.positionError < 25); assert.ok(l.flight.velocityError < .02);
    const t = l.flight.start + l.flight.burn1 / 2, s = voyageAt(p, system, space.params.epochJd, t);
    assert.ok(Math.abs(Math.hypot(...s.thrust) - 9.80665) < 1e-8);
  }
  for (const t of [p.orbit.start, p.orbit.end]) {
    const a = voyageAt(p, system, space.params.epochJd, t - .001), b = voyageAt(p, system, space.params.epochJd, t + .001);
    assert.ok(Math.hypot(...a.p.map((x, k) => x - b.p[k])) < 100);
    assert.ok(Math.hypot(...a.v.map((x, k) => x - b.v[k])) < .1);
  }
  const final = voyageAt(p, system, space.params.epochJd, p.end + DAY);
  const offset: [number, number, number] = [space.home.habitat.exterior.radius * 2 + 5000, 0, 0];
  const berth = space.frames.position(offset, space.home.orbitFrame, 'sun', p.end);
  assert.ok(Math.hypot(...final.p.map((x, k) => x - berth[k])) < 25);
  assert.ok(Math.abs(final.fuel - p.finalFuel) < .1);
  assert.equal(Math.hypot(...final.thrust), 0);
});
