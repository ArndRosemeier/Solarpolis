import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { FLOOR_LAYERS, MATRIX, STYLE_LAND } from '../src/blueprint';
import { COURT, courtOf, planOf } from '../src/gen/plan';
import { ecologyOf } from './worlds';

for (const { name } of MATRIX) {
  test(`districts (${name}): each district grows its land in its style, and belts of trees mark the borders`, () => {
    const eco = ecologyOf(name), h = eco.terrain.habitat, plan = planOf(h), t = eco.terrain;
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

for (const { name, params } of MATRIX) {
  test(`districts (${name}): an entrance's court is paved, with no crowns over it or its clear ring`, () => {
    if (!params.landmarks) return;
    const eco = ecologyOf(name), h = eco.terrain.habitat, t = eco.terrain, plan = planOf(h), R = h.radius;
    const out = new Float32Array(3), wood = new Float32Array(2), floor = new Uint8Array(FLOOR_LAYERS.length);
    const gravel = FLOOR_LAYERS.indexOf('gravel');
    for (const site of plan.sites.filter((k) => k.kind === 'entrance').slice(0, 10)) {
      const c = courtOf(h, site)!, reach: number = c.radius + COURT.clear * params.landmarks.handrail;
      for (const [d, a] of [[0, 0], [c.radius * 0.5, 1], [c.radius * 0.8, 2.5], [reach * 0.97, 4]] as [number, number][]) {
        const theta = c.theta + (d * Math.cos(a)) / R, s = c.s + d * Math.sin(a);
        eco.colorAt(theta, s, t.heightAt(theta, s), 0.05, out, 0, undefined, floor, wood);
        assert.equal(wood[0], 0, `no crowns ${d.toFixed(1)} m from the court's middle`);
        if (d < c.radius * 0.9) assert.ok(floor[gravel] > 200, 'paved');
      }
    }
  });
}
