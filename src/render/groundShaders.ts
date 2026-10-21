/**
 * The ground up close (GROUND in materials.ts): the floor layers of gen/groundTex.ts (grass, litter, sand, rock …),
 * drawn from texture arrays the workers fill in. At each point the two layers with the largest shares (`floorA`,
 * `floorB` attributes, from `ecology.colorAt`) are blended by their own relief, so grass grows between stones rather
 * than fading into them.
 *
 * Mapping: biplanar (two projections of the three axes, weighted by the normal), in metres from a point near the eye
 * that is a whole number of every layer's tiles away from the world's origin (`setFloorEye`), so the textures are
 * exact however far the eye is from the origin and never show a seam.
 *
 * The far look stays the ground's own colour: each layer's texels are scaled so that its mean is the vertex colour,
 * and the mips average a layer to that mean as it recedes. So the textures add detail as the eye comes close and
 * take nothing away from afar.
 */
import { DataArrayTexture, Vector3, type Node } from 'three/webgpu';
import { filtered } from './textures';
import { abs, attribute, clamp, dFdx, dFdy, float, int, max, min, mix, normalize, positionWorld, pow, select, smoothstep, texture, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import { FLOOR_LAYERS, type HabitatParams } from '../blueprint';
import type { WorkerPool } from '../workers/pool';
import { GROUND_LAYERS, GROUND_TEX } from '../gen/groundTex';

const L = FLOOR_LAYERS.length, S = GROUND_TEX;
/** A distance every layer's tile divides (m): the eye's offset is taken modulo this. */
const PERIOD = 12;

function layers(srgb: boolean, fill: [number, number, number, number]): DataArrayTexture {
  const data = new Uint8Array(S * S * 4 * L);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return filtered(new DataArrayTexture(data, S, S, L), { srgb, mips: true, anisotropy: 8, repeat: true });
}
/** Placeholders until the workers have drawn the layers: a plain mid grey, flat, unshaded. */
const albedoTex = layers(true, [128, 128, 128, 255]);
const reliefTex = layers(false, [128, 128, 128, 255]);
const GREY = 0.2158605; // sRGB 128, linear
const means = uniformArray(Array.from({ length: L }, () => new Vector3(GREY, GREY, GREY)), 'vec3');
const scales = uniformArray(GROUND_LAYERS.map((l) => 1 / l.W), 'float');
const origin = uniform(new Vector3());

/** Load one drawn layer (its albedo, relief and mean colour) into the arrays the kind was built with. */
export function setFloorLayer(index: number, albedo: Uint8Array, relief: Uint8Array, mean: readonly [number, number, number]): void {
  (albedoTex.image.data as Uint8Array).set(albedo, index * S * S * 4);
  (reliefTex.image.data as Uint8Array).set(relief, index * S * S * 4);
  albedoTex.needsUpdate = reliefTex.needsUpdate = true;
  (means.array[index] as Vector3).set(mean[0], mean[1], mean[2]);
}

/** Bytes the floor textures hold, mips included. */
export const FLOOR_BYTES = (S * S * 4 * L * 2 * 4) / 3;

let asked = false;
/** Have the workers draw the floor layers, once per page (they are the same for every habitat). */
export function loadFloor(pool: WorkerPool, params: HabitatParams): void {
  if (asked) return;
  asked = true;
  for (let layer = 0; layer < L; layer++) {
    void pool.job({ kind: 'floor', params, layer }).then((a) => { if ('relief' in a) setFloorLayer(a.layer, a.albedo, a.relief, a.mean); });
  }
}

/** The eye's world position (float64): the textures are mapped from the nearest whole period to it. */
export function setFloorEye(eye: readonly [number, number, number]): void {
  const m = (x: number) => x - Math.floor(x / PERIOD) * PERIOD;
  origin.value.set(m(eye[0]), m(eye[1]), m(eye[2]));
}

/**
 * The index of the largest of some values, and of the second largest. Integers from the start: three r186 drops a
 * float index's conversion when it feeds a texture array's layer in `.grad()` sampling, which WGSL refuses.
 */
function topTwo(w: Node<'float'>[]): { a: Node<'int'>; b: Node<'int'>; va: Node<'float'>; vb: Node<'float'> } {
  let a: Node<'int'> = int(0), va: Node<'float'> = w[0], b: Node<'int'> = int(1), vb: Node<'float'> = float(-1);
  for (let k = 1; k < w.length; k++) {
    const over = w[k].greaterThan(va), second = w[k].greaterThan(vb);
    b = select(over, a, select(second, int(k), b));
    vb = select(over, va, select(second, w[k], vb));
    a = select(over, int(k), a);
    va = select(over, w[k], va);
  }
  return { a, b, va, vb };
}

/** A projection of a 3-vector on the plane across axis `axis` (0 x, 1 y, 2 z). */
const across = (axis: Node<'float'>, v: Node<'vec3'>): Node<'vec2'> => select(axis.lessThan(0.5), v.yz, select(axis.lessThan(1.5), v.zx, v.xy));
/** The plane's two directions in world space. */
const tangents = (axis: Node<'float'>): [Node<'vec3'>, Node<'vec3'>] => [
  select(axis.lessThan(0.5), vec3(0, 1, 0), select(axis.lessThan(1.5), vec3(0, 0, 1), vec3(1, 0, 0))),
  select(axis.lessThan(0.5), vec3(0, 0, 1), select(axis.lessThan(1.5), vec3(1, 0, 0), vec3(0, 1, 0))),
];

/**
 * The ground's colour and normal up close: `color` is its colour from afar (the vertex colour), `normal` the
 * surface's. Returns the colour with the floor's texels (shaded by their occlusion) and the normal with their relief.
 */
export function floorSurface(color: Node<'vec3'>, normal: Node<'vec3'>): { color: Node<'vec3'>; normal: Node<'vec3'> } {
  const fa = attribute<'vec4'>('floorA', 'vec4'), fb = attribute<'vec4'>('floorB', 'vec4');
  const top = topTwo([fa.x, fa.y, fa.z, fa.w, fb.x, fb.y, fb.z, fb.w]);
  const p = positionWorld.add(origin), dx = dFdx(p), dy = dFdy(p);
  // Biplanar: the axis the normal is most along, and the middle one.
  const n = abs(normal);
  const major = select(n.x.greaterThan(max(n.y, n.z)), float(0), select(n.y.greaterThan(n.z), float(1), float(2)));
  const minor = select(n.x.lessThan(min(n.y, n.z)), float(0), select(n.y.lessThan(n.z), float(1), float(2)));
  const middle = float(3).sub(major).sub(minor);
  const along = (axis: Node<'float'>) => select(axis.lessThan(0.5), n.x, select(axis.lessThan(1.5), n.y, n.z));
  const w = pow(clamp(vec2(along(major), along(middle)).sub(0.5773).div(1 - 0.5773), 0, 1), vec2(4, 4));
  const wSum = max(w.x.add(w.y), 1e-4);

  // One layer, both projections: albedo (linear) × occlusion, the relief's height, and its tangent slope in world space.
  const layerAt = (layer: Node<'int'>) => {
    const k = scales.element(layer) as unknown as Node<'float'>;
    let albedo: Node<'vec3'> = vec3(0), height: Node<'float'> = float(0), slope: Node<'vec3'> = vec3(0);
    for (const [axis, weight] of [[major, w.x], [middle, w.y]] as const) {
      const uv = across(axis, p).mul(k), gx = across(axis, dx).mul(k), gy = across(axis, dy).mul(k);
      const c = texture(albedoTex, uv).grad(gx, gy).depth(layer);
      const r = texture(reliefTex, uv).grad(gx, gy).depth(layer);
      const [t, b] = tangents(axis);
      albedo = albedo.add(c.rgb.mul(r.a).mul(weight));
      height = height.add(r.b.mul(weight));
      slope = slope.add(t.mul(r.r.mul(2).sub(1)).add(b.mul(r.g.mul(2).sub(1))).mul(weight));
    }
    return { albedo: albedo.div(wSum), height: height.div(wSum), slope: slope.div(wSum), mean: means.element(layer) as unknown as Node<'vec3'> };
  };
  const A = layerAt(top.a), B = layerAt(top.b);
  // Height blending: the layer standing higher shows where their shares are close.
  const share = top.vb.div(max(top.va.add(top.vb), 1e-4));
  const k = smoothstep(-0.12, 0.12, share.sub(0.5).add(B.height.sub(A.height).mul(0.35)));
  const albedo = mix(A.albedo, B.albedo, k), mean = mix(A.mean, B.mean, k);
  // Keep the far colour: the blend's mean becomes the vertex colour.
  const near = albedo.mul(color.div(max(mean, vec3(1e-3, 1e-3, 1e-3))));
  const bump = mix(A.slope, B.slope, k);
  return { color: near, normal: normalize(normal.add(bump.sub(normal.mul(bump.dot(normal))))) };
}
