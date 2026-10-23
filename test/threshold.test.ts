/** The Threshold's galleries beside the Lift Stair's top terrace (gen/threshold.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { legShapesOf, liftStairOf, rampOf, riserAt, stairTopAt, type LiftStair, type PlanPoint } from '../src/gen/liftStair';
import { arrivalTerraceOf } from '../src/gen/arrivalTerrace';
import { buildStairTile, stairGridOf, stairTilesFor } from '../src/gen/liftStairMesh';
import { FLIGHT_STEPS, TIERS } from '../src/gen/threshold';
import { tileId } from '../src/gen/detailTree';
import { habitatOf } from './worlds';
import { stairFacesOut } from './meshChecks';

/** Heights of the stair's top along a straight walk a → b, every `step` m. */
function along(st: LiftStair, a: PlanPoint, b: PlanPoint, step: number): (number | null)[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => stairTopAt(st, [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]));
}

for (const { name } of MATRIX) test(`threshold (${name}): galleries step down the face beside the top terrace, on the ramp, clear of the climb`, () => {
  const h = habitatOf(name), st = liftStairOf(h);
  if (!st) return;
  const th = st.threshold, ramp = rampOf(h), hr = st.handrail, top = st.top;
  if (name === 'reference' || name === 'large') assert.ok(th && th.galleries.length === TIERS, `${name}: ${th?.galleries.length ?? 0} galleries`);
  if (!th) return;
  const R = h.radius, climb = st.platforms.indexOf(top);
  // Everything of the climb but the top terrace, to see the galleries keep off it.
  const others: LiftStair = { ...st, platforms: st.platforms.slice(0, climb), legs: st.legs.slice(0, climb), threshold: null };
  for (const [k, g] of th.galleries.entries()) {
    assert.equal(g.tier, k);
    if (k === 0) assert.ok(g.e === top.e && g.z0 === top.z0 && g.z1 === top.z1, 'the upper gallery is the top terrace\'s depth and height');
    else {
      const above = th.galleries[k - 1], f = th.flights[k - 1];
      assert.ok(Math.abs(g.z1 - above.z0) < 1e-9, 'each against the wall of the one above');
      assert.ok(Math.abs(above.e - g.e - f.riser * FLIGHT_STEPS) < 1e-9 && f.riser <= riserAt(hr, 0) + 1e-9 && f.riser > riserAt(hr, (R - g.e) / R) * 0.6, `a flight of ${FLIGHT_STEPS} ledges lower`);
      assert.ok(f.tread >= hr, 'broad steps');
    }
    assert.ok(g.w1 - g.w0 >= st.width * 3 && g.w1 - g.w0 <= ramp.halfWidth * 0.75 + top.w1 - top.w0 + 1e-6, `${name}: gallery ${k} ${(g.w1 - g.w0).toFixed(1)} m long`);
    // Bays side by side along it, each short enough to stay on its arc, inside the ramp, its floor over the ground.
    let w = g.w0;
    for (const q of g.bays) {
      assert.ok(Math.abs(q.w0 - w) < 1e-9, 'bays follow on');
      w = q.w1;
      assert.ok((q.w1 - q.w0) ** 2 / (8 * (R - q.e)) <= hr * 0.0101, `a bay of ${(q.w1 - q.w0).toFixed(2)} m sags off its arc`);
      assert.ok(Math.abs(q.w0) <= ramp.halfWidth && Math.abs(q.w1) <= ramp.halfWidth);
      for (const z of [q.z0, q.z1]) assert.ok(q.e >= ramp.groundAt(z) + st.clearance - 1e-6, 'over the ground');
      for (const p of [[q.z0 + 0.2, q.w0 + 0.2], [q.z1 - 0.2, q.w1 - 0.2], [(q.z0 + q.z1) / 2, (q.w0 + q.w1) / 2]] as PlanPoint[]) {
        assert.equal(stairTopAt(others, p, st.parapet), null, `${name}: gallery ${k} stands on the climb at ${p.map((x) => x.toFixed(1))}`);
      }
    }
    assert.ok(Math.abs(w - g.w1) < 1e-9, 'bays fill it');
  }
});

for (const { name } of MATRIX) test(`threshold (${name}): one walks from the overlook along the galleries and down their flights to the berth, nothing in the way`, () => {
  const h = habitatOf(name), st = liftStairOf(h), terrace = arrivalTerraceOf(h);
  if (!st?.threshold || !terrace) return;
  const th = st.threshold, hr = st.handrail, step = hr / 4, small = hr * 0.3;
  // The route: across the top terrace onto the upper gallery to the first flight, down it, along the next gallery to the
  // second, down it, to the berth.
  const legs: { from: PlanPoint; to: PlanPoint; e: number | null }[] = [];
  let at: PlanPoint = terrace.finish;
  const walk = (to: PlanPoint, e: number | null): void => { legs.push({ from: at, to, e }); at = to; };
  walk([at[0], th.flights[0].to.w], th.galleries[0].e);
  for (const [k, f] of th.flights.entries()) {
    walk([f.to.z + small, f.to.w], th.galleries[k].e);
    walk([f.from.z - small, f.from.w], null);
    const next = th.flights[k + 1];
    if (next) walk([at[0], next.to.w], th.galleries[k + 1].e);
  }
  const berth = th.berth!;
  assert.ok(berth, `${name}: a berth on the lowest gallery`);
  walk(berth.at, th.galleries[th.galleries.length - 1].e);
  for (const l of legs) {
    const tops = along(st, l.from, l.to, step);
    assert.ok(tops.every((t) => t !== null), 'on the Threshold all the way');
    if (l.e !== null) assert.ok(tops.every((t) => Math.abs(t! - l.e!) < 1e-6), `level at ${l.e.toFixed(2)}: met ${Math.max(...tops.map((t) => t!)).toFixed(2)}, no parapet in the way`);
    else for (let i = 1; i < tops.length; i++) assert.ok(tops[i]! <= tops[i - 1]! + 1e-9 && tops[i - 1]! - tops[i]! <= riserAt(hr, 0) + 1e-9, 'down the flight a step at a time');
  }
  // The galleries' fronts stand closed: a parapet a handrail high all along the lowest gallery's front.
  const low = th.galleries[th.galleries.length - 1];
  for (const t of along(st, [low.z0 + st.parapet / 2, low.w0 + st.parapet], [low.z0 + st.parapet / 2, low.w1 - st.parapet], hr)) assert.equal(t, low.e + hr);
});

for (const { name } of MATRIX) test(`threshold (${name}): the capsule berth is on the lowest gallery, inside its parapets, clear of its flight and its benches`, () => {
  const h = habitatOf(name), st = liftStairOf(h), terrace = arrivalTerraceOf(h);
  if (!st?.threshold || !terrace) return;
  const b = terrace.berth, low = st.threshold.galleries[st.threshold.galleries.length - 1], flight = st.threshold.flights[st.threshold.flights.length - 1];
  assert.ok(b && b.clear >= 3, 'room for a capsule');
  const c = rampOf(h).plan(b.at), p = st.parapet;
  assert.ok(Math.abs(c.e - low.e) < 1e-7, 'on its floor');
  assert.ok(c.z - b.clear >= low.z0 + p - 1e-9 && c.z + b.clear <= low.z1 && c.w - b.clear >= low.w0 + p - 1e-9 && c.w + b.clear <= low.w1 - p + 1e-9, 'inside its parapets');
  assert.ok(Math.abs(c.w - flight.from.w) >= flight.width / 2 + b.clear, 'clear of the flight');
  // Open toward the axis: nothing of the stair stands over it.
  for (const a of [0, 1, 2, 3]) {
    const t = stairTopAt(st, [c.z + Math.cos(a * Math.PI / 2) * b.clear * 0.9, c.w + Math.sin(a * Math.PI / 2) * b.clear * 0.9]);
    assert.equal(t, low.e, 'its floor all round');
  }
  const up = [-b.at[0], -b.at[1], 0], u = Math.hypot(...up);
  assert.ok(Math.abs(Math.hypot(...b.out) - 1) < 1e-9 && Math.abs((b.out[0] * up[0] + b.out[1] * up[1]) / u) < 1e-9, 'its door faces along the floor');
});

test('threshold (reference): its tiles draw the galleries with faces looking out, lanterns and the spin arrow', () => {
  const h = habitatOf('reference'), st = liftStairOf(h)!, g = stairGridOf(h)!, th = st.threshold!, ramp = rampOf(h);
  const mid = th.galleries[1], eye = ramp.world((mid.z0 + mid.z1) / 2, (mid.w0 + mid.w1) / 2, mid.e + 1.7);
  const fine = stairTilesFor(h, eye).filter((w) => w.key.level === g.finest).map((w) => buildStairTile(h, w.key)).filter((t) => t.parts.platforms > 0);
  assert.ok(fine.length > 0, 'the finest tiles under the eye hold bays');
  for (const t of fine) {
    const { judged, wrong } = stairFacesOut(h, st, t);
    assert.equal(wrong, 0, `${wrong} of ${judged} faces look into the Threshold (tile ${tileId(t.key)})`);
  }
  // The flights are legs of the stair: drawn as its steps are.
  assert.ok(legShapesOf(st).slice(-th.flights.length).every((s, i) => s.leg === th.flights[i] && s.steps.length === FLIGHT_STEPS));
});
