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
