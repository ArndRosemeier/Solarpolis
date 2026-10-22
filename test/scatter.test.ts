import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, toWorld, withParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { canopyOf, makeEcology, TREE_HEIGHT } from '../src/gen/ecology';
import { canopyBand, cellBounds, cellSphere, cellsNear, LEVELS, levelRunOf, plantCell, plantsOf, PLANT_STRIDE, type CellKey, type Level, type Species } from '../src/gen/scatter';
import { ecologyOf } from './worlds';

/** A cell of a plant near a point of the floor, and the plant. */
function cellAt(name: string, params = MATRIX[0].params, at?: (lake: number, floor: [number, number]) => number) {
  const eco = params === MATRIX[0].params ? ecologyOf(MATRIX[0].name) : makeEcology(makeTerrain(derive(params))), h = eco.terrain.habitat, plants = plantsOf(eco);
  const sp = plants.find((p) => p.spec.name === name)!;
  const s = at ? at(eco.terrain.lake?.s ?? 0, [h.profile.floorStart, h.profile.floorEnd]) : (h.profile.floorStart + h.profile.floorEnd) / 2;
  const eye = toWorld(h.profile, { theta: 0.3, s, h: eco.terrain.heightAt(0.3, s) + 1.7 });
  return { h, eco, plants, sp, eye, cells: cellsNear(eco, sp, 0, eye).map((c) => c.key) };
}

for (const { name, params } of MATRIX) {
  test(`scatter (${name}): cells near the eye are within sight, plants stand on the ground inside their cell, the same each time`, () => {
    // The land every file shares: planting a cell twice over it is the same each time.
    const eco = ecologyOf(name, params), h = eco.terrain.habitat, plants = plantsOf(eco);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2, eye = toWorld(h.profile, { theta: 1, s, h: eco.terrain.heightAt(1, s) + 1.7 });
    let planted = 0;
    for (const sp of plants) {
      const cells = cellsNear(eco, sp, 0, eye).map((c) => c.key);
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
    if (reeds && h.radius * 0.9 > reeds.seen + reeds.spec.height[1]) for (const l of [0, 1, 2] as Level[]) assert.equal(cellsNear(eco, reeds, l, high).length, 0);
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

test('scatter: olive groves are planted in straight rows (their spacing apart along the level run)', () => {
  const { eco, plants, sp, cells } = cellAt('olive', withParams({ climate: 'mediterranean' }));
  const { profile } = eco.terrain.habitat, run = levelRunOf(profile);
  let n = 0;
  for (const k of cells.slice(0, 40)) {
    const c = plantCell(eco, plants, k);
    for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const p = fromWorld(profile, c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]);
      const row = run.u(p.s) / sp.spec.spacing, off = row - Math.round(row);
      assert.ok(Math.abs(off) < 0.01, `on a row: s ${p.s}`);
      n++;
    }
  }
  assert.ok(n > 0, 'some olives');
});

test('scatter: cells are bigger for plants seen farther, and for farther levels', () => {
  const { plants } = cellAt('oak');
  const by = (n: string): Species => plants.find((p) => p.spec.name === n)!;
  assert.ok(by('oak').cell[0] >= by('reeds').cell[0] && by('oak').seen > by('reeds').seen);
  for (const sp of plants) assert.ok(sp.cell.every((c, k) => !k || sp.cell[k - 1] <= c), `${sp.spec.name}: ${sp.cell}`);
});

test('scatter: each level takes a plant over exactly where the one before lets it go, and woods hand over to the canopy', () => {
  for (const climate of ['temperate-mild', 'mediterranean']) {
    const eco = makeEcology(makeTerrain(derive(withParams({ climate })))), woods = canopyBand(eco);
    for (const sp of plantsOf(eco)) {
      for (let k = 1; k < sp.band.length; k++) assert.deepEqual(sp.band[k].slice(0, 2), sp.band[k - 1].slice(2), `${sp.spec.name} level ${k}`);
      for (const b of sp.band) assert.ok(b[0] < b[1] && b[1] <= b[2] && b[2] < b[3], `${sp.spec.name}: ${b}`);
      if (sp.what === 'plant' && sp.spec.height[1] >= TREE_HEIGHT) assert.deepEqual(sp.band[LEVELS.length - 1].slice(2), woods, `${sp.spec.name}: hulls last until the canopy`);
      // Shrubs are seen until they are a pixel or two tall (but never past the woods), not just a few hundred metres.
      else if (sp.what === 'plant' && sp.spec.spacing >= 5) {
        const end = sp.band[LEVELS.length - 1][3];
        assert.ok(end >= 400 * sp.spec.height[1] && end <= woods[1], `${sp.spec.name}: seen to ${end} m`);
      }
    }
  }
});

test('scatter: a plant is the same whichever level\'s cell plants it', () => {
  const { eco, plants, sp, eye } = cellAt('oak');
  const { profile } = eco.terrain.habitat;
  const far = cellsNear(eco, sp, 2, eye)[0].key, c = plantCell(eco, plants, far);
  const key = (x: number, y: number, z: number) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
  const want = new Map<string, number>();
  for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) want.set(key(c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]), list[i + 3]);
  assert.ok(want.size > 0, 'some oaks');
  // The same plants from the full level's smaller cells: each found in the one cell that holds it.
  const asked = new Map<string, number>();
  let n = 0;
  for (const [k] of want) {
    if (n++ > 40) break;
    const [x, y, z] = k.split(',').map(Number), p = fromWorld(profile, x, y, z);
    const cell = sp.cell[0], j = Math.floor(p.s / cell), cols = Math.max(1, Math.round(profile.circumference(Math.min(profile.length, (j + 0.5) * cell)) / cell));
    const near: CellKey = { species: sp.id, level: 0, j, i: Math.floor((((p.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * cols) };
    const id = `${near.j}:${near.i}`;
    if (asked.has(id)) continue;
    asked.set(id, 1);
    const nc = plantCell(eco, plants, near);
    let found = false;
    for (const list of nc.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const kk = key(nc.origin[0] + list[i], nc.origin[1] + list[i + 1], nc.origin[2] + list[i + 2]);
      if (kk === k) { found = true; assert.ok(Math.abs(list[i + 3] - want.get(k)!) < 1e-3, 'same height'); }
    }
    assert.ok(found, `oak at ${k} also in its full-level cell`);
  }
});

test('ecology: woods have a canopy layer as high as their trees, open land none', () => {
  const eco = ecologyOf(MATRIX[0].name);
  for (const b of eco.climate.biomes) {
    const c = canopyOf(b), trees = b.plants.filter((p) => p.height[1] >= TREE_HEIGHT);
    if (!trees.length) { assert.equal(c.cover, 0, b.name); continue; }
    assert.ok(c.cover > 0 && c.cover <= 1 && c.height <= Math.max(...trees.map((p) => p.height[1])), `${b.name}: ${JSON.stringify(c)}`);
    assert.ok(c.color.every((v) => v > 0 && v < 1), `${b.name}: colour`);
  }
  assert.ok(eco.climate.biomes.some((b) => canopyOf(b).cover > 0.5), 'some closed woods');
});

test('scatter: on a hilltop the plants around the eye are still near (their distance is from the ground, not the profile)', () => {
  const eco = ecologyOf('reference'), t = eco.terrain, P = t.habitat.profile, plants = plantsOf(eco);
  // The highest point of the floor on a coarse grid: a hilltop well above the profile.
  let best = { theta: 0, s: 0, g: -Infinity };
  for (let j = 1; j < 60; j++) for (let i = 0; i < 48; i++) {
    const s = P.floorStart + ((P.floorEnd - P.floorStart) * j) / 60, theta = (i / 48) * 2 * Math.PI, g = t.heightAt(theta, s);
    if (g > best.g) best = { theta, s, g };
  }
  const sp = plants.find((p) => p.what === 'plant' && p.band.length > 0)!;
  assert.ok(best.g > sp.band[0][3], `a hill ${best.g.toFixed(0)} m high, above the full level's reach`);
  const eye = toWorld(P, { theta: best.theta, s: best.s, h: best.g + 1.7 }), cells = cellsNear(eco, sp, 0, eye);
  assert.ok(cells.length > 0 && cells[0].near === 0, `${cells.length} cells at the full level`);
  // Each cell's bounds hold its plants, whose feet lie far above its origin on the profile.
  let held = 0;
  for (const c of cells.slice(0, 8)) {
    const cell = plantCell(eco, plants, c.key), { middle, radius } = cellSphere(cell, sp.spec.height[1]);
    for (const list of cell.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const top = Math.hypot(list[i] - middle[0], list[i + 1] - middle[1], list[i + 2] - middle[2]) + list[i + 3];
      assert.ok(top <= radius + 1e-6, 'a plant outside its cell\'s bounds');
      held++;
    }
  }
  assert.ok(held > 0, 'plants near the hilltop');
});
