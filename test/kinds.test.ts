import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standIn } from '@futuremagic/stage';
import { allKinds, outsideKinds, standInAttribute } from '../src/render/materials';

test('kinds: every material kind gets a warm-up stand-in with all its attributes (else the Stage stops the view)', () => {
  for (const kind of [...allKinds(), ...outsideKinds()]) {
    const mesh = standIn(kind, standInAttribute);
    for (const name of kind.attributes) assert.ok(mesh.geometry.getAttribute(name), `${kind.name}: ${name}`);
  }
});

test('kinds: no kind needs more than WebGPU\'s 8 vertex buffers, or its pipeline never builds', () => {
  for (const kind of [...allKinds(), ...outsideKinds()]) {
    const mesh = standIn(kind, standInAttribute);
    // Each attribute is a buffer of its own, except interleaved ones, which share theirs.
    const buffers = new Set(Object.values(mesh.geometry.attributes).map((a) => ('data' in a && a.data ? a.data : a)));
    assert.ok(buffers.size <= 8, `${kind.name}: ${buffers.size} vertex buffers`);
  }
});
