/**
 * Light is slow (world bible, Part II, rule 1: no faster-than-light anything). Every signal, sensor reading and piece
 * of news travels at the speed of light, so whatever happens somewhere is known elsewhere only when its light gets
 * there: minutes across the inner system, hours to the outer planets, years to the stars. This is the one place that
 * says when. Positions are heliocentric (m), times clock seconds. Pure.
 */
import type { Vec3 } from '@futuremagic/core';

/** The speed of light (m/s, exact by definition). */
export const C = 299792458;

/** How long light takes between two points (s). */
export function lightTime(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / C;
}

/**
 * When light sent from `from` at clock time `sent` reaches a receiver that moves along `to(t)`: the time t at which
 * t − sent = |to(t) − from| / c. Each step shrinks the error by the receiver's speed over c (a ten-thousandth for
 * anything in orbit), so three steps are exact to well under a microsecond.
 */
export function arrivalOf(from: Vec3, sent: number, to: (t: number) => Vec3): number {
  let t = sent + lightTime(from, to(sent));
  for (let k = 0; k < 3; k++) t = sent + lightTime(from, to(t));
  return t;
}

/** When the light seen at `at` at clock time `seen` left a source that moves along `from(t)` (its retarded time). */
export function departureOf(from: (t: number) => Vec3, at: Vec3, seen: number): number {
  let t = seen - lightTime(from(seen), at);
  for (let k = 0; k < 3; k++) t = seen - lightTime(from(t), at);
  return t;
}
