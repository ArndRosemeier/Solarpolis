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
import { MeshBasicNodeMaterial, DoubleSide, type Material } from 'three/webgpu';
import { abs, attribute, cameraPosition, color, dot, exp, float, max, mix, mx_fractal_noise_float, normalize, modelWorldMatrix, normalWorld, positionLocal, positionWorld, pow, smoothstep, uniform, vec3, vec4, vertexColor } from 'three/tsl';
import { Float32BufferAttribute, Vector3, type BufferGeometry } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { StageKind } from '@futuremagic/stage';
import { HAZE_DIAMETER } from '../blueprint';

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

/** Where the eye is in the habitat (world axes, m); set each frame by the view. */
export const view = {
  eye: uniform(new Vector3()),
};

/** A fragment's true world position: the eye plus its camera-relative offset. */
const worldPosition = (): Node<'vec3'> => positionWorld.add(view.eye);

/** The light from the sunline: from the axis, straight up on the floor, sideways on an endcap slope; plus sky light. */
function sunlit(): Node<'float'> {
  const w = worldPosition();
  const toAxis = normalize(vec3(w.x.negate(), w.y.negate(), float(0)));
  return max(dot(normalWorld, toAxis), 0).mul(float(1).sub(air.skyLight)).add(air.skyLight);
}

/** The look of distant things: mix towards the haze by the length of air between the eye and the point. */
function throughAir(c: Node<'vec3'>): Node<'vec3'> {
  const d = positionWorld.sub(cameraPosition).length();
  const seen = exp(d.mul(air.extinction).negate());
  return mix(air.haze, c, seen);
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
 * Its meshes carry position, normal, color and morph (tiles.ts).
 */
export const GROUND = kind('ground', ['position', 'normal', 'color', 'morph'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  const seen = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.sub(cameraPosition).length();
  const blend = smoothstep(morphFar.mul(MORPH_START), morphFar, seen);
  m.positionNode = positionLocal.add(attribute<'vec3'>('morph', 'vec3').mul(blend));
  // Close up, the ground gets a mottle of tufts and bare patches (metres across), finer than its grid; it fades out
  // with distance before it could shimmer. Plants will take over from it.
  const near = float(1).sub(smoothstep(150, 1200, positionWorld.sub(cameraPosition).length()));
  const mottle = mx_fractal_noise_float(worldPosition().mul(1 / 5), 4, 2.1, 0.5).mul(0.35).mul(near).add(1);
  m.colorNode = throughAir(vertexColor().rgb.mul(sunlit()).mul(mottle));
  return m;
});

/** The sunline: the glowing tube along the axis. Brighter than white, so the tone mapping rolls it off. */
export const SUNLINE = kind('sunline', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  m.colorNode = throughAir(vec3(6, 5.4, 4.6));
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

/** The game's own attributes on the Stage's warm-up stand-ins (StageOptions.attribute): zero morph. */
export function standInAttribute(g: BufferGeometry, name: string): boolean {
  if (name !== 'morph') return false;
  g.setAttribute('morph', new Float32BufferAttribute(new Array(9).fill(0), 3));
  return true;
}

/** Every kind, for the Stage's warm-up. */
export function allKinds(): readonly Kind[] {
  return [GROUND, WATER, SUNLINE];
}
