/**
 * Where someone up on the land has their feet, and how they hold themselves: on the ground, on what is built there (a
 * landmark's deck, the Lift Stair's treads), or treading water with the head out; upright, kneeling or lying by what
 * they do. Every level that draws people (the figures, the stand-ins, the specks far off) stands them by this. Pure.
 */
import type { Terrain } from '../gen/terrain';
import { POSE } from '../gen/standIn';
import type { Activity } from './venues';
import type { Person } from './population';

/** Deeper water than this (m) is swum in. */
export const SWIM_WATER = 0.6;
/** A swimmer treads water with the head out: the feet this share of the height under the surface. */
export const SWIM_DEPTH = 0.85;

/** How people hold themselves at what they do while staying put (`POSE`); walking, everyone is upright. */
const POSTURE: Partial<Record<Activity, number>> = { make: POSE.kneel, sit: POSE.kneel, bench: POSE.kneel, picnic: POSE.lie, stargaze: POSE.lie };

export function postureOf(activity: Activity): number {
  return POSTURE[activity] ?? POSE.upright;
}

export interface Footing {
  /** The feet's height over the profile (m). */
  h: number;
  pose: number;
  swim: boolean;
}

/**
 * Someone's footing at their place: `deck` is the height of what is built under them (`landmarkTopAt`, or null), and
 * `height` theirs (a swimmer's feet hang that far under the surface).
 */
export function footingOf(terrain: Terrain, p: Person, deck: number | null, height: number): Footing {
  const surface = terrain.standAt(p.theta, p.s), still = p.moving ? POSE.upright : postureOf(p.activity);
  // On a deck over the water (a bridge, the pavilion) they stand on the deck.
  if (deck !== null && deck > surface) return { h: deck, pose: still, swim: false };
  if (surface - terrain.heightAt(p.theta, p.s) > SWIM_WATER) return { h: surface - SWIM_DEPTH * height, pose: POSE.upright, swim: true };
  return { h: surface, pose: still, swim: false };
}
