/**
 * The material registry (docs/SHADERS.md): every material in the game is one of these kinds, and every mesh of a kind
 * shares the kind's one material. The Stage warms them all behind the loading screen, so nothing compiles in play.
 *
 * The light inside a cylinder comes from the sunline along the axis, so it falls on every point from the axis
 * direction: the ground shaders light themselves from there, with no three.js lights at all. Then the air: looking
 * across the habitat, distant ground fades into the bright blue haze of kilometres of lit air.
 */
import { MeshBasicNodeMaterial, DoubleSide, type Material } from 'three/webgpu';
import { cameraPosition, color, dot, exp, float, max, mix, mx_fractal_noise_float, normalize, normalWorld, positionWorld, smoothstep, uniform, vec3, vertexColor } from 'three/tsl';
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
 * The ground of the whole interior (floor and endcap slopes): vertex colour, lit from the axis, seen through the air.
 * Its meshes carry position, normal and color.
 */
export const GROUND = kind('ground', ['position', 'normal', 'color'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial();
  // Towards the axis, where the sunline is: straight up on the floor, sideways for an endcap slope.
  const toAxis = normalize(vec3(positionWorld.x.negate(), positionWorld.y.negate(), float(0)));
  const lit = max(dot(normalWorld, toAxis), 0).mul(float(1).sub(air.skyLight)).add(air.skyLight);
  // Close up, the coarse grid's flat cells get a mottle of tufts and bare patches (metres across); it fades out with
  // distance before it could shimmer. The detailed ground near the viewer replaces this with the chunk stage.
  const near = float(1).sub(smoothstep(150, 1200, positionWorld.sub(cameraPosition).length()));
  const mottle = mx_fractal_noise_float(positionWorld.mul(1 / 5), 4, 2.1, 0.5).mul(0.35).mul(near).add(1);
  m.colorNode = throughAir(vertexColor().rgb.mul(lit).mul(mottle));
  return m;
});

/** The sunline: the glowing tube along the axis. Brighter than white, so the tone mapping rolls it off. */
export const SUNLINE = kind('sunline', ['position', 'normal'], { cast: false, receive: false }, () => {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  m.colorNode = throughAir(vec3(6, 5.4, 4.6));
  return m;
});

/** Every kind, for the Stage's warm-up. */
export function allKinds(): readonly Kind[] {
  return [GROUND, SUNLINE];
}
