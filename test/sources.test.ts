import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATRIX, toWorld } from '../src/blueprint';
import { TOSS } from '../src/sim/props';
import { strideAt } from '../src/sim/sounds';
import { boatsHeard, cuesOf, humOf, liftsNear, type Cue, type Source } from '../src/sim/sources';
import { boatAt, legsOf, outingOf, sailingOf } from '../src/sim/sailing';
import { BOAT_KINDS } from '../src/gen/boat';
import { ecologyOf } from './worlds';

const e = ecologyOf(MATRIX[0].name), h = e.terrain.habitat, p = h.profile;
const G = 9.81;
const index = JSON.parse(readFileSync(new URL('../public/sound/index.json', import.meta.url), 'utf8')) as { sounds: Record<string, unknown> };

/** A source on the floor's middle, doing something since clock time `began`. */
function source(kind: Source['kind'], doing: string, extra: Partial<Source> = {}): Source {
  const s = (p.floorStart + p.floorEnd) / 2, theta = 1, ground = e.terrain.heightAt(theta, s);
  return { key: 7, kind, theta, s, h: ground, at: toWorld(p, { theta, s, h: ground }), speed: 0, doing, began: 1000, ...extra };
}

/** The cues over [t0, t1), whole and cut in three. */
function both(src: Source, t0: number, t1: number): { whole: Cue[]; cut: Cue[] } {
  const a = t0 + (t1 - t0) * 0.31, b = t0 + (t1 - t0) * 0.77;
  return { whole: cuesOf(e, src, t0, t1, G), cut: [...cuesOf(e, src, t0, a, G), ...cuesOf(e, src, a, b, G), ...cuesOf(e, src, b, t1, G)] };
}

test('sources: a walker steps once a stride, the same however the time is cut, and their sounds exist', () => {
  const walker = source('person', 'walk', { speed: 1.4 });
  const { whole, cut } = both(walker, 1000, 1030);
  assert.deepEqual(cut, whole);
  const gap = strideAt(1.4, G) / 1.4;
  assert.ok(Math.abs(whole.length - 30 / gap) <= 1, `${whole.length} steps in 30 s`);
  for (let i = 1; i < whole.length; i++) assert.ok(Math.abs(whole[i].t - whole[i - 1].t - gap) < 1e-6);
  for (const c of whole) { assert.match(c.sound, /^step\//); assert.ok(index.sounds[c.sound], c.sound); }
  // A shell's servo is heard on some of its steps, quietly.
  const shell = cuesOf(e, { ...walker, kind: 'shell' }, 1000, 1030, G);
  assert.ok(shell.some((c) => c.sound === 'shell/servo' && c.gain < 0.5));
});

test('sources: people make no voice sounds, only what they do', () => {
  const heard = new Set<string>();
  for (const doing of ['talk', 'quiet', 'look', 'rest', 'eat', 'work', 'catch', 'dance', 'stroll', 'play', 'stretch']) {
    for (const c of cuesOf(e, source('person', doing, { member: 0, size: 2, tool: 'saw', moved: true }), 990, 1100, G)) heard.add(c.sound);
  }
  for (const s of heard) assert.match(s, /^(act|step)\//, s);
  for (const doing of ['talk', 'quiet', 'look', 'rest']) assert.equal(cuesOf(e, source('person', doing), 1001, 1100, G).length, 0, doing);
});

test('sources: a meal clinks, a game of catch lands each throw, work comes in spells of strokes', () => {
  const meal = cuesOf(e, source('person', 'eat'), 1000, 1200, G);
  assert.ok(meal.length > 10 && meal.every((c) => c.sound === 'act/clink'), `${meal.length} clinks`);
  // One of each pair carries the ball's landings: one a throw.
  const catches = cuesOf(e, source('person', 'catch', { member: 0, size: 2 }), 1000, 1030, G);
  assert.equal(catches.length, 30 / TOSS.turn);
  assert.ok(Math.abs(catches[0].t - (1000 + TOSS.release + TOSS.flight)) < 1e-9);
  assert.equal(cuesOf(e, source('person', 'catch', { member: 1, size: 2 }), 1000, 1030, G).length, 0);
  const saw = cuesOf(e, source('person', 'work', { tool: 'saw' }), 1000, 1060, G);
  assert.ok(saw.length > 20 && saw.every((c) => c.sound === 'act/saw'));
  const gaps = saw.slice(1).map((c, i) => c.t - saw[i].t);
  assert.ok(Math.max(...gaps) > 3, 'pauses between spells');
  // Sitting down as the beat began: a rustle then, once.
  const sat = cuesOf(e, source('person', 'rest', { moved: true }), 990, 1010, G);
  assert.deepEqual(sat.map((c) => [c.sound, c.t]), [['act/sit', 1000]]);
});

test('sources: deer walk on hooves, graze and now and then snort; squirrels scamper and chatter', () => {
  const walk = cuesOf(e, source('deer', 'walk', { speed: 1.1 }), 1000, 1010, G);
  assert.ok(walk.length > 15 && walk.every((c) => c.sound === 'step/hoof'));
  const graze = cuesOf(e, source('deer', 'eat'), 1000, 1200, G);
  assert.ok(graze.length > 5 && graze.every((c) => c.sound === 'deer/graze'));
  const idle = cuesOf(e, source('deer', 'idle'), 0, 3600, G);
  assert.ok(idle.length > 2 && idle.length < 40 && idle.every((c) => c.sound === 'deer/snort'), `${idle.length} snorts an hour`);
  assert.deepEqual(cuesOf(e, source('squirrel', 'run', { speed: 3 }), 995, 1005, G).map((c) => c.sound), ['squirrel/scamper']);
  assert.ok(cuesOf(e, source('squirrel', 'alert'), 995, 1005, G).some((c) => c.sound === 'squirrel/chatter'));
});

test('sources: drones hum by role while they fly or work, a dancing party plays music, a lift portal hums', () => {
  assert.equal(humOf(source('drone', 'rest', { role: 'courier' })), null);
  for (const role of ['courier', 'tender', 'lifter', 'glider', 'surveyor', 'guardian', 'person'] as const) {
    const hum = humOf(source('drone', 'fly', { role }));
    assert.ok(hum && index.sounds[hum.sound], `${role} ${hum?.sound}`);
  }
  assert.ok(cuesOf(e, source('drone', 'work', { role: 'tender' }), 1000, 1100, G).every((c) => c.sound === 'act/shears'));
  const lead = humOf(source('person', 'dance', { member: 0, size: 4 }));
  assert.ok(lead && lead.sound.startsWith('music/dance') && index.sounds[lead.sound]);
  assert.equal(humOf(source('person', 'dance', { member: 1, size: 4 })), null);
  assert.equal(humOf(source('person', 'talk', { member: 0, size: 4 })), null);
  const c = e.terrain.courts[0];
  const lifts = liftsNear(e.terrain, c.theta, c.s, false);
  assert.ok(lifts.some((l) => l.key === 0 && humOf(l)?.sound === 'lift/hum'), 'the portal in the court hums');
  assert.ok(lifts.every((l) => index.sounds[humOf(l)!.sound]));
});

test('sources: a boat sounds of the water at its hull (a foiler hisses when it flies), its wing swings across on each tack, it ticks at rest', () => {
  const boats = sailingOf(h).boats;
  // A boat with an outing that goes about, from the fifth day on.
  let found: { id: number; o: NonNullable<ReturnType<typeof outingOf>> } | null = null;
  for (let day = 5; day < 25 && !found; day++) {
    for (const b of boats) { const o = outingOf(h, b, day); if (o && legsOf(o).some((l) => l.turning)) { found = { id: b.id, o }; break; } }
  }
  assert.ok(found, 'an outing with a tack');
  const { id, o } = found!, boat = boats[id], legs = legsOf(o), half = BOAT_KINDS[boat.kind].turn / 2;
  const mid = (o.start + o.end) / 2, at = boatAt(h, boat, mid);
  const near = boatsHeard(e.terrain, mid, at.theta, at.s).find((src) => src.key === id)!;
  assert.ok(near && near.kind === 'boat' && near.doing === (at.foiling ? 'foil' : 'sail'), 'heard from beside it, sailing');
  const hum = humOf(near)!;
  assert.ok(index.sounds[hum.sound], hum.sound);
  assert.equal(hum.sound, at.foiling ? 'boat/foil' : 'boat/hull');
  const src = { ...source('boat', 'sail'), key: id };
  const whole = cuesOf(e, src, o.start, o.end, G), cut = [...cuesOf(e, src, o.start, mid, G), ...cuesOf(e, src, mid, o.end, G)];
  assert.deepEqual(cut, whole, 'the same however the time is cut');
  const tacks = legs.filter((l) => l.turning && o.start + l.t + half < o.end).map((l) => o.start + l.t + half);
  assert.deepEqual(whole.map((c) => c.t), tacks);
  assert.ok(whole.every((c) => c.sound === 'boat/tack' && index.sounds[c.sound]));
  // Faster is louder; at rest, the quiet of its mooring.
  const slow = humOf({ ...src, share: 0.2 })!, fast = humOf({ ...src, share: 0.9 })!;
  assert.ok(fast.gain > slow.gain);
  assert.equal(humOf({ ...src, doing: 'moored' })!.sound, 'boat/rest');
  // Under its electric drive only the water is heard, gently; astern, without its bow wave, less.
  const motor = humOf({ ...src, doing: 'motor', share: 0.2 })!, astern = humOf({ ...src, doing: 'astern', share: 0.2 })!;
  assert.ok(motor.sound === 'boat/hull' && astern.sound === 'boat/hull' && astern.gain < motor.gain && motor.gain < humOf({ ...src, share: 0.2 })!.gain + 0.2);
});
