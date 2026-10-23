/** A slow walk out of the sheltered port entrance into the cylinder's full view. Pure, on an injected clock. */
import { v3norm } from '@futuremagic/core';
import type { Habitat, Vec3 } from '../blueprint';
import { rampOf } from '../gen/liftStair';
import { arrivalTerraceOf, type ArrivalTerrace } from '../gen/arrivalTerrace';
import { EYE_HEIGHT, VIEW_FOV, type View } from './walker';

export const REVEAL_SECONDS = 14;
const ease = (x: number): number => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

export interface ArrivalReveal extends View { fov: number; heading: number; pitch: number }
export function revealAt(h: Habitat, terrace: ArrivalTerrace, seconds: number): ArrivalReveal {
  const move = ease((seconds - 1) / 9), open = ease((seconds - 2) / 9);
  const z = terrace.start[0] + (terrace.finish[0] - terrace.start[0]) * move, w = terrace.start[1];
  const feet = rampOf(h).world(z, w, terrace.platform.e), up = v3norm([-feet[0], -feet[1], 0]);
  const heading = Math.PI + 0.12 * open, pitch = -0.04 - 0.07 * open;
  const side: Vec3 = [-up[1], up[0], 0];
  const look: Vec3 = side.map((v, k) => Math.cos(pitch) * (v * Math.sin(heading) + (k === 2 ? Math.cos(heading) : 0)) + up[k] * Math.sin(pitch)) as Vec3;
  return { eye: feet.map((v, k) => v + up[k] * EYE_HEIGHT) as Vec3, up, look, heading, pitch, fov: VIEW_FOV - 12 * (1 - open) };
}

export { arrivalTerraceOf };
