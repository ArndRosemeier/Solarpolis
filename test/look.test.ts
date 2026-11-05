import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLook, readLook, writeLook } from '../src/persist/look';

test('look: a kept look reads back as it was written; anything else is no look', () => {
  const kept = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  try {
    assert.equal(readLook(), null, 'none kept yet');
    const look = { body: { gender: 0.3, height: 0.7 }, outfit: ['tunic', 'boots'], hair: 'braid' };
    writeLook(look);
    assert.deepEqual(readLook(), look);
    writeLook(null);
    assert.equal(readLook(), null, 'forgotten');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
  for (const bad of ['', 'not json', '[1,2]', '42', 'null', '{"outfit":[]}', '{"body":1}', '{"body":null}']) assert.equal(parseLook(bad), null, bad);
  assert.equal(readLook(), null, 'no storage: no look');
});
