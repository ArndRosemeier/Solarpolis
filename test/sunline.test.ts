import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, type Vec3 } from '../src/blueprint';
import { OPEN_SKY, horizonAt } from '../src/gen/horizon';
import type { Terrain } from '../src/gen/terrain';
import { irradiance, rawIrradiance, sunlineEmission, sunlineNorm, SUNLINE_STEPS } from '../src/world/sunline';

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const e = sunlineEmission(h);
  const floorAt = (z: number): { p: Vec3; n: Vec3 } => ({ p: [h.radius, 0, z], n: [-1, 0, 0] });

  test(`sunline (${name}): 1 at mid floor, even both ways, dimmer toward the walls, the shaders' sum agrees`, () => {
    const mid = floorAt(h.length / 2);
    assert.ok(Math.abs(irradiance(h, e, mid.p, mid.n) - 1) < 1e-3);
    const near = floorAt(h.length * 0.2), far = floorAt(h.length * 0.8);
    assert.ok(Math.abs(irradiance(h, e, near.p, near.n) - irradiance(h, e, far.p, far.n)) < 1e-6, 'symmetric');
    assert.ok(irradiance(h, e, floorAt(h.radius * 0.05).p, mid.n) < 0.8, 'a point by the wall sees only half the tube');
    // The shaders sample the integral SUNLINE_STEPS times; it must stay within a few percent of the reference.
    const norm = sunlineNorm(h);
    for (const [p, n] of [[mid.p, mid.n], [floorAt(h.length * 0.1).p, mid.n], [[h.radius * 0.5, 0, h.length * 0.02], [-0.6, 0, 0.8]]] as [Vec3, Vec3][]) {
      const exact = rawIrradiance(h, e, p, n) * norm, coarse = rawIrradiance(h, e, p, n, OPEN_SKY, OPEN_SKY, SUNLINE_STEPS) * norm;
      assert.ok(Math.abs(coarse - exact) < 0.03 * Math.max(exact, 0.1), `${coarse} vs ${exact}`);
    }
    // Horizons only take light away; closed both ways, none is left.
    assert.ok(irradiance(h, e, mid.p, mid.n, 0.5, 0.5) < irradiance(h, e, mid.p, mid.n));
    assert.equal(irradiance(h, e, mid.p, mid.n, 0, 0), 0);
  });

  test(`horizon (${name}): a wall cuts the sunline off where the line over its top meets the axis`, () => {
    const { profile } = h;
    const s = (profile.floorStart + profile.floorEnd) / 2, height = h.radius * 0.02, gap = height / 2;
    // A plateau from `gap` to 50 heights out toward the port end, on otherwise flat ground.
    const terrain = { habitat: h, heightAt: (_t: number, si: number) => (si >= s + gap && si <= s + 50 * height ? height : 0) } as unknown as Terrain;
    const [port, wild] = horizonAt(terrain, 0.3, s);
    // The nearest sample past the plateau's edge decides: between `gap` and one geometric step further.
    assert.ok(port >= Math.atan(gap / height) - 1e-9 && port <= Math.atan((gap * 1.45 + 1) / height), `port ${port}`);
    assert.ok(wild > port && wild <= OPEN_SKY, `wild ${wild}`);
  });
}
