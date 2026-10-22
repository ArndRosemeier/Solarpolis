import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, toWorld, type Vec3 } from '../src/blueprint';
import { levelsOf } from '../src/gen/underLevels';
import { buildUnderTile, isBelow, underSolid, underTilesFor, type UnderDetail } from '../src/gen/underMesh';
import { buildPatch } from '../src/gen/patch';
import { outOfPlace } from '../src/gen/shapes';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

for (const { name } of MATRIX) {
  const of = (): { t: ReturnType<typeof terrainOf>; lv: ReturnType<typeof levelsOf> } => { const t = terrainOf(name); return { t, lv: levelsOf(t) }; };
  /** A hamlet's wellhead bay, and one two thirds of the way round from it. */
  const spots = (lv: ReturnType<typeof levelsOf>): { i: number; j: number }[] => {
    const u = lv.under, m = u.hamlets[Math.floor(u.hamlets.length / 2)];
    return [{ i: m.i, j: m.j }, { i: m.i + Math.floor((2 * u.around) / 3), j: Math.floor(u.along / 3) }];
  };

  test(`under levels (${name}): the layer follows the land, one height everywhere, under the soil and the deck, no steeper than its grade`, () => {
    const { t, lv } = of(), h = t.habitat, u = lv.under, L = h.params.layers, p = h.params.under, rise = p.grade * u.bay;
    let steep = 0, n = 0, lowSoil = Infinity;
    for (const at of spots(lv)) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = at.i + di, j = Math.min(u.along, Math.max(0, at.j + dj)), c = lv.at(i, j);
      assert.ok(Math.abs(c.ceiling - c.floor - L.living) < 1e-9 && Math.abs(c.springing - c.floor - p.spring * L.living) < 1e-9);
      for (const [a, b] of [[1, 0], [0, 1]]) {
        if (j + b > u.along) continue;
        const r = Math.abs(lv.at(i + a, j + b).ceiling - c.ceiling);
        assert.ok(r < rise * 1.5, `${(r / u.bay).toFixed(2)} rise per run between pillars`);
        steep += r > rise * 1.01 ? 1 : 0;
        n++;
      }
      // Between its pillars a bay's ceiling runs straight, and the soil over it is never thinner than the least.
      if (j >= u.along) continue;
      for (const [fx, fy] of [[0, 0], [0.5, 0.5], [1 / 6, 5 / 6], [1, 1 / 3]]) {
        const theta = (i + fx) * u.dTheta, s = u.s0 + (j + fy) * u.bay, l = lv.levelAt(theta, s), soil = t.heightAt(theta, s) - l.ceiling - L.ceilingDeck;
        lowSoil = Math.min(lowSoil, soil);
        if (fx === 0 && fy === 0) assert.ok(Math.abs(l.ceiling - c.ceiling) < 1e-6, 'at a pillar, its levels');
      }
    }
    assert.ok(lowSoil >= L.soilMin - 1e-6, `soil ${lowSoil.toFixed(2)} m over the deck`);
    assert.ok(steep <= n * 0.05, `${steep} of ${n} pillar steps steeper than the grade`);
  });

  test(`under tiles (${name}): a bay up close is whole, faces the room, lies between floor and ceiling, and its lamps light it`, () => {
    const { t, lv } = of(), h = t.habitat, at = spots(lv)[0];
    const tile = buildUnderTile(t, { level: 0, i: at.i, j: at.j }), m = tile.mesh, nv = m.positions.length / 3;
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, 'every face toward the room');
    assert.equal(tile.glow.length, nv * 2);
    assert.ok(m.uvs.length === nv * 2 && m.finishes.length === nv && m.colors!.length === nv * 3);
    let glowSum = 0;
    for (let v = 0; v < nv; v++) {
      const w = outOfPlace(tile.origin, [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]), p = fromWorld(h.profile, w[0], w[1], w[2]);
      const l = lv.levelAt(p.theta, p.s);
      assert.ok(Number.isFinite(p.h) && p.h <= l.ceiling + 0.25 && p.h >= l.floor - h.pillars.radius, `vertex ${p.h.toFixed(2)} m, the layer ${l.floor.toFixed(2)} … ${l.ceiling.toFixed(2)}`);
      assert.ok(tile.glow[v * 2] > 0.3 && tile.glow[v * 2] <= 8 + 1e-6);
      glowSum += tile.glow[v * 2];
    }
    assert.ok(glowSum / nv > 0.8, 'lit about as the floor mid-bay, brighter by the lamps');
  });

  test(`under tiles (${name}): wanted around an eye below the land, none for one up on it; the physics stands on the floor`, () => {
    const { t, lv } = of(), h = t.habitat, u = lv.under, at = spots(lv)[0], c = u.centreOf(at.i, at.j), l = lv.levelAt(c.theta, c.s);
    const eye: Vec3 = toWorld(h.profile, { theta: c.theta, s: c.s, h: l.floor + 1.6 }), up: Vec3 = toWorld(h.profile, { theta: c.theta, s: c.s, h: t.heightAt(c.theta, c.s) + 1.6 });
    assert.ok(isBelow(t, eye) && !isBelow(t, up));
    assert.deepEqual(underTilesFor(t, up), []);
    const wanted = underTilesFor(t, eye), mine = wanted.find((w) => w.leaf && w.key.level === 0 && w.key.i === at.i && w.key.j === at.j);
    assert.ok(mine, 'its own bay up close');
    // The ground patch below: centred on the floor, holding the floor, the pillars and nothing of them above the springing.
    const patch = buildPatch(t, c.theta, c.s, 64, 4, true), o = patch.origin;
    assert.ok(patch.below && Math.abs(fromWorld(h.profile, o[0], o[1], o[2]).h - l.floor) < 1e-6);
    const solid = underSolid(t, o, 64);
    let onFloor = 0;
    for (let v = 0; v < solid.positions.length / 3; v++) {
      const w: Vec3 = [o[0] + solid.positions[v * 3], o[1] + solid.positions[v * 3 + 1], o[2] + solid.positions[v * 3 + 2]], p = fromWorld(h.profile, w[0], w[1], w[2]), q = lv.levelAt(p.theta, p.s);
      assert.ok(p.h >= q.floor - h.pillars.radius && p.h <= q.ceiling + 0.5, `solid at ${p.h.toFixed(2)}: ${q.floor.toFixed(2)} … ${q.ceiling.toFixed(2)}, s ${p.s.toFixed(1)}`);
      if (Math.abs(p.h - q.floor) < 1e-3) onFloor++;
    }
    assert.ok(onFloor >= 9, 'the floors');
  });
}

test('under tiles (reference): far, mid and near detail of a bay are the same size and as bright', () => {
  const t = terrainOf('reference'), lv = levelsOf(t), h = t.habitat, u = lv.under, m = u.hamlets[0];
  const sample = (detail: UnderDetail): { lo: number; hi: number; glow: number } => {
    const tile = buildUnderTile(t, { level: 0, i: m.i + 1, j: m.j }, detail), a = tile.mesh;
    let lo = Infinity, hi = -Infinity, glow = 0, area = 0;
    for (let k = 0; k < a.index.length; k += 3) {
      const ps = [a.index[k], a.index[k + 1], a.index[k + 2]].map((v) => outOfPlace(tile.origin, [a.positions[v * 3], a.positions[v * 3 + 1], a.positions[v * 3 + 2]]));
      const e1 = ps[1].map((x, q) => x - ps[0][q]), e2 = ps[2].map((x, q) => x - ps[0][q]);
      const s = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      glow += s * (tile.glow[a.index[k] * 2] + tile.glow[a.index[k + 1] * 2] + tile.glow[a.index[k + 2] * 2]) / 3;
      area += s;
      for (const p of ps) { const hh = fromWorld(h.profile, p[0], p[1], p[2]).h; lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
    }
    return { lo, hi, glow: glow / area };
  };
  const near = sample('near');
  for (const d of ['mid', 'far'] as const) {
    const x = sample(d);
    assert.ok(Math.abs(x.lo - near.lo) < 0.05 && Math.abs(x.hi - near.hi) < 0.05, `${d}: ${x.lo.toFixed(2)} … ${x.hi.toFixed(2)} vs ${near.lo.toFixed(2)} … ${near.hi.toFixed(2)}`);
    assert.ok(Math.abs(x.glow / near.glow - 1) < 0.2, `${d}: light ${x.glow.toFixed(2)} vs ${near.glow.toFixed(2)} up close`);
  }
});
