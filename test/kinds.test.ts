import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standIn } from '@futuremagic/stage';
import * as materials from '../src/render/materials';
import { allKinds, outsideKinds, standInAttribute } from '../src/render/materials';

test('kinds: every material kind gets a warm-up stand-in with all its attributes (else the Stage stops the view)', () => {
  for (const kind of [...allKinds(), ...outsideKinds()]) {
    const mesh = standIn(kind, standInAttribute);
    for (const name of kind.attributes) assert.ok(mesh.geometry.getAttribute(name), `${kind.name}: ${name}`);
  }
});

test('kinds: every kind the registry exports is warmed up by a view (a kind left out builds on first draw, or stops the view)', () => {
  const warmed = new Set([...allKinds(), ...outsideKinds()]);
  const isKind = (v: unknown): v is { name: string; attributes: unknown; make: unknown } =>
    !!v && typeof v === 'object' && Array.isArray((v as { attributes?: unknown }).attributes) && typeof (v as { make?: unknown }).make === 'function';
  const kinds = Object.entries(materials).filter(([, v]) => isKind(v));
  assert.ok(kinds.length >= warmed.size, 'finds the exported kinds');
  for (const [name, k] of kinds) assert.ok(warmed.has(k as never), `${name} is in allKinds() or outsideKinds()`);
});

test('kinds: no kind needs more than WebGPU\'s 8 vertex buffers, or its pipeline never builds', () => {
  for (const kind of [...allKinds(), ...outsideKinds()]) {
    const mesh = standIn(kind, standInAttribute);
    // Each attribute is a buffer of its own, except interleaved ones, which share theirs.
    const buffers = new Set(Object.values(mesh.geometry.attributes).map((a) => ('data' in a && a.data ? a.data : a)));
    assert.ok(buffers.size <= 8, `${kind.name}: ${buffers.size} vertex buffers`);
  }
});
