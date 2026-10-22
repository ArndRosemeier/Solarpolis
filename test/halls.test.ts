import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { underOf } from '../src/gen/under';
import { underHousesIn } from '../src/gen/underMesh';
import { HALL_KINDS, hallAt, hallCountOf, type HallKind } from '../src/gen/halls';
import { hallShape } from '../src/gen/hallMesh';
import { styleOf } from '../src/gen/homes';
import { Shape } from '../src/gen/shapes';
import { baysOfHamlet } from '../src/gen/under';
import { windingOk } from './meshChecks';
import { terrainOf } from './worlds';

/** Up to `most` of a habitat's hamlets, spread over it. */
const someHamlets = <T>(all: readonly T[], most: number): T[] => all.filter((_, k) => k % Math.max(1, Math.ceil(all.length / most)) === 0);

for (const { name } of MATRIX) {
  test(`halls (${name}): every hamlet has its minds' room, a stage, kitchens, baths and shops, the first ones by the wellhead`, () => {
    const h = terrainOf(name).habitat, u = underOf(h);
    for (const m of someHamlets(u.hamlets, 12)) {
      const n = hallCountOf(h, m), all = HALL_KINDS.reduce((a, k) => a + n[k], 0);
      assert.equal(n.minds, 1, `hamlet ${m.court}: one minds' room`);
      assert.ok(n.stage >= 1 && n.kitchen >= 1 && n.bath >= 1 && n.shop >= 1, JSON.stringify(n));
      assert.deepEqual(hallCountOf(h, m), n, 'seeded');
      // Every hall bay holds a hall; the minds' room, a kitchen and the stage are on the ring nearest the wellhead.
      const bays = [...baysOfHamlet(u, m, Math.ceil(m.hall) + 1)].filter((b) => u.useAt(b.i, b.j) === 'hall');
      assert.equal(bays.length, all, 'a hall in every hall bay');
      const ring = (b: { di: number; dj: number }): number => Math.round(Math.hypot(b.di, b.dj));
      const nearest = Math.min(...bays.map(ring));
      for (const k of ['minds', 'stage', 'kitchen'] as const) {
        const at = bays.filter((b) => hallAt(h, b.i, b.j) === k).map(ring);
        assert.ok(Math.min(...at) <= nearest + (bays.filter((b) => ring(b) === nearest).length >= 3 ? 0 : 1), `${k} by the wellhead`);
      }
    }
  });
}

test('halls (reference): makers keep more shops, water districts more baths', () => {
  const h = terrainOf('reference').habitat, u = underOf(h);
  const share = (style: string | null, k: HallKind): number => {
    let of = 0, all = 0;
    for (const m of u.hamlets) {
      if (style && styleOf(h, m) !== style) continue;
      const n = hallCountOf(h, m);
      of += n[k];
      all += HALL_KINDS.reduce((a, x) => a + n[x], 0);
    }
    return of / all;
  };
  assert.ok(share('makers', 'shop') > 1.5 * share(null, 'shop'), `makers' shops ${share('makers', 'shop').toFixed(3)} vs ${share(null, 'shop').toFixed(3)}`);
  assert.ok(share('water', 'bath') > 1.5 * share(null, 'bath'), `water's baths ${share('water', 'bath').toFixed(3)} vs ${share(null, 'bath').toFixed(3)}`);
});

test('halls (reference): each kind of hall far, mid and near is whole and the same outline, more detail nearer', () => {
  const t = terrainOf('reference'), h = t.habitat, u = underOf(h), m = u.hamlets[Math.floor(u.hamlets.length / 2)];
  const hr = h.params.landmarks!.handrail, done = new Set<HallKind>();
  for (const { i, j } of baysOfHamlet(u, m, Math.ceil(m.hall) + 1)) {
    const kind = hallAt(h, i, j);
    if (!kind || done.has(kind)) continue;
    done.add(kind);
    const bay = underHousesIn(t, i, j);
    const sample = (detail: 'far' | 'mid' | 'near'): { lo: number[]; hi: number[]; n: number } => {
      const sh = new Shape(8, true, true);
      hallShape(sh, h, kind, i, j, bay.along, bay.around, 2 * hr, bay.at, detail);
      const a = sh.arrays(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      assert.equal(windingOk(a.positions, a.normals, a.index).bad, 0, `${kind} ${detail}: every face outward`);
      for (let v = 0; v < a.positions.length; v++) { lo[v % 3] = Math.min(lo[v % 3], a.positions[v]); hi[v % 3] = Math.max(hi[v % 3], a.positions[v]); }
      return { lo, hi, n: a.positions.length / 3 };
    };
    const near = sample('near'), mid = sample('mid'), far = sample('far');
    assert.ok(far.n > 0 && far.n <= mid.n && mid.n < near.n, `${kind}: ${far.n} / ${mid.n} / ${near.n} vertices`);
    for (const x of [mid, far]) for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(x.lo[a] - near.lo[a]) < 0.25 * hr && Math.abs(x.hi[a] - near.hi[a]) < 0.25 * hr, `${kind}: outline ${x.lo.map((v) => v.toFixed(2))} … ${x.hi.map((v) => v.toFixed(2))} vs ${near.lo.map((v) => v.toFixed(2))} … ${near.hi.map((v) => v.toFixed(2))}`);
    }
  }
  assert.equal(done.size, HALL_KINDS.length, `kinds found: ${[...done].join(', ')}`);
});
