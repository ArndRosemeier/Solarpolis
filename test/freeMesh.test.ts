/**
 * Giving a mesh up for good (`freeMesh`, render/geometry.ts). three's WebGPU renderer keeps a render object for every
 * mesh it has drawn or compiled until the mesh itself is disposed; disposing only the geometry leaked every streamed
 * tile and cell (Arnd, 2026-10-21: 0.4 GB to 5 GB in two minutes near the endcap). The renderer's own RenderObjects is
 * used here with stub parts, so a three upgrade that changes this shows up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
// @ts-expect-error: three's internal module has no types
import RenderObjects from 'three/src/renderers/common/RenderObjects.js';
import { freeMesh } from '../src/render/geometry';

/** The renderer's book of render objects, with stubs for the parts a render object only touches when drawn. */
function book(): { held: () => number; see: (m: Mesh) => void } {
  const renderer = { contextNode: { id: 1, version: 0 }, _currentSourceMaterial: null };
  const nodes = { delete() {}, getCacheKey: () => 0 };
  const ros = new RenderObjects(renderer, nodes, {}, { delete() {} }, { deleteForRender() {} }, {});
  const scene = new Scene(), camera = new PerspectiveCamera(), lights = {}, context = {};
  return {
    held: () => ros._renderObjects.size,
    see: (m) => { ros.get(m, m.material, scene, camera, lights, context, null, 'default'); },
  };
}

function geometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('plant', new BufferAttribute(new Float32Array(4), 4));
  g.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return g;
}

/** Which geometries were disposed. */
function disposals(...gs: BufferGeometry[]): Set<BufferGeometry> {
  const seen = new Set<BufferGeometry>();
  for (const g of gs) g.addEventListener('dispose', () => seen.add(g));
  return seen;
}

test('freeMesh: the renderer lets go of the mesh (disposing the geometry alone does not)', () => {
  const r = book(), material = new MeshBasicNodeMaterial();
  const a = new Mesh(geometry(), material), b = new Mesh(geometry(), material);
  r.see(a);
  r.see(b);
  assert.equal(r.held(), 2);
  b.geometry.dispose();
  assert.equal(r.held(), 2, 'three still holds a mesh whose geometry alone was disposed');
  freeMesh(a);
  freeMesh(b);
  assert.equal(r.held(), 0);
});

test('freeMesh: out of its parent, and only its own geometry freed', () => {
  const scene = new Scene(), shared = geometry(), own = geometry(), part = geometry();
  const freed = disposals(shared, own, part);
  const material = new MeshBasicNodeMaterial();
  const a = new Mesh(own, material), b = new Mesh(shared, material), c = new Mesh(part, material);
  scene.add(a, b, c);
  const position = part.getAttribute('position'), index = part.index;
  freeMesh(a);
  freeMesh(b, 'none');
  freeMesh(c, (name) => name === 'plant');
  assert.equal(scene.children.length, 0);
  assert.ok(freed.has(own) && freed.has(part) && !freed.has(shared));
  assert.equal(shared.getAttribute('position').count, 3, 'a shared geometry is left whole');
  // A shape's attributes and index, shared by other cells, were taken off before the cell's own were freed.
  assert.deepEqual(Object.keys(part.attributes), ['plant']);
  assert.equal(part.index, null);
  assert.ok(position && index);
});
