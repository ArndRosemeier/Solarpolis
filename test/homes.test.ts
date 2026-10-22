import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld } from '../src/blueprint';
import { levelsOf } from '../src/gen/underLevels';
import { buildUnderTile, underHousesIn, type UnderDetail } from '../src/gen/underMesh';
import { ERAS, housesIn, type House } from '../src/gen/homes';
import { PARAPET } from '../src/gen/building';
import { FINISH } from '../src/gen/pavilion';
import { planOf } from '../src/gen/plan';
import { outOfPlace } from '../src/gen/shapes';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

/** A hamlet's home bays near its middle (up to `most`), with their houses. */
function homesOf(name: string, hamlet: number, most = 5): { i: number; j: number; bay: ReturnType<typeof underHousesIn> }[] {
  const t = terrainOf(name), u = levelsOf(t).under, m = u.hamlets[hamlet], out: { i: number; j: number; bay: ReturnType<typeof underHousesIn> }[] = [];
  for (let r = 1; r <= 8 && out.length < most; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r || out.length >= most) continue;
    const i = m.i + di, j = m.j + dj;
    if (j >= 0 && j < u.along && u.useAt(i, j) === 'home' && u.hamletOf(i, j) === m) out.push({ i, j, bay: underHousesIn(t, i, j) });
  }
  return out;
}

for (const { name } of MATRIX) {
  test(`homes (${name}): a hamlet's home bays hold its houses, each in its plot, level on the floor, under the vaults`, () => {
    const t = terrainOf(name), u = levelsOf(t).under, hr = t.habitat.params.landmarks!.handrail, middle = Math.floor(u.hamlets.length / 2);
    const bays = homesOf(name, middle);
    assert.ok(bays.length >= 3, `${bays.length} home bays`);
    let houses = 0;
    for (const { i, j, bay } of bays) {
      assert.ok(bay.houses.length >= 1, 'a house in every home bay');
      assert.deepEqual(underHousesIn(t, i, j).houses, bay.houses, 'seeded');
      for (const h of bay.houses) {
        houses++;
        const p = h.plot, b = h.body;
        assert.ok(p.x0 > 0 && p.x1 < bay.along && p.y0 > 0 && p.y1 < bay.around, 'its plot inside the bay, clear of the pillars');
        assert.ok(b.x0 > p.x0 && b.x1 < p.x1 && b.y0 > p.y0 && b.y1 < p.y1 && b.x1 - b.x0 > 4 * hr && b.y1 - b.y0 > 4 * hr, 'the house inside its plot');
        const plotFloors = [[p.x0, p.y0], [p.x1, p.y0], [p.x0, p.y1], [p.x1, p.y1]].map(([x, y]) => bay.at(x, y).floor);
        assert.ok(Math.abs(h.base - Math.max(...plotFloors)) < 1e-9, 'level with the highest floor of its plot');
        const springing = Math.min(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => bay.at(x, y).springing));
        assert.ok(h.storeys >= 1 && h.storeys <= 4 && h.base + h.storeys * h.storey + PARAPET * hr < springing, `${h.storeys} storeys under the vaults`);
        assert.ok(ERAS.includes(h.era) && (h.era === 'return' || h.build === (h.era === 'founders' ? 'cast' : 'panel')));
        // Its door faces into its yard.
        assert.ok(h.door > 0 ? p.y1 - b.y1 > b.y0 - p.y0 : b.y0 - p.y0 > p.y1 - b.y1, 'the yard in front of its door');
      }
    }
    assert.ok(houses >= bays.length, `${houses} houses`);
  });
}

test('homes (reference): each district builds in its own way, of three eras, nearly all lived in', () => {
  const t = terrainOf('reference'), u = levelsOf(t).under, plan = planOf(t.habitat);
  const own: Record<string, House['build']> = { orchard: 'plaster', water: 'stone', stone: 'stone', grove: 'timber', herd: 'earth', play: 'plaster', makers: 'brick', 'let-go': 'plaster' };
  const eras: Record<string, number> = {}, styles = new Set<string>();
  let n = 0, lived = 0;
  // What a house is built of does not hang on the levels: on a level floor here, so the land's levels are not worked out.
  const flat = { floor: 0, springing: 30, ceiling: 40 }, around = u.dTheta * t.habitat.radius;
  for (let k = 0; k < u.hamlets.length; k += Math.ceil(u.hamlets.length / 40)) {
    const m = u.hamlets[k], style = plan.districts[m.district].style;
    styles.add(style);
    const bays: { i: number; j: number }[] = [];
    for (let di = -8; di <= 8; di++) for (let dj = -8; dj <= 8; dj++) if (m.j + dj >= 0 && m.j + dj < u.along && u.useAt(m.i + di, m.j + dj) === 'home' && u.hamletOf(m.i + di, m.j + dj) === m) bays.push({ i: m.i + di, j: m.j + dj });
    for (const { i, j } of bays.slice(0, 4)) for (const h of housesIn(t.habitat, i, j, u.bay, around, 2, () => flat)) {
      n++;
      lived += h.lived ? 1 : 0;
      eras[h.era] = (eras[h.era] ?? 0) + 1;
      if (h.era === 'return') assert.equal(h.build, own[style], `${style} builds in ${own[style]}`);
    }
  }
  assert.ok(styles.size >= 4, `${styles.size} styles`);
  assert.ok(ERAS.every((e) => (eras[e] ?? 0) > 0) && eras.return > n / 3, JSON.stringify(eras));
  assert.ok(lived > n * 0.8 && lived < n, `${lived} of ${n} lived in`);
});

test('homes (reference): a home bay far, mid and near is whole, the same outline, its windows glowing', () => {
  const t = terrainOf('reference'), h = t.habitat, u = levelsOf(t).under, { i, j } = homesOf('reference', Math.floor(u.hamlets.length / 2), 1)[0];
  const sample = (detail: UnderDetail): { lo: number; hi: number; windows: number; light: number } => {
    const tile = buildUnderTile(t, { level: 0, i, j }, detail), m = tile.mesh, nv = m.positions.length / 3;
    assert.equal(windingOk(m.positions, m.normals, m.index).bad, 0, `${detail}: every face outward`);
    let lo = Infinity, hi = -Infinity, windows = 0, light = 0;
    for (let v = 0; v < nv; v++) {
      const w = outOfPlace(tile.origin, [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]), z = fromWorld(h.profile, w[0], w[1], w[2]).h;
      if (Math.abs(m.finishes[v] - FINISH.window) > 0.5) continue;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
      windows++;
      light += m.colors![v * 3];
    }
    return { lo, hi, windows, light: light / windows };
  };
  const near = sample('near');
  assert.ok(near.windows >= 16 && near.light > 0.3, `${near.windows} window corners, light ${near.light.toFixed(2)}`);
  for (const d of ['mid', 'far'] as const) {
    const x = sample(d);
    assert.equal(x.windows, near.windows, `${d}: as many windows`);
    assert.ok(Math.abs(x.lo - near.lo) < 0.05 && Math.abs(x.hi - near.hi) < 0.05 && Math.abs(x.light - near.light) < 1e-6, `${d}: windows ${x.lo.toFixed(2)} … ${x.hi.toFixed(2)} vs ${near.lo.toFixed(2)} … ${near.hi.toFixed(2)}`);
  }
});
