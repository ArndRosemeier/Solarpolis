/** The skin from outside (src/gen/skin.ts), the habitat's outside distance, and the free camera outside (src/space/flyer.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, SUNLIGHT_VISIBLE, derive, exteriorDistance, isValid, validate, withParams } from '../src/blueprint';
import { columnsOf, isCollector, lookOf, makeSkin, panelAt, panelOf, skinFlux, type Columns } from '../src/gen/skin';
import { MAX_RANGE, MIN_CLEARANCE, SpaceFlyer } from '../src/space';
import type { Vec3 } from '@futuremagic/core';

const near = (got: number, want: number, tol: number, what: string): void =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} ± ${tol}`);

test('collectors: they take the share of the skin the piped light needs, and too much piped light is refused', () => {
  const h = derive(REFERENCE);
  const piped = h.collectorShare * h.sunlight * SUNLIGHT_VISIBLE * REFERENCE.collectorEfficiency;
  near(piped / (REFERENCE.pipedLight * h.lightPower), 1, 1e-12, 'collectors deliver the piped light');
  near(h.solarPower, h.sunlight * (1 - h.collectorShare) * REFERENCE.solarEfficiency, 1, 'the rest is solar cells');
  const greedy = derive(withParams({ pipedLight: 1, collectorEfficiency: 0.1 }));
  assert.ok(validate(greedy).some((f) => f.id === 'collectors' && f.severity === 'invalid'));
});

for (const { name, params } of MATRIX) {
  const h = derive(params), s = makeSkin(h), x = h.exterior;

  test(`skin (${name}): panels of the given size, collector columns at the derived share, starfloors at theirs`, () => {
    near((2 * Math.PI * x.radius) / s.nTheta, params.exterior.panel, params.exterior.panel * 0.15, 'panel width (m)');
    near((x.portFace - x.wildFace) / s.nZ, params.exterior.panel, params.exterior.panel * 0.5, 'panel height (m)');
    let collectors = 0;
    for (let i = 0; i < s.nTheta; i++) if (isCollector(s, i)) collectors++;
    near(collectors / s.nTheta, h.collectorShare, 1 / s.nTheta + 1e-3, 'collector share');
    let cells = 0, starfloors = 0, oldest = 0;
    const step = Math.max(1, Math.floor((s.nTheta * s.nZ) / 200000));
    for (let k = 0; k < s.nTheta * s.nZ; k += step) {
      const p = panelAt(s, k % s.nTheta, Math.floor(k / s.nTheta));
      assert.ok(p.age >= 0 && p.age <= params.age, `age ${p.age}`);
      oldest = Math.max(oldest, p.age);
      if (p.kind !== 'collector') cells++;
      if (p.kind === 'starfloor') starfloors++;
    }
    near(starfloors / cells, params.exterior.starfloors, Math.max(0.002, 4 * Math.sqrt(params.exterior.starfloors / cells)), 'starfloor share');
    assert.ok(oldest > params.age * 0.8, 'some patches are as old as the habitat');
    assert.deepEqual(panelAt(makeSkin(derive(params)), 3, 5), panelAt(s, 3, 5), 'same seed, same panel');
  });

  test(`skin (${name}): a point on the drum finds its panel, and old cells look bluer than new ones`, () => {
    for (const [i, j] of [[0, 0], [s.nTheta - 1, s.nZ - 1], [Math.floor(s.nTheta / 3), Math.floor(s.nZ / 2)]]) {
      const a = ((i + 0.5) / s.nTheta) * 2 * Math.PI, z = s.z0 + ((j + 0.5) / s.nZ) * (s.z1 - s.z0);
      assert.deepEqual(panelOf(s, [x.radius * Math.cos(a), x.radius * Math.sin(a), z]), { i, j });
    }
    assert.equal(panelOf(s, [x.radius, 0, s.z1 + 1]), null);
    const young = lookOf(s, { kind: 'cell', age: 0, shade: 0.5 }), old = lookOf(s, { kind: 'cell', age: 300, shade: 0.5 });
    assert.ok(old.albedo[2] > young.albedo[2] * 2 && old.albedo[2] > old.albedo[0], 'weathered cells turn blue');
  });

  test(`skin (${name}): a far drum's light is the Lambert cylinder's when it is all one matt colour`, () => {
    const a = 0.1, cols: Columns = { albedo: new Float32Array(s.nTheta * 3).fill(a), gloss: new Float32Array(s.nTheta), mean: { albedo: [a, a, a], gloss: 0, emit: 0 } };
    const d = 1e7;
    for (const alpha of [0, 0.5, 1.5, 2.5]) {
      const sun: Vec3 = [1, 0, 0], eye: Vec3 = [Math.cos(alpha), Math.sin(alpha), 0];
      const want = (a * x.radius * (s.z1 - s.z0) * ((Math.PI - alpha) * Math.cos(alpha) + Math.sin(alpha))) / (2 * Math.PI * d * d);
      near(skinFlux(s, cols, sun, eye, d, 1)[0] / want, 1, 0.01, `phase angle ${alpha}`);
    }
    // The real skin: its glint of the Sun moves along the columns as the drum turns, so the light flickers.
    const real = columnsOf(s), flux: number[] = [];
    for (let k = 0; k < 64; k++) {
      const t = (k / 64) * 2 * Math.PI, sun: Vec3 = [Math.cos(t), Math.sin(t), 0], eye: Vec3 = [Math.cos(t + 0.3), Math.sin(t + 0.3), 0];
      flux.push(skinFlux(s, real, sun, eye, d, 1)[1]);
    }
    assert.ok(Math.max(...flux) > Math.min(...flux) * 1.02, 'it flickers as it turns');
  });

  test(`outside distance (${name}): off the drum, past the brim tips and down the axis`, () => {
    const mid = (x.wildFace + x.portFace) / 2;
    near(exteriorDistance(x, [x.radius + 50, 0, mid]), 50, 1e-6, 'above the drum');
    assert.ok(exteriorDistance(x, [x.radius - 10, 0, mid]) < 0, 'inside is negative');
    const b = x.brims[0];
    near(exteriorDistance(x, [0, b.tip + 20, b.z]), 20, 1e-6, 'past a brim tip');
    near(exteriorDistance(x, [0, 0, x.spindle.to + 30]), 30, 1e-6, 'beyond the spindle');
    near(exteriorDistance(x, [0, 0, x.mast.from - 30]), 30, 1e-6, 'beyond the mast');
  });

  test(`fly camera (${name}): full speed at the drum stops a metre off it, and it never leaves the range`, () => {
    const mid = (x.wildFace + x.portFace) / 2;
    const clearance = (p: Vec3): number => exteriorDistance(x, [p[0], p[1], p[2] + mid]);
    const f = new SpaceFlyer([x.radius * 40, 0, 0], [-1, 0, 0]);
    let steps = 0;
    for (; steps < 20000 && clearance(f.eye) > MIN_CLEARANCE * 1.01; steps++) {
      f.step({ forward: 1, right: 0, up: 0, fast: true }, 1 / 60, clearance);
      assert.ok(clearance(f.eye) >= MIN_CLEARANCE * (1 - 1e-6), `too close: ${clearance(f.eye)}`);
    }
    assert.ok(steps < 20000 && steps / 60 < 60, `reached the hull from 40 radii in ${(steps / 60).toFixed(0)} s`);
    near(SpaceFlyer.speed(1000, false) / SpaceFlyer.speed(100, false), 10, 1e-9, 'speed grows with the clearance');
    const out = new SpaceFlyer([MAX_RANGE * 0.99, 0, 0], [1, 0, 0]);
    for (let k = 0; k < 200; k++) out.step({ forward: 1, right: 0, up: 0, fast: true }, 0.1, (p) => Math.hypot(...p) - x.radius);
    assert.ok(Math.hypot(...out.eye) <= MAX_RANGE * (1 + 1e-9));
  });
}

test('the matrix stays buildable with the collectors taking their share', () => {
  for (const { name, params } of MATRIX) assert.ok(isValid(validate(derive(params))), name);
});
