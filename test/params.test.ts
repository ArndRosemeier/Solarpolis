import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitatFromUrl, habitatToUrl, presetOf } from '../src/app/params';
import { MATRIX, REFERENCE } from '../src/blueprint';

test('url: no query is the reference, a preset name picks from the matrix', () => {
  assert.deepEqual(habitatFromUrl(new URLSearchParams('')), REFERENCE);
  assert.equal(presetOf(new URLSearchParams('habitat=large')).name, 'large');
  assert.equal(habitatFromUrl(new URLSearchParams('habitat=nope')).radius, REFERENCE.radius);
});

test('url: overrides apply on top of the preset, and bad numbers are ignored', () => {
  const p = habitatFromUrl(new URLSearchParams('habitat=small&R=250&g=0.5&au=x&endon=1'));
  const small = MATRIX.find((m) => m.name === 'small')!.params;
  assert.equal(p.radius, 250);
  assert.equal(p.length, small.length);
  assert.ok(Math.abs(p.floorGravity - 0.5 * 9.80665) < 1e-9);
  assert.equal(p.sunDistanceAu, small.sunDistanceAu);
  assert.equal(p.axisOrientation, 'end-on');
});

test('url: a habitat goes to a short link and comes back the same', () => {
  const p = habitatFromUrl(new URLSearchParams('habitat=long&R=2500&seed=7'));
  const q = habitatToUrl('long', p);
  assert.equal(q, 'habitat=long&R=2500&seed=7');
  assert.deepEqual(habitatFromUrl(new URLSearchParams(q)), p);
  assert.equal(habitatToUrl('reference', REFERENCE), '');
});
