import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, toWorld } from '../src/blueprint';
import type { Terrain } from '../src/gen/terrain';
import type { Ecology } from '../src/gen/ecology';
import { planOf } from '../src/gen/plan';
import { ecologyOf, terrainOf } from './worlds';
import { EDGE, PARCELS, VINE_TOP, nearestPlace, placesOf, vineFaceFoot } from '../src/gen/places';
import { cellsNear, levelRunOf, onRow, plantCell, plantsOf, slopeAt, PLANT_STRIDE } from '../src/gen/scatter';

const worldOf = (name: string): { t: Terrain; eco: Ecology } => ({ t: terrainOf(name), eco: ecologyOf(name) });
const TURN = 2 * Math.PI;

for (const { name } of MATRIX) {
  test(`places (${name}): orchards stand by the entrances of the orchard commons, wholly in their district, dry, level and apart`, () => {
    const { t } = worldOf(name), h = t.habitat, R = h.radius, plan = planOf(h), places = placesOf(t), spec = h.params.plan;
    const orchards = plan.districts.filter((d) => d.style === 'orchard');
    if (orchards.length) assert.ok(places.plots.length >= orchards.length, `${places.plots.length} blocks for ${orchards.length} orchard commons`);
    const gap = (a: number, b: number) => { const d = a - b; return (d - TURN * Math.round(d / TURN)) * R; };
    for (const p of places.plots) {
      const d = plan.districts[p.district];
      assert.equal(d.style, 'orchard');
      assert.ok(p.halfAlong * 2 <= spec.places.orchard * 1.2 + 1e-6 && p.halfAround > 0, 'its size');
      const near = Math.min(...d.entrances.map((e) => Math.hypot(gap(e.theta, p.theta), e.s - p.s)));
      assert.ok(near <= spec.entranceSpacing * 0.31, `${near.toFixed(0)} m from its entrance`);
      let lo = Infinity, hi = -Infinity;
      for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]]) {
        const pt = p.theta + (i * p.halfAround) / R, ps = p.s + j * p.halfAlong;
        assert.equal(plan.districtAt(pt, ps), d, 'inside its district');
        assert.ok(!t.riverAt(pt, ps) && !t.courtAt(pt, ps) && t.standAt(pt, ps) <= t.heightAt(pt, ps) + 0.05, 'dry, and clear of the courts');
        const g = t.heightAt(pt, ps);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      assert.ok(hi - lo < 0.15 * 2 * Math.hypot(p.halfAround, p.halfAlong) + 0.5, `level enough: ${(hi - lo).toFixed(1)} m across`);
      for (const q of places.plots) if (q !== p) assert.ok(Math.abs(gap(q.theta, p.theta)) >= q.halfAround + p.halfAround || Math.abs(q.s - p.s) >= q.halfAlong + p.halfAlong, 'blocks apart');
      // Its middle is wholly orchard, its edge mown.
      assert.deepEqual(places.placeAt(p.theta, p.s), { kind: 'orchard', share: 1 });
      assert.ok(places.placeAt(p.theta, p.s + p.halfAlong - EDGE / 4)!.share < 0.5, 'a soft edge');
    }
  });

  test(`places (${name}): the Vine face's lower terraces are parcels of vines, orchards and meadow; nothing is planted elsewhere off the floor`, () => {
    const { t } = worldOf(name), h = t.habitat, P = h.profile, places = placesOf(t), R = h.radius;
    const vine = t.form.faces.some((f) => f.kind === 'vine');
    const count = { vineyard: 0, orchard: 0, none: 0 };
    for (let k = 0; k < 1500; k++) {
      const s = P.floorEnd + ((k * 0.6180339) % 1) * (P.length - P.floorEnd), theta = ((k * 0.7548777) % 1) * TURN;
      const at = places.placeAt(theta, s), terrace = t.terraceAt(theta, s), g = P.at(s).r / R;
      if (at) {
        assert.ok(terrace && terrace.face === 'vine' && g >= VINE_TOP - 0.02, `planted off the Vine face's lower terraces (g ${g.toFixed(2)})`);
        assert.ok(at.share > 0 && at.share <= 1);
      }
      if (terrace?.face === 'vine' && terrace.body > 0.9 && g > VINE_TOP + 0.03) count[at ? at.kind : 'none']++;
    }
    for (let k = 0; k < 300; k++) {
      const s = ((k * 0.6180339) % 1) * P.floorStart, theta = ((k * 0.7548777) % 1) * TURN;
      assert.equal(places.placeAt(theta, s), null, 'nothing planted on the Mountain');
    }
    const all = count.vineyard + count.orchard + count.none;
    if (!vine) { assert.equal(all, 0); return; }
    assert.ok(all > 30, `${all} points on the Vine face`);
    assert.ok(Math.abs(count.vineyard / all - PARCELS.vineyard) < 0.2 && Math.abs(count.orchard / all - PARCELS.orchard) < 0.15, JSON.stringify(count));
  });

  test(`places (${name}): a place is its own biome's, and the biomes people plant grow nowhere else`, () => {
    const { t, eco } = worldOf(name), h = t.habitat, P = h.profile, places = placesOf(t), biomes = eco.climate.biomes;
    const w = new Float32Array(biomes.length), placed = biomes.map((b) => !!b.placed);
    const index = (kind: 'orchard' | 'vineyard') => biomes.findIndex((b) => b.name === eco.climate.places[kind]);
    for (const p of places.plots) {
      eco.biomesAt(p.theta, p.s, t.heightAt(p.theta, p.s), 0, w);
      assert.ok(w[index('orchard')] > 0.99, `orchard ${w[index('orchard')]}`);
    }
    for (let k = 0; k < 400; k++) {
      const s = ((k * 0.6180339) % 1) * P.length, theta = ((k * 0.7548777) % 1) * TURN;
      if (places.placeAt(theta, s)) continue;
      eco.biomesAt(theta, s, t.heightAt(theta, s), 0.1, w);
      placed.forEach((on, b) => { if (on) assert.equal(w[b], 0, `${biomes[b].name} outside a place`); });
    }
  });
}

test('places: vines stand in rows along the terraces, turned along them; an orchard\'s trees in rows too', () => {
  const { t, eco } = worldOf('reference'), plants = plantsOf(eco), h = t.habitat, P = h.profile, run = levelRunOf(P);
  const foot = vineFaceFoot(t)!, level = (pt: number, ps: number) => slopeAt(eco, pt, ps, t.heightAt(pt, ps), 2) < 0.2;
  for (const kind of ['vineyard', 'orchard'] as const) {
    // On the lowest terraces, where their ledges are widest.
    const at = nearestPlace(t, kind, foot.theta, P.floorEnd + h.radius * 0.1, level)!;
    assert.ok(at, kind);
    const eye = toWorld(P, { theta: at.theta, s: at.s, h: t.heightAt(at.theta, at.s) + 1.7 });
    const name = kind === 'vineyard' ? 'vine' : 'apple', sp = plants.find((p) => p.spec.name === name)!, spec = sp.spec as { spacing: number; rowGap?: number };
    let n = 0;
    for (const c of cellsNear(eco, sp, 0, eye).slice(0, 4)) {
      const cell = plantCell(eco, plants, c.key);
      for (const list of cell.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
        n++;
        const p = fromWorld(P, cell.origin[0] + list[i], cell.origin[1] + list[i + 1], cell.origin[2] + list[i + 2]);
        if (!spec.rowGap) {
          // A fruit tree on its row: a whole number of spacings along the level run.
          const row = run.u(p.s) / spec.spacing;
          assert.ok(Math.abs(row - Math.round(row)) < 0.02, `${name} off its row`);
          continue;
        }
        // A vine on its row (its spot is a row's own: drawn once along the level's gradient there, so within a few cm, as
        // the terrace's line bends), turned along it (either way round, give or take its twist).
        const again = onRow(t, run, p.theta, p.s, spec.rowGap, spec.spacing)!;
        const off = again ? Math.hypot((again.theta - p.theta) * P.at(p.s).r, (again.s - p.s) * Math.abs(P.at(p.s).nr)) : Infinity;
        assert.ok(off < spec.rowGap * 0.05, `${name} ${off.toFixed(2)} m off its row`);
        const d = list[i + 4] - again.turn, turned = Math.abs(d - Math.PI * Math.round(d / Math.PI));
        assert.ok(turned < 0.07, `${name} turned ${turned.toFixed(2)} off its row`);
      }
    }
    assert.ok(n > (kind === 'vineyard' ? 50 : 4), `${n} ${name}s`);
  }
});

test('places: the rows on a terrace\'s ledge stand a row apart', () => {
  const { t, eco } = worldOf('reference'), h = t.habitat, P = h.profile, run = levelRunOf(P);
  const vine = eco.climate.biomes.flatMap((b) => b.plants).find((p) => p.rowGap)!, gap = vine.rowGap!;
  const foot = vineFaceFoot(t)!, at = nearestPlace(t, 'vineyard', foot.theta, P.floorEnd + h.radius * 0.1, (pt, ps) => slopeAt(eco, pt, ps, t.heightAt(pt, ps), 2) < 0.2)!;
  // Walk up the level's gradient across the ledge in small steps: the spots on rows gather on lines a row's gap apart.
  const r = P.at(at.s).r, cos = Math.abs(P.at(at.s).nr), first = onRow(t, run, at.theta, at.s, gap, 1e9)!;
  const gu = Math.sin(first.turn), gv = -Math.cos(first.turn), found: number[] = [];
  for (let x = -6; x <= 6; x += 0.05) {
    const row = onRow(t, run, at.theta + (x * gu) / r, at.s + (x * gv) / cos, gap, vine.spacing);
    if (row) found.push(Math.round(((row.theta - at.theta) * r * gu + (row.s - at.s) * cos * gv) * 10) / 10);
  }
  const lines = [...new Set(found)].sort((a, b) => a - b);
  assert.ok(lines.length >= 3, `rows at ${lines.join(', ')}`);
  for (let i = 1; i < lines.length; i++) {
    const apart = lines[i] - lines[i - 1];
    if (apart > 0.3) assert.ok(apart > gap * 0.6 && apart < gap * 1.6, `rows ${apart.toFixed(2)} m apart: ${lines.join(', ')}`);
  }
});
