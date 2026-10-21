/**
 * Flying through the habitat: a free camera for seeing the whole interior, from a metre over the grass to the axis.
 * It keeps a world position (float64), a look direction and an up direction. Up is "away from the floor" (straight
 * toward the axis, the way the spin's apparent gravity points) and swings smoothly as the flyer moves around the axis,
 * so crossing the axis rolls the view over instead of flipping it. Speed grows with the height above the ground, so
 * kilometres pass as quickly as metres feel near the grass. The flyer never goes below the ground. Pure (no three.js).
 */
import { fromWorld, toWorld, type Profile, type Vec3 } from '../blueprint';
import { v3cross as cross, v3dot as dot, v3norm as unit } from '@futuremagic/core';
import type { View } from './walker';

export interface FlyInput {
  /** -1 … 1 each: back/forward along the look, left/right, down/up along the flyer's up. */
  forward: number;
  right: number;
  up: number;
}

/** The lowest the flyer goes above the ground (m). */
export const MIN_CLEARANCE = 1.5;
/** How fast up swings to follow the axis (rad/s). */
const UP_TURN = 1.2;
/** The look stays this far (rad) from straight up and straight down. */
const POLE = 0.05;
/** Speed (m/s) per metre of height above the ground, and the slowest speed. */
const SPEED_PER_METRE = 0.8;
const SLOWEST = 8;

/** Rotate v about the unit axis k by angle a (Rodrigues). */
function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

export class Flyer {
  eye: Vec3;
  look: Vec3;
  up: Vec3;
  /** Speed multiplier (running, the debug menu's boost). */
  boost = 1;

  constructor(private profile: Profile, from: View, private ground: (theta: number, s: number) => number) {
    this.eye = [...from.eye];
    this.look = unit(from.look);
    this.up = unit(from.up);
  }

  /** Height above the ground (m), and where the ground is under the flyer. */
  clearance(): number {
    const at = fromWorld(this.profile, ...this.eye);
    return at.h - this.ground(at.theta, at.s);
  }

  /** The speed here (m/s), before the boost. */
  speed(): number {
    return Math.max(SLOWEST, this.clearance() * SPEED_PER_METRE);
  }

  /** Turn by mouse movement (radians): right turns right, up looks up. */
  turn(dRight: number, dUp: number): void {
    const turned = rotate(this.look, [-this.up[0], -this.up[1], -this.up[2]], dRight);
    const right = unit(cross(turned, this.up));
    const pitched = unit(rotate(turned, right, dUp));
    const tilt = Math.acos(Math.max(-1, Math.min(1, dot(pitched, this.up))));
    this.look = tilt > POLE && tilt < Math.PI - POLE ? pitched : unit(turned);
  }

  step(input: FlyInput, dt: number): void {
    const len = Math.hypot(input.forward, input.right, input.up);
    if (len > 0) {
      const d = (this.speed() * this.boost * dt) / Math.max(1, len);
      const right = unit(cross(this.look, this.up));
      for (let i = 0; i < 3; i++) this.eye[i] += d * (input.forward * this.look[i] + input.right * right[i] + input.up * this.up[i]);
    }
    // Never below the ground.
    const at = fromWorld(this.profile, ...this.eye);
    const floor = this.ground(at.theta, at.s) + MIN_CLEARANCE;
    if (at.h < floor) this.eye = toWorld(this.profile, { theta: at.theta, s: at.s, h: floor });
    this.followAxis(dt);
  }

  /** Swing up toward the axis, at most UP_TURN·dt; on the axis itself up stays as it was. */
  private followAxis(dt: number): void {
    const r = Math.hypot(this.eye[0], this.eye[1]);
    if (r < 1e-3) return;
    const target: Vec3 = [-this.eye[0] / r, -this.eye[1] / r, 0];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(this.up, target))));
    if (angle < 1e-6) return;
    const axis = cross(this.up, target);
    // Opposite ways (just crossed the axis): roll over around the look.
    const k = Math.hypot(...axis) > 1e-6 ? unit(axis) : unit(this.look);
    this.up = unit(rotate(this.up, k, Math.min(angle, UP_TURN * dt)));
    // Keep the look off the new up's poles.
    const tilt = Math.acos(Math.max(-1, Math.min(1, dot(this.look, this.up))));
    if (tilt < POLE || tilt > Math.PI - POLE) this.look = unit(rotate(this.look, unit(cross(this.look, this.up)), tilt < POLE ? -(POLE - tilt) : tilt - (Math.PI - POLE)));
  }

  view(): View {
    return { eye: [...this.eye], look: [...this.look], up: [...this.up] };
  }
}
