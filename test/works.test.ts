import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothstep } from '@futuremagic/core';
import { DISTRICT_STYLES, MATRIX, derive, validate, withParams } from '../src/blueprint';
import { entrancesOf, fromLake, makePlan, planOf } from '../src/gen/plan';
import { SIGNATURE, SIGNATURE_KINDS, STYLE_WORKS, WORKS, WORK_KINDS, isDug, isSignature, workAt, type DistrictWorkKind, type SignatureKind, type Work, type WorkKind } from '../src/gen/works';
import { habitatOf, terrainOf } from './worlds';

const TURN = 2 * Math.PI, DEG = Math.PI / 180;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);

/** A work of a kind on its own, for its shape (a signature work as in a habitat of radius 4 km). */
const lone = (kind: WorkKind, crisp: number, vary = 0.37): Work => {
  if (kind in SIGNATURE_KINDS) {
    const spec = SIGNATURE_KINDS[kind as SignatureKind];
    return { id: 0, kind, district: 0, theta: 0, s: 0, height: 4000 * spec.height, radius: 4000 * spec.radius, facing: spec.axial ? 0 : 0.7, crisp, vary };
  }
  const spec = WORK_KINDS[kind as DistrictWorkKind], height = 100 * spec.height[1];
  return { id: 0, kind, district: 0, theta: 0, s: 0, height, radius: height * spec.spread, facing: 0.7, crisp, vary };
};
const ALL_KINDS = [...Object.keys(WORK_KINDS), ...SIGNATURE.order] as WorkKind[];

test('works: every style makes works of its own kinds, and a habitat without sensible works is invalid', () => {
  for (const style of DISTRICT_STYLES) assert.ok(STYLE_WORKS[style].length > 0, `${style} makes something`);
  const ids = (works: number, wild: number) => validate(derive(withParams({ relief: { ...MATRIX[0].params.relief, landforms: { ...MATRIX[0].params.relief.landforms!, works, wild } } }))).filter((f) => f.id === 'relief');
  assert.equal(ids(0.06, 1.5).length, 0);
  assert.ok(ids(-0.1, 1.5).length > 0 && ids(0.5, 1.5).length > 0 && ids(0.06, -1).length > 0);
  const signature = (n: number) => validate(derive(withParams({ relief: { ...MATRIX[0].params.relief, landforms: { ...MATRIX[0].params.relief.landforms!, signature: n } } }))).filter((f) => f.id === 'relief');
  assert.equal(signature(0).length + signature(3).length, 0);
  assert.ok(signature(4).length > 0 && signature(1.5).length > 0 && signature(-1).length > 0);
});

test('works: each shape stays in its footprint, rises (or is dug) to its height, and is never steeper than a cliff', () => {
  for (const kind of ALL_KINDS) {
    for (const crisp of [0, 1]) {
      const w = lone(kind, crisp), r = w.radius, n = kind in SIGNATURE_KINDS ? 120 : 50, e = r / n;
      let top = -Infinity, bottom = Infinity, steepest = 0;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const du = i * e, dv = j * e;
        const a = workAt(w, du, dv), b = workAt(w, du + e * 0.25, dv), c = workAt(w, du, dv + e * 0.25);
        assert.ok(Number.isFinite(a));
        if (du * du + dv * dv >= r * r) { assert.ok(Math.abs(a) === 0, `${kind} outside its footprint`); continue; }
        top = Math.max(top, a); bottom = Math.min(bottom, a);
        steepest = Math.max(steepest, Math.hypot(b - a, c - a) / (e * 0.25));
      }
      // Toward the rim it comes down to the land.
      for (let q = 0; q < 16; q++) assert.ok(Math.abs(workAt(w, r * 0.999 * Math.cos(q), r * 0.999 * Math.sin(q))) < w.height * 0.02, `${kind} meets the land at its rim`);
      if (isDug(w)) assert.ok(bottom < -w.height * 0.9 && top < w.height * 0.2, `${kind} dug ${bottom.toFixed(1)} of ${w.height}`);
      else assert.ok(top > w.height * 0.85 && top <= w.height * 1.001, `${kind} rises to ${top.toFixed(1)} of ${w.height}`);
      assert.ok(Math.atan(steepest) < 81 * DEG, `${kind} ${(Math.atan(steepest) / DEG).toFixed(0)}° steep`);
    }
  }
});

test('works: the terraced kinds are cut in level ledges, crisp where cared for and worn back where not', () => {
  for (const kind of ['pyramid', 'cone', 'dome', 'stepwell', 'amphitheatre'] as WorkKind[]) {
    /** Down a line from the middle: the share of the sloping part that is near level, and its steepest riser. */
    const cut = (crisp: number): { ledges: number; riser: number } => {
      // (Away from its facing: an amphitheatre's tiers are round the half behind its stage.)
      const w = lone(kind, crisp), n = 2000, e = w.radius / n, u = -Math.sin(w.facing) * e, v = -Math.cos(w.facing) * e;
      let ledges = 0, sloping = 0, riser = 0;
      for (let i = 0; i < n * 0.9; i++) {
        const a = workAt(w, i * u, i * v), b = workAt(w, (i + 1) * u, (i + 1) * v), g = Math.abs(b - a) / e;
        riser = Math.max(riser, g);
        if (Math.abs(a) > w.height * 0.02 && Math.abs(a) < w.height * 0.98) { sloping++; if (g < 0.05) ledges++; }
      }
      return { ledges: ledges / Math.max(1, sloping), riser };
    };
    const crisp = cut(1), worn = cut(0);
    assert.ok(crisp.ledges > 0.4, `${kind}: ${(crisp.ledges * 100).toFixed(0)}% ledges`);
    assert.ok(crisp.riser > worn.riser * 1.3, `${kind}: risers ${crisp.riser.toFixed(2)} crisp, ${worn.riser.toFixed(2)} worn`);
  }
});

test('works: the Spiral winds a level ramp up its flank, the Wave Field\'s waves run across its facing, the Tilt climbs gently to its cliff', () => {
  const spiral = lone('spiral', 1), r = spiral.radius, H = spiral.height;
  // Out from its middle: level treads, one riser per turn.
  let ledges = 0, sloping = 0;
  for (let i = 0, n = 2000; i < n * 0.9; i++) {
    const a = workAt(spiral, (i * r) / n, 0), b = workAt(spiral, ((i + 1) * r) / n, 0);
    if (a > H * 0.02 && a < H * 0.98) { sloping++; if (Math.abs(b - a) / (r / n) < 0.05) ledges++; }
  }
  assert.ok(ledges > 0.5 * sloping, `${ledges} of ${sloping} level`);
  // Round it, halfway out: up the ramp nearly all the way, then one drop to the turn below.
  let up = 0, down = 0, was = workAt(spiral, r * 0.5, 0);
  for (let q = 1; q <= 720; q++) {
    const a = (q / 720) * TURN, z = workAt(spiral, r * 0.5 * Math.sin(a), r * 0.5 * Math.cos(a));
    if (z > was + 1e-9) up++; else if (z < was - 1e-9) down++;
    was = z;
  }
  assert.ok(up > 0.7 * 720 && down < 0.25 * 720, `round the Spiral ${up} steps up, ${down} down`);
  // The ramp's grade, a turn's rise over the way round it.
  assert.ok(H / SIGNATURE.turns / (TURN * r * 0.5) < 0.05, 'a walkable ramp');

  const waves = lone('wave-field', 1);
  let crests = 0;
  for (let i = 1, n = 4000; i < n; i++) {
    const x = (i / n - 0.5) * 2 * waves.radius, z = (k: number) => workAt(waves, 0, x + (k * 2 * waves.radius) / n);
    if (z(0) > z(-1) && z(0) >= z(1) && z(0) > waves.height * 0.2) crests++;
  }
  assert.ok(crests >= 8, `${crests} waves`);
  // Along a crest it stays a wave: round the cylinder (across its facing) the height changes slowly.
  const mid = workAt(waves, 0, (SIGNATURE.wave * waves.height) / 2), side = workAt(waves, waves.radius * 0.3, (SIGNATURE.wave * waves.height) / 2);
  assert.ok(mid > waves.height * 0.8 && side > mid * 0.75, `a crest ${mid.toFixed(1)} m in the middle, ${side.toFixed(1)} m out to the side`);

  const tilt = lone('tilt', 1), tr = tilt.radius;
  const back = workAt(tilt, 0, -tr * 0.8), middle = workAt(tilt, 0, 0), front = workAt(tilt, 0, tr * 0.8);
  assert.ok(back < middle && middle < front && front > tilt.height * 0.9, `${back.toFixed(0)} → ${middle.toFixed(0)} → ${front.toFixed(0)} m`);
  const grade = Math.atan((front - back) / (tr * 1.6)) / DEG;
  assert.ok(grade > 5 && grade < 12, `tilted ${grade.toFixed(1)}°`);
  assert.equal(workAt(tilt, 0, tr * 0.95), 0, 'a cliff at its front');
});

for (const { name, params } of MATRIX) {
  const h = habitatOf(name), plan = planOf(h), R = h.radius, spacing = params.plan.entranceSpacing;
  const dist = (a: { theta: number; s: number }, b: { theta: number; s: number }): number => Math.hypot(wrap(a.theta - b.theta) * R, a.s - b.s);

  test(`works (${name}): each district shapes its ground in its style's kinds, inside its borders, the reserve in nature's`, () => {
    const works = plan.works, scale = params.relief.landforms!.works! * R;
    assert.ok(works.length >= plan.districts.length, `${works.length} works in ${plan.districts.length} districts`);
    works.forEach((w, i) => assert.equal(w.id, i));
    let shaped = 0;
    for (const d of plan.districts) {
      const own = works.filter((w) => w.district === d.id && !isSignature(w));
      if (own.length) shaped++;
      for (const w of own) {
        assert.ok(STYLE_WORKS[d.style].includes(w.kind as DistrictWorkKind), `a ${w.kind} in a ${d.style} district`);
        assert.ok(plan.inside(d, w.theta, w.s, w.radius * 0.7 - 1e-6), 'inside its district');
        assert.ok(Math.abs(w.crisp - smoothstep(WORKS.care[0], WORKS.care[1], d.care)) < 1e-9, 'kept as its district is cared for');
      }
    }
    assert.ok(shaped >= plan.districts.length * 0.8, `${shaped} of ${plan.districts.length} districts shaped their ground`);
    for (const w of works) {
      if (isSignature(w)) continue;
      const spec = WORK_KINDS[w.kind as DistrictWorkKind];
      assert.ok(w.height <= spec.height[1] * scale + 1e-6 && w.radius <= spacing * WORKS.reach + 1e-6, `${w.kind} ${w.height.toFixed(0)} m, ${w.radius.toFixed(0)} m wide`);
      if (spec.axial) assert.ok(Math.abs(Math.sin(w.facing)) < 1e-9, `${w.kind} faces along the axis`);
      if (w.district < 0) assert.ok(w.s < plan.reserveEnd && STYLE_WORKS['let-go'].includes(w.kind as DistrictWorkKind) && w.crisp === 0, 'the reserve: nature\'s own');
    }
    assert.ok(works.some((w) => w.district < 0), 'some in the wild reserve');
  });

  test(`works (${name}): the signature works stand in full view of the Sunwalk, each its own kind, in their turn`, () => {
    const sig = plan.works.filter(isSignature), want = params.relief.landforms!.signature ?? 0;
    if (name === 'reference') assert.equal(sig.length, want, 'the reference habitat has them all');
    assert.ok(sig.length >= Math.min(1, want), `${sig.length} of ${want}`);
    sig.forEach((w, i) => assert.equal(w.kind, SIGNATURE.order[i], 'in turn'));
    const walk = plan.paths.find((p) => p.kind === 'sunwalk')!.points;
    for (const w of sig) {
      const spec = SIGNATURE_KINDS[w.kind as SignatureKind];
      assert.ok(w.radius <= spec.radius * R + 1e-6 && Math.abs(w.height / w.radius - spec.height / spec.radius) < 1e-9, `${w.kind} sized as a share of the radius`);
      assert.ok(w.crisp >= SIGNATURE.crisp && w.s > plan.reserveEnd, `${w.kind} kept, on the worked floor`);
      let near = Infinity;
      for (let k = 0; k < walk.length; k += 2) near = Math.min(near, dist({ theta: walk[k], s: walk[k + 1] }, w) - w.radius);
      assert.ok(near < (TURN * R) / plan.valleys / 2, `${w.kind} ${near.toFixed(0)} m from the Sunwalk`);
      assert.equal(plan.workOf(w.theta, w.s), w);
    }
  });

  test(`works (${name}): clear of the courts, the Sunwalk, the rivers, the lake, the Heights and each other; the ways go round`, () => {
    const sunwalk = plan.paths.find((p) => p.kind === 'sunwalk')!.points, courts = entrancesOf(plan);
    for (const [i, w] of plan.works.entries()) {
      if (plan.lake) assert.ok(fromLake(plan.lake, w.s) >= w.radius, 'out of the lake');
      for (const c of courts) assert.ok(dist(c, w) >= w.radius + spacing * WORKS.court, 'off a court');
      for (let k = 0; k < sunwalk.length; k += 2) assert.ok(dist({ theta: sunwalk[k], s: sunwalk[k + 1] }, w) >= w.radius, 'off the Sunwalk');
      for (const o of plan.works.slice(0, i)) assert.ok(dist(o, w) >= o.radius + w.radius, 'apart');
      for (let q = 0; q <= 8; q++) {
        const a = (q / 8) * TURN, d = q === 8 ? 0 : w.radius, on = plan.landformAt(w.theta + (d * Math.cos(a)) / R, w.s + d * Math.sin(a));
        assert.ok(!on || (on.form.kind === 'ring' && on.face <= 0), `a ${w.kind} on a ${on?.form.kind}'s ${on?.face ? 'front' : 'top'}`);
      }
      assert.equal(plan.workOf(w.theta, w.s), w);
    }
    // No way runs over a work (its ends at the courts and the Sunwalk are clear of them).
    for (const p of plan.paths.filter((x) => x.kind === 'way')) {
      const q = p.points;
      for (let k = 0; k < q.length; k += 2) {
        const w = plan.workOf(q[k], q[k + 1]);
        assert.ok(!w || dist(w, { theta: q[k], s: q[k + 1] }) >= w.radius * 0.95, `a way over a ${w?.kind}`);
      }
    }
  });

  test(`works (${name}): the terrain raises and digs them, hollow above the living layer`, () => {
    const t = terrainOf(name);
    for (const kind of new Set(plan.works.map((w) => w.kind))) {
      const w = plan.works.find((x) => x.kind === kind)!;
      // Over its footprint the land is built by the work's own surface (and a Ring's, where one stands on its slope).
      let most = 0;
      for (let q = 0; q < 24; q++) {
        const a = q * 2.399963, d = w.radius * Math.sqrt((q + 0.5) / 24), theta = w.theta + (d * Math.cos(a)) / R, s = w.s + d * Math.sin(a);
        const own = workAt(w, wrap(theta - w.theta) * R, s - w.s), form = plan.landformAt(theta, s);
        if (!form) assert.ok(Math.abs(t.builtAt(theta, s) - own) < 1e-6 * Math.max(1, w.height), `${kind} built as designed`);
        assert.ok(Math.abs(plan.worksAt(theta, s) - own) < 1e-9, 'one work there');
        assert.ok(Math.abs(t.hollowAt(theta, s) - ((form?.top ?? 0) + Math.max(0, own))) < 1e-6, 'hollow under what is raised');
        most = Math.max(most, Math.abs(own));
      }
      assert.ok(most > w.height * 0.3, `${kind} stands out of the land`);
    }
  });
}

test('works (reference): the wild reserve\'s valley sides stand bolder than the worked floor\'s; the valleys\' floors stay gentle', () => {
  const t = terrainOf('reference'), plan = planOf(t.habitat), h = t.habitat, { floorStart } = h.profile;
  /** The land's mean height up the valleys' sides (or along their floors), less what was built, over a stretch of the floor. */
  const mean = (s0: number, s1: number, side: boolean): number => {
    let sum = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const s = s0 + ((i * 0.618034) % 1) * (s1 - s0), valley = i % plan.valleys;
      const across = side ? 0.75 + 0.2 * ((i * 0.7548777) % 1) : 0.05 + 0.1 * ((i * 0.7548777) % 1);
      const theta = plan.valleyAt(valley, s) + ((i % 2 ? 1 : -1) * across * Math.PI) / plan.valleys;
      if (t.riverAt(theta, s) || t.courtAt(theta, s) || plan.workOf(theta, s) || plan.landformAt(theta, s)) continue;
      sum += t.heightAt(theta, s); n++;
    }
    return sum / Math.max(1, n);
  };
  const reserve = [floorStart + (plan.reserveEnd - floorStart) * 0.1, plan.reserveEnd - (plan.reserveEnd - floorStart) * 0.1] as const;
  const port = [h.profile.floorEnd - (plan.reserveEnd - floorStart), h.profile.floorEnd - (plan.reserveEnd - floorStart) * 0.2] as const;
  const wild = mean(...reserve, true), tended = mean(...port, true);
  assert.ok(wild > tended * 1.4, `the reserve's valley sides ${wild.toFixed(0)} m, the port end's ${tended.toFixed(0)} m`);
  const wildFloor = mean(...reserve, false), tendedFloor = mean(...port, false);
  assert.ok(wildFloor < tendedFloor * 1.3 + 5, `the reserve's valley floors ${wildFloor.toFixed(0)} m, the port end's ${tendedFloor.toFixed(0)} m`);
});

test('works (small): the same habitat gets the same works', () => {
  const h = derive(MATRIX.find((m) => m.name === 'small')!.params);
  assert.deepEqual(makePlan(h).works, planOf(habitatOf('small')).works);
});
