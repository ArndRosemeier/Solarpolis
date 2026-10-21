import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { MATRIX, STYLE_LAND, derive } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { planOf } from '../src/gen/plan';

for (const { name, params } of MATRIX) {
  test(`districts (${name}): each district grows its land in its style, and belts of trees mark the borders`, () => {
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
