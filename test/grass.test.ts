import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_FORMS, FLOOR_LAYERS, MATRIX, fromWorld, toWorld } from '../src/blueprint';
import { nearestFloor } from '../src/gen/ecology';
import { buildTuft, type TuftMesh } from '../src/gen/grass';
import { COVER_FADE, LEVELS, cellBounds, cellsNear, coverChance, plantCell, plantsOf, PLANT_STRIDE } from '../src/gen/scatter';
import { climateOf, ecologyOf } from './worlds';

const tris = (m: TuftMesh) => m.index.length / 3;

for (const form of COVER_FORMS) {
  test(`grass (${form}): full and light tufts one unit high, finite, in budget, lit from above, the same each time`, () => {
    const t = buildTuft(form, [0.2, 0.3, 0.1], 5, 0);
    for (const m of [t.full, t.lite]) {
      const verts = m.positions.length / 3;
      for (const a of [m.positions, m.normals, m.colors, m.wind]) assert.ok(a.every(Number.isFinite), 'finite');
      assert.equal(m.normals.length, verts * 3);
      assert.equal(m.colors.length, verts * 3);
      assert.equal(m.wind.length, verts);
      for (const i of m.index) assert.ok(i < verts, 'index in range');
      for (let v = 0; v < verts; v++) {
        assert.ok(Math.abs(Math.hypot(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]) - 1) < 1e-4, 'unit normals');
        assert.ok(m.normals[v * 3 + 1] > 0.5, 'normals lean up, so a tuft takes the light as the ground does');
      }
      assert.ok(m.colors.every((c) => c >= 0 && c <= 1) && m.wind.every((w) => w >= 0 && w <= 1), 'colours, sway weights');
      // Sunk into the ground a little at the base, nothing far below it.
      assert.ok(Math.min(...m.positions.filter((_, i) => i % 3 === 1)) > -0.1, 'base just below the ground');
    }
    const top = Math.max(...t.full.positions.filter((_, i) => i % 3 === 1));
    assert.ok(Math.abs(top - 1) < 1e-6, `one unit high: ${top}`);
    assert.ok(tris(t.full) <= 160 && tris(t.lite) <= 30 && tris(t.lite) < tris(t.full) / 3, `${tris(t.full)} and ${tris(t.lite)} triangles`);
    assert.deepEqual(buildTuft(form, [0.2, 0.3, 0.1], 5, 0).full.positions, t.full.positions, 'same seed, same tuft');
    assert.notDeepEqual(buildTuft(form, [0.2, 0.3, 0.1], 5, 1).full.positions, t.full.positions, 'another variant, another tuft');
  });
}

for (const { name } of MATRIX) {
  test(`grass (${name}): cover grows where its floor layer is, as densely as the layer covers the ground`, () => {
    const eco = ecologyOf(name), h = eco.terrain.habitat, plants = plantsOf(eco), { profile } = h;
    const cover = plants.filter((p) => p.what === 'cover');
    assert.equal(cover.length, eco.climate.cover.length, 'every cover of the climate');
    const s = (profile.floorStart + profile.floorEnd) / 2, eye = toWorld(profile, { theta: 1, s, h: 1.7 });
    for (const sp of cover) {
      assert.equal(FLOOR_LAYERS[sp.on], (sp.spec as { on: string }).on);
      assert.equal(sp.band.length, COVER_FADE.length, 'drawn at the near levels only');
      assert.equal(cellsNear(eco, sp, (LEVELS.length - 1) as 2, eye).length, 0, 'no far cells');
      const chance = coverChance(eco, sp.on);
      let tufts = 0, want = 0;
      for (const { key } of cellsNear(eco, sp, 0, eye).slice(0, 3)) {
        const c = plantCell(eco, plants, key), b = cellBounds(eco, sp, key);
        assert.deepEqual(plantCell(eco, plants, { ...key, level: 1 }).instances, c.instances, 'both levels plant the same tufts');
        for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
          const p = fromWorld(profile, c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]);
          assert.ok(Math.abs(p.h - eco.terrain.heightAt(p.theta, p.s)) < 0.02, 'on the ground');
          assert.ok(eco.terrain.standAt(p.theta, p.s) <= p.h + 0.05, 'not under water');
          tufts++;
        }
        // The expected count: the layer's share over the cell, a tuft per spacing squared.
        const r = profile.at((b.s0 + b.s1) / 2).r, n = 8, gap = sp.spec.spacing;
        let share = 0;
        for (let a = 0; a < n; a++) for (let k = 0; k < n; k++) share += chance(b.theta0 + ((a + 0.5) / n) * (b.theta1 - b.theta0), b.s0 + ((k + 0.5) / n) * (b.s1 - b.s0));
        want += (share / (n * n)) * ((b.theta1 - b.theta0) * r * (b.s1 - b.s0)) / (gap * gap);
      }
      assert.ok(Math.abs(tufts - want) <= want * 0.15 + 30, `${sp.spec.name}: ${tufts} tufts where the floor says ${want.toFixed(0)}`);
    }
  });
}

test('grass: the floor layer is read the same whichever cell asks, between its lattice points smoothly', () => {
  const eco = ecologyOf(MATRIX[0].name), { profile } = eco.terrain.habitat;
  const layer = FLOOR_LAYERS.indexOf('grass'), a = coverChance(eco, layer), b = coverChance(eco, layer);
  const s0 = (profile.floorStart + profile.floorEnd) / 2;
  let last = a(0.5, s0);
  for (let k = 1; k < 200; k++) {
    const s = s0 + k * 0.05, v = a(0.5, s);
    assert.ok(v >= 0 && v <= 1);
    assert.equal(b(0.5, s), v, 'the same from another reading');
    assert.ok(Math.abs(v - last) < 0.2, `smooth at ${s}: ${last} → ${v}`);
    last = v;
  }
});

test('grass: no grass on bare rock, at the waterline or on the lake bed; dry grass in the mediterranean', () => {
  const eco = ecologyOf(MATRIX[0].name), lake = eco.terrain.lake;
  const grass = coverChance(eco, FLOOR_LAYERS.indexOf('grass'));
  if (lake) for (const theta of [0, 1.3, 2.9]) assert.ok(grass(theta, lake.s) < 0.05, 'none in the lake');
  // A meadow is found (the debug menu goes there), and grass grows thick in it.
  const { profile } = eco.terrain.habitat, mid = (profile.floorStart + profile.floorEnd) / 2;
  const m = nearestFloor(eco, 0.3, mid, 'grass');
  assert.ok(m, 'a meadow near the middle of the floor');
  const r = profile.at(m.s).r;
  assert.ok(grass(m.theta + (m.way[0] * 10) / r, m.s + m.way[1] * 10) > 0.6, 'thick grass 10 m in');
  const med = climateOf('mediterranean');
  assert.deepEqual(plantsOf(med).filter((p) => p.what === 'cover').map((p) => p.spec.form), ['dry-grass']);
});
