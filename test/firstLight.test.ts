// The opening (design "First Light"): what its worker draws, frame by frame, over the whole MATRIX; and the page's
// first paint naming the game as the title card does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v3dot, v3len } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { OpeningSky, PLANET_POINTS, behindDisc, packPoints } from '../src/boot/scene';
import { UNIFORM_VEC4S } from '../src/boot/shaders';
import { spaceOf } from './worlds';

const finite = (v: readonly number[]): boolean => v.every(Number.isFinite);

for (const { name } of MATRIX) {
  test(`opening sky (${name}): Earth in frame and lit, a steady exposure, the planets as points`, () => {
    const sky = new OpeningSky(spaceOf(name));
    const w = 1600, h = 900;
    const first = sky.stateAt(0, w, h, Infinity);
    for (const v of [first.right, first.up, first.forward, first.sunDir, first.earth.dir, first.moon.dir]) {
      assert.ok(finite(v) && Math.abs(v3len(v) - 1) < 1e-9, `${name}: unit axes`);
    }
    // Earth inside the frame, a few degrees across.
    assert.ok(v3dot(first.earth.dir, first.forward) > Math.cos(Math.atan(first.tanHalf)), `${name}: Earth in frame`);
    assert.ok(first.earth.sin > 0.05 && first.earth.sin < 0.15, `${name}: Earth ${first.earth.sin}`);
    assert.ok(first.exposure > 0 && Number.isFinite(first.starExposure) && first.starExposure > 0, `${name}: exposure`);
    // Before the drums' looks are made (between frames, prepareRing) there are no glints, only the planets.
    assert.equal(first.points.length, PLANET_POINTS, `${name}: no glints yet`);
    assert.equal(sky.prepareRing(() => true), false, `${name}: nothing made when the frame has no time`);
    // The eyes adapt slowly: a second later the exposure has hardly moved.
    const later = sky.stateAt(1, w, h, 1);
    assert.ok(Math.abs(Math.log(later.exposure / first.exposure)) < 0.5, `${name}: exposure steady`);
  });
}

// Making every drum's look takes a second over the MATRIX: the glints for one habitat size here, all in test/slow.
test('opening sky (small): every habitat a glint once the ring is ready, packed for the shader', () => {
  const sky = new OpeningSky(spaceOf('small'));
  assert.ok(sky.prepareRing());
  const s = sky.stateAt(0, 1600, 900, Infinity);
  assert.equal(s.points.length, sky.space.habitats.length + PLANET_POINTS);
  assert.ok(s.points.every((p) => finite(p.flux) && p.flux.every((f) => f >= 0)));
  assert.ok(s.points.some((p) => Math.max(...p.flux) > 0), 'some glint lit');
  const packed = new Float32Array(s.points.length * 8);
  packPoints(s.points, packed);
  assert.ok(finite(Array.from(packed)));
});

test('behindDisc: only directions inside the disc and in front of the eye', () => {
  const disc = { dir: [0, 0, 1] as [number, number, number], sin: 0.1 };
  assert.ok(behindDisc([0, 0.05, Math.sqrt(1 - 0.0025)], disc));
  assert.ok(!behindDisc([0, 0.2, Math.sqrt(1 - 0.04)], disc));
  assert.ok(!behindDisc([0, 0, -1], disc));
});

test('the uniform block is a whole number of vec4s, as the WGSL struct reads it', () => {
  assert.ok(Number.isInteger(UNIFORM_VEC4S) && UNIFORM_VEC4S >= 16);
});

test('the page paints the name and line the title card shows', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const title = readFileSync(new URL('../src/app/title.ts', import.meta.url), 'utf8');
  const line = /'title-line', '([^']+)'/.exec(title)?.[1];
  assert.ok(line, 'the title card has a line');
  assert.ok(html.includes(`<p class="title-line">${line}</p>`), 'index.html shows the same line');
  assert.ok(html.includes('<h1>Solarpolis</h1>'));
});
