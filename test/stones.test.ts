import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, toWorld, withParams, type DebrisSpec } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { buildStone, type StoneMesh } from '../src/gen/stones';
import { buildFallenWood, BARK_STRIPS } from '../src/gen/trees';
import { LEVELS, cellsNear, plantCell, plantsOf, PLANT_STRIDE, type Level } from '../src/gen/scatter';
import { ecologyOf } from './worlds';

const tris = (m: { index: Uint32Array }) => m.index.length / 3;

test('stones: three levels of one lump, one unit high above the ground, closed, lit outward, mossy on top', () => {
  const s = buildStone([0.28, 0.26, 0.22], 1, 3, 0);
  const levels: StoneMesh[] = [s.full, s.lite, s.hull];
  assert.deepEqual(levels.map(tris), [1280, 80, 20]);
  for (const m of levels) {
    const n = m.positions.length / 3;
    for (const a of [m.positions, m.normals, m.colors]) assert.ok(a.every(Number.isFinite), 'finite');
    assert.ok(m.colors.every((c) => c >= 0 && c <= 1), 'colours');
    for (const i of m.index) assert.ok(i < n);
    // Every edge is shared by exactly two faces: no holes.
    const edges = new Map<string, number>();
    for (let f = 0; f < m.index.length; f += 3) for (let e = 0; e < 3; e++) {
      const a = m.index[f + e], b = m.index[f + ((e + 1) % 3)], k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    assert.ok([...edges.values()].every((c) => c === 2), 'closed');
    // Normals point away from the middle.
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += m.positions[i * 3]; cy += m.positions[i * 3 + 1]; cz += m.positions[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    let out = 0;
    for (let i = 0; i < n; i++) out += (m.positions[i * 3] - cx) * m.normals[i * 3] + (m.positions[i * 3 + 1] - cy) * m.normals[i * 3 + 1] + (m.positions[i * 3 + 2] - cz) * m.normals[i * 3 + 2] > 0 ? 1 : 0;
    assert.ok(out > n * 0.95, `${out} of ${n} normals point out`);
  }
  const ys = s.full.positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...ys) - 1) < 1e-6 && Math.min(...ys) < -0.1, 'one unit above the ground, sunk into it');
  // Moss: the top is greener than the side that meets the ground.
  const green = (top: boolean) => {
    let g = 0, k = 0;
    for (let i = 0; i < ys.length; i++) if (top ? s.full.normals[i * 3 + 1] > 0.8 : ys[i] < 0.1) { g += s.full.colors[i * 3 + 1] / (s.full.colors[i * 3] + 1e-3); k++; }
    return g / k;
  };
  assert.ok(green(true) > green(false), 'mossy on top');
  assert.deepEqual(buildStone([0.28, 0.26, 0.22], 1, 3, 0).full.positions, s.full.positions, 'same seed, same stone');
  assert.notDeepEqual(buildStone([0.28, 0.26, 0.22], 1, 3, 1).full.positions, s.full.positions, 'another variant, another stone');
});

for (const piece of ['log', 'branch'] as const) {
  test(`fallen wood (${piece}): one unit long, lying on the ground, in bark, still, fewer triangles farther out`, () => {
    const w = buildFallenWood('oak', piece, 5, 1);
    const levels = [w.full, w.lite, w.hull];
    assert.ok(tris(w.full) > tris(w.lite) && tris(w.lite) > tris(w.hull) && tris(w.full) <= 800, levels.map(tris).join(' > '));
    for (const m of levels) {
      for (const a of [m.positions, m.normals, m.uvs, m.occ]) assert.ok(a.every(Number.isFinite), 'finite');
      assert.ok(m.wind.every((x) => x === 0), 'does not sway');
      for (let i = 0; i < m.uvs.length; i += 2) assert.ok(m.uvs[i] >= 0 && m.uvs[i] < BARK_STRIPS * 16, 'bark strip');
      const xs = m.positions.filter((_, i) => i % 3 === 0), ys = m.positions.filter((_, i) => i % 3 === 1);
      assert.ok(Math.min(...xs) < -0.49 && Math.max(...xs) > 0.49, 'one unit long along x');
      assert.ok(Math.min(...ys) < 0 && Math.min(...ys) > -0.05, 'sunk a little into the ground');
      assert.ok(Math.max(...ys) < 0.25, 'lying down');
    }
  });
}

for (const { name } of MATRIX) {
  test(`debris (${name}): lies on its floor layer along the slope under it, seen as far as its size allows`, () => {
    const eco = ecologyOf(name), h = eco.terrain.habitat, plants = plantsOf(eco), { profile } = h;
    const debris = plants.filter((p) => p.what === 'debris');
    assert.equal(debris.length, eco.climate.debris.length);
    const by = (n: string) => debris.find((p) => p.spec.name === n)!;
    assert.ok(by('pebbles').seen < 150 && by('boulders').seen > 1000, `pebbles seen to ${by('pebbles').seen} m, boulders to ${by('boulders').seen} m`);
    for (const sp of debris) assert.equal(sp.band.length, LEVELS.length);
    // Where stones lie on the endcap's rocks and wood on the woods' floor, the slope each carries predicts the ground
    // a metre away (but where the rock is rough or a cliff, which it is clamped to).
    let checked = 0;
    const errors: number[] = [];
    for (const at of [profile.floorStart * 0.5, (profile.floorStart + profile.floorEnd) / 2]) {
      const eye = toWorld(profile, { theta: 0.4, s: at, h: 1.7 });
      for (const sp of debris) for (const { key } of cellsNear(eco, sp, 0 as Level, eye).slice(0, 2)) {
        const c = plantCell(eco, plants, key);
        for (const list of c.instances) for (let i = 0; i < list.length && checked < 400; i += PLANT_STRIDE * 3) {
          const w = [c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]] as const;
          const p = fromWorld(profile, w[0], w[1], w[2]);
          assert.ok(Math.abs(p.h - eco.terrain.heightAt(p.theta, p.s)) < 0.05, 'on the ground');
          const r = Math.hypot(w[0], w[1]), up = [-w[0] / r, -w[1] / r, 0], side = [up[1], -up[0], 0];
          // One metre around the axis and one along it, raised by the slope: about the ground there.
          for (const [dir, rise] of [[side, list[i + 5]], [[0, 0, 1], list[i + 6]]] as const) {
            const q = fromWorld(profile, w[0] + dir[0] + up[0] * rise, w[1] + dir[1] + up[1] * rise, w[2] + dir[2]);
            // Cliffs: clamped. Steep both ways at once counts too: the shear lifts only toward the axis, so on ground
            // that is steep along the axis and across it as well (an endcap's terrace riser running aslant) it can't follow.
            if (Math.hypot(list[i + 5], list[i + 6]) > 1.45) continue;
            errors.push(Math.abs(q.h - eco.terrain.heightAt(q.theta, q.s)));
          }
          checked++;
        }
      }
    }
    assert.ok(checked > 0, 'some debris checked');
    errors.sort((a, b) => a - b);
    const at = (q: number) => errors[Math.floor(q * (errors.length - 1))];
    assert.ok(at(0.5) < 0.03 && at(0.9) < 0.15, `a metre off, the ground is ${at(0.5).toFixed(3)} m (median), ${at(0.9).toFixed(3)} m (90 %) from where the slope says`);
  });
}

test('debris: the mediterranean has stones and fallen pine; every fallen piece names a tree', () => {
  const med = makeEcology(makeTerrain(derive(withParams({ climate: 'mediterranean' }))));
  const d = med.climate.debris as readonly DebrisSpec[];
  assert.ok(d.some((x) => x.form === 'stone') && d.some((x) => x.form === 'log'));
  for (const eco of [med, ecologyOf(MATRIX[0].name)]) for (const x of eco.climate.debris) if (x.form !== 'stone') assert.ok(x.wood, `${x.name} names its tree`);
});
