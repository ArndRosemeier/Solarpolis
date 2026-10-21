/** Ships at the spindle (src/space/traffic.ts) and their blueprints (src/space/ship.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, exteriorDistance } from '../src/blueprint';
import { DOCK_SPEED, REFERENCE_SPACE, SHIP_DESIGN, berthOf, deriveShip, makeSpace, shipAt, shipShape, slotLength, trafficAt, visitIn, visitsAt } from '../src/space';

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

  test(`traffic (${name}): a ship moves smoothly from its torch to the berth and back, nose on the collar while berthed`, () => {
    for (const v of visits.slice(0, 3)) {
      const L = v.ship.length, shape = shipShape(v.ship), { collar } = berthOf(h, v.arm);
      let last = shipAt(h, v, v.from)!;
      const dt = (v.to - v.from) / 1500;
      for (let t = v.from; t <= v.to; t += dt) {
        const s = shipAt(h, v, t)!;
        const moved = v3len(v3sub(s.position, last.position)), fast = Math.max(Math.abs(s.speed), Math.abs(last.speed));
        // The stern moves with the ship and, while it turns, swings by a share of its length per step.
        assert.ok(moved <= fast * dt * 1.01 + L * 0.15 + 1e-6, `${v.id} at ${t - v.from} s: jumped ${moved.toFixed(2)} m at ${fast.toFixed(2)} m/s (${s.phase})`);
        assert.ok(Math.abs(v3len(s.forward) - 1) < 1e-9 && Math.abs(v3dot(s.forward, s.up)) < 1e-9);
        if (s.phase === 'berthed') assert.ok(v3len(v3sub(v3add(s.position, v3scale(s.forward, L)), collar)) < 1e-6, `${v.id}: nose on the collar`);
        if (s.phase === 'final') assert.ok(Math.abs(s.speed) <= DOCK_SPEED + 1e-9);
        if (s.throttle > 0) {
          // The plume's tip stays outside the keep-out distance from the habitat's centre.
          const tip = v3sub(s.position, v3scale(s.forward, shape.plumeLength)), centre: Vec3 = [0, 0, h.length / 2];
          assert.ok(v3len(v3sub(tip, centre)) >= x.radius * h.params.exterior.keepOut * (1 - 1e-9), `${v.id}: exhaust inside the keep-out`);
        }
        // No part of the ship's axis is inside the habitat.
        for (let k = 0; k <= 8; k++) {
          const q = v3add(s.position, v3scale(s.forward, (L * k) / 8));
          assert.ok(exteriorDistance(x, q) > -1e-6, `${v.id} at ${t - v.from} s: inside the hull`);
        }
        last = s;
      }
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
