import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, fromWorld, toWorld, FLOOR_LAYERS } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { landformOf } from '../src/gen/plan';
import { cellsNear, normalAt, plantCell, plantsOf, slopeAt, PLANT_STRIDE } from '../src/gen/scatter';
import { LAND_ALBEDO, landAlbedo } from '../src/render/exposure';
import { COHESION, TAN_FRICTION, snowCover, snowFieldOf, snowHolds, snowLies, tanHolds } from '../src/gen/snow';

/** Ground points of the wild endcap's top, where gravity is `g` of the floor's: (θ, s, height, world, level). */
function ring(eco: ReturnType<typeof makeEcology>, g: number, n = 96) {
  const t = eco.terrain, { profile } = t.habitat, s = landformOf(t.habitat).endcapAt(true, g);
  return Array.from({ length: n }, (_, i) => {
    const theta = ((i + 0.5) / n) * 2 * Math.PI, height = t.heightAt(theta, s), p = toWorld(profile, { theta, s, h: height });
    const nn = normalAt(eco, theta, s, height, 2), r = Math.hypot(p[0], p[1]);
    return { theta, s, height, p, level: -(nn[0] * p[0] + nn[1] * p[1]) / r };
  });
}

for (const { name, params } of MATRIX) {
  test(`snow (${name}): above the Mountain's snow line only, holding steeper as gravity falls, a field near the axis`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), f = snowFieldOf(h), { profile } = h, R = h.radius;
    assert.ok(Math.abs(f.line - landformOf(h).mountain.snowLine * R) < 1e-6, 'the plan\'s snow line');
    // Gravity: all of it near the wild end's axis, none on the floor, none on the Gate however near its hub.
    const wildTip = toWorld(profile, { theta: 0, s: landformOf(h).endcapAt(true, 0.02), h: 0 });
    const portTip = toWorld(profile, { theta: 0, s: landformOf(h).endcapAt(false, 0.02), h: 0 });
    const floor = toWorld(profile, { theta: 0, s: (profile.floorStart + profile.floorEnd) / 2, h: 0 });
    assert.equal(snowCover(f, ...wildTip), 1);
    assert.equal(snowCover(f, ...portTip), 0, 'the Gate stays bare');
    assert.equal(snowCover(f, ...floor), 0);
    // Slope: flat ground holds it anywhere; 50° would shed it in the floor's gravity, not at the snow line, where it
    // clings steeper the weaker gravity is, but never to an overhang.
    const deg = (a: number) => Math.cos((a * Math.PI) / 180);
    assert.ok(Math.abs(tanHolds(f, R) - (TAN_FRICTION + COHESION)) < 1e-9 && tanHolds(f, f.line * 0.5) > tanHolds(f, f.line));
    assert.equal(snowHolds(f, f.line, 1), 1);
    assert.equal(snowHolds(f, R, deg(50)), 0);
    assert.equal(snowHolds(f, f.line, deg(50)), 1);
    assert.equal(snowHolds(f, f.line, deg(85)), 0);
    assert.equal(snowHolds(f, f.line * 0.1, -0.2), 0);
    // A field: on the top band (just inside the line) and near the axis a good share of the ground lies under snow.
    for (const g of [0.8, 0.4]) {
      const pts = ring(eco, landformOf(h).mountain.snowLine * g);
      const lies = pts.reduce((sum, q) => sum + snowLies(f, ...q.p, q.level), 0) / pts.length;
      assert.ok(lies > 0.6, `${g} of the line: snow on ${(lies * 100).toFixed(0)}% of the ground`);
    }
  });

  test(`snow (${name}): above the line the ground is bare rock, and nothing grows on it`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), f = snowFieldOf(h);
    const rgb = new Float32Array(3), canopy = new Float32Array(4), floor = new Uint8Array(FLOOR_LAYERS.length), wood = new Float32Array(2);
    const grass = FLOOR_LAYERS.indexOf('grass'), dry = FLOOR_LAYERS.indexOf('dry grass'), rock = FLOOR_LAYERS.indexOf('rock');
    for (const q of ring(eco, landformOf(h).mountain.snowLine * 0.6, 24)) {
      assert.equal(eco.snowAt(q.theta, q.s, q.height), 1);
      eco.colorAt(q.theta, q.s, q.height, slopeAt(eco, q.theta, q.s, q.height, 4), rgb, 0, canopy, floor, wood);
      assert.equal(wood[0], 0, 'no crowns');
      assert.ok(floor[grass] + floor[dry] <= 1 && floor[rock] >= 253, 'rock, no grass');
    }
    // Plants and stones near a point above the line: no plant, and no stone where the snow lies.
    const plants = plantsOf(eco), at = ring(eco, landformOf(h).mountain.snowLine * 0.6, 1)[0], eye = toWorld(h.profile, { theta: at.theta, s: at.s, h: at.height + 1.7 });
    let looked = 0;
    for (const sp of plants) {
      if (sp.what === 'planted') continue;
      for (const near of cellsNear(eco, sp, 0, eye).slice(0, 2)) {
        const c = plantCell(eco, plants, near.key);
        for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
          const w: [number, number, number] = [c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]];
          const p = fromWorld(h.profile, ...w);
          if (sp.what !== 'debris') assert.ok(eco.snowAt(p.theta, p.s, p.h) < 1, `${sp.spec.name} above the snow line`);
          else if (sp.spec.height[0] < 0.8) {
            const n = normalAt(eco, p.theta, p.s, p.h, 1), r = Math.hypot(w[0], w[1]);
            assert.ok(snowLies(f, ...w, -(n[0] * w[0] + n[1] * w[1]) / r) < 1, `${sp.spec.name} on the snow`);
          }
        }
        looked++;
      }
    }
    assert.ok(looked > 0);
    // The eyes' meter sees the snow's light where it lies, the land's elsewhere.
    const albedo = landAlbedo(eco), field = ring(eco, landformOf(h).mountain.snowLine * 0.2, 1)[0];
    assert.ok(albedo(field.p) > 0.6, 'snow');
    assert.equal(albedo(toWorld(h.profile, { theta: 0, s: (h.profile.floorStart + h.profile.floorEnd) / 2, h: 0 })), LAND_ALBEDO);
  });
}
