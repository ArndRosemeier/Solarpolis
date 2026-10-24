/**
 * The habitat's three.js lights: a fixed pool, made before the warm-up (the number of lights is part of every
 * shader's cache key, docs/SHADERS.md). The registry's kinds light themselves from the sunline inside their own
 * shaders; these light what three.js's own materials draw (Actors' bodies), with the same light, and cast the near
 * shadows:
 *
 *   key  a directional light standing in for the sunline at the player (`lightVector`: where its light comes from on
 *        average, and how strong), past the terrain's horizons there. It casts the near shadow map.
 *   sky  an ambient light for the air's scattered glow (the kinds' sky term).
 *
 * Both are scaled so a white Lambert surface gets what a white ground there gets (three divides diffuse by π).
 *
 * The sunline is a line light, long along the axis and thin across it, so its shadows are soft along the axis and
 * sharp across. The shadow map is drawn from the key light's direction, turned so the map's v runs along the axis;
 * `sunShadow` then follows rays from the lit point toward `SHADOW_RAYS` angles that split the light into equal shares
 * (`lightShares`) through the map, a few steps each, and averages what reaches the line. A thing's shadow stays sharp
 * where it touches the ground and blurs with height, as under a real line light. Ground, water and balls use the same
 * shadow (`sunShadow`, in the sunlit term of materials.ts); Actors' materials get it as the light's own shadow node.
 */
import { AmbientLight, DirectionalLight, type DepthTexture, type Node, type NodeBuilder, type Scene } from 'three/webgpu';
import { Fn, float, min, screenCoordinate, select, shadow, texture, uniform, uniformArray, vec2 } from 'three/tsl';
import { angleDiff } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { horizonAt } from '../gen/horizon';
import type { Terrain } from '../gen/terrain';
import { lightShares, lightVector } from '../world/sunline';
import { LAMPLIGHT } from '../gen/underMesh';

/** Rays toward the line per shaded point, and steps along each. */
export const SHADOW_RAYS = 4;
const SHADOW_STEPS = 5;
/** The shadow map: half its side (m) around the player, its texels, and how far the light stands back (m). */
export const SHADOW_HALF = 40;
const SHADOW_TEXELS = 2048;
const LIGHT_BACK = 200;
/** How high above a point (m) things are looked for that shade it from the line. */
const SHADOW_REACH = 6;
/**
 * The map turns with the light only in steps of this angle (rad), round the axis and along it, and only once the light
 * has turned three quarters of a step past the last one, so a light that drifts or jitters does not turn it at all.
 */
export const SHADOW_TURN = (0.25 * Math.PI) / 180;

export const key = new DirectionalLight(0xffffff, 0);
export const sky = new AmbientLight(0xffffff, 0);
key.name = 'sunline key';
sky.name = 'sky light';
key.castShadow = true;
key.shadow.mapSize.set(SHADOW_TEXELS, SHADOW_TEXELS);
{
  const cam = key.shadow.camera;
  cam.left = -SHADOW_HALF; cam.right = SHADOW_HALF; cam.top = SHADOW_HALF; cam.bottom = -SHADOW_HALF;
  cam.near = 1; cam.far = 2 * LIGHT_BACK;
  // The map's v runs along the axis (+z), so the line's softness runs along v.
  cam.up.set(0, 0, 1);
  cam.updateProjectionMatrix();
}
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;

/** The rays' tilts along the axis (tan of the angle from the key light's direction, toward +z). */
const tilts = uniformArray(new Array(SHADOW_RAYS).fill(0), 'float');
/** Shadow-map units per metre: across the map (uv) and in depth. */
const perMetre = uniform(vec2(1 / (2 * SHADOW_HALF), 1 / (2 * LIGHT_BACK - 1)));

type F = Node<'float'>;
const sunlineFilter = Fn(({ depthTexture, shadowCoord }: { depthTexture: DepthTexture; shadowCoord: Node<'vec3'> }, builder: { renderer: { reversedDepthBuffer: boolean } }) => {
  const lit = (v: F, z: F): F => texture(depthTexture, vec2(shadowCoord.x, v)).compare(z) as unknown as F;
  // Toward the light the depth grows in a reversed depth buffer and shrinks in a normal one.
  const toward = builder.renderer.reversedDepthBuffer ? 1 : -1;
  const jitter = screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189).fract();
  const here = lit(shadowCoord.y, shadowCoord.z);
  let sum: F = float(0);
  for (let k = 0; k < SHADOW_RAYS; k++) {
    const tilt = tilts.element(k) as unknown as F;
    let seen: F = here;
    for (let j = 0; j < SHADOW_STEPS; j++) {
      // Denser near the point, where contact shadows are sharp.
      const f = jitter.add(j).div(SHADOW_STEPS);
      const t = f.mul(f).mul(SHADOW_REACH);
      seen = min(seen, lit(shadowCoord.y.sub(t.mul(tilt).mul(perMetre.x)), shadowCoord.z.add(t.mul(perMetre.y).mul(toward))));
    }
    sum = sum.add(seen);
  }
  // Past the map's far plane nothing was drawn, so nothing shades the point. three r186 tests only z ≤ 1, which in a
  // reversed depth buffer lets everything beyond the far plane through: the floor under a flyer high up (the map
  // follows the eye) drew a dark square.
  return select(shadowCoord.z.lessThan(0).or(shadowCoord.z.greaterThan(1)), float(1), sum.div(SHADOW_RAYS));
});
// three r186 reads `filterNode` from the shadow but does not declare it.
(key.shadow as unknown as { filterNode: unknown }).filterNode = sunlineFilter;

/** The key light's shadow node: Actors' materials get it through the light. */
const keyShadow = shadow(key, key.shadow);
key.shadow.shadowNode = keyShadow;

/**
 * The same shadow as a factor (1 lit … 0 shaded) for the kinds' own colour. A kind that casts shadows is drawn into the
 * shadow map with its colour's alpha (three's shadow pass reads `colorNode.a`), and a shadow pass that samples the map
 * it draws is invalid in WebGPU; so in the shadow pass the factor is a plain 1.
 */
export const sunShadow = Fn((builder: NodeBuilder) =>
  (builder.material as { isShadowPassMaterial?: boolean } | null)?.isShadowPassMaterial ? float(1) : (keyShadow as unknown as F))();

/** Put the pool into the scene (once, before the warm-up). */
export function addLights(scene: Scene): void {
  scene.add(key, key.target, sky);
}

/**
 * The Outside view's own pool (an object has one scene): the lounge's lights for Actors' bodies in the arrival's cabin
 * shot (render/passengers.ts), dark everywhere else. Its cove lamps from above, the light its windows let in from where
 * it comes from on balance, and the room's light from all round off its pale walls.
 */
export const loungeLights = {
  lamps: new DirectionalLight(0xfff0dc, 0),
  windows: new DirectionalLight(0xffffff, 0),
  room: new AmbientLight(0xffffff, 0),
  sun: new DirectionalLight(0xffffff, 0),
};
loungeLights.lamps.name = 'lounge lamps';
loungeLights.windows.name = 'lounge windows';
loungeLights.room.name = 'lounge room light';
loungeLights.sun.name = 'lounge sun';

/** Put the lounge's pool into the Outside scene (once, before its warm-up). */
export function addLoungeLights(scene: Scene): void {
  const l = loungeLights;
  scene.add(l.lamps, l.lamps.target, l.windows, l.windows.target, l.room, l.sun, l.sun.target);
}

/** Below the land: the share of the lamps' light that comes from all round (the rest from above), and how far above the player the key light stands (m): under the ceiling, so nothing up on the land shades them. */
const BELOW_ALL_ROUND = 0.4;
const BELOW_BACK = 8;

/**
 * Light around the world point `p` (the player's middle) below the land, in the Understorey: its lamps overhead, `lamp`
 * as a share of the open land's daylight, as the key light from straight above and the sky light all round.
 */
export function shineBelow(p: Vec3, eye: Vec3, lamp: number): void {
  key.color.setRGB(...LAMPLIGHT);
  sky.color.setRGB(...LAMPLIGHT);
  key.intensity = Math.PI * lamp * (1 - BELOW_ALL_ROUND);
  sky.intensity = Math.PI * lamp * BELOW_ALL_ROUND;
  for (let k = 0; k < SHADOW_RAYS; k++) tilts.array[k] = 0;
  const r = Math.hypot(p[0], p[1]) || 1, up: Vec3 = [-p[0] / r, -p[1] / r, 0], c = toView(eye, p);
  key.target.position.set(c[0], c[1], c[2]);
  key.position.set(c[0] + up[0] * BELOW_BACK, c[1] + up[1] * BELOW_BACK, c[2] + up[2] * BELOW_BACK);
  key.target.updateMatrixWorld();
  key.updateMatrixWorld();
}

/**
 * The day's light on the land straight over the world point `p` (1: the mid floor at midday in the open): the
 * sunline's past the land's horizons there, and the sky light. Below the land, it is what the light wells let down.
 */
export function dayOverhead(h: Habitat, terrain: Terrain, emission: Float32Array, mean: number, skyShare: number, norm: number, p: Vec3): number {
  const at = fromWorld(h.profile, p[0], p[1], p[2]), ground = toWorld(h.profile, { theta: at.theta, s: at.s, h: terrain.heightAt(at.theta, at.s) });
  const [port, wild] = horizonAt(terrain, at.theta, at.s), v = lightVector(h, emission, ground, port, wild, norm);
  return Math.hypot(v[0], v[1], v[2]) * (1 - skyShare) + skyShare * mean * Math.min(1, Math.max(0, (port + wild) / Math.PI));
}

/** The light's turn the map is drawn along: round the axis and along it (rad), held between steps. */
let turn: { around: number; along: number } | null = null;

/**
 * The turn to draw the shadow map along for a light at `around` (round the axis) and `along` (toward +z): the last one
 * while the light stays within three quarters of a `SHADOW_TURN` of it, else the light's own, on whole steps.
 */
export function heldTurn(around: number, along: number): { around: number; along: number } {
  if (!turn || Math.abs(angleDiff(turn.around, around)) > 0.75 * SHADOW_TURN || Math.abs(along - turn.along) > 0.75 * SHADOW_TURN) {
    turn = { around: Math.round(around / SHADOW_TURN) * SHADOW_TURN, along: Math.round(along / SHADOW_TURN) * SHADOW_TURN };
  }
  return turn;
}

/**
 * Light and shade around the world point `p` (the player's middle), seen from the camera's world eye: the hour's
 * emission and mean, the share of sky light, the sunline's scale (`sunlineNorm`). `riding`: the player rides in
 * something that carries them (a capsule), whose own shadows (its seat, its frame, on its passenger) are kept still in
 * the map rather than the land's, which streams past.
 */
export function shineOn(h: Habitat, terrain: Terrain, emission: Float32Array, mean: number, skyShare: number, norm: number, p: Vec3, eye: Vec3, riding = false): void {
  const at = fromWorld(h.profile, p[0], p[1], p[2]);
  const [port, wild] = horizonAt(terrain, at.theta, at.s);
  const v = lightVector(h, emission, p, port, wild, norm);
  const strength = Math.hypot(v[0], v[1], v[2]);
  key.color.setRGB(1, 1, 1);
  sky.color.setRGB(1, 1, 1);
  key.intensity = Math.PI * strength * (1 - skyShare);
  const open = Math.min(1, Math.max(0, (port + wild) / Math.PI));
  sky.intensity = Math.PI * skyShare * mean * open;
  if (strength < 1e-9) return;

  // The light comes from the axis: straight in (`inward`) and turned along the axis by a0. The map is drawn along
  // that direction held in steps (`heldTurn`): every frame it turns, every shadow edge in it is drawn anew, and the
  // snapping below holds only for a map that does not turn. Near the axis (the arrival terrace is 160 m from it) a
  // step of walking turns the light forty times as far as on the floor, and the map's grid, laid from the world's
  // origin tens of kilometres away, slid by whole texels with every hundredth of a degree: the shadows flickered.
  const r = Math.hypot(p[0], p[1]) || 1;
  const held = heldTurn(Math.atan2(-p[1], -p[0]), Math.atan2(v[2], Math.hypot(v[0], v[1])));
  const inward: Vec3 = [Math.cos(held.around), Math.sin(held.around), 0], a0 = held.along;
  const d: Vec3 = [inward[0] * Math.cos(a0), inward[1] * Math.cos(a0), Math.sin(a0)];

  // The rays: the light's equal shares along the axis, as tilts from the map's direction (the held turn along the
  // axis is folded into them, so the soft shadow keeps the light's own angles).
  const shares = lightShares(h, emission, p, [-p[0] / r, -p[1] / r, 0], SHADOW_RAYS, port, wild);
  for (let k = 0; k < SHADOW_RAYS; k++) tilts.array[k] = Math.tan((shares[k] ?? a0) - a0);

  // The map's centre, snapped to whole texels across the light so the land's shadows do not crawl as the player moves;
  // riding, it moves with them, so what carries them keeps its shadows on the same texels (snapped to the land, the
  // capsule's own shadow edges were drawn on new texels every frame of the ride and flickered).
  const upZ = 1 - d[2] * d[2] > 1e-6 ? [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]] : [1, 0, 0];
  const ul = Math.hypot(upZ[0], upZ[1], upZ[2]), up: Vec3 = [upZ[0] / ul, upZ[1] / ul, upZ[2] / ul];
  const right: Vec3 = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  const texel = (2 * SHADOW_HALF) / SHADOW_TEXELS;
  const snap = (x: number): number => (riding ? 0 : Math.round(x / texel) * texel - x);
  const pr = p[0] * right[0] + p[1] * right[1] + p[2] * right[2], pu = p[0] * up[0] + p[1] * up[1] + p[2] * up[2];
  const a = snap(pr), b = snap(pu);
  const centre: Vec3 = [p[0] + right[0] * a + up[0] * b, p[1] + right[1] * a + up[1] * b, p[2] + right[2] * a + up[2] * b];
  const c = toView(eye, centre);
  key.target.position.set(c[0], c[1], c[2]);
  key.position.set(c[0] + d[0] * LIGHT_BACK, c[1] + d[1] * LIGHT_BACK, c[2] + d[2] * LIGHT_BACK);
  key.target.updateMatrixWorld();
  key.updateMatrixWorld();
}
