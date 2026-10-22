import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, toWorld } from '../src/blueprint';
import { CIRQUE, FLOOR_VALLEYS, GATE_TERRACES, HORN } from '../src/gen/terrain';
import { COURT, courtOf, planOf } from '../src/gen/plan';
import { slopeAt } from '../src/gen/scatter';
import { ecologyOf, terrainOf } from './worlds';
import { makeLayout, roots, bounds, buildTile, select, children, parent, keyId, cellSize, sphere, spheres, LodBudget, splitsAround, splitAround, packRelief, unpackRelief, CELL_PIXELS, RISE_RANGE, TILE_CELLS, type TileKey, type TileFit, type TileLayout, type TileMesh } from '../src/gen/tiles';

const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
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
  const eco = ecologyOf(name, params), t = eco.terrain, h = t.habitat;
  const layout = makeLayout(t);

  test(`terrain (${name}): wraps around the axis, stays within its relief, and the lake holds water`, () => {
    const rl = params.relief;
    for (let k = 0; k < 200; k++) {
      const theta = k * 2.399, s = (k / 200) * h.profile.length;
      assert.ok(Math.abs(t.heightAt(theta, s) - t.heightAt(theta + 2 * Math.PI, s)) < 1e-6, 'no seam at θ = 2π');
      const g = t.heightAt(theta, s);
      // The endcaps' landforms add at most a spur, its crags and the horn above, and the cirque's floor below.
      const above = Math.max(rl.hills * (1 + FLOOR_VALLEYS.ridge), rl.terraceStep) * 1.2 + rl.massif * (2.7 + HORN.height * 1.15) + 0.5;
      const below = (rl.ringLake?.depth ?? 0) + Math.max(rl.terraceStep, 1) + (rl.massif * CIRQUE.depth) / 0.2 + 0.5;
      assert.ok(g <= above && g >= -below, `height ${g} at ${s}`);
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

  test(`terrain (${name}): each entrance digs its court: a level floor under the ground, a steep wall up to the rim`, () => {
    const R = h.radius, plan = planOf(h);
    const courts = plan.sites.filter((k) => k.kind === 'entrance').slice(0, 12).map((k) => courtOf(h, k));
    if (!params.landmarks) { assert.ok(courts.every((c) => c === null)); return; }
    assert.ok(courts.length > 0);
    for (const c of courts) {
      if (!c) continue;
      const floor = t.heightAt(c.theta, c.s), at = (d: number, a: number) => t.heightAt(c.theta + (d * Math.cos(a)) / R, c.s + d * Math.sin(a));
      let rim = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 2 * Math.PI;
        assert.ok(Math.abs(at(c.radius * COURT.floor * 0.9, a) - floor) < 1e-6, 'the floor is level');
        // At the rim the court meets the ground: no step.
        assert.ok(Math.abs(at(c.radius * 0.999, a) - at(c.radius * 1.001, a)) < c.depth * 0.05 + 0.01, 'no step at the rim');
        rim += at(c.radius * 1.001, a) / 8;
        assert.deepEqual(t.courtAt(c.theta + (c.radius * 0.5 * Math.cos(a)) / R, c.s + c.radius * 0.5 * Math.sin(a))?.court, { ...c, floor });
      }
      assert.ok(rim - floor > c.depth * 0.6, `the floor ${(rim - floor).toFixed(1)} m under the rim`);
      // Its floor lies at least its depth under every point of the rim, and the terrain says where.
      for (let i = 0; i < 16; i++) assert.ok(at(c.radius * 1.001, (i / 16) * 2 * Math.PI) - floor > c.depth * 0.95, 'no daylight downhill');
      assert.ok(Math.abs(t.courts.find((k) => k.theta === c.theta && k.s === c.s)!.floor - floor) < 1e-9);
    }
  });

  test(`terrain (${name}): the floor rises from each valley's middle to the ridges between valleys`, () => {
    const P = h.profile, form = t.form, hills = params.relief.hills;
    if (form.valleys < 2 || hills <= 0) return;
    let ridge = 0, middle = 0, nr = 0, nm = 0;
    for (let i = 0; i < 600; i++) {
      const s = form.reserveEnd + ((i * 0.618034) % 1) * (P.floorEnd - form.reserveEnd), theta = i * 2.399963;
      if (t.lake && Math.abs(s - t.lake.s) < t.lake.halfWidth * 3) continue;
      const a = Math.abs(form.acrossAt(theta, s).across), g = t.heightAt(theta, s);
      if (a > 0.85) { ridge += g; nr++; } else if (a < 0.15) { middle += g; nm++; }
    }
    assert.ok(nr > 10 && nm > 10);
    assert.ok(ridge / nr - middle / nm > hills * FLOOR_VALLEYS.ridge * 0.6, `ridges ${(ridge / nr).toFixed(1)} m, valley middles ${(middle / nm).toFixed(1)} m`);
  });

  test(`terrain (${name}): the Mountain has spurs between its couloirs, a broad summit band, a horn at the head of the main valley, a level cirque`, () => {
    const P = h.profile, form = t.form, massif = params.relief.massif, R = h.radius;
    // Up the middle slopes the spurs stand well above the couloirs.
    let ridge = 0, couloir = 0, nr = 0, nc = 0;
    for (let i = 0; i < 400; i++) {
      const s = form.endcapAt(true, 0.4 + 0.35 * ((i * 0.618034) % 1)), theta = i * 2.399963;
      const a = Math.abs(form.acrossAt(theta, s).across), g = t.heightAt(theta, s);
      if (Math.abs(wrap(theta - form.valleyAt(0, s) - Math.PI)) * P.at(s).r < massif * CIRQUE.halfWidth * 1.2) continue;
      if (a > 0.8) { ridge += g; nr++; } else if (a < 0.2) { couloir += g; nc++; }
    }
    if (form.valleys > 1) assert.ok(ridge / nr - couloir / nc > massif * 0.4, `spurs ${(ridge / nr).toFixed(1)} over couloirs ${(couloir / nc).toFixed(1)} m`);
    // Near the axis the valleys crowd together, and the spurs give way to one broad summit band: no ring of thin fins.
    const tip = form.endcapAt(true, 0.15), r = P.at(tip).r, N = 1000;
    let steepest = 0, before = t.heightAt(0, tip);
    for (let i = 1; i <= N; i++) {
      const here = t.heightAt((i / N) * 2 * Math.PI, tip);
      steepest = Math.max(steepest, Math.abs(here - before) / ((r * 2 * Math.PI) / N));
      before = here;
    }
    assert.ok(steepest < 2.5, `around the summit band the rock climbs ${steepest.toFixed(1)} m per metre`);
    // The horn rises out of the slope at the head of the main valley.
    const hornS = form.endcapAt(true, HORN.gravity);
    assert.ok(t.heightAt(form.valleyAt(0, hornS), hornS) > massif * HORN.height * 0.6, 'the horn stands out');
    // The cirque's floor is dug level: the same elevation (height in from the hull) across it, below the slope around.
    const elevation = (theta: number, s: number): number => { const p = P.at(s); return R - p.r - t.heightAt(theta, s) * p.nr; };
    const lipS = form.endcapAt(true, CIRQUE.gravity), levels: number[] = [];
    for (const over of [0.2, 0.4, 0.6]) {
      const s = form.endcapAt(true, CIRQUE.gravity - (over * massif * CIRQUE.depth) / R);
      for (const off of [-0.3, 0, 0.3]) levels.push(elevation(form.valleyAt(0, s) + Math.PI + (off * massif * CIRQUE.halfWidth) / P.at(s).r, s));
    }
    const lip = R * (1 - CIRQUE.gravity);
    assert.ok(levels.every((l) => Math.abs(l - lip) < params.relief.terraceStep * 0.15 + massif * 0.15), `the cirque's floor at ${levels.map((l) => (l - lip).toFixed(1)).join(', ')} m from its lip`);
    assert.ok(lipS < P.floorStart);
  });

  test(`terrain (${name}): the Gate has its faces between buttresses: level rings on the Stair face, the Lift Stair's ramp up its middle`, () => {
    const P = h.profile, form = t.form, step = params.relief.terraceStep;
    const stair = form.faces.find((f) => f.kind === 'stair')!;
    // On the Stair face, away from the ramp and the buttresses, a ring of the slope stands at one height: formal rings.
    let rings = 0, tried = 0;
    for (let k = 3; k < 17; k++) {
      const s = P.floorEnd + ((P.length - P.floorEnd) * k) / 20, mid = form.valleyAt(stair.index, s), r = P.at(s).r;
      const half = Math.PI / form.valleys, ramp = (form.stairHalfWidth * 1.4) / r;
      if (ramp > half * 0.5) continue;
      const a = t.heightAt(mid + ramp + (half * 0.5 - ramp) * 0.3, s), b = t.heightAt(mid + ramp + (half * 0.5 - ramp) * 0.9, s);
      tried++;
      if (Math.abs(a - b) < step * 0.01 + 0.05) rings++;
    }
    assert.ok(tried === 0 || rings >= tried * 0.8, `${rings} of ${tried} rings level across the Stair face`);
    // The ramp is a plain slope: no terraces in it, only the endcap's roughness.
    let plain = 0, n = 0;
    for (let k = 3; k < 17; k++) {
      const s = P.floorEnd + ((P.length - P.floorEnd) * k) / 20;
      plain = Math.max(plain, Math.abs(t.heightAt(form.valleyAt(stair.index, s), s)));
      n++;
    }
    assert.ok(plain < step * GATE_TERRACES.stair.step * 0.35 + 1, `the ramp keeps within ${plain.toFixed(1)} m of the plain slope`);
    // Buttresses between the faces stand out of the slope.
    if (form.valleys > 1) {
      const s = form.endcapAt(false, 0.6);
      const between = (form.valleyAt(0, s) + form.valleyAt(1, s)) / 2;
      assert.ok(t.heightAt(between, s) > params.relief.massif * 0.4, 'a buttress between the first two faces');
    }
    // Every face has ledges level enough to grow on (the slope is steep, so walls take most of it, as on any terraced cliff).
    const level: Record<string, number> = {}, all: Record<string, number> = {};
    for (let i = 0; i < 1500; i++) {
      const s = P.floorEnd + (P.length - P.floorEnd) * (0.1 + 0.8 * ((i * 0.618034) % 1)), theta = i * 2.399963;
      const at = form.acrossAt(theta, s);
      if (Math.abs(at.across) > 0.6) continue;
      const kind = form.faces[at.valley].kind;
      all[kind] = (all[kind] ?? 0) + 1;
      if (slopeAt(eco, theta, s, t.heightAt(theta, s), step * 0.02) < 0.45) level[kind] = (level[kind] ?? 0) + 1;
    }
    for (const kind of Object.keys(all)) assert.ok((level[kind] ?? 0) / all[kind] > 0.05, `${(((level[kind] ?? 0) * 100) / all[kind]).toFixed(0)} % of the ${kind} face level enough to grow on`);
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
    // Skirts hang at least two of the tile's errors below its edge: a coarser neighbour strays by about its own.
    const sv = row * row * 3, drop = Math.hypot(ta.positions[sv] - ta.positions[0], ta.positions[sv + 1] - ta.positions[1], ta.positions[sv + 2] - ta.positions[2]);
    assert.ok(drop >= 2 * ta.error - 1e-3, `skirt ${drop.toFixed(2)} m against the error ${ta.error.toFixed(2)} m`);
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
  const t = terrainOf(MATRIX[0].name), h = t.habitat, layout = makeLayout(t), { profile } = h;
  // Every tile built, each as rough as its cells: enough to count what a view splits to.
  const errorOf = (k: TileKey): TileFit => ({ error: cellSize(layout, k) * 0.3, low: -10, high: 10 });
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
  const t = terrainOf(MATRIX[0].name), eco = ecologyOf(MATRIX[0].name), layout = makeLayout(t);
  let k: TileKey = { band: 0, column: 0, level: 0, i: 0, j: 0 };
  while (children(layout, k).length === 4) k = children(layout, k)[0];
  const kid = children(layout, k).find((c) => !splitAround(layout, c))!;
  assert.ok(kid, 'a child halved only along s');
  morphLands(layout, buildTile(eco, layout, k), buildTile(eco, layout, kid));
});

test('tiles: children built while a sibling is not are kept, not drawn', () => {
  const t = terrainOf(MATRIX[0].name), h = t.habitat, layout = makeLayout(t);
  const root: TileKey = { band: 3, column: 0, level: 0, i: 0, j: 0 }, kids = children(layout, root);
  const built = new Set([...roots(layout), ...kids.slice(1)].map(keyId));
  const eye = toWorld(h.profile, { theta: 0.1, s: (layout.bands[3].s0 + layout.bands[3].s1) / 2, h: 2 });
  const sel = select(t, layout, eye, PX_PER_RAD, 2, (k) => (built.has(keyId(k)) ? { error: cellSize(layout, k) * 0.3, low: -10, high: 10 } : undefined));
  assert.ok(sel.draw.some((k) => keyId(k) === keyId(root)));
  const want = new Set(sel.want.map(keyId)), keep = new Set(sel.keep.map(keyId)), draw = new Set(sel.draw.map(keyId));
  assert.ok(want.has(keyId(kids[0])));
  for (const k of kids.slice(1)) assert.ok(keep.has(keyId(k)) && !draw.has(keyId(k)), keyId(k));
});

// How fast a tile builds is timed in the slow suite (test/slow/terrain.slow.test.ts), warmed up first: a runner's speed
// varies 1.6× from one CI run to the next, which a timing here could not tell from a slowdown (Arnd, 2026-10-21).
test('tiles: nothing built yet means the roots are wanted first', () => {
  const t = terrainOf(MATRIX[0].name), h = t.habitat, layout = makeLayout(t);
  const sel = select(t, layout, [h.radius - 2, 0, h.length / 2], PX_PER_RAD, 2, () => undefined);
  assert.equal(sel.draw.length, 0);
  assert.equal(sel.want.length, roots(layout).length);
});

test('tiles: from high up a flat floor still splits until its cells are a few pixels (the far view)', () => {
  for (const { name, params } of MATRIX) {
    const t = terrainOf(name, params), h = t.habitat, layout = makeLayout(t), sphereOf = spheres(t, layout);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2;
    const eye = toWorld(h.profile, { theta: 0, s, h: h.radius * 0.5 });
    // Every tile built and perfectly flat: only the cells' size on screen can split them.
    const sel = select(t, layout, eye, PX_PER_RAD, 2, () => ({ error: 0, low: 0, high: 0 }), sphereOf);
    assert.ok(sel.draw.length > roots(layout).length, `${name}: ${sel.draw.length} tiles, only the roots`);
    for (const k of sel.draw) {
      const sp = sphereOf(k, { low: 0, high: 0 }), d = Math.max(1, Math.hypot(eye[0] - sp.center[0], eye[1] - sp.center[1], eye[2] - sp.center[2]) - sp.radius);
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

test('tiles: rock walls (an error that never shrinks) do not split every tile that sees them', () => {
  const t = terrainOf(MATRIX[0].name), h = t.habitat, layout = makeLayout(t), { profile } = h;
  // Over the floor near the foot of the Gate, 163 m up (Arnd, 2026-10-21: 4,214 tiles drawn there), every tile a cliff 60 m high.
  const theta = 323.8 * Math.PI / 180, s = profile.length - 5000;
  const eye = toWorld(profile, { theta, s, h: t.heightAt(theta, s) + 163 });
  const cliffs = select(t, layout, eye, PX_PER_RAD, 2, () => ({ error: 60, low: -10, high: 10 }));
  // No more than ground whose error is half its cells everywhere (`FINEST_CELL_PIXELS`); split by their error alone,
  // cliffs would take every tile within kilometres to the finest level (tens of thousands).
  const steep = select(t, layout, eye, PX_PER_RAD, 2, (k) => ({ error: cellSize(layout, k) / 2, low: -10, high: 10 }));
  assert.ok(cliffs.draw.length <= steep.draw.length, `${cliffs.draw.length} tiles with cliffs everywhere, ${steep.draw.length} on steep ground`);
  assert.ok(cliffs.draw.length < 2500, `${cliffs.draw.length} tiles drawn`);
});

test('tiles: a view over its bytes is drawn coarser until it fits, and eases back once it can', () => {
  const t = terrainOf(MATRIX[0].name), h = t.habitat, layout = makeLayout(t), { profile } = h;
  const TILE = 0.5 * 1048576, budget = new LodBudget(100 * 1048576);
  const fit = (k: TileKey): TileFit => ({ error: cellSize(layout, k) * 0.3, low: -10, high: 10 });
  const eye = toWorld(profile, { theta: 1, s: (profile.floorStart + profile.floorEnd) / 2, h: 2 });
  const used = (): number => { const sel = select(t, layout, eye, PX_PER_RAD, 2 * budget.scale, fit); return (sel.draw.length + sel.keep.length) * TILE; };
  assert.ok(used() > budget.bytes, 'the view needs more than the budget at full detail');
  let now = used();
  for (let f = 0; f < 80 && now > budget.bytes * 0.8; f++) { budget.update(now); now = used(); }
  assert.ok(budget.scale > 1 && now <= budget.bytes * 0.8, `scale ${budget.scale.toFixed(2)}: ${(now / 1048576).toFixed(0)} MB`);
  for (let f = 0; f < 400; f++) budget.update(0);
  assert.equal(budget.scale, 1);
});

test('tiles: a tile\'s sphere sits at its own height and holds its ground, so a Height\'s top is near and the floor below is far', () => {
  for (const { name, params } of MATRIX) {
    const t = terrainOf(name, params), h = t.habitat, layout = makeLayout(t), eco = ecologyOf(name, params);
    const top = planOf(h).grounds.find((g) => g.kind === 'height');
    if (!top) continue;
    // The tile on the Height's top, a few levels down.
    const level = Math.min(layout.maxLevel, 5);
    let k = roots(layout).find((r) => inside(layout, r, top.theta, top.s))!;
    while (k.level < level) k = children(layout, k).find((c) => inside(layout, c, top.theta, top.s))!;
    const tile = buildTile(eco, layout, k), sp = sphere(t, layout, k, tile.low, tile.high), row = TILE_CELLS + 1;
    for (let v = 0; v < row * row; v++) {
      const p = [0, 1, 2].map((a) => tile.origin[a] + tile.positions[v * 3 + a]);
      assert.ok(Math.hypot(p[0] - sp.center[0], p[1] - sp.center[1], p[2] - sp.center[2]) <= sp.radius + 1e-3, `${name}: a point of the tile outside its sphere`);
    }
    const ground = t.heightAt(top.theta, top.s);
    assert.ok(tile.low <= ground && ground <= tile.high, `${name}: the top at ${ground.toFixed(0)} m outside ${tile.low.toFixed(0)} … ${tile.high.toFixed(0)}`);
    // An eye standing on the top: the tile underfoot is near, a flat tile of the floor far below is as far as it is down.
    const eye = toWorld(h.profile, { theta: top.theta, s: top.s, h: ground + 2 });
    const d = (c: { center: number[]; radius: number }) => Math.hypot(eye[0] - c.center[0], eye[1] - c.center[1], eye[2] - c.center[2]) - c.radius;
    assert.ok(d(sp) <= 0, `${name}: the eye is outside the sphere of the ground it stands on`);
    const flat = sphere(t, layout, k, -1, 1);
    assert.ok(d(flat) > ground / 2, `${name}: the floor below at ${d(flat).toFixed(0)} m, the top is ${ground.toFixed(0)} m up`);
  }
});

function inside(layout: TileLayout, k: TileKey, theta: number, s: number): boolean {
  const b = bounds(layout, k);
  let x = theta - b.theta0;
  x -= Math.floor(x / (2 * Math.PI)) * 2 * Math.PI;
  return x < b.theta1 - b.theta0 && s >= b.s0 && s < b.s1;
}
