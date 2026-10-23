/** Complete catalogue audit lives outside the fast CI budget. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolarSystem } from '../../src/space/solarSystem';
import { makeSpace, REFERENCE_SPACE, julianDay, DAY } from '../../src/space';
import { planVoyage, TOUR_SHIP, TOUR_RESERVE } from '../../src/space/voyage';

test('every catalogue destination supports a finite-fuel return tour at the reference epoch', () => {
  const data = (name: string) => JSON.parse(readFileSync(new URL(`../../public/space/${name}.json`, import.meta.url), 'utf8'));
  const system = new SolarSystem(data('ephemeris'), data('moons'), data('small-bodies'));
  const space = makeSpace(REFERENCE_SPACE, system), start = (julianDay(3026, 3, 1) - space.params.epochJd) * DAY;
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
