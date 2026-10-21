import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams, type HabitatParams } from '../src/blueprint';
import { makeTerrain, type Terrain } from '../src/gen/terrain';
import { buildLandmark, frameOf, keptClear, landmarkTopAt, landmarksOf, reachOf, type Hut, type Pavilion } from '../src/gen/landmarks';
import { FINISH, LANDMARK_LEVELS, bridgeAt, buildPavilion, pavilionPlan, pavilionTop, roofAt, stairsOf } from '../src/gen/pavilion';
import { buildPatch } from '../src/gen/patch';
import { planOf, siteOf } from '../src/gen/plan';
import { Shape, intoPlace, outOfPlace, planeMap, type MappedArrays } from '../src/gen/shapes';
import { hutBounds, hutPlan, hutTop, roofTopAt } from '../src/gen/summitHut';
import { fromWorld } from '../src/blueprint';

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

const pavilionOf = (t: Terrain): Pavilion | undefined => landmarksOf(t).find((l): l is Pavilion => l.kind === 'pavilion');
const hutOf = (t: Terrain): Hut | undefined => landmarksOf(t).find((l): l is Hut => l.kind === 'hut');

/** Every triangle of a mapped mesh wound to its normal: the count of those that are not. */
function wrongWound(a: MappedArrays): number {
  let wrong = 0;
  for (let k = 0; k < a.index.length; k += 3) {
    const [i, j, m] = [a.index[k], a.index[k + 1], a.index[k + 2]];
    const P = (v: number) => [a.positions[v * 3], a.positions[v * 3 + 1], a.positions[v * 3 + 2]];
    const A = P(i), B = P(j), C = P(m), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.hypot(c[0], c[1], c[2]) < 1e-9) continue;
    if (c[0] * a.normals[i * 3] + c[1] * a.normals[i * 3 + 1] + c[2] * a.normals[i * 3 + 2] < 0) wrong++;
  }
  return wrong;
}

for (const { name, params } of MATRIX) {
  test(`landmarks (${name}): the pavilion stands on the plan's site in the lake, away from the river mouths, bridged to dry land`, () => {
    const t = terrainOf(name, params), p = pavilionOf(t);
    if (!t.lake || !params.landmarks) { assert.equal(p, undefined, 'no lake, no pavilion'); return; }
    assert.ok(p);
    const lake = t.lake;
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
    if (name === 'small') assert.deepEqual(landmarksOf(makeTerrain(derive(params))), landmarksOf(t));
  });

  test(`landmarks (${name}): its deck and bridges are walkable, plants keep off them, the physics stands on them`, () => {
    const t = terrainOf(name, params), p = pavilionOf(t);
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
    for (const level of LANDMARK_LEVELS) {
      const a: MappedArrays = buildPavilion(p, level).mappedArrays(), n: number = a.positions.length / 3;
      assert.equal(a.uvs.length, n * 2);
      assert.equal(a.finishes.length, n);
      for (const arr of [a.positions, a.normals, a.uvs]) assert.ok(arr.every(Number.isFinite), `${level}: finite`);
      assert.ok(a.finishes.every((f) => Object.values(FINISH).includes(f as 0)), 'known finishes');
      const wrong = wrongWound(a);
      let top = -Infinity, wide = 0;
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

  test(`summit hut (${name}): on its site, out from the rock: the hall clear of it, the anchor and the struts buried in it`, () => {
    const t = terrainOf(name, params), l = hutOf(t), h = t.habitat;
    if (name === 'reference') assert.ok(l, 'the reference habitat has its summit hut');
    if (!l) return;
    const site = siteOf(planOf(h), 'summit-hut')!, q = hutPlan(l.handrail, l.scale), f = frameOf(h, l), hr = l.handrail;
    assert.equal(l.theta, site.theta);
    assert.equal(l.s, site.s);
    assert.ok(Math.abs(l.level - t.heightAt(l.theta, l.s)) < 1e-9, 'its frame stands on the rock at the site');
    const rock = (p: [number, number, number]): boolean => { const a = fromWorld(h.profile, ...outOfPlace(f, p)); return a.h < t.heightAt(a.theta, a.s); };
    // Human sizes whatever the habitat: headroom, walls to lean on, a hall to sit in.
    assert.ok(q.eaves >= hr * 2.4 && Math.abs(q.sill - hr * 0.95) < 1e-9 && q.width >= hr * 4 && q.length >= hr * 5, 'a hall of human size');
    // Nothing of the rock inside the hall, its roof or the chimney's height.
    for (const x of [0.05, 0.5, 1].map((u) => u * q.length)) for (const y of [-1, 0, 1].map((u) => u * (q.width / 2 - q.wall))) for (const z of [0.1, q.eaves, q.ridge]) {
      assert.ok(!rock([x, y, z]), `rock in the hall at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
    }
    // The anchor's back in the rock across its width, from its foot to its top; the struts end in the anchor or the rock.
    const b = hutBounds(l);
    let buried = 0, all = 0;
    for (const y of [-1, 0, 1].map((u) => u * q.span * 0.9)) for (const z of [0.1, 0.5, 0.9].map((u) => b.lo[2] + (q.top - b.lo[2]) * u)) { all++; if (rock([l.back + q.bury * 0.25, y, z])) buried++; }
    assert.equal(buried, all, `the anchor's back is in the rock at ${buried} of ${all} points`);
    for (const st of l.struts) assert.ok(rock(st.to) || (st.to[0] < 0 && st.to[2] > l.foot), `a strut ends in the open at ${st.to.map((v) => v.toFixed(1))}`);
    assert.ok(reachOf(l) > q.reach && reachOf(l) < q.reach * 3, `reach ${reachOf(l)}`);
  });

  test(`summit hut (${name}): one stands on its floor, terrace and prow; plants keep off it; the physics carries it`, () => {
    const t = terrainOf(name, params), l = hutOf(t), h = t.habitat;
    if (!l) return;
    const q = hutPlan(l.handrail, l.scale), f = frameOf(h, l);
    for (const [x, y] of [[q.length * 0.6, q.width / 4], [q.length + q.terrace / 2, 0], [q.length + q.terrace + q.prow * 0.5, 0]]) {
      const at = fromWorld(h.profile, ...outOfPlace(f, [x, y, 0])), top = landmarkTopAt(t, at.theta, at.s);
      assert.ok(top !== null && Math.abs(top - at.h) < l.handrail * 0.02, `stands at ${top?.toFixed(3)} for a floor at ${at.h.toFixed(3)} (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
    assert.equal(hutTop(l, q.length + q.terrace + q.prow * 0.5, q.root), null, 'beside the prow: the drop');
    assert.ok(keptClear(t, l.theta, l.s), 'no plants on the rock it hangs on');
    assert.ok(!keptClear(t, l.theta + Math.PI, l.s), 'plants across the Mountain');
    const terrace = fromWorld(h.profile, ...outOfPlace(f, [q.length + q.terrace / 2, 0, 0]));
    const patch = buildPatch(t, terrace.theta, terrace.s, 30, 2);
    let floor = 0;
    for (let v = 0; v < patch.positions.length / 3; v++) {
      const w = [patch.positions[v * 3] + patch.origin[0], patch.positions[v * 3 + 1] + patch.origin[1], patch.positions[v * 3 + 2] + patch.origin[2]] as [number, number, number];
      if (Math.abs(intoPlace(f, w)[2]) < 0.01) floor++;
    }
    assert.ok(floor > 20, `${floor} floor points in the patch`);
  });

  test(`summit hut (${name}): every level whole and finite, faces wound to their normals, the same outline, finer up close`, () => {
    const l = hutOf(terrainOf(name, params));
    if (!l) return;
    const q = hutPlan(l.handrail, l.scale), b = hutBounds(l), counts: number[] = [];
    for (const level of LANDMARK_LEVELS) {
      const a = buildLandmark(l, level).mappedArrays(), n = a.positions.length / 3;
      for (const arr of [a.positions, a.normals, a.uvs]) assert.ok(arr.every(Number.isFinite), `${level}: finite`);
      assert.ok(a.finishes.every((x) => Object.values(FINISH).includes(x as 0)), 'known finishes');
      assert.equal(wrongWound(a), 0, `${level}: faces wound against their normals`);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.positions[v * 3 + k]); hi[k] = Math.max(hi[k], a.positions[v * 3 + k]); }
      // The anchor's back and foot, the prow's tip and the eaves are the outline at every level, inside the box.
      assert.ok(Math.abs(lo[0] - l.back) < 1e-3 && Math.abs(lo[2] - l.foot) < 1e-3 && Math.abs(hi[0] - q.reach) < 1e-3, `${level}: ${lo} … ${hi}`);
      assert.ok(Math.abs(hi[1] - q.span) < 1e-3 && hi[2] <= b.hi[2] + 1e-3 && hi[2] > roofTopAt(q, 0), `${level}: top ${hi[2]}`);
      counts.push(a.index.length / 3);
    }
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `triangles by level ${counts}`);
    assert.ok(counts[0] < 400, 'the far level is light');
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
  const t = terrainOf('reference', MATRIX[0].params), p = pavilionOf(t)!, f = frameOf(t.habitat, p);
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
