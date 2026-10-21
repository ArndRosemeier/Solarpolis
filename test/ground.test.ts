import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIMATES, FLOOR_LAYERS } from '../src/blueprint';
import { GROUND_LAYERS, groundLayer } from '../src/gen/groundTex';

const SIZE = 64; // small: the layers draw the same features at any size, just with fewer texels

test('ground: one drawn layer per floor layer, in the same order', () => {
  assert.deepEqual(GROUND_LAYERS.map((l) => l.name), [...FLOOR_LAYERS]);
  for (const l of GROUND_LAYERS) assert.ok(12 % l.W === 0, `${l.name}: its tile (${l.W} m) divides the 12 m mapping period`);
});

test('ground: every biome says what its floor is made of', () => {
  for (const b of Object.values(CLIMATES).flatMap((c) => c.biomes)) {
    const name = b.name;
    const shares = Object.values(b.floor) as number[];
    assert.ok(shares.length > 0 && shares.every((x) => x >= 0) && shares.some((x) => x > 0), name);
  }
});

GROUND_LAYERS.forEach(({ name }, i) => test(`ground (${name}): deterministic, tiles without a seam, averages to a plausible colour`, () => {
  const a = groundLayer(i, SIZE), b = groundLayer(i, SIZE);
  assert.equal(a.albedo.length, SIZE * SIZE * 4);
  assert.equal(a.normal.length, SIZE * SIZE * 4);
  assert.deepEqual(a.albedo, b.albedo, `${name}: same albedo twice`);
  assert.deepEqual(a.normal, b.normal, `${name}: same relief twice`);
  for (const c of a.mean) assert.ok(c > 0.002 && c < 0.6, `${name}: mean ${a.mean}`);
  // Across the wrap, neighbouring texels differ no more than neighbours inside the tile do.
  const step = (x0: number, x1: number): number => {
    let d = 0;
    for (let y = 0; y < SIZE; y++) for (let c = 0; c < 3; c++) d += Math.abs(a.albedo[(y * SIZE + x0) * 4 + c] - a.albedo[(y * SIZE + x1) * 4 + c]);
    return d;
  };
  let inside = 0;
  for (let x = 0; x < SIZE - 1; x++) inside += step(x, x + 1);
  inside /= SIZE - 1;
  assert.ok(step(SIZE - 1, 0) < inside * 2.5 + 1, `${name}: seam ${step(SIZE - 1, 0)} vs ${inside}`);
}));
