import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIMATES, MATRIX, derive, validate, withParams, type HabitatParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { CLOSED_RAISE, UNDER_CROWNS, crownsClosed, makeEcology, type Ecology } from '../src/gen/ecology';
import { insideExposure, underCrowns } from '../src/render/exposure';

/** A grid of points over the whole interior: (θ, s, height, slope of the profile). */
function sample(eco: Ecology, around = 24, along = 60): { theta: number; s: number; h: number; slope: number }[] {
  const t = eco.terrain, { profile } = t.habitat, out = [];
  for (let j = 0; j < along; j++) {
    const s = ((j + 0.5) / along) * profile.length, slope = Math.abs(profile.at(s).nz);
    for (let i = 0; i < around; i++) {
      const theta = ((i + 0.5) / around) * 2 * Math.PI;
      out.push({ theta, s, h: t.heightAt(theta, s), slope });
    }
  }
  return out;
}

const habitats: { name: string; params: HabitatParams }[] = [
  ...MATRIX,
  ...Object.keys(CLIMATES).filter((c) => c !== MATRIX[0].params.climate).map((climate) => ({ name: `reference, ${climate}`, params: withParams({ climate }) })),
];

for (const { name, params } of habitats) {
  test(`ecology (${name}): planted patches with clear edges, several biomes, the same every time`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), again = makeEcology(makeTerrain(h));
    const n = eco.climate.biomes.length, w = new Float32Array(n), w2 = new Float32Array(n);
    const cover = new Array<number>(n).fill(0);
    let clear = 0;
    const points = sample(eco);
    for (const p of points) {
      eco.biomesAt(p.theta, p.s, p.h, p.slope, w);
      again.biomesAt(p.theta, p.s, p.h, p.slope, w2);
      assert.deepEqual(w, w2, 'same habitat, same biomes');
      const sum = w.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-5 && w.every((x) => x >= 0), `shares sum to 1: ${[...w]}`);
      const top = w.indexOf(Math.max(...w));
      cover[top]++;
      if (w[top] > 0.8) clear++;
    }
    const used = cover.filter((c) => c / points.length > 0.02).length;
    assert.ok(used >= 3, `at least three biomes show: ${eco.climate.biomes.map((b, i) => `${b.name} ${(cover[i] / points.length * 100).toFixed(0)}%`).join(', ')}`);
    assert.ok(clear / points.length > 0.6, `most of the land is clearly one biome: ${(clear / points.length * 100).toFixed(0)}%`);
  });
}

for (const { name, params } of MATRIX) {
  test(`ecology (${name}): wetter by the lake, drier up the endcaps, high biomes high up`, () => {
    const h = derive(params), t = makeTerrain(h), eco = makeEcology(t), { profile } = h;
    const floorMid = (profile.floorStart + profile.floorEnd) / 2;
    const mean = (s: number): number => { let m = 0; for (let i = 0; i < 16; i++) { const th = (i / 16) * 2 * Math.PI; m += eco.moistureAt(th, s, t.heightAt(th, s)); } return m / 16; };
    if (t.lake) {
      const shore = t.lake.s - t.lake.halfWidth - 1, far = t.lake.s > floorMid ? profile.floorStart + (t.lake.s - profile.floorStart) * 0.2 : profile.floorEnd - (profile.floorEnd - t.lake.s) * 0.2;
      assert.ok(mean(shore) > mean(far) + 0.1, `shore ${mean(shore)} vs far ${mean(far)}`);
    }
    // High up an endcap (half way from the floor to the axis) it is drier than on the floor.
    let s = profile.floorStart;
    while (s > 0 && profile.at(s).r > h.radius / 2) s -= profile.length / 400;
    assert.ok(mean(s) < mean(floorMid) - 0.1, `endcap ${mean(s)} vs floor ${mean(floorMid)}`);
    const w = new Float32Array(eco.climate.biomes.length);
    eco.biomesAt(0, s, t.heightAt(0, s), 0.3, w);
    const top = eco.climate.biomes[w.indexOf(Math.max(...w))];
    assert.ok(top.height[1] >= 0.4, `${top.name} grows up there (its heights ${top.height})`);
  });
}

test('ecology: an unknown climate is an invalid habitat', () => {
  const findings = validate(derive(withParams({ climate: 'no such climate' })));
  assert.ok(findings.some((f) => f.id === 'climate' && f.severity === 'invalid'));
  assert.ok(!validate(derive(MATRIX[0].params)).some((f) => f.id === 'climate'));
});

for (const { name, params } of MATRIX) {
  test(`ecology (${name}): closed woods shade, open land does not, and the eyes open up under them`, () => {
    const eco = makeEcology(makeTerrain(derive(params)));
    const color = new Float32Array(3), canopy = new Float32Array(4);
    let open = 0, closed = 0;
    for (const p of sample(eco, 16, 40)) {
      eco.colorAt(p.theta, p.s, p.h, p.slope, color, 0, canopy);
      const c = crownsClosed(canopy[3]);
      assert.ok(c >= 0 && c <= 1);
      if (c === 0) open++;
      if (c > 0.9) closed++;
    }
    assert.ok(open > 0 && closed > 0, `open land (${open}) and closed woods (${closed}) both exist`);
    assert.equal(crownsClosed(0), 0);
    assert.equal(crownsClosed(CLOSED_RAISE), 1);
    // The eyes: unchanged in the open, more open under closed crowns, but not all the way.
    const sky = 0.35, shade = underCrowns(1, sky, UNDER_CROWNS);
    assert.equal(underCrowns(0, sky, UNDER_CROWNS), 1);
    assert.equal(insideExposure(1), 1);
    assert.ok(insideExposure(shade) > 1.5 && insideExposure(shade) < 1 / shade, `${insideExposure(shade)} under crowns letting ${shade} through`);
  });
}
