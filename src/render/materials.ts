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
import { abs, atan, attribute, cross, dFdx, dFdy, floor, fract, inverseSqrt, log2, mx_noise_float, uv, cameraPosition, hash, normalLocal, step, time, varying, clamp, color, cos, log, select, sign, sqrt, dot, exp, float, max, mix, mx_fractal_noise_float, normalize, min, modelWorldMatrix, normalWorld, positionLocal, positionWorld, pow, sin, smoothstep, texture, uniform, vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { ClampToEdgeWrapping, DataTexture, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector4, DataUtils, Float32BufferAttribute, HalfFloatType, InstancedInterleavedBuffer, InterleavedBufferAttribute, LinearFilter, RedFormat, Vector2, Vector3, type BufferGeometry } from 'three/webgpu';
import { PLANT_STRIDE } from '../gen/scatter';
import { BARK_STRIPS } from '../gen/trees';
import { BARK_TEXELS } from '../gen/foliage';
import { LEAF_ATLAS_SIZE } from '../workers/leaves';
import type { Node } from 'three/webgpu';
import type { StageKind } from '@futuremagic/stage';
import { HAZE_DIAMETER } from '../blueprint';
import { sunShadow } from './lights';
import { OPEN_SKY } from '../gen/horizon';
import { EMISSION_SAMPLES, SUNLINE_STEPS } from '../world/sunline';
import { HAZE_STEPS } from '../world/air';
import { skyDome, starColor, starVertex } from './skyShaders';
import { flameColor, hardwareColor, radiatorColor, skinColor } from './hullShaders';

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
 * `wrap` lets light reach past the terminator (0 a plain surface; leaves and crowns, which light shines through and
 * around, more).
 */
function sunlit(horizon: Node<'vec2'> = vec2(OPEN_SKY, OPEN_SKY), normal: Node<'vec3'> = normalWorld, wrap = 0): Node<'float'> {
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
export const GROUND = kind('ground', ['position', 'normal', 'color', 'morph', 'horizon', 'canopy'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const seen = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.sub(cameraPosition).length();
  const blend = smoothstep(morphFar.mul(MORPH_START), morphFar, seen);
  // Past the trees' last level, the woods are the ground's own canopy layer: it rises to the crowns and takes their
  // colour over the band where the crown hulls hand them over (`setCanopyBand`).
  const canopy = attribute<'vec4'>('canopy', 'vec4');
  const woods = smoothstep(canopyBand.x, canopyBand.y, seen);
  m.positionNode = positionLocal.add(attribute<'vec3'>('morph', 'vec3').mul(blend)).add(normalLocal.mul(canopy.w.mul(woods)));
  const far = varying(woods);
  // Close up, the ground gets a mottle of tufts and bare patches (metres across), finer than its grid; it fades out
  // with distance before it could shimmer. Plants will take over from it.
  const away = positionWorld.sub(cameraPosition).length();
  const near = float(1).sub(smoothstep(150, 1200, away));
  const mottle = mx_fractal_noise_float(worldPosition().mul(1 / 5), 4, 2.1, 0.5).mul(0.35).mul(near).add(1);
  // The canopy's crowns: lit tops and shaded gaps a crown across, fading where they would shimmer.
  const crowns = mx_fractal_noise_float(worldPosition().mul(1 / 6), 2, 2.2, 0.5).mul(0.45).mul(far).mul(smoothstep(1, 5, canopy.w)).mul(float(1).sub(smoothstep(4000, 9000, away))).add(1);
  const ground = mix(vertexColor().rgb, canopy.rgb, far);
  m.colorNode = throughAir(ground.mul(sunlit(attribute<'vec2'>('horizon', 'vec2'))).mul(mottle).mul(crowns));
  return m;
});

/** Where the ground's canopy layer takes over from the trees' crown hulls (m from the eye: from x to y). */
const canopyBand = uniform(new Vector2(1e30, 2e30));
export function setCanopyBand(band: readonly [number, number]): void {
  canopyBand.value.set(band[0], band[1]);
}

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

/**
 * A habitat from outside (hullShaders.ts): the drum's solar skin, its panel patchwork drawn per pixel from the mesh's
 * `userData.skin`. Position, normal.
 */
export const SKIN = kind('skin', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = skinColor();
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
  const m = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false });
  m.colorNode = flameColor();
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
function atlas(width: number, height: number, srgb: boolean): DataTexture {
  const t = new DataTexture(new Uint8Array(width * height * 4).fill(srgb ? 90 : 128), width, height, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const barkMap = atlas(BARK_SIZE.width, BARK_SIZE.height, true);
barkMap.wrapT = RepeatWrapping;
const barkNormal = atlas(BARK_SIZE.width, BARK_SIZE.height, false);
barkNormal.wrapT = RepeatWrapping;
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
 * Where a plant's vertex goes: the instance (`plant`: foot relative to the mesh, height; `turn`) stands toward the axis
 * wherever it is, turned and scaled; the air sways it (Scale's vegWind: a slow sway and gusts growing with the square
 * of the vertex's `wind` weight, a quicker shiver, leaves fluttering along their normals). An instance outside the
 * mesh's band is folded away. Returns the position node and the frame for normals.
 */
function plantVertex(flutter: number, seed: Node<'float'> = float(0)) {
  const inst = attribute<'vec4'>('plant', 'vec4'), turn = attribute<'float'>('turn', 'float');
  const foot = modelWorldMatrix.mul(vec4(inst.xyz, 1)).xyz;
  const world = foot.add(view.eye);
  const up = normalize(vec3(world.x.negate(), world.y.negate(), 0));
  const side = vec3(up.y, up.x.negate(), 0), axis = vec3(0, 0, 1);
  const c = cos(turn), sn = sin(turn);
  const ax = side.mul(c).add(axis.mul(sn)), az = side.mul(sn.negate()).add(axis.mul(c));
  // The band: each plant has its own threshold, so in a hand-over band one level takes it where the other leaves it.
  const away = foot.sub(cameraPosition).length();
  const pick = hash(inst.x.mul(13.7).add(inst.z.mul(7.1)).add(inst.y.mul(3.3)));
  const into = smoothstep(plantBand.x, plantBand.y, away), out = smoothstep(plantBand.z, plantBand.w, away);
  const keep = step(pick, into.mul(1.0001)).mul(step(out, pick));
  const h = inst.w.mul(keep);
  // The air: phase from where the plant stands; the shapes were made for trees of about 14 m.
  const ph = world.x.mul(0.137).add(world.z.mul(0.213)).add(world.y.mul(0.11));
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
  const scaled = local.mul(h);
  const position = inst.xyz.add(ax.mul(scaled.x)).add(up.mul(scaled.y)).add(az.mul(scaled.z));
  const normal = varying(normalize(ax.mul(normalLocal.x).add(up.mul(normalLocal.y)).add(az.mul(normalLocal.z))));
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

/** The game's own attributes on the Stage's warm-up stand-ins (StageOptions.attribute): no morph, open horizons. */
export function standInAttribute(g: BufferGeometry, name: string): boolean {
  if (name === 'morph') g.setAttribute('morph', new Float32BufferAttribute(new Array(9).fill(0), 3));
  else if (name === 'corner') g.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1], 2));
  else if (name === 'horizon') g.setAttribute('horizon', new Float32BufferAttribute(new Array(6).fill(OPEN_SKY), 2));
  else if (name === 'plant') plantInstances(g, new Float32Array([0, 0, 0, 1, 0]));
  else if (name === 'uv') g.setAttribute('uv', new Float32BufferAttribute(new Array(6).fill(0), 2));
  else if (name === 'canopy') g.setAttribute('canopy', new Float32BufferAttribute([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], 4));
  else if (name === 'wind' || name === 'occ' || name === 'tint' || name === 'kind') g.setAttribute(name, new Float32BufferAttribute([0, 0, 0], 1));
  else return false;
  return true;
}

/**
 * Put a cell's plants on a geometry as its instances: `PLANT_STRIDE` floats each (x, y, z, height, turn), one buffer
 * read as the `plant` (vec4) and `turn` (float) attributes. The one way plants get onto a mesh (stand-ins too, so the
 * warm-up builds the very layout the plants draw with). Pass the buffer of another mesh to share it (a tree's wood and
 * leaves).
 */
export function plantInstances(g: BufferGeometry, data: Float32Array | InstancedInterleavedBuffer): void {
  const buffer = data instanceof InstancedInterleavedBuffer ? data : new InstancedInterleavedBuffer(data, PLANT_STRIDE);
  g.setAttribute('plant', new InterleavedBufferAttribute(buffer, 4, 0));
  g.setAttribute('turn', new InterleavedBufferAttribute(buffer, 1, 4));
}

/** The kinds of the view outside, for its Stage's warm-up (windows will add them to the interior's). */
export function outsideKinds(): readonly Kind[] {
  return [SKY, STARS, SKIN, RADIATOR, HARDWARE, FLAME];
}

/** Things the physics moves (for now the debug menu's test balls): one colour, lit by the sunline, through the air. */
export const BALL = kind('ball', ['position', 'normal'], { cast: true, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = throughAir(vec3(0.75, 0.32, 0.08).mul(sunlit()));
  return m;
});

/** Every kind, for the Stage's warm-up. */
export function allKinds(): readonly Kind[] {
  return [GROUND, WATER, SUNLINE, BALL, BARK, LEAF, HULL];
}
