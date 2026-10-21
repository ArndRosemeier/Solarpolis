/**
 * The land's shape: the height of the ground above the profile at every interior point (θ, s). What grows on it is the
 * ecology stage's (`ecology.ts`). Pure and continuous: any point can be asked in any order, so tiles
 * of any size agree at their edges, and the same habitat always gives the same land.
 *
 * The noise is sampled at the point's world position on the profile, so it wraps around the axis without a seam. Sizes
 * come from the blueprint's relief (`HabitatParams.relief`): hills, the ring lake, the terrace step.
 */
import { Noise, Rng, deriveSeed, smoothstep } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat, type Vec3 } from '../blueprint';

export interface Lake {
  /** Where the lake's centre line lies along the profile, and its half width (m). */
  s: number;
  halfWidth: number;
  depth: number;
  /** The water's surface, as a height above the profile (on the flat floor that is a constant radius). */
  level: number;
}

export interface Terrain {
  readonly habitat: Habitat;
  readonly lake: Lake | null;
  /** Height of the ground above the profile, along its normal (m); negative in the lake. */
  heightAt(theta: number, s: number): number;
  /** Where something standing there rests: the ground, or the water's surface over the lake. */
  standAt(theta: number, s: number): number;
  /** How deep a world point lies under the lake's surface (m); 0 or less where there is no water over it. */
  waterDepth(p: Vec3): number;
}

export function makeTerrain(h: Habitat): Terrain {
  const { profile, params } = h;
  const relief = params.relief;
  const noise = new Noise(deriveSeed(h.seed, 'terrain'));
  const detail = new Noise(deriveSeed(h.seed, 'terrain', 'detail'));
  const floorStart = profile.floorStart, floorEnd = profile.floorEnd, floor = floorEnd - floorStart;
  const hills = relief.hills;
  // Hills are wider than they are tall, by about the ratio of rolling English downland.
  const hillWave = Math.max(hills * 40, 1);
  const step = relief.terraceStep;

  let lake: Lake | null = null;
  if (relief.ringLake) {
    // The lake lies in the port half of the floor, away from the endcap's foot: the vertical slice is played there.
    const rng = new Rng(deriveSeed(h.seed, 'terrain', 'lake'));
    const half = relief.ringLake.width / 2;
    const lo = floorStart + floor * 0.55 + half, hi = floorEnd - floor * 0.1 - half;
    const s = lo < hi ? rng.range(lo, hi) : (floorStart + floorEnd) / 2;
    lake = { s, halfWidth: half, depth: relief.ringLake.depth, level: -Math.min(1, relief.ringLake.depth * 0.1) };
  }
  // The shore: a band as wide as the lake is deep times ten, where hills flatten to meet the water.
  const shore = lake ? Math.max(lake.depth * 10, lake.halfWidth * 0.3) : 0;

  /** World position of the profile point under (θ, s), for the noise (so it wraps around the axis). */
  const at = (theta: number, s: number): Vec3 => toWorld(profile, { theta, s, h: 0 });

  /** 0 on the slopes, rising to 1 a little way out on the floor. */
  const onFloor = (s: number): number => {
    const ramp = Math.min(floor * 0.05, hillWave * 0.5);
    return smoothstep(floorStart, floorStart + ramp, s) * (1 - smoothstep(floorEnd - ramp, floorEnd, s));
  };

  /** How far into the lake (1 at the centre line, 0 at the waterline, negative outside), or null without a lake. */
  const inLake = (s: number): number | null => (lake ? 1 - Math.abs(s - lake.s) / lake.halfWidth : null);

  const heightAt = (theta: number, s: number): number => {
    const [x, y, z] = at(theta, s);
    let height = 0;
    const f = onFloor(s);
    if (f > 0 && hills > 0) {
      const n = noise.fbm3(x / hillWave, y / hillWave, z / hillWave, 5);
      let hill = hills * Math.pow(smoothstep(-0.25, 0.85, n), 1.6);
      const k = inLake(s);
      if (k !== null && lake) hill *= smoothstep(0, shore, -k * lake.halfWidth); // 0 at the water, full a shore away
      height += f * hill;
    }
    const k = inLake(s);
    if (k !== null && k > 0 && lake) height -= lake.depth * Math.sqrt(smoothstep(0, 0.6, k));
    if (f < 1) {
      // Terraces on the endcap slopes: the elevation above the floor rounded down to steps, with a short riser.
      const e = h.radius - profile.at(s).r;
      const q = e / step, frac = q - Math.floor(q);
      const terrace = (smoothstep(0.75, 1, frac) - frac) * step * 0.6;
      // Fade out near the axis and the hub, where the steps would crowd together.
      const fade = smoothstep(0, profile.length * 0.03, s) * (1 - smoothstep(profile.length * 0.97, profile.length, s));
      const rough = step * 0.08 * detail.fbm3(x / (step * 2), y / (step * 2), z / (step * 2), 3);
      height += (1 - f) * fade * (terrace + rough);
    }
    // Small ground roughness everywhere: tufts and hollows of a few tens of centimetres, and finer still, the bumps
    // and dips a walker steps over (the finest tiles show them; textures carry on below).
    height += Math.min(0.3, hills * 0.01) * detail.fbm3(x / 25, y / 25, z / 25, 3);
    height += Math.min(0.1, hills * 0.004) * detail.fbm3(x / 3 + 17.3, y / 3 - 5.1, z / 3 + 9.7, 3);
    return height;
  };

  const standAt = (theta: number, s: number): number => {
    const g = heightAt(theta, s);
    return lake && g < lake.level && (inLake(s) ?? -1) > -0.1 ? lake.level : g;
  };

  const waterDepth = (p: Vec3): number => {
    const at = fromWorld(profile, p[0], p[1], p[2]);
    const surface = standAt(at.theta, at.s);
    return surface > heightAt(at.theta, at.s) ? surface - at.h : 0;
  };

  return { habitat: h, lake, heightAt, standAt, waterDepth };
}
