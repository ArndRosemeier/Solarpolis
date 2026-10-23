/**
 * How a drone moves on its own (the DRONE and DRONE_VEIL kinds, materials.ts; its design: gen/drone.ts): rotors spin
 * about their hubs, strobes flash, the body bobs while it hovers, and the whole drone pitches into its way and rolls,
 * about its body. Each instance is a drone: where its ground point is, which way it faces, its tilt, whether its rotors
 * run, its own phase, its design's bob and body height, and the light where it is (render/fliers.ts writes them).
 */
import { attribute, cos, float, floor, fract, max, normalLocal, positionLocal, select, sin, time, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec3 } from '../blueprint';
import { STROBE_CODE } from '../gen/drone';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Floats per drone, in four vec4 attributes: where and which way; tilt, rotors, phase; bob and body; light. */
export const FLIER_STRIDE = 16;
export const FLIER_ATTRIBUTES = ['flier', 'flierMove', 'flierBody', 'flierSky'] as const;

/** How long a strobe's flash lasts, as a share of its period (Actors' clips: two frames of thirty a second). */
const STROBE_DUTY = 0.07;

/** One drone's instance (`FLIER_STRIDE` floats at `o`). */
export interface FlierInstance {
  /** Its ground point relative to the eye (m), and its turn about its up (as the stand-ins', render/people.ts). */
  at: Vec3;
  turn: number;
  /** Nose down (rad) and roll to its right (rad). */
  pitch: number;
  roll: number;
  /** Its rotors run and its body bobs (1), or it rests (0). */
  running: number;
  /** Its own offset in time (s), so no two spin and flash together. */
  phase: number;
  /** Its design's bob (m, s) and its body's height over its ground point (m): what it pitches and rolls about. */
  bob: readonly [number, number];
  body: number;
  /** The terrain's horizons where it is (its light). */
  horizon: readonly [number, number];
}

export function writeFlier(d: Float32Array, o: number, f: FlierInstance): void {
  d[o] = f.at[0]; d[o + 1] = f.at[1]; d[o + 2] = f.at[2]; d[o + 3] = f.turn;
  d[o + 4] = f.pitch; d[o + 5] = f.roll; d[o + 6] = f.running; d[o + 7] = f.phase;
  d[o + 8] = f.bob[0]; d[o + 9] = f.bob[1]; d[o + 10] = f.body; d[o + 11] = 0;
  d[o + 12] = f.horizon[0]; d[o + 13] = f.horizon[1]; d[o + 14] = 0; d[o + 15] = 0;
}

/** Turn v about the drone's up (y) by a. */
export const spun = (v: V3, a: F): V3 => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };
/** Tilt v nose down by `pitch` (about x), then roll it by `roll` (about z). */
export function tilted(v: V3, pitch: F, roll: F): V3 {
  const cp = cos(pitch), sp = sin(pitch), cr = cos(roll), sr = sin(roll);
  const y = v.y.mul(cp).sub(v.z.mul(sp)), z = v.y.mul(sp).add(v.z.mul(cp));
  return vec3(v.x.mul(cr).sub(y.mul(sr)), v.x.mul(sr).add(y.mul(cr)), z);
}

/**
 * The vertex in the drone's own frame, moved as the drone moves it now: position (its ground point at the origin) and
 * normal; and the instance's ground point (relative to the eye), turn and horizons, for placing and lighting it.
 * Veils (`spinning` false) only bob and tilt.
 */
export function flierPose(spinning: boolean): { local: V3; normal: V3; at: V3; turn: F; horizon: Node<'vec2'> } {
  const inst = attribute<'vec4'>('flier', 'vec4'), move = attribute<'vec4'>('flierMove', 'vec4');
  const body = attribute<'vec4'>('flierBody', 'vec4'), sky = attribute<'vec4'>('flierSky', 'vec4');
  const t = time.add(move.w), running = move.z;
  let p: V3 = positionLocal, n: V3 = normalLocal;
  if (spinning) {
    const spin = attribute<'vec4'>('spin', 'vec4'), hub = spin.xyz, w = spin.w, rel = positionLocal.sub(hub);
    const strobe = w.lessThan(-STROBE_CODE + 0.5);
    // A strobe: w = −(code + period in hundredths + phase); it shows for a share of each period, else it shrinks away.
    const code = w.negate().sub(STROBE_CODE), period = max(floor(code).div(100), 0.01), lit = fract(t.div(period).sub(fract(code))).lessThan(STROBE_DUTY);
    const turned = spun(rel, w.mul(t).mul(running));
    p = select(strobe, hub.add(rel.mul(select(lit, float(1), float(0.001)))), hub.add(turned));
    n = select(strobe, normalLocal, spun(normalLocal, w.mul(t).mul(running)));
  }
  // The bob, and the tilt about the body.
  const pivot = vec3(0, body.z, 0);
  const bobbed = p.add(vec3(0, body.x.mul(sin(t.mul(2 * Math.PI).div(max(body.y, 0.1)))).mul(running), 0));
  return { local: tilted(bobbed.sub(pivot), move.x, move.y).add(pivot), normal: tilted(n, move.x, move.y), at: inst.xyz, turn: inst.w, horizon: sky.xy };
}
