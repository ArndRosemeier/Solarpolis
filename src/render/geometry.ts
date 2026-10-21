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

/**
 * A built shape's arrays (gen/shapes.ts `arrays()`, or a worker's tile) as a geometry: colours when it has them, and
 * any `more` attributes its kind lists.
 */
export function arraysGeometry(a: { positions: Float32Array; normals: Float32Array; colors?: Float32Array | null; index: Uint32Array }, more: Record<string, readonly [Float32Array | Uint8Array, number]> = {}): BufferGeometry {
  return meshGeometry(a.index, { position: [a.positions, 3], normal: [a.normals, 3], color: a.colors ? [a.colors, 3] : undefined, ...more });
}

export type { RGB } from '../gen/shapes';

/**
 * Points of light drawn as stars are (the STARS kind): `n` quads, each a direction (position), a flux (color) and its
 * four corners (corner, ±1). The far form of anything below a pixel: neighbours' glints, drones, ships.
 */
export function pointsGeometry(n: number): { geometry: BufferGeometry; position: Float32Array; color: Float32Array } {
  const position = new Float32Array(n * 12), color = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8), index = new Uint32Array(n * 6), corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < n; i++) {
    corner.set(corners, i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  return { geometry: meshGeometry(index, { position: [position, 3], color: [color, 3], corner: [corner, 2] }), position, color };
}

/** After `setPoint`s: upload the points' new directions and fluxes. */
export function pointsChanged(m: Mesh): void {
  m.geometry.attributes.position.needsUpdate = true;
  m.geometry.attributes.color.needsUpdate = true;
}

/** Point i of a `pointsGeometry`: `far` out along the unit direction `dir`, with this flux (relative to the Sun's) in each channel. */
export function setPoint(position: Float32Array, color: Float32Array, i: number, dir: Vec3, far: number, flux: Vec3 | number): void {
  const f: Vec3 = typeof flux === 'number' ? [flux, flux, flux] : flux;
  for (let v = 0; v < 4; v++) {
    for (let a = 0; a < 3; a++) {
      position[i * 12 + v * 3 + a] = dir[a] * far;
      color[i * 12 + v * 3 + a] = f[a];
    }
  }
}

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
