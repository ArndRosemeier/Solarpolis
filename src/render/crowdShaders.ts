/**
 * How a stand-in moves and what it wears (the CROWD kind, materials.ts; the body is gen/standIn.ts). Each instance is a
 * person: their foot, height, width, which way they face, their stride and pose, and the colours of what they wear.
 * The vertex is swung about its joints (the gait: legs from the hips with the knee bending as the leg comes through,
 * arms against the legs) or folded into a pose (kneeling, lying on the back), scaled to the person and stood up along
 * their up (toward the axis), like a plant (`plantFrame`).
 */
import { attribute, cos, float, floor, max, mod, normalize, pow, select, sin, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { JOINT, LIMB, POSE, SLOT } from '../gen/standIn';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The swing of the thighs while walking (rad), how far the knee bends as the leg comes through, the arms' swing. */
const STRIDE = 0.42;
const KNEE = 0.75;
const ARMS = 0.55;
/** The elbows' bend: standing, and more while walking. */
const ELBOW = 0.12;
const ELBOW_WALKING = 0.35;

/** Turn d (a vector from a pivot, or a direction) about the body's left axis: positive swings a hanging limb forward (+z). */
function swing(d: V3, a: F): V3 {
  const c = cos(a), s = sin(a);
  return vec3(d.x, d.y.mul(c).add(d.z.mul(s)), d.z.mul(c).sub(d.y.mul(s)));
}

/** A point turned about a pivot (y, z) by a. */
function about(p: V3, py: number | F, pz: number | F, a: F): V3 {
  const pivot = vec3(0, py, pz);
  return swing(p.sub(pivot), a).add(pivot);
}

/** An sRGB colour packed in a float (gen/standIn.ts `packColor`), linear. */
function unpack(v: F): V3 {
  const r = mod(v, 256), g = mod(floor(v.div(256)), 256), b = floor(v.div(65536));
  return pow(vec3(r, g, b).div(255), vec3(2.2));
}

/**
 * The stand-in's vertex in its own frame (height 1, before scaling): position and normal, posed; and its colour.
 * `clock` is the renderer's time (s): only the stride's look follows it, nothing the simulation knows.
 */
export function standInPose(clock: F): { local: V3; normal: V3; color: V3; width: F; height: F } {
  const part = attribute<'vec2'>('part', 'vec2');
  const stand = attribute<'vec4'>('stand', 'vec4'), gait = attribute<'vec4'>('gait', 'vec4');
  const light = attribute<'vec4'>('light', 'vec4'), wear = attribute<'vec4'>('wear', 'vec4'), feet = attribute<'vec4'>('feet', 'vec4');
  const limb = part.y, slot = part.x;
  const phase = gait.y.add(clock.mul(gait.z)), walking = select(gait.z.greaterThan(0), float(1), float(0));
  const pose = gait.w;
  const kneel = select(pose.equal(POSE.kneel), float(1), float(0)), lie = select(pose.equal(POSE.lie), float(1), float(0));

  const is = (k: number): F => select(limb.equal(k), float(1), float(0));
  const left = is(LIMB.thighL).add(is(LIMB.shinL)).add(is(LIMB.armR)).add(is(LIMB.forearmR));
  const sgn = left.mul(2).sub(1);
  const leg = is(LIMB.thighL).add(is(LIMB.shinL)).add(is(LIMB.thighR)).add(is(LIMB.shinR));
  const shin = is(LIMB.shinL).add(is(LIMB.shinR));
  const arm = is(LIMB.armL).add(is(LIMB.forearmL)).add(is(LIMB.armR)).add(is(LIMB.forearmR));
  const forearm = is(LIMB.forearmL).add(is(LIMB.forearmR));

  // The gait: one leg forward as the other goes back; the knee bends while its leg swings through (sin rising).
  const s = sin(phase).mul(sgn), rising = max(cos(phase).mul(sgn), 0);
  const thigh = s.mul(STRIDE).mul(walking).mul(float(1).sub(kneel));
  const knee = rising.mul(KNEE * STRIDE).mul(walking).mul(float(1).sub(kneel)).add(kneel.mul(Math.PI / 2));
  const shoulderSwing = s.negate().mul(ARMS * STRIDE).mul(walking).add(kneel.mul(0.5));
  const elbowBend = walking.mul(ELBOW_WALKING - ELBOW).add(ELBOW);

  const p0 = attribute<'vec3'>('position', 'vec3'), n0 = attribute<'vec3'>('normal', 'vec3');
  // Legs: the shin bends back at the knee (a negative swing), then the whole leg swings at the hip.
  const kneed = select(shin.greaterThan(0), about(p0, JOINT.knee.y, 0, knee.negate()), p0);
  const kneedN = select(shin.greaterThan(0), swing(n0, knee.negate()), n0);
  const legP = about(kneed, JOINT.hip.y, 0, thigh), legN = swing(kneedN, thigh);
  // Arms: the forearm bends forward at the elbow, then the arm swings at the shoulder.
  const elbowed = select(forearm.greaterThan(0), about(p0, JOINT.elbow.y, 0, elbowBend), p0);
  const elbowedN = select(forearm.greaterThan(0), swing(n0, elbowBend), n0);
  const armP = about(elbowed, JOINT.shoulder.y, 0, shoulderSwing), armN = swing(elbowedN, shoulderSwing);
  let p: V3 = select(leg.greaterThan(0), legP, select(arm.greaterThan(0), armP, p0));
  let n: V3 = select(leg.greaterThan(0), legN, select(arm.greaterThan(0), armN, n0));
  // Kneeling: down onto the knees. Lying: laid back about the heels, onto the back, a body's depth up.
  p = p.sub(vec3(0, kneel.mul(JOINT.knee.y - 0.03), 0));
  const laid = swing(p, float(Math.PI / 2)).add(vec3(0, 0.06, 0.06));
  p = select(lie.greaterThan(0), laid, p);
  n = select(lie.greaterThan(0), swing(n, float(Math.PI / 2)), n);

  const pick = (k: number, c: F, rest: V3): V3 => select(slot.equal(k), unpack(c), rest);
  const color = pick(SLOT.skin, light.w, pick(SLOT.hair, wear.x, pick(SLOT.top, wear.y, pick(SLOT.sleeve, wear.z, pick(SLOT.bottom, wear.w, pick(SLOT.shin, feet.x, unpack(feet.y)))))));
  return { local: p, normal: normalize(n), color, width: light.x, height: stand.w };
}

/** The instance's horizon angles, for its light (as a plant cell's). */
export const standInHorizon = (): Node<'vec2'> => vec2(attribute<'vec4'>('light', 'vec4').y, attribute<'vec4'>('light', 'vec4').z);
