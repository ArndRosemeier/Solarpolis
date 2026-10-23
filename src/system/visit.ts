/**
 * Going to another habitat (plan "The Whole System"; for now a proof of concept: one arrives at once). Every habitat
 * of the ledger is entered as the sample habitat at its own size (`blueprintOf`, other forms are parked: docs/system.md),
 * with its own seed, Mind and people; how long the trip would take each way of going is `tripsTo`. Later one has to
 * find a ship going one's way, or have one, or a friend with one (Arnd, 2026-10-23). Pure.
 */
import { v3len, v3sub } from '@futuremagic/core';
import { derive, isValid, scaleBlueprint, validate, type HabitatParams } from '../blueprint';
import { SOLAR_BODIES } from '../space/solarData';
import type { HabitatRecord, Ledger } from './ledger';
import type { TravelParams } from './params';

/** Where the player is in the system: the home habitat's blueprint (the ledger's home) and the habitat they are at. */
export interface Whereabouts {
  home: HabitatParams;
  at: string;
}

export const TRAVEL_WAYS = ['sail', 'coast', 'hurry'] as const;
export type TravelWay = (typeof TRAVEL_WAYS)[number];

/** How long a way of going takes over a distance (s), from rest to rest: speeding up, coasting, slowing down. */
export function tripTime(distance: number, way: { accel: number; cruise: number }): number {
  const spurt = (way.cruise * way.cruise) / way.accel;
  // Never at cruise: speeding up halfway, slowing the other half.
  if (distance <= spurt) return 2 * Math.sqrt(distance / way.accel);
  return distance / way.cruise + way.cruise / way.accel;
}

/** A trip from one ledger place to another at clock time t: the distance now (m) and how long each way takes (s). */
export interface Trip {
  distance: number;
  times: Record<TravelWay, number>;
}

export function tripsTo(ledger: Ledger, from: string, to: string, t: number): Trip {
  const distance = v3len(v3sub(ledger.where(to, t), ledger.where(from, t)));
  const ways: TravelParams = ledger.params.travel;
  return { distance, times: { sail: tripTime(distance, ways.sail), coast: tripTime(distance, ways.coast), hurry: tripTime(distance, ways.hurry) } };
}

/**
 * The blueprint one walks in at a habitat of the ledger: the home habitat's, at the habitat's own size (a bubble as
 * long as it is wide), with its seed, Mind and people. Null where there is none to walk in yet: a surface settlement,
 * or one too small for the sample blueprint to hold together.
 */
export function blueprintOf(ledger: Ledger, id: string): HabitatParams | null {
  const home = ledger.space.home;
  if (id === 'home') return home;
  const h = ledger.habitat(id);
  if (!h || h.form === 'surface') return null;
  const length = Math.max(h.length, 2 * h.radius);
  const p: HabitatParams = { ...scaleBlueprint(home, h.radius, length, h.seed), mind: h.mind, population: h.population };
  try {
    return isValid(validate(derive(p))) ? p : null;
  } catch {
    return null;
  }
}

/** Where a habitat is, in words: "in orbit about Mars", "at the Earth–Moon L5", "in the Belt". */
export function placeInWords(h: HabitatRecord): string {
  const o = h.orbit, name = (id: string): string => SOLAR_BODIES.find((b) => b.id === id)?.name ?? id;
  switch (o.kind) {
    case 'necklace': return 'in the Necklace, Earth’s geostationary ring';
    case 'lagrange': return `at the Earth–Moon L${o.point}`;
    case 'circle': return `in orbit about ${name(o.body)}`;
    case 'surface': return `on ${name(o.body)}`;
    case 'asteroid': return o.belt === 'kuiper' ? 'in the outer dark, on a Kuiper object' : o.belt === 'trojan' ? 'among Jupiter’s Trojans' : 'in the Belt';
    case 'sun': return 'on its own orbit about the Sun';
  }
}
