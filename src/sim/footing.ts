/**
 * Where someone up on the land has their feet, and how they hold themselves: on the ground, on what is built there (a
 * landmark's deck, the Lift Stair's treads, a boat), or treading water with the head out; upright, kneeling or lying as the
 * beat they are in has them (sim/beats.ts). Someone whose body is a drone hovers instead, over ground, deck or water alike, at the height of the faces
 * of those they are with. Every level that draws people (the figures, the stand-ins, the specks far off, the drones'
 * view) places them by this. Pure.
 */
import type { Terrain } from '../gen/terrain';
import { MEAN_HEIGHT, POSE } from '../gen/standIn';
import { residentOf, type Person } from './population';
import { underFloorAt } from '../gen/underMesh';

export { postureOf } from './beats';

/** Deeper water than this (m) is swum in. */
export const SWIM_WATER = 0.6;
/** A swimmer treads water with the head out: the feet this share of the height under the surface. */
export const SWIM_DEPTH = 0.85;

/**
 * Where a drone body's middle hovers over what is under it: at the eyes of those it is with, standing, sitting (or
 * kneeling) or lying (shares of a body's height, `POSE` order).
 */
const AT_EYES = [0.93, 0.62, 0.3];

export interface Footing {
  /** The feet's height over the profile (m); a drone body's lowest point. */
  h: number;
  pose: number;
  swim: boolean;
}

/**
 * Someone's footing at their place: `deck` is the height of what is built under them (`landmarkTopAt`, or null), and
 * `height` theirs (a swimmer's feet hang that far under the surface; a drone body's own height).
 */
export function footingOf(terrain: Terrain, p: Person, deck: number | null, height: number): Footing {
  const still = p.moving ? POSE.upright : p.posture;
  // Aboard a boat: on its deck as the boat lies, heels and flies (sim/crews.ts).
  if (p.deck !== undefined) deck = p.deck;
  const surface = p.deck ?? (p.below ? p.interiorFloor ?? underFloorAt(terrain, p.theta, p.s) : terrain.standAt(p.theta, p.s));
  if (residentOf(terrain.habitat, p.resident).body === 'drone') {
    const under = deck !== null && deck > surface ? deck : surface;
    return { h: under + AT_EYES[still] * MEAN_HEIGHT - height / 2, pose: POSE.upright, swim: false };
  }
  // On a deck over the water (a bridge, the pavilion) they stand on the deck.
  if (p.deck !== undefined || (deck !== null && deck > surface)) return { h: deck ?? surface, pose: still, swim: false };
  if (!p.below && surface - terrain.heightAt(p.theta, p.s) > SWIM_WATER) return { h: surface - SWIM_DEPTH * height, pose: POSE.upright, swim: true };
  return { h: surface, pose: still, swim: false };
}
