/**
 * The one way to turn arrays into an indexed mesh geometry. Every kind's meshes are indexed (the index is part of the
 * shader's cache key, @futuremagic/stage), and each attribute is named as its kind lists it (materials.ts).
 */
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

/** An indexed geometry from named attributes: each one its data and its item size. Absent ones are left out. */
export function meshGeometry(index: Uint32Array, attributes: Record<string, readonly [Float32Array, number] | undefined>): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(attributes)) if (a) g.setAttribute(name, new BufferAttribute(a[0], a[1]));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}
