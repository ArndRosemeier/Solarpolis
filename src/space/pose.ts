/**
 * Rotations and poses in 64-bit numbers. A `Mat3` is row-major; its columns are the child frame's axes written in the
 * parent frame. A `Pose` places a child frame in its parent: p_parent = origin + axes · p_child.
 */
import { v3add, v3sub, type Vec3 } from '@futuremagic/core';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Pose {
  origin: Vec3;
  axes: Mat3;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation by `a` radians about +x (right-handed). */
export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Rotation by `a` radians about +z (right-handed). */
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** The pose `inner` (relative to a middle frame) expressed in the frame `outer` places the middle frame in. */
export function compose(outer: Pose, inner: Pose): Pose {
  return { origin: v3add(outer.origin, apply(outer.axes, inner.origin)), axes: mul(outer.axes, inner.axes) };
}

/** The parent's pose as seen from the child. */
export function invert(p: Pose): Pose {
  const t = transpose(p.axes);
  return { origin: apply(t, v3sub([0, 0, 0], p.origin)), axes: t };
}

export const ORIGIN: Pose = { origin: [0, 0, 0], axes: IDENTITY };
