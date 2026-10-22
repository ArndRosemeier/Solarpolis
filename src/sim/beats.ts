/**
 * A stay as a chain of beats (design "What people do on the land", step 2): a party at its place does one thing after
 * another, each for a few minutes: talks standing, sits down on the grass and talks on, eats, lies back, strolls off a
 * little way to look out and comes back. Which beats come up, and how often, is the place's repertoire (by what people
 * do there, `REPERTOIRE`); how long each lasts, the party's own (a jittered grid, so any moment's beat is found at once).
 * Everyone in a party is in the same beat: the one who chose the place (`lead`) seeds it.
 *
 * Each beat holds the body one way (`POSE`: standing, sitting or kneeling, lying), and a change between two is a move
 * of its own: `from` is how they held themselves before, `since` how long ago it changed (sitting down as they arrive,
 * getting up a few seconds before they leave, `RISE`). The figures play it (render/people.ts); the stand-ins and specks
 * take the new pose.
 *
 * What a place offers follows what it is (step 3): courts are for talk on the way, a commons in an orchard district for
 * picnics with a game of catch, a play commons for dancing and catch, a makers' commons for kneeling and standing work,
 * the reserve's trail for a stop to drink and stretch, the summit for looking out. Some beats need company (`least`):
 * nobody plays catch or dances a pair dance alone. Pure.
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import { POSE } from '../gen/standIn';
import type { Activity } from './venues';

/** What someone does in a beat (`walk`: on their way to their place or home). */
export type Act = 'walk' | 'talk' | 'quiet' | 'eat' | 'look' | 'work' | 'play' | 'stroll' | 'rest' | 'dance' | 'catch' | 'stretch';

const UP = POSE.upright, DOWN = POSE.kneel, FLAT = POSE.lie;

/** How people hold themselves at what they do when the place has no beats of its own; walking, everyone is upright. */
const POSTURE: Partial<Record<Activity, number>> = { make: DOWN, sit: DOWN, bench: DOWN, picnic: FLAT, stargaze: FLAT };

export function postureOf(activity: Activity): number {
  return POSTURE[activity] ?? UP;
}

/**
 * One beat a place offers: what they do, how they hold themselves, how often it comes up against the others, and the
 * fewest in a party who do it.
 */
interface Offer {
  act: Act;
  pose: number;
  weight: number;
  least: number;
}

const offer = (act: Act, pose: number, weight: number, least = 1): Offer => ({ act, pose, weight, least });

/**
 * The beats each kind of place offers. In a court people mostly talk, standing or on its seat; on a green or a commons
 * they also sit down in the grass, eat, and stroll off to look about; at a picnic they lie back; at night they lie
 * looking up. Places not listed keep one beat: their own (swimming, herding, climbing, the Sunwalk).
 */
const REPERTOIRE: Partial<Record<Activity, readonly Offer[]>> = {
  meet: [offer('talk', UP, 3), offer('quiet', UP, 1), offer('look', UP, 1)],
  bench: [offer('talk', DOWN, 3), offer('quiet', DOWN, 1), offer('eat', DOWN, 1)],
  gather: [offer('talk', UP, 2), offer('talk', DOWN, 2), offer('eat', DOWN, 1), offer('stroll', UP, 1), offer('dance', UP, 1, 2)],
  sit: [offer('talk', DOWN, 2), offer('quiet', DOWN, 1), offer('eat', DOWN, 1), offer('look', UP, 1)],
  picnic: [offer('eat', DOWN, 2), offer('talk', DOWN, 2), offer('rest', FLAT, 2), offer('stroll', UP, 1), offer('catch', UP, 1, 2)],
  bathe: [offer('rest', FLAT, 3), offer('talk', DOWN, 1), offer('look', UP, 1), offer('stroll', UP, 1)],
  watch: [offer('look', UP, 2), offer('look', DOWN, 1), offer('talk', UP, 1)],
  play: [offer('play', UP, 2), offer('catch', UP, 2, 2), offer('dance', UP, 1, 2), offer('rest', DOWN, 1), offer('talk', UP, 1)],
  make: [offer('work', DOWN, 3), offer('work', UP, 2), offer('look', UP, 1), offer('talk', UP, 1)],
  stargaze: [offer('rest', FLAT, 3), offer('talk', DOWN, 1)],
  wander: [offer('stroll', UP, 2), offer('look', UP, 1), offer('quiet', UP, 1), offer('stretch', UP, 1)],
  stroll: [offer('stroll', UP, 2), offer('look', UP, 1)],
  hike: [offer('look', UP, 2), offer('stretch', UP, 1), offer('eat', DOWN, 1), offer('rest', DOWN, 1)],
  fly: [offer('look', UP, 2), offer('talk', UP, 1), offer('stretch', UP, 1)],
};

/** The repertoires with their weights summed, once. */
interface Repertoire {
  offers: readonly Offer[];
  total: number;
  /** The fewest in a party who may do everything in it. */
  least: number;
}
const REPERTOIRES: Partial<Record<Activity, Repertoire>> = Object.fromEntries(
  Object.entries(REPERTOIRE).map(([a, offers]) => [a, { offers: offers!, total: offers!.reduce((t, o) => t + o.weight, 0), least: Math.max(...offers!.map((o) => o.least)) }]),
);

/** Every act some place offers (the tests go through them). */
export const OFFERED: readonly Act[] = [...new Set(Object.values(REPERTOIRE).flatMap((r) => r!.map((o) => o.act)))];

/**
 * How long beats last: a party's own length about `mean` (s, between half and one and a half times it), each beat
 * that ± `jitter` of it, so they run from a fifth of it to nearly twice.
 */
const BEAT = { mean: 300, jitter: 0.8 };
/** Seconds before they leave that someone sitting or lying gets up; first up, then off on a stroll. */
export const RISE = 3;
/** A stroll shorter than this (s) is no stroll: they stay where they are. */
const SHORTEST = 20;
/** Catch: each walks this far (m) out from their spot, so a pair throws over about twice it. */
export const CATCH = 4;

/** A beat at a moment. */
export interface Beat {
  act: Act;
  /** How they hold themselves now (`POSE`), and before it last changed. */
  posture: number;
  from: number;
  /** Seconds since it changed (since they arrived, if it has not since). */
  since: number;
  /** On a stroll: how far off their spot they are now (m), and toward where (heading: 0 toward +s, +π/2 toward +θ). */
  away: number;
  toward: number;
  /** Walking on a stroll (out or back: `back`), at the party's pace. */
  moving: boolean;
  back: boolean;
}

/** A draw in [0, 1) for beat k of a party (`party`: its own seed), `salt` telling a beat's draws apart. */
function beatDraw(party: number, k: number, salt: number): number {
  return hashToFloat(hash3i(party, k, salt, 0));
}

/** When beat k starts on the party's grid of `length` s, jittered (beat 0 starts with the outing). */
function startOf(party: number, k: number, length: number): number {
  return k <= 0 ? 0 : (k + BEAT.jitter * (beatDraw(party, k, 2) - 0.5)) * length;
}

/** Beat k's offer from the place's repertoire, for a party of `size`. */
function offerOf(repertoire: Repertoire, party: number, k: number, size: number): Offer {
  const all = size >= repertoire.least;
  let total = repertoire.total;
  if (!all) for (const o of repertoire.offers) if (o.least > size) total -= o.weight;
  let x = beatDraw(party, k, 3) * total;
  for (const o of repertoire.offers) {
    if (!all && o.least > size) continue;
    x -= o.weight;
    if (x < 0) return o;
  }
  return repertoire.offers[0];
}

function still(act: Act, posture: number, from: number, since: number): Beat {
  return { act, posture, from, since, away: 0, toward: 0, moving: false, back: false };
}

/**
 * The beat of someone at their place, `u` s after their outing started: they arrived at `arrive` and leave at `leave`
 * (s after the start), and stroll at `pace` (m/s) at most `reach` m off their spot. `lead` and `day` pick the beats of
 * the party, `size` strong.
 */
export function beatAt(seed: number, activity: Activity, lead: number, size: number, day: number, u: number, arrive: number, leave: number, pace: number, reach: number): Beat {
  const repertoire = REPERTOIRES[activity];
  if (!repertoire) return still('quiet', postureOf(activity), UP, u - arrive);
  const party = hash3i(seed, lead, day, 0), length = BEAT.mean * (0.5 + beatDraw(party, 0, 1));
  let k = Math.floor(u / length), b0 = startOf(party, k, length), b1 = startOf(party, k + 1, length);
  if (u < b0) { k--; b1 = b0; b0 = startOf(party, k, length); } else if (u >= b1) { k++; b0 = b1; b1 = startOf(party, k + 1, length); }
  // No beat starts in the last moments before they get up to leave: the one before runs on to then.
  const last = Math.max(arrive, leave - RISE - SHORTEST);
  while (k > 0 && b0 > last) { k--; b1 = b0; b0 = startOf(party, k, length); }
  const now = offerOf(repertoire, party, k, size);
  // How they held themselves before: the last beat's way, or upright as they came.
  const first = b0 <= arrive, before = first ? UP : offerOf(repertoire, party, k - 1, size).pose;
  const began = Math.max(b0, arrive);
  // Getting up to leave (a stroll or a game of catch is upright already).
  const walks = now.act === 'stroll' || now.act === 'catch';
  if (u >= leave - RISE) {
    const was = walks ? UP : now.pose;
    return was === UP ? still('quiet', UP, before, u - began) : still('quiet', UP, was, u - (leave - RISE));
  }
  if (!walks) return still(now.act, now.pose, before, u - began);
  // A stroll: up first if they sat or lay, out at their pace, a look round, and back; too short a beat, they stay.
  // Catch: out from their spots the party's one way (each member's side is the place's to say), throwing, and back.
  const w0 = began + (before === UP ? 0 : RISE), w1 = Math.min(b1, leave - RISE), span = w1 - w0;
  if (u < w0 || span < SHORTEST) return still('quiet', UP, before, u - began);
  const act = now.act, stays: Act = act === 'catch' ? 'catch' : 'look';
  const far = act === 'catch' ? Math.min(reach, CATCH) : Math.min(reach, (span * pace) / 3), out = far / pace, f = u - w0, toward = 2 * Math.PI * beatDraw(party, k, 4);
  if (f < out) return { act, posture: UP, from: before, since: u - began, away: f * pace, toward, moving: true, back: false };
  if (f > span - out) return { act, posture: UP, from: before, since: u - began, away: Math.max(0, (span - f) * pace), toward, moving: true, back: true };
  return { act: stays, posture: UP, from: before, since: u - began, away: far, toward, moving: false, back: false };
}
