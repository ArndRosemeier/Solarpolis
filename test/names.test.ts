import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, toWorld, type Vec3 } from '../src/blueprint';
import { entrancesOf, planOf } from '../src/gen/plan';
import { groundUnder, nameUnder, Namer, personNamed, shownOf, type Nameable } from '../src/link';
import { oneOf } from '../src/link/names';
import { ecologyOf, habitatOf, terrainOf } from './worlds';

const ball = (key: string, at: Vec3, radius = 0.5): Nameable => ({ key, at, radius, name: key });
const EYE: Vec3 = [0, 0, 0], AHEAD: Vec3 = [1, 0, 0];

test('names: the nearest thing on the ray, never one behind the ground or the eye', () => {
  const things = [ball('far', [40, 0, 0]), ball('near', [10, 0.3, 0]), ball('off', [5, 3, 0]), ball('behind', [-5, 0, 0])];
  assert.equal(nameUnder(EYE, AHEAD, things)?.key, 'near');
  assert.equal(nameUnder(EYE, AHEAD, things, 8), null, 'the ground hides both');
  assert.equal(nameUnder(EYE, AHEAD, [ball('around', [1, 0, 0], 3)]), null, 'the eye inside it: one is there');
});

test('names: a small thing far off is still easy to rest the pointer on', () => {
  // A person 300 m off, the pointer a metre and a half beside their middle: within the pointer's own size there.
  assert.equal(nameUnder(EYE, AHEAD, [ball('person', [300, 1.5, 0], 0.5)])?.key, 'person');
  assert.equal(nameUnder(EYE, AHEAD, [ball('person', [300, 6, 0], 0.5)]), null);
});

test('names: the ray meets a flat floor where it should, and the sky never', () => {
  const height = (p: Vec3): number => p[2] + 2;
  const down = Math.SQRT1_2, t = groundUnder([0, 0, 0], [down, 0, -down], height, 1000);
  assert.ok(t !== null && Math.abs(t - 2 * Math.SQRT2) < 0.06, `met at ${t}`);
  const far = groundUnder([0, 0, 0], [Math.cos(0.01), 0, -Math.sin(0.01)], height, 1000);
  assert.ok(far !== null && Math.abs(far - 2 / Math.sin(0.01)) < 3, `a skimming ray still lands near 200 m: ${far}`);
  assert.equal(groundUnder([0, 0, 0], [0, 0, 1], height, 1000), null);
});

test('names: people show what they choose, and never what they are', () => {
  const h = habitatOf(MATRIX[0].name), n = 3000, { name, pursuits } = h.params.life.talk.shares;
  const shown = Array.from({ length: n }, (_, i) => shownOf(h, i));
  const none = shown.filter((s) => s === 'none').length / n, all = shown.filter((s) => s === 'all').length / n;
  assert.ok(Math.abs(none - (1 - name)) < 0.03, `keep their name: ${none}`);
  assert.ok(Math.abs(all - name * pursuits) < 0.04, `share what they care about: ${all}`);
  for (let i = 0; i < 400; i++) {
    const p = personNamed(h, i), words = `${p.name} ${p.detail ?? ''}`.toLowerCase();
    assert.ok(!/\b(mind|human|shell|drone|robot|ai)\b/.test(words), `${i}: ${words}`);
    assert.deepEqual(personNamed(h, i), p, 'the same every time');
    if (shown[i] === 'none') assert.equal(p.name, 'Someone');
  }
});

test('names: one of a scattered kind', () => {
  assert.equal(oneOf('fallen oaks'), 'Fallen oak');
  assert.equal(oneOf('oak branches'), 'Oak branch');
  assert.equal(oneOf('boulders'), 'Boulder');
  assert.equal(oneOf('moss'), 'Moss');
});

for (const { name } of MATRIX) {
  test(`names (${name}): looking down on a court names it, and open land by what grows there`, () => {
    const t = terrainOf(name), h = t.habitat, namer = new Namer(t, ecologyOf(name)), plan = planOf(h);
    const sites = entrancesOf(plan);
    assert.ok(sites.length > 0);
    const site = sites[0], i = 0;
    const over = toWorld(h.profile, { theta: site.theta, s: site.s, h: t.standAt(site.theta, site.s) + 40 });
    const foot = toWorld(h.profile, { theta: site.theta, s: site.s, h: t.standAt(site.theta, site.s) });
    const len = Math.hypot(foot[0] - over[0], foot[1] - over[1], foot[2] - over[2]);
    const down: Vec3 = [(foot[0] - over[0]) / len, (foot[1] - over[1]) / len, (foot[2] - over[2]) / len];
    const court = namer.name(over, down, []);
    assert.equal(court?.name, `Court ${i + 1}`, `${JSON.stringify(court)}`);
    assert.ok(court && Math.abs(court.distance - 40) < 0.5, `${court?.distance}`);
    // Somewhere away from every place: the ground is named (a biome, water or snow), never nothing.
    const s = h.profile.length * 0.37, theta = 2.1;
    const eye = toWorld(h.profile, { theta, s, h: t.standAt(theta, s) + 300 }), floor = toWorld(h.profile, { theta, s, h: t.standAt(theta, s) });
    const l = Math.hypot(floor[0] - eye[0], floor[1] - eye[1], floor[2] - eye[2]);
    const land = namer.name(eye, [(floor[0] - eye[0]) / l, (floor[1] - eye[1]) / l, (floor[2] - eye[2]) / l], []);
    assert.ok(land && land.name.length > 0 && land.distance > 0, JSON.stringify(land));
    // People passed in are named before the ground behind them.
    const someone: Nameable = { key: 'p', at: [(over[0] + foot[0]) / 2, (over[1] + foot[1]) / 2, (over[2] + foot[2]) / 2], radius: 0.5, name: 'Ilse' };
    assert.equal(namer.name(over, down, [someone])?.name, 'Ilse');
  });
}
