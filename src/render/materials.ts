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
import { abs, atan, attribute, cross, dFdx, dFdy, floor, fract, inverseSqrt, log2, mx_noise_float, uv, cameraPosition, hash, normalLocal, step, time, varying, clamp, color, cos, log, select, sign, sqrt, dot, exp, float, max, mix, normalize, min, modelWorldMatrix, normalWorld, positionLocal, positionWorld, pow, sin, smoothstep, texture, uniform, vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { DataTexture, Uint8BufferAttribute, RGBAFormat, UnsignedByteType, Vector4, DataUtils, Float32BufferAttribute, HalfFloatType, InstancedInterleavedBuffer, InterleavedBufferAttribute, RedFormat, Vector2, Vector3, type BufferGeometry } from 'three/webgpu';
import { PLANT_STRIDE } from '../gen/scatter';
import { BARK_STRIPS } from '../gen/trees';
import { BARK_TEXELS } from '../gen/foliage';
import { LEAF_ATLAS_SIZE } from '../workers/leaves';
import type { Node } from 'three/webgpu';
import type { StageKind } from '@futuremagic/stage';
import { REFERENCE } from '../blueprint';
import { SHADOW_HALF, sunShadow } from './lights';
import { CLOSED_RAISE, UNDER_CROWNS } from '../gen/ecology';
import { OPEN_SKY } from '../gen/horizon';
import { EMISSION_SAMPLES, SUNLINE_STEPS } from '../world/sunline';
import { HAZE_STEPS } from '../world/air';
import { skyDome, starColor, starVertex } from './skyShaders';
import { floorSurface, woodsFromAfar } from './groundShaders';
import { RISE_RANGE } from '../gen/tiles';
import { filtered } from './textures';
import { boreColor, flameColor, hardwareColor, lampColor, radiatorColor, skinColor, skinDetailColor, skinShown } from './hullShaders';

/** The air's look, shared by every kind (uniforms: changing them never builds a shader). */
export const air = {
  /** The haze colour: sunlit air seen through kilometres of it. */
  haze: uniform(color(0.55, 0.68, 0.86)),
  /**
   * Extinction per metre at floor density: across the habitat's `air.hazeDistance` only a quarter of the ground's own
   * colour is left (`setAir`), so a cylinder wider than that fades into the haze at its far side (blueprint/validate.ts).
   */
  extinction: uniform(Math.log(4) / REFERENCE.air.hazeDistance),
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
  /** How far the eyes have opened (`insideExposure`): scales every inside kind's light, and three's lights for Actors. */
  exposure: uniform(1),
};

/** A fragment's true world position: the eye plus its camera-relative offset. */
const worldPosition = (): Node<'vec3'> => positionWorld.add(view.eye);

/**
 * The sunline's light (world/sunline.ts has the integral and its reference): the emission profile along the axis as a
 * texture, the habitat's length, the scale that makes the mid floor 1, and the nearest distance to the axis that
 * counts. Set by the view per habitat (`setSunline`); the travelling sun only rewrites the texture.
 */
const emissionData = new Uint16Array(EMISSION_SAMPLES);
const emissionTexture = filtered(new DataTexture(emissionData, EMISSION_SAMPLES, 1, RedFormat, HalfFloatType));
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

/** Load a habitat's air into the shaders' uniforms (world/air.ts): its density falloff, radius, view of the sunline and clearness. */
export function setAir(kappa: number, radius: number, seenMid: number, hazeDistance: number): void {
  air.extinction.value = Math.log(4) / hazeDistance;
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
 * `wrap` lets light reach past the terminator (0 a plain surface; leaves and crowns, which light shines through and
 * around, more).
 */
/**
 * The sunline's light on a surface: direct (through `sunShadow`, times `shade` where something else stands in for the
 * shadow map) plus the air's glow.
 */
function sunlit(horizon: Node<'vec2'> = vec2(OPEN_SKY, OPEN_SKY), normal: Node<'vec3'> = normalWorld, wrap = 0, shade: Node<'float'> = float(1)): Node<'float'> {
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
    const cosine = normal.x.mul(inX).mul(c).add(normal.y.mul(inY).mul(c)).add(normal.z.mul(sn));
    const facing = max(wrap ? cosine.add(wrap).div(1 + wrap) : cosine, 0);
    const at = w.z.add(r.mul(sn).div(c)).div(light.length);
    sum = sum.add(texture(emissionTexture, vec2(at, 0.5)).r.mul(c).mul(facing));
  }
  // Near things (the body, balls) shade it too: the near shadow map, soft along the axis (render/lights.ts).
  const direct = sum.mul(span).div(SUNLINE_STEPS).div(r).mul(light.norm).mul(sunShadow as unknown as Node<'float'>).mul(shade);
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
  return c.mul(T).add(air.haze.mul(glow)).mul(view.exposure);
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
/**
 * How much a point's rise over the ground around it (a slope, tiles.ts) changes its light: hollows hold less of the
 * sky's light and ridges catch more, so valleys, banks and hilltops read from afar under the overhead sunline.
 */
const RELIEF_LIGHT = 1.2;
/** Where the blend starts, as a share of `morphFar`. */
const MORPH_START = 0.6;

/**
 * The ground of the whole interior (floor and endcap slopes): vertex colour, lit from the axis, seen through the air.
 * Its meshes carry position, normal, color, morph and horizon (tiles.ts).
 */
export const GROUND = kind('ground', ['position', 'normal', 'color', 'morph', 'horizon', 'canopy', 'floorA', 'floorB'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const seen = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.sub(cameraPosition).length();
  const blend = smoothstep(morphFar.mul(MORPH_START), morphFar, seen);
  // Past the trees' last level, the woods are the ground's own canopy layer: it rises to the crowns and takes their
  // look over the band where the crown hulls hand them over (`setCanopyBand`).
  // `horizon`: the horizons (x, y), then the crowns' cover and the trees' spacing (z, w: tiles.ts).
  const canopy = attribute<'vec4'>('canopy', 'vec4'), horizon = attribute<'vec4'>('horizon', 'vec4');
  const woods = smoothstep(canopyBand.x, canopyBand.y, seen);
  const morph = attribute<'vec4'>('morph', 'vec4');
  m.positionNode = positionLocal.add(morph.xyz.mul(blend)).add(normalLocal.mul(canopy.w.mul(woods)));
  // Hollows and ridges (tiles.ts, `packRelief`): this tile's rise over the ground around, blended to its parent's.
  const packed = morph.w, own = floor(packed.div(256)), parentRise = packed.sub(own.mul(256));
  const rise = varying(mix(own, parentRise, blend).sub(127.5).div(127.5).mul(RISE_RANGE));
  const far = varying(woods);
  // Close up, the floor's own surface (groundShaders.ts): grass, litter, sand, rock, resolving as the eye comes near.
  const away = positionWorld.sub(cameraPosition).length();
  const floorUp = floorSurface(vertexColor().rgb, normalize(normalWorld));
  // From afar, crowns and the gaps between them, clumps and glades (groundShaders.ts, docs/far-view.md).
  const fromAfar = woodsFromAfar(vertexColor().rgb, canopy.rgb, horizon.z, horizon.w, worldPosition());
  const ground = mix(floorUp.color, fromAfar, far);
  // Under the woods past the shadow map's reach, the crowns' shade on average (`crownsClosed`): the floor stays in
  // the shade the near trees cast, and the canopy seen from afar keeps its sunlit tops.
  const beyond = smoothstep(SHADOW_HALF * 0.6, SHADOW_HALF * 0.9, away).mul(float(1).sub(far));
  const closed = smoothstep(0.25, 1, canopy.w.div(CLOSED_RAISE));
  const shade = mix(float(1), mix(float(1), float(UNDER_CROWNS), closed), beyond);
  m.colorNode = throughAir(ground.mul(sunlit(horizon.xy, floorUp.normal, 0, shade)).mul(clamp(rise.mul(RELIEF_LIGHT).add(1), 0.55, 1.3)));
  return m;
});

/** Where the ground's canopy layer takes over from the trees' crown hulls (m from the eye: from x to y). */
const canopyBand = uniform(new Vector2(1e30, 2e30));
export function setCanopyBand(band: readonly [number, number]): void {
  canopyBand.value.set(band[0], band[1]);
}

/** The sunline tube's colour where its emission is `glow`: brighter than white, so the tone mapping rolls it off. */
const tubeLight = (glow: Node<'float'>): Node<'vec3'> => vec3(6, 5.4, 4.6).mul(glow);

/** The sunline: the glowing tube along the axis, brighter where the travelling sun is. Brighter than white, so the tone mapping rolls it off. */
export const SUNLINE = kind('sunline', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  // As bright along its length as the emission profile says: the travelling sun is a brighter stretch of the tube.
  m.colorNode = throughAir(tubeLight(texture(emissionTexture, vec2(worldPosition().z.div(light.length), 0.5)).r));
  return m;
});

/**
 * Water (the ring lake and the rivers, gen/water.ts): a dark green-blue body, lit like the ground, with ripples that
 * run with the river (`flow`: across, run, speed, steepness; `dir`: downstream and the half width). The ripples tilt
 * the surface, so toward grazing angles it mirrors the bright haze (Fresnel) in moving patches, and where a ripple
 * faces the sunline overhead it throws back a glint of it. Falls and rapids foam white; the shallows by the banks show
 * the bed. The lake lies still under a slow breeze.
 */
export const WATER = kind('water', ['position', 'normal', 'flow', 'dir'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const flow = attribute<'vec4'>('flow', 'vec4'), dir = attribute<'vec4'>('dir', 'vec4');
  const up = normalize(normalWorld);
  const side = normalize(cross(dir.xyz, up)), ahead = cross(up, side);
  const river = step(0.01, dir.w), speed = flow.z, steep = flow.w;
  // The ripples' own coordinates (m): across the river and downstream, carried along with the water; on the lake the
  // world position, drifting slowly.
  const p = worldPosition();
  const along = vec3(flow.x.mul(dir.w), flow.y.sub(time.mul(speed)), 0);
  const still = vec3(p.x, p.y, p.z.add(time.mul(0.3)));
  const at = mix(still, along, river);
  // Ripples stretched across the flow, a coarse and a fine set; their slopes by small differences.
  const ripple = (q: Node<'vec3'>): Node<'float'> => mx_noise_float(q.mul(vec3(0.9, 0.45, 0.9))).mul(0.6).add(mx_noise_float(q.mul(vec3(3.1, 1.7, 3.1))).mul(0.25));
  const e = 0.08, h0 = ripple(at);
  const du = ripple(at.add(vec3(e, 0, 0))).sub(h0).div(e), dv = ripple(at.add(vec3(0, e, 0))).sub(h0).div(e);
  // Rough water tilts more: the slow floor stretches gently, rapids and falls hard.
  const rough = mix(float(0.12), float(0.18).add(smoothstep(0.02, 0.4, steep).mul(0.5)), river);
  const n = normalize(up.sub(side.mul(du.mul(rough))).sub(ahead.mul(dv.mul(rough))));
  const ray = normalize(positionWorld.sub(cameraPosition));
  const facing = abs(dot(n, ray.negate()));
  const mirror = pow(float(1).sub(facing), 5).mul(0.9).add(0.04);
  // The sunline's glint: where the reflected ray passes the axis within the tube's glow, as bright as the tube there.
  const r = ray.sub(n.mul(dot(n, ray).mul(2)));
  const rxy = max(dot(r.xy, r.xy), 1e-6), t = dot(p.xy, r.xy).negate().div(rxy);
  const miss = p.xy.add(r.xy.mul(t)).length();
  const tube = texture(emissionTexture, vec2(p.z.add(r.z.mul(t)).div(light.length), 0.5)).r;
  const glint = smoothstep(light.nearest.mul(1.5), light.nearest.mul(0.25), miss).mul(step(0, t)).mul(tube).mul(mirror);
  const lit = sunlit(vec2(OPEN_SKY, OPEN_SKY), up);
  // The body: deep in the middle, the bed showing in the shallows by the banks.
  const shallow = smoothstep(0.55, 1, abs(flow.x)).mul(0.7).mul(river);
  const body = mix(vec3(0.02, 0.07, 0.08), vec3(0.13, 0.12, 0.08), shallow).mul(lit);
  // White water: on falls and rapids, broken up by the same ripples, and a little along fast banks.
  const churn = smoothstep(0.08, 0.6, steep).add(smoothstep(0.85, 1, abs(flow.x)).mul(smoothstep(2, 5, speed)).mul(0.5));
  const foam = clamp(churn.mul(h0.mul(1.4).add(0.75)), 0, 1).mul(river);
  const surface = mix(body, air.haze, mirror).add(tubeLight(glint));
  m.colorNode = throughAir(mix(surface, vec3(0.8, 0.84, 0.86).mul(lit), foam));
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

/**
 * A habitat from outside (hullShaders.ts): the drum's solar skin, its panel patchwork drawn per pixel from the mesh's
 * `userData.skin`, hidden where the near tiles cover it (`skinShown`). Position, normal.
 */
export const SKIN = kind('skin', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = skinColor();
  m.maskNode = skinShown();
  return m;
});

/**
 * The skin up close (`skinDetailColor`): the glass of the detail tiles (gen/hullDetail.ts, render/hullDetail.ts), its
 * modules, cells and wear per pixel. Position, normal, grid (column, row, module x, module y).
 */
export const SKIN_DETAIL = kind('skin detail', ['position', 'normal', 'grid'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = skinDetailColor();
  return m;
});

/** The radiators: endcap faces and brims, both sides (`userData.skin` sizes their strips). Position, normal. */
export const RADIATOR = kind('radiator', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  m.colorNode = radiatorColor();
  return m;
});

/** Plain hardware outside: the spindle, its berth arms, the mast. Position, normal, color (albedo). */
export const HARDWARE = kind('hardware', ['position', 'normal', 'color'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = hardwareColor();
  return m;
});

/** A torch's exhaust plume (hullShaders.ts, `flameColor`): glowing plasma added on top. Position, normal. */
export const FLAME = kind('flame', ['position', 'normal'], { cast: false, receive: false }, () => {
  // Additive and not writing depth, the plume needs no back-then-front passes: one pass, so the one pipeline the
  // Stage builds is the one drawn (two passes built two more on the render path).
  const m = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false, forceSinglePass: true });
  m.colorNode = flameColor();
  return m;
});

/** Hardware inside the spindle's bore, lit by its own lamp strips (hullShaders.ts, `boreColor`). Position, normal, color. */
export const BORE = kind('bore', ['position', 'normal', 'color'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = boreColor();
  return m;
});

/** Lamps: their own light (hullShaders.ts, `lampColor`), the vertex colour as luminance. Position, color. */
export const LAMP = kind('lamp', ['position', 'color'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = lampColor();
  return m;
});

/**
 * Trees and plants (gen/trees.ts, ported from Scale; gen/scatter.ts plants them). Each cell of a species is drawn at
 * one of three levels by its distance: the full tree (BARK + LEAF), a lighter one (fewer, larger leaf cards), the
 * crown hull (HULL); beyond the hulls the ground tiles raise a canopy layer (GROUND, `canopy`). Neighbouring levels
 * hand each plant over in a dithered band (`userData.band` of the cell's mesh: fade in over x..y, out over z..w, m
 * from the eye), so a plant is always drawn by exactly one level and nothing ever just vanishes.
 */
const plantBand = uniform(new Vector4(-2, -1, 1e30, 2e30)).onObjectUpdate(({ object }) => (object?.userData.band as Vector4 | undefined) ?? new Vector4(-2, -1, 1e30, 2e30));
const plantHorizon = uniform(new Vector2(OPEN_SKY, OPEN_SKY)).onObjectUpdate(({ object }) => (object?.userData.horizon as Vector2 | undefined) ?? new Vector2(OPEN_SKY, OPEN_SKY));

/** The bark atlas (gen/foliage.ts) and the leaf atlas (render/foliage.ts), filled in once the workers have drawn them. */
export const BARK_SIZE = { width: BARK_TEXELS.strip * BARK_STRIPS, height: BARK_TEXELS.height };
export const LEAF_ATLAS = LEAF_ATLAS_SIZE;
function atlas(width: number, height: number, srgb: boolean, repeatV = false): DataTexture {
  return filtered(new DataTexture(new Uint8Array(width * height * 4).fill(srgb ? 90 : 128), width, height, RGBAFormat, UnsignedByteType), { srgb, mips: true, anisotropy: 4, repeat: repeatV ? 'v' : false });
}
const barkMap = atlas(BARK_SIZE.width, BARK_SIZE.height, true, true);
const barkNormal = atlas(BARK_SIZE.width, BARK_SIZE.height, false, true);
const leafMap = atlas(LEAF_ATLAS, LEAF_ATLAS, true);
leafMap.image.data!.fill(0);

/** Load the drawn atlases into the textures the kinds were built with (no shader is built again). */
export function setFoliage(bark: { color: Uint8Array; normal: Uint8Array }, leaves: Uint8Array): void {
  (barkMap.image.data as Uint8Array).set(bark.color);
  (barkNormal.image.data as Uint8Array).set(bark.normal);
  (leafMap.image.data as Uint8Array).set(leaves);
  barkMap.needsUpdate = barkNormal.needsUpdate = leafMap.needsUpdate = true;
}

/**
 * Whether the cell's mesh is the last level of what it draws (ground cover's light tufts): past its band it sinks
 * plants into the ground rather than handing them over (`userData.sink`, 0 or 1).
 */
const plantSink = uniform(0).onObjectUpdate(({ object }) => (object?.userData.sink as number | undefined) ?? 0);

/**
 * A plant instance (`plant`: foot relative to the mesh, height; `turn`): where it stands, its frame (it stands toward
 * the axis wherever it is, turned about up), and how much of it its mesh draws: an instance outside the mesh's band is
 * folded away, or sunk into the ground past the last level's.
 */
function plantFrame() {
  const inst = attribute<'vec4'>('plant', 'vec4'), turn = attribute<'float'>('turn', 'float'), tilt = attribute<'vec2'>('tilt', 'vec2');
  const foot = modelWorldMatrix.mul(vec4(inst.xyz, 1)).xyz;
  const world = foot.add(view.eye);
  const up = normalize(vec3(world.x.negate(), world.y.negate(), 0));
  const side = vec3(up.y, up.x.negate(), 0), axis = vec3(0, 0, 1);
  const c = cos(turn), sn = sin(turn);
  const ax = side.mul(c).add(axis.mul(sn)), az = side.mul(sn.negate()).add(axis.mul(c));
  // The band: each plant has its own threshold, so in a hand-over band one level takes it where the other leaves it.
  // Measured from the eye (the origin of the drawn world), not the camera: the shadow pass draws from the light's
  // camera, hundreds of metres away, and would drop every near plant from the shadow map.
  const away = foot.length();
  const pick = hash(inst.x.mul(13.7).add(inst.z.mul(7.1)).add(inst.y.mul(3.3)));
  const into = smoothstep(plantBand.x, plantBand.y, away), out = smoothstep(plantBand.z, plantBand.w, away);
  const keep = step(pick, into.mul(1.0001)).mul(mix(step(out, pick), float(1).sub(out), plantSink));
  // Where the air's phase comes from: where the plant stands.
  const ph = world.x.mul(0.137).add(world.z.mul(0.213)).add(world.y.mul(0.11));
  /** A local direction into the frame. */
  const turned = (v: Node<'vec3'>): Node<'vec3'> => ax.mul(v.x).add(up.mul(v.y)).add(az.mul(v.z));
  // Debris lies along the ground: sheared by the slope under it (`tilt`: rise per metre around and along the axis; 0
  // for plants, which grow upright on any slope).
  const slope = side.mul(tilt.x).add(axis.mul(tilt.y));
  /** Where a local offset (m, unturned) goes, relative to the mesh. */
  const placed = (local: Node<'vec3'>): Node<'vec3'> => {
    const d = turned(local);
    return inst.xyz.add(d).add(up.mul(dot(d, slope)));
  };
  /** A local normal into the frame, sheared with the position. */
  const normalOf = (n: Node<'vec3'>): Node<'vec3'> => {
    const w = turned(n);
    return normalize(w.sub(slope.mul(dot(w, up))));
  };
  return { inst, world, up, side, axis, keep, ph, turned, placed, normalOf };
}

/**
 * Where a plant's vertex goes: its instance's frame (`plantFrame`), scaled to its height; the air sways it (Scale's
 * vegWind: a slow sway and gusts growing with the square of the vertex's `wind` weight, a quicker shiver, leaves
 * fluttering along their normals). Returns the position node and the frame for normals.
 */
function plantVertex(flutter: number, seed: Node<'float'> = float(0)) {
  const { inst, keep, ph, placed, normalOf } = plantFrame();
  const h = inst.w.mul(keep);
  // The air: the shapes were made for trees of about 14 m.
  const t = time;
  const gust = float(0.55).add(sin(t.mul(0.37).add(ph.mul(0.5))).mul(sin(t.mul(0.23).add(ph.mul(0.9)).add(1.3))).mul(0.45));
  const s = gust.add(0.35).mul(0.5);
  const w = attribute<'float'>('wind', 'float'), w2 = w.mul(w);
  const sway = sin(t.mul(1.05).add(ph)).mul(0.45).add(0.55);
  const p = positionLocal;
  const bp = ph.mul(3).add(dot(p, vec3(0.45, 0.31, 0.38)).mul(14));
  // In the plant's own unit-high space: metres / 14.
  const swayAlong = s.mul(w2).mul(0.42 / 14).mul(sway).add(sin(t.mul(2.1).add(bp)).mul(s).mul(w2).mul(w).mul(0.13 / 14));
  const swayAcross = sin(t.mul(1.8).add(bp.mul(0.8)).add(1.7)).mul(s).mul(w2).mul(w).mul(0.13 / 14);
  let local: Node<'vec3'> = p.add(vec3(swayAlong, swayAlong.mul(swayAlong).mul(-0.12 * 14), swayAcross));
  if (flutter) local = local.add(normalLocal.mul(sin(t.mul(9).add(seed.mul(40)).add(bp.mul(2))).mul(flutter * 0.05 / 14).mul(s).mul(w)));
  const position = placed(local.mul(h));
  const normal = varying(normalOf(normalLocal));
  return { position, normal };
}

/** The normal map's normal in world space, from screen derivatives (no tangents): three's getTangentFrame. */
function mappedNormal(n: Node<'vec3'>, st: Node<'vec2'>, mapN: Node<'vec3'>): Node<'vec3'> {
  const q0 = dFdx(positionWorld), q1 = dFdy(positionWorld), st0 = dFdx(st), st1 = dFdy(st);
  const q1perp = cross(q1, n), q0perp = cross(n, q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x)), B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  const det = max(dot(T, T), dot(B, B));
  const sc = select(det.equal(0), float(0), inverseSqrt(det));
  return normalize(T.mul(sc.mul(mapN.x)).add(B.mul(sc.mul(mapN.y))).add(n.mul(mapN.z)));
}

/** Wood: the bark atlas strip (uv.x = strip * 16 + u around), its normal map, darker deep in the crown. */
export const BARK = kind('bark', ['position', 'normal', 'uv', 'wind', 'occ', 'plant'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const v = plantVertex(0);
  m.positionNode = v.position;
  const st = uv(), occ = attribute<'float'>('occ', 'float');
  const S = float(BARK_STRIPS);
  const strip = floor(st.x.div(16));
  const bUv = vec2(st.x.sub(strip.mul(16)), st.y);
  const at = vec2(strip.add(0.012).add(fract(bUv.x).mul(0.976)).div(S), bUv.y);
  const gx = dFdx(bUv).mul(vec2(float(0.976).div(S), 1)), gy = dFdy(bUv).mul(vec2(float(0.976).div(S), 1));
  const c = texture(barkMap, at).grad(gx, gy).rgb;
  const mapN = texture(barkNormal, at).grad(gx, gy).xyz.mul(2).sub(1);
  const n = mappedNormal(normalize(v.normal), st, vec3(mapN.xy.mul(1.1), mapN.z));
  m.colorNode = throughAir(c.mul(float(1).sub(occ.mul(0.6))).mul(sunlit(plantHorizon, n)));
  return m;
});

/**
 * Leaf cards: the leaf atlas, alpha-tested (in the shadow pass too, so shadows are leaf-shaped), a per-card tint, deep
 * cards darker; lit with wrapped light, the way light comes through and around a crown. Normals are the crown's.
 */
export const LEAF = kind('leaf', ['position', 'normal', 'uv', 'wind', 'tint', 'occ', 'plant'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  const tint = attribute<'float'>('tint', 'float'), occ = attribute<'float'>('occ', 'float');
  const v = plantVertex(1, tint);
  m.positionNode = v.position;
  const st = uv();
  const leaf = texture(leafMap, st);
  // Keep thin leaves from vanishing in the smaller mips.
  const dxA = dFdx(st.mul(LEAF_ATLAS)), dyA = dFdy(st.mul(LEAF_ATLAS));
  const lod = max(log2(max(dot(dxA, dxA), dot(dyA, dyA))).mul(0.5), 0);
  const alpha = clamp(leaf.a.mul(lod.mul(0.32).add(1)), 0, 1);
  m.maskNode = alpha.greaterThan(0.45);
  const tv = tint.sub(0.5);
  let col: Node<'vec3'> = leaf.rgb.mul(tv.mul(0.4).add(1));
  col = mix(col, col.mul(vec3(1.12, 1.06, 0.7)), max(tv, 0).mul(0.5));
  col = col.mul(float(1).sub(occ.mul(0.62)));
  m.colorNode = throughAir(col.mul(sunlit(plantHorizon, normalize(v.normal), 0.7)));
  return m;
});

/** Crown hulls for the middle distance: vertex colours, a mottle, and edges that dissolve in noise. */
export const HULL = kind('hull', ['position', 'normal', 'color', 'kind', 'wind', 'plant'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const v = plantVertex(0);
  m.positionNode = v.position;
  const crown = attribute<'float'>('kind', 'float');
  const inst = attribute<'vec4'>('plant', 'vec4');
  const at = varying(positionLocal.mul(14).add(inst.xyz.mul(0.37)));
  const nz = mx_noise_float(at.mul(0.5)).mul(0.3).add(0.5).mul(0.6).add(mx_noise_float(at.mul(1.2)).mul(0.3).add(0.5).mul(0.4));
  const n = normalize(v.normal);
  const edge = float(1).sub(abs(dot(n, normalize(positionWorld.sub(cameraPosition).negate()))));
  m.maskNode = crown.lessThan(0.5).or(edge.mul(edge).mul(1.25).lessThanEqual(nz.add(0.12)));
  const shade = mix(float(1), nz.mul(0.45).add(0.78), step(0.5, crown));
  m.colorNode = throughAir(vertexColor().rgb.mul(shade).mul(sunlit(plantHorizon, n, 0.4)));
  return m;
});

/**
 * Ground cover (gen/grass.ts; gen/scatter.ts plants it where its floor layer is): tufts of blades in vertex colours,
 * both sides, lit like the ground under them with a little light through the blades. They take shadows, cast none. The
 * air bends them: waves roll along the axis (the habitat's air drifts that way), in gusts, and each blade shivers.
 */
export const GRASS = kind('grass', ['position', 'normal', 'color', 'wind', 'plant'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  const { inst, world, up, side, axis, keep, ph, placed, normalOf } = plantFrame();
  const h = inst.w.mul(keep), t = time;
  const w = attribute<'float'>('wind', 'float'), w2 = w.mul(w), p = positionLocal;
  const wave = sin(t.mul(1.7).sub(world.z.mul(0.4)).add(sin(ph).mul(0.8))).mul(0.5).add(0.5);
  const gust = sin(t.mul(0.31).add(world.z.mul(0.05))).mul(0.5).add(0.5);
  const shiver = sin(t.mul(7.3).add(ph.mul(13)).add(dot(p, vec3(19, 7, 23))));
  const bend = float(0.2).add(wave.mul(gust).mul(0.8));
  // Metres: the tip bends a fifth of the tuft's height in a full gust, the way the air goes, and shivers across it.
  const push = axis.mul(0.85).add(side.mul(0.5)).mul(bend.mul(0.2)).add(side.mul(shiver.mul(0.03))).mul(w2).mul(h);
  // A bent blade dips: about the square of how far it leans over its height.
  const dip = push.dot(push).div(max(h, 0.05)).mul(0.5);
  m.positionNode = placed(p.mul(h)).add(push).sub(up.mul(dip));
  const n = varying(normalOf(normalLocal));
  m.colorNode = throughAir(vertexColor().rgb.mul(sunlit(plantHorizon, normalize(n), 0.5)));
  return m;
});

/**
 * Stones (gen/stones.ts; gen/scatter.ts lays them along the slope where gravel, bare earth or rock is): vertex colours
 * (rock, darker at the ground, moss on top) with a fine grain in metres over them, lit by the sunline. They cast
 * shadows. Fallen trunks and branches are drawn with the bark (BARK).
 */
export const STONE = kind('stone', ['position', 'normal', 'color', 'plant'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const { inst, keep, placed, normalOf } = plantFrame();
  m.positionNode = placed(positionLocal.mul(inst.w.mul(keep)));
  const n = varying(normalOf(normalLocal));
  // The grain: a stone's own surface in metres (each stone its own, by where it lies), a hand and a finger across.
  const at = varying(positionLocal.mul(inst.w).add(inst.xyz.mul(0.37)));
  const grain = mx_noise_float(at.mul(9)).mul(0.12).add(mx_noise_float(at.mul(31)).mul(0.08)).add(1);
  m.colorNode = throughAir(vertexColor().rgb.mul(grain).mul(sunlit(plantHorizon, normalize(n))));
  return m;
});

/** The game's own attributes on the Stage's warm-up stand-ins (StageOptions.attribute): no morph, open horizons. */
export function standInAttribute(g: BufferGeometry, name: string): boolean {
  if (name === 'morph') g.setAttribute('morph', new Float32BufferAttribute(new Array(12).fill(0), 4));
  else if (name === 'grid' || name === 'flow') g.setAttribute(name, new Float32BufferAttribute(new Array(12).fill(0), 4));
  else if (name === 'dir') g.setAttribute('dir', new Float32BufferAttribute([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], 4));
  else if (name === 'corner') g.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1], 2));
  else if (name === 'horizon') g.setAttribute('horizon', new Float32BufferAttribute([OPEN_SKY, OPEN_SKY, 0, 0, OPEN_SKY, OPEN_SKY, 0, 0, OPEN_SKY, OPEN_SKY, 0, 0], 4));
  else if (name === 'plant') plantInstances(g, new Float32Array([0, 0, 0, 1, 0, 0, 0]));
  else if (name === 'uv') g.setAttribute('uv', new Float32BufferAttribute(new Array(6).fill(0), 2));
  else if (name === 'floorA' || name === 'floorB') g.setAttribute(name, new Uint8BufferAttribute(new Array(12).fill(name === 'floorA' ? 255 : 0), 4, true));
  else if (name === 'canopy') g.setAttribute('canopy', new Float32BufferAttribute([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], 4));
  else if (name === 'wind' || name === 'occ' || name === 'tint' || name === 'kind') g.setAttribute(name, new Float32BufferAttribute([0, 0, 0], 1));
  else return false;
  return true;
}

/**
 * Put a cell's plants on a geometry as its instances: `PLANT_STRIDE` floats each (x, y, z, height, turn, slope around
 * and along), one buffer read as the `plant` (vec4), `turn` (float) and `tilt` (vec2) attributes. The one way plants get onto a mesh (stand-ins too, so the
 * warm-up builds the very layout the plants draw with). Pass the buffer of another mesh to share it (a tree's wood and
 * leaves).
 */
export function plantInstances(g: BufferGeometry, data: Float32Array | InstancedInterleavedBuffer): void {
  const buffer = data instanceof InstancedInterleavedBuffer ? data : new InstancedInterleavedBuffer(data, PLANT_STRIDE);
  g.setAttribute('plant', new InterleavedBufferAttribute(buffer, 4, 0));
  g.setAttribute('turn', new InterleavedBufferAttribute(buffer, 1, 4));
  g.setAttribute('tilt', new InterleavedBufferAttribute(buffer, 2, 5));
}

/** Whether an attribute is one of a plant mesh's own instances (`plantInstances`), not its shape's (shared by every cell). */
export const isPlantInstance = (attribute: string): boolean => attribute === 'plant' || attribute === 'turn' || attribute === 'tilt';

/** The kinds of the view outside, for its Stage's warm-up (windows will add them to the interior's). */
export function outsideKinds(): readonly Kind[] {
  return [SKY, STARS, SKIN, SKIN_DETAIL, RADIATOR, HARDWARE, FLAME, BORE, LAMP];
}

/** Things the physics moves (for now the debug menu's test balls): one colour, lit by the sunline, through the air. */
export const BALL = kind('ball', ['position', 'normal'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = throughAir(vec3(0.75, 0.32, 0.08).mul(sunlit()));
  return m;
});

/** Every kind, for the Stage's warm-up. */
export function allKinds(): readonly Kind[] {
  return [GROUND, WATER, SUNLINE, BALL, BARK, LEAF, HULL, GRASS, STONE];
}
