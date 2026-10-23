/**
 * How a boat moves on its own (the BOAT and BOAT_WAKE kinds, materials.ts; its design: gen/boat.ts): its wing turns
 * about its mast to the wind, the whole boat heels and pitches about its waterline and rocks a little on the ripples,
 * a foiler rises on its foils; its wake stays flat on the water and stretches out behind it with its speed. Each
 * instance is a boat: where its waterline point is, which way it faces, its heel and trim, its wing's turn, how high
 * it flies, its livery, its speed, and the light where it is (render/boats.ts writes them).
 */
import { attribute, float, normalLocal, positionLocal, select, sin, time, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec3 } from '../blueprint';
import { spun, tilted } from './droneShaders';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Floats per boat, in four vec4 attributes: where and which way; trim, heel, wing, lift; livery and wake; light, phase, speed. */
export const BOAT_STRIDE = 16;
export const BOAT_ATTRIBUTES = ['boat', 'boatMove', 'boatLook', 'boatSky'] as const;

/** How far a boat rocks on the ripples (rad, about its length and across it), and how quickly (rad/s). */
const ROCK = { roll: 0.012, pitch: 0.006, rollRate: 1.1, pitchRate: 0.83 };
/** The wake at rest is this share of its length at full speed. */
const WAKE_REST = 0.2;

/** One boat's instance (`BOAT_STRIDE` floats at `o`). */
export interface BoatInstance {
  /** Its waterline point relative to the eye (m), and its turn about its up (as the stand-ins', render/people.ts). */
  at: Vec3;
  turn: number;
  /** Bow down (rad), heel to starboard (rad), its wing's turn about the mast (rad, as `turn`), how high it flies (m). */
  pitch: number;
  roll: number;
  wing: number;
  lift: number;
  /** Its hull's colour (linear) and how much its wake foams (0 … 1). */
  livery: Vec3;
  foam: number;
  /** The terrain's horizons where it is (its light), its own offset in time (s), its speed as a share of its top. */
  horizon: readonly [number, number];
  phase: number;
  speed: number;
}

export function writeBoat(d: Float32Array, o: number, b: BoatInstance): void {
  d[o] = b.at[0]; d[o + 1] = b.at[1]; d[o + 2] = b.at[2]; d[o + 3] = b.turn;
  d[o + 4] = b.pitch; d[o + 5] = b.roll; d[o + 6] = b.wing; d[o + 7] = b.lift;
  d[o + 8] = b.livery[0]; d[o + 9] = b.livery[1]; d[o + 10] = b.livery[2]; d[o + 11] = b.foam;
  d[o + 12] = b.horizon[0]; d[o + 13] = b.horizon[1]; d[o + 14] = b.phase; d[o + 15] = b.speed;
}

/** What both kinds read of a boat's instance. */
function instance() {
  const inst = attribute<'vec4'>('boat', 'vec4'), move = attribute<'vec4'>('boatMove', 'vec4');
  const look = attribute<'vec4'>('boatLook', 'vec4'), sky = attribute<'vec4'>('boatSky', 'vec4');
  return { at: inst.xyz, turn: inst.w, move, livery: look.xyz, foam: look.w, horizon: sky.xy, phase: sky.z, speed: sky.w };
}

/**
 * A boat's vertex in its own frame, moved as the boat moves it now: the wing turned about its mast (`rig`: x, z of the
 * mast; part 1), then all of it heeled, trimmed and rocked about its waterline and lifted on its foils; and the
 * instance's waterline point (relative to the eye), turn, livery and horizons, for placing and lighting it.
 */
export function boatPose(): { local: V3; normal: V3; at: V3; turn: F; livery: V3; horizon: Node<'vec2'> } {
  const b = instance(), rig = attribute<'vec4'>('rig', 'vec4');
  const wing = rig.z.greaterThan(0.5), hub = vec3(rig.x, 0, rig.y);
  const p = select(wing, hub.add(spun(positionLocal.sub(hub), b.move.z)), positionLocal);
  const n = select(wing, spun(normalLocal, b.move.z), normalLocal);
  const t = time.add(b.phase);
  const roll = b.move.y.add(sin(t.mul(ROCK.rollRate)).mul(ROCK.roll)), pitch = b.move.x.add(sin(t.mul(ROCK.pitchRate).add(b.phase.mul(1.7))).mul(ROCK.pitch));
  return { local: tilted(p, pitch, roll).add(vec3(0, b.move.w, 0)), normal: tilted(n, pitch, roll), at: b.at, turn: b.turn, livery: b.livery, horizon: b.horizon };
}

/**
 * A wake's vertex: flat on the water, stretched out from where it leaves the hull (`rig` x, z) with the boat's speed;
 * how far along it is (0 at the hull, 1 at its end), how much the boat foams, and the instance's place and light.
 */
export function wakePose(): { local: V3; at: V3; turn: F; along: F; foam: F; horizon: Node<'vec2'> } {
  const b = instance(), rig = attribute<'vec4'>('rig', 'vec4'), anchor = vec3(rig.x, 0, rig.y);
  const stretch = float(WAKE_REST).add(b.speed.mul(1 - WAKE_REST));
  return { local: anchor.add(positionLocal.sub(anchor).mul(vec3(stretch, 1, stretch))), at: b.at, turn: b.turn, along: rig.w, foam: b.foam, horizon: b.horizon };
}
