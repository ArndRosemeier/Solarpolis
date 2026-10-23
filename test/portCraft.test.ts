/** The port's craft (src/space/portCraft.ts): tugs that see ships in and out, inspectors at berthed ships, over the matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3cross, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { INSPECTORS, approachOf, craftShape, inspectorsAt, partSpan, shipAt, shipShape, slotLength, tugCradle, tugLength, tugsAt, visitIn, type ShipNow, type Visit } from '../src/space';
import { spaceOf } from './worlds';

/** How far a point is from a ship's axis, and how far along it (from the stern). */
function offAxis(s: ShipNow, p: Vec3): { across: number; along: number } {
  const d = v3sub(p, s.position), along = v3dot(d, s.forward);
  return { across: v3len(v3sub(d, v3scale(s.forward, along))), along };
}

for (const { name } of MATRIX) {
  const space = spaceOf(name), home = space.home, h = home.habitat, seed = space.params.seed, tp = space.params.traffic;
  const arms = h.exterior.spindle.berthArms, P = slotLength(h, tp);
  const visits = Array.from({ length: 3 }, (_, n) => Array.from({ length: arms }, (_, arm) => visitIn(h, home.id, seed, tp, arm, n))).flat().filter((v): v is Visit => v !== null).slice(0, 3);

  test(`port craft (${name}): every arm's tug sees each ship in and out, beside it and clear of it, and is home between`, () => {
    assert.ok(visits.length > 0);
    // Idle: every tug in its cradle, clear of the spindle and of the arms.
    const idle = tugsAt(h, home.id, seed, [], 0);
    assert.equal(idle.length, arms);
    for (const [arm, c] of idle.entries()) {
      assert.deepEqual(c.position, tugCradle(h, arm).at);
      assert.ok(Math.hypot(c.position[0], c.position[1]) > h.exterior.spindle.radius, 'outside the spindle');
    }
    for (const v of visits) {
      const a = approachOf(h, v.ship), beam = v.ship.beam, L = tugLength(h);
      // Through the final approach, the tug stays beside the ship, off its hull.
      for (let t = v.docked - a.final; t <= v.docked; t += a.final / 20) {
        const s = shipAt(h, v, t)!, tug = tugsAt(h, home.id, seed, [s], t)[v.arm], o = offAxis(s, tug.position);
        assert.ok(o.across >= beam / 2 + L * 0.5, `${v.id}: the tug ${o.across.toFixed(1)} m off the axis of a ${beam.toFixed(1)} m ship`);
        assert.ok(o.along > 0 && o.along < v.ship.length, 'level with the ship');
      }
      // Smooth all through: no jumps between a hundredth of a second apart.
      for (const [t0, t1] of [[v.docked - a.final - a.turn - 200, v.docked + 300], [v.undocked - 300, v.undocked + a.final + a.turn + 200]]) {
        for (let t = t0; t <= t1; t += 7) {
          const tugs = (tt: number) => tugsAt(h, home.id, seed, [shipAt(h, v, Math.min(Math.max(tt, v.from), v.to))!], tt)[v.arm];
          const p = tugs(t), q = tugs(t + 0.01);
          assert.ok(v3len(v3sub(p.position, q.position)) < 2, `${v.id}: jumped at ${(t - v.docked).toFixed(0)} s`);
          assert.ok(Math.abs(v3len(p.forward) - 1) < 1e-9 && Math.abs(v3dot(p.forward, p.up)) < 1e-9, 'a square frame');
        }
      }
      // Well after the ship berths, it is home.
      const later = v.docked + 3000 < v.undocked - 3000 ? v.docked + 3000 : null;
      if (later) assert.deepEqual(tugsAt(h, home.id, seed, [shipAt(h, v, later)!], later)[v.arm].position, tugCradle(h, v.arm).at);
    }
    assert.ok(P > 0);
  });

  test(`port craft (${name}): inspectors work round a berthed ship's crew section, off its hull, only while it is berthed`, () => {
    for (const v of visits) {
      const shape = shipShape(v.ship), crew = shape.parts.find((q) => q.role === 'crew' && q.shape === 'cylinder')!;
      const r = partSpan(crew).radius;
      assert.equal(inspectorsAt(h, v, v.docked - 1).length, 0);
      assert.equal(inspectorsAt(h, v, v.undocked + 1).length, 0);
      let most = 0;
      for (let t = v.docked; t <= Math.min(v.undocked, v.docked + 4000); t += 37) {
        const s = shipAt(h, v, t)!, all = inspectorsAt(h, v, t, shape);
        most = Math.max(most, all.length);
        for (const c of all) {
          const o = offAxis(s, c.position);
          // Beyond the nose (coming out of the collar) or off the hull.
          assert.ok(o.along >= v.ship.length - 1e-6 || o.across >= r + c.length * 0.5, `${c.id}: ${o.across.toFixed(1)} m off the axis, ${o.along.toFixed(1)} m along`);
          assert.ok(Math.abs(v3len(v3cross(c.forward, c.up)) - 1) < 1e-9);
        }
      }
      if (v.undocked - v.docked > 2000) assert.equal(most, INSPECTORS, `${v.id}: all of them out at once`);
    }
  });
}

test('port craft: shapes within their length, their lights apart', () => {
  for (const kind of ['tug', 'inspector'] as const) for (const length of [4, 12, 30]) {
    const s = craftShape({ kind, length, seed: 3 });
    for (const q of s.parts) {
      const span = partSpan(q);
      assert.ok(span.x0 >= -1e-9 && span.x1 <= length + 1e-9, `${kind}: ${q.role} from ${span.x0} to ${span.x1}`);
      assert.ok(span.radius <= s.params.beam / 2 + length * 0.4, `${kind}: ${q.role} reaches ${span.radius}`);
    }
    assert.ok(s.parts.some((q) => q.role === 'window'), 'lit cabin or lamp eye');
  }
  assert.ok(v3add([0, 0, 0], [0, 0, 0]));
});
