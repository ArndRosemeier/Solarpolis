import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, toWorld } from '../src/blueprint';
import { legShapesOf, liftStairOf, onLeg, rampOf, riserAt, stairKeepsClear, stairStandAt, stairTopAt } from '../src/gen/liftStair';
import { buildStairSolid, buildStairTile, stairGridOf, stairPartsIn, stairTilesFor, type StairParts } from '../src/gen/liftStairMesh';
import { childrenOf, coverOf, rootTiles, tileId } from '../src/gen/detailTree';
import { siteOf, planOf } from '../src/gen/plan';

import { habitatOf } from './worlds';
import { stairFacesOut } from './meshChecks';

for (const { name, params } of MATRIX) {
  test(`lift stair (${name}): climbs the ramp from the floor to near the hub, every floor over the ground, steps of human size`, () => {
    const h = habitatOf(name, params), st = liftStairOf(h);
    if (name === 'reference') assert.ok(st, 'the reference habitat has its Lift Stair');
    if (!st) return;
    assert.ok(siteOf(planOf(h), 'lift-stair'), 'on the plan\'s site');
    const ramp = rampOf(h), hr = st.handrail, R = h.radius;
    // The climb: platforms up to the top terrace, a leg between each two; the Threshold's galleries and flights after.
    const climb = st.platforms.indexOf(st.top);
    assert.equal(st.legs.indexOf(st.topLeg), climb - 1);
    assert.equal(st.platforms.length - climb - 1, st.threshold ? st.threshold.galleries.reduce((n, g) => n + g.bays.length, 0) : 0);
    // From the floor's end to within a few hub radii of the axis.
    assert.ok(Math.abs(st.platforms[0].z1 - ramp.zOf(h.profile.floorEnd)) < 1e-6, 'starts at the floor\'s end');
    const top = st.top;
    assert.equal(top.kind, 'top');
    assert.ok(R - top.e < Math.max(R * 0.1, h.profile.at(h.profile.length).r * 4), `ends ${(R - top.e).toFixed(0)} m from the axis`);
    for (const q of st.platforms) {
      // On the ramp, and standing over the ground at every corner.
      assert.ok(Math.abs(q.w0) <= ramp.halfWidth && Math.abs(q.w1) <= ramp.halfWidth, `platform within the ramp: ${q.w0} … ${q.w1}`);
      for (const z of [q.z0, q.z1]) assert.ok(q.e >= ramp.groundAt(z) + st.clearance - 1e-6, `${q.kind} at ${z.toFixed(0)}: floor ${q.e.toFixed(2)} over ground ${ramp.groundAt(z).toFixed(2)}`);
    }
    for (const [i, l] of st.legs.slice(0, climb).entries()) {
      assert.equal(l.e0, st.platforms[i].e);
      assert.equal(l.e1, st.platforms[i + 1].e);
      assert.ok(l.riser > 0 && l.riser <= riserAt(hr, 0) + 1e-9, `leg ${i}: riser ${l.riser}`);
      assert.ok(l.tread >= hr * 0.27, `leg ${i}: tread ${l.tread}`);
      // A step takes about the same effort everywhere: its riser is about what gravity there asks for.
      const g = (R - (l.e0 + l.e1) / 2) / R;
      assert.ok(l.riser > riserAt(hr, g) * 0.6 && l.riser < riserAt(hr, g) * 1.6, `leg ${i}: riser ${l.riser.toFixed(3)} at ${g.toFixed(2)} g`);
      // Every tread over the ground under it, and within the ramp.
      const s = legShapesOf(st)[i];
      for (const k of s.steps) for (const side of [-1, 1]) {
        const p = onLeg(s, k.a1, (side * l.width) / 2);
        assert.ok(Math.abs(p[1]) <= ramp.halfWidth + 1e-6, `leg ${i} within the ramp`);
        assert.ok(k.top >= ramp.groundAt(p[0]), `leg ${i}: a tread under the ground`);
      }
      assert.ok(Math.abs(s.steps[s.steps.length - 1].top - l.e1) < 1e-6, 'the last step tops out at the next platform');
    }
  });

  test(`lift stair (${name}): tiles own every part once, faces look out, the eye's cover is whole`, () => {
    const h = habitatOf(name, params), st = liftStairOf(h), g = stairGridOf(h);
    if (!st || !g) return;
    const ramp = rampOf(h), roots = rootTiles(g);
    const total = { platforms: st.platforms.length, aprons: legShapesOf(st).reduce((n, s) => n + s.aprons.length, 0), steps: st.legs.reduce((n, l) => n + l.steps, 0) };
    // The roots own every part exactly once.
    const sum = { platforms: 0, aprons: 0, steps: 0 };
    const held = roots.map((key) => ({ key, parts: stairPartsIn(h, key) }));
    for (const t of held) for (const k of ['platforms', 'aprons', 'steps'] as const) sum[k] += t.parts[k];
    assert.deepEqual(sum, total);
    // A root's children own what it does.
    const most = held.reduce((a, b) => (b.parts.steps > a.parts.steps ? b : a)), all = (p: StairParts): number => p.steps + p.aprons + p.platforms;
    assert.equal(childrenOf(g, most.key).reduce((n, k) => n + all(stairPartsIn(h, k)), 0), all(most.parts));
    const busy = buildStairTile(h, most.key);
    assert.deepEqual(busy.parts, most.parts, 'building a tile builds what it holds');
    // Faces look out of the stair: a little way along a face's normal is outside, a little way against it inside.
    // ...and one of the finest tiles under an eye on a leg, with steps in it.
    const s = legShapesOf(st)[Math.floor(st.legs.length / 2)], p = onLeg(s, s.run / 2, 0);
    const eye = ramp.world(p[0], p[1], (stairTopAt(st, p) ?? 0) + 1.7), wanted = stairTilesFor(h, eye);
    const fine = wanted.filter((w) => w.key.level === g.finest).map((w) => buildStairTile(h, w.key)).find((t) => t.parts.steps > 0);
    assert.ok(fine, 'the finest tiles under the eye hold steps');
    for (const t of [busy, fine]) {
      const { judged, wrong } = stairFacesOut(h, st, t);
      assert.ok(judged > 50, `judged ${judged}`);
      assert.equal(wrong, 0, `${wrong} of ${judged} faces look into the stair (tile ${tileId(t.key)})`);
    }
    // While only the roots are built, the cover is the roots.
    assert.ok(wanted.some((w) => w.key.level === g.finest), 'the finest tiles are wanted under the eye');
    const rootIds = new Set(roots.map(tileId)), cover = coverOf(wanted, (id) => rootIds.has(id));
    assert.ok(cover.drawn.every((w) => w.key.level === g.root));
  });

  test(`lift stair (${name}): one stands on its steps, the physics bumps into it, plants keep off it`, () => {
    const h = habitatOf(name, params), st = liftStairOf(h);
    if (!st) return;
    const ramp = rampOf(h), s = legShapesOf(st)[Math.floor(st.legs.length / 3)], k = s.steps[Math.floor(s.steps.length / 2)];
    const p = onLeg(s, (k.a0 + k.a1) / 2, 0), on = ramp.world(p[0], p[1], k.top);
    const at = fromWorld(h.profile, ...on), stand = stairStandAt(h, at.theta, at.s);
    assert.ok(stand !== null && Math.abs(stand - at.h) < st.handrail * 0.05, `stands at ${stand?.toFixed(3)} for a tread at ${at.h.toFixed(3)}`);
    const under = fromWorld(h.profile, ...ramp.world(p[0], p[1], ramp.groundAt(p[0])));
    assert.ok(stairKeepsClear(h, under.theta, under.s, st.handrail), 'no plants under the steps');
    const off = fromWorld(h.profile, ...toWorld(h.profile, { theta: at.theta + Math.PI, s: at.s, h: 0 }));
    assert.ok(!stairKeepsClear(h, off.theta, off.s, st.handrail), 'plants grow on the far side of the Gate');
    assert.equal(stairStandAt(h, off.theta, off.s), null);
    const solid = buildStairSolid(h, on, 30);
    assert.ok(solid && solid.index.length > 30, 'treads and walls near it for the physics');
    assert.ok(solid.positions.every((x) => Math.abs(x) < 300), 'relative to the point');
  });
}
