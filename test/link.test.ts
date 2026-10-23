import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { choiceMatch, findChoices, pickMarks, type LinkChoice } from '../src/link';
import { toScreenOrEdge } from '../src/render/screen';

const PLACES: LinkChoice[] = [
  { id: 'court-7', title: 'Exit court 7', detail: '900 m · 1 min', group: 'Courts', near: 900 },
  { id: 'court-2', title: 'Exit court 2', detail: '300 m · 40 s', group: 'Courts', near: 300 },
  { id: 'stair', title: 'Lift Stair', detail: '3.2 km · 4 min', group: 'Landmarks', near: 3200 },
  { id: 'grove', title: "The founders' grove", detail: '6 km · 7 min', group: 'Landmarks', near: 6000 },
  { id: 'hut', title: 'Summit hut', group: 'Landmarks' },
];

test('link: every typed word must begin a word of the entry, in any order', () => {
  const stair = PLACES[2];
  assert.ok(choiceMatch(stair, 'lift st') > 0);
  assert.ok(choiceMatch(stair, 'st lift') > 0);
  assert.ok(choiceMatch(stair, 'landmarks') > 0, 'its group counts');
  assert.equal(choiceMatch(stair, 'grove'), 0);
  assert.ok(choiceMatch(stair, '') > 0, 'nothing typed matches all');
  assert.ok(choiceMatch(PLACES[3], 'the') > choiceMatch(PLACES[3], 'grove'), 'a later word of the title ranks below the first');
  assert.ok(choiceMatch(PLACES[3], 'grove') > choiceMatch(PLACES[3], 'km'), 'a word of the detail ranks below the title');
});

test('link: lists keep their groups in order, nearest first in each, and the best match first when typing', () => {
  assert.deepEqual(findChoices(PLACES, '').map((c) => c.id), ['court-2', 'court-7', 'stair', 'grove', 'hut']);
  assert.deepEqual(findChoices(PLACES, 'court 7').map((c) => c.id), ['court-7']);
  assert.deepEqual(findChoices(PLACES, 'grove').map((c) => c.id), ['grove']);
  // 'Summit hut' starts with it, 'Lift Stair' has a word that does, the grove only has an s inside; court 2 by its detail.
  assert.deepEqual(findChoices(PLACES, 's').map((c) => c.id), ['court-2', 'hut', 'stair', 'grove']);
});

test('link: names are picked most important first, never overlapping, at most so many', () => {
  const at: Record<string, [number, number] | null> = { a: [100, 100], b: [120, 105], c: [100, 140], d: null, e: [400, 400] };
  const picked = pickMarks(['a', 'b', 'c', 'd', 'e'], (k) => at[k], 3, [50, 20]);
  assert.deepEqual(picked.map((p) => p.item), ['a', 'c', 'e']);
  assert.deepEqual(pickMarks(['a', 'b', 'c', 'd', 'e'], (k) => at[k], 1, [50, 20]).map((p) => p.item), ['a']);
});

test('link: a mark off screen is pinned inside the edge toward it, one on screen stays where it is', () => {
  const camera = new PerspectiveCamera(60, 2, 0.1, 1000);
  camera.updateMatrixWorld();
  const w = 800, h = 400, inset = 30;
  const ahead = toScreenOrEdge(camera, [0, 0, -10], w, h, inset);
  assert.equal(ahead.on, true);
  assert.deepEqual(ahead.at.map(Math.round), [400, 200]);
  const right = toScreenOrEdge(camera, [100, 0, -10], w, h, inset);
  assert.equal(right.on, false);
  assert.deepEqual(right.at.map(Math.round), [w - inset, 200]);
  assert.ok(Math.abs(right.angle) < 1e-9, 'points right');
  const leftBehind = toScreenOrEdge(camera, [-5, 0, 10], w, h, inset);
  assert.equal(leftBehind.on, false);
  assert.deepEqual(leftBehind.at.map(Math.round), [inset, 200], 'behind and to the left: turn left');
  const above = toScreenOrEdge(camera, [0, 50, -1], w, h, inset);
  assert.deepEqual(above.at.map(Math.round), [400, inset]);
  const straightBehind = toScreenOrEdge(camera, [0, 0, 10], w, h, inset);
  assert.deepEqual(straightBehind.at.map(Math.round), [400, h - inset], 'straight behind: at the bottom');
});
