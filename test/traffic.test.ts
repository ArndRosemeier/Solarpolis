/** Ships at the spindle (src/space/traffic.ts) and their blueprints (src/space/ship.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, exteriorDistance } from '../src/blueprint';
import { DOCK_SPEED, FINAL_LENGTHS, REFERENCE_SPACE, SHIP_DESIGN, beforeBerth, berthOf, deriveShip, guestShip, guestVisit, makeSpace, shipAt, shipShape, slotLength, trafficAt, visitIn, visitsAt, type ShipNow } from '../src/space';

for (const { name, params } of MATRIX) {
  const space = makeSpace({ ...REFERENCE_SPACE, home: params }), home = space.home, h = home.habitat, x = h.exterior;
  const tp = space.params.traffic, P = slotLength(h, tp), seed = space.params.seed;
  const visits = Array.from({ length: 4 }, (_, n) => Array.from({ length: x.spindle.berthArms }, (_, arm) => visitIn(h, home.id, seed, tp, arm, n))).flat().filter((v) => v !== null);

  test(`traffic (${name}): each arm has at most one visit at a time, inside its slot; ships fit the berth`, () => {
    assert.ok(visits.length >= x.spindle.berthArms, `${visits.length} visits in 4 slots`);
    for (const v of visits) {
      const n = Number(v.id.split('/').pop());
      assert.ok(n * P <= v.from && v.from < v.docked && v.docked < v.undocked && v.undocked < v.to && v.to <= (n + 1) * P, v.id);
      const d = v.ship.drive === 'torch' ? SHIP_DESIGN.torch : SHIP_DESIGN.sail, arm = x.spindle.arms.length;
      assert.ok(v.ship.length >= arm * d.length[0] && v.ship.length <= arm * d.length[1], `${v.id}: ${v.ship.length} m`);
    }
    assert.deepEqual(visitIn(h, home.id, seed, tp, 2, 1), visitIn(h, home.id, seed, tp, 2, 1));
    for (let t = 0; t < 2 * P; t += P / 37) {
      const arms = visitsAt(h, home.id, seed, tp, t).map((v) => v.arm);
      assert.equal(new Set(arms).size, arms.length);
    }
  });

  test(`traffic (${name}): a ship moves smoothly nose first from its torch to the berth and back, mating straight along the arm`, () => {
    for (const v of visits.slice(0, 3)) {
      const L = v.ship.length, shape = shipShape(v.ship), { collar, radial } = berthOf(h, v.arm);
      const mid = (s: ShipNow): Vec3 => v3add(s.position, v3scale(s.forward, L / 2));
      const dt = 1;
      // Each second of the way in and out (the stay at the berth between is still).
      for (const [t0, t1] of [[v.from, v.docked + 5], [v.undocked - 5, v.to]]) {
        let last = shipAt(h, v, t0)!, step = 0;
        for (let t = t0 + dt; t <= t1; t += dt, step++) {
          const s = shipAt(h, v, t)!, arriving = t < v.docked;
          const moved = v3len(v3sub(mid(s), mid(last))), fast = Math.max(Math.abs(s.speed), Math.abs(last.speed));
          assert.ok(moved <= fast * dt * 1.01 + 1e-6, `${v.id} at ${t - v.from} s: jumped ${moved.toFixed(2)} m at ${fast.toFixed(2)} m/s (${s.phase})`);
          const turned = Math.acos(Math.min(1, v3dot(s.forward, last.forward)));
          assert.ok(turned <= 0.2, `${v.id} at ${t - v.from} s: turned ${turned.toFixed(2)} rad in a second (${s.phase})`);
          assert.ok(Math.abs(v3len(s.forward) - 1) < 1e-9 && Math.abs(v3dot(s.forward, s.up)) < 1e-9);
          if (s.phase === 'berthed') assert.ok(v3len(v3sub(v3add(s.position, v3scale(s.forward, L)), collar)) < 1e-6, `${v.id}: nose on the collar`);
          // The last stretch in (and the first out) is straight along the arm, the nose on the arm's line.
          if (s.phase === 'final') {
            assert.ok(Math.abs(s.speed) <= DOCK_SPEED + 1e-9 && v3dot(s.forward, radial) < -1 + 1e-9);
            const off = v3sub(mid(s), collar);
            assert.ok(v3len(v3sub(off, v3scale(radial, v3dot(off, radial)))) < 1e-6, `${v.id}: off the arm's line`);
          }
          // Coasting down the corridor while slowing, and leaving, the ship flies nose first.
          if (s.phase === 'coast' && last.phase === 'coast') {
            if (!arriving) assert.ok(s.forward[2] > 1 - 1e-9, `${v.id}: leaves nose first`);
            else if (Math.abs(s.speed) < Math.abs(last.speed)) assert.ok(s.forward[2] < -1 + 1e-9, `${v.id}: comes in nose first`);
          }
          if (s.throttle > 0) {
            // The plume's tip stays outside the keep-out distance from the habitat's centre.
            const tip = v3sub(s.position, v3scale(s.forward, shape.plumeLength)), centre: Vec3 = [0, 0, h.length / 2];
            assert.ok(v3len(v3sub(tip, centre)) >= x.radius * h.params.exterior.keepOut * (1 - 1e-9), `${v.id}: exhaust inside the keep-out`);
          }
          // No part of the ship's axis is inside the habitat (every few seconds).
          if (s.phase !== 'berthed' && step % 8 === 0) for (let k = 0; k <= 8; k++) {
            const q = v3add(s.position, v3scale(s.forward, (L * k) / 8));
            assert.ok(exteriorDistance(x, q) > -1e-6, `${v.id} at ${t - v.from} s: inside the hull`);
          }
          last = s;
        }
      }
    }
  });

  test(`traffic (${name}): the passenger's ship has its berth to itself from when it is first shown`, () => {
    const ship = guestShip(space, home), lead = beforeBerth(h, ship, x.radius);
    assert.equal(ship.drive, 'torch');
    for (const after of [1000, 0.7 * P, 2.2 * P]) {
      const g = guestVisit(space, home, after, lead);
      assert.deepEqual(guestVisit(space, home, after, lead), g);
      assert.ok(g.docked >= after + lead && g.docked < after + lead + 3 * P);
      for (let t = g.docked - lead; t <= g.docked + 3600; t += 37) {
        const ships = trafficAt(space, home, t, g), arms = ships.map((s) => s.visit.arm);
        assert.equal(new Set(arms).size, arms.length, `${name}: two ships at one arm`);
        // Every scheduled ship shown now was there just before: nothing appears or vanishes for the guest's sake.
        const scheduled = new Set(trafficAt(space, home, t).map((s) => s.visit.id));
        for (const s of ships) assert.ok(s.visit === g || scheduled.has(s.visit.id));
        assert.ok(ships.some((s) => s.visit === g));
      }
      const s = shipAt(h, g, g.docked + 10)!;
      assert.equal(s.phase, 'berthed');
      assert.ok(v3len(v3sub(v3add(s.position, v3scale(s.forward, ship.length)), berthOf(h, g.arm).collar)) < 1e-6);
      // First shown coasting down its corridor, at most an outer radius up it.
      const shown = shipAt(h, g, g.docked - lead)!, standOff = FINAL_LENGTHS * ship.length;
      assert.ok(shown.phase === 'coast' && shown.out > standOff && shown.out <= standOff + x.radius * (1 + 1e-9), `${shown.phase} ${shown.out} m out`);
    }
  });

  test(`traffic (${name}): a few ships are at the spindle at any time`, () => {
    let berthed = 0, n = 0;
    for (let t = 0; t < 3 * P; t += P / 50, n++) berthed += trafficAt(space, home, t).filter((s) => s.phase === 'berthed').length;
    assert.ok(berthed / n > 1 && berthed / n < x.spindle.berthArms, `${(berthed / n).toFixed(2)} berthed on average`);
  });
}

test('ships: torch ships and sail freighters, every size from the berth, shapes within their length', () => {
  const drives = new Set<string>();
  for (let k = 0; k < 40; k++) {
    for (const berth of [20, 120, 300]) {
      const p = deriveShip(k, berth), s = shipShape(p);
      drives.add(p.drive);
      assert.deepEqual(deriveShip(k, berth), p);
      assert.ok(p.drive === 'sail' ? p.thrust === 0 && s.plumeLength === 0 : p.thrust > 5 && s.plumeLength > p.length);
      for (const q of s.parts) {
        const [a, b] = q.shape === 'box' ? [q.center[0] - q.half[0], q.center[0] + q.half[0]] : [q.from, q.to];
        assert.ok(a >= -1e-9 && b <= p.length + 1e-9, `${p.drive} part ${q.role} from ${a} to ${b} of ${p.length}`);
      }
    }
  }
  assert.deepEqual([...drives].sort(), ['sail', 'torch']);
});
