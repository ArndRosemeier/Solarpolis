// The opening's glints over the whole MATRIX (design "First Light", boot/scene.ts): every habitat of the ring a lit
// point once its drum's look is made. Slow (a second): the fast suite checks one size (test/firstLight.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../../src/blueprint';
import { OpeningSky, PLANET_POINTS } from '../../src/boot/scene';
import { spaceOf } from '../worlds';

for (const { name } of MATRIX) {
  test(`opening glints (${name}): every habitat a point, some lit, all finite`, () => {
    const sky = new OpeningSky(spaceOf(name));
    assert.ok(sky.prepareRing());
    const s = sky.stateAt(0, 1600, 900, Infinity);
    assert.equal(s.points.length, sky.space.habitats.length + PLANET_POINTS);
    assert.ok(s.points.every((p) => p.flux.every((f) => Number.isFinite(f) && f >= 0)));
    assert.ok(s.points.some((p) => Math.max(...p.flux) > 0));
  });
}
