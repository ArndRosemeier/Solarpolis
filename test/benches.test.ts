import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { courtFloorOf } from '../src/gen/courts';
import { landmarkTopAt } from '../src/gen/landmarks';
import { POSE, SEAT_FEET, SEAT_HIPS } from '../src/gen/standIn';
import { feetOf, floorGap, footingOf, peopleAt, residentOf, venuesOf, type Person } from '../src/sim';
import { SIT_BACK } from '../src/world/mount';
import { terrainOf } from './worlds';

const HOUR = 3600;

for (const { name, params } of MATRIX) {
  test(`benches (${name}): residents on the seat round a court's light well sit on it, feet on the paving`, () => {
    const t = terrainOf(name), h = t.habitat, v = venuesOf(h), f = courtFloorOf(h, v.courts[0].size);
    if (!f) return;
    const sitting: { p: Person; r: number; out: number }[] = [];
    for (const hours of [4, 8, 12]) {
      for (let k = 0; k < v.courts.length; k += Math.max(1, Math.floor(v.courts.length / 8))) {
        const c = v.courts[k], ring = Math.max(1, h.profile.at(c.s).r);
        for (const p of peopleAt(h, 3 * params.day.length + hours * HOUR, { theta: c.theta, s: c.s, radius: c.size })) {
          if (p.activity !== 'bench' || p.moving || p.court !== k) continue;
          let dt = p.theta - c.theta;
          dt -= 2 * Math.PI * Math.round(dt / (2 * Math.PI));
          const x = dt * ring, y = p.s - c.s;
          // How far they face out from the court's middle (1: straight out).
          sitting.push({ p, r: Math.hypot(x, y), out: (x * Math.sin(p.heading) + y * Math.cos(p.heading)) / Math.max(1e-9, Math.hypot(x, y)) });
        }
      }
    }
    assert.ok(sitting.length > 0, 'nobody on a seat');
    let seated = 0;
    for (const { p, r, out } of sitting) {
      const seatEdge = courtFloorOf(h, v.courts[p.court].size)!.seat;
      assert.ok(out > 0.99, `facing out from the seat (${out.toFixed(3)})`);
      const onSeat = Math.abs(r - (seatEdge - SEAT_HIPS)) < 0.02, before = Math.abs(r - (seatEdge - SEAT_HIPS + SIT_BACK)) < 0.02;
      assert.ok(onSeat || before, `hips ${(seatEdge - r).toFixed(2)} m in from the seat's edge: neither on it nor standing in front of it`);
      if (onSeat && p.posture === POSE.kneel) seated++;
      // The feet on the paving in front of it (as every level asks what is built under them), never up on the seat's top.
      const [ft, fs] = feetOf(h, p), paving = landmarkTopAt(t, ft, fs);
      assert.ok(Math.abs(floorGap(h.radius, ft, fs, p.theta, p.s) - (SEAT_HIPS + SEAT_FEET)) < 0.01, 'feet out in front of the hips');
      // (One whose body is a drone hovers at the faces of those beside them.)
      assert.ok(paving !== null, 'no paving under the feet');
      if (residentOf(h, p.resident).body !== 'drone') assert.ok(Math.abs(footingOf(t, p, paving, 1.7).h - paving) < 1e-9, 'feet on the paving');
      if (onSeat) {
        const seat = landmarkTopAt(t, p.theta, p.s)!;
        assert.ok(seat - paving > 0.2, `hips over the seat, ${(seat - paving).toFixed(2)} m over the feet`);
      }
    }
    assert.ok(seated > sitting.length / 2, `${seated} of ${sitting.length} at a seat sit on it`);
  });
}
