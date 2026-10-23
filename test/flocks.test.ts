import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, REFERENCE, derive, fromWorld, validate, withParams, type Vec3 } from '../src/blueprint';
import { crossingsOf } from '../src/gen/crossings';
import { liftStairOf, rampOf } from '../src/gen/liftStair';
import { plantsOf } from '../src/gen/scatter';
import { flockCallsIn, flockNoise, flocksNear, memberAt, memberWhere, type Flock } from '../src/sim/flocks';
import { lightAt } from '../src/sim/birds';
import { ecologyOf } from './worlds';

test('flocks: a habitat without sensible flock sizes is invalid', () => {
  const birds = (change: Partial<typeof REFERENCE.life.birds>) => withParams({ life: { ...REFERENCE.life, birds: { ...REFERENCE.life.birds, ...change } } });
  for (const bad of [{ swallows: -1 }, { swallows: 1.5 }, { swifts: 1e6 }, { starlings: 1e9 }])
    assert.ok(validate(derive(birds(bad))).some((f) => f.id === 'life' && f.severity === 'invalid'), JSON.stringify(bad));
});

/** The flocks of a habitat round its first bridge with swallows, its Stair's foot and its first lake (made once per habitat). */
const found = new Map<string, Flock[]>();
function flocksOf(name: string): Flock[] {
  let all = found.get(name);
  if (!all) {
    const e = ecologyOf(name), t = e.terrain, plants = plantsOf(e), by = new Map<number, Flock>();
    const bridge = crossingsOf(t).find((c) => c.kind === 'arch' || c.kind === 'timber');
    const stair = liftStairOf(t.habitat), foot = stair && stair.platforms[0], ramp = rampOf(t.habitat);
    const candidates: ({ theta: number; s: number } | null | undefined)[] = [bridge && bridge.frame, t.meres[0], foot && fromWorld(t.habitat.profile, ...ramp.world(foot.z0, (foot.w0 + foot.w1) / 2, foot.e))];
    const spots = candidates.filter((x): x is { theta: number; s: number } => !!x);
    if (!spots.length) spots.push({ theta: 0, s: t.habitat.profile.length / 2 });
    for (const p of spots) for (const f of flocksNear(e, plants, p.theta, p.s, 1)) by.set(f.id, f);
    found.set(name, (all = [...by.values()]));
  }
  return all;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The fastest each kind flies (m/s): swallows hawking, swifts in their dusk race, starlings joining the murmuration. */
const FASTEST = { swallow: 30, swift: 34, starling: 26 };

for (const { name } of MATRIX) {
  test(`flocks (${name}): swallows nest on the bridges, swifts live at the Stair, starlings roost in the trees by the lakes`, () => {
    const e = ecologyOf(name), t = e.terrain, h = t.habitat, flocks = flocksOf(name);
    const bridges = crossingsOf(t).filter((c) => c.kind === 'arch' || c.kind === 'timber');
    assert.equal(flocks.some((f) => f.kind === 'swallow'), bridges.length > 0, 'swallows where there are bridges');
    assert.equal(flocks.some((f) => f.kind === 'swift'), !!liftStairOf(h) && h.params.life.birds.swifts > 0, 'swifts where there is the Stair');
    assert.equal(new Set(flocks.map((f) => f.id)).size, flocks.length, 'each its own');
    for (const f of flocks) {
      if (f.kind === 'swallow') {
        const c = crossingsOf(t)[f.bridge];
        assert.equal(f.nests.length, Math.ceil(f.count / 2), 'a pair to a nest');
        for (const n of f.nests) {
          // Under the deck's edge, over the water.
          assert.ok(n.h > c.frame.height && n.h < c.frame.height + Math.max(...c.ends) + c.hump, 'between the water and the deck');
          assert.ok(Math.hypot((n.theta - c.frame.theta) * h.profile.at(c.frame.s).r, n.s - c.frame.s) < c.half + c.width, 'on its bridge');
        }
      }
      if (f.kind === 'starling') {
        assert.ok(f.roosts.length > 0 && f.roosts.every((r) => r.height >= 6), 'roost trees');
        assert.ok(f.feeds.length > 0, 'grassland to feed on');
        for (const g of f.feeds) assert.ok(!t.form.inWater(g.theta, g.s), 'they feed on dry ground');
      }
    }
  });

  test(`flocks (${name}): every bird flies smoothly, no faster than its kind can, and never into the ground`, () => {
    const t = ecologyOf(name).terrain, h = t.habitat, L = h.params.day.length;
    for (const f of flocksOf(name)) {
      const birds = f.kind === 'starling' ? [0, 977].filter((m) => m < f.count) : [0, 5].filter((m) => m < f.count);
      for (const m of birds) {
        let was: Vec3 | null = null;
        for (let time = 3 * L; time < 4 * L; time += L / 200) {
          const b = memberAt(t, f, m, time);
          assert.ok(b.at.every(Number.isFinite) && Number.isFinite(b.beat), `${f.kind} ${m} placed at ${time}`);
          assert.ok(b.speed <= FASTEST[f.kind], `${f.kind} ${m} at ${(time / L - 3).toFixed(3)} of the day flies ${b.speed.toFixed(1)} m/s`);
          const p = fromWorld(h.profile, ...b.at);
          if (b.doing === 'fly') assert.ok(p.h > t.standAt(p.theta, p.s) + 0.1, `${f.kind} ${m} over the ground at ${(time / L - 3).toFixed(3)}: ${(p.h - t.standAt(p.theta, p.s)).toFixed(2)} m`);
          // A step in the clock moves it no farther than its fastest would.
          if (was) assert.ok(dist(was, b.at) <= FASTEST[f.kind] * (L / 200) + 1, `${f.kind} ${m} jumps`);
          was = b.at;
        }
      }
    }
  });
}

/** The reference's flocks and a moment of its day where the light over s first passes `level` (falling or rising). */
const ref = MATRIX[0].name;
function when(s: number, day: number, level: number, rising: boolean): number {
  const h = ecologyOf(ref).terrain.habitat, L = h.params.day.length;
  for (let t = day * L; t < (day + 1) * L; t += 30) {
    const a = lightAt(h, s, t), b = lightAt(h, s, t + 30);
    if (rising ? a < level && b >= level : a > level && b <= level) return t + 30;
  }
  return NaN;
}

test('flocks: the same bird at the same moment is the same, however it is asked for', () => {
  const t = ecologyOf(ref).terrain, L = t.habitat.params.day.length;
  for (const f of flocksOf(ref)) {
    const copy = structuredClone(f), at = 5 * L + 0.62 * L;
    for (let k = 0; k < 20; k++) memberAt(t, f, 1, at + 300 * k);
    assert.deepEqual(memberAt(t, f, 1, at), memberAt(t, copy, 1, at), f.kind);
  }
});

test('flocks: starlings roost at night, feed by day, gather in a murmuration at dusk and pour into the roost', () => {
  const t = ecologyOf(ref).terrain, h = t.habitat, L = h.params.day.length, f = flocksOf(ref).find((x) => x.kind === 'starling');
  if (!f) return;
  const birds = Array.from({ length: 60 }, (_, k) => (k * 41) % f.count), share = (time: number, doing: string): number => birds.filter((m) => memberWhere(t, f, m, time).doing === doing).length / birds.length;
  const day = 6, drop = when(f.s, day, 0.06, false);
  assert.equal(share(day * L + 0.95 * L, 'roost'), 1, 'all at roost at night');
  assert.ok(share((day + 0.3) * L, 'feed') > 0.9, 'feeding by day');
  assert.ok(share(drop - 300, 'fly') > 0.9, 'up in the murmuration before the drop');
  assert.equal(share(drop + 600, 'roost'), 1, 'down in the roost after it');
  // The murmuration is one flock: its birds close together over the water.
  const at = birds.map((m) => memberWhere(t, f, m, drop - 300).at), mid = at.reduce((a, p) => [a[0] + p[0] / at.length, a[1] + p[1] / at.length, a[2] + p[2] / at.length], [0, 0, 0] as Vec3);
  assert.ok(at.every((p) => dist(p, mid) < 150), 'together');
  assert.ok(flockNoise(h, f, drop - 300).wings > 0.9 && flockNoise(h, f, (day + 0.3) * L).wings === 0, 'its wings heard only in the murmuration');
});

test('flocks: swifts climb toward the axis for the night, where they beat slower in the weak gravity', () => {
  const t = ecologyOf(ref).terrain, h = t.habitat, L = h.params.day.length, f = flocksOf(ref).find((x) => x.kind === 'swift');
  if (!f) return;
  for (const m of [0, 7, 19]) {
    const night = memberAt(t, f, m, 2 * L + 0.9 * L), day = memberAt(t, f, m, 2 * L + 0.3 * L);
    assert.ok(Math.hypot(night.at[0], night.at[1]) < Math.max(150, 0.06 * h.radius) + 120, 'near the axis at night');
    const p = fromWorld(h.profile, ...day.at), up = p.h - t.standAt(p.theta, p.s);
    assert.ok(up > 50 && up < 1200, `high over the floor by day (${up.toFixed(0)} m)`);
    assert.ok(night.beat < day.beat * 0.6, `slower wingbeats near the axis (${night.beat.toFixed(1)} against ${day.beat.toFixed(1)})`);
  }
});

test('flocks: swallows sleep in their nests and twitter as they fly; the calls are the same however the time is cut', () => {
  const t = ecologyOf(ref).terrain, h = t.habitat, L = h.params.day.length, f = flocksOf(ref).find((x) => x.kind === 'swallow');
  if (!f) return;
  for (let m = 0; m < f.count; m++) assert.equal(memberWhere(t, f, m, 4 * L + 0.9 * L).doing, 'roost', 'in the nest at night');
  const noon = 4 * L + 0.3 * L, ear = memberWhere(t, f, 0, noon).at;
  const whole = flockCallsIn(t, [f], noon, noon + 60, ear, 150), cut = [...flockCallsIn(t, [f], noon, noon + 25, ear, 150), ...flockCallsIn(t, [f], noon + 25, noon + 60, ear, 150)];
  assert.ok(whole.length > 0, 'they call');
  assert.deepEqual(cut.map((c) => c.t).sort(), whole.map((c) => c.t).sort());
  for (const c of whole) assert.equal(c.kind, 'swallow');
});
