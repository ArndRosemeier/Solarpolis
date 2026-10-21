import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash3f } from '@futuremagic/core';
import { CLIMATES, derive, fromWorld, toWorld, withParams } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology, TREE_HEIGHT } from '../src/gen/ecology';
import { cellId, cellsNear, LEVELS, nearestOf, plantCell, plantsOf, PLANT_STRIDE, type Level } from '../src/gen/scatter';
import { draws, handover, handOverPick, holes, sweepTo, type Band, type Piece } from '../src/gen/handover';
import { EYE_HEIGHT } from '../src/world/walker';

/** Three levels as plants have them (sight unit 6 m), each fading in where the one before fades out. */
const BANDS: Band[] = LEVELS.map((l) => l.fade.map((f) => f * 6) as Band);

/** Pieces of a level from `from` to `to` m, `size` m each, built where `ready` says. */
const ring = (from: number, to: number, size: number, ready: (near: number) => boolean): Piece[] => {
  const out: Piece[] = [];
  for (let d = from; d < to; d += size) out.push({ near: d, far: d + size, ready: ready(d) });
  return out;
};

test('handover: all built, every level draws its own band', () => {
  const pieces = BANDS.map((b) => ring(0, b[3], 8, () => true));
  assert.deepEqual(handover(BANDS, pieces), BANDS);
  assert.deepEqual(holes(BANDS, pieces), [0, 0, 0]);
});

test('handover: where a finer level is not built yet, the coarser one draws there, and no level draws a missing piece', () => {
  for (let seed = 0; seed < 400; seed++) {
    const r = (q: number) => hash3f(seed, q, 7, 1);
    // Some pieces of each level not built yet, anywhere in its reach; the coarser levels' from the eye out.
    const pieces = BANDS.map((b, k) => ring(0, b[3], 4 + 8 * k + r(k) * 6, (near) => hash3f(seed, k, Math.round(near * 10), 2) > r(9 + k) * 0.6));
    const bands = handover(BANDS, pieces);
    const h = holes(bands, pieces);
    assert.deepEqual(h.slice(0, -1), [0, 0], `seed ${seed}: holes ${h} with ${JSON.stringify(bands)}`);
    for (let k = 0; k < bands.length; k++) {
      const b = bands[k];
      if (draws(b)) assert.ok(b[0] < b[1] && b[1] <= b[2] + 1e-9 && b[2] < b[3], `seed ${seed} level ${k}: ordered ${b}`);
      else assert.ok(b[2] === b[0] && b[3] === b[1], `seed ${seed} level ${k}: folded onto its fade-in ${b}`);
      // Contiguous: each level fades in exactly where the one before fades out, so every distance has its level.
      if (k) assert.deepEqual(b.slice(0, 2), bands[k - 1].slice(2), `seed ${seed}: level ${k} takes over where ${k - 1} stops`);
      // Only ever nearer than configured: a coarser level stands in, it never gives up its own far edge.
      assert.ok(b[3] <= BANDS[k][3] && (k < bands.length - 1 || b[3] === BANDS[k][3]), `seed ${seed}: level ${k} reaches ${b[3]}`);
    }
  }
});

test('handover: the boundary sweeps in at once and out over a moment, and while it moves nothing is missing', () => {
  // A walk: the finest level's pieces are built a while after they come into reach; the sweep never runs ahead.
  let now: [number, number] = [BANDS[0][2], BANDS[0][3]];
  const builtAt = new Map<number, number>();
  for (let frame = 0; frame < 600; frame++) {
    const eye = frame * 0.05; // m along, at a walking pace of 3 m/s
    const pieces: Piece[][] = BANDS.map((b, k) => ring(Math.floor(eye / 4) * 4 - eye, b[3], 4 * (k + 1), () => true));
    pieces[0] = pieces[0].map((p) => {
      const id = Math.round(p.near + eye);
      if (!builtAt.has(id)) builtAt.set(id, frame + 20 + (id % 7) * 5); // 20 to 50 frames to build
      return { ...p, ready: frame >= builtAt.get(id)! };
    });
    const want = handover(BANDS, pieces);
    now = sweepTo(now, [want[0][2], want[0][3]], 1 / 60);
    assert.ok(now[0] <= want[0][2] + 1e-9 && now[1] <= want[0][3] + 1e-9, `frame ${frame}: not past where the handover allows`);
    const drawn: Band[] = [[BANDS[0][0], BANDS[0][1], now[0], now[1]], [now[0], now[1], want[1][2], want[1][3]], want[2]];
    assert.deepEqual(holes(drawn, pieces).slice(0, -1), [0, 0], `frame ${frame}`);
  }
  // Out again once all is built: over about the sweep, not at once.
  let t = 0, b: [number, number] = [0, 6];
  const target: [number, number] = [BANDS[0][2], BANDS[0][3]];
  const first = sweepTo(b, target, 1 / 60);
  assert.ok(first[1] < target[1] / 2, 'not in one frame');
  while (b[1] < target[1] && t < 5) { b = sweepTo(b, target, 1 / 60); t += 1 / 60; }
  assert.ok(t > 0.2 && t < 2, `swept out in ${t.toFixed(2)} s`);
  assert.deepEqual(sweepTo([10, 20], [3, 9], 1 / 60), [3, 9], 'in at once');
});

test('handover: every plant near the eye is drawn by exactly one level while the finer levels are half built', () => {
  // The real plants of a shrub and a tree, their real cells, the shaders' rule (`plantFrame`): level k draws a plant
  // at distance d with threshold p where out_k(d) ≤ p ≤ into_k(d).
  const h = derive(withParams({ climate: 'temperate-mild' })), eco = makeEcology(makeTerrain(h)), plants = plantsOf(eco);
  const s = (h.profile.floorStart + h.profile.floorEnd) / 2, middle = toWorld(h.profile, { theta: 0.7, s, h: EYE_HEIGHT });
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const name of ['hawthorn', 'oak']) {
    const sp = plants.find((p) => p.spec.name === name)!;
    // Standing a little way from the nearest of them; out past the full level's handover (a tree's) or both (a shrub's).
    const p = fromWorld(h.profile, ...nearestOf(eco, plants, sp, middle)!), eye = toWorld(h.profile, { theta: p.theta, s: p.s + 12, h: EYE_HEIGHT });
    const reach = sp.tall < TREE_HEIGHT ? sp.band[1][3] * 1.1 : sp.band[0][3] * 1.2;
    const pieces: Piece[][] = [], cells: { level: Level; ready: boolean; cell: ReturnType<typeof plantCell> }[] = [];
    for (let level = 0 as Level; level < sp.band.length; level++) {
      pieces.push([]);
      for (const c of cellsNear(eco, sp, level, eye, level ? 0 : undefined)) {
        if (c.near > reach) continue;
        // Half the finer levels' cells still being planted; the far level all there.
        const ready = level === sp.band.length - 1 || hash3f(3, level, cellId(c.key).length + c.key.j * 31 + c.key.i, 4) > 0.5;
        pieces[level].push({ near: c.near, far: c.far, ready });
        if (ready) cells.push({ level, ready, cell: plantCell(eco, plants, c.key) });
      }
    }
    const bands = handover(sp.band, pieces);
    const drawnBy = new Map<string, number>();
    const at = new Map<string, number>();
    for (const { level, cell } of cells) for (const list of cell.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
      const x = cell.origin[0] + list[i], y = cell.origin[1] + list[i + 1], z = cell.origin[2] + list[i + 2];
      const d = Math.hypot(x - eye[0], y - eye[1], z - eye[2]);
      if (d > reach) continue;
      const id = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`, b = bands[level], pick = handOverPick(list[i + 4]);
      at.set(id, d);
      const into = smooth(b[0], b[1], d), out = smooth(b[2], b[3], d);
      if (draws(b) && pick <= into * 1.0001 && out <= pick) drawnBy.set(id, (drawnBy.get(id) ?? 0) + 1);
      else drawnBy.set(id, drawnBy.get(id) ?? 0);
    }
    assert.ok(at.size > 3, `${name}: some plants near (${at.size})`);
    for (const [id, n] of drawnBy) assert.equal(n, 1, `${name} at ${at.get(id)!.toFixed(1)} m: drawn by ${n} levels (bands ${JSON.stringify(bands)})`);
  }
});

test('bushes: most of them well below the eyes of someone standing (Arnd: man-high bushes)', () => {
  for (const climate of Object.values(CLIMATES)) {
    for (const b of climate.biomes) for (const p of b.plants) {
      if (p.form !== 'shrub' && p.form !== 'evergreen-shrub') continue;
      assert.ok(p.height[1] < EYE_HEIGHT - 0.25 && (p.height[0] + p.height[1]) / 2 < 1.1, `${p.name}: ${p.height} m`);
      assert.ok(p.height[1] < TREE_HEIGHT);
    }
  }
});
