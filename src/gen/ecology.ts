/**
 * The ecology stage: which biome grows where, over the whole interior (design doc, generation stage 5). The habitat's
 * climate (`HabitatParams.climate`, catalogue in `blueprint/climates.ts`) lists its biomes and where each is planted;
 * here the land gets them, from three things at each point:
 *
 *   moisture  wet by the ring lake and in hollows, drier up the endcaps, with a slow wander of its own;
 *   height    above the floor, as a share of the radius (the endcap slopes climb to the axis);
 *   slope     steep ground holds fewer biomes, and bare rock shows where none holds.
 *
 * Every biome that suits a point bids for it with its own patch pattern; the strongest bids win, sharpened by the
 * climate's `edges`, so the land falls into planted patches with clear edges (woods, meadows, reed beds), as designed
 * parkland does. Pure and continuous like the terrain: any point, in any order, gives the same answer.
 */
import { Noise, deriveSeed, smoothstep } from '@futuremagic/core';
import { climateOf, toWorld, type Climate } from '../blueprint';
import type { Terrain } from './terrain';

export interface Ecology {
  readonly terrain: Terrain;
  readonly climate: Climate;
  /** Each biome's share of the point (sums to 1), in the climate's order, into `out`. */
  biomesAt(theta: number, s: number, h: number, slope: number, out: Float32Array): Float32Array;
  /** How wet the ground is (0 … 1). */
  moistureAt(theta: number, s: number, h: number): number;
  /** Linear RGB of the ground seen from a distance, with the slope (0 flat … 1 vertical), into `out` at `i`. */
  colorAt(theta: number, s: number, h: number, slope: number, out: Float32Array, i: number): void;
}

/** How soft the edges of a biome's moisture and height ranges are (in moisture units, and in shares of the radius). */
const MOISTURE_EDGE = 0.1;
const HEIGHT_EDGE = 0.04;

export function makeEcology(terrain: Terrain): Ecology {
  const h = terrain.habitat, { profile } = h;
  const climate = climateOf(h.params.climate);
  if (!climate) throw new Error(`no climate "${h.params.climate}" in the catalogue`);
  const biomes = climate.biomes, count = biomes.length;
  const patch = Math.max(climate.patch * h.radius, 1);
  const wander = new Noise(deriveSeed(h.seed, 'ecology', 'moisture'));
  const tint = new Noise(deriveSeed(h.seed, 'ecology', 'tint'));
  const patterns = biomes.map((b) => new Noise(deriveSeed(h.seed, 'ecology', b.name)));
  const lake = terrain.lake, hills = Math.max(h.params.relief.hills, 1e-6);
  // The lake wets the land a few lake widths out, more in a large habitat.
  const reach = lake ? lake.halfWidth * 2 + patch * 0.3 : 1;

  /** Height above the floor's level, as a share of the radius. */
  const heightShare = (s: number, height: number): number => Math.max(0, (h.radius - profile.at(s).r + height) / h.radius);

  const moistureAt = (theta: number, s: number, height: number): number => {
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    let m = climate.wetness + 0.3 * wander.fbm3(x / patch, y / patch, z / patch, 3);
    if (lake) m += 0.55 * Math.exp(-Math.max(0, Math.abs(s - lake.s) - lake.halfWidth) / reach);
    // Water gathers in hollows and drains off hilltops; the endcaps dry out as they climb.
    m += 0.12 * (0.5 - Math.min(1, Math.max(0, height / hills)));
    m -= 0.35 * Math.min(1, heightShare(s, height) * 1.5);
    return Math.min(1, Math.max(0, m));
  };

  const inRange = (v: number, [lo, hi]: readonly [number, number], edge: number): number =>
    smoothstep(lo - edge, lo + edge, v) * (1 - smoothstep(hi - edge, hi + edge, v));

  const biomesAt = (theta: number, s: number, height: number, slope: number, out: Float32Array): Float32Array => {
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    const m = moistureAt(theta, s, height), e = heightShare(s, height);
    let sum = 0;
    for (let b = 0; b < count; b++) {
      const spec = biomes[b];
      const suits = inRange(m, spec.moisture, MOISTURE_EDGE) * inRange(e, spec.height, HEIGHT_EDGE) * (1 - smoothstep(spec.slope - 0.1, spec.slope + 0.1, slope));
      const bid = suits * spec.share * (0.3 + 0.7 * smoothstep(-0.6, 0.6, patterns[b].fbm3(x / patch, y / patch, z / patch, 3)));
      out[b] = Math.pow(bid, climate.edges);
      sum += out[b];
    }
    if (sum > 0) for (let b = 0; b < count; b++) out[b] /= sum;
    else {
      // Nothing suits (very steep, or out of every range): the nearest fit, by moisture, takes it.
      let best = 0, gap = Infinity;
      for (let b = 0; b < count; b++) {
        const [lo, hi] = biomes[b].moisture, d = m < lo ? lo - m : m > hi ? m - hi : 0;
        if (d < gap) { gap = d; best = b; }
      }
      out.fill(0, 0, count);
      out[best] = 1;
    }
    return out;
  };

  const shares = new Float32Array(count);
  const colorAt = (theta: number, s: number, height: number, slope: number, out: Float32Array, i: number): void => {
    biomesAt(theta, s, height, slope, shares);
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    let c0 = 0, c1 = 0, c2 = 0;
    for (let b = 0; b < count; b++) {
      const w = shares[b];
      if (w === 0) continue;
      const spec = biomes[b], v = 1 + spec.vary * tint.fbm3(x / 90 + b * 7.3, y / 90, z / 90, 2);
      c0 += w * spec.color[0] * v; c1 += w * spec.color[1] * v; c2 += w * spec.color[2] * v;
    }
    if (lake && Math.abs(s - lake.s) < lake.halfWidth + reach) {
      // Sand at the waterline, the lake's bed below it (only by the lake: terraces elsewhere dip below its level too).
      const below = lake.level - height;
      const sand = smoothstep(-1.5, 0, below) * (1 - smoothstep(0.5, 3, below));
      const bed = smoothstep(0.5, 3, below);
      const sh = climate.shore, bd = climate.bed;
      c0 += (sh[0] - c0) * sand; c1 += (sh[1] - c1) * sand; c2 += (sh[2] - c2) * sand;
      c0 += (bd[0] - c0) * bed; c1 += (bd[1] - c1) * bed; c2 += (bd[2] - c2) * bed;
    }
    const rock = smoothstep(0.45, 0.75, slope + 0.15 * tint.fbm3(x / patch, y / patch, z / patch, 2)), r = climate.rock;
    c0 += (r[0] - c0) * rock; c1 += (r[1] - c1) * rock; c2 += (r[2] - c2) * rock;
    out[i] = Math.min(1, Math.max(0, c0));
    out[i + 1] = Math.min(1, Math.max(0, c1));
    out[i + 2] = Math.min(1, Math.max(0, c2));
  };

  return { terrain, climate, biomesAt, moistureAt, colorAt };
}
