/**
 * What the things round the listener make heard (design "Solarpolis: how it sounds": people, animals and machines):
 * the views know who is near and what each is doing (people, deer, squirrels, drones); this says what that sounds like
 * and when. People make no voice sounds at all (Arnd, 2026-10-23): what is heard of them is what they do, their steps,
 * a meal, a game of catch, tools at work, music when they dance. Pure: the same source over the same span of the clock
 * gives the same cues, however the span is cut, and nothing uses `Math.random`.
 *
 *   cues   one-shots (a step, a clink, a snort), each at its clock time, from the source's place;
 *   hums   what sounds as long as the source does it (a drone's rotors, a lift portal, a party's music).
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import type { Ecology } from '../gen/ecology';
import { doorsAbove, doorsBelow } from '../gen/lifts';
import type { Terrain } from '../gen/terrain';
import { floorGap } from './walks';
import type { DroneRole } from '../blueprint';
import { TOSS } from './props';
import { byTime, stepSurfaceAt, strideAt } from './sounds';

export type SourceKind = 'person' | 'shell' | 'deer' | 'squirrel' | 'drone' | 'lift';

/** A tool at work: sawing at a bench, chopping or tapping a chisel, pruning (tenders in the orchards). */
export type Tool = 'saw' | 'mallet' | 'shears';

/**
 * Something near the listener that may be heard, as the view placed it this moment: who (a stable `key` per kind), where
 * (on the profile, and in the world for the panner), how fast it goes over the floor, and what it is doing: a beat's act
 * for people (sim/beats.ts), a deer's or squirrel's doing (sim/herds.ts, sim/fauna.ts), a drone's (sim/air.ts).
 */
export interface Source {
  key: number;
  kind: SourceKind;
  theta: number;
  s: number;
  /** Its feet over the profile (m). */
  h: number;
  at: [number, number, number];
  /** In the Understorey (its steps are on the floor there). */
  below?: boolean;
  speed: number;
  doing: string;
  /** The clock time it began doing it (s). */
  began: number;
  /** People: their place in their party and its size (the pairs at catch), whether they changed how they hold themselves this beat, and their tool. */
  member?: number;
  size?: number;
  moved?: boolean;
  tool?: Tool;
  /** Drones: their role. */
  role?: DroneRole;
}

/** A one-shot: which sound (an id in public/sound/index.json), which of its takes, from where, when (clock s), how loud and at what pitch. */
export interface Cue {
  sound: string;
  take: number;
  at: [number, number, number];
  t: number;
  gain: number;
  pitch: number;
}

/** A sound that lasts while its source does what makes it: which, how loud, at what pitch. */
export interface Hum {
  sound: string;
  gain: number;
  pitch: number;
}

/** How far each kind is heard at all (m): past it a view need not hand it over. */
export const HEARD_WITHIN: Readonly<Record<SourceKind, number>> = { person: 40, shell: 40, deer: 60, squirrel: 30, drone: 150, lift: 40 };

/** A deer's hooves fall this far apart (m): its walk covers a little under a body length a cycle, two hooves heard in it. */
const HOOF_STRIDE = 0.45;
/** A tool's strokes (s apart), how long a spell of work runs before a pause, and the pause. */
const STROKE: Readonly<Record<Tool, number>> = { saw: 0.85, mallet: 1.1, shears: 2.2 };
const SPELL = 8, PAUSE = 4;
/** Slots (s) in which a meal's clink, a deer's mouthful or snort, a squirrel's chatter may come, and the chance of each. */
const CLINK_SLOT = 4, CLINK = 0.55;
const GRAZE_SLOT = 4, GRAZE = 0.45;
const SNORT_SLOT = 30, SNORT = 0.08;
const CHATTER_SLOT = 6, CHATTER = 0.3;
/** A shell's servo is heard on one step in this many. */
const SERVO_EVERY = 5;
/** Takes per sound (the files `-1 … n`); one-take sounds have 1. */
const TAKES: Readonly<Record<string, number>> = { 'act/saw': 4, 'act/mallet': 4, 'act/shears': 4, 'act/clink': 4, 'act/catch': 3, 'step/hoof': 4 };

const roll = (key: number, salt: number, slot: number, k: number): number => hashToFloat(hash3i(key, salt, slot, k));

/**
 * The cues a source gives between clock times t0 and t1 (sorted by time). `gravity` (m/s² at its feet) sets the
 * cadence of steps.
 */
export function cuesOf(e: Ecology, src: Source, t0: number, t1: number, gravity: number): Cue[] {
  const out: Cue[] = [];
  if (t1 <= t0) return out;
  const cue = (sound: string, t: number, gain: number, k: number): void => {
    const takes = TAKES[sound] ?? (sound.startsWith('step/') ? 4 : 1);
    out.push({ sound, take: Math.floor(roll(src.key, 3, Math.floor(t * 8), k) * takes), at: src.at, t, gain, pitch: 0.92 + 0.16 * roll(src.key, 5, Math.floor(t * 8), k) });
  };
  /** Every point of an even grid of `every` s (phased by the source) in [t0, t1). */
  const grid = (every: number, salt: number, f: (t: number, n: number) => void): void => {
    const phase = roll(src.key, salt, 0, 0) * every;
    for (let n = Math.ceil((t0 - phase) / every); phase + n * every < t1; n++) f(phase + n * every, n);
  };
  /** Per slot, with a chance, one moment in it. */
  const slots = (slot: number, chance: number, salt: number, f: (t: number) => void): void => {
    for (let n = Math.floor(t0 / slot); n * slot < t1; n++) {
      if (roll(src.key, salt, n, 0) >= chance) continue;
      const t = (n + roll(src.key, salt, n, 1)) * slot;
      if (t >= t0 && t < t1) f(t);
    }
  };
  const begun = src.began >= t0 && src.began < t1 ? src.began : NaN;
  switch (src.kind) {
    case 'person': case 'shell': {
      if (src.speed > 0.2) {
        const surface = stepSurfaceAt(e, src.theta, src.s, src.h, !!src.below);
        grid(strideAt(src.speed, gravity) / src.speed, 11, (t, n) => {
          cue(`step/${surface}`, t, 0.5, n);
          if (src.kind === 'shell' && n % SERVO_EVERY === 0) cue('shell/servo', t + 0.05, 0.25, n);
        });
        break;
      }
      // Sitting down or getting up as the beat began: the rustle of it.
      if (src.moved && !Number.isNaN(begun)) cue('act/sit', begun, 0.5, 0);
      if (src.doing === 'eat') slots(CLINK_SLOT, CLINK, 13, (t) => cue('act/clink', t, 0.4, 0));
      if (src.doing === 'catch' && (src.member ?? 0) % 2 === 0 && (src.member ?? 0) + 1 < (src.size ?? 0)) {
        // The ball lands in the other's hands at the end of each throw (sim/props.ts `tossAt`).
        const start = src.began;
        for (let n = Math.max(0, Math.floor((t0 - start) / TOSS.turn)); start + n * TOSS.turn + TOSS.release + TOSS.flight < t1; n++) {
          const t = start + n * TOSS.turn + TOSS.release + TOSS.flight;
          if (t >= t0) cue('act/catch', t, 0.55, n);
        }
      }
      if (src.doing === 'work' && src.tool) work(src.tool, 0.6);
      break;
    }
    case 'deer':
      if (src.speed > 0.1) grid(HOOF_STRIDE / src.speed, 17, (t, n) => cue('step/hoof', t, 0.35, n));
      else if (src.doing === 'eat' || src.doing === 'headLow') slots(GRAZE_SLOT, GRAZE, 19, (t) => cue('deer/graze', t, 0.4, 0));
      else slots(SNORT_SLOT, SNORT, 23, (t) => cue('deer/snort', t, 0.6, 0));
      break;
    case 'squirrel':
      if ((src.doing === 'run' || src.doing === 'hop') && !Number.isNaN(begun)) cue('squirrel/scamper', begun, 0.45, 0);
      if (src.doing === 'alert' && !Number.isNaN(begun)) cue('squirrel/chatter', begun, 0.55, 0);
      else if (src.doing === 'flick' || src.doing === 'alert') slots(CHATTER_SLOT, CHATTER, 29, (t) => cue('squirrel/chatter', t, 0.45, 0));
      break;
    case 'drone':
      // Tenders prune as they work over the orchards and gardens.
      if (src.role === 'tender' && src.doing === 'work') work('shears', 0.5);
      break;
    case 'lift':
      break;
  }
  return out.sort(byTime);

  /** A tool's strokes through spells of work and pauses (each source its own phase). */
  function work(tool: Tool, gain: number): void {
    const cycle = SPELL + PAUSE, phase = roll(src.key, 31, 0, 0) * cycle;
    grid(STROKE[tool], 37, (t, n) => {
      if ((((t - phase) % cycle) + cycle) % cycle < SPELL) cue(`act/${tool}`, t, gain, n);
    });
  }
}

/** The drones' roles, as they sound: the small couriers' shrouded fans, the lifters' big slow rotors, and so on. */
const DRONE_HUM: Readonly<Record<DroneRole, string>> = {
  courier: 'drone/courier', person: 'drone/courier', tender: 'drone/tender', lifter: 'drone/lifter', glider: 'drone/glider', surveyor: 'drone/high', guardian: 'drone/high',
};

/** The music a dancing party plays (files `music/dance-*`), chosen by the party. */
export const DANCES = ['music/dance-a', 'music/dance-b'] as const;

/** What a source makes heard as long as it does what it does (null: nothing lasting). */
export function humOf(src: Source): Hum | null {
  switch (src.kind) {
    case 'drone':
      if (!src.role || src.doing === 'rest') return null;
      return { sound: DRONE_HUM[src.role], gain: src.doing === 'work' ? 0.6 : 0.8, pitch: 0.95 + 0.1 * roll(src.key, 41, 0, 0) };
    case 'lift':
      return { sound: 'lift/hum', gain: 0.5, pitch: 1 };
    case 'person': case 'shell':
      // A dancing party's music, played from where its first member stands.
      if (src.doing !== 'dance' || src.member !== 0) return null;
      return { sound: DANCES[Math.floor(roll(src.key, 43, 0, 0) * DANCES.length)], gain: 0.7, pitch: 1 };
    default:
      return null;
  }
}

/**
 * The lift portals near a listener at (θ, s), on the land or below it: each court's doors on that side, humming softly
 * as long as one is near (keys are the courts').
 */
export function liftsNear(t: Terrain, theta: number, s: number, below: boolean): Source[] {
  const out: Source[] = [], r = t.habitat.radius;
  t.courts.forEach((c, court) => {
    if (floorGap(r, theta, s, c.theta, c.s) > HEARD_WITHIN.lift + c.radius) return;
    const doors = below ? doorsBelow(t, court) : doorsAbove(t, court);
    if (!doors) return;
    out.push({ key: court, kind: 'lift', theta: c.theta, s: c.s, h: 0, at: doors.at, below, speed: 0, doing: 'hum', began: 0 });
  });
  return out;
}
