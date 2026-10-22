import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothstep } from '@futuremagic/core';
import { DISTRICT_STYLES, MATRIX, derive, validate, withParams } from '../src/blueprint';
import { entrancesOf, fromLake, makePlan, planOf } from '../src/gen/plan';
import { STYLE_WORKS, WORKS, WORK_KINDS, isDug, workAt, type Work, type WorkKind } from '../src/gen/works';
import { habitatOf, terrainOf } from './worlds';

const TURN = 2 * Math.PI, DEG = Math.PI / 180;
const wrap = (a: number): number => a - TURN * Math.round(a / TURN);

/** A work of a kind on its own, for its shape. */
const lone = (kind: WorkKind, crisp: number, vary = 0.37): Work => {
  const spec = WORK_KINDS[kind], height = 100 * spec.height[1];
  return { id: 0, kind, district: 0, theta: 0, s: 0, height, radius: height * spec.spread, facing: 0.7, crisp, vary };
};

test('works: every style makes works of its own kinds, and a habitat without sensible works is invalid', () => {
  for (const style of DISTRICT_STYLES) assert.ok(STYLE_WORKS[style].length > 0, `${style} makes something`);
  const ids = (works: number, wild: number) => validate(derive(withParams({ relief: { ...MATRIX[0].params.relief, landforms: { ...MATRIX[0].params.relief.landforms!, works, wild } } }))).filter((f) => f.id === 'relief');
  assert.equal(ids(0.06, 1.5).length, 0);
  assert.ok(ids(-0.1, 1.5).length > 0 && ids(0.5, 1.5).length > 0 && ids(0.06, -1).length > 0);
});

test('works: each shape stays in its footprint, rises (or is dug) to its height, and is never steeper than a cliff', () => {
  for (const kind of Object.keys(WORK_KINDS) as WorkKind[]) {
    for (const crisp of [0, 1]) {
      const w = lone(kind, crisp), r = w.radius, n = 50, e = r / n;
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

for (const { name, params } of MATRIX) {
  const h = habitatOf(name), plan = planOf(h), R = h.radius, spacing = params.plan.entranceSpacing;
  const dist = (a: { theta: number; s: number }, b: { theta: number; s: number }): number => Math.hypot(wrap(a.theta - b.theta) * R, a.s - b.s);

  test(`works (${name}): each district shapes its ground in its style's kinds, inside its borders, the reserve in nature's`, () => {
    const works = plan.works, scale = params.relief.landforms!.works! * R;
    assert.ok(works.length >= plan.districts.length, `${works.length} works in ${plan.districts.length} districts`);
    works.forEach((w, i) => assert.equal(w.id, i));
    let shaped = 0;
    for (const d of plan.districts) {
      const own = works.filter((w) => w.district === d.id);
      if (own.length) shaped++;
      for (const w of own) {
        assert.ok(STYLE_WORKS[d.style].includes(w.kind), `a ${w.kind} in a ${d.style} district`);
        assert.ok(plan.inside(d, w.theta, w.s, w.radius * 0.7 - 1e-6), 'inside its district');
        assert.ok(Math.abs(w.crisp - smoothstep(WORKS.care[0], WORKS.care[1], d.care)) < 1e-9, 'kept as its district is cared for');
      }
    }
    assert.ok(shaped >= plan.districts.length * 0.8, `${shaped} of ${plan.districts.length} districts shaped their ground`);
    for (const w of works) {
      const spec = WORK_KINDS[w.kind];
      assert.ok(w.height <= spec.height[1] * scale + 1e-6 && w.radius <= spacing * WORKS.reach + 1e-6, `${w.kind} ${w.height.toFixed(0)} m, ${w.radius.toFixed(0)} m wide`);
      if (spec.axial) assert.ok(Math.abs(Math.sin(w.facing)) < 1e-9, `${w.kind} faces along the axis`);
      if (w.district < 0) assert.ok(w.s < plan.reserveEnd && STYLE_WORKS['let-go'].includes(w.kind) && w.crisp === 0, 'the reserve: nature\'s own');
    }
    assert.ok(works.some((w) => w.district < 0), 'some in the wild reserve');
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
