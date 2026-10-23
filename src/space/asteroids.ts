/** Seeded statistical populations, not a cloud of obstacles: distances are astronomical.
 * The cumulative size law, Rayleigh eccentricities/inclinations and resonance depletion are explicit model choices.
 * Kirkwood gaps are in semi-major axis, never empty rings in instantaneous position. */
import { Rng, deriveSeed, type Vec3 } from '@futuremagic/core';
import { AU, JD_J2000 } from './constants';
import { ellipseAt } from './orbits';
import type { SolarBody } from './solarData';

export type Belt = 'main' | 'trojan' | 'kuiper';
export const BELTS = {
  main: { count: 1200000, minDiameter: 1000, exponent: 2.3 },
  trojan: { count: 500000, minDiameter: 1000, exponent: 2.3 },
  kuiper: { count: 70000, minDiameter: 100000, exponent: 4 },
} as const;
export const KIRKWOOD = [2.502, 2.824, 2.958, 3.279];
export interface Asteroid { body: SolarBody; belt: Belt; a: number; e: number; i: number; node: number; peri: number; mean: number; libration: number; phase: number }

export function asteroid(seed: number, belt: Belt, index: number): Asteroid {
  if (index < 0 || index >= BELTS[belt].count) throw new RangeError('Asteroid index outside the model population');
  const rng = new Rng(deriveSeed(seed, `solar-${belt}-${index}`)), tau = 2 * Math.PI;
  const rayleigh = (sigma: number, cap: number): number => Math.min(cap, sigma * Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.range(0, 1)))));
  let a: number, e: number, i: number;
  if (belt === 'main') {
    do { a = rng.range(2.1, 3.3); } while (KIRKWOOD.some(gap => Math.abs(a - gap) < .018) && rng.range(0, 1) > .035);
    e = rayleigh(.09, .32); i = rayleigh(6 * Math.PI / 180, .5);
  } else if (belt === 'trojan') {
    a = 5.2026; e = rayleigh(.055, .2); i = rayleigh(10 * Math.PI / 180, .65);
  } else {
    a = rng.range(42, 48); e = rayleigh(.045, .15); i = rayleigh((rng.range(0, 1) < .6 ? 2 : 14) * Math.PI / 180, .65);
  }
  const pop = BELTS[belt], diameter = Math.min(belt === 'kuiper' ? 1500000 : 350000, pop.minDiameter * (pop.count / (index + 8)) ** (1 / pop.exponent));
  const carbon = belt !== 'main' || rng.range(0, 1) < (a - 2) / 1.5;
  const albedo = belt === 'kuiper' ? rng.range(.05, .3) : carbon ? rng.range(.03, .09) : rng.range(.12, .25);
  const colour: Vec3 = carbon ? [albedo * .9, albedo * .85, albedo * .8] : [albedo, albedo * .85, albedo * .65];
  return { belt, a, e, i, node: rng.range(0, tau), peri: rng.range(0, tau), mean: rng.range(0, tau), libration: rng.range(.05, .45), phase: rng.range(0, tau),
    body: { id: `${belt}-${index}`, name: `${belt === 'main' ? 'Belt asteroid' : belt === 'trojan' ? 'Jupiter Trojan' : 'Kuiper object'} ${index + 1}`, parent: 'sun', kind: 'asteroid', radius: diameter / 2,
      polar: diameter * rng.range(.28, .48), pole: [rng.range(0, 360), rng.range(-90, 90)], rotation: rng.range(.1, 1.5), colour, albedo, appearance: 0, radiusKnown: false } };
}

export function asteroidPosition(o: Asteroid, jd: number, jupiterLongitude: number): Vec3 {
  const mean = o.belt === 'trojan'
    ? jupiterLongitude + (o.phase < Math.PI ? 1 : -1) * Math.PI / 3 + o.libration * Math.sin((jd - JD_J2000) * 2 * Math.PI / (150 * 365.25) + o.phase) - o.node - o.peri
    : o.mean + (jd - JD_J2000) * .01720209895 / o.a ** 1.5;
  return ellipseAt(o.a * AU, o.e, mean, o.i, o.node, o.peri);
}
