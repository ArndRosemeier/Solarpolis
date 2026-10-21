import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, toWorld } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { makeLayout, roots, bounds, buildTile, select, children, parent, keyId, cellSize, spheres, splitsAround, splitAround, packRelief, unpackRelief, CELL_PIXELS, RISE_RANGE, TILE_CELLS, type TileKey, type TileLayout, type TileMesh } from '../src/gen/tiles';

const PX_PER_RAD = 1440 / (70 * Math.PI / 180);

/** A child tile's points plus their morph land on its parent's surface: its points, edges and cell diagonals. */
function morphLands(layout: TileLayout, parentTile: TileMesh, kid: TileMesh): void {
  const row = TILE_CELLS + 1, k = kid.key, around = splitAround(layout, k);
  const at = (pi: number, pj: number, c: number): number => parentTile.origin[c] + parentTile.positions[(pj * row + pi) * 3 + c];
  for (let j = 0; j <= TILE_CELLS; j += 7) {
    for (let i = 0; i <= TILE_CELLS; i += 3) {
      // Where the point sits in the parent's grid, in doubled units (odd: between two of its points).
      const u = around ? (k.i & 1) * TILE_CELLS + i : 2 * i, v = (k.j & 1) * TILE_CELLS + j;
      const pi = u >> 1, pj = v >> 1;
      for (let c = 0; c < 3; c++) {
        const morphed = kid.origin[c] + kid.positions[(j * row + i) * 3 + c] + kid.morph[(j * row + i) * 4 + c];
        const want = u & 1 && v & 1 ? (at(pi + 1, pj, c) + at(pi, pj + 1, c)) / 2
          : u & 1 ? (at(pi, pj, c) + at(pi + 1, pj, c)) / 2
          : v & 1 ? (at(pi, pj, c) + at(pi, pj + 1, c)) / 2 : at(pi, pj, c);
        assert.ok(Math.abs(morphed - want) < 4e-3 + Math.abs(want) * 2e-7, `morph of ${keyId(k)} at ${i},${j} axis ${c}: ${morphed} vs ${want}`);
      }
    }
  }
}

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const t = makeTerrain(h), eco = makeEcology(t);
  const layout = makeLayout(t);

  test(`terrain (${name}): wraps around the axis, stays within its relief, and the lake holds water`, () => {
    const rl = params.relief;
    for (let k = 0; k < 200; k++) {
      const theta = k * 2.399, s = (k / 200) * h.profile.length;
      assert.ok(Math.abs(t.heightAt(theta, s) - t.heightAt(theta + 2 * Math.PI, s)) < 1e-6, 'no seam at θ = 2π');
      const g = t.heightAt(theta, s);
      assert.ok(g <= Math.max(rl.hills, rl.terraceStep) * 1.2 + 0.5 && g >= -(rl.ringLake?.depth ?? 0) - Math.max(rl.terraceStep, 1) - 0.5, `height ${g} at ${s}`);
    }
    if (rl.ringLake) {
      assert.ok(t.lake, 'a ring lake');
      const lake = t.lake!;
      assert.ok(lake.s - lake.halfWidth > h.profile.floorStart && lake.s + lake.halfWidth < h.profile.floorEnd, 'on the floor');
      for (const theta of [0, 2, 4]) {
        assert.ok(t.heightAt(theta, lake.s) < lake.level - lake.depth * 0.5, 'deep in the middle');
        assert.equal(t.standAt(theta, lake.s), lake.level, 'one stands (swims) on the water');
      }
    } else assert.equal(t.lake, null);
  });

  test(`tiles (${name}): bands cover the profile, neighbours meet, faces look into the air`, () => {
    assert.equal(layout.bands[0].s0, 0);
    assert.ok(Math.abs(layout.bands[layout.bands.length - 1].s1 - h.profile.length) < 1e-6);
    const rs = roots(layout);
    assert.ok(rs.length >= 8 && rs.length <= 120, `${rs.length} roots`);
    // Two neighbours around the axis, at a fine level on the floor, share their edge points exactly.
    const band = layout.bands.findIndex((b) => b.s0 <= h.profile.floorStart + 1 && b.s1 > h.profile.floorStart + 1) + 1;
    const level = Math.min(3, layout.maxLevel - 1);
    const a: TileKey = { band, column: 0, level, i: 0, j: 0 }, b: TileKey = { ...a, i: 1 };
    const ta = buildTile(eco, layout, a), tb = buildTile(eco, layout, b);
    const row = TILE_CELLS + 1;
    for (let j = 0; j <= TILE_CELLS; j += 8) {
      const va = (j * row + TILE_CELLS) * 3, vb = (j * row) * 3;
      for (let c = 0; c < 3; c++) {
        const wa = ta.origin[c] + ta.positions[va + c], wb = tb.origin[c] + tb.positions[vb + c];
        assert.ok(Math.abs(wa - wb) < 2e-3 + Math.abs(wa) * 2e-7, `edge point ${j} axis ${c}: ${wa} vs ${wb}`);
      }
    }
    // Each point's floor layers share it whole (255 between them, give or take rounding).
    for (let v = 0; v < row * row; v += 31) {
      let sum = 0;
      for (let c = 0; c < 4; c++) sum += ta.floorA[v * 4 + c] + ta.floorB[v * 4 + c];
      assert.ok(Math.abs(sum - 255) <= 4, `floor shares at ${v} sum to ${sum}`);
    }
    // Normals face the air (towards the axis on the floor).
    for (let v = 0; v < row * row; v += 97) {
      const x = ta.origin[0] + ta.positions[v * 3], y = ta.origin[1] + ta.positions[v * 3 + 1];
      const r = Math.hypot(x, y);
      assert.ok((-x * ta.normals[v * 3] - y * ta.normals[v * 3 + 1]) / r > 0.5);
    }
    // Geomorphing: a child's points plus their morph land on the parent's surface (its points and its cell diagonals).
    morphLands(layout, ta, buildTile(eco, layout, children(layout, a)[3]));
    // Children exactly tile their parent.
    const p = bounds(layout, a), kids = children(layout, a).map((k) => bounds(layout, k));
    assert.equal(Math.min(...kids.map((k) => k.theta0)), p.theta0);
    assert.ok(Math.abs(Math.max(...kids.map((k) => k.s1)) - p.s1) < 1e-9);
  });

  test(`tiles (${name}): about square everywhere, also where the endcaps' rings shrink to the axis`, () => {
    const { profile } = h;
    layout.bands.forEach((b, band) => {
      for (let level = 0; level <= layout.maxLevel; level++) {
        for (let j = 0; j < 1 << level; j++) {
          // Each row's tiles are as wide around (at their widest circle) as they are long, within a halving.
          const ds = (b.s1 - b.s0) / (1 << level), s0 = b.s0 + j * ds, s1 = s0 + ds;
          const widest = Math.max(profile.circumference(s0), profile.circumference(s1), profile.circumference((s0 + s1) / 2));
          const ratio = widest / b.columns / (1 << splitsAround(layout, { band, level, j })) / ds;
          assert.ok(ratio > 0.7 && ratio < 1.42, `band ${band} level ${level} row ${j}: ${ratio.toFixed(2)} as wide as long`);
        }
      }
    });
    // Children tile their parent exactly, and know it as their parent, wherever they are split only along s or both ways.
    let alongOnly = 0;
    for (const band of [0, layout.bands.length - 1]) {
      let k: TileKey = { band, column: 0, level: 0, i: 0, j: 0 };
      while (k.level < layout.maxLevel) {
        const kids = children(layout, k), p = bounds(layout, k);
        alongOnly += kids.length < 4 ? 1 : 0;
        let area = 0;
        for (const c of kids) {
          assert.deepEqual(parent(layout, c), k);
          const cb = bounds(layout, c);
          assert.ok(cb.theta0 >= p.theta0 - 1e-12 && cb.theta1 <= p.theta1 + 1e-12 && cb.s0 >= p.s0 - 1e-9 && cb.s1 <= p.s1 + 1e-9);
          area += (cb.theta1 - cb.theta0) * (cb.s1 - cb.s0);
        }
        assert.ok(Math.abs(area - (p.theta1 - p.theta0) * (p.s1 - p.s0)) < 1e-9 * area);
        // Down towards the end of the profile (the axis at the wild end, the hub at the port end).
        k = band === 0 ? kids[0] : kids[kids.length - 1];
      }
    }
    assert.ok(alongOnly > 0, 'near the axis, tiles split only along s');
  });
}

test('tiles: the view where the sunline meets an endcap needs no more tiles than one on the floor', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), layout = makeLayout(t), { profile } = h;
  // Every tile built, each as rough as its cells: enough to count what a view splits to.
  const errorOf = (k: TileKey): number => cellSize(layout, k) * 0.3;
  const count = (s: number): ReturnType<typeof select> => select(t, layout, toWorld(profile, { theta: 1, s, h: 2 }), PX_PER_RAD, 2, errorOf);
  const floor = count((profile.floorStart + profile.floorEnd) / 2).draw.length;
  for (const s of [20, profile.length - 20]) {
    const sel = count(s);
    // Before, each row near the axis was halved around as often as along: tens of thousands of slivers.
    assert.ok(sel.draw.length < floor * 2, `${sel.draw.length} tiles at s = ${s.toFixed(0)}, ${floor} on the floor`);
    // The cache keeps every drawn tile's ancestors (all split on the way), and nothing else here: all are built.
    const keep = new Set(sel.keep.map(keyId)), above = new Set<string>();
    for (let k of sel.draw) while (k.level > 0) { k = parent(layout, k); above.add(keyId(k)); }
    assert.deepEqual([...above].sort(), [...keep].sort());
  }
});

test('tiles: a tile split only along s geomorphs into its parent', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), eco = makeEcology(t), layout = makeLayout(t);
  let k: TileKey = { band: 0, column: 0, level: 0, i: 0, j: 0 };
  while (children(layout, k).length === 4) k = children(layout, k)[0];
  const kid = children(layout, k).find((c) => !splitAround(layout, c))!;
  assert.ok(kid, 'a child halved only along s');
  morphLands(layout, buildTile(eco, layout, k), buildTile(eco, layout, kid));
});

test('tiles: children built while a sibling is not are kept, not drawn', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), layout = makeLayout(t);
  const root: TileKey = { band: 3, column: 0, level: 0, i: 0, j: 0 }, kids = children(layout, root);
  const built = new Set([...roots(layout), ...kids.slice(1)].map(keyId));
  const eye = toWorld(h.profile, { theta: 0.1, s: (layout.bands[3].s0 + layout.bands[3].s1) / 2, h: 2 });
  const sel = select(t, layout, eye, PX_PER_RAD, 2, (k) => (built.has(keyId(k)) ? cellSize(layout, k) * 0.3 : undefined));
  assert.ok(sel.draw.some((k) => keyId(k) === keyId(root)));
  const want = new Set(sel.want.map(keyId)), keep = new Set(sel.keep.map(keyId)), draw = new Set(sel.draw.map(keyId));
  assert.ok(want.has(keyId(kids[0])));
  for (const k of kids.slice(1)) assert.ok(keep.has(keyId(k)) && !draw.has(keyId(k)), keyId(k));
});

test('tiles: nothing built yet means the roots are wanted first; a tile builds within its budget', () => {
  const h = derive(MATRIX[0].params);
  const t = makeTerrain(h), eco = makeEcology(t), layout = makeLayout(t);
  const sel = select(t, layout, [h.radius - 2, 0, h.length / 2], PX_PER_RAD, 2, () => undefined);
  assert.equal(sel.draw.length, 0);
  assert.equal(sel.want.length, roots(layout).length);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) buildTile(eco, layout, { band: 3, column: i, level: 2, i: 1, j: 1 });
  const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 40, `${ms.toFixed(1)} ms per tile`);
});

test('tiles: from high up a flat floor still splits until its cells are a few pixels (the far view)', () => {
  for (const { name, params } of MATRIX) {
    const h = derive(params), t = makeTerrain(h), layout = makeLayout(t), sphereOf = spheres(t, layout);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2;
    const eye = toWorld(h.profile, { theta: 0, s, h: h.radius * 0.5 });
    // Every tile built and perfectly flat: only the cells' size on screen can split them.
    const sel = select(t, layout, eye, PX_PER_RAD, 2, () => 0, sphereOf);
    assert.ok(sel.draw.length > roots(layout).length, `${name}: ${sel.draw.length} tiles, only the roots`);
    for (const k of sel.draw) {
      const sp = sphereOf(k), d = Math.max(1, Math.hypot(eye[0] - sp.center[0], eye[1] - sp.center[1], eye[2] - sp.center[2]) - sp.radius);
      assert.ok(k.level === layout.maxLevel || (cellSize(layout, k) / d) * PX_PER_RAD <= CELL_PIXELS + 1e-9, `${name}: tile ${k.level} has cells over ${CELL_PIXELS} px`);
    }
  }
});

test('tiles: a point\'s rise over the ground around it packs into one float and back', () => {
  for (const [own, parent] of [[0, 0], [0.2, -0.1], [-0.5, 0.5], [3, -3]]) {
    const [a, b] = unpackRelief(packRelief(own, parent));
    assert.ok(Math.abs(a - Math.max(-RISE_RANGE, Math.min(RISE_RANGE, own))) < RISE_RANGE / 120, `${own} → ${a}`);
    assert.ok(Math.abs(b - Math.max(-RISE_RANGE, Math.min(RISE_RANGE, parent))) < RISE_RANGE / 120, `${parent} → ${b}`);
  }
});
