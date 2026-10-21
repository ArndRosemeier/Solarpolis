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
import { Fn, If, abs, attribute, clamp, dFdx, dFdy, exp, float, floor, int, length, log, max, min, mix, mx_noise_float, fract, dot, normalize, positionWorld, pow, select, smoothstep, sqrt, texture, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import { FLOOR_LAYERS, type FloorLayer, type HabitatParams } from '../blueprint';
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

/** A floor layer's share at a point (0 … 1): the tiles carry the eight layers' shares as `floorA` and `floorB`. */
export function floorShare(layer: FloorLayer): Node<'float'> {
  const i = FLOOR_LAYERS.indexOf(layer), v = attribute<'vec4'>(i < 4 ? 'floorA' : 'floorB', 'vec4');
  return [v.x, v.y, v.z, v.w][i % 4];
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

/**
 * Three numbers in 0 … 1 for a lattice cell (whole-number coordinates, up to some ten thousand): a few multiplies and
 * fractions (Dave Hoskins' hash without sine), cheap enough to run for eight cells per pixel of ground.
 */
function cellHash(c: Node<'vec3'>): Node<'vec3'> {
  const a = fract(c.mul(vec3(0.1031, 0.103, 0.0973)));
  const b = a.add(dot(a, a.yxz.add(33.33)));
  return fract(b.xxy.add(b.yxx).mul(b.zyx));
}

/**
 * A pixel's footprint on the ground (m): long down the line of sight on ground seen at a slant, short across it.
 * `shown(size)` is how much of a pattern of that size may show: while the footprint's area is well under it (`foot`, the
 * geometric mean), and as long as the long side (`reach`) still samples it twice, or it would alias into streaks
 * along the view. Past that, a pattern gives way to its mean.
 */
function footprint(): { foot: Node<'float'>; reach: Node<'float'>; shown: (size: Node<'float'>) => Node<'float'> } {
  const fx = length(dFdx(positionWorld)), fy = length(dFdy(positionWorld));
  const reach = max(fx, fy), foot = sqrt(fx.mul(fy));
  return { foot, reach, shown: (size) => float(1).sub(smoothstep(0.15, 0.45, foot.div(size))).mul(float(1).sub(smoothstep(0.5, 1, reach.div(size)))) };
}

/** A crown's radius in its cell (the cells are the trees' spacing apart), for a mean-sized tree. */
const CROWN = 0.8;
/**
 * With a crown in every cell by chance P, the share of the ground they cover is 1 − e^(−CLOSE · P): the cells are a
 * jittered 3D lattice sliced by the ground, so crowns overlap and leave gaps as a real canopy does.
 */
const CLOSE = 2.14;
/** The crowns' light, at their tops and its mean over a crown: the hull level's crowns (HULL) look the same on average. */
const CROWN_TOP = 0.85;
const CROWN_MEAN = 0.5;
/** The floor between the crowns of a closed wood keeps this share of its light. */
const GAP_SHADE = 0.25;

/**
 * The woods from afar (GROUND, past the trees' last level, docs/far-view.md): crowns and the shaded gaps between them,
 * clumps, and stands that thin into glades, drawn per pixel from a tile point's crown `cover` (0 … 1) and the trees'
 * `spacing` (m). `ground` is the floor's colour from afar, `crown` the crowns'. Each scale fades to its mean once a
 * pixel's footprint would make it shimmer, so a wood seen across the habitat has the light of the same wood seen close.
 * Closed woods stay closed and open land stays open: the stands and clumps only move the cover where it is between.
 */
export function woodsFromAfar(ground: Node<'vec3'>, crown: Node<'vec3'>, cover: Node<'float'>, spacing: Node<'float'>, world: Node<'vec3'>): Node<'vec3'> {
  const { foot, shown } = footprint();
  const cell = max(spacing, 2);
  // Stands (two dozen trees across), groves (ten) and clumps (five): the cover wanders where the woods are open or
  // thinning, so their edges break into groves and clearings rather than fading over the tile's points.
  const between = sqrt(clamp(cover.mul(float(1).sub(cover)), 0, 0.25)).mul(2);
  const stands = mx_noise_float(world.div(cell.mul(24))).mul(shown(cell.mul(24)));
  const groves = mx_noise_float(world.div(cell.mul(10)).add(vec3(3.7, 11.2, 1.9))).mul(shown(cell.mul(10)));
  const clumps = mx_noise_float(world.div(cell.mul(5)).add(vec3(17.3, 5.1, 9.7))).mul(shown(cell.mul(5)));
  const local = clamp(cover.add(stands.mul(0.8).add(groves.mul(0.55)).add(clumps.mul(0.4)).mul(between)), 0, 1);
  // The crowns: one per cell by chance, so that together they cover `local`; the nearest one decides.
  const chance = clamp(log(max(float(1).sub(local.mul(0.999)), 1e-3)).negate().div(CLOSE), 0, 1);
  const p = world.div(cell), base = floor(p.sub(0.5));
  let q: Node<'float'> = float(9);
  for (let o = 0; o < 8; o++) {
    const c = base.add(vec3(o & 1, (o >> 1) & 1, (o >> 2) & 1));
    const jitter = cellHash(c);
    const there = fract(jitter.x.mul(7.31).add(jitter.y.mul(3.17)).add(jitter.z.mul(5.73))).lessThan(chance);
    const d = length(p.sub(c.add(jitter.mul(0.6).add(0.2)))).div(jitter.z.mul(0.3).add(0.85).mul(CROWN));
    q = select(there, min(q, d), q);
  }
  const edge = foot.div(cell.mul(CROWN)).add(0.04);
  const inside = float(1).sub(smoothstep(float(1).sub(edge), float(1).add(edge), q));
  // Lit tops, darker rims (the sunline is overhead); the floor between them in their shade.
  const dome = clamp(float(1).sub(q.mul(q).mul(0.5)), 0.5, 1);
  // A dome's mean over a crown is 0.75 (q² is even over its disc): the light runs from the mean there to the top's.
  const slope = (CROWN_TOP - CROWN_MEAN) / 0.25;
  const crowns = crown.mul(dome.mul(slope).add(CROWN_TOP - slope));
  const gap = ground.mul(mix(float(1), float(GAP_SHADE), smoothstep(0.15, 0.6, local)));
  const near = mix(gap, crowns, inside);
  // Beyond the crowns' size: their mean over the covered share.
  const covered = float(1).sub(exp(chance.mul(-CLOSE)));
  const far = mix(gap, crown.mul(CROWN_MEAN), covered);
  // The land itself is never one flat colour: stands and clumps tint it a little, woods and open ground alike.
  return mix(near, far, float(1).sub(shown(cell.mul(2.6)))).mul(stands.mul(0.1).add(groves.mul(0.06)).add(clumps.mul(0.05)).add(1));
}

/** How thick a bed of rock is (m): set per habitat from its relief (`setRockBeds`). */
const rockBed = uniform(30);
/** The habitat's radius (m): the streaks' spacing around the axis is measured at it. */
const rockRadius = uniform(4000);
/** Rock beds are a fifth of a terrace step thick: a cliff shows a few of them, an endcap's face dozens. */
export function setRockBeds(terraceStep: number, radius: number): void {
  rockBed.value = terraceStep / 5;
  rockRadius.value = radius;
}
/**
 * The way the beds dip (unit, world): mostly across the axis, so they cross an endcap as folded stripes and a cliff as
 * slanting bands, never as rings around the axis.
 */
const DIP = new Vector3(0.8, 0.45, 0.4).normalize();
/** Beds come in packages of this many, each package one tone: darker and warmer, plain, paler and cooler. */
const PACKAGE = 4;
const BED_TONES: [number, [number, number, number]][] = [[0.35, [0.8, 0.74, 0.66]], [0.4, [1, 1, 1]], [0.25, [1.16, 1.16, 1.22]]];
const BED_MEAN = BED_TONES.reduce((sum, [share, t]) => sum + share * (t[0] + t[1] + t[2]) / 3, 0);
/** Lichen on rock: how much of it a patch holds on average, and its colour against the rock's grey. */
const LICHEN_MEAN = 0.2;
const LICHEN = vec3(0.95, 1.05, 0.62);

/** Streaks down steep rock where water runs (darker), as a share of the rock's light, and how much of it they cover. */
const STREAK_DARK = 0.7, STREAK_MEAN = 0.3;

/**
 * Rock from afar (GROUND, where the floor is rock: the `rock` share, docs/far-view.md): the climate's one rock colour
 * becomes packages of darker, warmer and paler beds, folded and dipping across the slope and showing where the rock is
 * steep (on ledges they weather to one surface), dark streaks down the fall line where water runs, broad tones over
 * many beds, and lichen in patches. Each scale gives way to its mean as the footprint grows (`footprint`), so rock seen
 * across the habitat keeps the light it has close up. Ground with no rock skips all of it.
 */
export function rockFromAfar(color: Node<'vec3'>, rock: Node<'float'>, world: Node<'vec3'>, normal: Node<'vec3'>): Node<'vec3'> {
  // Footprints first: derivatives are only defined outside the branch.
  const { shown } = footprint();
  const bed = rockBed;
  const showBeds = shown(bed.mul(1.5)), showStreaks = shown(bed.mul(0.8)), showBroad = shown(bed.mul(30)), showLichen = shown(bed.mul(2.5));
  return Fn(() => {
    const out = vec3(color).toVar();
    If(rock.greaterThan(0.004), () => {
      // The beds: the dip, folded at two scales.
      const fold = mx_noise_float(world.div(bed.mul(20))).mul(6).add(mx_noise_float(world.div(bed.mul(7)).add(vec3(2.3, 9.1, 4.7))).mul(1.5));
      const u = dot(world, vec3(DIP.x, DIP.y, DIP.z)).div(bed).add(fold);
      const toneOf = (k: Node<'float'>): Node<'vec3'> => {
        const pack = cellHash(vec3(floor(k.div(PACKAGE)), 7, 3)).x, own = cellHash(vec3(k, 1, 5)).x.sub(0.5).mul(0.12).add(1);
        let t: Node<'vec3'> = vec3(...BED_TONES[0][1]), from = BED_TONES[0][0];
        for (const [share, tone] of BED_TONES.slice(1)) { t = select(pack.greaterThan(from), vec3(...tone), t); from += share; }
        return t.mul(own);
      };
      const k = floor(u), seam = smoothstep(0.8, 1, fract(u));
      const beds = mix(toneOf(k), toneOf(k.add(1)), seam).div(BED_MEAN);
      // Steep rock shows its beds and its streaks; a ledge's top is one weathered surface. Up is toward the axis.
      const up = vec3(world.x, world.y, 0).normalize().negate();
      const steep = smoothstep(0.15, 0.6, float(1).sub(dot(normal, up)));
      const layered = mix(vec3(1), beds, showBeds.mul(steep));
      // Streaks down the fall line, which on the endcaps runs from the axis outward: narrow around the axis, long along
      // it. The noise's frame is the habitat's (around, and along z), never the surface's, which turns with every facet.
      const around = vec3(world.x, world.y, 0).normalize().mul(rockRadius.div(bed.mul(0.8)));
      const streak = mix(float(STREAK_MEAN), smoothstep(0.1, 0.4, mx_noise_float(around.add(vec3(0, 0, world.z.div(bed.mul(10)))))), showStreaks);
      const wet = float(1).sub(streak.mul(steep).mul(1 - STREAK_DARK));
      // Broad tones over thirty beds, iron-stained: warmer where darker.
      const broad = mx_noise_float(world.div(bed.mul(30)).add(vec3(5.3, 1.7, 8.1))).mul(showBroad);
      const tones = vec3(broad.mul(0.4).add(1), broad.mul(0.32).add(1), broad.mul(0.2).add(1));
      // Lichen in patches of a few beds across.
      const patches = smoothstep(0.05, 0.45, mx_noise_float(world.div(bed.mul(2.5)).add(vec3(11.1, 2.9, 6.4))));
      const lichen = mix(float(LICHEN_MEAN), patches, showLichen).mul(0.5);
      const stone = color.mul(layered).mul(tones).mul(wet);
      out.assign(mix(color, mix(stone, stone.mul(LICHEN), lichen), rock));
    });
    return out;
  })() as unknown as Node<'vec3'>;
}
