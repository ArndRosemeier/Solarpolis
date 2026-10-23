import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, toWorld } from '../src/blueprint';
import { terrainOf } from './worlds';
import { baysOfHamlet, underOf } from '../src/gen/under';
import { levelsOf } from '../src/gen/underLevels';
import { furnishedBays, underHousesIn, underTilesFor } from '../src/gen/underMesh';
import { FURNITURE_CAPACITY, HOME_MODES, homeFittings } from '../src/gen/homeInterior';

test('home furniture: drawn with the rooms of mid and near tiles, never with a far tile', () => {
  const t = terrainOf('reference'), u = underOf(t.habitat);
  const bay = [...baysOfHamlet(u, u.hamlets[0], 8)].find(({ i, j }) => u.useAt(i, j) === 'home')!;
  const near = { level: 0, i: bay.i, j: bay.j }, mid = { level: 1, i: bay.i - (bay.i % 2), j: bay.j - (bay.j % 2) };
  const far = { level: 2, i: bay.i - (bay.i % 4), j: bay.j - (bay.j % 4) };
  assert.equal(furnishedBays(t, [near]).get(`${bay.i}/${bay.j}`)?.level, 'near');
  assert.equal(furnishedBays(t, [mid]).get(`${bay.i}/${bay.j}`)?.level, 'mid');
  assert.equal(furnishedBays(t, [far]).size, 0, 'a far tile builds no rooms, so it has no furniture');
});

for (const { name } of MATRIX) test(`home furniture (${name}): the pool holds every home the mid and near tiles round an eye furnish`, () => {
  const t = terrainOf(name), h = t.habitat, u = underOf(h), lv = levelsOf(t), hr = h.params.landmarks!.handrail;
  const pieces = new Map<string, number>();
  const piecesIn = (i: number, j: number): number => {
    const key = `${i}/${j}`;
    let n = pieces.get(key);
    if (n === undefined) {
      n = underHousesIn(t, i, j).houses.reduce((a, house) => a + house.storeys * homeFittings(house, hr, 0, HOME_MODES[0]).length, 0);
      pieces.set(key, n);
    }
    return n;
  };
  let most = 0;
  // In the biggest hamlet, where its homes stand thickest: over its wellhead (its homes in a ring round it) and among them.
  const biggest = u.hamlets.reduce((a, b) => (b.households > a.households ? b : a));
  const home = [...baysOfHamlet(u, biggest, 8)].find(({ i, j }) => u.useAt(i, j) === 'home')!;
  for (const { i, j } of [biggest, home]) {
    const c = u.centreOf(i, j), eye = toWorld(h.profile, { theta: c.theta, s: c.s, h: lv.levelAt(c.theta, c.s).floor + 1.6 });
    const drawn = underTilesFor(t, eye).filter((w) => w.leaf).map((w) => w.key);
    let n = 0;
    for (const bay of furnishedBays(t, drawn).values()) n += piecesIn(bay.i, bay.j);
    most = Math.max(most, n);
  }
  assert.ok(most > 0, 'homes are furnished round an eye in a hamlet');
  assert.ok(most <= FURNITURE_CAPACITY / 2, `${most} pieces at most, the pool holds ${FURNITURE_CAPACITY}`);
});
