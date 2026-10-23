import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, validate, withParams } from '../src/blueprint';
import { planOf, siteOf } from '../src/gen/plan';
import { BOAT_KINDS, boatAt, boatsNear, feltShare, sailingOf, inBasin, legsOf, outingOf, polarSpeed, type BoatKind } from '../src/sim/sailing';
import { windAt } from '../src/world/wind';
import { habitatOf } from './worlds';

const TURN = 2 * Math.PI, DEG = Math.PI / 180;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);
/** The heading the wind comes from. */
const upwindOf = (w: { along: number; around: number }): number => Math.atan2(-w.around, -w.along);

test('sailing: each design sails no closer to the wind than it can, fastest on a reach, a foiler flies once fast enough', () => {
  for (const kind of Object.keys(BOAT_KINDS) as BoatKind[]) {
    const b = BOAT_KINDS[kind];
    assert.equal(polarSpeed(kind, 5, b.noGo - 0.05).speed, 0, `${kind}: not into the wind`);
    const beat = polarSpeed(kind, 5, b.beat).speed, reach = polarSpeed(kind, 5, 100 * DEG).speed, run = polarSpeed(kind, 5, b.deep).speed;
    assert.ok(beat > 0 && reach > beat && reach > run && run > 0, `${kind}: ${beat.toFixed(1)} beating, ${reach.toFixed(1)} reaching, ${run.toFixed(1)} running`);
    assert.ok(polarSpeed(kind, 30, 100 * DEG).speed <= b.top + 1e-9, `${kind}: no faster than it can hold`);
    // Heavier, it stands up to more wind: its top speed grows with the gravity it feels.
    assert.ok(polarSpeed(kind, 30, 100 * DEG, 1.3).speed > polarSpeed(kind, 30, 100 * DEG, 0.8).speed);
  }
  // The foiler: off the water on a reach in a moderate breeze, much faster than it sails on its hulls.
  const flying = polarSpeed('foiler', 5, 100 * DEG), light = polarSpeed('foiler', 1.5, 100 * DEG);
  assert.ok(flying.foiling && !light.foiling && flying.speed > 5, `flying at ${flying.speed.toFixed(1)} m/s in a 5 m/s wind`);
  // Lighter (sailing against the spin) it lifts out in less wind than heavier (with it).
  const takeoff = (g: number) => { let w = 0.5; while (!polarSpeed('foiler', w, 100 * DEG, g).foiling) w += 0.05; return w; };
  assert.ok(takeoff(0.9) < takeoff(1.1), `takes off in ${takeoff(0.9).toFixed(2)} m/s lighter, ${takeoff(1.1).toFixed(2)} heavier`);
});

test('sailing: the spin makes a boat heavier sailing with it and lighter against it, the same along the axis', () => {
  const h = habitatOf('small'), R = h.radius;
  assert.ok(feltShare(h, R, 6, Math.PI / 2) > 1.05 && feltShare(h, R, 6, -Math.PI / 2) < 0.95, 'a fast spinner: plain to feel');
  assert.ok(Math.abs(feltShare(h, R, 6, 0) - 1) < 1e-12 && Math.abs(feltShare(h, R, 6, Math.PI) - 1) < 1e-12, 'along the axis');
});

for (const { name, params } of MATRIX) {
  test(`sailing (${name}): boats on every water with room, moored inside it, sailing inside it, never through the wind`, () => {
    const h = habitatOf(name), fleet = sailingOf(h), plan = planOf(h), L = params.day.length;
    // The water: the ring lake (if any) and every lake on the floor.
    assert.equal(fleet.basins.length, (plan.lake ? 1 : 0) + plan.meres.length);
    assert.ok(fleet.boats.length >= 1, 'boats');
    for (const b of fleet.basins) {
      const here = fleet.boats.filter((x) => x.basin === b.id);
      if (b.width >= BOAT_KINDS.skiff.room * BOAT_KINDS.skiff.length) assert.ok(here.length >= 1, `boats on ${b.kind} ${b.id}`);
      for (const x of here) {
        assert.ok(b.width >= BOAT_KINDS[x.kind].room * BOAT_KINDS[x.kind].length, 'room for its design');
        assert.ok(inBasin(b, x.home.u, x.home.v, -0.01), 'moored in its water');
      }
    }
    // The ring lake is cut at the pavilion's bridges: no boat sails through them.
    const pavilion = siteOf(plan, 'lake-pavilion');
    // A sailing day, a sample of the boats.
    const boats = fleet.boats.filter((_, i) => i % Math.max(1, Math.floor(fleet.boats.length / 16)) === 0);
    let out = 0, legs = 0;
    for (const boat of boats) {
      // Its first day out from the fifth on (it goes out on about every other day).
      let day = 5, o = outingOf(h, boat, day);
      while (!o && day < 25) o = outingOf(h, boat, ++day);
      const b = fleet.basins[boat.basin], spec = BOAT_KINDS[boat.kind];
      if (!o) continue;
      out++;
      assert.ok(o.start >= day * L && o.end <= (day + params.day.daylight) * L + 1, 'in the light hours');
      const all = legsOf(o);
      legs += all.length;
      for (const [i, leg] of all.entries()) {
        assert.ok(inBasin(b, leg.u, leg.v, -0.5), 'on the water');
        if (i > 0) assert.ok(leg.t >= all[i - 1].t, 'in time order');
        if (leg.turning || leg.speed <= 0.31) continue;
        // Never pointing into the wind it met at the leg's start, nor deeper than it sails.
        const at = { theta: b.theta + leg.u / b.radius, s: b.s + leg.v }, w = windAt(h, o.start + leg.t, at.theta, at.s);
        const twa = Math.abs(wrap(leg.heading - upwindOf(w)));
        assert.ok(twa >= spec.noGo - 1e-3 && twa <= spec.deep + 1e-3, `${boat.kind} sails ${(twa / DEG).toFixed(0)}° off the wind`);
      }
      // Back at its mooring at the end.
      const last = all[all.length - 1];
      assert.ok(Math.hypot(last.u - boat.home.u, last.v - boat.home.v) < spec.length * 3, 'home again');
      // Followed through the outing: on the water, moving as fast as it says along its heading, never jumping.
      let prev = boatAt(h, boat, o.start);
      for (let t = o.start + 20; t < o.end; t += 20) {
        const now = boatAt(h, boat, t), d = Math.hypot(wrap(now.theta - prev.theta) * h.radius, now.s - prev.s);
        assert.ok(now.sailing && d <= Math.max(now.speed, prev.speed, spec.top * 2) * 20 + 1, `no jumps (${d.toFixed(0)} m in 20 s)`);
        if (pavilion && b.kind === 'ring') assert.ok(Math.abs(wrap(now.theta - pavilion.theta)) * h.radius > pavilion.size, 'clear of the pavilion');
        assert.ok(Math.abs(now.heel) < spec.heel + 1e-9 && Number.isFinite(now.heading), 'upright enough');
        prev = now;
      }
      // Moored, it lies head to wind.
      const moored = boatAt(h, boat, o.end + 60);
      assert.ok(!moored.sailing && moored.speed === 0 && Math.abs(wrap(moored.heading - upwindOf(moored.wind))) < 1e-9, 'head to wind at its mooring');
    }
    assert.ok(out >= 1 && legs > out * 10, `some go out (${out} of ${boats.length}, ${legs} legs)`);
    // The same every time; and found near where they are.
    const boat = boats[0], t = 5.4 * L;
    assert.deepEqual(boatAt(h, boat, t), boatAt(h, boat, t));
    const at = boatAt(h, boat, t);
    assert.ok(boatsNear(h, t, at.theta, at.s, 1).some((x) => x.boat === boat), 'near itself');
  });
}

test('sailing: sized by the blueprint, and validated', () => {
  const ids = (sailing: typeof REFERENCE.life.sailing) => validate(derive(withParams({ life: { ...REFERENCE.life, sailing } }))).map((f) => f.id);
  assert.ok(ids({ ...REFERENCE.life.sailing, outings: 1.5 }).includes('life'), 'a chance');
  assert.ok(ids({ ...REFERENCE.life.sailing, stay: 0 }).includes('life'), 'a stay');
  assert.ok(!ids(REFERENCE.life.sailing).includes('life'));
  const none = derive(withParams({ life: { ...REFERENCE.life, sailing: { ...REFERENCE.life.sailing, boats: 0 } } }, MATRIX[1].params));
  assert.equal(sailingOf(none).boats.length, 0, 'none asked, none sailed');
});
