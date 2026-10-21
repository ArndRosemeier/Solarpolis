/**
 * The one way to turn arrays into an indexed mesh geometry. Every kind's meshes are indexed (the index is part of the
 * shader's cache key, @futuremagic/stage), and each attribute is named as its kind lists it (materials.ts).
 */
import { BufferAttribute, BufferGeometry, Matrix4, type Mesh } from 'three/webgpu';
import type { Vec3 } from '@futuremagic/core';
import type { Mat3 } from '../space';
import { Shape } from '../gen/shapes';

/** An indexed geometry from named attributes: each one its data and its item size. Absent ones are left out. */
export function meshGeometry(index: Uint32Array, attributes: Record<string, readonly [Float32Array | Uint8Array, number] | undefined>): BufferGeometry {
  const g = new BufferGeometry();
  // Bytes are shares 0 … 255, read as 0 … 1 (normalized).
  for (const [name, a] of Object.entries(attributes)) if (a) g.setAttribute(name, new BufferAttribute(a[0], a[1], a[0] instanceof Uint8Array));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** A built shape's arrays (gen/shapes.ts `arrays()`, or a worker's tile) as a geometry: colours when it has them. */
export function arraysGeometry(a: { positions: Float32Array; normals: Float32Array; colors?: Float32Array | null; index: Uint32Array }): BufferGeometry {
  return meshGeometry(a.index, { position: [a.positions, 3], normal: [a.normals, 3], color: a.colors ? [a.colors, 3] : undefined });
}

export type { RGB } from '../gen/shapes';

/**
 * Meshes made of surfaces of revolution, boxes and the other parts of `Shape` (gen/shapes.ts): the habitats from
 * outside (hull.ts), ships (ship.ts), drones. With `colored`, every vertex carries an albedo (the HARDWARE kind).
 */
export class ShapeBuilder extends Shape {
  build(): BufferGeometry {
    return arraysGeometry(this.arrays());
  }
}

/**
 * What of a mesh's geometry is its own to free: all of it, none of it (a geometry other meshes draw too), or the
 * attributes a test picks (the rest, and the index, are shared with other meshes and stay).
 */
export type Owned = 'all' | 'none' | ((attribute: string) => boolean);

/**
 * The one way to give up a mesh for good: out of its parent, its own geometry's buffers freed, and the mesh itself
 * disposed. The last step is the one that matters most: three's WebGPU renderer keeps a record of every mesh it has
 * drawn or compiled (its render objects, with their bind groups and uniform buffers, held through the material's
 * listeners) until the mesh itself is disposed. Disposing only the geometry kept every streamed tile and cell alive,
 * arrays and all, for as long as their material lived: for the shared kinds, forever.
 */
export function freeMesh(mesh: Mesh, owned: Owned = 'all'): void {
  mesh.removeFromParent();
  const g = mesh.geometry;
  if (typeof owned === 'function') {
    for (const name of Object.keys(g.attributes)) if (!owned(name)) g.deleteAttribute(name);
    g.setIndex(null);
  }
  if (owned !== 'none') g.dispose();
  mesh.dispose();
}

/** The one way to pose a mesh: its matrix from axes (columns: its own axes in the scene) and an origin relative to the eye. */
export function setPose(mesh: Mesh, a: Mat3, o: Vec3): void {
  mesh.matrix.copy(new Matrix4().set(a[0], a[1], a[2], o[0], a[3], a[4], a[5], o[1], a[6], a[7], a[8], o[2], 0, 0, 0, 1));
  mesh.matrixWorldNeedsUpdate = true;
}
