import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, type HabitatParams } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { frameOf, keptClear, landmarkTopAt, landmarksOf, reachOf, type Pavilion } from '../src/gen/landmarks';
import { FINISH, PAVILION_LEVELS, bridgeAt, buildPavilion, pavilionPlan, pavilionTop, roofAt, stairsOf } from '../src/gen/pavilion';
import { buildPatch } from '../src/gen/patch';
import { planOf, siteOf } from '../src/gen/plan';
import { Shape, intoPlace, outOfPlace, planeMap, type MappedArrays } from '../src/gen/shapes';

const terrains = new Map<string, Terrain>();
const terrainOf = (name: string, params: HabitatParams): Terrain => {
  let t = terrains.get(name);
  if (!t) { t = makeTerrain(derive(params)); terrains.set(name, t); }
  return t;
};

/** A pavilion as the blueprint sizes it, without the land: for the geometry alone. */
const pavilionFor = (p: HabitatParams): Pavilion | null => {
  const lm = p.landmarks, lake = p.relief.ringLake;
  if (!lm || !lake) return null;
  const radius = Math.min(lm.size / 2, (lake.width / 2) * 0.55);
  // Short bridges: their parts repeat along them, and long ones only slow the test.
  const to = radius + lm.handrail * 20;
  return { kind: 'pavilion', theta: 0, s: 0, level: 0, radius, handrail: lm.handrail, depth: lake.depth, bridges: [{ dir: 1, from: radius, to, end: 0.4 }, { dir: -1, from: radius, to, end: 0.6 }], seed: 1 };
};

for (const { name, params } of MATRIX) {
  test(`landmarks (${name}): the pavilion stands on the plan's site in the lake, away from the river mouths, bridged to dry land`, () => {
    const t = terrainOf(name, params), ls = landmarksOf(t);
    if (!t.lake || !params.landmarks) { assert.equal(ls.length, 0, 'no lake, no pavilion'); return; }
    assert.equal(ls.length, 1);
    const p = ls[0], lake = t.lake;
    // On the plan's site: where the Sunwalk crosses the lake.
    const site = siteOf(planOf(t.habitat), 'lake-pavilion')!;
    assert.equal(p.theta, site.theta);
    assert.equal(p.s, site.s);
    assert.equal(p.s, lake.s);
    assert.ok(p.radius <= site.size, 'within the ground the plan keeps');
    assert.ok(p.radius <= params.landmarks.size / 2 && p.radius < lake.halfWidth, `radius ${p.radius}`);
    for (const r of t.rivers) {
      const mouth = r.theta[r.from === 'wild' ? r.count - 1 : 0];
      const apart = Math.abs(Math.atan2(Math.sin(mouth - p.theta), Math.cos(mouth - p.theta))) * derive(params).radius;
      assert.ok(apart > p.radius * 2, `${apart.toFixed(0)} m from a river mouth`);
    }
    assert.equal(p.bridges.length, 2);
    for (const b of p.bridges) {
      assert.ok(b.to > lake.halfWidth * 0.8 && b.to < lake.halfWidth * 2, `bridge to ${b.to}`);
      assert.ok(t.heightAt(p.theta, p.s + b.dir * b.to) > p.level, 'it ends on dry land');
      assert.ok(b.end >= 0 && b.end < pavilionPlan(p).deck * 2, `end ${b.end}`);
    }
    // Same habitat, same place (on the smallest: a second terrain costs time).
    if (name === 'small') assert.deepEqual(landmarksOf(makeTerrain(derive(params))), ls);
  });

  test(`landmarks (${name}): its deck and bridges are walkable, plants keep off them, the physics stands on them`, () => {
    const t = terrainOf(name, params), p = landmarksOf(t)[0];
    if (!p) return;
    const q = pavilionPlan(p), h = t.habitat, r = h.profile.at(p.s).r;
    // On the speaking floor (−x of the pool): the deck's top, above the water.
    const floorS = p.s - (q.pool + q.floor) / 2;
    const top = landmarkTopAt(t, p.theta, floorS)!;
    assert.ok(Math.abs(top - (p.level + q.deck)) < 0.05, `deck ${top} vs ${p.level + q.deck}`);
    assert.equal(landmarkTopAt(t, p.theta, p.s), null, 'the pool is open water');
    const b = p.bridges[0], mid = (b.from + b.to) / 2;
    assert.ok(Math.abs(landmarkTopAt(t, p.theta, p.s + b.dir * mid)! - (p.level + bridgeAt(q, b, mid))) < 0.05, 'on the bridge');
    assert.equal(landmarkTopAt(t, p.theta + (q.bridge * 3) / r, p.s + b.dir * mid), null, 'beside the bridge: water');
    // Kept clear: under the roof and by the landings; not a long way off.
    assert.ok(keptClear(t, p.theta, p.s + q.radius * 0.5));
    assert.ok(keptClear(t, p.theta, p.s + b.dir * (b.to + p.handrail)));
    assert.ok(!keptClear(t, p.theta + Math.PI / 2, p.s + b.dir * b.to));
    // The physics patch around the floor carries the deck: triangles at its height.
    const patch = buildPatch(t, p.theta, floorS, 40, 2), f = frameOf(h, p);
    let deck = 0;
    for (let v = 0; v < patch.positions.length / 3; v++) {
      const w = [patch.positions[v * 3] + patch.origin[0], patch.positions[v * 3 + 1] + patch.origin[1], patch.positions[v * 3 + 2] + patch.origin[2]] as [number, number, number];
      if (Math.abs(intoPlace(f, w)[2] - q.deck) < 0.01) deck++;
    }
    assert.ok(deck > 100, `${deck} deck points in the patch`);
  });

  test(`pavilion (${name}): every level whole and finite, faces wound to their normals, the same outline, finer up close`, () => {
    const p = pavilionFor(params);
    if (!p) return;
    const q = pavilionPlan(p), counts: number[] = [];
    for (const level of PAVILION_LEVELS) {
      const a: MappedArrays = buildPavilion(p, level).mappedArrays(), n: number = a.positions.length / 3;
      assert.equal(a.uvs.length, n * 2);
      assert.equal(a.finishes.length, n);
      for (const arr of [a.positions, a.normals, a.uvs]) assert.ok(arr.every(Number.isFinite), `${level}: finite`);
      assert.ok(a.finishes.every((f) => Object.values(FINISH).includes(f as 0)), 'known finishes');
      let wrong = 0, top = -Infinity, wide = 0;
      for (let k = 0; k < a.index.length; k += 3) {
        const [i, j, m] = [a.index[k], a.index[k + 1], a.index[k + 2]];
        const P = (v: number) => [a.positions[v * 3], a.positions[v * 3 + 1], a.positions[v * 3 + 2]];
        const A = P(i), B = P(j), C = P(m), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (Math.hypot(c[0], c[1], c[2]) < 1e-9) continue;
        if (c[0] * a.normals[i * 3] + c[1] * a.normals[i * 3 + 1] + c[2] * a.normals[i * 3 + 2] < 0) wrong++;
      }
      for (let v = 0; v < n; v++) { top = Math.max(top, a.positions[v * 3 + 2]); wide = Math.max(wide, Math.hypot(a.positions[v * 3 + 1])); }
      assert.equal(wrong, 0, `${level}: faces wound against their normals`);
      // The roof's crown (the oculus's bronze lip) and the eaves' reach are the same at every level.
      assert.ok(Math.abs(top - (roofAt(q, q.oculus) + q.shell * 0.6)) < 1e-3, `${level}: top ${top}`);
      assert.ok(Math.abs(wide - q.reach) < q.reach * 0.01, `${level}: ${wide} wide`);
      counts.push(a.index.length / 3);
    }
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `triangles by level ${counts}`);
    assert.ok(counts[0] < 4000, 'the far level is light');
  });
}

test('pavilion: walkable tops (deck, rows, stairs, passages, bridges), human steps in every size', () => {
  for (const { params } of MATRIX) {
    const p = pavilionFor(params);
    if (!p) continue;
    const q = pavilionPlan(p), polar = (r: number, a: number) => pavilionTop(p, r * Math.cos(a), r * Math.sin(a));
    assert.ok(q.riser <= p.handrail * 0.5 && q.tread >= p.handrail * 0.6, 'seats a person can sit on');
    assert.ok(q.eaves > q.deck + q.rows * q.riser + p.handrail * 2, 'headroom over the top row');
    assert.equal(polar(q.pool * 0.5, 1), null);
    assert.equal(polar((q.pool + q.floor) / 2, 1), q.deck);
    assert.equal(polar((q.floor + q.stand) / 2, 0), q.deck, 'a passage');
    const row = Math.floor(q.rows / 2), rr = q.floor + (row + 0.5) * q.tread;
    // Between a passage and the next stair (or passage, where the pavilion is too small for stairs).
    assert.ok(Math.abs(polar(rr, stairsOf(q).length ? Math.PI / 8 : Math.PI / 4)! - (q.deck + (row + 1) * q.riser)) < 1e-9, 'a row');
    assert.equal(polar(q.radius * 1.2, Math.PI / 2), null, 'off the deck, beside the bridges');
    assert.equal(pavilionTop(p, q.radius * 1.2, 0), bridgeAt(q, p.bridges[0], q.radius * 1.2));
  }
});

test('landmarks: the blueprint checks their scale; none without a lake; frames round-trip', () => {
  const ids = (c: Partial<HabitatParams>) => validate(derive(withParams(c))).map((f) => f.id);
  assert.ok(ids({ landmarks: { size: 120, handrail: 0 } }).includes('landmarks'));
  assert.ok(ids({ landmarks: { size: 5, handrail: 1.1 } }).includes('landmarks'));
  assert.ok(!ids({ landmarks: null }).includes('landmarks'));
  const t = terrainOf('reference', MATRIX[0].params), p = landmarksOf(t)[0], f = frameOf(t.habitat, p);
  const w = outOfPlace(f, [12, -7, 3]), back = intoPlace(f, w);
  assert.ok(Math.hypot(back[0] - 12, back[1] + 7, back[2] - 3) < 1e-6);
  assert.ok(reachOf(p) >= p.bridges[0].to);
});

test('shapes: a mapped shape gives every vertex its place on its surface and its finish', () => {
  const s = new Shape(8, true, true);
  s.finish = 2;
  s.quad([0, 0, 0], [2, 0, 0], [2, 0, 3], [0, 0, 3], [0, -1, 0]);
  s.finish = 1;
  s.arc(0, 5, 2, 5, 0, 1, 0, Math.PI / 2, 4);
  const a = s.mappedArrays();
  assert.deepEqual([...a.finishes.slice(0, 4)], [2, 2, 2, 2]);
  assert.deepEqual([...a.uvs.slice(0, 2)], planeMap([0, 0, 0], [0, -1, 0]));
  // A wall: along the horizontal and up; an arc: by arc length around and by height.
  assert.equal(a.uvs[2 * 2], 2); assert.equal(a.uvs[2 * 2 + 1], 3);
  const last = a.positions.length / 3 - 1;
  assert.ok(Math.abs(a.uvs[last * 2] - (Math.PI / 2) * 5) < 1e-6 && a.uvs[last * 2 + 1] === 2);
  assert.equal(a.finishes[last], 1);
});
