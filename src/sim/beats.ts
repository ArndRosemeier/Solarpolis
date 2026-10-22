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
 * take the new pose. Pure.
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import { POSE } from '../gen/standIn';
import type { Activity } from './venues';

/** What someone does in a beat (`walk`: on their way to their place or home). */
export type Act = 'walk' | 'talk' | 'quiet' | 'eat' | 'look' | 'work' | 'play' | 'stroll' | 'rest';

const UP = POSE.upright, DOWN = POSE.kneel, FLAT = POSE.lie;

/** How people hold themselves at what they do when the place has no beats of its own; walking, everyone is upright. */
const POSTURE: Partial<Record<Activity, number>> = { make: DOWN, sit: DOWN, bench: DOWN, picnic: FLAT, stargaze: FLAT };

export function postureOf(activity: Activity): number {
  return POSTURE[activity] ?? UP;
}

/** One beat a place offers: what they do, how they hold themselves, and how often it comes up against the others. */
interface Offer {
  act: Act;
  pose: number;
  weight: number;
}

const offer = (act: Act, pose: number, weight: number): Offer => ({ act, pose, weight });

/**
 * The beats each kind of place offers. In a court people mostly talk, standing or on its seat; on a green or a commons
 * they also sit down in the grass, eat, and stroll off to look about; at a picnic they lie back; at night they lie
 * looking up. Places not listed keep one beat: their own (swimming, herding, climbing, the Sunwalk).
 */
const REPERTOIRE: Partial<Record<Activity, readonly Offer[]>> = {
  meet: [offer('talk', UP, 3), offer('quiet', UP, 1), offer('look', UP, 1)],
  bench: [offer('talk', DOWN, 3), offer('quiet', DOWN, 1), offer('eat', DOWN, 1)],
  gather: [offer('talk', UP, 2), offer('talk', DOWN, 2), offer('eat', DOWN, 1), offer('stroll', UP, 1)],
  sit: [offer('talk', DOWN, 2), offer('quiet', DOWN, 1), offer('eat', DOWN, 1), offer('look', UP, 1)],
  picnic: [offer('eat', DOWN, 2), offer('talk', DOWN, 2), offer('rest', FLAT, 2), offer('stroll', UP, 1)],
  watch: [offer('look', UP, 2), offer('look', DOWN, 1), offer('talk', UP, 1)],
  play: [offer('play', UP, 3), offer('rest', DOWN, 1), offer('talk', UP, 1)],
  make: [offer('work', DOWN, 3), offer('look', UP, 1), offer('talk', UP, 1)],
  stargaze: [offer('rest', FLAT, 3), offer('talk', DOWN, 1)],
  wander: [offer('stroll', UP, 2), offer('look', UP, 1), offer('quiet', UP, 1)],
  stroll: [offer('stroll', UP, 2), offer('look', UP, 1)],
};

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

/** A draw in [0, 1) for beat k of a party's day: `salt` tells the draws apart. */
const draw = (seed: number, lead: number, day: number, k: number, salt: number): number => hashToFloat(hash3i(hash3i(seed, lead, day, salt), k, 0, 0));

/** The party's beat length (s). */
const lengthOf = (seed: number, lead: number, day: number): number => BEAT.mean * (0.5 + draw(seed, lead, day, 0, 1));

/** Where beat k starts, s after the outing starts: its place on the party's grid, jittered. */
const startOf = (seed: number, lead: number, day: number, k: number, length: number): number =>
  k <= 0 ? 0 : (k + BEAT.jitter * (draw(seed, lead, day, k, 2) - 0.5)) * length;

/** Beat k's offer from the place's repertoire. */
function offerOf(repertoire: readonly Offer[], seed: number, lead: number, day: number, k: number): Offer {
  let total = 0;
  for (const o of repertoire) total += o.weight;
  let x = draw(seed, lead, day, k, 3) * total;
  for (const o of repertoire) { x -= o.weight; if (x < 0) return o; }
  return repertoire[repertoire.length - 1];
}

/**
 * The beat of someone at their place, `u` s after their outing started: they arrived at `arrive` and leave at `leave`
 * (s after the start), and stroll at `pace` (m/s) at most `reach` m off their spot. `lead` and `day` pick the party's beats.
 */
export function beatAt(seed: number, activity: Activity, lead: number, day: number, u: number, arrive: number, leave: number, pace: number, reach: number): Beat {
  const own = postureOf(activity), repertoire = REPERTOIRE[activity];
  const still = (act: Act, posture: number, from: number, since: number): Beat => ({ act, posture, from, since, away: 0, toward: 0, moving: false, back: false });
  if (!repertoire) return still('quiet', own, UP, u - arrive);
  const length = lengthOf(seed, lead, day);
  let k = Math.floor(u / length);
  if (u < startOf(seed, lead, day, k, length)) k--;
  else if (u >= startOf(seed, lead, day, k + 1, length)) k++;
  // No beat starts in the last moments before they get up to leave: the one before runs on to then.
  while (k > 0 && startOf(seed, lead, day, k, length) > Math.max(arrive, leave - RISE - SHORTEST)) k--;
  const b0 = startOf(seed, lead, day, k, length), b1 = startOf(seed, lead, day, k + 1, length);
  const now = offerOf(repertoire, seed, lead, day, k);
  // How they held themselves before: the last beat's way, or upright as they came.
  const first = b0 <= arrive, before = first ? UP : offerOf(repertoire, seed, lead, day, k - 1).pose;
  const began = Math.max(b0, arrive);
  // Getting up to leave (a stroll is upright already).
  if (u >= leave - RISE) {
    const was = now.act === 'stroll' ? UP : now.pose;
    return was === UP ? still('quiet', UP, before, u - began) : still('quiet', UP, was, u - (leave - RISE));
  }
  if (now.act !== 'stroll') return still(now.act, now.pose, before, u - began);
  // A stroll: up first if they sat or lay, out at their pace, a look round, and back; too short a beat, they stay.
  const w0 = began + (before === UP ? 0 : RISE), w1 = Math.min(b1, leave - RISE), span = w1 - w0;
  if (u < w0 || span < SHORTEST) return still('quiet', UP, before, u - began);
  const far = Math.min(reach, (span * pace) / 3), out = far / pace, f = u - w0, toward = 2 * Math.PI * draw(seed, lead, day, k, 4);
  if (f < out) return { act: 'stroll', posture: UP, from: before, since: u - began, away: f * pace, toward, moving: true, back: false };
  if (f > span - out) return { act: 'stroll', posture: UP, from: before, since: u - began, away: Math.max(0, (span - f) * pace), toward, moving: true, back: true };
  return { act: 'look', posture: UP, from: before, since: u - began, away: far, toward, moving: false, back: false };
}
