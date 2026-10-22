import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { POSE } from '../src/gen/standIn';
import { OFFERED, RISE, beatAt } from '../src/sim/beats';
import { peopleAt, personKey, type Person } from '../src/sim';
import { habitatOf } from './worlds';

test('beats: a stay is a chain of beats: down on arriving, up before leaving, strolls come back, the same for the same party', () => {
  const STEP = 5, seed = 77, arrive = 40, leave = 9000, pace = 1.2, reach = 30, acts = new Set<string>();
  for (const activity of ['gather', 'picnic', 'sit', 'make', 'play', 'stargaze', 'wander'] as const) for (let lead = 0; lead < 16; lead++) {
    let last = beatAt(seed, activity, lead, 3, arrive, arrive, leave, pace, reach), changes = 0;
    assert.equal(last.from, POSE.upright, 'they come upright');
    assert.ok(Math.abs(last.since) < 1e-9);
    for (let u = arrive; u <= leave; u += STEP) {
      const b = beatAt(seed, activity, lead, 3, u, arrive, leave, pace, reach);
      if (u % 500 === arrive) assert.deepEqual(b, beatAt(seed, activity, lead, 3, u, arrive, leave, pace, reach), 'the same every time');
      acts.add(b.act);
      assert.ok(b.away >= 0 && b.away <= reach + 1e-9, `a stroll ${b.away.toFixed(1)} m off, at most ${reach}`);
      if (b.moving || b.away > 0) assert.equal(b.posture, POSE.upright, 'strolling upright');
      if (b.posture !== last.posture) {
        changes++;
        assert.equal(b.from, last.posture, 'a change starts from how they were');
        assert.ok(b.since <= STEP + 1e-9, 'and is new');
      }
      if (u >= leave - RISE) assert.equal(b.posture, POSE.upright, 'up to leave');
      last = b;
    }
    assert.equal(last.away, 0, 'back on their spot to leave');
    if (activity !== 'wander') assert.ok(changes > 0, `${activity}: never moves in two and a half hours`);
  }
  for (const act of OFFERED) assert.ok(acts.has(act), `${act} never comes up`);
});

for (const { name, params } of MATRIX.filter((m) => m.name === 'small' || m.name === 'reference')) {
  test(`beats (${name}): parties do one thing together; those out do many things, standing, sitting and lying`, () => {
    const h = habitatOf(name), t = 3 * params.day.length + 8 * 3600, court = h.params.life.reach;
    const out = name === 'small' ? peopleAt(h, t) : peopleAt(h, t, { theta: 0, s: h.profile.floorStart + 0.4 * (h.profile.floorEnd - h.profile.floorStart), radius: 4 * court });
    const still = out.filter((p) => !p.moving && p.act !== 'walk');
    const parties = new Map<number, Person[]>();
    for (const p of out.filter((q) => q.court >= 0 && q.act !== 'walk')) {
      const key = personKey({ court: p.court, outing: p.outing - p.member });
      parties.set(key, [...(parties.get(key) ?? []), p]);
    }
    let agree = 0, whole = 0;
    for (const list of parties.values()) {
      if (list.length < 2 || list.length !== list[0].size) continue;
      whole++;
      if (list.every((p) => p.act === list[0].act && p.posture === list[0].posture)) agree++;
    }
    assert.ok(whole > 0 && agree >= whole * 0.9, `${agree} of ${whole} parties in one beat`);
    if (name === 'small') return;
    const share = (f: (p: Person) => boolean): number => still.filter(f).length / Math.max(1, still.length);
    const up = share((p) => p.posture === POSE.upright), down = share((p) => p.posture === POSE.kneel), flat = share((p) => p.posture === POSE.lie);
    assert.ok(up > 0.1 && down > 0.1 && flat > 0.01, `standing ${up.toFixed(2)}, sitting ${down.toFixed(2)}, lying ${flat.toFixed(2)} of ${still.length}`);
    const acts = new Set(out.map((p) => p.act));
    assert.ok(acts.size >= 6, `only ${[...acts].join(', ')}`);
  });
}
