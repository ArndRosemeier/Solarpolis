import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, type Vec3 } from '../src/blueprint';
import { OPEN_SKY, horizonAt } from '../src/gen/horizon';
import type { Terrain } from '../src/gen/terrain';
import { dayLevel, dayPhase, emissionMean, irradiance, lightShares, lightVector, rawIrradiance, sunlineEmission, sunlineNorm, EMISSION_SAMPLES, SUNLINE_STEPS } from '../src/world/sunline';

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const e = new Float32Array(EMISSION_SAMPLES).fill(1); // the even sunline the scale is defined by
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

  test(`travelling sun (${name}): rises at the wild end, crosses to the port end, dims at night`, () => {
    const { length: day, daylight, night } = params.day;
    const brightest = (t: number): number => { const em = sunlineEmission(h, t); return em.indexOf(Math.max(...em)) / EMISSION_SAMPLES; };
    const at = (u: number): number => u * daylight * day;
    assert.ok(brightest(at(0.2)) < 0.35 && brightest(at(0.5)) > 0.4 && brightest(at(0.5)) < 0.6 && brightest(at(0.8)) > 0.65, 'wild → port');
    assert.ok(Math.abs(emissionMean(sunlineEmission(h, at(0.5))) - 1) < 0.02, 'full day: mean 1');
    const dark = sunlineEmission(h, day * (daylight + 1) / 2);
    assert.ok(Math.max(...dark) <= night + 1e-6 && Math.min(...dark) >= night - 1e-6, 'night: even and dim');
    // The light on the floor under the stretch beats the light far from it, and the day repeats.
    const noon = sunlineEmission(h, at(0.5));
    const under = irradiance(h, noon, [h.radius, 0, h.length / 2], [-1, 0, 0]), aside = irradiance(h, noon, [h.radius, 0, h.length * 0.1], [-1, 0, 0]);
    assert.ok(under > aside * 1.5, `${under} vs ${aside}`);
    assert.ok(Math.abs(dayPhase(h, 3 * day + 10) - dayPhase(h, 10)) < 1e-9, 'the day repeats');
    assert.ok(dayLevel(h, 0) < 0.1 && dayLevel(h, daylight / 2) === 1);
  });

  test(`sunline (${name}): one light vector stands in for the line on the floor`, () => {
    const h = derive(params);
    const noon = sunlineEmission(h, params.day.length * params.day.daylight * 0.5);
    const p: Vec3 = [h.radius, 0, h.length * 0.1];
    const v = lightVector(h, noon, p);
    // A floor facing the whole lit line: n · v is the light on it.
    assert.ok(Math.abs(-v[0] - irradiance(h, noon, p, [-1, 0, 0])) < 0.02 * irradiance(h, noon, p, [-1, 0, 0]), `${-v[0]}`);
    assert.ok(v[2] > 0, 'from the bright stretch, toward the middle');
  });

  test(`sunline (${name}): the light's equal shares lie along the axis, around where it comes from`, () => {
    const h = derive(params);
    const even = new Float32Array(EMISSION_SAMPLES).fill(1);
    const mid = lightShares(h, even, [h.radius, 0, h.length / 2], [-1, 0, 0], 6);
    assert.equal(mid.length, 6);
    assert.ok(Math.abs(mid.reduce((a, b) => a + b, 0)) < 0.02, 'symmetric in the middle');
    for (let k = 1; k < 6; k++) assert.ok(mid[k] > mid[k - 1], 'in order');
    assert.ok(mid[0] > -Math.PI / 2 && mid[5] < Math.PI / 2);
    const noon = sunlineEmission(h, params.day.length * params.day.daylight * 0.5);
    const near = lightShares(h, noon, [h.radius, 0, h.length * 0.1], [-1, 0, 0], 6);
    assert.ok(near[2] + near[3] > 0, 'near the wild end the light comes mostly from toward the port (the bright middle)');
  });
}
