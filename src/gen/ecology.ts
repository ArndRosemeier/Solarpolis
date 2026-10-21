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
import { FLOOR_LAYERS, climateOf, toWorld, type BiomeSpec, type Climate, type FloorLayer } from '../blueprint';
import type { Terrain } from './terrain';
import { canopyColor } from './trees';

/** Plants at least this tall (m, full grown) are trees: they make up the canopy of woods. */
export const TREE_HEIGHT = 6;

/** Under closed crowns, the share of the sunline's direct light that still reaches the ground, on average (sunflecks). */
export const UNDER_CROWNS = 0.12;
/** The canopy raise (`colorAt`'s canopy height, m) at which the crowns count as closed: three quarters of a tall tree. */
export const CLOSED_RAISE = 0.75 * TREE_HEIGHT * 1.5;
/**
 * How closed the crowns are over a point (0 open … 1 closed), from its canopy raise: where no shadow map reaches, the
 * ground's shade under the woods (GROUND), and the eyes' meter in a wood (view.ts). Sparse trees barely raise the
 * canopy (`colorAt`), so the raise tells closed woods from scattered ones.
 */
export function crownsClosed(raise: number): number {
  return smoothstep(0.25, 1, raise / CLOSED_RAISE);
}

/**
 * A biome's woods seen from afar: how much of the ground its trees' crowns cover where it is pure (a crown about half
 * as wide as the tree is tall), how high they stand on average, and their colour (linear RGB).
 */
export function canopyOf(b: BiomeSpec): { cover: number; height: number; color: [number, number, number] } {
  let cover = 0, height = 0;
  const color: [number, number, number] = [0, 0, 0];
  for (const p of b.plants) {
    if (p.height[1] < TREE_HEIGHT) continue;
    const tall = (p.height[0] + p.height[1]) / 2, crown = 0.55 * tall;
    const c = Math.min(1, (Math.PI / 4) * (crown * crown) / (p.spacing * p.spacing));
    const k = canopyColor(p.form);
    cover += c; height += c * tall;
    for (let n = 0; n < 3; n++) color[n] += c * k[n];
  }
  if (cover > 0) { height /= cover; for (let n = 0; n < 3; n++) color[n] /= cover; }
  return { cover: Math.min(1, cover), height, color };
}

export interface Ecology {
  readonly terrain: Terrain;
  readonly climate: Climate;
  /** Each biome's share of the point (sums to 1), in the climate's order, into `out`. */
  biomesAt(theta: number, s: number, h: number, slope: number, out: Float32Array): Float32Array;
  /** How wet the ground is (0 … 1). */
  moistureAt(theta: number, s: number, h: number): number;
  /**
   * Linear RGB of the ground seen from a distance, with the slope (0 flat … 1 vertical), into `out` at `i`. With
   * `canopy`, also the woods' canopy over it there, at `i / 3 * 4`: the linear RGB seen from far above (the ground
   * where the trees stand apart, their crowns where they close up) and the canopy's height (m). With `floor`, the
   * share of each of `FLOOR_LAYERS` there (0 … 255, summing to about 255), at `i / 3 * 8`.
   */
  colorAt(theta: number, s: number, h: number, slope: number, out: Float32Array, i: number, canopy?: Float32Array, floor?: Uint8Array): void;
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
  const woods = biomes.map(canopyOf);
  // Each biome's floor as shares of the layers (summing to 1).
  const L = FLOOR_LAYERS.length, SAND = FLOOR_LAYERS.indexOf('sand'), DIRT = FLOOR_LAYERS.indexOf('dirt'), ROCK = FLOOR_LAYERS.indexOf('rock');
  const floors = biomes.map((b) => {
    const f = FLOOR_LAYERS.map((l) => b.floor[l] ?? 0), sum = f.reduce((a, x) => a + x, 0) || 1;
    return f.map((x) => x / sum);
  });
  const layers = new Float32Array(L);
  const colorAt = (theta: number, s: number, height: number, slope: number, out: Float32Array, i: number, canopy?: Float32Array, floor?: Uint8Array): void => {
    biomesAt(theta, s, height, slope, shares);
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    let c0 = 0, c1 = 0, c2 = 0;
    for (let b = 0; b < count; b++) {
      const w = shares[b];
      if (w === 0) continue;
      const spec = biomes[b], v = 1 + spec.vary * tint.fbm3(x / 90 + b * 7.3, y / 90, z / 90, 2);
      c0 += w * spec.color[0] * v; c1 += w * spec.color[1] * v; c2 += w * spec.color[2] * v;
    }
    let sand = 0, bed = 0;
    if (lake && Math.abs(s - lake.s) < lake.halfWidth + reach) {
      // Sand at the waterline, the lake's bed below it (only by the lake: terraces elsewhere dip below its level too).
      const below = lake.level - height;
      sand = smoothstep(-1.5, 0, below) * (1 - smoothstep(0.5, 3, below));
      bed = smoothstep(0.5, 3, below);
      const sh = climate.shore, bd = climate.bed;
      c0 += (sh[0] - c0) * sand; c1 += (sh[1] - c1) * sand; c2 += (sh[2] - c2) * sand;
      c0 += (bd[0] - c0) * bed; c1 += (bd[1] - c1) * bed; c2 += (bd[2] - c2) * bed;
    }
    const rock = smoothstep(0.45, 0.75, slope + 0.15 * tint.fbm3(x / patch, y / patch, z / patch, 2)), r = climate.rock;
    c0 += (r[0] - c0) * rock; c1 += (r[1] - c1) * rock; c2 += (r[2] - c2) * rock;
    out[i] = Math.min(1, Math.max(0, c0));
    out[i + 1] = Math.min(1, Math.max(0, c1));
    out[i + 2] = Math.min(1, Math.max(0, c2));
    if (floor) {
      // The biomes' floors, then sand, the bed (dirt) and rock over them, as the colour has them.
      layers.fill(0);
      for (let b = 0; b < count; b++) if (shares[b]) for (let l = 0; l < L; l++) layers[l] += shares[b] * floors[b][l];
      const over = (l: number, k: number) => { for (let m = 0; m < L; m++) layers[m] *= 1 - k; layers[l] += k; };
      over(SAND, sand); over(DIRT, bed); over(ROCK, rock);
      const at = (i / 3) * L;
      for (let l = 0; l < L; l++) floor[at + l] = Math.round(layers[l] * 255);
    }
    if (!canopy) return;
    // The woods over it: crowns cover their biome's share of the point (rock and water hold none).
    let cover = 0, tall = 0, k0 = 0, k1 = 0, k2 = 0;
    for (let b = 0; b < count; b++) {
      const w = shares[b] * woods[b].cover * (1 - rock);
      if (w === 0) continue;
      cover += w; tall += w * woods[b].height;
      k0 += w * woods[b].color[0]; k1 += w * woods[b].color[1]; k2 += w * woods[b].color[2];
    }
    const at = (i / 3) * 4;
    if (cover > 0) { tall /= cover; k0 /= cover; k1 /= cover; k2 /= cover; }
    canopy[at] = out[i] + (k0 - out[i]) * cover;
    canopy[at + 1] = out[i + 1] + (k1 - out[i + 1]) * cover;
    canopy[at + 2] = out[i + 2] + (k2 - out[i + 2]) * cover;
    // Sparse trees barely raise it; closed woods raise it to their crowns' middle.
    canopy[at + 3] = tall * 0.75 * smoothstep(0.1, 0.7, cover);
  };

  return { terrain, climate, biomesAt, moistureAt, colorAt };
}

/** A place found by `nearestWood` or `nearestFloor`, and the way there from where the search began. */
export interface Found {
  theta: number;
  s: number;
  /** A unit step in metres along θ·r and s. */
  way: [number, number];
}

/**
 * The nearest point from (θ, s) where `score` (of the biomes' shares there) reaches `least`, searched along rays out to
 * `reach` metres: where it starts, and the way there. Water does not count.
 */
function searchOut(ecology: Ecology, theta: number, s: number, score: (shares: Float32Array) => number, least: number, reach: number): Found | null {
  const { profile } = ecology.terrain.habitat, shares = new Float32Array(ecology.climate.biomes.length);
  let best: (Found & { d: number }) | null = null;
  for (let k = 0; k < 24; k++) {
    const a = (2 * Math.PI * k) / 24, way: [number, number] = [Math.cos(a), Math.sin(a)];
    for (let d = 10; d < (best?.d ?? reach); d += 10) {
      const ps = s + way[1] * d;
      if (ps < 0 || ps > profile.length) break;
      const pt = theta + (way[0] * d) / Math.max(profile.at(ps).r, 1);
      const h = ecology.terrain.heightAt(pt, ps);
      if (ecology.terrain.standAt(pt, ps) > h + 0.05) continue;
      if (score(ecology.biomesAt(pt, ps, h, 0, shares)) >= least) { best = { theta: pt, s: ps, way, d }; break; }
    }
  }
  return best && { theta: best.theta, s: best.s, way: best.way };
}

/**
 * The nearest closed wood from a point (crowns covering at least `cover` of the ground), searched out to `reach`
 * metres. For the debug menu's "Go" entries and for tests.
 */
export function nearestWood(ecology: Ecology, theta: number, s: number, reach = 3000, cover = 0.5): Found | null {
  const woods = ecology.climate.biomes.map(canopyOf);
  return searchOut(ecology, theta, s, (shares) => woods.reduce((c, w, b) => c + shares[b] * w.cover, 0), cover, reach);
}

/** The nearest ground whose biomes' floors are at least `share` of a floor layer (a meadow: grass), out to `reach` metres. */
export function nearestFloor(ecology: Ecology, theta: number, s: number, layer: FloorLayer, reach = 3000, share = 0.8): Found | null {
  const floors = ecology.climate.biomes.map((b) => (b.floor[layer] ?? 0) / (Object.values(b.floor).reduce((a, x) => a + (x ?? 0), 0) || 1));
  return searchOut(ecology, theta, s, (shares) => floors.reduce((c, f, b) => c + shares[b] * f, 0), share, reach);
}
