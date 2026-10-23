import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { baysOf } from '../src/gen/bays';
import { hallAt } from '../src/gen/halls';
import type { Terrain } from '../src/gen/terrain';
import { baysOfHamlet, underOf, type BayUse } from '../src/gen/under';
import { ROOM_BEDS, floorBelow, roomAt, roomBedsAt, throughDeck } from '../src/sim/rooms';
import { soundscapeAt, type Listener } from '../src/sim/sounds';
import { humOf, STAGE, stagesNear } from '../src/sim/sources';
import { ecologyOf } from './worlds';

/** A listener standing below in bay (i, j)'s middle. */
function below(t: Terrain, i: number, j: number): Listener {
  const c = baysOf(t.habitat).centreOf(i, j), floor = floorBelow(t, c.theta, c.s);
  return { theta: c.theta, s: c.s, h: floor + 1.7, ground: floor, below: true, speed: 0 };
}

/** The first bay of a use round the first hamlet (out to 12 bays), nearest first. */
function find(t: Terrain, use: BayUse, kind?: string): { i: number; j: number } | null {
  const u = underOf(t.habitat), m = u.hamlets[0];
  for (const b of baysOfHamlet(u, m, 12)) if (u.useAt(b.i, b.j) === use && (!kind || hallAt(t.habitat, b.i, b.j) === kind)) return b;
  return null;
}

for (const { name } of MATRIX) {
  test(`rooms (${name}): the echo follows the room's size and stuff: a home short, a hall longer, the pillar forest long`, () => {
    const t = ecologyOf(name).terrain;
    const at = (use: BayUse): number | null => { const b = find(t, use); return b ? roomAt(t, below(t, b.i, b.j)).t60 : null; };
    // A lane is open pillar forest, as the Dim is.
    const home = at('home'), hall = at('hall'), lane = at('lane');
    assert.ok(home !== null && hall !== null && lane !== null, 'a home, a hall and a lane round the first hamlet');
    assert.ok(home > 0.2 && home < hall && hall < lane, `home ${home} s < hall ${hall} s < lane ${lane} s`);
    assert.ok(lane > 2 && lane < 30, `the pillar forest's echo ${lane} s`);
  });

  test(`rooms (${name}): a court echoes more the deeper one stands in it, and none on the open land`, () => {
    const t = ecologyOf(name).terrain, c = t.courts[0];
    const ear = (ground: number): Listener => ({ theta: c.theta, s: c.s, h: ground + 1.7, ground, below: false, speed: 0 });
    const floor = roomAt(t, ear(c.floor)), rim = roomAt(t, ear(c.floor + c.depth));
    assert.ok(floor.wet > 0.2 && rim.wet < floor.wet, `wet ${floor.wet} on the floor, ${rim.wet} at the rim`);
    assert.ok(floor.t60 > 0.05 && floor.t60 < 3, `a court's echo ${floor.t60} s`);
    const away = roomAt(t, { theta: c.theta + Math.PI, s: c.s, h: 1.7, ground: 0, below: false, speed: 0 });
    assert.equal(away.wet, 0);
  });

  test(`rooms (${name}): below, each hall is heard at it, a home inside it, the court above through the light well`, () => {
    const e = ecologyOf(name), t = e.terrain, u = underOf(t.habitat), m = u.hamlets[0];
    const kitchen = find(t, 'hall', 'kitchen');
    if (kitchen) assert.ok(roomBedsAt(t, below(t, kitchen.i, kitchen.j)).kitchen > 0.9, 'in a kitchen hall');
    const home = find(t, 'home')!;
    const inHome = roomBedsAt(t, below(t, home.i, home.j));
    assert.ok(inHome.home > 0.9);
    for (const b of ROOM_BEDS) assert.ok(inHome[b] >= 0 && inHome[b] <= 1, b);
    const well = below(t, m.i, m.j);
    assert.ok(throughDeck(t, well) > 0 && throughDeck(t, below(t, home.i, home.j)) === 0);
    const noon = (t.habitat.params.day.length * t.habitat.params.day.daylight) / 2;
    const scape = soundscapeAt(e, noon, well);
    assert.ok(scape.through > 0 && scape.room.wet > 0, 'the wellhead hears the court above, and echoes');
    const stages = stagesNear(t, well.theta, well.s);
    for (const s of stages) assert.equal(humOf(s)?.sound, STAGE);
  });
}
