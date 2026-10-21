import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIMATES, MATRIX, derive, fromWorld, toWorld, withParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { buildPlant, PLANT_VARIANTS, type PlantMesh } from '../src/gen/plants';
import { cellBounds, cellsNear, plantCell, plantsOf, PLANT_STRIDE, type Species } from '../src/gen/scatter';

/** Share of triangles whose winding faces the way their vertex normals do (outward). */
function outward(m: PlantMesh): number {
  let good = 0, all = 0;
  const p = m.positions, n = m.normals;
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t] * 3, m.index[t + 1] * 3, m.index[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(f[0], f[1], f[2]) < 1e-12) continue;
    const s = [0, 1, 2].map((k) => n[a + k] + n[b + k] + n[c + k]);
    all++;
    if (f[0] * s[0] + f[1] * s[1] + f[2] * s[2] > 0) good++;
  }
  return good / all;
}

/** Signed volume of a mesh: positive when its triangles wind outward. */
function volume(m: PlantMesh): number {
  let v = 0;
  const p = m.positions;
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t] * 3, m.index[t + 1] * 3, m.index[t + 2] * 3];
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

for (const climate of Object.values(CLIMATES)) {
  test(`plants (${climate.name}): every plant builds near and far, one unit high, facing out, the same each time`, () => {
    for (const b of climate.biomes) for (const spec of b.plants) for (let v = 0; v < PLANT_VARIANTS; v++) {
      const near = buildPlant(spec, 1, v, 'near'), far = buildPlant(spec, 1, v, 'far');
      for (const [m, most] of [[near, 3500], [far, 400]] as const) {
        const tris = m.index.length / 3;
        assert.ok(tris > 0 && tris <= most, `${spec.name} ${tris} triangles (at most ${most})`);
        assert.ok(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite) && m.colors.every((c) => c >= 0 && c <= 1), `${spec.name}: finite, colours in range`);
        let top = 0;
        for (let i = 1; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]);
        assert.ok(top > 0.5 && top < 1.15, `${spec.name} stands about one unit high: ${top}`);
        // Wound outward: the signed volume is positive; foliage normals are bent outward from the crown, so a few of a
        // clump's inner faces disagree with them.
        assert.ok(volume(m) > 0, `${spec.name}: wound inside out`);
        assert.ok(outward(m) > 0.75, `${spec.name}: ${(outward(m) * 100).toFixed(0)}% of triangles face out`);
      }
      assert.ok(far.index.length < near.index.length, `${spec.name}: far is lighter`);
      assert.deepEqual(buildPlant(spec, 1, v, 'near').positions, near.positions, 'same seed, same plant');
    }
  });
}

/** A cell of a plant near a point of the floor, and the plant. */
function cellAt(name: string, params = MATRIX[0].params, at?: (lake: number, floor: [number, number]) => number) {
  const h = derive(params), eco = makeEcology(makeTerrain(h)), plants = plantsOf(eco);
  const sp = plants.find((p) => p.spec.name === name)!;
  const s = at ? at(eco.terrain.lake?.s ?? 0, [h.profile.floorStart, h.profile.floorEnd]) : (h.profile.floorStart + h.profile.floorEnd) / 2;
  const eye = toWorld(h.profile, { theta: 0.3, s, h: 1.7 });
  return { h, eco, plants, sp, eye, cells: cellsNear(eco, sp, eye) };
}

for (const { name, params } of MATRIX) {
  test(`scatter (${name}): cells near the eye are within sight, plants stand on the ground inside their cell, the same each time`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), plants = plantsOf(eco);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2, eye = toWorld(h.profile, { theta: 1, s, h: 1.7 });
    let planted = 0;
    for (const sp of plants) {
      const cells = cellsNear(eco, sp, eye);
      assert.ok(cells.length > 0, `${sp.spec.name}: some cells`);
      for (const k of cells.slice(0, 2)) {
        const c = plantCell(eco, plants, k), again = plantCell(eco, plants, k);
        assert.deepEqual(c.instances, again.instances, 'same cell, same plants');
        const b = cellBounds(eco, sp, k);
        for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
          const p = fromWorld(h.profile, c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]);
          const th = ((p.theta - b.theta0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          assert.ok(th <= b.theta1 - b.theta0 + 1e-6 && p.s >= b.s0 - 0.01 && p.s <= b.s1 + 0.01, 'inside its cell');
          assert.ok(Math.abs(p.h - eco.terrain.heightAt(p.theta, p.s)) < 0.05, 'on the ground');
          assert.ok(list[i + 3] >= sp.spec.height[0] - 1e-3 && list[i + 3] <= sp.spec.height[1] + 1e-3, 'its own height');
          planted++;
        }
      }
    }
    assert.ok(planted > 0, 'something grows');
    // From high above, nothing small is seen.
    const high = toWorld(h.profile, { theta: 1, s, h: Math.min(h.radius * 0.9, 3000) });
    const reeds = plants.find((p) => p.spec.form === 'reeds');
    if (reeds && h.radius * 0.9 > reeds.seen) assert.equal(cellsNear(eco, reeds, high).length, 0);
  });
}

test('scatter: woods are about as dense as their spacing says where the biome is pure', () => {
  const { eco, plants, sp, cells } = cellAt('oak');
  let trees = 0, area = 0;
  const w = new Float32Array(eco.climate.biomes.length);
  for (const k of cells.slice(0, 30)) {
    const c = plantCell(eco, plants, k), b = cellBounds(eco, sp, k);
    const sm = (b.s0 + b.s1) / 2, tm = (b.theta0 + b.theta1) / 2;
    eco.biomesAt(tm, sm, eco.terrain.heightAt(tm, sm), 0, w);
    if (w[sp.biome] < 0.99) continue;
    trees += c.count;
    area += (b.s1 - b.s0) * (b.theta1 - b.theta0) * eco.terrain.habitat.profile.at(sm).r;
  }
  if (area === 0) return; // no pure woodland near this spot of this seed
  const want = area / (sp.spec.spacing * sp.spec.spacing);
  assert.ok(trees > want * 0.6 && trees < want * 1.3, `${trees} trees where the spacing says ${want.toFixed(0)}`);
});

test('scatter: olive groves are planted in straight rows', () => {
  const { eco, plants, sp, cells } = cellAt('olive', withParams({ climate: 'mediterranean' }));
  const { profile } = eco.terrain.habitat;
  let n = 0;
  for (const k of cells.slice(0, 40)) {
    const c = plantCell(eco, plants, k);
    for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const p = fromWorld(profile, c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]);
      const off = p.s / sp.spec.spacing - Math.round(p.s / sp.spec.spacing);
      assert.ok(Math.abs(off) < 0.01, `on a row: s ${p.s}`);
      n++;
    }
  }
  assert.ok(n > 0, 'some olives');
});

test('scatter: cells are bigger for plants seen farther', () => {
  const { plants } = cellAt('oak');
  const by = (n: string): Species => plants.find((p) => p.spec.name === n)!;
  assert.ok(by('oak').cell > by('reeds').cell && by('oak').seen > by('reeds').seen);
});
