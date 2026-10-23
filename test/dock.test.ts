/** The berths' clamps, signal lights and floodlights (src/space/dock.ts), over the matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3cross, v3dot, v3scale, v3sub } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import {
  CLAMPS, CLAMP_CLUNKS, DOCK, LIGHT_COLOUR, RELEASE, SEALED, SIGNALS, approachOf, arrival, arrivalScore, berthDockOf, chooseStart, clampPose,
  UMBILICAL, closedSwing, deriveShip, dockAt, dockLightsAt, reachAt, shipShape, umbilicalPath, type Visit,
} from '../src/space';
import { habitatOf, spaceOf } from './worlds';

const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) < e;

for (const { name } of MATRIX) {
  test(`dock (${name}): clamps hinged round each collar swing in until they meet the ship's own nose`, () => {
    const h = habitatOf(name), w = h.exterior.spindle.arms.width, berth = h.exterior.spindle.arms.length;
    for (let arm = 0; arm < h.exterior.spindle.berthArms; arm += 2) {
      const b = berthDockOf(h, arm);
      assert.equal(b.spokes.length, CLAMPS);
      for (const [k, P] of b.spokes.entries()) {
        assert.ok(near(v3dot(P, P), 1) && near(v3dot(P, b.radial), 0));
        for (const swing of [DOCK.open, 0, 1]) {
          const p = clampPose(b, k, swing);
          for (const a of [p.ex, p.ey, p.ez]) assert.ok(near(v3dot(a, a), 1));
          assert.ok(near(v3dot(p.ex, p.ey), 0) && near(v3dot(p.ey, p.ez), 0) && near(v3dot(p.ez, p.ex), 0));
          const c = v3cross(p.ex, p.ey);
          assert.ok(near(v3dot(c, p.ez), 1), 'right-handed');
          // Its hinge stands outside the ring, a little behind the face.
          const q = v3sub(p.at, b.collar);
          assert.ok(v3dot(q, b.radial) < 0 && v3dot(q, P) > DOCK.ring * w);
        }
      }
    }
    // Each ship's nose stops its clamps somewhere of its own, short of the most they swing and well past open.
    const seen = new Set<string>();
    for (let s = 1; s <= 4; s++) {
      const shape = shipShape(deriveShip(s * 7919, berth)), closed = closedSwing(h, shape), L = shape.params.length;
      assert.ok(closed > DOCK.open + 0.5 && closed < DOCK.most, `${name}: closes to ${closed} rad`);
      seen.add(closed.toFixed(3));
      // At rest the jaw is against the nose: its pad within a few hundredths of the arm's width of the hull.
      const c = Math.cos(closed), sn = Math.sin(closed), a = DOCK.reach * w, j = DOCK.jaw * w;
      const d = -DOCK.hinge.back * w + c * a - sn * j, rho = (DOCK.ring + DOCK.hinge.out) * w - sn * a - c * j;
      assert.ok(d > 0 && rho - reachAt(shape, L - d) < 0.25 * w, `${name}: the jaw ${(rho - reachAt(shape, L - d)).toFixed(2)} m off the hull`);
    }
    assert.ok(seen.size > 1, 'ships of different shapes are gripped differently');
    assert.ok(closedSwing(h, null) > DOCK.open);
  });

  test(`dock (${name}): amber as a ship comes, clamps home one by one, green once sealed, open again before it leaves`, () => {
    const h = habitatOf(name), ship = deriveShip(17, h.exterior.spindle.arms.length), a = approachOf(h, ship), out = a.final + a.turn;
    const v: Visit = { id: 'x', arm: 1, ship, from: 0, docked: 5000, undocked: 9000, to: 14000 };
    const closed = closedSwing(h, shipShape(ship));
    assert.deepEqual(dockAt(h, null, closed, 0), { swing: [DOCK.open, DOCK.open, DOCK.open, DOCK.open], signal: 'idle', flood: false, umbilical: 0 });
    assert.equal(dockAt(h, v, closed, v.docked - out - 1).signal, 'idle');
    const coming = dockAt(h, v, closed, v.docked - 10);
    assert.ok(coming.signal === 'approach' && coming.flood && coming.swing.every((s) => s === DOCK.open));
    assert.equal(dockAt(h, v, closed, v.docked).signal, 'contact');
    // Each clamp lands at its clunk, in order.
    for (const [k, clunk] of CLAMP_CLUNKS.entries()) {
      const before = dockAt(h, v, closed, v.docked + clunk - 0.05).swing, at = dockAt(h, v, closed, v.docked + clunk).swing;
      assert.ok(before[k] < closed && near(at[k], closed), `clamp ${k} home at ${clunk} s`);
      for (let m = k + 1; m < CLAMPS; m++) assert.ok(at[m] < closed);
    }
    assert.equal(dockAt(h, v, closed, v.docked + SEALED - 0.01).signal, 'contact');
    const held = dockAt(h, v, closed, v.docked + SEALED);
    assert.ok(held.signal === 'latched' && held.swing.every((s) => near(s, closed)));
    assert.equal(dockAt(h, v, closed, v.undocked - RELEASE + 0.01).signal, 'contact');
    const going = dockAt(h, v, closed, v.undocked);
    assert.ok(going.swing.every((s) => near(s, DOCK.open, 1e-6)), 'all open before it moves');
    assert.equal(dockAt(h, v, closed, v.undocked + 1).signal, 'approach');
    assert.equal(dockAt(h, v, closed, v.undocked + out + 1).signal, 'idle');
    // The swing never jumps between frames.
    let last = dockAt(h, v, closed, v.docked - 1).swing;
    for (let t = v.docked; t < v.undocked + 1; t += t < v.docked + 4 || t > v.undocked - 5 ? 1 / 60 : 50) {
      const now = dockAt(h, v, closed, t).swing;
      for (let k = 0; k < CLAMPS; k++) assert.ok(Math.abs(now[k] - last[k]) < 0.2, `a jump at ${t - v.docked} s`);
      last = now;
    }
  });

  test(`dock (${name}): the umbilical reels out to the ship's port once sealed, clear of the collar and the hull, and in before it leaves`, () => {
    const h = habitatOf(name), b = berthDockOf(h, 2), w = b.width, berth = h.exterior.spindle.arms.length;
    for (let s = 1; s <= 3; s++) {
      const shape = shipShape(deriveShip(s * 104729, berth)), L = shape.params.length, path = umbilicalPath(b, shape, 64);
      for (const p of path) {
        const d = v3dot(p, b.radial), rho = Math.hypot(...v3sub(p, v3scale(b.radial, d)));
        if (d > -DOCK.deep * w && d < 0) assert.ok(rho > DOCK.ring * w, `${name}: through the collar at ${d.toFixed(2)}`);
        if (d >= 0) assert.ok(rho >= reachAt(shape, L - d) + UMBILICAL.radius * w * 0.9, `${name}: into the hull at ${d.toFixed(2)} m`);
      }
      // It ends on the hull at the port.
      const e = path[path.length - 1], d = v3dot(e, b.radial), rho = Math.hypot(...v3sub(e, v3scale(b.radial, d)));
      assert.ok(rho - reachAt(shape, L - d) < UMBILICAL.radius * w * 2, 'on the port');
      // A share of the run is its first stretch.
      assert.deepEqual(umbilicalPath(b, shape, 2, 0)[0], path[0]);
    }
    const ship = deriveShip(17, berth), v: Visit = { id: 'x', arm: 2, ship, from: 0, docked: 5000, undocked: 9000, to: 14000 }, closed = 0;
    assert.equal(dockAt(h, v, closed, v.docked + SEALED).umbilical, 0, 'not before the seal holds');
    assert.equal(dockAt(h, v, closed, v.docked + UMBILICAL.from + UMBILICAL.takes).umbilical, 1);
    assert.equal(dockAt(h, v, closed, v.undocked - RELEASE).umbilical, 0, 'reeled in as the lights turn amber');
  });

  test(`dock (${name}): the collar's ring and floodlights, seen from in front and from behind`, () => {
    const h = habitatOf(name), b = berthDockOf(h, 0), w = b.width;
    const ahead = v3add(b.collar, v3scale(b.radial, 40 * w)), behind = v3sub(b.collar, v3scale(b.radial, 20 * w));
    const swing = new Array<number>(CLAMPS).fill(DOCK.open);
    assert.deepEqual(dockLightsAt(b, { swing, signal: 'idle', flood: false, umbilical: 0 }, ahead), []);
    const coming = dockLightsAt(b, { swing, signal: 'approach', flood: true, umbilical: 0 }, ahead);
    assert.equal(coming.length, SIGNALS.lights + CLAMPS);
    assert.ok(coming.slice(0, SIGNALS.lights).every((l) => l.colour === LIGHT_COLOUR.amber && l.blink.period > 0));
    // The floods, looked into, outshine everything else at the port.
    assert.ok(coming.slice(SIGNALS.lights).every((l) => l.candela > 50 * SIGNALS.candela));
    const latched = dockLightsAt(b, { swing, signal: 'latched', flood: true, umbilical: 0 }, ahead);
    assert.ok(latched.slice(0, SIGNALS.lights).every((l) => l.colour === LIGHT_COLOUR.green && l.blink.period === 0));
    // From behind the collar, down the arm: no floods, and the ring only dimly from round its rim.
    const back = dockLightsAt(b, { swing, signal: 'latched', flood: true, umbilical: 0 }, behind);
    assert.ok(back.every((l) => l.candela < SIGNALS.candela * 0.3));
  });
}

test('dock: the arrival hears each clamp land and the seal as the collar turns green', () => {
  const space = spaceOf('reference'), h = space.home.habitat, a = arrival(space, chooseStart(space, 0) + 40), m = a.moments;
  const sc = arrivalScore(m, a.guest.ship.seed);
  for (const [k, clunk] of CLAMP_CLUNKS.entries()) assert.ok(sc.cues.some((c) => c.sound === 'ship/clamp' && c.take === k && near(c.t, m.berth + clunk)));
  assert.ok(sc.cues.some((c) => c.sound === 'ship/seal' && near(c.t, m.berth + SEALED)), 'the seal is heard in the berth shot');
  // The berth shot runs on past the green light.
  const end = a.at(m.through - 0.01)!;
  assert.ok(end.clock - a.guest.docked > SEALED + 1);
  assert.equal(dockAt(h, a.guest, closedSwing(h, shipShape(a.guest.ship)), end.clock).signal, 'latched');
});
