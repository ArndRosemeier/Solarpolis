/**
 * The arrival's first walk (design "The Threshold", 2026-10-23): the newcomer steps out of the port's door under the
 * porch and walks to the overlook while the view opens. The camera follows a few metres behind, so the first thing
 * one sees of the habitat is oneself in it; it ends behind the player, who walks on from there (the wheel goes into
 * the eyes). Pure, on an injected clock.
 */
import { v3dot, v3madd, v3norm, v3sub } from '@futuremagic/core';
import type { Habitat, Vec3 } from '../blueprint';
import { rampOf } from '../gen/liftStair';
import { arrivalTerraceOf, type ArrivalTerrace } from '../gen/arrivalTerrace';
import { EYE_HEIGHT, VIEW_FOV, type View } from './walker';

export const REVEAL_SECONDS = 14;
/**
 * How far behind the player's eyes the camera follows (m): close in the porch as they step out of the door, further
 * back as the view opens, and where it ends (the walking view behind the player takes over from there).
 */
export const REVEAL_CHASE = { from: 2.2, to: 3.2 } as const;
/** How far the camera keeps in front of the door (m), and the least it follows by (out of the head, m). */
const DOOR_ROOM = 0.35, HEAD_ROOM = 0.5;
const ease = (x: number): number => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
/** The walk's share done at `seconds` (it starts after a second and takes nine), and its rate (per second). */
const walkAt = (seconds: number): number => ease((seconds - 1) / 9);
const walkRate = (seconds: number): number => { const u = (seconds - 1) / 9; return u <= 0 || u >= 1 ? 0 : (6 * u * (1 - u)) / 9; };

/**
 * One moment of the reveal: the player's eyes (`eye`, `look`, `up`, and the walker's `heading` and `pitch`), where
 * their body stands (`feet`, facing `front`, walking at `speed` m/s), the camera's distance behind the eyes (`chase`)
 * and its field of view.
 */
export interface ArrivalReveal extends View {
  fov: number;
  heading: number;
  pitch: number;
  feet: Vec3;
  front: Vec3;
  speed: number;
  chase: number;
}

export function revealAt(h: Habitat, terrace: ArrivalTerrace, seconds: number): ArrivalReveal {
  const move = walkAt(seconds), open = ease((seconds - 2) / 9);
  const dz = terrace.finish[0] - terrace.start[0], z = terrace.start[0] + dz * move, w = terrace.start[1];
  const ramp = rampOf(h), e = terrace.platform.e, feet = ramp.world(z, w, e), up = v3norm([-feet[0], -feet[1], 0]);
  const heading = Math.PI + 0.12 * open, pitch = -0.04 - 0.07 * open;
  const side: Vec3 = [-up[1], up[0], 0];
  const look: Vec3 = side.map((v, k) => Math.cos(pitch) * (v * Math.sin(heading) + (k === 2 ? Math.cos(heading) : 0)) + up[k] * Math.sin(pitch)) as Vec3;
  // Facing along the walk (the ramp's line turns a little round the axis as z changes), over the floor.
  const step = Math.sign(dz) || -1, ahead = ramp.world(z + step * 0.05, w, e), back = ramp.world(z - step * 0.05, w, e);
  const tangent = v3sub(ahead, back), front = v3norm(v3madd(tangent, up, -v3dot(tangent, up)));
  // Its speed along the world path: the plan's rate times how far the path runs per metre of z.
  const stretch = Math.hypot(...tangent) / 0.1;
  // Never back through the door the walk starts from (on a small landing the camera starts closer).
  const from = Math.max(HEAD_ROOM, Math.min(REVEAL_CHASE.from, Math.abs(terrace.start[0] - terrace.door) - DOOR_ROOM));
  return {
    eye: feet.map((v, k) => v + up[k] * EYE_HEIGHT) as Vec3, up, look, heading, pitch, fov: VIEW_FOV - 12 * (1 - open),
    feet, front, speed: Math.abs(dz) * stretch * walkRate(seconds), chase: from + (REVEAL_CHASE.to - from) * open,
  };
}

export { arrivalTerraceOf };
