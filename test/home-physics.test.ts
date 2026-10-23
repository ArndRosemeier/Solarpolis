import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld } from '../src/blueprint';
import { terrainOf } from './worlds';
import { Shape, floorPoint, solidOnFloor, type FloorFrame } from '../src/gen/shapes';
import { houseSolid } from '../src/gen/homeMesh';
import { homePlan } from '../src/gen/homeInterior';
import type { House } from '../src/gen/homes';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';

for (const { name } of MATRIX) test(`domestic physics (${name}): an actual staircase climbs to the next storey`, async () => {
  const h = terrainOf(name).habitat, hr = h.params.landmarks!.handrail;
  const frame: FloorFrame = { theta: 0, s: (h.profile.floorStart + h.profile.floorEnd) / 2, height: 0, heading: 0 };
  const house: House = { body: { x0: -4, x1: 4, y0: -7, y1: 7 }, plot: { x0: -5, x1: 5, y0: -8, y1: 9 }, base: 0, storeys: 2, storey: 4 * hr, door: 1, era: 'return', build: 'panel', lived: true, seed: 1 };
  const sh = new Shape(8, false), levels = () => ({ floor: 0, springing: 12, ceiling: 20 });
  houseSolid(sh, house, levels, hr);
  const st = homePlan(house, hr).stair, x = (st.x0 + st.x1) / 2;
  const solid = solidOnFloor(h, frame, sh), origin = floorPoint(h, frame, [0, 0, 0]);
  for (let k = 0; k < solid.positions.length; k++) solid.positions[k] -= origin[k % 3];
  const world = await PhysicsWorld.create(h);
  world.setGround({ ...solid, theta: 0, s: frame.s, origin, size: 64, below: true, trunks: new Float32Array() });
  const body = world.addCharacter(floorPoint(h, frame, [x, st.y0 - 0.4, 0.05]));
  let highest = 0;
  for (let k = 0; k < 120 * 12; k++) {
    body.stride.walk = [0, 1.3, 0]; world.advance(PHYSICS_STEP);
    highest = Math.max(highest, fromWorld(h.profile, ...body.feet()).h);
  }
  world.dispose();
  assert.ok(highest > house.storey - 0.1, `reached ${highest} of ${house.storey} m`);
});

test('domestic physics: retracting furniture lowers its real collision surface and can be removed', async () => {
  const h = terrainOf('reference').habitat;
  const frame: FloorFrame = { theta: 0, s: (h.profile.floorStart + h.profile.floorEnd) / 2, height: 0, heading: 0 };
  const sh = new Shape(4, false);
  sh.faceToward([-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0], [0, 0, 1]);
  const solid = solidOnFloor(h, frame, sh), origin = floorPoint(h, frame, [0, 0, 0]);
  for (let k = 0; k < solid.positions.length; k++) solid.positions[k] -= origin[k % 3];
  const world = await PhysicsWorld.create(h);
  world.setGround({ ...solid, theta: 0, s: frame.s, origin, size: 64, below: true, trunks: new Float32Array() });
  const surface = (height: number): void => world.setFurniture([{ centre: floorPoint(h, frame, [0, 0, height / 2]), size: [3, 3, height], rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2] }]);
  const settle = (): number => {
    for (let k = 0; k < 120 * 3; k++) world.advance(PHYSICS_STEP);
    return fromWorld(h.profile, ...world.states()[0].position).h;
  };
  surface(1);
  world.addBall(floorPoint(h, frame, [0, 0, 2]), [0, 0, 0], 0.1);
  assert.ok(Math.abs(settle() - 1.1) < 0.04, 'supported by the deployed surface');
  surface(0.1);
  assert.ok(Math.abs(settle() - 0.2) < 0.04, 'follows the retracted surface');
  world.setFurniture([]);
  assert.ok(Math.abs(settle() - 0.1) < 0.04, 'no invisible furniture left behind');
  world.dispose();
});

