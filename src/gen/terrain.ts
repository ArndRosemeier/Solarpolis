/**
 * The land's shape: the height of the ground above the profile at every interior point (θ, s), and what the ground is
 * there (meadow, forest, rock, shore, lake bed). Pure and continuous: any point can be asked in any order, so tiles
 * of any size agree at their edges, and the same habitat always gives the same land.
 *
 * The noise is sampled at the point's world position on the profile, so it wraps around the axis without a seam. Sizes
 * come from the blueprint's relief (`HabitatParams.relief`): hills, the ring lake, the terrace step.
 */
import { Noise, Rng, deriveSeed, smoothstep } from '@futuremagic/core';
import { fromWorld, type Habitat, type Vec3 } from '../blueprint';

export interface Lake {
  /** Where the lake's centre line lies along the profile, and its half width (m). */
  s: number;
  halfWidth: number;
  depth: number;
  /** The water's surface, as a height above the profile (on the flat floor that is a constant radius). */
  level: number;
}

export type Ground = 'meadow' | 'forest' | 'rock' | 'shore' | 'bed';

export interface Terrain {
  readonly habitat: Habitat;
  readonly lake: Lake | null;
  /** Height of the ground above the profile, along its normal (m); negative in the lake. */
  heightAt(theta: number, s: number): number;
  /** Where something standing there rests: the ground, or the water's surface over the lake. */
  standAt(theta: number, s: number): number;
  /** How deep a world point lies under the lake's surface (m); 0 or less where there is no water over it. */
  waterDepth(p: Vec3): number;
  /** Linear RGB of the ground at a point whose height is known, with the slope (0 flat … 1 vertical). */
  colorAt(theta: number, s: number, h: number, slope: number, out: Float32Array, i: number): void;
}

/** Ground colours (linear RGB). The ecology stage will replace these with real biomes. */
const COLORS: Record<Ground, readonly [number, number, number]> = {
  meadow: [0.16, 0.32, 0.08],
  forest: [0.05, 0.14, 0.04],
  rock: [0.28, 0.26, 0.22],
  shore: [0.42, 0.38, 0.27],
  bed: [0.18, 0.2, 0.16],
};

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
  const at = (theta: number, s: number): [number, number, number] => {
    const p = profile.at(s);
    return [p.r * Math.cos(theta), p.r * Math.sin(theta), p.z];
  };

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
    // Small ground roughness everywhere: tufts and hollows of a few tens of centimetres.
    height += Math.min(0.3, hills * 0.01) * detail.fbm3(x / 25, y / 25, z / 25, 3);
    return height;
  };

  const standAt = (theta: number, s: number): number => {
    const g = heightAt(theta, s);
    return lake && g < lake.level && (inLake(s) ?? -1) > -0.1 ? lake.level : g;
  };

  const colorAt = (theta: number, s: number, height: number, slope: number, out: Float32Array, i: number): void => {
    const [x, y, z] = at(theta, s);
    const n = noise.fbm3(x / 1500 + 31.7, y / 1500, z / 1500, 4);
    const forest = smoothstep(0.05, 0.25, n);
    const rock = smoothstep(0.45, 0.75, slope + 0.15 * n);
    const m = COLORS.meadow, fo = COLORS.forest, r = COLORS.rock;
    let c0 = m[0] + (fo[0] - m[0]) * forest, c1 = m[1] + (fo[1] - m[1]) * forest, c2 = m[2] + (fo[2] - m[2]) * forest;
    if (lake) {
      // Sand at the waterline, a dark bed below it.
      const below = lake.level - height;
      const sand = smoothstep(-1.5, 0, below) * (1 - smoothstep(0.5, 3, below));
      const bed = smoothstep(0.5, 3, below);
      const sh = COLORS.shore, b = COLORS.bed;
      c0 += (sh[0] - c0) * sand; c1 += (sh[1] - c1) * sand; c2 += (sh[2] - c2) * sand;
      c0 += (b[0] - c0) * bed; c1 += (b[1] - c1) * bed; c2 += (b[2] - c2) * bed;
    }
    c0 += (r[0] - c0) * rock; c1 += (r[1] - c1) * rock; c2 += (r[2] - c2) * rock;
    const v = 0.9 + 0.2 * detail.fbm3(x / 90, y / 90, z / 90, 2);
    out[i] = Math.min(1, Math.max(0, c0 * v));
    out[i + 1] = Math.min(1, Math.max(0, c1 * v));
    out[i + 2] = Math.min(1, Math.max(0, c2 * v));
  };

  const waterDepth = (p: Vec3): number => {
    const at = fromWorld(profile, p[0], p[1], p[2]);
    const surface = standAt(at.theta, at.s);
    return surface > heightAt(at.theta, at.s) ? surface - at.h : 0;
  };

  return { habitat: h, lake, heightAt, standAt, waterDepth, colorAt };
}
