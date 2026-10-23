import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOAT_FINISH, BOAT_KINDS, BOAT_KIND_LIST, BOAT_PART, LIVERIES, boatDesign, liveryOf, type BoatDesign, type BoatKind, type BoatMesh } from '../src/gen/boat';

/** Each design built once for the tests here. */
const built = new Map<BoatKind, BoatDesign>();
const designOf = (kind: BoatKind): BoatDesign => built.get(kind) ?? built.set(kind, boatDesign(kind)).get(kind)!;

const extent = (p: Float32Array): [number[], number[]] => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]); }
  return [lo, hi];
};
const finishes = (m: BoatMesh): Set<number> => new Set(Array.from({ length: m.paint.length / 4 }, (_, k) => m.paint[k * 4 + 3]));

for (const kind of BOAT_KIND_LIST) {
  test(`boat (${kind}): built to its sizes, a wing that turns about its mast, a coarse level that matches it, a wake on the water`, () => {
    const d = designOf(kind), spec = BOAT_KINDS[kind];
    for (const m of [d.body, d.coarse, d.wake]) {
      const n = m.positions.length / 3;
      assert.equal(m.normals.length, n * 3);
      assert.equal(m.paint.length, n * 4);
      assert.equal(m.rig.length, n * 4);
      assert.ok(m.index.every((k) => k < n) && m.index.length % 3 === 0);
      assert.ok(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite));
    }
    // Its size: the hull's length (rudders and foils a little past it), the beam over all, the wing's head at the mast's height.
    const [lo, hi] = extent(d.body.positions);
    assert.ok(hi[2] - lo[2] >= spec.length * 0.98 && hi[2] - lo[2] <= spec.length * 1.15, `length ${(hi[2] - lo[2]).toFixed(2)} m`);
    assert.ok(Math.abs(hi[0] - lo[0] - spec.beam) < spec.beam * 0.03, `beam ${(hi[0] - lo[0]).toFixed(2)} m`);
    assert.ok(Math.abs(hi[1] - spec.mast) < 0.1, `masthead ${hi[1].toFixed(2)} m`);
    assert.ok(lo[1] < 0, 'below the waterline');
    if (spec.foil) assert.ok(lo[1] < -spec.foil.lift, 'its foils still in the water when it flies');
    assert.ok(-lo[1] <= spec.draft, `no deeper than its draft (${(-lo[1]).toFixed(2)} m)`);
    // Every finish known; a livery hull, glass where a design has it, lights.
    const f = finishes(d.body);
    for (const x of f) assert.ok((Object.values(BOAT_FINISH) as number[]).includes(x), `finish ${x}`);
    assert.ok(f.has(BOAT_FINISH.livery) && f.has(BOAT_FINISH.film) && f.has(BOAT_FINISH.light));
    if (kind !== 'skiff') assert.ok(f.has(BOAT_FINISH.glass), 'glass');
    // The wing: all of it turns about one hub on the centreline, standing above the deck.
    const hubs = new Set<string>();
    let wing = 0;
    for (let v = 0; v < d.body.rig.length / 4; v++) {
      const part = d.body.rig[v * 4 + 2];
      assert.ok(part === BOAT_PART.fixed || part === BOAT_PART.wing);
      if (part !== BOAT_PART.wing) continue;
      wing++;
      hubs.add(`${d.body.rig[v * 4]},${d.body.rig[v * 4 + 1]}`);
      assert.ok(d.body.positions[v * 3 + 1] > 0.3, 'the wing above the deck');
    }
    assert.ok(wing > 100 && hubs.size === 1 && [...hubs][0].startsWith('0,'), `${wing} wing vertices about ${[...hubs]}`);
    // The coarse level: far fewer triangles, the same size, finishes and moving wing.
    assert.ok(d.coarse.index.length < d.body.index.length / 4, `${d.coarse.index.length / 3} of ${d.body.index.length / 3} triangles`);
    const [clo, chi] = extent(d.coarse.positions);
    for (let k = 0; k < 3; k++) assert.ok(chi[k] - clo[k] >= 0.85 * (hi[k] - lo[k]), `axis ${k}: ${(chi[k] - clo[k]).toFixed(2)} of ${(hi[k] - lo[k]).toFixed(2)} m`);
    assert.ok(Array.from({ length: d.coarse.rig.length / 4 }, (_, v) => d.coarse.rig[v * 4 + 2]).includes(BOAT_PART.wing));
    for (const x of [BOAT_FINISH.livery, BOAT_FINISH.film]) assert.ok(finishes(d.coarse).has(x));
    // The wake: flat on the water, behind and off the bows, fading out to its sides.
    const [wlo, whi] = extent(d.wake.positions);
    assert.ok(wlo[1] > 0 && whi[1] < 0.05, 'on the water');
    assert.ok(wlo[2] < -spec.length * 3 && whi[2] <= spec.length * 0.55, 'behind the boat');
    for (let v = 0; v < d.wake.rig.length / 4; v++) {
      assert.equal(d.wake.rig[v * 4 + 2], BOAT_PART.wake);
      assert.ok(d.wake.rig[v * 4 + 3] >= 0 && d.wake.rig[v * 4 + 3] <= 1);
    }
    assert.ok(d.wing.every((v) => v > 0 && v < 1));
  });
}

test('boat: the hull skin faces outward, a livery for every seed', () => {
  const m = designOf('skiff').body;
  let out = 0, all = 0;
  for (let v = 0; v < m.paint.length / 4; v++) {
    if (m.paint[v * 4 + 3] !== BOAT_FINISH.livery) continue;
    const x = m.positions[v * 3], y = m.positions[v * 3 + 1];
    all++;
    // Away from the centreline below the sheer (or down at the keel).
    if (Math.abs(x) > 0.05 ? Math.sign(x) * m.normals[v * 3] > -0.05 : m.normals[v * 3 + 1] < 0.2 || y > 0) out++;
  }
  assert.ok(out / all > 0.97, `${out} of ${all}`);
  for (const seed of [0, 1, 7, 12345, -3]) assert.ok(LIVERIES.includes(liveryOf(seed)));
});
