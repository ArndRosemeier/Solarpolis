/**
 * Where someone up on the land has their feet, and how they hold themselves: on the ground, on what is built there (a
 * landmark's deck, the Lift Stair's treads, a boat), or treading water with the head out; upright, kneeling or lying as the
 * beat they are in has them (sim/beats.ts). Someone whose body is a drone hovers instead, over ground, deck or water alike, at the height of the faces
 * of those they are with. Every level that draws people (the figures, the stand-ins, the specks far off, the drones'
 * view) places them by this. Pure.
 */
import type { Habitat } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { MEAN_HEIGHT, POSE, SEAT_FEET, SEAT_HIPS } from '../gen/standIn';
import { ahead, residentOf, type Person } from './population';
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
 * Where someone's feet are on the floor (θ, s): under their place, but at a seat (round a court's light well) in front
 * of it, on the floor its front stands on, with their hips over the seat (facing out from it). Ask what is built under
 * someone (`deck`) here.
 */
export function feetOf(h: Habitat, p: Person): [number, number] {
  return p.activity === 'bench' && !p.moving ? ahead(h, p.theta, p.s, p.heading, SEAT_HIPS + SEAT_FEET) : [p.theta, p.s];
}

/**
 * Someone's footing at their place: `deck` is the height of what is built under them (`landmarkTopAt`, or null), and
 * `height` theirs (a swimmer's feet hang that far under the surface; a drone body's own height).
 */
export function footingOf(terrain: Terrain, p: Person, deck: number | null, height: number): Footing {
  const still = p.moving ? POSE.upright : p.posture;
  // Aboard a boat: on its deck as the boat lies, heels and flies (sim/crews.ts).
  if (p.deck !== undefined) deck = p.deck;
  const [ft, fs] = feetOf(terrain.habitat, p);
  const surface = p.deck ?? (p.below ? p.interiorFloor ?? underFloorAt(terrain, p.theta, p.s) : terrain.standAt(ft, fs));
  if (residentOf(terrain.habitat, p.resident).body === 'drone') {
    const under = deck !== null && deck > surface ? deck : surface;
    return { h: under + AT_EYES[still] * MEAN_HEIGHT - height / 2, pose: POSE.upright, swim: false };
  }
  // On a deck over the water (a bridge, the pavilion) they stand on the deck.
  if (p.deck !== undefined || (deck !== null && deck > surface)) return { h: deck ?? surface, pose: still, swim: false };
  if (!p.below && surface - terrain.heightAt(ft, fs) > SWIM_WATER) return { h: surface - SWIM_DEPTH * height, pose: POSE.upright, swim: true };
  return { h: surface, pose: still, swim: false };
}
