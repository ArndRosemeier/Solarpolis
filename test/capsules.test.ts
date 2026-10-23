import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3dot, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, apart, fromWorld } from '../src/blueprint';
import { CAP, buildCapsule, capDestinations, capLayout, capStopsOf, doorPlace, overFloor } from '../src/gen/capsules';
import { landingNear } from '../src/gen/capLanding';
import { handrailOf } from '../src/gen/lifts';
import { plantsOf, standsIn } from '../src/gen/scatter';
import { cruiseClear, flightAt, planFlight } from '../src/world/capFlight';
import { SEATED_EYE, alighting, boarding, mountPose, stepsSeconds } from '../src/world/mount';
import { describeGravity } from '../src/app/gravityMeter';
import { ecologyOf, habitatOf, terrainOf } from './worlds';

const G = 9.81;

test('capsule: the pod is whole and finite, its parts within its reach, the door swinging up and out about its hinge', () => {
  // Its build depends on the handrail alone; one habitat stands for all (the layout is checked over the matrix below).
  const h = habitatOf('small'), lay = capLayout(h), shapes = buildCapsule(h);
  for (const [name, sh] of Object.entries(shapes)) {
    const a = sh.mappedArrays();
    assert.ok(a.index.length > 0 && a.index.length % 3 === 0, `${name}: triangles`);
    for (const v of a.positions) assert.ok(Number.isFinite(v), `${name}: finite`);
    for (let i = 0; i < a.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(a.normals[i], a.normals[i + 1], a.normals[i + 2]) - 1) < 1e-3, `${name}: unit normals`);
  }
  const body = shapes.body.mappedArrays().positions;
  for (let i = 0; i < body.length; i += 3) {
    assert.ok(Math.hypot(body[i], body[i + 1]) <= lay.reach + 1e-6 && body[i + 2] >= -1e-6, 'within its reach, on or over the ground');
  }
  // Shut, the door is the shell's own; open, its foot (down its −z from the hinge) has swung out (−y) to over level.
  const shut = doorPlace(lay, 0), open = doorPlace(lay, 1), foot: Vec3 = [-open.ez[0], -open.ez[1], -open.ez[2]];
  assert.deepEqual(shut.ez, [0, 0, 1]);
  assert.ok(foot[1] < -0.9 && foot[2] >= 0, 'swung out and up');
});

for (const { name } of MATRIX) {
  test(`capsule (${name}): the seat inside the shell, the door's sill on the cabin floor, its step on the ground beside it`, () => {
    const h = habitatOf(name), lay = capLayout(h), hr = handrailOf(h);
    assert.ok(Math.abs(lay.seat.hips[0]) < (CAP.length / 2) * hr && Math.abs(lay.seat.hips[1]) < (CAP.width / 2) * hr, 'seat inside');
    assert.equal(lay.seat.hips[2], lay.floor);
    // Seated, the hips rest on the bench (between its front edge and its back), not in the air in front of it.
    const behindEdge = -CAP.seatEdge * hr - lay.seat.hips[0];
    assert.ok(behindEdge > 0.15 && behindEdge < CAP.seatDeep * hr - 0.1, `hips on the bench (${behindEdge.toFixed(2)} m behind its edge)`);
    assert.equal(lay.door.inside[2], lay.floor);
    assert.equal(lay.door.outside[2], 0);
    assert.ok(lay.door.outside[1] < -lay.halfWidth, 'the step clear of the fans');
    // Seated, the eyes stay under the shell's top.
    assert.ok(lay.floor + SEATED_EYE < (CAP.belly + CAP.height) * hr);
  });

  test(`capsule (${name}): getting in walks round the pod to its door, never through it, and ends seated; getting out ends on the ground`, () => {
    const h = habitatOf(name), lay = capLayout(h), hr = handrailOf(h);
    // From the far side: round its nose by points clear of it.
    const start: Vec3 = [0.5, lay.halfWidth + 4 * hr, 0];
    const via: Vec3[] = [[lay.halfLength + 0.7, lay.halfWidth + 0.7, 0], [lay.halfLength + 0.7, -lay.halfWidth - 0.7, 0]];
    const steps = boarding(lay.seat, lay.door, start, 1.3, via), total = stepsSeconds(steps);
    // The eyes (they go with the hips: the body's place moves under them as it sits down) never jump.
    const eyes = (p: ReturnType<typeof mountPose>): Vec3 => [p.feet[0] - p.front[0] * p.back, p.feet[1] - p.front[1] * p.back, p.feet[2] + p.eye];
    let seen = eyes(mountPose(steps, 0));
    for (let k = 1; k <= 400; k++) {
      const p = mountPose(steps, (total * k) / 400);
      assert.ok(apart(eyes(p), seen) < 0.15, `the eyes do not jump (${apart(eyes(p), seen).toFixed(2)} m, ${p.posture})`);
      seen = eyes(p);
      const inside = Math.abs(p.feet[0]) < lay.halfLength && Math.abs(p.feet[1]) < lay.halfWidth;
      // Inside its footprint only on the cabin floor (stepping up into the doorway and after).
      if (inside && p.feet[2] < lay.floor * 0.5) assert.ok(Math.abs(p.feet[0]) < CAP.door * hr && p.feet[1] < 0, 'only through the doorway');
    }
    const end = mountPose(steps, total + 1);
    assert.equal(end.posture, 'sit');
    assert.deepEqual(end.feet, lay.seat.hips);
    const out = alighting(lay.seat, lay.door, 1.3), last = mountPose(out, stepsSeconds(out) + 1);
    assert.deepEqual(last.feet, lay.door.outside);
    assert.equal(last.posture, 'stand');
  });

  test(`capsule stops (${name}): a pad by each place, dry, level and clear of anything built, and nothing scattered on it`, () => {
    const t = terrainOf(name), e = ecologyOf(name), h = t.habitat, stops = capStopsOf(t), lay = capLayout(h);
    const places = capDestinations(t), courts = places.filter((d) => d.group === 'Courts');
    assert.ok(courts.length > 0 && places.some((d) => d.group === 'Landmarks'), 'courts and landmarks listed');
    // A few of each kind (the whole list is for the link).
    const some = [...places.filter((d) => d.group !== 'Courts').slice(0, 3), ...courts.filter((_, i) => i % Math.max(1, Math.floor(courts.length / 3)) === 0)];
    let found = 0;
    for (const d of some) {
      const st = stops.of(d);
      if (!st) continue;
      found++;
      assert.ok(overFloor(h, d.theta, d.s, st.theta, st.s) <= d.around + 4 * h.params.life.caps.reach + 10, `${d.title}: near its place`);
      if (st.built) continue;
      // Upright on true up, and nothing scattered on it.
      const r = Math.hypot(st.pad.at[0], st.pad.at[1]);
      assert.ok(Math.abs(v3dot(st.pad.ez, [-st.pad.at[0] / r, -st.pad.at[1] / r, 0]) - 1) < 1e-9, `${d.title}: upright`);
      const r0 = h.profile.at(st.s).r, span = 3;
      for (const sp of plantsOf(e)) {
        if (sp.what === 'cover') continue;
        standsIn(e, sp, { theta0: st.theta - span / r0, theta1: st.theta + span / r0, s0: st.s - span, s1: st.s + span }, 0, (pt, ps) => {
          assert.ok(overFloor(h, pt, ps, st.theta, st.s) > lay.halfLength, `${d.title}: nothing scattered on its pad (${sp.spec.name})`);
        });
      }
    }
    assert.ok(found >= some.length - 2, `most places have a stop (${found} of ${some.length})`);
  });
}

/** The quickest the pod's floor swings or it turns (rad/s), and what its passenger feels changes (floor gravities a second). */
const SWING = 0.35, JOLT = 0.35;

for (const name of ['small', 'reference']) {
  test(`capsule flight (${name}): off one pad, over the land, onto the other, as fast as the passenger is comfortable, banked into what they feel`, () => {
    const t = terrainOf(name), h = t.habitat, caps = h.params.life.caps, stops = capStopsOf(t);
    const courts = capDestinations(t).filter((d) => d.group === 'Courts');
    const a = stops.of(courts[0])!, b = stops.of(courts[Math.floor(courts.length / 2)])!;
    const f = planFlight(t, { from: a.pad, to: b.pad });
    assert.ok(apart(flightAt(h, f, 0).place.at, a.pad.at) < 1e-6 && apart(flightAt(h, f, f.seconds).place.at, b.pad.at) < 1e-6, 'pad to pad');
    for (let i = 1; i < f.times.length; i++) assert.ok(f.times[i] > f.times[i - 1], 'time goes on');
    const floor = h.gravityAt(h.radius), rise = cruiseClear(h);
    for (let k = 1; k < 120; k++) {
      const s = flightAt(h, f, (f.seconds * k) / 120), speed = Math.hypot(...s.velocity);
      assert.ok(speed <= caps.cruise * 1.05, 'no faster than the cruise');
      assert.ok(s.weight <= caps.comfort * floor * 1.08, `comfortable (${(s.weight / G).toFixed(2)} g)`);
      const up = s.place.ez, r = Math.hypot(s.place.at[0], s.place.at[1]), trueUp: Vec3 = [-s.place.at[0] / r, -s.place.at[1] / r, 0];
      assert.ok(v3dot(up, trueUp) >= Math.cos(caps.tilt) - 1e-6, 'banked no more than its tilt');
      // Over the land: never under the ground, and well over it once off the pads.
      const at = fromWorld(h.profile, ...s.place.at), ground = t.standAt(at.theta, at.s);
      assert.ok(at.h >= ground - 0.5, 'not under the ground');
      const off = Math.min(apart(s.place.at, a.pad.at), apart(s.place.at, b.pad.at));
      if (off > 2 * rise) assert.ok(at.h > ground + caps.over * 0.5, `over the land (${(at.h - ground).toFixed(0)} m)`);
    }
    assert.ok(f.heaviest <= caps.comfort * floor * 1.08);
    // Smooth all the way (Arnd 2026-10-23: manoeuvres need to be smooth, always): the pod never swings its floor or
    // turns about its up faster than SWING, nor does what the passenger feels change faster than JOLT.
    const dt = 0.2;
    let was = flightAt(h, f, 0);
    for (let s = dt; s <= f.seconds; s += dt) {
      const now = flightAt(h, f, s), turn = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, v3dot(a, b))) / dt;
      assert.ok(turn(now.place.ez, was.place.ez) <= SWING && turn(now.place.ex, was.place.ex) <= SWING, `smooth at ${s.toFixed(1)} s of ${f.seconds.toFixed(0)}: ${turn(now.place.ez, was.place.ez).toFixed(2)} rad/s`);
      assert.ok(Math.hypot(...v3sub(now.felt, was.felt)) / dt <= JOLT * floor, `no jolt at ${s.toFixed(1)} s`);
      was = now;
    }
  });
}

test('capsule: a called pod sets down on a stop near the caller, and the gravity meter says one is in a capsule', () => {
  const e = ecologyOf('small'), t = e.terrain, h = t.habitat, d = capDestinations(t).find((x) => x.group === 'Courts')!;
  const st = capStopsOf(t).of(d)!, pad = landingNear(e, plantsOf(e), st.theta, st.s + 10, h.params.life.caps.reach);
  assert.ok(pad && apart(pad.at, st.pad.at) < 1e-6, 'the stop nearby');
  const r = describeGravity({ felt: 9.81, rest: 9.81, floor: 9.81, spinward: 0, arrow: 0, moving: 'capsule' });
  assert.match(r.state, /^In a capsule/);
  // The pad's up is true up.
  const up = v3sub([0, 0, 0], [pad!.at[0], pad!.at[1], 0]), n = Math.hypot(...up);
  assert.ok(Math.abs(v3dot(pad!.ez, [up[0] / n, up[1] / n, 0]) - 1) < 1e-9);
});
