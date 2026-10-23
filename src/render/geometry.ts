/**
 * The one way to turn arrays into an indexed mesh geometry. Every kind's meshes are indexed (the index is part of the
 * shader's cache key, @futuremagic/stage), and each attribute is named as its kind lists it (materials.ts).
 */
import { BufferAttribute, BufferGeometry, type DataTexture, InstancedBufferGeometry, InterleavedBufferAttribute, Matrix4, Mesh, type InstancedInterleavedBuffer, type Material } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import type { Vec3 } from '@futuremagic/core';
import type { Mat3 } from '../space';
import { Shape, type MappedArrays } from '../gen/shapes';

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

/** A shape's geometry as the one shape of an instanced geometry (its instances' attributes are the kind's to add). */
export function instancedOf(shape: BufferGeometry): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  for (const [name, a] of Object.entries(shape.attributes)) g.setAttribute(name, a);
  g.setIndex(shape.index);
  return g;
}

export type { RGB } from '../gen/shapes';

/** A mesh drawn wherever it is: instanced or placed by its shader, so its geometry's bounds say nothing of where it shows. */
export function drawnAnywhere(geometry: BufferGeometry, material: Material, name: string): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

/** Send the first `n` instances (`stride` floats each) of an instance buffer to the GPU this frame: only those. */
export function sendInstances(buffer: InstancedInterleavedBuffer, n: number, stride: number): void {
  buffer.needsUpdate = true;
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, Math.max(1, n) * stride);
}

/** One quad drawn once per instance (the SPECK kind): its corners (±1), placed by the shader; positions all zero. */
export function quadInstances(): InstancedBufferGeometry {
  return instancedOf(meshGeometry(new Uint32Array([0, 1, 2, 0, 2, 3]), { position: [new Float32Array(12), 3], corner: [new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2] }));
}

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

/** What the renderer has put on the GPU (its own bookkeeping, `info.memoryMap`, three r186), if it keeps it. */
const uploadedOf = (renderer: Stage['renderer']): WeakMap<object, unknown> | undefined => (renderer.info as unknown as { memoryMap?: WeakMap<object, unknown> }).memoryMap;

/**
 * Let go of the arrays of a mesh's geometry the GPU already holds its own copy of (the renderer uploads an attribute the
 * first time it draws or compiles the mesh, and never reads the array again unless the attribute changes). Only for
 * geometry that never changes and is never read on the CPU: streamed tiles, the far specks' instances. The counts stay,
 * so drawing is unchanged. An attribute not uploaded yet (one no shader of the mesh reads), and those named in `keep`
 * (ones that still change), are kept. Interleaved attributes let go of their shared buffer once. Returns the bytes let go.
 *
 * Whether an attribute is uploaded is read from the renderer's own bookkeeping (`info.memoryMap`, three r186; an
 * interleaved buffer is booked under the first of its attributes uploaded); if that is not there, nothing is let go.
 */
export function dropUploaded(mesh: Mesh, renderer: Stage['renderer'], keep: readonly string[] = []): number {
  const uploaded = uploadedOf(renderer);
  if (!uploaded) return 0;
  const g = mesh.geometry, named = Object.entries(g.attributes).filter(([name]) => !keep.includes(name)).map(([, a]) => a);
  let bytes = 0;
  for (const a of [...named, g.index]) {
    if (a instanceof InterleavedBufferAttribute) {
      const shared = a.data;
      if (!shared.array.length || !named.some((b) => b instanceof InterleavedBufferAttribute && b.data === shared && uploaded.has(b))) continue;
      bytes += shared.array.byteLength;
      shared.array = new (shared.array.constructor as new (n: number) => typeof shared.array)(0);
      continue;
    }
    if (!(a instanceof BufferAttribute) || !uploaded.has(a) || !a.array.length) continue;
    bytes += a.array.byteLength;
    const Typed = a.array.constructor as new (n: number) => BufferAttribute['array'];
    a.array = new Typed(0);
  }
  return bytes;
}

/**
 * Let go of a data texture's pixels once the GPU has them (`dropUploaded`'s way for a texture drawn once and never
 * changed): three uploads a texture the first time a drawn or compiled shader binds it and reads its data again only
 * when its version changes. Returns the bytes let go, or 0 while it is not uploaded yet (call again a frame later).
 */
export function dropUploadedTexture(t: DataTexture, renderer: Stage['renderer']): number {
  const uploaded = uploadedOf(renderer), data = t.image.data;
  if (!uploaded?.has(t) || !data?.length) return 0;
  t.image.data = new (data.constructor as new (n: number) => typeof data)(0);
  return data.byteLength;
}

/**
 * A static mesh's arrays onto the GPU now, and off the CPU: prepared while visible (three's compile skips hidden
 * objects), so the renderer uploads them, then hidden (until its view draws it) with the CPU's copies let go
 * (`dropUploaded`). Returns the bytes let go.
 */
export async function uploadStatic(stage: Stage, mesh: Mesh): Promise<number> {
  await stage.prepare(mesh);
  mesh.visible = false;
  return dropUploaded(mesh, stage.renderer);
}

/** A named mesh placed by `setPose` (its matrix set directly, never from its position and rotation). */
export function posedMesh(geometry: BufferGeometry, material: Material, name: string): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  m.matrixAutoUpdate = false;
  return m;
}

/** The geometry of built things (the BUILT and VAULT kinds): a shape's arrays with its uvs and finishes, and the light baked per vertex (`glow`, VAULT's) if given. */
export const builtGeometry = (a: MappedArrays, glow?: Float32Array): BufferGeometry => arraysGeometry(a, { uv: [a.uvs, 2], finish: [a.finishes, 1], ...(glow ? { glow: [glow, 2] as const } : {}) });

/** A frame's axes (its x, y, z as the world's) as `setPose` takes them. */
export const axesOf = (p: { ex: Vec3; ey: Vec3; ez: Vec3 }): Mat3 => [p.ex[0], p.ey[0], p.ez[0], p.ex[1], p.ey[1], p.ez[1], p.ex[2], p.ey[2], p.ez[2]];

/** The one way to pose a mesh: its matrix from axes (columns: its own axes in the scene) and an origin relative to the eye. */
export function setPose(mesh: Mesh, a: Mat3, o: Vec3): void {
  mesh.matrix.copy(new Matrix4().set(a[0], a[1], a[2], o[0], a[3], a[4], a[5], o[1], a[6], a[7], a[8], o[2], 0, 0, 0, 1));
  mesh.matrixWorldNeedsUpdate = true;
}
