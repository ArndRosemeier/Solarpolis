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
