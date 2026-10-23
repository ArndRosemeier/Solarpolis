/**
 * World to screen: where a point relative to the eye (`toView`) lands on the canvas, in CSS pixels from its top left,
 * or null behind the camera or off the screen by more than `margin` px. The one way (guard: `.project(camera)` only
 * here), for anything the page draws over the 3D view (the speech bubbles, render/talk.ts).
 */
import { Vector3, type Camera } from 'three';
import type { Vec3 } from '../blueprint';

const at = new Vector3();

export function toScreen(camera: Camera, v: Vec3, width: number, height: number, margin = 0): [number, number] | null {
  // In front of the camera (its space looks down −z), whatever depth range its projection maps to.
  at.set(v[0], v[1], v[2]).applyMatrix4(camera.matrixWorldInverse);
  if (at.z >= 0) return null;
  at.set(v[0], v[1], v[2]).project(camera);
  const x = (at.x * 0.5 + 0.5) * width, y = (0.5 - at.y * 0.5) * height;
  return x < -margin || x > width + margin || y < -margin || y > height + margin ? null : [x, y];
}

/**
 * Where a point relative to the eye shows, for a mark that must not be lost (the link's marks, app/link): on screen
 * (`on`), or else held `inset` px inside the screen's edge in its direction (behind the eye: toward the side to turn),
 * with that direction as an angle on screen (rad from +x, y down).
 */
export function toScreenOrEdge(camera: Camera, v: Vec3, width: number, height: number, inset: number): { at: [number, number]; on: boolean; angle: number } {
  const shown = toScreen(camera, v, width, height);
  if (shown) return { at: shown, on: true, angle: 0 };
  at.set(v[0], v[1], v[2]).applyMatrix4(camera.matrixWorldInverse);
  let dx = at.x, dy = -at.y;
  const n = Math.hypot(dx, dy);
  if (n < 1e-9 * Math.max(1, Math.abs(at.z))) { dx = 0; dy = 1; } else { dx /= n; dy /= n; }
  const hw = Math.max(1, width / 2 - inset), hh = Math.max(1, height / 2 - inset);
  const k = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return { at: [width / 2 + dx * k, height / 2 + dy * k], on: false, angle: Math.atan2(dy, dx) };
}
