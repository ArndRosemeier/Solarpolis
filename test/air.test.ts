import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, type Vec3 } from '../src/blueprint';
import { densityFalloff, hazeAlong, HAZE_STEPS } from '../src/world/air';
import { sunlineEmission } from '../src/world/sunline';

const EXT = Math.log(4) / 20000, SKY = 0.35;

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const e = sunlineEmission(h);

  test(`haze (${name}): plain fog along the floor, a halo across the axis, the shaders' pieces agree`, () => {
    // Along the floor in the middle: density 1, source 1, so the air adds exactly what it takes away.
    const eye: Vec3 = [h.radius - 2, 0, h.length * 0.4], to: Vec3 = [h.radius - 2, 0, h.length * 0.6];
    const flat = hazeAlong(h, e, EXT, SKY, eye, to);
    assert.ok(Math.abs(flat.transmittance - Math.exp(-EXT * h.length * 0.2)) < 0.02, `T ${flat.transmittance}`);
    assert.ok(Math.abs(flat.inscatter - (1 - flat.transmittance)) < 0.03, `in ${flat.inscatter}`);
    // Across the habitat, just past the axis: thinner air (more light through), but the halo adds glow.
    const far: Vec3 = [-h.radius * Math.cos(0.02), -h.radius * Math.sin(0.02), h.length * 0.5];
    const near: Vec3 = [h.radius, 0, h.length * 0.5];
    const across = hazeAlong(h, e, EXT, SKY, near, far);
    assert.ok(across.transmittance >= Math.exp(-EXT * 2 * h.radius) - 1e-9, 'the air near the axis is no denser');
    const fine = hazeAlong(h, e, EXT, SKY, near, far, 4000);
    assert.ok(Math.abs(across.inscatter - fine.inscatter) < 0.1 * fine.inscatter + 1e-4, `${HAZE_STEPS} pieces ${across.inscatter} vs ${fine.inscatter}`);
    assert.ok(Math.abs(across.transmittance - fine.transmittance) < 0.01);
    assert.ok(densityFalloff(h) > 0, 'thinner toward the axis');
  });
}
