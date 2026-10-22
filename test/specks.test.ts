import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { DYES, POSE, SLOT, SPECK_ATTRIBUTES, SPECK_STRIDE, guessBands, hexColor, packColor, speckBands, unpackColor, writeSpeck } from '../src/gen/standIn';
import { SWIM_DEPTH, SWIM_WATER, footingOf, postureOf, type Person } from '../src/sim';
import { terrainOf } from './worlds';
import { checkSpecks } from './specksCheck';

test('specks: a colour packs and unpacks; bands of one colour are that colour', () => {
  for (const hex of DYES) {
    const c = hexColor(hex), back = unpackColor(packColor(c));
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - c[k]) < 1e-9);
    const one = packColor(c), bands = speckBands(new Array(Object.keys(SLOT).length).fill(one));
    for (const b of bands) assert.deepEqual(unpackColor(b).map((v) => Math.round(v * 255)), c.map((v) => Math.round(v * 255)));
  }
});

test('specks: a guessed look is the same for the same seed, in the residents\' dyes, a shell in one paint', () => {
  const dyes = new Set(DYES.map((d) => packColor(hexColor(d))));
  for (let look = 0; look < 200; look++) {
    const a = guessBands(look * 7919, false), b = guessBands(look * 7919, false), shell = guessBands(look * 7919, true);
    assert.deepEqual(a, b);
    assert.ok(dyes.has(a[1]) && dyes.has(a[2]), 'top and legs are dyes');
    assert.equal(shell[0], shell[1]);
    for (const v of a) assert.ok(Number.isInteger(v) && v >= 0 && v < 2 ** 24);
  }
});

test('specks: an instance is the four attributes, in order', () => {
  assert.equal(SPECK_ATTRIBUTES.length * 4, SPECK_STRIDE);
  const d = new Float32Array(SPECK_STRIDE * 2);
  writeSpeck(d, SPECK_STRIDE, [1, 2, 3], 1.8, [4, 5, 6], POSE.kneel, [7, 8, 9], [0.1, 0.2], 1.1);
  assert.deepEqual(Array.from(d.slice(SPECK_STRIDE)), Array.from(new Float32Array([1, 2, 3, 1.8, 4, 5, 6, POSE.kneel, 7, 8, 9, 0, 0.1, 0.2, 1.1, 0])));
  assert.ok(d.slice(0, SPECK_STRIDE).every((v) => v === 0), 'writes only its own instance');
});

for (const { name } of MATRIX) {

  test(`footing (${name}): on a deck over water, on the ground, or treading water with the head out`, () => {
    const terrain = terrainOf(name), h = terrain.habitat;
    const p0: Person = { resident: 0, theta: 0, s: 0, heading: 0, moving: false, speed: 0, activity: 'meet', court: 0, outing: 0, member: 0, size: 1 };
    // A dry place and a deep one, along a ring of the floor.
    let dry: [number, number] | null = null, wet: [number, number] | null = null;
    const R = h.radius, { floorStart, floorEnd } = h.profile;
    for (let k = 0; k < 4000 && !(dry && wet); k++) {
      const theta = ((k * 0.618034) % 1) * 2 * Math.PI, s = floorStart + (floorEnd - floorStart) * ((k * 0.7548777) % 1);
      const depth = terrain.standAt(theta, s) - terrain.heightAt(theta, s);
      if (depth <= 0 && !dry) dry = [theta, s];
      if (depth > SWIM_WATER * 2 && !wet) wet = [theta, s];
    }
    assert.ok(dry, `${name}: no dry land found (radius ${R})`);
    const at = (pl: [number, number], over: Partial<Person> = {}): Person => ({ ...p0, theta: pl[0], s: pl[1], ...over });
    const still = at(dry, { moving: false, activity: 'picnic' });
    const ground = footingOf(terrain, still, null, 1.8);
    assert.equal(ground.h, terrain.standAt(dry[0], dry[1]));
    assert.equal(ground.pose, postureOf('picnic'));
    assert.equal(footingOf(terrain, at(dry, { moving: true }), null, 1.8).pose, POSE.upright, 'walking is upright');
    // A deck under them (higher than the ground) is stood on; one lower is not.
    assert.equal(footingOf(terrain, still, ground.h + 2, 1.8).h, ground.h + 2);
    assert.equal(footingOf(terrain, still, ground.h - 2, 1.8).h, ground.h);
    if (!wet) return;
    const surface = terrain.standAt(wet[0], wet[1]), swim = footingOf(terrain, at(wet), null, 1.8);
    assert.ok(swim.swim && Math.abs(swim.h - (surface - SWIM_DEPTH * 1.8)) < 1e-9, 'treads water, head out');
    const bridge = footingOf(terrain, at(wet), surface + 1, 1.8);
    assert.ok(!bridge.swim && bridge.h === surface + 1, 'on a deck over the water, not in it');
  });
}

test('specks (small): everyone up on the land, in key order, standing where the near levels stand them', () => {
  checkSpecks('small', MATRIX.find((m) => m.name === 'small')!.params.day.length);
});
