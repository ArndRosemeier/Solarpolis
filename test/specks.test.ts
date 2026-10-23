import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { DYES, MEAN_HEIGHT, POSE, SLOT, SPECK_ATTRIBUTES, SPECK_STRIDE, guessBands, hexColor, packColor, speckBands, unpackColor, writeSpeck } from '../src/gen/standIn';
import { SWIM_DEPTH, SWIM_WATER, footingOf, postureOf, residentOf, type Person } from '../src/sim';
import { REFERENCE } from '../src/blueprint';
import { habitatOf, terrainOf } from './worlds';
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
    const p0: Person = { resident: 0, theta: 0, s: 0, heading: 0, moving: false, speed: 0, activity: 'meet', court: 0, outing: 0, member: 0, size: 1, act: 'quiet', posture: POSE.upright, from: POSE.upright, since: 0 };
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
    const still = at(dry, { moving: false, activity: 'picnic', posture: postureOf('picnic') });
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

  test(`footing (${name}): someone in a drone body hovers at the eyes of those they are with, over land or water`, () => {
    const terrain = terrainOf(name), h = terrain.habitat;
    let i = 0;
    while (residentOf(h, i).body !== 'drone') i++;
    const body = 0.5, base: Person = { resident: i, theta: 0, s: h.profile.floorStart + 0.3 * (h.profile.floorEnd - h.profile.floorStart), heading: 0, moving: false, speed: 0, activity: 'meet', court: 0, outing: 0, member: 0, size: 1, act: 'quiet', posture: POSE.upright, from: POSE.upright, since: 0 };
    const middle = (p: Person, deck: number | null = null): number => footingOf(terrain, p, deck, body).h + body / 2;
    const ground = terrain.standAt(base.theta, base.s), standing = middle(base) - ground;
    assert.ok(Math.abs(standing - 0.93 * MEAN_HEIGHT) < 1e-9, `at a standing person's eyes: ${standing.toFixed(2)} m`);
    assert.ok(middle({ ...base, posture: POSE.kneel }) - ground < standing && middle({ ...base, posture: POSE.lie }) - ground < middle({ ...base, posture: POSE.kneel }) - ground, 'lower beside those sitting, lower still beside those lying');
    assert.equal(middle({ ...base, moving: true, speed: 1 }) - ground, standing, 'flying along at the height of the faces');
    assert.equal(footingOf(terrain, base, null, body).swim, false);
    assert.ok(Math.abs(middle(base, ground + 3) - (ground + 3 + standing)) < 1e-9, 'over a deck, from the deck');
  });
}

test('residents: a share wears drone bodies, one of the bodies each; the shells stay as they were', () => {
  const h = habitatOf(MATRIX[0].name), life = REFERENCE.life, n = 20000, seen = new Set<number>();
  let drones = 0, shells = 0;
  for (let i = 0; i < n; i++) {
    const r = residentOf(h, i);
    if (r.body === 'drone') { drones++; seen.add(r.design); assert.ok(Number.isInteger(r.design) && r.design >= 0 && r.design < life.drones.bodies); } else assert.equal(r.design, -1);
    if (r.body === 'shell') shells++;
  }
  assert.ok(Math.abs(drones / n - life.drones.persons) < 0.01, `${drones} of ${n}`);
  assert.ok(Math.abs(shells / n - life.shells) < 0.01, `${shells} shells of ${n}`);
  assert.equal(seen.size, life.drones.bodies, 'every body is worn');
});

test('specks (small): everyone up on the land, in key order, standing where the near levels stand them', () => {
  checkSpecks('small', MATRIX.find((m) => m.name === 'small')!.params.day.length);
});
