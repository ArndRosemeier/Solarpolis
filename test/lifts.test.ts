import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3dot, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, fromWorld, toWorld } from '../src/blueprint';
import { buildCabin, cabinPlace, calledFrom, doorsAbove, doorsBelow, doorsHit, eyeInCabin, liftDoorsNear, outside, rideOf, rideSeconds, rideShare } from '../src/gen/lifts';
import { underLiftOf } from '../src/gen/underMesh';
import { underOf } from '../src/gen/under';
import { levelsOf } from '../src/gen/underLevels';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

for (const { name } of MATRIX) {
  /** The first court with a lift (null where no court has one). */
  const firstLift = (): { t: ReturnType<typeof terrainOf>; court: number } | null => {
    const t = terrainOf(name), m = underOf(t.habitat).hamlets.find((x) => underLiftOf(t, x.court));
    return m ? { t, court: m.court } : null;
  };

  test(`lifts (${name}): doors above in the court's portal and below at the cage, found and clicked from in front of them`, () => {
    const f = firstLift();
    if (!f) return;
    const { t, court } = f, h = t.habitat, hr = h.params.landmarks!.handrail;
    for (const doors of [doorsAbove(t, court)!, doorsBelow(t, court)!]) {
      assert.ok(doors && doors.court === court && doors.half > 0 && doors.high > 0);
      // From a step out, at eye height, the doors are near enough; looking at them they are hit, looking away not.
      const o = outside(h, doors, 1.5 * hr), feet = doors.below ? levelsOf(t).levelAt(o.theta, o.s).floor : t.standAt(o.theta, o.s);
      const eye = toWorld(h.profile, { theta: o.theta, s: o.s, h: feet + 1.6 });
      assert.equal(liftDoorsNear(t, eye, doors.below)?.court, court, `${doors.below ? 'below' : 'above'}: near enough`);
      assert.equal(liftDoorsNear(t, eye, !doors.below), null, 'not from the other level');
      const d = v3sub(doors.at, eye), n = Math.hypot(...d), look: Vec3 = [d[0] / n, d[1] / n, d[2] / n];
      assert.ok(doorsHit(doors, eye, look), 'clicked looking at them');
      assert.ok(!doorsHit(doors, eye, [-look[0], -look[1], -look[2]]), 'not looking away');
      // Above, one steps out into the court; below, onto the floor in front of the cage.
      if (!doors.below) assert.equal(t.courtAt(o.theta, o.s)?.court, t.courts[court]);
      const far = toWorld(h.profile, { theta: o.theta, s: o.s + 12 * hr, h: feet + 1.6 });
      assert.equal(liftDoorsNear(t, far, doors.below), null, 'not from far off');
    }
  });

  test(`lifts (${name}): the cabin rides from the floor below up to the court, upright, its doors toward the cage's`, () => {
    const f = firstLift();
    if (!f) return;
    const { t, court } = f, h = t.habitat, ride = rideOf(t, court)!, below = doorsBelow(t, court)!;
    assert.ok(ride.top > ride.bottom, 'up from the floor');
    for (const k of [0, 0.5, 1]) {
      const p = cabinPlace(t, court, k)!, at = fromWorld(h.profile, ...p.at);
      assert.ok(Math.abs(at.h - (ride.bottom + (ride.top - ride.bottom) * k)) < 1e-6, `at ${k} of its way`);
      assert.ok(Math.abs(Math.hypot(...p.ex) - 1) < 1e-9 && Math.abs(v3dot(p.ex, p.ez)) < 1e-9 && Math.abs(v3dot(p.ey, p.ez)) < 1e-9, 'a frame');
      const up = fromWorld(h.profile, ...eyeInCabin(h, p, 1.6));
      assert.ok(up.h - at.h > 1.6 && up.h - at.h < 1.9, 'its eye is up from its floor');
    }
    assert.ok(v3dot(v3sub(below.at, cabinPlace(t, court, 0)!.at), below.out) > 0, 'its doors on the side the cage opens');
    // A ride eases out and in, and takes long enough not to jolt; a called cabin comes out of the vault above the cage.
    const s = rideSeconds(t, court, 0, 1);
    assert.ok(s >= 3 && (1.5 * (ride.top - ride.bottom)) / s <= 6 + 1e-9, `${s.toFixed(1)} s`);
    assert.equal(rideShare(0, 1, 0, s), 0);
    assert.equal(rideShare(0, 1, s, s), 1);
    const from = calledFrom(t, court), c = fromWorld(h.profile, ...cabinPlace(t, court, from)!.at);
    assert.ok(from > 0 && from <= 1 && (from === 1 || c.h > levelsOf(t).levelAt(c.theta, c.s).ceiling), 'out of sight above the vault');
  });

  test(`lifts (${name}): the cabin fits its cage, every face outward`, () => {
    const f = firstLift();
    if (!f) return;
    const { t, court } = f, lift = underLiftOf(t, court)!, a = buildCabin(t.habitat, lift.side).mappedArrays();
    assert.equal(windingOk(a.positions, a.normals, a.index).bad, 0);
    for (let v = 0; v < a.positions.length / 3; v++) {
      assert.ok(Math.abs(a.positions[3 * v]) < lift.side / 2 && Math.abs(a.positions[3 * v + 1]) < lift.side / 2, 'within the cage');
    }
  });
}

