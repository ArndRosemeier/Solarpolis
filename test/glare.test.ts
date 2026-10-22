import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3cross, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, derive, toWorld } from '../src/blueprint';
import { sunlineEmission, sunlineNorm } from '../src/world/sunline';
import { glareOf, insideGlare, insideRayLuminance, meterRays, type InsideMeterable } from '../src/render/exposure';
import { terrainOf } from './worlds';

/** The 70° view the interior's camera has, from `eye` toward `at`, up toward the axis. */
function view(eye: Vec3, at: Vec3): Vec3[] {
  const fwd = v3norm(v3sub(at, eye)), right = v3norm(v3cross(fwd, v3norm([-eye[0], -eye[1], 0])));
  return meterRays(fwd, right, v3cross(right, fwd), Math.tan((35 * Math.PI) / 180), 16 / 9, 7, 5);
}

for (const { name, params } of MATRIX) {
  test(`eyes inside (${name}): they stop down looking down the tube from the axis toward the sun, not along the floor`, () => {
    const h = derive(params), p = h.profile, R = h.radius, day = h.params.day;
    const meter = (f: number): InsideMeterable => ({
      habitat: h, emission: sunlineEmission(h, day.length * day.daylight * f), norm: sunlineNorm(h),
      extinction: Math.log(4) / h.params.air.hazeDistance, sky: 0.35, hazeLuminance: 0.67,
    });
    const mid = (p.floorStart + p.floorEnd) / 2;
    // Mid-morning, from near the axis over the foot of the wild endcap, looking along the tube toward the sun.
    const hub = toWorld(p, { theta: 0, s: p.floorStart, h: 0.9 * R });
    const tube = insideGlare(meter(0.25), hub, view(hub, toWorld(p, { theta: 0.02, s: p.floorStart + 3 * R, h: 0 })));
    // On foot over the middle of the floor, looking along it, at every hour.
    const foot = toWorld(p, { theta: 0, s: mid, h: 1.7 });
    const along = [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => insideGlare(meter(f), foot, view(foot, toWorld(p, { theta: 0, s: mid + 3 * R, h: 0 }))));
    const all = [tube, ...along];
    assert.ok(all.every((g) => g > 0.2 && g <= 1), `the eyes only stop down, never shut (${all.map((g) => g.toFixed(2))})`);
    assert.ok(tube <= along[1], `from the axis toward the sun at least as much as on the floor (×${tube.toFixed(2)} against ×${along[1].toFixed(2)})`);
    assert.equal(along[1], 1, 'on foot along the floor in the morning they stay open');
    // Where the air across the habitat is thick enough to glow (a tenth of the haze distance or more), the axis glares.
    // Against the land itself (the view meters it so): standing on the wild endcap near its tip, looking down the tube,
    // the land close to the axis is lit many times the floor's light, and the eyes stop down at least as much.
    const terrain = terrainOf(name), tip = p.floorStart * 0.05, onTip = toWorld(p, { theta: 0, s: tip, h: terrain.heightAt(0, tip) + 2 });
    const down = view(onTip, toWorld(p, { theta: 0.3, s: mid, h: 0 })), landed = { ...meter(0.25), heightAt: terrain.heightAt };
    const seen = down.map((d) => insideRayLuminance(landed, onTip, d));
    assert.ok(seen.every((l) => Number.isFinite(l) && l >= 0), 'every ray sees something finite');
    assert.equal(glareOf(seen), insideGlare(landed, onTip, down));
    assert.ok(glareOf(seen) <= insideGlare(meter(0.25), onTip, down) + 0.02, 'the land near the axis only adds light');
    if ((2 * R) / h.params.air.hazeDistance >= 0.1) assert.ok(tube < 0.85, `from the axis the eyes stop down (×${tube.toFixed(2)})`);
  });
}

for (const { name, params } of MATRIX) {
  test(`eyes inside (${name}): a ray along the floor meets a ring rising across it, and sees its face`, () => {
    const h = derive(params), p = h.profile, R = h.radius, day = h.params.day;
    const mid = (p.floorStart + p.floorEnd) / 2, ringAt = mid + R, wide = 0.1 * R, tall = 0.1 * R;
    // A ring around the axis, a tenth of the radius high, R along the floor from the eye.
    const ring = (_theta: number, s: number): number => tall * Math.exp(-(((s - ringAt) / wide) ** 2));
    const meter: InsideMeterable = {
      habitat: h, emission: sunlineEmission(h, day.length * day.daylight * 0.5), norm: sunlineNorm(h),
      extinction: Math.log(4) / h.params.air.hazeDistance, sky: 0.35, hazeLuminance: 0.67,
    };
    const eye = toWorld(p, { theta: 0, s: mid, h: tall * 0.3 }), along: Vec3 = [0, 0, 1];
    const flat = insideRayLuminance({ ...meter, heightAt: () => 0 }, eye, along), ringed = insideRayLuminance({ ...meter, heightAt: ring }, eye, along);
    assert.ok(Number.isFinite(ringed) && ringed > 0);
    assert.ok(Math.abs(ringed - flat) > 1e-3 * Math.max(flat, 1e-3), `the ring is seen (${ringed.toFixed(3)} against ${flat.toFixed(3)} past it)`);
  });
}
