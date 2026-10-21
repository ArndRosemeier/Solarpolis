/**
 * The one way to turn arrays into an indexed mesh geometry. Every kind's meshes are indexed (the index is part of the
 * shader's cache key, @futuremagic/stage), and each attribute is named as its kind lists it (materials.ts).
 */
import { BufferAttribute, BufferGeometry, Matrix4, type Mesh } from 'three/webgpu';
import type { Vec3 } from '@futuremagic/core';
import type { Mat3 } from '../space';
import { Shape } from '../gen/shapes';

/** An indexed geometry from named attributes: each one its data and its item size. Absent ones are left out. */
export function meshGeometry(index: Uint32Array, attributes: Record<string, readonly [Float32Array, number] | undefined>): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(attributes)) if (a) g.setAttribute(name, new BufferAttribute(a[0], a[1]));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

export type { RGB } from '../gen/shapes';

/**
 * Meshes made of surfaces of revolution, boxes and the other parts of `Shape` (gen/shapes.ts): the habitats from
 * outside (hull.ts), ships (ship.ts), drones. With `colored`, every vertex carries an albedo (the HARDWARE kind).
 */
export class ShapeBuilder extends Shape {
  build(): BufferGeometry {
    const a = this.arrays();
    return meshGeometry(a.index, { position: [a.positions, 3], normal: [a.normals, 3], color: a.colors ? [a.colors, 3] : undefined });
  }
}

/** The one way to pose a mesh: its matrix from axes (columns: its own axes in the scene) and an origin relative to the eye. */
export function setPose(mesh: Mesh, a: Mat3, o: Vec3): void {
  mesh.matrix.copy(new Matrix4().set(a[0], a[1], a[2], o[0], a[3], a[4], a[5], o[1], a[6], a[7], a[8], o[2], 0, 0, 0, 1));
  mesh.matrixWorldNeedsUpdate = true;
}
