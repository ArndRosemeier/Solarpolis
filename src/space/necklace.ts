/**
 * The habitats in Earth orbit: the geostationary ring ("the Necklace", Arnd 2026-10-21). Each habitat holds a slot
 * above one longitude of Earth, with its axis pointing at an ecliptic pole, so the Sun stays side-on to it all year
 * without steering. The home habitat's blueprint is given; its neighbours are seeded variations of it, so the ring is
 * a pure function of the world's parameters and seed.
 */
import { Rng, TAU, deriveSeed } from '@futuremagic/core';
import { derive, isValid, validate, type HabitatParams } from '../blueprint';
import { EARTH } from './constants';

export interface NecklaceParams {
  /** How many habitats share the ring, the home one included. */
  count: number;
  /** The home habitat's longitude over Earth (radians, east positive). */
  homeLongitude: number;
  /** How far a slot may sit from even spacing, as a share of the spacing. */
  slotJitter: number;
  /** How far a neighbour's radius and length may differ from the home habitat's, as a factor (2 = half to double). */
  sizeSpread: number;
}

export interface Placement {
  id: string;
  params: HabitatParams;
  /** Longitude over Earth (radians). */
  longitude: number;
  /** Radius of the orbit from Earth's centre (m). */
  orbitRadius: number;
  /** Which ecliptic pole the port end points at. */
  portToward: 'north' | 'south';
  /** Spin angle at clock time 0 (radians). */
  spinPhase: number;
}

/** The radius of a geostationary orbit: one turn per sidereal day (m), from Kepler's third law. */
export function geostationaryRadius(): number {
  return Math.cbrt((EARTH.gm * EARTH.siderealDay * EARTH.siderealDay) / (TAU * TAU));
}

/** A seeded neighbour: the home blueprint scaled across (radius, hub, sunline, relief) and along (length, lake width), kept only if it is buildable. */
function neighbour(home: HabitatParams, rng: Rng, spread: number, seed: number): HabitatParams {
  const homeArea = home.radius * home.length;
  for (let tries = 0; tries < 16; tries++) {
    const k = Math.pow(spread, rng.range(-1, 1)), j = Math.pow(spread, rng.range(-1, 1));
    const radius = home.radius * k, length = home.length * j;
    const p: HabitatParams = {
      ...home,
      radius,
      length,
      hubRadius: home.hubRadius * k,
      sunlineRadius: home.sunlineRadius * k,
      relief: {
        hills: home.relief.hills * k,
        ringLake: home.relief.ringLake && { width: home.relief.ringLake.width * j, depth: home.relief.ringLake.depth * k },
        terraceStep: home.relief.terraceStep * k,
        rivers: home.relief.rivers && { ...home.relief.rivers, width: home.relief.rivers.width * k, depth: home.relief.rivers.depth * k },
      },
      clouds: home.clouds && { ...home.clouds, base: home.clouds.base * k, thickness: home.clouds.thickness * k, size: home.clouds.size * k },
      population: Math.round((home.population * radius * length) / homeArea),
      seed,
    };
    if (isValid(validate(derive(p)))) return p;
  }
  return { ...home, seed };
}

/** Every habitat on the ring, the home one first. */
export function necklace(home: HabitatParams, n: NecklaceParams, worldSeed: number): Placement[] {
  const r = geostationaryRadius();
  const spacing = TAU / n.count;
  const out: Placement[] = [];
  for (let i = 0; i < n.count; i++) {
    const seed = deriveSeed(worldSeed, 'habitat', i);
    const rng = new Rng(seed);
    const params = i === 0 ? home : neighbour(home, rng, n.sizeSpread, seed);
    const jitter = i === 0 ? 0 : rng.range(-n.slotJitter, n.slotJitter) * spacing;
    out.push({
      id: i === 0 ? 'home' : `necklace-${i}`,
      params,
      longitude: n.homeLongitude + i * spacing + jitter,
      orbitRadius: r,
      portToward: rng.chance(0.5) ? 'north' : 'south',
      spinPhase: rng.range(0, TAU),
    });
  }
  return out;
}
