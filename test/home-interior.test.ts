import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three/webgpu';
import { MATRIX } from '../src/blueprint';
import { terrainOf } from './worlds';
import { baysOfHamlet, underOf } from '../src/gen/under';
import { bayFrame, underHousesIn, underStandAt } from '../src/gen/underMesh';
import { HOME_MODES, homeFittings, homePlan, homeUseAt } from '../src/gen/homeInterior';
import { houseShape, houseSolid } from '../src/gen/homeMesh';
import { floorAt, Shape } from '../src/gen/shapes';
import { FINISH } from '../src/gen/pavilion';

for (const { name } of MATRIX) test(`home interiors (${name}): entry stays open, fittings fit and stow, all floors connect`, () => {
  const t = terrainOf(name), h = t.habitat, u = underOf(h), hr = h.params.landmarks!.handrail;
  const bay = [...baysOfHamlet(u, u.hamlets[0], 8)].find(({ i, j }) => u.useAt(i, j) === 'home' && underHousesIn(t, i, j).houses.length)!;
  const homes = underHousesIn(t, bay.i, bay.j);
  for (const house of homes.houses) {
    const p = homePlan(house, hr);
    const inside = floorAt(h, bayFrame(u, bay.i, bay.j), p.doorX, p.doorY - house.door * hr);
    assert.ok(underStandAt(t, inside.theta, inside.s) >= house.base, 'player starts on the home floor, not beneath its plinth');
    for (let floor = 0; floor < house.storeys; floor++) for (const mode of HOME_MODES) {
      const parts = homeFittings(house, hr, floor, mode);
      for (const f of parts) {
        assert.ok(f.centre.every(Number.isFinite) && f.size.every((v) => v > 0));
        assert.ok(f.centre[0] - f.size[0] / 2 > p.room.x0 && f.centre[0] + f.size[0] / 2 < p.stair.x0, 'fittings clear walls and circulation stair');
        assert.ok(f.centre[1] - f.size[1] / 2 > p.room.y0 && f.centre[1] + f.size[1] / 2 < p.room.y1, 'within the room');
        if (mode === 'clear') assert.ok(f.size[2] < 0.005, 'fully stowed');
      }
    }
    if (house.lived) assert.deepEqual(Array.from({ length: 4 }, (_, k) => homeUseAt(house, k * 100, 100)).sort(), [...HOME_MODES].sort());
    for (const detail of ['far', 'mid', 'near', 'solid'] as const) {
      const shape = new Shape(8, true, true);
      if (detail === 'solid') houseSolid(shape, house, homes.at, hr);
      else houseShape(shape, house, homes.at, hr, detail);
      const start = new Vector3(p.doorX, p.doorY + house.door * hr * 0.5, house.base + hr * 1.5);
      const ray = new Ray(start, new Vector3(0, -house.door, 0));
      const point = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < shape.idx.length; i += 3) {
        a.fromArray(shape.pos, shape.idx[i] * 3); b.fromArray(shape.pos, shape.idx[i + 1] * 3); c.fromArray(shape.pos, shape.idx[i + 2] * 3);
        if (ray.intersectTriangle(a, b, c, false, point)) assert.ok(point.distanceTo(start) > hr, `${detail}: an open human-height passage`);
      }
      if (detail === 'near') assert.ok(shape.fin.includes(FINISH.domestic), 'real display surfaces');
    }
  }
});
