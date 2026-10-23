import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshStandardMaterial } from 'three/webgpu';
import type { MeshData } from '@actors/core';
import { SCREEN_TEXTURE_SIZE } from '@actors/three';
import { isScreen, plainCloth, screenFabrics } from '../src/render/actors/screens';

test('actor screens: a screen garment is made as plain cloth from a copy, and lit from a shared phase that moves', () => {
  const def = { name: 'future-mantle', tags: ['fabric:screen', 'covers:anatomy'] };
  const data = { def } as unknown as MeshData;
  assert.ok(isScreen(data) && !isScreen({ def: { name: 'jeans', tags: ['fabric:denim'] } } as unknown as MeshData));
  const plain = plainCloth(data);
  assert.deepEqual(plain.def.tags, ['fabric:smooth', 'covers:anatomy']);
  assert.deepEqual(def.tags, ['fabric:screen', 'covers:anatomy'], "the pack's own mesh stays a screen");
  const a = new MeshStandardMaterial({ color: 0x80c0ff }), b = new MeshStandardMaterial({ color: 0x80c0ff });
  screenFabrics.adopt(a);
  screenFabrics.adopt(b);
  assert.ok(a.emissiveMap && b.emissiveMap && a.emissiveMap !== b.emissiveMap, 'two screens, two phases');
  assert.ok(a.emissive.getHex() > 0 && a.color.r < 0.1, 'a dark backing that glows in its colour');
  const pixels = (a.emissiveMap.image as { data: Uint8Array }).data, before = pixels.slice();
  assert.equal(pixels.length, SCREEN_TEXTURE_SIZE * SCREEN_TEXTURE_SIZE * 4);
  screenFabrics.advance(0.5);
  assert.notDeepEqual(pixels, before, 'the aurora moves');
  assert.equal(screenFabrics.textureBytes(), 4 * SCREEN_TEXTURE_SIZE * SCREEN_TEXTURE_SIZE * 4 * 2);
  a.dispose();
  b.dispose();
});
