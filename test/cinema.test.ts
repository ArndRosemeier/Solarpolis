// The title's attract loop and its torch ship: every distance follows the home habitat, over the whole MATRIX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3add, v3dot, v3len, v3norm, v3scale, v3sub } from '@futuremagic/core';
import { MATRIX, exteriorDistance, fromWorld } from '../src/blueprint';
import { ARRIVAL, ARRIVAL_SHOTS, arrivalScore, captionAt, MIND_LINES, SPIN_UP, LIT_FROM, LIT_TO, LOOP, SHOTS, TORCH_SHIP, arrival, attractLoop, hubView, chooseStart, partSpan, shipAt, skyFrom, torchShip } from '../src/space';
import { spaceOf } from './worlds';

const DEG = 180 / Math.PI;

test('chooseStart: the habitat in sunlight, Earth gibbous behind the approach, the Sun behind the camera', () => {
  const space = spaceOf('reference');
  const t = chooseStart(space, 0);
  const sky = skyFrom(space, space.home.orbitFrame, [0, 0, 0], t);
  const e = v3norm(sky.earth.center), lit = (1 - v3dot(sky.sunDir, e)) / 2;
  assert.ok(sky.sunlight >= 1);
  assert.ok(lit > LIT_FROM && lit < LIT_TO, `Earth lit ${lit}`);
  const c = attractLoop(space, t, space.home.habitat.params.exterior.keepOut, TORCH_SHIP.length);
  assert.ok(v3dot(c.approach, sky.sunDir) < 0, 'the Sun is behind the camera');
  // Earth sits below the middle of the frame, behind the habitat.
  const a = Math.acos(v3dot(c.approach, e)) * DEG;
  assert.ok(a > 10 && a < 25, `Earth ${a}° below the approach`);
});

for (const { name, params } of MATRIX) {
  test(`attract loop (${name}): each shot frames the home habitat by its own size`, () => {
    const space = spaceOf(name);
    const h = space.home.habitat, Ro = h.exterior.radius, L = h.exterior.portFace - h.exterior.wildFace;
    const keepOut = params.exterior.keepOut;
    const c = attractLoop(space, chooseStart(space, 0), keepOut, TORCH_SHIP.length);
    assert.equal(LOOP, SHOTS[0] + SHOTS[1] + SHOTS[2]);

    // Shot 1: the ship hangs at the keep-out distance, braking to a stop, the title fading in.
    const s1 = c.at(1), s1end = c.at(SHOTS[0] - 0.01);
    assert.equal(s1.shot, 0);
    assert.ok(s1.ship && s1end.ship);
    assert.ok(Math.abs(v3len(s1.ship.position) / Ro - keepOut) < 1e-9);
    assert.ok(s1.ship.throttle === 1 && s1end.ship.throttle === 0);
    assert.ok(s1.title === 0 && s1end.title === 1);
    // Its exhaust goes toward home (the nose points away): it brakes.
    assert.ok(v3dot(s1.ship.forward, c.approach) < -0.999);

    // Shot 2: 50 outer radii off, closing from 30° to a frame the habitat fills about half of.
    const s2a = c.at(SHOTS[0] + 0.01), s2b = c.at(SHOTS[0] + SHOTS[1] - 0.01);
    assert.equal(s2a.shot, 1);
    assert.ok(Math.abs(v3len(s2a.eye) / Ro - 50) < 1e-9);
    assert.ok(Math.abs(s2a.fov - 30) < 0.01);
    const span = Math.max(L, 2 * Math.max(Ro, ...h.exterior.brims.map((b) => b.tip)));
    const fill = span / v3len(s2b.eye) / (s2b.fov / DEG);
    assert.ok(fill > 0.45 && fill < 0.6, `shot 2 ends with the habitat ${fill} of the frame`);

    // Shot 3: two outer radii from the axis all along, flying toward the port end, outside the hull.
    const pose = space.frames.relative(space.home.bodyFrame, space.home.orbitFrame, c.start);
    const port = [pose.axes[2], pose.axes[5], pose.axes[8]] as [number, number, number];
    let last = -Infinity;
    for (let t = 0.01; t < SHOTS[2]; t += 1) {
      const f = c.at(SHOTS[0] + SHOTS[1] + t);
      assert.equal(f.shot, 2);
      const along = v3dot(f.eye, port), off = v3len(v3sub(f.eye, [port[0] * along, port[1] * along, port[2] * along]));
      assert.ok(Math.abs(off / Ro - 2) < 1e-9);
      assert.ok(along > last);
      last = along;
    }
    // The loop repeats.
    assert.deepEqual(c.at(LOOP + 3), c.at(3));
  });
}

test('torch ship: every part within its length and beam, wings edge-on to the exhaust, the plume from the nozzle', () => {
  for (const p of [TORCH_SHIP, { ...TORCH_SHIP, length: 40, beam: 6 }, { ...TORCH_SHIP, length: 900, beam: 60, seed: 3 }]) {
    const s = torchShip(p);
    assert.ok(s.parts.length > 5);
    for (const q of s.parts) {
      if (q.shape === 'box') {
        assert.ok(q.center[0] - q.half[0] >= 0 && q.center[0] + q.half[0] <= p.length);
        if (q.role === 'radiator') assert.ok(q.half[1] < q.half[2] / 10, 'thin across, wide out from the spine');
      } else if (q.shape !== 'strut' && q.shape !== 'shell') {
        assert.ok(q.from >= 0 && q.to <= p.length && q.from < q.to);
        assert.ok(partSpan(q).radius <= p.beam / 2 + 1e-9);
      }
    }
    assert.equal(s.plumeLength, p.plume * p.length);
    assert.ok(s.nozzle > 0 && s.plumeRadius > s.nozzle);
  }
  assert.deepEqual(torchShip(TORCH_SHIP), torchShip(TORCH_SHIP));
});

for (const { name } of MATRIX) {
  test(`arrival (${name}): down the corridor past the ship's nose, then the berth as it latches, never inside anything`, () => {
    const space = spaceOf(name), p = space.home, h = p.habitat, x = h.exterior;
    const a = arrival(space, chooseStart(space, 0) + 40), g = a.guest, L = g.ship.length;
    assert.equal(a.at(ARRIVAL), null);
    let last = -Infinity, berthed = false;
    for (let e = 0; e < ARRIVAL_SHOTS[0] + ARRIVAL_SHOTS[1]; e += 0.5) {
      const f = a.at(e)!, s = shipAt(h, g, f.clock)!;
      assert.equal(f.shot, e < ARRIVAL_SHOTS[0] ? 3 : 4);
      assert.ok(f.clock > last, 'the clock runs on (and jumps forward at the cut)');
      last = f.clock;
      // The eye in the spindle's frame: outside the habitat and off the ship's hull.
      const eye = space.frames.position(f.eye, p.orbitFrame, p.spindleFrame, f.clock);
      assert.ok(exteriorDistance(x, eye) > 0, `${name} ${e} s: eye inside the habitat`);
      const q = v3sub(eye, s.position), along = v3dot(q, s.forward), across = v3len(v3sub(q, v3scale(s.forward, along)));
      assert.ok(along < 0 || along > L || across > g.ship.beam, `${name} ${e} s: eye inside the ship`);
      const look = v3norm(v3sub(f.target, f.eye)), nose = space.frames.direction(s.forward, p.spindleFrame, p.orbitFrame, f.clock);
      if (f.shot === 3) {
        // Shot 4: the ship coasts in nose first, and the camera looks the way it flies.
        assert.equal(s.phase, 'coast');
        assert.ok(v3dot(look, nose) > 0.7, `${name}: looking ${v3dot(look, nose)} along the nose`);
      } else {
        // Shot 5: the ship berths in it, and its nose is in front of the camera.
        berthed ||= s.phase === 'berthed';
        const tip = space.frames.position(v3add(s.position, v3scale(s.forward, L)), p.spindleFrame, p.orbitFrame, f.clock);
        assert.ok(v3dot(look, v3norm(v3sub(tip, f.eye))) > 0.9, `${name}: the nose out of frame`);
      }
    }
    assert.ok(berthed, 'it latches in shot 5');
    // What is heard of it: the thrusters burn while the ship coasts in, pulse on its final creep, the berth when it latches.
    const m = a.moments, phase = (e: number) => shipAt(h, g, a.at(e)!.clock)!.phase;
    for (let e = 0.25; e < m.through; e += 0.5) assert.equal(m.burns.some(([x, y]) => e >= x && e < y), phase(e) === 'coast', `${name} ${e} s: burning`);
    for (const e of m.pulses) assert.ok(e >= 0 && e < m.through && ['turn', 'final'].includes(phase(e)), `${name}: a pulse at ${e} s, ${phase(e)}`);
    assert.ok(m.pulses.some((e) => e >= ARRIVAL_SHOTS[0]), 'trims on the final creep in');
    assert.ok(phase(m.berth - 0.05) === 'final' && phase(m.berth + 0.05) === 'berthed', 'the berth when it latches');
    assert.ok(m.through < m.bearing && m.bearing < ARRIVAL);
    const sc = arrivalScore(m, g.ship.seed);
    assert.deepEqual(sc.cues, arrivalScore(m, g.ship.seed).cues);
    for (const c of sc.cues) assert.match(c.sound, /^ship\//);
    assert.ok(sc.cues.some((c) => c.sound === 'ship/contact' && c.t === m.berth));
    assert.ok(sc.beds(5)['ship/cabin'] > 0 && sc.beds(m.through + 1)['ship/cabin'] === 0 && sc.beds(m.bearing)['ship/bearing'] > sc.beds(m.through + 1)['ship/bearing']);
    assert.ok(sc.beds(m.bearing + 5)['body/rush'] > 0 && sc.beds(ARRIVAL)['ship/bearing'] === 0);
    // The ship's Mind, as text: each line once, in order, the second before the berth, the last in the bore.
    const shown = [...new Set(Array.from({ length: ARRIVAL * 4 }, (_, k) => captionAt(sc, k / 4)).filter(Boolean))];
    assert.deepEqual(shown, [...MIND_LINES]);
    assert.ok(sc.captions[1].to <= m.berth + 1 && sc.captions[2].from > m.through);
  });
}

for (const { name } of MATRIX) {
  test(`crossing (${name}): down the bore on the axis, through the bearing into the turning sleeve, toward the Hub`, () => {
    const space = spaceOf(name), p = space.home, h = p.habitat, b = h.exterior.spindle.bore;
    const a = arrival(space, chooseStart(space, 0) + 40), from = ARRIVAL_SHOTS[0] + ARRIVAL_SHOTS[1];
    let last: { z: number; clock: number } | null = null, crossed = false;
    for (let e = from; e < ARRIVAL; e += 0.25) {
      const f = a.at(e)!;
      assert.equal(f.shot, 5);
      const eye = space.frames.position(f.eye, p.orbitFrame, p.spindleFrame, f.clock), r = Math.hypot(eye[0], eye[1]);
      assert.ok(r < b.radius * 0.5 && eye[2] > b.from && eye[2] < b.to, `${name}: the eye left the bore at ${e} s`);
      // Looking down the bore toward the Hub.
      const look = space.frames.direction(v3norm(v3sub(f.target, f.eye)), p.orbitFrame, p.spindleFrame, f.clock);
      assert.ok(look[2] < -0.99);
      if (last) {
        assert.ok(eye[2] < last.z && f.clock > last.clock && f.clock - last.clock < 0.3, 'floats on toward the Hub on the real clock');
        crossed ||= last.z >= b.bearing && eye[2] < b.bearing;
      }
      last = { z: eye[2], clock: f.clock };
    }
    assert.ok(crossed, 'it passes the bearing');
    assert.ok(SPIN_UP > ARRIVAL_SHOTS[2], 'in the shot the air has only begun to turn the passenger');
  });
}

for (const { name } of MATRIX) {
  test(`hub (${name}): the passenger floats out into the open air of the Hub, beside the sunline, looking down it`, () => {
    const h = spaceOf(name).home.habitat, { eye, look } = hubView(h);
    const at = fromWorld(h.profile, ...eye);
    assert.ok(at.h > 0, `${name}: ${at.h} m from the endcap's surface`);
    const r = Math.hypot(eye[0], eye[1]);
    assert.ok(r > h.params.sunlineRadius && r < h.params.hubRadius, `${name}: ${r} m off the axis is in the sunline or beyond the Hub`);
    assert.ok(look[2] === -1 && eye[2] < h.length);
  });
}
