/**
 * Getting into a vehicle and out of it (Arnd 2026-10-23: "this needs to introduce mounting a vehicle and i hope we can
 * do this right"): the passenger's body walks to the door, steps up into it, goes to its seat, turns and sits down;
 * and back: stands up, walks to the door and steps down outside. All in the vehicle's own frame, so the vehicle may sit
 * on the ground or hang in the air while it happens; the view puts its feet into the world through the vehicle's
 * place. Timed by the real seconds of the clips the body plays (render/people.ts plays the same ones on the courts'
 * seats). Pure.
 */
import { smoothstep, v3madd, v3sub, type Vec3 } from '@futuremagic/core';
import { apart } from '../blueprint';
import { EYE_HEIGHT } from './walker';

/**
 * A seat: where one's hips rest on it, on the floor under them (the body's place while seated: the sitting clips keep
 * the hips over it), and the way one faces (the vehicle's frame, m and unit).
 */
export interface Seat {
  hips: Vec3;
  front: Vec3;
}

/** Where one stands to sit down on a seat (and stands after getting up): `SIT_BACK` in front of where the hips rest. */
export const sitFrom = (seat: Seat): Vec3 => v3madd(seat.hips, seat.front, SIT_BACK);

/** A door: the doorway's middle on the floor inside, a step out from it on the ground, and the way out (unit). */
export interface Door {
  inside: Vec3;
  outside: Vec3;
  out: Vec3;
}

/** How the body holds itself in a step: walking, standing, sitting down (a clip played through), seated, standing up. */
export type Posture = 'walk' | 'stand' | 'sitDown' | 'sit' | 'standUp';

/** One step of getting in or out: from where to where (feet, vehicle frame), facing from and to, how long it takes (s). */
export interface MountStep {
  posture: Posture;
  from: Vec3;
  to: Vec3;
  faceFrom: Vec3;
  faceTo: Vec3;
  seconds: number;
}

/** The body at a moment of getting in or out: its feet and the way it faces (vehicle frame), its posture and how far into it, its eyes' height over its feet and how far behind them (m). */
export interface MountPose {
  feet: Vec3;
  front: Vec3;
  posture: Posture;
  share: number;
  eye: number;
  back: number;
  /** Walking speed (m/s), for the stride's pace. */
  speed: number;
  done: boolean;
}

/** The clips' lengths (s): sitting down onto a seat, standing up from it (Actors' pack, as render/people.ts plays them). */
export const SIT_DOWN = 1.33;
export const STAND_UP = 1.07;
/**
 * The sitting clips (Actors' pack): sitting down carries the hips this far back of where one stood (m; standing up
 * carries them as far forward), and seated they are over the body's place. Seated, the eyes are this high over the
 * floor and this far in front of the hips (m).
 */
export const SIT_BACK = 0.272;
export const SEATED_EYE = 1.22;
export const SEATED_AHEAD = 0.1;
/** Turning round in front of a seat to sit (s), and how much slower one steps up into a doorway than one walks. */
const TURN = 0.6;
const STEP_UP = 1.4;

/** The way from a to b over the floor (the vehicle's z is its up), or `or` where they are one above the other. */
function flatWay(a: Vec3, b: Vec3, or: Vec3): Vec3 {
  const d = v3sub(b, a), k = Math.hypot(d[0], d[1]);
  return k > 1e-6 ? [d[0] / k, d[1] / k, 0] : or;
}

/** Walking from a to b at `walk` m/s, facing the way (slower by `slow`). */
function walking(a: Vec3, b: Vec3, walk: number, face: Vec3, slow = 1): MountStep {
  const f = flatWay(a, b, face);
  return { posture: 'walk', from: a, to: b, faceFrom: f, faceTo: f, seconds: Math.max(0.2, (apart(a, b) / walk) * slow) };
}

/**
 * Getting in: from where one stands (vehicle frame) round by `via` (points to walk by, clear of the vehicle) to the door
 * outside, up into the doorway, to the seat, turning round, sitting down.
 */
export function boarding(seat: Seat, door: Door, start: Vec3, walk: number, via: readonly Vec3[] = []): MountStep[] {
  const inward: Vec3 = [-door.out[0], -door.out[1], -door.out[2]];
  const legs = [start, ...via, door.outside].slice(1).map((to, i, all) => walking(i ? all[i - 1] : start, to, walk, inward));
  const stepIn = walking(door.outside, door.inside, walk, inward, STEP_UP);
  const stand = sitFrom(seat), toSeat = walking(door.inside, stand, walk, seat.front);
  return [
    ...legs, stepIn, toSeat,
    { posture: 'stand', from: stand, to: stand, faceFrom: toSeat.faceTo, faceTo: seat.front, seconds: TURN },
    { posture: 'sitDown', from: stand, to: stand, faceFrom: seat.front, faceTo: seat.front, seconds: SIT_DOWN },
  ];
}

/** Getting out: standing up from the seat, to the doorway, stepping down out of it, then facing out. */
export function alighting(seat: Seat, door: Door, walk: number): MountStep[] {
  const stand = sitFrom(seat), toDoor = walking(stand, door.inside, walk, door.out), stepOut = walking(door.inside, door.outside, walk, door.out, STEP_UP);
  return [
    { posture: 'standUp', from: stand, to: stand, faceFrom: seat.front, faceTo: seat.front, seconds: STAND_UP },
    toDoor, stepOut,
    { posture: 'stand', from: door.outside, to: door.outside, faceFrom: stepOut.faceTo, faceTo: door.out, seconds: TURN / 2 },
  ];
}

/** How long a list of steps takes (s). */
export const stepsSeconds = (steps: readonly MountStep[]): number => steps.reduce((n, s) => n + s.seconds, 0);

/**
 * The body `elapsed` s into a list of steps: walking eases in and out of each stretch; sitting down lowers the eyes
 * from standing height to the seat's as the clip goes, standing up raises them. After the last step it holds it
 * (seated, if it ended sitting down).
 */
export function mountPose(steps: readonly MountStep[], elapsed: number): MountPose {
  let t = Math.max(0, elapsed);
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k], last = k === steps.length - 1;
    if (t > s.seconds && !last) { t -= s.seconds; continue; }
    const share = Math.min(1, t / s.seconds), done = last && t >= s.seconds;
    const e = s.posture === 'walk' ? smoothstep(0, 1, share) : share;
    const feet = [0, 1, 2].map((i) => s.from[i] + (s.to[i] - s.from[i]) * e) as Vec3;
    // Turning about the vehicle's up, the shorter way round (half a turn in front of a seat).
    const a0 = Math.atan2(s.faceFrom[1], s.faceFrom[0]);
    let da = Math.atan2(s.faceTo[1], s.faceTo[0]) - a0;
    da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
    const a = a0 + da * smoothstep(0, 1, share), front: Vec3 = [Math.cos(a), Math.sin(a), 0];
    const seated = s.posture === 'sitDown' ? smoothstep(0.15, 0.9, share) : s.posture === 'standUp' ? 1 - smoothstep(0.1, 0.85, share) : 0;
    const posture: Posture = done && s.posture === 'sitDown' ? 'sit' : done && s.posture !== 'standUp' ? 'stand' : s.posture;
    const speed = s.posture === 'walk' && !done ? apart(s.from, s.to) / s.seconds : 0;
    const eye = EYE_HEIGHT + (SEATED_EYE - EYE_HEIGHT) * seated;
    // Sitting down the clip carries the hips back from where one stands; seated (and standing up) the body's place is
    // under the hips, the clip carrying them forward again. The eyes go with the hips.
    if (posture === 'sit' || posture === 'standUp') {
      const hips = v3madd(feet, front, -SIT_BACK);
      return { feet: hips, front, posture, share, eye, back: -(SEATED_AHEAD * seated + SIT_BACK * (1 - seated)), speed, done };
    }
    return { feet, front, posture, share, eye, back: (SIT_BACK - SEATED_AHEAD) * seated, speed, done };
  }
  return { feet: [0, 0, 0], front: [1, 0, 0], posture: 'stand', share: 1, eye: EYE_HEIGHT, back: 0, speed: 0, done: true };
}

/** Seated (held after getting in). */
export function seatedPose(seat: Seat): MountPose {
  return { feet: seat.hips, front: seat.front, posture: 'sit', share: 1, eye: SEATED_EYE, back: -SEATED_AHEAD, speed: 0, done: true };
}
