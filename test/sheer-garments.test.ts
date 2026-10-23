import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@actors/core';
import { keepSkinUnderSheerGarment } from '../src/render/actors/pack';

test('sheer stockings keep the underlying body; opaque garments retain their coverage', () => {
  for (const name of ['stockings', 'fishnet-stockings', 'trousers', 'shift-dress']) {
    const coverage = new Uint32Array([10, 11, 12]);
    const data = { def: { name }, hidesBaseVertices: coverage } as unknown as MeshData;
    keepSkinUnderSheerGarment(data);
    assert.equal(data.hidesBaseVertices, name.includes('stockings') ? undefined : coverage);
  }
});
