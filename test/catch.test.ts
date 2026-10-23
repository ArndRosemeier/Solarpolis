import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, toWorld, type Habitat, type Vec3 } from '../src/blueprint';
import { fallAt, fallOf, footingOf, gapOf as gap, harmful, type Footing } from '../src/world/fall';
import { postsNear, type Post } from '../src/world/posts';
import { bagAt, catchAt, catchFor, planCatch, type CatchPlan } from '../src/world/catch';
import { HUMAN_DRAG } from '../src/physics/character';
import { liftStairOf, rampOf } from '../src/gen/liftStair';
import { flatOf, terrainOf } from './worlds';

/** The middle of a habitat's floor, at a quarter turn. */
const middle = (h: Habitat): { theta: number; s: number } => ({ theta: 0.5 * Math.PI, s: (h.profile.floorStart + h.profile.floorEnd) / 2 });
/** A body at rest `up` m over the ground there (the habitat's frame). */
const over = (h: Habitat, footing: Footing, up: number, at = middle(h)): Vec3 => toWorld(h.profile, { ...at, h: footing(at.theta, at.s, Infinity).h + up });
const away = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** A tall drop for the habitat: 300 m, or less in a small one (gravity weakens toward the axis). */
const tall = (h: Habitat): number => Math.min(300, 0.4 * h.radius);

/** Every moment of a catch, a tenth of a second apart: the body above what it would land on, the bag under it. */
function wholeCatch(h: Habitat, footing: Footing, plan: CatchPlan): void {
  for (let t = 0; t <= plan.home + 0.05; t += 0.1) {
    const s = catchAt(plan, t);
    for (const k of s.feet) assert.ok(Number.isFinite(k), `finite at ${t.toFixed(1)} s`);
    if (t < plan.end) assert.ok(gap(h, footing, s.feet) > -0.05, `over the ground at ${t.toFixed(1)} s (${gap(h, footing, s.feet).toFixed(2)} m)`);
  }
  assert.equal(catchAt(plan, plan.end + 0.01).phase, 'released');
  const sd = plan.setDown, at = fromWorld(h.profile, ...sd.feet);
  assert.ok(Math.abs(at.h - footing(sd.theta, sd.s, at.h + 1).h) < 0.2, 'set down on its feet, on the ground');
}

for (const { name } of MATRIX) {
  test(`fall (${name}): a body let go over flat ground lands, slowed by the air; a short drop does not hurt, a long one would`, () => {
    const t = flatOf(name), h = t.habitat, footing = footingOf(t), guard = h.params.life.guard, g = h.gravityAt(h.radius);
    const low = fallOf(h, footing, over(h, footing, 0.8), [0, 0, 0], HUMAN_DRAG), high = fallOf(h, footing, over(h, footing, 50), [0, 0, 0], HUMAN_DRAG);
    assert.ok(low.lands && high.lands);
    assert.equal(harmful(low, guard), false, `${low.lands.speed.toFixed(1)} m/s from 0.8 m`);
    assert.equal(harmful(high, guard), true, `${high.lands.speed.toFixed(1)} m/s from 50 m`);
    // Slower than in a vacuum at the floor's gravity (it is weaker higher up, and the air holds it back); it lands where the gap closes.
    assert.ok(high.lands.speed < Math.sqrt(2 * g * 50) && high.lands.speed > 0.5 * Math.sqrt(2 * g * 50), `${high.lands.speed.toFixed(1)} m/s`);
    assert.ok(Math.abs(gap(h, footing, high.lands.p)) < 0.05);
    // The path in between: the gap closes as it goes, and `fallAt` follows it.
    for (let k = 1; k < high.path.length; k++) assert.ok(gap(h, footing, high.path[k].p) < gap(h, footing, high.path[k - 1].p) + 1e-6);
    const mid = fallAt(high, high.lands.t / 2);
    assert.ok(gap(h, footing, mid.p) > 0 && gap(h, footing, mid.p) < 50);
  });

  test(`catch (${name}): with no guardian near, a bag out of the ground takes a 50 m fall and lets the body down`, () => {
    const t = flatOf(name), h = t.habitat, footing = footingOf(t), guard = h.params.life.guard;
    const plan = catchFor(t, over(h, footing, 50), [0, 0, 0], HUMAN_DRAG, { late: 0, home: null });
    assert.ok(plan?.bag, 'the bag');
    assert.equal(plan.guardians.length, 0);
    const b = plan.bag;
    assert.ok(b.height > 2 && b.height <= guard.bag, `${b.height.toFixed(1)} m tall`);
    assert.ok(b.burst < b.touch && b.full <= b.touch, 'full before the body touches it');
    assert.ok(away(b.site, plan.fall.lands!.p) < b.radius, 'under where the body would land');
    assert.equal(bagAt(plan, b.burst - 0.01), null, 'not before it bursts out');
    assert.equal(bagAt(plan, b.gone + 0.01), null, 'folded away after');
    wholeCatch(h, footing, plan);
  });

  test(`catch (${name}): two guardians beside a long fall join it, brake it gently and set it down where it began`, () => {
    const t = flatOf(name), h = t.habitat, footing = footingOf(t), guard = h.params.life.guard, at = middle(h);
    const up = tall(h), p = over(h, footing, up, at), fall = fallOf(h, footing, p, [0, 0, 0], HUMAN_DRAG);
    // Two posts 30 m to either side, as high as the fall begins (as if perched on the brink it left).
    const r = h.profile.at(at.s).r, posts: Post[] = [-30, 30].map((d) => {
      const theta = at.theta + d / r, s = at.s;
      return { p: toWorld(h.profile, { theta, s, h: footing(theta, s, Infinity).h + up }), theta, s, drop: up, toward: 0 };
    });
    const plan = planCatch(h, footing, fall, posts, { late: 0, home: at });
    assert.equal(plan.bag, null, 'caught by the guardians');
    assert.equal(plan.guardians.length, guard.hands);
    assert.ok(plan.launch <= plan.join && plan.join <= plan.meet && plan.meet < plan.stop && plan.stop < plan.end && plan.end < plan.home);
    assert.ok(plan.meet < fall.lands!.t, 'before it lands');
    assert.ok(plan.felt <= guard.brake + 1e-6, `braked at ${plan.felt.toFixed(2)} g felt`);
    // On their posts at the start and back on them at the end.
    const first = catchAt(plan, 0), last = catchAt(plan, plan.home + 0.01);
    plan.guardians.forEach((gp, k) => {
      assert.ok(away(first.guardians[k].at, gp.post.p) < 1e-6 && away(last.guardians[k].at, gp.post.p) < 1e-6);
      for (let tt = 0; tt <= plan.home; tt += 0.25) {
        const v = catchAt(plan, tt).guardians[k].v;
        assert.ok(Math.hypot(...v) <= guard.speed * 1.05 + 1e-6, `guardian ${k} under its top speed at ${tt} s`);
      }
    });
    // Back on the ground where it began (it stood there), facing somewhere along it.
    assert.ok(Math.abs(plan.setDown.s - at.s) < 2 && Math.abs((plan.setDown.theta - at.theta) * r) < 2, 'set down where it began');
    wholeCatch(h, footing, plan);
  });
}

for (const { name } of MATRIX) test(`catch (${name}): the Long Drop from capsule height is caught late, about a share of the radius over the ground, by guardians gone along`, () => {
  const t = flatOf(name), h = t.habitat, footing = footingOf(t), g = h.params.life, at = middle(h);
  const top = h.profile.at(at.s).r - g.caps.axis * h.radius * 1.05, p = toWorld(h.profile, { ...at, h: top });
  const late = g.guard.late * h.radius, plan = catchFor(t, p, [0, 0, 0], HUMAN_DRAG, { late, home: null });
  assert.ok(plan && plan.late && !plan.bag);
  assert.ok(plan.meet > 20, `a long fall first (${plan.meet.toFixed(0)} s)`);
  const met = gap(h, footing, catchAt(plan, plan.meet).feet);
  assert.ok(met > late * 0.3 && met < late * 1.5, `met ${met.toFixed(0)} m over the ground (late ${late.toFixed(0)} m)`);
  wholeCatch(h, footing, plan);
});

test('posts: by the Threshold\'s galleries a guardian waits on the brink, over a drop that would hurt; the same every time', () => {
  const t = terrainOf('reference'), h = t.habitat, footing = footingOf(t), st = liftStairOf(h), q = st?.threshold?.galleries;
  assert.ok(st && q?.length, 'the reference has the Threshold');
  // Its lowest gallery's outer edge, from the middle of it: built tops count, so a post waits along that edge.
  const low = q[q.length - 1], edge = fromWorld(h.profile, ...rampOf(h).world(low.z0 + 1, (low.w0 + low.w1) / 2, low.e));
  const found = postsNear(h, footing, edge.theta, edge.s, h.params.life.guard.posts);
  assert.ok(found.length > 0, 'a post near the gallery\'s edge');
  const again = postsNear(h, footing, found[0].theta, found[0].s, 1);
  assert.ok(again.some((q) => q.theta === found[0].theta && q.s === found[0].s), 'the same post again');
  const harm = h.params.life.guard.harm;
  for (const q of found) assert.ok(q.drop >= Math.min(8, (harm * harm) / (2 * h.gravityAt(Math.hypot(q.p[0], q.p[1])))) - 1e-6);
});
