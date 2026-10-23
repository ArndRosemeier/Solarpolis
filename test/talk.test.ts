import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { PURSUITS, TEMPERAMENTS, partyKey, partyMembers, peopleAt, residentOf, voiceOf, type Person } from '../src/sim';
import { Conversations, PURSUIT_WORDS, lineAt, readFor, type Line } from '../src/talk';
import { habitatOf } from './worlds';

for (const { name } of MATRIX) {
  test(`talk (${name}): every resident has a name, a temperament and one to three pursuits, the same every time`, () => {
    const h = habitatOf(name), n = Math.min(300, h.params.population), names = new Set<string>();
    let flyers = 0, drones = 0;
    for (let i = 0; i < n; i++) {
      const v = voiceOf(h, i);
      assert.deepEqual(v, voiceOf(h, i));
      assert.ok(v.name.length > 0 && TEMPERAMENTS.includes(v.temperament));
      assert.ok(v.pursuits.length >= 1 && v.pursuits.length <= 3 && new Set(v.pursuits).size === v.pursuits.length, `${v.pursuits}`);
      for (const p of v.pursuits) assert.ok(p in PURSUITS);
      names.add(v.name);
      if (residentOf(h, i).body === 'drone') { drones++; if (v.pursuits.includes('flying')) flyers++; }
    }
    assert.ok(names.size > 50, `only ${names.size} names`);
    if (drones > 4) assert.ok(flyers >= drones * 0.5, `${flyers} of ${drones} drone persons like flying`);
  });
}

test('talk: every pursuit has its words, and every reason fits one bubble', () => {
  for (const id of Object.keys(PURSUITS)) {
    const w = PURSUIT_WORDS[id as keyof typeof PURSUITS];
    assert.ok(w && w.name && w.reasons.length >= 2, id);
    for (const r of w.reasons) assert.ok([...r].length <= 90, `${id}: ${r}`);
  }
});

/** The talking parties in part of a habitat at clock time t, whole (all their members there), up to `most`. */
function talkingParties(h: ReturnType<typeof habitatOf>, t: number, most: number): Person[][] {
  const out = peopleAt(h, t, { theta: 0, s: h.profile.floorStart + 0.4 * (h.profile.floorEnd - h.profile.floorStart), radius: 3 * h.params.life.reach });
  const parties = new Map<number, Person[]>();
  for (const p of out) if (p.court >= 0 && !p.moving && p.act === 'talk') parties.set(partyKey(p), [...(parties.get(partyKey(p)) ?? []), p]);
  return [...parties.values()].filter((l) => l[0].size >= 2 && l.length === l[0].size).slice(0, most);
}

test('talk: a talking party holds conversations, the same lines for the same party and clock, one after another, at reading pace', () => {
  const h = habitatOf('reference'), t = 3 * h.params.day.length + 9 * 3600, talk = h.params.life.talk;
  const parties = talkingParties(h, t, 4);
  assert.ok(parties.length >= 2, `only ${parties.length} talking parties`);
  const a = new Conversations(h), b = new Conversations(h);
  for (const party of parties) {
    const lead = party.find((p) => p.member === 0) ?? party[0], members = partyMembers(h, t, lead);
    assert.deepEqual([...members].sort(), party.map((p) => p.resident).sort(), 'the party is its members');
    const talkers = { key: partyKey(lead), members, start: t - lead.since };
    // Two conversations: the second is made when the first is over.
    const first = a.linesOf(talkers, t, true)!, count = first.length;
    assert.ok(count >= 8, `only ${count} lines`);
    const end = first[count - 1].t1;
    const lines: Line[] = [...a.linesOf(talkers, end + talk.quiet * 2, true)!];
    assert.ok(lines.length > count, 'a second conversation after the quiet');
    assert.ok(lines[count].t0 >= end + talk.quiet * 0.5, 'after a quiet');
    b.linesOf(talkers, t, true);
    assert.deepEqual(b.linesOf(talkers, end + talk.quiet * 2, true), lines, 'the same lines every time');
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      assert.ok(l.member >= 0 && l.member < lead.size);
      assert.ok([...l.text].length <= 90, l.text);
      assert.ok(Math.abs(l.t1 - l.t0 - readFor(l.text, talk.read)) < 1e-9, 'as long as it takes to read');
      if (k > 0) assert.ok(l.t0 >= lines[k - 1].t1, 'one at a time');
      assert.equal(lineAt(lines, (l.t0 + l.t1) / 2), l);
    }
    assert.ok(new Set(lines.map((l) => l.member)).size >= 2, 'more than one speaks');
    assert.ok(lines[0].t0 > talkers.start, 'after the beat begins');
  }
  assert.ok(a.bytes() > 0);
  const kept = a.linesOf({ key: partyKey(parties[0][0]), members: partyMembers(h, t, parties[0][0]), start: t - parties[0][0].since }, t, false);
  a.shed();
  assert.equal(a.bytes(), 0);
  assert.equal(a.linesOf({ key: partyKey(parties[0][0]), members: partyMembers(h, t, parties[0][0]), start: t - parties[0][0].since }, t, false), null, 'nothing kept after shedding');
  const again = a.linesOf({ key: partyKey(parties[0][0]), members: partyMembers(h, t, parties[0][0]), start: t - parties[0][0].since }, t, true)!;
  assert.deepEqual(again, kept!.slice(0, again.length), 'made again the same');
});
