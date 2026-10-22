/**
 * How a stand-in moves and what it wears (the CROWD kind, materials.ts; the body is gen/standIn.ts). Each instance is a
 * person: their foot, height, width, which way they face, their stride and pose, and the colours of what they wear.
 * The vertex is swung about its joints (the gait: legs from the hips with the knee bending as the leg comes through,
 * arms against the legs) or folded into a pose (kneeling, lying on the back), scaled to the person and stood up along
 * their up (toward the axis), like a plant (`plantFrame`).
 */
import { attribute, cameraProjectionMatrix, cameraViewMatrix, cos, dot, float, floor, length, max, min, mix, mod, normalize, pow, screenSize, select, sin, smoothstep, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { BODY_DEPTH, BODY_FILL, BODY_WIDTH, JOINT, LIMB, NECK, POSE, SLOT, SPECK_SHOWN, WAIST } from '../gen/standIn';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/** The swing of the thighs while walking (rad), how far the knee bends as the leg comes through, the arms' swing. */
const STRIDE = 0.42;
const KNEE = 0.75;
const ARMS = 0.55;
/** Kneeling, the body drops onto its knees: by the knee's height, less the knee's own thickness (at height 1). */
const KNEEL_DROP = 0.03;
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
  p = p.sub(vec3(0, kneel.mul(JOINT.knee.y - KNEEL_DROP), 0));
  const laid = swing(p, float(Math.PI / 2)).add(vec3(0, 0.06, 0.06));
  p = select(lie.greaterThan(0), laid, p);
  n = select(lie.greaterThan(0), swing(n, float(Math.PI / 2)), n);

  const pick = (k: number, c: F, rest: V3): V3 => select(slot.equal(k), unpack(c), rest);
  const color = pick(SLOT.skin, light.w, pick(SLOT.hair, wear.x, pick(SLOT.top, wear.y, pick(SLOT.sleeve, wear.z, pick(SLOT.bottom, wear.w, pick(SLOT.shin, feet.x, unpack(feet.y)))))));
  return { local: p, normal: normalize(n), color, width: light.x, height: stand.w };
}

/** The instance's horizon angles, for its light (as a plant cell's). */
export const standInHorizon = (): Node<'vec2'> => vec2(attribute<'vec4'>('light', 'vec4').y, attribute<'vec4'>('light', 'vec4').z);

/** Seconds since the far specks' list was made (render/specks.ts sets it each frame): walkers are carried on by it. */
export const speckClock = uniform(0);

/**
 * How specks are shown (debug menu): 0 as they look, 1 marked (bright, at least `MARKED_PX` across, opaque) so a
 * picture shows where everyone is, 2 hidden.
 */
export const speckMark = uniform(0);
const MARKED_PX = 4;

/** The smallest a speck is drawn across (px): below it, it is drawn this big and as faint as it is small. */
const SPECK_MIN_PX = 1.5;
/**
 * A speck this tall (px) or more fades out: the stand-ins draw anyone that close (render/people.ts hands over at about
 * 3 px), so only someone the near levels have not placed yet (new to the area) could be drawn this big by a speck.
 */
const SPECK_FADE_PX: [number, number] = [6, 10];

/**
 * A speck (gen/standIn.ts `SPECK_STRIDE`): someone drawn as the patch of screen their body covers. The quad stands along
 * the person's up as the screen sees it, as tall and wide as the body there (its depth when seen from above), never
 * under `SPECK_MIN_PX`; what a smaller body covers of it is its opacity, so one far person is faint and a crowd adds
 * up to the tint it makes. From a few pixels tall it is banded like the stand-in it hands over to: head, top, bottom.
 */
export function speckLook(eye: V3): { position: V3; clip: V4; color: V3; opacity: F; horizon: V2; normal: V3 } {
  const foot = attribute<'vec4'>('speckFoot', 'vec4'), drift = attribute<'vec4'>('speckDrift', 'vec4');
  const tint = attribute<'vec4'>('speckTint', 'vec4'), sky = attribute<'vec4'>('speckSky', 'vec4');
  const corner = attribute<'vec2'>('corner', 'vec2'), shown = attribute<'float'>(SPECK_SHOWN, 'float');
  const world = foot.xyz.add(drift.xyz.mul(speckClock));
  const up = normalize(vec3(world.x.negate(), world.y.negate(), 0));
  const H = foot.w, pose = drift.w;
  const lie = select(pose.equal(POSE.lie), float(1), float(0)), kneel = select(pose.equal(POSE.kneel), float(1), float(0));
  // The body's box: up its height (kneeling lower, lying a body's depth), across its width (lying, its height).
  const tall = H.mul(mix(mix(float(1), float(1 - (JOINT.knee.y - KNEEL_DROP)), kneel), float(BODY_DEPTH), lie));
  const wide = H.mul(mix(float(BODY_WIDTH).mul(sky.z), float(1), lie));
  const centre = world.sub(eye).add(up.mul(tall.mul(0.5)));
  const toScreen = (p: V3): V4 => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1));
  const clip = toScreen(centre), top = toScreen(centre.add(up.mul(tall.mul(0.5))));
  const px = (c: V4): V2 => c.xy.div(c.w).mul(screenSize).mul(0.5);
  const rise = px(top).sub(px(clip)), riseLen = length(rise);
  const along = select(riseLen.greaterThan(1e-4), rise.div(max(riseLen, 1e-4)), vec2(0, 1)), across = vec2(along.y, along.x.negate());
  // Pixels per metre at the body: the projection's scale over the depth.
  const scale = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y.mul(screenSize.y).mul(0.5).div(clip.w);
  const pxTall = max(riseLen.mul(2), H.mul(BODY_DEPTH).mul(scale)), pxWide = wide.mul(scale);
  const least = mix(float(SPECK_MIN_PX), float(MARKED_PX), min(speckMark, 1));
  const qTall = max(pxTall, least), qWide = max(pxWide, least);
  const offset = along.mul(corner.y.mul(qTall).mul(0.5)).add(across.mul(corner.x.mul(qWide).mul(0.5)));
  const moved = clip.xy.add(offset.div(screenSize).mul(2).mul(clip.w));
  // Not shown (a nearer level draws them): the quad is put outside the view, so it is not drawn at all.
  const shifted = select(shown.greaterThan(0.5), vec4(moved.x, moved.y, clip.z, clip.w), vec4(0, 0, 2, 1));
  const faded = float(1).sub(smoothstep(SPECK_FADE_PX[0], SPECK_FADE_PX[1], pxTall));
  const cover = select(speckMark.greaterThan(1.5), float(0), select(speckMark.greaterThan(0.5), float(1), pxTall.mul(pxWide).mul(BODY_FILL).div(qTall.mul(qWide))));
  const opacity = varying(cover.mul(faded));
  // Colours: the bands up the body where it is a few pixels tall, their mean where it is less.
  const head = unpack(tint.x), shirt = unpack(tint.y), legs = unpack(tint.z);
  const mean = head.mul(1 - NECK).add(shirt.mul(NECK - WAIST)).add(legs.mul(WAIST));
  const f = varying(corner.y.mul(0.5).add(0.5));
  const band = select(f.greaterThan(NECK), head, select(f.greaterThan(WAIST), shirt, legs));
  const banded = varying(smoothstep(2, 4, pxTall).mul(float(1).sub(lie)));
  const color = mix(mix(varying(mean), band, banded), vec3(1, 0, 1), min(speckMark, 1));
  // Lit facing the eye, as the stand-in's front is.
  const toEye = normalize(centre.negate()), normal = normalize(toEye.sub(up.mul(dot(toEye, up))));
  return { position: centre, clip: shifted, color, opacity, horizon: varying(sky.xy), normal: varying(normal) };
}
