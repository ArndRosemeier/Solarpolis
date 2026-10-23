/**
 * How a bird moves and looks (the BIRD kind, materials.ts; its body: gen/birds.ts; where it is and how it flies:
 * sim/birds.ts, written per instance by render/birds.ts). Each vertex moves by the part it is on (gen/birds.ts `part`,
 * `fiber`, `folded`): the wings beat about the shoulder with the hand lagging the arm (Scale's flap,
 * src/fauna/webgpu/creatures.ts) and fold back along the body; the tail fans; the jaw drops while it sings; the legs
 * tuck back in flight; the head turns and nods about the neck. Its colour is its look's for the zone the vertex is in,
 * with the species' pattern over it drawn per pixel (spots, bars, streaks, mottle), fading into its mean where it is
 * finer than a pixel.
 */
import { abs, attribute, cos, cross, float, floor, fwidth, length, mix, mx_noise_float, normalLocal, normalize, positionLocal, select, sign, sin, smoothstep, varying, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vec3 } from '../blueprint';
import { GLOSS_PACK, PATTERN, WING, ZONE, type PackedLook } from '../gen/birds';
import { unpack } from './crowdShaders';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Floats per bird, in eight vec4 attributes: where and how long; forward and fold; up and wingbeat phase; wings; head and light; its look (three). */
export const BIRD_STRIDE = 32;
export const BIRD_ATTRIBUTES = ['bird', 'birdFwd', 'birdUp', 'birdWing', 'birdHead', 'birdCoat', 'birdFront', 'birdBits'] as const;

/** One bird's instance (`BIRD_STRIDE` floats at `o`). */
export interface BirdInstance {
  /** Its origin relative to the eye (m) and its length (m: the body's scale). */
  at: Vec3;
  length: number;
  /** Its forward and up (unit, world). */
  fwd: Vec3;
  up: Vec3;
  /** Wings folded (1) or open; the wingbeat's phase (rad); how far they beat and are held up (rad); the tail fanned (0 … 1). */
  fold: number;
  phase: number;
  amp: number;
  bias: number;
  spread: number;
  /** The beak open (0 … 1), the head turned left and down (rad), the legs tucked (0 … 1). */
  gape: number;
  yaw: number;
  nod: number;
  tuck: number;
  /** The terrain's horizons where it is (its light). */
  horizon: readonly [number, number];
  look: PackedLook;
}

export function writeBird(d: Float32Array, o: number, b: BirdInstance): void {
  d[o] = b.at[0]; d[o + 1] = b.at[1]; d[o + 2] = b.at[2]; d[o + 3] = b.length;
  d[o + 4] = b.fwd[0]; d[o + 5] = b.fwd[1]; d[o + 6] = b.fwd[2]; d[o + 7] = b.fold;
  d[o + 8] = b.up[0]; d[o + 9] = b.up[1]; d[o + 10] = b.up[2]; d[o + 11] = b.phase;
  d[o + 12] = b.amp; d[o + 13] = b.bias; d[o + 14] = b.spread; d[o + 15] = b.gape;
  d[o + 16] = b.yaw; d[o + 17] = b.nod; d[o + 18] = b.horizon[0]; d[o + 19] = b.horizon[1];
  d.set(b.look.coat, o + 20);
  d.set(b.look.front, o + 24);
  d[o + 28] = b.look.bits[0]; d[o + 29] = b.look.bits[1]; d[o + 30] = b.look.bits[2]; d[o + 31] = b.tuck;
}

/** (a, b) turned by angle t (a toward b). */
const turned = (a: F, b: F, t: F): [F, F] => {
  const c = cos(t), s = sin(t);
  return [a.mul(c).sub(b.mul(s)), a.mul(s).add(b.mul(c))];
};

/** A point's (y, z) turned about the hinge (hy, hz) by t (forward points go down for t > 0). */
function hinged(p: V3, hy: F, hz: F, t: F): V3 {
  const [z, y] = turned(p.z.sub(hz), p.y.sub(hy), t.negate());
  return vec3(p.x, y.add(hy), z.add(hz));
}

/** A point's (x, z) turned about the axis through (·, ·, hz) up, by t (forward points go to the left, +x, for t > 0). */
function yawed(p: V3, hz: F, t: F): V3 {
  const [z, x] = turned(p.z.sub(hz), p.x, t);
  return vec3(x, p.y, z.add(hz));
}

/** Whether a float zone is z. */
const isZone = (zone: F, z: number): Node<'bool'> => abs(zone.sub(z)).lessThan(0.5);

/**
 * The vertex posed: its position (relative to the eye, world), its normal (world), its colour (linear, per vertex),
 * its rest place on the body (for the pattern), how much of the species' pattern it carries, the pattern, and the
 * light where the bird is.
 */
export function birdPose(): { position: V3; normal: V3; albedo: V3; rest: V3; where: F; pattern: F; dark: V3; light: V3; horizon: V2; gloss: F } {
  const inst = attribute<'vec4'>('bird', 'vec4'), fw = attribute<'vec4'>('birdFwd', 'vec4'), upA = attribute<'vec4'>('birdUp', 'vec4');
  const wingA = attribute<'vec4'>('birdWing', 'vec4'), head = attribute<'vec4'>('birdHead', 'vec4');
  const coat = attribute<'vec4'>('birdCoat', 'vec4'), front = attribute<'vec4'>('birdFront', 'vec4'), bits = attribute<'vec4'>('birdBits', 'vec4');
  const part = attribute<'vec4'>('birdPart', 'vec4'), fiber = attribute<'vec4'>('birdFiber', 'vec4'), folded = attribute<'vec3'>('birdFolded', 'vec3');
  const onWing = part.x.greaterThan(WING - 0.5), zone = select(onWing, part.x.sub(WING), part.x);
  const fold = fw.w, phase = upA.w, amp = wingA.x, bias = wingA.y, spread = wingA.z, gape = wingA.w;
  let p: V3 = positionLocal, n: V3 = normalLocal;

  // The wings: the arm turned up by th about the shoulder, the hand by th2 about the elbow (Scale's flap: the hand lags).
  const side = sign(p.x), ax = abs(p.x), xs = part.y, xe = part.z, ys = part.w;
  const th = amp.mul(sin(phase)).add(bias), th2 = th.add(amp.mul(0.55).mul(sin(phase.sub(0.8)))).sub(bias.mul(0.6));
  const [ex, ey] = turned(xe.sub(xs), float(0), th);
  const [armX, armY] = turned(ax.sub(xs), p.y.sub(ys), th);
  const [handX, handY] = turned(ax.sub(xe), p.y.sub(ys), th2);
  const hand = smoothstep(xe.sub(0.01), xe.add(0.01), ax);
  const wx = mix(armX.add(xs), handX.add(ex).add(xs), hand), wy = mix(armY, handY.add(ey), hand).add(ys);
  // On the downstroke the hand sweeps a little forward.
  const sweep = hand.mul(ax.sub(xe)).mul(amp).mul(0.25).mul(cos(phase).negate().max(0));
  const spreadP = vec3(side.mul(wx), wy, p.z.add(sweep));
  const [nx, ny] = turned(n.x.mul(side), n.y, mix(th, th2, hand));
  const spreadN = vec3(side.mul(nx), ny, n.z);
  const wingP = mix(spreadP, folded, fold), wingN = normalize(mix(spreadN, vec3(side, 0.35, 0), fold));

  // The tail fans about the rump.
  const share = part.y, fan = share.mul(spread).mul(0.6);
  const [tz, tx] = turned(p.z.sub(part.w), p.x, fan.negate());
  const tailP = vec3(tx, p.y, tz.add(part.w));

  // The jaw drops and the upper beak lifts a little while it sings; the legs swing back and up in flight.
  const jawP = hinged(p, part.y, part.z, gape.mul(0.45)), beakP = hinged(p, part.y, part.z, gape.mul(-0.08));
  const tuck = bits.w, legsP = mix(hinged(p, part.y, part.z, tuck.mul(1.3)), vec3(p.x, part.y, part.z), tuck.mul(0.35));

  p = select(onWing, wingP, select(isZone(zone, ZONE.tail), tailP, select(isZone(zone, ZONE.jaw), jawP, select(isZone(zone, ZONE.beak), beakP, select(isZone(zone, ZONE.legs), legsP, p)))));
  n = select(onWing, wingN, n);

  // The head turns about the neck: down by `nod`, then to its left by `yaw`, as far as the vertex goes with it.
  const turn = select(onWing, float(0), fiber.x), nod = head.y.mul(turn), yaw = head.x.mul(turn);
  p = yawed(hinged(p, fiber.y, fiber.z, nod), fiber.z, yaw);
  n = yawed(hinged(n, float(0), float(0), nod), float(0), yaw);

  // Into the world: x to its left, y its up, z its forward; scaled by its length.
  const fwd = normalize(fw.xyz), up = normalize(upA.xyz), left = normalize(cross(up, fwd));
  const world = (v: V3): V3 => left.mul(v.x).add(up.mul(v.y)).add(fwd.mul(v.z));
  const position = inst.xyz.add(world(p).mul(inst.w));

  // Its colour: its look's for the zone (the tail as its back and flight feathers, the jaw a shade darker than the beak).
  const c = (v: F): V3 => unpack(v);
  const tail = mix(c(coat.y), c(coat.w), 0.6);
  const zones: [number, V3][] = [
    [ZONE.crown, c(coat.x)], [ZONE.back, c(coat.y)], [ZONE.face, c(front.x)], [ZONE.breast, c(front.y)], [ZONE.belly, c(front.z)],
    [ZONE.coverts, c(coat.z)], [ZONE.flight, c(coat.w)], [ZONE.tail, tail], [ZONE.beak, c(bits.x)], [ZONE.jaw, c(bits.x).mul(0.8)],
    [ZONE.eye, vec3(0.012, 0.01, 0.009)], [ZONE.legs, c(bits.y)],
  ];
  let albedo: V3 = c(front.w);
  for (const [z, col] of zones) albedo = select(isZone(zone, z), col, albedo);

  // Where its pattern lies: spots and scaling on the breast and belly, bars over wings, tail and flanks, streaks on the
  // back, crown and breast, an owl's mottle and a starling's stars all over, white bars across a woodpecker's flight
  // feathers. The pattern's number carries the look's gloss in its fraction.
  const pattern = floor(bits.z), gloss = bits.z.sub(pattern).div(GLOSS_PACK), under = select(isZone(zone, ZONE.breast).or(isZone(zone, ZONE.belly)), float(1), float(0));
  const winged = select(isZone(zone, ZONE.coverts).or(isZone(zone, ZONE.flight)).or(isZone(zone, ZONE.tail)), float(1), float(0));
  const plumage = select(zone.lessThan(ZONE.beak - 0.5).or(isZone(zone, ZONE.mark)), float(1), float(0));
  const backed = select(zone.lessThan(ZONE.face - 0.5).or(isZone(zone, ZONE.breast)), float(1), float(0));
  const where = select(isZone(pattern, PATTERN.spots).or(isZone(pattern, PATTERN.scaled)), under,
    select(isZone(pattern, PATTERN.bars), max1(winged, under), select(isZone(pattern, PATTERN.streaks), backed,
      select(isZone(pattern, PATTERN.mottle).or(isZone(pattern, PATTERN.starry)), plumage, select(isZone(pattern, PATTERN.barredWings), select(isZone(zone, ZONE.flight), float(1), float(0)), float(0))))));
  // Dark marks in the back's colour deepened; light ones (a woodpecker's bars, an owl's pale flecks) in the belly's, a
  // starling's stars in its mark's.
  const dark = c(coat.y).mul(0.35), light = select(isZone(pattern, PATTERN.starry), c(front.w), c(front.z));
  return {
    position, normal: world(n), albedo: varying(albedo), rest: varying(positionLocal), where: varying(where.mul(plumage)), pattern: varying(pattern),
    dark: varying(dark), light: varying(light), horizon: varying(head.zw), gloss: varying(gloss),
  };
}

const max1 = (a: F, b: F): F => a.max(b);

/**
 * The species' pattern at a point of the body at rest (`rest`, bird units): how much of the dark mark (x) and of the
 * light one (y) it shows. Finer than a pixel, each blends into its mean.
 */
export function birdPattern(rest: V3, pattern: F): V2 {
  const fade = (q: V3 | F, mean: number, t: F): F => mix(t, float(mean), smoothstep(0.35, 0.9, length(fwidth(q as V3))));
  // Thrush's spots: round dark drops on the breast.
  const sq = rest.mul(60), spots = fade(sq, 0.18, smoothstep(0.32, 0.45, mx_noise_float(sq)));
  // Wren's bars: fine dark bars across, a little wavy.
  const bq = rest.z.mul(2 * Math.PI * 32).add(mx_noise_float(rest.mul(25)).mul(1.5)), bars = fade(bq.div(2 * Math.PI), 0.25, smoothstep(0.55, 0.85, sin(bq)));
  // Lark's streaks: drawn out along the body.
  const tq = vec3(rest.x.mul(110), rest.y.mul(110), rest.z.mul(22)), streaks = fade(tq, 0.25, smoothstep(0.2, 0.5, mx_noise_float(tq)));
  // Owl's mottle: dark blotches and pale flecks.
  const mq = rest.mul(45), m = mx_noise_float(mq), mottleDark = fade(mq, 0.3, smoothstep(0.15, 0.45, m)), mottleLight = fade(mq, 0.15, smoothstep(-0.35, -0.6, m));
  // A female blackbird's faint scaling.
  const cq = rest.mul(2 * Math.PI * 30), scaled = fade(cq.div(2 * Math.PI), 0.1, smoothstep(0.6, 0.95, sin(cq.z).mul(sin(cq.x.add(cq.y)))).mul(0.5));
  // A woodpecker's white bars across its flight feathers.
  const wq = rest.z.mul(2 * Math.PI * 22), white = fade(wq.div(2 * Math.PI), 0.35, smoothstep(0.4, 0.75, sin(wq.add(rest.x.mul(40)))));
  // A starling's pale stars: small tips to its feathers, scattered all over.
  const sr = rest.mul(80), stars = fade(sr, 0.12, smoothstep(0.42, 0.58, mx_noise_float(sr)));
  const is = (k: number): Node<'bool'> => isZone(pattern, k);
  const darkShare = select(is(PATTERN.spots), spots, select(is(PATTERN.bars), bars, select(is(PATTERN.streaks), streaks, select(is(PATTERN.mottle), mottleDark, select(is(PATTERN.scaled), scaled, float(0))))));
  const lightShare = select(is(PATTERN.mottle), mottleLight, select(is(PATTERN.barredWings), white, select(is(PATTERN.starry), stars, float(0))));
  return vec2(darkShare, lightShare);
}
