import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { CLIMATES, MATRIX, STYLE_LAND, derive, validate, withParams, type HabitatParams } from '../src/blueprint';
import { planOf } from '../src/gen/plan';
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

for (const { name, params } of MATRIX) {
  test(`ecology (${name}): the Gate's faces read from afar by what they are made of`, () => {
    const h = derive(params), t = makeTerrain(h), eco = makeEcology(t), { profile } = h, form = t.form;
    const s = profile.floorEnd + (profile.length - profile.floorEnd) * 0.5;
    const out = new Float32Array(3), lum = () => 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    const sums: Record<string, { rock: number; green: number; n: number }> = {};
    for (let i = 0; i < 720; i++) {
      const theta = (i / 720) * 2 * Math.PI, { valley, across } = form.acrossAt(theta, s);
      if (Math.abs(across) > 0.5) continue;
      const kind = form.faces[valley].kind, g = (sums[kind] ??= { rock: 0, green: 0, n: 0 });
      eco.colorAt(theta, s, t.heightAt(theta, s), 1, out, 0); // a wall: all rock, but for vines
      g.rock += lum(); g.green += out[1] - (out[0] + out[2]) / 2; g.n++;
    }
    const mean = (k: string, f: 'rock' | 'green') => sums[k] ? sums[k][f] / sums[k].n : NaN;
    const rock = climateRock(params);
    if (sums.stair) assert.ok(mean('stair', 'rock') > rock * 1.2, `the Stair face is paler dressed stone (${mean('stair', 'rock').toFixed(3)} against rock ${rock.toFixed(3)})`);
    if (sums.water) assert.ok(mean('water', 'rock') < rock * 0.8, `the Water face is dark wet rock (${mean('water', 'rock').toFixed(3)})`);
    if (sums.vine) assert.ok(mean('vine', 'green') > 0.02, `the Vine face is green over its walls (${mean('vine', 'green').toFixed(3)})`);
    assert.ok(Object.keys(sums).length >= 2, `faces of at least two kinds round the Gate (${Object.keys(sums)})`);
  });
}

/** The luminance of a habitat's climate's rock. */
function climateRock(params: HabitatParams): number {
  const r = CLIMATES[params.climate].rock;
  return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
}

for (const { name, params } of MATRIX) {
  test(`ecology (${name}): each district grows its land in its style, and belts of trees mark the borders`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), plan = planOf(h), t = eco.terrain;
    const patch = eco.climate.patch * h.radius, out = new Float32Array(3), wood = new Float32Array(2);
    const coverAt = (theta: number, s: number): number => {
      eco.colorAt(theta, s, t.heightAt(theta, s), 0.05, out, 0, undefined, undefined, wood);
      return wood[0];
    };
    const rng = new Rng(7);
    // Inside its districts (away from their borders), a wooded style holds more woods than an open one.
    const inside = { wooded: [] as number[], open: [] as number[] };
    for (const d of plan.districts.slice(0, 40)) {
      const want = STYLE_LAND[d.style].cover;
      if (want === null || (want > 0.2 && want < 0.8)) continue;
      for (let n = 0; n < 24; n++) {
        const theta = d.theta + rng.range(-1, 1) * (patch * 0.5) / h.radius, s = d.s + rng.range(-1, 1) * patch * 0.5;
        const b = plan.borderAt(theta, s);
        if (!b || b.district !== d || b.edge < patch * 0.05) continue;
        (want >= 0.8 ? inside.wooded : inside.open).push(coverAt(theta, s));
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    if (inside.wooded.length > 20 && inside.open.length > 20) assert.ok(mean(inside.wooded) > mean(inside.open) + 0.25, `woods ${mean(inside.wooded).toFixed(2)} in wooded districts, ${mean(inside.open).toFixed(2)} in open ones`);
    // Right on a border between two districts that are not woods, trees stand more than inside the open districts.
    const border: number[] = [];
    for (let n = 0; n < 10000 && border.length < 60; n++) {
      const theta = rng.range(0, 2 * Math.PI), s = rng.range(plan.reserveEnd, h.profile.floorEnd), b = plan.borderAt(theta, s);
      if (!b || b.edge > patch * 0.012 || b.other === b.district) continue;
      const a = STYLE_LAND[b.district.style].cover, c = STYLE_LAND[b.other.style].cover;
      if (a !== null && a < 0.8 && c !== null && c < 0.8) border.push(coverAt(theta, s));
    }
    if (border.length > 15 && inside.open.length > 20) assert.ok(mean(border) > mean(inside.open) + 0.15, `belts ${mean(border).toFixed(2)} against ${mean(inside.open).toFixed(2)} inside open districts`);
    assert.ok(plan.districts.length < 3 || inside.open.length + inside.wooded.length > 0, 'some districts checked');
  });
}
