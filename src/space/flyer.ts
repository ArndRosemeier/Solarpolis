/**
 * The free camera outside (design "Solarpolis: the outside", O4): it flies anywhere from tens of thousands of
 * kilometres out down to a metre off the hull. Its speed is a share of the distance to the nearest solid thing, so
 * crossing that whole range takes seconds and the last metres are slow; it never comes closer than `MIN_CLEARANCE`.
 *
 * Positions are float64 in one frame (the view uses the home habitat's orbit frame), up is that frame's +z. Pure.
 */
import { v3add, v3len, v3scale, type Vec3 } from '@futuremagic/core';

/** Speed as a share of the clearance, per second, and the slowest speed (m/s). */
export const SPEED_PER_CLEARANCE = 0.8;
export const MIN_SPEED = 2;
/** How close the eye may come to a surface (m), and how far it may go from the frame's origin (m). */
export const MIN_CLEARANCE = 1;
export const MAX_RANGE = 5e7;
/** Shift: this much faster. */
export const FAST = 5;

export interface FlyInput {
  /** -1 … 1 each: back/forward, left/right, down/up. */
  forward: number;
  right: number;
  up: number;
  fast: boolean;
}

export class SpaceFlyer {
  /** Heading around +z and pitch above the xy plane (radians). */
  yaw = 0;
  pitch = 0;

  constructor(public eye: Vec3, look: Vec3) {
    this.lookAlong(look);
  }

  /** Unit look direction. */
  look(): Vec3 {
    const c = Math.cos(this.pitch);
    return [c * Math.cos(this.yaw), c * Math.sin(this.yaw), Math.sin(this.pitch)];
  }

  lookAlong(d: Vec3): void {
    const l = v3len(d);
    if (!(l > 0)) return;
    this.yaw = Math.atan2(d[1], d[0]);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d[2] / l)));
  }

  /** Turn by pointer movement (radians). */
  turn(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dPitch));
  }

  /** How fast the eye moves here (m/s), given the clearance there. */
  static speed(clearance: number, fast: boolean): number {
    return Math.max(MIN_SPEED, clearance * SPEED_PER_CLEARANCE) * (fast ? FAST : 1);
  }

  /** Move for dt seconds. `clearance(p)` is the distance from p to the nearest solid thing (m). */
  step(input: FlyInput, dt: number, clearance: (p: Vec3) => number): void {
    const f = this.look(), r: Vec3 = [Math.sin(this.yaw), -Math.cos(this.yaw), 0];
    const u: Vec3 = [-Math.sin(this.pitch) * Math.cos(this.yaw), -Math.sin(this.pitch) * Math.sin(this.yaw), Math.cos(this.pitch)];
    const dir = v3add(v3add(v3scale(f, input.forward), v3scale(r, input.right)), v3scale(u, input.up));
    const n = v3len(dir);
    if (!(n > 0) || !(dt > 0)) return;
    const travel = SpaceFlyer.speed(clearance(this.eye), input.fast) * dt;
    const unit = v3scale(dir, 1 / n);
    const at = (k: number): Vec3 => v3add(this.eye, v3scale(unit, travel * k));
    // The step is a small share of the clearance, so it cannot jump through anything; only its end is checked.
    let ok = 0, bad = 1;
    if (clearance(at(1)) >= MIN_CLEARANCE) ok = 1;
    else for (let i = 0; i < 24; i++) { const m = (ok + bad) / 2; if (clearance(at(m)) >= MIN_CLEARANCE) ok = m; else bad = m; }
    let next = at(ok);
    const range = v3len(next);
    if (range > MAX_RANGE) next = v3scale(next, MAX_RANGE / range);
    this.eye = next;
  }
}
