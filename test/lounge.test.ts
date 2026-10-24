/** The lounge under a ship's nose and the cabin shot's view of it (src/space/lounge.ts), over the matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3cross, v3dot, v3norm, v3scale, v3sub } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { ARRIVAL_SHOTS, CABIN_FOV, LOUNGE, arrival, cabinCamera, chooseStart, deriveShip, loungeOf, placesInView, seatedPlace, shipShape, sunOnSeated, throughWindow, windowFacing, windowLight, type Lounge } from '../src/space';
import { loungeGeometry } from '../src/render/lounge';
import { windingOk } from './meshChecks';
import { spaceOf } from './worlds';

const around = (p: readonly number[]): number => Math.atan2(p[2], p[1]);
const off = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

for (const { name } of MATRIX) {
  test(`lounge (${name}): the ship's own panoramic windows, couches facing them clear of the core, the camera behind them`, () => {
    const h = spaceOf(name).home.habitat, berth = h.exterior.spindle.arms.length;
    let seen = 0;
    for (let k = 1; k <= 4; k++) {
      const shape = shipShape(deriveShip(k * 7907, berth, 'torch')), l = loungeOf(shape);
      if (!l) continue;
      seen++;
      // Every window the room has is one the hull shows from outside, at the same height and angle.
      const glass = shape.parts.filter((q) => q.shape === 'shell' && q.arc && Math.abs(q.from - (l.floor + l.windows.sill)) < 1e-9 && Math.abs(q.to - (l.floor + l.windows.sill + l.windows.high)) < 1e-9);
      assert.equal(glass.length, l.windows.count, `${name}: ${glass.length} windows outside, ${l.windows.count} inside`);
      for (const q of glass) {
        if (q.shape !== 'shell' || !q.arc) continue;
        const mid = (q.arc[0] + q.arc[1]) / 2;
        assert.ok(off(windowFacing(l, [0, Math.cos(mid), Math.sin(mid)]), mid) < 1e-9);
      }
      assert.ok(l.ceiling - l.floor > LOUNGE.eye.high + 0.5 && l.radius < l.hull);
      for (const c of l.couches) for (const p of c.places) {
        const r = Math.hypot(p.at[1], p.at[2]);
        assert.ok(r > l.core + 0.5 && r < l.radius - 0.5, `${name}: a place ${r.toFixed(2)} m out in a room of ${l.radius.toFixed(2)} m`);
        assert.ok(Math.abs(Math.hypot(...p.facing) - 1) < 1e-9 && v3dot(p.facing, [0, p.at[1] / r, p.at[2] / r]) > 0.95, 'facing out');
        assert.ok(p.at[0] > l.floor && p.at[0] < l.floor + 1);
        const under = seatedPlace(l, p), out = Math.hypot(under[1], under[2]);
        assert.ok(under[0] === l.floor && out < r - 0.1 && out > r - LOUNGE.couch.deep + 0.1, 'the hips over the seat, clear of its front and its back');
      }
      // The Sun reaches a couch's sitters through the window they face (at some height of it), never along the axis.
      const sitters = l.couches[0].places, facing = sitters[0].facing;
      const lit = [-0.6, -0.3, 0, 0.3, 0.6].map((up) => sunOnSeated(l, sitters, v3norm(v3add(facing, [up, 0, 0]))));
      assert.ok(Math.max(...lit) > 0, `${name}: no sun on the sitters through their window (${lit.join(', ')})`);
      assert.equal(sunOnSeated(l, sitters, [1, 0, 0]), 0);
      assert.equal(sunOnSeated(l, [], facing), 0);
      // Looking out of any window: the camera stands between the core and the couches, and sees some of them.
      for (let w = 0; w < l.windows.count; w += 5) {
        const look = l.windows.turn + (w * 2 * Math.PI) / l.windows.count, cam = cabinCamera(l, look), r = Math.hypot(cam.eye[1], cam.eye[2]);
        assert.ok(r > l.core && r < l.couches[0].out - LOUNGE.couch.deep / 2, `${name}: the eye ${r.toFixed(2)} m out`);
        assert.ok(off(around(v3sub(cam.target, cam.eye)), look) < 1e-9 && cam.target[0] < cam.eye[0], 'out of the window, a little down');
        const places = placesInView(l, look);
        assert.ok(places.length >= (l.core ? 2 : 1), `${name}: ${places.length} places in view`);
        // Some of the sitters are in a 16:9 frame (their shoulders, 0.6 m over the seat).
        const ahead = v3norm(v3sub(cam.target, cam.eye)), up = v3norm(v3sub([1, 0, 0], v3scale(ahead, ahead[0]))), right = v3cross(ahead, up);
        const half = Math.tan((CABIN_FOV / 2) * (Math.PI / 180)), framed = places.filter((p) => {
          const seat = v3sub(v3add(p.at, [0.6, 0, 0]), cam.eye), along = v3dot(seat, ahead);
          return along > 0 && Math.abs(v3dot(seat, up) / along) < half && Math.abs(v3dot(seat, right) / along) < (half * 16) / 9;
        });
        assert.ok(framed.length >= 1, `${name}: no sitter in the frame`);
        const couchOff = (i: number): number => off(l.couches[i].angle, look);
        assert.ok(places.every((p) => couchOff(places[0].couch) <= couchOff(p.couch) + 1e-9), 'the couch nearest the window first');
      }
    }
    assert.ok(name === 'small' || seen > 0, `${name}: no ship with a lounge`);
  });
}

test('lounge: the cabin shot looks out of a window that faces the port face, while the ship creeps in beside it', () => {
  const space = spaceOf('reference'), a = arrival(space, chooseStart(space, 0) + 40);
  const f = a.at(ARRIVAL_SHOTS[0] + 1)!;
  assert.equal(f.shot, 4);
  const l = loungeOf(shipShape(a.guest.ship))!;
  assert.ok(f.cabin && l.windows.count > 0);
  assert.equal(a.at(ARRIVAL_SHOTS[0] + ARRIVAL_SHOTS[1] - 0.01)!.cabin!.look, f.cabin.look, 'one window the whole shot');
});

/** The reference habitat's arriving ship's lounge. */
function referenceLounge(): Lounge {
  const space = spaceOf('reference');
  return loungeOf(shipShape(arrival(space, chooseStart(space, 0) + 40).guest.ship))!;
}

test('lounge: out of a window from the cabin camera, not through its pillars, its ceiling or its core; the windows\' light from where they look', () => {
  const l = referenceLounge(), step = (2 * Math.PI) / l.windows.count, look = l.windows.turn + 3 * step, eye = cabinCamera(l, look).eye;
  const out = (a: number, up = 0): [number, number, number] => [up, Math.cos(a), Math.sin(a)];
  assert.ok(throughWindow(l, eye, out(look)), 'straight out of the window it looks out of');
  assert.ok(throughWindow(l, eye, out(look, 0.3)), 'a little toward the nose: still the glass');
  const pillar = out(look + step / 2, eye[0]), toPillar = v3sub([pillar[0], pillar[1] * l.radius, pillar[2] * l.radius], eye);
  assert.ok(!throughWindow(l, eye, toPillar), 'at the pillar between two windows');
  assert.ok(!throughWindow(l, eye, [1, 0, 0]) && !throughWindow(l, eye, [-1, 0, 0]), 'the ceiling and the floor');
  if (l.core) assert.ok(!throughWindow(l, eye, out(look + Math.PI)), 'across the room the core is in the way');
  // An even view out lights every way alike; one bright window lights the side facing it.
  const even = windowLight(l, () => 1);
  assert.ok(even.all > 0.05 && even.all < 1 && Math.hypot(...even.toward) < 1e-6 * l.windows.count, `${even.all}`);
  const one = windowLight(l, (d) => (v3dot(d, out(look)) > 0.99 ? 1 : 0));
  assert.ok(one.all > 0 && v3dot(one.toward, out(look)) > 0.99 * one.all);
});

test('lounge geometry: every face turned the way its normal says, all of it inside the hull between the floor and the ceiling', () => {
  for (const l of [referenceLounge()]) {
    const g = loungeGeometry(l);
    for (const m of [g.room, g.lamps]) {
      const pos = m.attributes.position.array as Float32Array;
      const w = windingOk(pos, m.attributes.normal.array as Float32Array, m.index!.array as Uint32Array);
      assert.equal(w.bad, 0, `${m === g.room ? 'room' : 'lamps'}: ${w.bad} of ${w.total} faces turned against their normals`);
      for (let k = 0; k < pos.length; k += 3) {
        assert.ok(Math.hypot(pos[k + 1], pos[k + 2]) <= l.hull + 1e-4 && pos[k] >= l.floor - 1e-4 && pos[k] <= l.ceiling + 1e-4, 'in the room');
      }
    }
  }
});
