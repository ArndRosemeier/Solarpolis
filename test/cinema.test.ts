// The title's attract loop and its torch ship: every distance follows the home habitat, over the whole MATRIX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3dot, v3len, v3norm, v3sub } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { LIT_FROM, LIT_TO, LOOP, REFERENCE_SPACE, SHOTS, TORCH_SHIP, attractLoop, chooseStart, makeSpace, skyFrom, torchShip } from '../src/space';

const DEG = 180 / Math.PI;

test('chooseStart: the habitat in sunlight, Earth gibbous behind the approach, the Sun behind the camera', () => {
  const space = makeSpace(REFERENCE_SPACE);
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
    const space = makeSpace({ ...REFERENCE_SPACE, home: params });
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
      } else {
        assert.ok(q.from >= 0 && q.to <= p.length && q.from < q.to);
        const r = q.shape === 'cone' ? Math.max(q.r0, q.r1) : q.radius + Math.hypot(...(q.offset ?? [0, 0]));
        assert.ok(r <= p.beam / 2 + 1e-9);
      }
    }
    assert.equal(s.plumeLength, p.plume * p.length);
    assert.ok(s.nozzle > 0 && s.plumeRadius > s.nozzle);
  }
  assert.deepEqual(torchShip(TORCH_SHIP), torchShip(TORCH_SHIP));
});
