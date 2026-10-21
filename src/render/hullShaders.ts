/**
 * The shader pieces of a habitat seen from outside (design "Solarpolis: the outside", O4): the solar skin's patchwork
 * per pixel, the radiators (endcap faces and brims), and the plain hardware (spindle, berth arms, mast). The kinds that
 * use them live in the material registry (materials.ts); lighting and units as in skyShaders.ts.
 *
 * The skin is the very grid of gen/skin.ts: the same integer hashes (`hash3i` from @futuremagic/core, mirrored here)
 * of the same seed pick each panel's kind, age and shade, so the near view, the far glints and the interior agree.
 * Each habitat's mesh carries its skin in `userData.skin` (`skinUniforms`), read per object, so one material draws
 * every habitat in the ring.
 */
import { Vector4 } from 'three/webgpu';
import {
  abs, atan, clamp, dot, float, floor, fract, fwidth, length, max, min, mix, modelWorldMatrix, normalWorld, normalize,
  positionLocal, positionWorld, pow, select, smoothstep, uint, uniform, vec2, vec3, vec4, vertexColor,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { GLINT_GAIN, GLINT_POWER, LOOK, SALT, type Columns, type Skin } from '../gen/skin';
import { DISPLAY_CAP, outside } from './skyShaders';

/** A habitat's skin as the four vectors its mesh hands the shader (`mesh.userData.skin`). */
export interface SkinUniforms {
  grid: Vector4;
  campaign: Vector4;
  age: Vector4;
  seed: Vector4;
  mean: Vector4;
}

export function skinUniforms(s: Skin, c: Columns): SkinUniforms {
  return {
    grid: new Vector4(s.nTheta, s.nZ, s.z0, s.z1),
    campaign: new Vector4(s.around, s.along, s.collectorQ, s.starfloors),
    age: new Vector4(s.age, s.panelLife, s.roomLight, s.radius),
    // The seed in two 16-bit halves: a float holds each exactly.
    seed: new Vector4(s.seed >>> 16, s.seed & 0xffff, s.trackEvery, s.trackWidth),
    mean: new Vector4(c.mean.albedo[0], c.mean.albedo[1], c.mean.albedo[2], c.mean.gloss),
  };
}

const blank = (): SkinUniforms => skinUniforms(
  { seed: 0, nTheta: 8, nZ: 1, z0: 0, z1: 1, radius: 1, collectorQ: 0, starfloors: 0, around: 1, along: 1, age: 0, panelLife: 1, roomLight: 0, trackEvery: 2, trackWidth: 1, dronesPerTrack: 1, droneSize: 1, droneSpeed: 1 },
  { albedo: new Float32Array(24), gloss: new Float32Array(8), mean: { albedo: [0, 0, 0], gloss: 0, emit: 0 } },
);
const fallback = blank();
const perObject = (k: keyof SkinUniforms) => uniform(new Vector4()).onObjectUpdate(({ object }) => ((object?.userData.skin as SkinUniforms | undefined) ?? fallback)[k]);
const skin = { grid: perObject('grid'), campaign: perObject('campaign'), age: perObject('age'), seed: perObject('seed'), mean: perObject('mean') };

/** lowbias32 (`hash32` in @futuremagic/core), on 32-bit unsigned integers, which wrap as JavaScript's Math.imul does. */
function hash32(x: Node<'uint'>): Node<'uint'> {
  let h = x.bitXor(x.shiftRight(uint(16)));
  h = h.mul(uint(0x7feb352d));
  h = h.bitXor(h.shiftRight(uint(15)));
  h = h.mul(uint(0x846ca68b));
  return h.bitXor(h.shiftRight(uint(16)));
}

/** `hash3i(seed, x, y, z)` from @futuremagic/core. */
function hash3(seed: Node<'uint'>, x: Node<'uint'>, y: Node<'uint'>, z: number): Node<'uint'> {
  const hz = hash32(uint(Math.imul(z, 0x9e3779b1) >>> 0));
  const hy = hash32(y.mul(uint(0x165667b1)).bitXor(hz));
  return hash32(seed.bitXor(hash32(x.mul(uint(0x27d4eb2d)).bitXor(hy))));
}

/** `hashToFloat`: the top 24 bits as a float in [0, 1). */
const toFloat = (h: Node<'uint'>): Node<'float'> => float(h.shiftRight(uint(8))).div(16777216);

/** The skin's 32-bit seed, put back together from its two halves. */
const skinSeed = (): Node<'uint'> => uint(skin.seed.x).shiftLeft(uint(16)).bitOr(uint(skin.seed.y));

const v3 = (c: readonly number[]): Node<'vec3'> => vec3(c[0], c[1], c[2]);

const TRACK = LOOK.track;
/**
 * The panel frames stand proud of the glass: over the outer FRAME_BEVEL of each panel the surface tilts by up to
 * FRAME_TILT (as a share of the normal) toward the panel's middle, so frames catch the Sun at their own angle.
 */
const FRAME_BEVEL = 0.012;
const FRAME_TILT = 0.6;

/** A seam line where x crosses a whole number, `width` wide (in x's units), faded out where thinner than a pixel. */
function seam(x: Node<'float'>, width: number): Node<'float'> {
  const f = fract(x), w = fwidth(x);
  const line = smoothstep(0, width, f).mul(smoothstep(0, width, f.oneMinus()));
  return mix(float(1), line, clamp(float(1).sub(w.div(width * 2)), 0, 1));
}

/** The light on a surface with this normal: the Sun (less what Earth or the Moon hide) and earthshine. */
function lightOn(n: Node<'vec3'>): { sun: Node<'float'>; all: Node<'float'> } {
  const sun = max(dot(n, outside.sunDir), 0).mul(outside.sunlight);
  return { sun, all: sun.add(max(dot(n, outside.earthDir), 0).mul(outside.earthshine)) };
}

/** The glass's glint of the Sun, as gen/skin.ts's `skinFlux` has it. */
function glint(n: Node<'vec3'>, sun: Node<'float'>, gloss: Node<'float'>): Node<'float'> {
  const h = normalize(outside.sunDir.sub(normalize(positionWorld)));
  return pow(max(dot(n, h), 0), GLINT_POWER).mul(sun).mul(gloss).mul(GLINT_GAIN);
}

/**
 * The solar skin, per pixel: which panel this is (column around from θ = 0, row along from the wild face), its kind,
 * age and shade exactly as `panelAt` in gen/skin.ts; seams and the cells inside a panel close up. Where panels shrink
 * below a pixel the look blends to the repair patch's, and where patches do too, to the skin's mean, so it never shimmers.
 */
export function skinColor(): Node<'vec3'> {
  const p = positionLocal;
  const nTheta = skin.grid.x, nZ = skin.grid.y, z0 = skin.grid.z, z1 = skin.grid.w;
  const around = skin.campaign.x, along = skin.campaign.y, q = skin.campaign.z, starfloors = skin.campaign.w;
  const habitatAge = skin.age.x, life = skin.age.y, roomLight = skin.age.z, radius = skin.age.w;
  const seed = skinSeed();

  const fi = fract(atan(p.y, p.x).div(2 * Math.PI)).mul(nTheta);
  const fj = p.z.sub(z0).div(z1.sub(z0)).mul(nZ);
  const fiC = clamp(floor(fi), 0, nTheta.sub(1)), fjC = clamp(floor(fj), 0, nZ.sub(1));
  const i = uint(fiC), j = uint(fjC);
  const u = (x: Node<'uint'>, y: Node<'uint'>, salt: number): Node<'float'> => toFloat(hash3(seed, x, y, salt));

  // The campaign (campaignAt): bands of columns, each starting its patches at its own row.
  const I = uint(floor(fiC.div(around)));
  const offset = hash3(seed, I, uint(0), SALT.offset).mod(uint(along));
  const J = j.add(offset).div(uint(along));
  const campaignAge = u(I, J, SALT.campaign).mul(habitatAge);
  const replaced = u(i, j, SALT.replaced).lessThan(float(1).sub(campaignAge.negate().div(life).exp()));
  const age = select(replaced, u(i, j, SALT.replacedAge).mul(campaignAge), campaignAge);
  const collector = i.add(uint(1)).mul(uint(q)).shiftRight(uint(16)).notEqual(i.mul(uint(q)).shiftRight(uint(16)));
  const starfloor = collector.not().and(u(i, j, SALT.starfloor).lessThan(starfloors));
  const k = u(i, j, SALT.shade).sub(0.5).mul(LOOK.shade).add(1);

  // The look of a kind at an age (lookOf).
  const weathered = (a: Node<'float'>): Node<'float'> => float(1).sub(a.negate().div(life).exp());
  const cellOf = (a: Node<'float'>): Node<'vec3'> => mix(v3(LOOK.cellNew), v3(LOOK.cellOld), weathered(a));
  const collectorOf = (a: Node<'float'>): Node<'vec3'> => v3(LOOK.collector).mul(weathered(a).mul(0.5).add(1));
  const collectorGloss = (a: Node<'float'>): Node<'float'> => mix(float(LOOK.collectorGloss[0]), float(LOOK.collectorGloss[1]), weathered(a));
  const panelAlbedo = select(collector, collectorOf(age).mul(k), select(starfloor, v3(LOOK.starfloor), cellOf(age).mul(k)));
  const panelGloss = select(collector, collectorGloss(age), select(starfloor, float(LOOK.starfloorGloss), float(LOOK.cellGloss)));
  const panelEmit = select(starfloor, roomLight, float(0));

  // The patch's look with its panels below a pixel: collectors and cells mixed by their share.
  const share = q.div(65536);
  const patchAlbedo = mix(cellOf(campaignAge), collectorOf(campaignAge), share).mul(LOOK.frameMean);
  const patchGloss = mix(float(LOOK.cellGloss), collectorGloss(campaignAge), share);
  const meanEmit = share.oneMinus().mul(starfloors).mul(roomLight);

  // Panels per pixel, from how fast the position changes across the pixel (no seam where θ wraps).
  const panelSize = radius.mul(2 * Math.PI).div(nTheta);
  const perPixel = length(fwidth(p)).div(panelSize);
  const panelDetail = float(1).sub(smoothstep(0.25, 1, perPixel));
  const patchDetail = float(1).sub(smoothstep(0.25, 1, perPixel.div(min(around, along))));
  const near = (a: Node<'vec3'> | Node<'float'>, b: Node<'vec3'> | Node<'float'>, c: Node<'vec3'> | Node<'float'>) =>
    mix(a as Node<'vec3'>, mix(b as Node<'vec3'>, c as Node<'vec3'>, panelDetail), patchDetail);
  // Inside a panel: the frame between panels, and the cells (16 a side) or the collector's light guides (8 across).
  const frame = seam(fi, 0.01).mul(seam(fj, 0.01));
  const cells = select(collector, seam(fi.mul(8), 0.05), seam(fi.mul(16), 0.04).mul(seam(fj.mul(16), 0.04)));
  const inner = mix(float(0.5), float(1), frame).mul(mix(float(0.8), float(1), cells));
  let albedo = near(skin.mean.xyz, patchAlbedo, panelAlbedo.mul(inner)) as Node<'vec3'>;
  let gloss = near(skin.mean.w, patchGloss, panelGloss) as unknown as Node<'float'>;
  const emit = near(meanEmit, meanEmit, panelEmit.mul(frame)) as unknown as Node<'float'>;

  // The frames' bevel: the normal tilts toward the panel's middle near each edge, around and along (local axes).
  const r = length(p.xy), radial = vec3(p.x.div(r), p.y.div(r), 0), tangent = vec3(p.y.negate().div(r), p.x.div(r), 0);
  const edge = (f: Node<'float'>): Node<'float'> =>
    float(1).sub(smoothstep(0, FRAME_BEVEL, f)).sub(float(1).sub(smoothstep(0, FRAME_BEVEL, f.oneMinus())));
  const tilt = vec2(edge(fract(fi)), edge(fract(fj))).mul(FRAME_TILT).mul(panelDetail);

  // Drone tracks in the seam below every trackEvery-th column: a channel with two rails and ties across.
  const trackEvery = skin.seed.z, trackWidth = skin.seed.w;
  const fromSeam = fract(fi.div(trackEvery).add(0.5)).sub(0.5).mul(trackEvery).mul(panelSize);
  const across = fromSeam.div(trackWidth).add(0.5);
  const onTrack = across.greaterThan(0).and(across.lessThan(1));
  const rail = (at: number): Node<'float'> => float(1).sub(smoothstep(TRACK.railWidth * 0.5, TRACK.railWidth, abs(across.sub(at))));
  const rails = max(rail(0.5 - TRACK.railAt), rail(0.5 + TRACK.railAt));
  const ties = float(1).sub(seam(p.z.div(TRACK.tieEvery), 0.15));
  const trackAlbedo = mix(v3(TRACK.channel).mul(float(1).sub(ties.mul(0.3))), v3(TRACK.rail), rails);
  // Seen from too far for the track's width, it does not vanish: its light joins the skin's in the share of the
  // drum it covers (Arnd, 2026-10-21: nothing vanishes with distance).
  const trackDetail = float(1).sub(smoothstep(0.5, 2, length(fwidth(p)).div(trackWidth)));
  const track = select(onTrack, trackDetail, float(0));
  const trackShare = trackWidth.div(trackEvery.mul(panelSize)).mul(float(1).sub(trackDetail));
  albedo = mix(mix(albedo, mix(v3(TRACK.channel), v3(TRACK.rail), 2 * TRACK.railWidth * 0.75), trackShare), trackAlbedo, track);
  gloss = mix(mix(gloss, float(2 * TRACK.railWidth * 0.75 * TRACK.railGloss), trackShare), rails.mul(TRACK.railGloss), track);

  const local = normalize(radial.add(tangent.mul(tilt.x)).add(vec3(0, 0, 1).mul(tilt.y)).mul(float(1).sub(track)).add(radial.mul(track)));
  const n = normalize(modelWorldMatrix.mul(vec4(local, 0)).xyz);
  const light = lightOn(n);
  return albedo.mul(light.all).add(glint(n, light.sun, gloss)).add(vec3(1, 0.86, 0.66).mul(emit.mul(float(1).sub(track)))).mul(outside.exposure);
}

/** Radiator albedo (endcap faces and brims): a dark, matte composite, ribbed by heat pipes running out from the axis. */
const RADIATOR: readonly number[] = [0.07, 0.068, 0.065];

/**
 * The radiators: endcap faces and brims, ruled in rings and radial strips (`panel` wide) that turn with the spin, with
 * a little weathering between strips. The faces never see the Sun head-on (the axis points at an ecliptic pole), so
 * they show by earthshine, and their rims catch the Sun edge-on.
 */
export function radiatorColor(): Node<'vec3'> {
  const p = positionLocal;
  const r = length(p.xy), panel = skin.age.w.mul(2 * Math.PI).div(skin.grid.x);
  const ring = r.div(panel), spoke = fract(atan(p.y, p.x).div(2 * Math.PI)).mul(skin.grid.x);
  // Each strip its own shade, seeded like the skin.
  const strip = toFloat(hash3(skinSeed(), uint(floor(ring)), uint(floor(spoke)), SALT.radiator)).sub(0.5).mul(0.24).add(1);
  const lines = seam(ring, 0.02).mul(seam(spoke, 0.02));
  const albedo = v3(RADIATOR).mul(strip).mul(mix(float(0.6), float(1), lines));
  const n = normalWorld, light = lightOn(n);
  return albedo.mul(light.all).add(glint(n, light.sun, float(0.05))).mul(outside.exposure);
}

/** A torch's exhaust plume: its glowing length, how hard the drive thrusts (0–1), per mesh in `userData.flame`. */
export interface FlameUniforms {
  /** (plume length at full thrust (m), throttle 0–1, nozzle radius (m), unused). */
  flame: Vector4;
}
const noFlame: FlameUniforms = { flame: new Vector4(1, 0, 1, 0) };
const flameOf = uniform(new Vector4()).onObjectUpdate(({ object }) => ((object?.userData.flame as FlameUniforms | undefined) ?? noFlame).flame);
/** The plasma's glow at the nozzle at full thrust, in the outside's radiance units. */
const FLAME_GLOW = 60;

/**
 * The exhaust of a fusion torch: hot plasma glowing violet-white at the nozzle and fading to blue down the plume. The
 * glow shortens with the throttle and goes out with it; seen edge-on the thin sheath of plasma fades, so it is soft.
 */
export function flameColor(): Node<'vec3'> {
  const length = flameOf.x, throttle = flameOf.y;
  const s = clamp(positionLocal.x.negate().div(length), 0, 1);
  const fall = s.negate().div(throttle.mul(0.25).add(1e-3)).exp();
  const facing = pow(dot(normalWorld, normalize(positionWorld)).abs(), 1.5);
  const tint = mix(vec3(0.88, 0.84, 1), vec3(0.42, 0.52, 1), smoothstep(0, 0.5, s));
  return min(tint.mul(fall).mul(facing).mul(throttle).mul(FLAME_GLOW).mul(outside.exposure), DISPLAY_CAP);
}

/** Plain hardware (spindle, berth arms, mast): albedo from the vertex colour, a dull metal sheen. */
export function hardwareColor(): Node<'vec3'> {
  const n = normalWorld, light = lightOn(n);
  return vertexColor().rgb.mul(light.all).add(glint(n, light.sun, float(0.15))).mul(outside.exposure);
}
