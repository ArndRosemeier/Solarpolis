/**
 * The material registry (docs/SHADERS.md): every material in the game is one of these kinds, and every mesh of a kind
 * shares the kind's one material. The Stage warms them all behind the loading screen, so nothing compiles in play.
 *
 * The light inside a cylinder comes from the sunline along the axis, so it falls on every point from the axis
 * direction: the ground shaders light themselves from there, with no three.js lights at all. Then the air: looking
 * across the habitat, distant ground fades into the bright blue haze of kilometres of lit air.
 *
 * Everything is drawn relative to the camera (`toView`), so `positionWorld` is the offset from the eye; the eye's own
 * world position is the `view.eye` uniform, for whatever needs the true place (the axis, ground patterns).
 */
import { MeshBasicNodeMaterial, DoubleSide, BackSide, AdditiveBlending, type Material } from 'three/webgpu';
import { abs, atan, attribute, cameraPosition, hash, normalLocal, step, time, varying, clamp, color, cos, log, select, sign, sqrt, dot, exp, float, max, mix, mx_fractal_noise_float, normalize, min, modelWorldMatrix, normalWorld, positionLocal, positionWorld, pow, sin, smoothstep, texture, uniform, vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { ClampToEdgeWrapping, DataTexture, DataUtils, Float32BufferAttribute, HalfFloatType, InstancedInterleavedBuffer, InterleavedBufferAttribute, LinearFilter, RedFormat, Vector2, Vector3, type BufferGeometry } from 'three/webgpu';
import { PLANT_STRIDE } from '../gen/scatter';
import type { Node } from 'three/webgpu';
import type { StageKind } from '@futuremagic/stage';
import { HAZE_DIAMETER } from '../blueprint';
import { sunShadow } from './lights';
import { OPEN_SKY } from '../gen/horizon';
import { EMISSION_SAMPLES, SUNLINE_STEPS } from '../world/sunline';
import { HAZE_STEPS } from '../world/air';
import { hullColor, skyDome, starColor, starVertex } from './skyShaders';

/** The air's look, shared by every kind (uniforms: changing them never builds a shader). */
export const air = {
  /** The haze colour: sunlit air seen through kilometres of it. */
  haze: uniform(color(0.55, 0.68, 0.86)),
  /**
   * Extinction per metre: across HAZE_DIAMETER of air only a quarter of the ground's own colour is left, so a
   * cylinder wider than that fades into the haze at its far side (blueprint/validate.ts).
   */
  extinction: uniform(Math.log(4) / HAZE_DIAMETER),
  /** Share of the sunline's light scattered back from the air onto everything (the sky light). */
  skyLight: uniform(0.35),
};

/** The habitat's air (world/air.ts): how density falls toward the axis, the radius, the mid floor's view of the sunline. */
export const airShape = {
  kappa: uniform(0),
  radius: uniform(1),
  seenMid: uniform(1),
};

/** Where the eye is in the habitat (world axes, m); set each frame by the view. */
export const view = {
  eye: uniform(new Vector3()),
};

/** A fragment's true world position: the eye plus its camera-relative offset. */
const worldPosition = (): Node<'vec3'> => positionWorld.add(view.eye);

/**
 * The sunline's light (world/sunline.ts has the integral and its reference): the emission profile along the axis as a
 * texture, the habitat's length, the scale that makes the mid floor 1, and the nearest distance to the axis that
 * counts. Set by the view per habitat (`setSunline`); the travelling sun only rewrites the texture.
 */
const emissionData = new Uint16Array(EMISSION_SAMPLES);
const emissionTexture = new DataTexture(emissionData, EMISSION_SAMPLES, 1, RedFormat, HalfFloatType);
emissionTexture.magFilter = LinearFilter;
emissionTexture.minFilter = LinearFilter;
emissionTexture.wrapS = ClampToEdgeWrapping;
emissionTexture.wrapT = ClampToEdgeWrapping;
export const light = {
  /** The emission's mean over the length: how much light the air scatters back (the sky light) at this hour. */
  mean: uniform(1),
  length: uniform(1),
  norm: uniform(1),
  nearest: uniform(1),
};

/** The sunline's emission profile at this hour (world/sunline.ts, `sunlineEmission`) and its mean. */
export function setEmission(emission: Float32Array, mean: number): void {
  for (let i = 0; i < EMISSION_SAMPLES; i++) emissionData[i] = DataUtils.toHalfFloat(emission[i]);
  emissionTexture.needsUpdate = true;
  light.mean.value = mean;
}

/** Load a habitat's air into the shaders' uniforms (world/air.ts). */
export function setAir(kappa: number, radius: number, seenMid: number): void {
  airShape.kappa.value = kappa;
  airShape.radius.value = radius;
  airShape.seenMid.value = seenMid;
}

/** Load a habitat's sunline into the shaders' uniforms; its emission comes with `setEmission`. */
export function setSunline(length: number, norm: number, nearest: number): void {
  light.length.value = length;
  light.norm.value = norm;
  light.nearest.value = nearest;
}

/**
 * The light on a surface from the sunline, seen past the terrain's horizon angles (x toward the port end, y toward the
 * wild end) and the near shadow map, plus the sky light: the air's scattered glow, less where the horizons close in.
 */
function sunlit(horizon: Node<'vec2'> = vec2(OPEN_SKY, OPEN_SKY), normal: Node<'vec3'> = normalWorld): Node<'float'> {
  const w = worldPosition();
  const len = max(w.xy.length(), 1e-3);
  const r = max(len, light.nearest);
  const inX = w.x.negate().div(len), inY = w.y.negate().div(len);
  const lo = max(horizon.y.negate(), atan(w.z.negate().div(r)));
  const hi = min(horizon.x, atan(light.length.sub(w.z).div(r)));
  const span = max(hi.sub(lo), 0);
  let sum: Node<'float'> = float(0);
  for (let k = 0; k < SUNLINE_STEPS; k++) {
    const a = lo.add(span.mul((k + 0.5) / SUNLINE_STEPS));
    const c = cos(a), sn = sin(a);
    const facing = max(normal.x.mul(inX).mul(c).add(normal.y.mul(inY).mul(c)).add(normal.z.mul(sn)), 0);
    const at = w.z.add(r.mul(sn).div(c)).div(light.length);
    sum = sum.add(texture(emissionTexture, vec2(at, 0.5)).r.mul(c).mul(facing));
  }
  // Near things (the body, balls) shade it too: the near shadow map, soft along the axis (render/lights.ts).
  const direct = sum.mul(span).div(SUNLINE_STEPS).div(r).mul(light.norm).mul(sunShadow as unknown as Node<'float'>);
  // The sky light comes from the whole air above: as much as the horizons leave open of the half circle.
  const open = clamp(horizon.x.add(horizon.y).div(Math.PI), 0, 1);
  return direct.mul(float(1).sub(air.skyLight)).add(air.skyLight.mul(light.mean).mul(open));
}

/** The look of distant things: mix towards the haze by the length of air between the eye and the point. */
function throughAir(c: Node<'vec3'>): Node<'vec3'> {
  // The line of sight from the eye (world) to this point, in HAZE_STEPS pieces (world/air.ts, `hazeAlong`).
  const ray = positionWorld.sub(cameraPosition);
  const D = max(ray.length(), 1e-3);
  const d = ray.div(D);
  const eye = view.eye;
  const R = airShape.radius, near = light.nearest;
  // The R / r term over a piece, exactly: ∫ dt / sqrt(|eye_xy + t d_xy|² + near²).
  const A = d.x.mul(d.x).add(d.y.mul(d.y));
  const B = eye.x.mul(d.x).add(eye.y.mul(d.y)).mul(2);
  const C = eye.x.mul(eye.x).add(eye.y.mul(eye.y)).add(near.mul(near));
  const disc = sqrt(max(A.mul(C).mul(4).sub(B.mul(B)), 1e-12));
  const sqrtA = sqrt(max(A, 1e-12));
  const primitive = (t: Node<'float'>): Node<'float'> => asinhOf(A.mul(t).mul(2).add(B).div(disc)).div(sqrtA);
  const along = A.lessThan(1e-6);
  let T: Node<'float'> = float(1), glow: Node<'float'> = float(0);
  for (let k = 0; k < HAZE_STEPS; k++) {
    const t0 = D.mul(k / HAZE_STEPS), t1 = D.mul((k + 1) / HAZE_STEPS), dt = D.div(HAZE_STEPS), tm = D.mul((k + 0.5) / HAZE_STEPS);
    const p = eye.add(d.mul(tm));
    const r = max(p.xy.length(), near);
    const sigma = air.extinction.mul(exp(airShape.kappa.mul(r.mul(r).sub(R.mul(R)))));
    const seen = atan(light.length.sub(p.z).div(r)).add(atan(p.z.div(r))).div(airShape.seenMid);
    const lit = seen.mul(texture(emissionTexture, vec2(p.z.div(light.length), 0.5)).r);
    const inv = select(along, dt.div(sqrt(C)), primitive(t1).sub(primitive(t0)));
    const source = air.skyLight.mul(light.mean).mul(dt).add(float(1).sub(air.skyLight).mul(R).mul(lit).mul(inv));
    const tau = sigma.mul(dt);
    const inside = float(1).sub(exp(tau.negate())).div(max(tau, 1e-6));
    glow = glow.add(T.mul(sigma).mul(source).mul(inside));
    T = T.mul(exp(tau.negate()));
  }
  return c.mul(T).add(air.haze.mul(glow));
}

/** asinh, without cancellation for large negative arguments. */
function asinhOf(x: Node<'float'>): Node<'float'> {
  const a = abs(x);
  return sign(x).mul(log(a.add(sqrt(a.mul(a).add(1)))));
}

export interface Kind extends StageKind {
  /** The kind's one material, made on first use. */
  readonly material: Material;
}

function kind(name: string, attributes: readonly string[], shadow: { cast: boolean; receive: boolean }, build: () => Material): Kind {
  let made: Material | null = null;
  const k: Kind = {
    name, attributes, shadow,
    make: () => (made ??= Object.assign(build(), { name })),
    get material() { return k.make(); },
  };
  return k;
}

/**
 * Geomorphing: the distance from the eye (m) at which a tile's parent takes over; each tile mesh sets it in
 * `userData.morphFar` (render/terrain.ts). Points blend towards the parent's surface (the `morph` attribute) over the
 * last stretch before it, so a tile has the parent's shape by the time they swap.
 */
const morphFar = uniform(0).onObjectUpdate(({ object }) => (object?.userData.morphFar as number | undefined) ?? 1e30);
/** Where the blend starts, as a share of `morphFar`. */
const MORPH_START = 0.6;

/**
 * The ground of the whole interior (floor and endcap slopes): vertex colour, lit from the axis, seen through the air.
 * Its meshes carry position, normal, color, morph and horizon (tiles.ts).
 */
export const GROUND = kind('ground', ['position', 'normal', 'color', 'morph', 'horizon'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const seen = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.sub(cameraPosition).length();
  const blend = smoothstep(morphFar.mul(MORPH_START), morphFar, seen);
  m.positionNode = positionLocal.add(attribute<'vec3'>('morph', 'vec3').mul(blend));
  // Close up, the ground gets a mottle of tufts and bare patches (metres across), finer than its grid; it fades out
  // with distance before it could shimmer. Plants will take over from it.
  const near = float(1).sub(smoothstep(150, 1200, positionWorld.sub(cameraPosition).length()));
  const mottle = mx_fractal_noise_float(worldPosition().mul(1 / 5), 4, 2.1, 0.5).mul(0.35).mul(near).add(1);
  m.colorNode = throughAir(vertexColor().rgb.mul(sunlit(attribute<'vec2'>('horizon', 'vec2'))).mul(mottle));
  return m;
});

/** The sunline: the glowing tube along the axis, brighter where the travelling sun is. Brighter than white, so the tone mapping rolls it off. */
export const SUNLINE = kind('sunline', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  // As bright along its length as the emission profile says: the travelling sun is a brighter stretch of the tube.
  const glow = texture(emissionTexture, vec2(worldPosition().z.div(light.length), 0.5)).r;
  m.colorNode = throughAir(vec3(6, 5.4, 4.6).mul(glow));
  return m;
});

/**
 * Water (the ring lake): its own dark green-blue, lit like the ground, and towards grazing angles it mirrors the bright
 * haze above (Fresnel). Its meshes carry position and normal.
 */
export const WATER = kind('water', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const toEye = normalize(positionWorld.negate());
  const facing = abs(dot(normalWorld, toEye));
  const mirror = pow(float(1).sub(facing), 5).mul(0.9).add(0.04);
  const deep = vec3(0.02, 0.07, 0.08).mul(sunlit());
  m.colorNode = throughAir(mix(deep, air.haze, mirror));
  return m;
});

/**
 * The view outside (skyShaders.ts). The sky dome: a sphere around the eye, drawn first and behind everything, with the
 * Sun, Earth and the Moon computed per pixel. Its meshes carry position only.
 */
export const SKY = kind('sky', ['position'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: BackSide, depthTest: false, depthWrite: false });
  m.colorNode = skyDome();
  return m;
});

/** The stars: camera-facing quads, added on top of the dome and hidden by the hull. Position, color (× flux), corner. */
export const STARS = kind('stars', ['position', 'color', 'corner'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false });
  m.vertexNode = starVertex();
  m.colorNode = starColor();
  return m;
});

/** A habitat's hull from outside: drum, endcap faces, brims, mast and the despun spindle. Position, normal, color. */
export const HULL = kind('hull', ['position', 'normal', 'color'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  m.colorNode = hullColor();
  return m;
});

/** A plant cell's own values, from its mesh (render/plants.ts): how far the plant is seen, and the horizons at the cell. */
const plantSeen = uniform(1e30).onObjectUpdate(({ object }) => (object?.userData.seen as number | undefined) ?? 1e30);
const plantHorizon = uniform(new Vector2(OPEN_SKY, OPEN_SKY)).onObjectUpdate(({ object }) => (object?.userData.horizon as Vector2 | undefined) ?? new Vector2(OPEN_SKY, OPEN_SKY));
/** How far toward its sight distance a plant starts to thin out (each plant leaves at its own distance in the band). */
const PLANT_FADE = 0.75;

/**
 * Plants (gen/plants.ts, gen/scatter.ts): one unit-high mesh per species and variant, instanced over a cell. Each
 * instance (`plant`: foot relative to the cell, height; `turn`: radians about up) stands toward the axis wherever it
 * is, turned and scaled; crowns sway a little in the air's movement. Far off, plants leave one by one before the
 * distance where the ground's own colour stands in for them. Lit by the sunline like the ground, past the cell's
 * horizons, and casting into the near shadow map.
 */
export const PLANT = kind('plant', ['position', 'normal', 'color', 'plant'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const inst = attribute<'vec4'>('plant', 'vec4'), turn = attribute<'float'>('turn', 'float');
  const foot = modelWorldMatrix.mul(vec4(inst.xyz, 1)).xyz;
  const world = foot.add(view.eye);
  const up = normalize(vec3(world.x.negate(), world.y.negate(), 0));
  const side = vec3(up.y, up.x.negate(), 0), axis = vec3(0, 0, 1);
  const c = cos(turn), sn = sin(turn);
  const ax = side.mul(c).add(axis.mul(sn)), az = side.mul(sn.negate()).add(axis.mul(c));
  // Each plant thins out at its own distance in the last stretch of its sight: a plant that has left is folded away.
  const away = foot.sub(cameraPosition).length();
  const keep = step(hash(inst.x.mul(13.7).add(inst.z.mul(7.1)).add(inst.y.mul(3.3))), float(1).sub(smoothstep(plantSeen.mul(PLANT_FADE), plantSeen, away)).mul(1.0001));
  const p = positionLocal.mul(inst.w).mul(keep);
  // The air moves: a slow sway, more toward the top, out of step from plant to plant.
  const sway = sin(time.mul(1.1).add(world.x.mul(0.13)).add(world.z.mul(0.07))).mul(0.012).mul(p.y.mul(p.y).div(max(inst.w, 0.1)));
  m.positionNode = inst.xyz.add(ax.mul(p.x.add(sway))).add(up.mul(p.y)).add(az.mul(p.z));
  const n = varying(normalize(ax.mul(normalLocal.x).add(up.mul(normalLocal.y)).add(az.mul(normalLocal.z))));
  m.colorNode = throughAir(vertexColor().rgb.mul(sunlit(plantHorizon, normalize(n))));
  return m;
});

/** The game's own attributes on the Stage's warm-up stand-ins (StageOptions.attribute): no morph, open horizons. */
export function standInAttribute(g: BufferGeometry, name: string): boolean {
  if (name === 'morph') g.setAttribute('morph', new Float32BufferAttribute(new Array(9).fill(0), 3));
  else if (name === 'corner') g.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1], 2));
  else if (name === 'horizon') g.setAttribute('horizon', new Float32BufferAttribute(new Array(6).fill(OPEN_SKY), 2));
  else if (name === 'plant') plantInstances(g, new Float32Array([0, 0, 0, 1, 0]));
  else return false;
  return true;
}

/**
 * Put a cell's plants on a geometry as its instances: `PLANT_STRIDE` floats each (x, y, z, height, turn), one buffer
 * read as the `plant` (vec4) and `turn` (float) attributes. The one way plants get onto a mesh (stand-ins too, so the
 * warm-up builds the very layout the plants draw with).
 */
export function plantInstances(g: BufferGeometry, data: Float32Array): void {
  const buffer = new InstancedInterleavedBuffer(data, PLANT_STRIDE);
  g.setAttribute('plant', new InterleavedBufferAttribute(buffer, 4, 0));
  g.setAttribute('turn', new InterleavedBufferAttribute(buffer, 1, 4));
}

/** The kinds of the view outside, for its Stage's warm-up (windows will add them to the interior's). */
export function outsideKinds(): readonly Kind[] {
  return [SKY, STARS, HULL];
}

/** Things the physics moves (for now the debug menu's test balls): one colour, lit by the sunline, through the air. */
export const BALL = kind('ball', ['position', 'normal'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = throughAir(vec3(0.75, 0.32, 0.08).mul(sunlit()));
  return m;
});

/** Every kind, for the Stage's warm-up. */
export function allKinds(): readonly Kind[] {
  return [GROUND, WATER, SUNLINE, BALL, PLANT];
}
