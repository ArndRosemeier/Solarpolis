import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIMATES, MATRIX, derive, fromWorld } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { makeEcology, type Ecology } from '../src/gen/ecology';
import { makePlan, siteOf } from '../src/gen/plan';
import { FOUNDERS_GROWTH, plantSpec, plantedCanopy, plantingsOf, scatterKeepsOff } from '../src/gen/planted';
import { LEVELS, cellBounds, cellsNear, plantCell, plantsOf, PLANT_STRIDE, type Level } from '../src/gen/scatter';
import { placeAt } from '../src/gen/landmarks';
import { outOfPlace } from '../src/gen/shapes';
import { TREE_HEIGHT } from '../src/gen/ecology';

const ecologies = new Map<string, Ecology>();
const ecologyOf = (name: string): Ecology => {
  let e = ecologies.get(name);
  if (!e) { e = makeEcology(makeTerrain(derive(MATRIX.find((m) => m.name === name)!.params))); ecologies.set(name, e); }
  return e;
};

test('planted: every climate names a tree of its own biomes as the founders\' tree', () => {
  for (const c of Object.values(CLIMATES)) {
    const spec = plantSpec(c, c.grove);
    assert.ok(spec, `${c.name}: ${c.grove}`);
    assert.ok(spec.height[1] >= TREE_HEIGHT, `${c.name}: ${c.grove} is a tree`);
  }
});

for (const { name, params } of MATRIX) {
  test(`planted (${name}): the founders' grove stands on its plan site, a ring of the tallest trees round a clearing`, () => {
    const t: Terrain = makeTerrain(derive(params)), p = plantingsOf(t);
    const site = siteOf(makePlan(t.habitat), 'founders-grove');
    if (!site) { assert.equal(p.groves.length, 0); return; }
    assert.equal(p.groves.length, 1);
    const g = p.groves[0], r = t.habitat.profile.at(g.s).r;
    assert.equal(g.theta, site.theta);
    assert.equal(g.s, site.s);
    assert.ok(g.ring + g.crown / 2 <= site.size * 1.2, 'within its site');
    assert.ok(g.trees.length === 1 ? g.ring === 0 : g.trees.length >= 6, `${g.trees.length} trees`);
    for (const tree of g.trees) {
      // On the ring, taller than any of their kind that grew by chance, and on dry ground.
      const d = Math.hypot(tree.s - g.s, Math.atan2(Math.sin(tree.theta - g.theta), Math.cos(tree.theta - g.theta)) * r);
      assert.ok(Math.abs(d - g.ring) < 1e-6 * Math.max(1, g.ring) + 1e-3, `${d} from the middle`);
      assert.ok(tree.height > g.spec.height[1] && tree.height <= g.spec.height[1] * FOUNDERS_GROWTH, `${tree.height} m`);
      assert.ok(t.standAt(tree.theta, tree.s) <= t.heightAt(tree.theta, tree.s) + 0.05, 'not in the water');
    }
    // Scattered plants keep off the clearing and the ring; not off land beyond it.
    assert.ok(scatterKeepsOff(t, g.theta, g.s));
    assert.ok(!scatterKeepsOff(t, g.theta, g.s + g.clear * 1.5));
    // Same habitat, same grove (on the smallest: a second terrain costs time).
    if (name === 'small') assert.deepEqual(plantingsOf(makeTerrain(derive(params))), p);
  });
}

test('planted: the grove\'s trees are drawn at every level, each once, and from afar its crowns are in the canopy', () => {
  const eco = ecologyOf('reference'), t = eco.terrain, g = plantingsOf(t).groves[0], plants = plantsOf(eco);
  const sp = plants.find((x) => x.what === 'planted')!;
  assert.equal(sp.spec.name, g.spec.name);
  assert.equal(sp.tall, Math.max(...g.trees.map((x) => x.height)));
  const frame = placeAt(t.habitat, g.theta, g.s, 0), eye = outOfPlace(frame, [0, 0, g.trees[0].height * 2]);
  for (let level = 0; level < LEVELS.length; level++) {
    // From the middle of the level's band, along the axis.
    const band = sp.band[level], from = outOfPlace(frame, [Math.max(0, (band[1] + band[2]) / 2), 0, g.trees[0].height]);
    let count = 0;
    for (const c of cellsNear(eco, sp, level as Level, from)) {
      const cell = plantCell(eco, plants, c.key), b = cellBounds(eco, sp, c.key);
      count += cell.count;
      for (const list of cell.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
        const at = fromWorld(t.habitat.profile, list[i] + cell.origin[0], list[i + 1] + cell.origin[1], list[i + 2] + cell.origin[2]);
        assert.ok(at.s >= b.s0 - 1e-3 && at.s < b.s1 + 1e-3, 'in its cell');
        assert.ok(list[i + 3] > g.spec.height[1], 'its own height');
      }
    }
    assert.equal(count, g.trees.length, `level ${level}: every tree once`);
  }
  // Scattered trees of the same kind keep out of the clearing.
  const oak = plants.find((x) => x.what === 'plant' && x.spec.name === g.spec.name)!;
  for (const c of cellsNear(eco, oak, 1, eye).slice(0, 12)) {
    const cell = plantCell(eco, plants, c.key);
    for (const list of cell.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const at = fromWorld(t.habitat.profile, list[i] + cell.origin[0], list[i + 1] + cell.origin[1], list[i + 2] + cell.origin[2]);
      assert.ok(!scatterKeepsOff(t, at.theta, at.s), 'a scattered tree in the clearing');
    }
  }
  // From afar: the ring is in the canopy; the clearing is open.
  const tree = g.trees[0], onRing = plantedCanopy(t, tree.theta, tree.s);
  assert.ok(onRing && onRing.cover > 0.5 && onRing.height > g.spec.height[1], 'the ring\'s crowns');
  assert.equal(plantedCanopy(t, g.theta, g.s), null, 'the clearing');
  // The clearing is lawn: none of its ground goes to a biome with trees.
  const shares = eco.biomesAt(g.theta, g.s, t.heightAt(g.theta, g.s), 0, new Float32Array(eco.climate.biomes.length));
  eco.climate.biomes.forEach((b, k) => { if (b.plants.some((p) => p.height[1] >= TREE_HEIGHT)) assert.equal(shares[k], 0, `${b.name} in the clearing`); });
  const out = new Float32Array(3), canopy = new Float32Array(4);
  eco.colorAt(tree.theta, tree.s, t.heightAt(tree.theta, tree.s), 0, out, 0, canopy);
  assert.ok(canopy[3] > g.spec.height[1] * 0.5, `canopy raise ${canopy[3]}`);
});
