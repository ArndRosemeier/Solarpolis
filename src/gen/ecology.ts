/**
 * The ecology stage: which biome grows where, over the whole interior (design doc, generation stage 5). The habitat's
 * climate (`HabitatParams.climate`, catalogue in `blueprint/climates.ts`) lists its biomes and where each is planted;
 * here the land gets them, from three things at each point:
 *
 *   moisture  wet by the ring lake, along the rivers and in hollows, drier up the endcaps, with a slow wander of its own;
 *   height    above the floor, as a share of the radius (the endcap slopes climb to the axis);
 *   slope     steep ground holds fewer biomes, and bare rock shows where none holds.
 *
 * Every biome that suits a point bids for it with its own patch pattern; the strongest bids win, sharpened by the
 * climate's `edges`, so the land falls into planted patches with clear edges (woods, meadows, reed beds), as designed
 * parkland does. Pure and continuous like the terrain: any point, in any order, gives the same answer.
 */
import { Noise, deriveSeed, smoothstep } from '@futuremagic/core';
import { FLOOR_LAYERS, STYLE_LAND, climateOf, toWorld, type BiomeSpec, type Climate, type FaceKind, type FloorLayer, type Rgb } from '../blueprint';
import type { Terrain } from './terrain';
import { riverAt } from './rivers';
import { canopyColor } from './trees';
import { plantedCanopy, plantedLawn } from './planted';
import { planOf, type District } from './plan';
import { snowCover, snowFieldOf } from './snow';
import { pathCover, pathsOf } from './paths';
import { placesOf, type PlaceKind } from './places';

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
 * as wide as the tree is tall), how high they stand on average, how far apart (m), and their colour (linear RGB).
 */
export function canopyOf(b: BiomeSpec): { cover: number; height: number; spacing: number; color: [number, number, number] } {
  let cover = 0, height = 0, spacing = 0;
  const color: [number, number, number] = [0, 0, 0];
  for (const p of b.plants) {
    if (p.height[1] < TREE_HEIGHT) continue;
    const tall = (p.height[0] + p.height[1]) / 2, crown = 0.55 * tall;
    const c = Math.min(1, (Math.PI / 4) * (crown * crown) / (p.spacing * p.spacing));
    const k = canopyColor(p.form);
    cover += c; height += c * tall; spacing += c * p.spacing;
    for (let n = 0; n < 3; n++) color[n] += c * k[n];
  }
  if (cover > 0) { height /= cover; spacing /= cover; for (let n = 0; n < 3; n++) color[n] /= cover; }
  return { cover: Math.min(1, cover), height, spacing, color };
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
   * `canopy`, also the woods' canopy over it there, at `i / 3 * 4`: the crowns' linear RGB (the ground's where no trees
   * stand) and the canopy's height (m). With `floor`, the share of each of `FLOOR_LAYERS` there (0 … 255, summing to
   * about 255), at `i / 3 * 8`. With `wood`, at `i / 3 * 2`, the share of the ground the crowns cover (0 … 1) and how
   * far apart the trees stand (m): the far view draws crowns and gaps from them (render/groundShaders.ts, `woodsFromAfar`).
   * `cell` is how wide a patch of ground the point stands for (m, a tile's cell; 0 for the point itself): a path
   * narrower than that is laid over its share of the patch, so from afar it is a faint line, not a dotted one.
   */
  colorAt(theta: number, s: number, h: number, slope: number, out: Float32Array, i: number, canopy?: Float32Array, floor?: Uint8Array, wood?: Float32Array, cell?: number): void;
  /**
   * How much of the ground lies above the Mountain's snow line (0 … 1, gen/snow.ts `snowCover`): nothing grows there,
   * and between the snow (which the ground's shader lays over it, `snowOn`) the ground is bare rock.
   */
  snowAt(theta: number, s: number, h: number): number;
}

/**
 * How hard a district's style leans on the climate's patches: its favour for a biome multiplies the biome's sharpened
 * bid by this power, so a style rules its district while the patches still show inside it.
 */
const STYLE_LEAN = 2;

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
  // A river wets its banks a few of its widths out (a strip of reeds and willows), and its valley a little.
  const rivers = terrain.rivers, riverWidth = h.params.relief.rivers?.width ?? 0;
  const banks = riverWidth * 3 + patch * 0.05;

  // The planted places (gen/places.ts) and the biome the climate grows each kind as.
  const places = placesOf(terrain);
  const placeBiome: Record<PlaceKind, number> = { orchard: 0, vineyard: 0 };
  for (const kind of Object.keys(placeBiome) as PlaceKind[]) {
    const b = biomes.findIndex((x) => x.name === climate.places[kind]);
    if (b < 0) throw new Error(`climate "${climate.name}" grows its ${kind}s as "${climate.places[kind]}", which is none of its biomes`);
    placeBiome[kind] = b;
  }
  // The districts (gen/plan.ts): each shapes its land in its style (`STYLE_LAND`), and belts of trees mark the borders
  // between them, the way hedgerows and shelter belts mark out a worked land, so the plan reads from the far side.
  const plan = planOf(h);
  const woods = biomes.map(canopyOf);
  // A belt is a few rows of the closest woods' trees each side of the border, or a thirtieth of a patch if wider.
  const closest = woods.reduce((best, w, k) => (!biomes[k].placed && w.cover > woods[best].cover ? k : best), 0);
  const belt = Math.max(patch * 0.03, woods[closest].spacing * 1.5);
  const gaps = new Noise(deriveSeed(h.seed, 'ecology', 'belts'));
  /** How a style leans on each biome's bid (1 neutral), by how close the biome's crown cover is to the style's. */
  const favour = new Map<District['style'], Float32Array>();
  for (const style of Object.keys(STYLE_LAND) as District['style'][]) {
    const land = STYLE_LAND[style], f = new Float32Array(count);
    // Kept as the lean it gives (favour ** STYLE_LEAN), so the bids need no power per point.
    for (let b = 0; b < count; b++) f[b] = (1 - land.hold + land.hold * (land.cover === null ? 1 : Math.exp(-(((woods[b].cover - land.cover) / 0.3) ** 2)))) ** STYLE_LEAN;
    favour.set(style, f);
  }
  /** A belt's pull to the closest woods, as each biome's favour. */
  const beltFavour = woods.map((w) => Math.exp(-(((w.cover - 1) / 0.3) ** 2)));
  /** How much of a belt runs through a point (0 … 1): along district borders, with a gap here and there for the ways. */
  const beltAt = (edge: number, x: number, y: number, z: number): number => {
    if (!(edge < belt)) return 0;
    const open = smoothstep(0.25, 0.4, gaps.fbm3(x / (patch * 0.15), y / (patch * 0.15), z / (patch * 0.15), 2));
    return (1 - smoothstep(belt * 0.6, belt, edge)) * (1 - open);
  };

  /** Height above the floor's level, as a share of the radius. */
  const heightShare = (s: number, height: number): number => Math.max(0, (h.radius - profile.at(s).r + height) / h.radius);

  const moistureAt = (theta: number, s: number, height: number): number => moistureWith(theta, s, height, plan.districtAt(theta, s));
  const moistureWith = (theta: number, s: number, height: number, district: District | null): number => {
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    let m = climate.wetness + (district ? STYLE_LAND[district.style].wet : 0) + 0.3 * wander.fbm3(x / patch, y / patch, z / patch, 3);
    if (lake) m += 0.55 * Math.exp(-Math.max(0, Math.abs(s - lake.s) - lake.halfWidth) / reach);
    const river = rivers.length ? riverAt(rivers, theta, s, banks * 4) : null;
    if (river) m += 0.5 * Math.exp(-Math.max(0, Math.abs(river.across) - river.halfWidth) / banks);
    // Water gathers in hollows and drains off hilltops; the endcaps dry out as they climb.
    m += 0.12 * (0.5 - Math.min(1, Math.max(0, height / hills)));
    m -= 0.35 * Math.min(1, heightShare(s, height) * 1.5);
    return Math.min(1, Math.max(0, m));
  };

  const inRange = (v: number, [lo, hi]: readonly [number, number], edge: number): number =>
    smoothstep(lo - edge, lo + edge, v) * (1 - smoothstep(hi - edge, hi + edge, v));

  const biomesAt = (theta: number, s: number, height: number, slope: number, out: Float32Array): Float32Array => {
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    const at = plan.borderAt(theta, s), district = at ? at.district : null;
    const m = moistureWith(theta, s, height, district), e = heightShare(s, height);
    const style = district ? favour.get(district.style)! : null, grain = district ? patch * STYLE_LAND[district.style].grain : patch;
    const hedge = at ? beltAt(at.edge, x, y, z) : 0;
    let sum = 0;
    for (let b = 0; b < count; b++) {
      const spec = biomes[b];
      // A biome people plant grows only in their places (below).
      if (spec.placed) { out[b] = 0; continue; }
      const suits = inRange(m, spec.moisture, MOISTURE_EDGE) * inRange(e, spec.height, HEIGHT_EDGE) * (1 - smoothstep(spec.slope - 0.1, spec.slope + 0.1, slope));
      // A biome that cannot grow here bids nothing: its patches need no noise.
      if (suits === 0) { out[b] = 0; continue; }
      let bid = suits * spec.share * (0.3 + 0.7 * smoothstep(-0.6, 0.6, patterns[b].fbm3(x / grain, y / grain, z / grain, 3)));
      // In a belt the closest woods win wherever they can grow.
      if (hedge > 0) bid = bid * (1 - hedge) + hedge * suits * beltFavour[b];
      // The style leans on the patches rather than painting over them: its woods keep glades, its meadows clumps.
      out[b] = Math.pow(bid, climate.edges) * (style ? style[b] : 1);
      sum += out[b];
    }
    if (sum > 0) for (let b = 0; b < count; b++) out[b] /= sum;
    else nearestFit(m, out);
    // A grove's lawn (gen/planted.ts) is the open, grassy biome's.
    const lawn = plantedLawn(terrain, theta, s);
    if (lawn > 0) {
      for (let b = 0; b < count; b++) out[b] *= 1 - lawn;
      out[open] += lawn;
    }
    // A planted place (gen/places.ts) is its biome's, where the ground is not too steep for it (a terrace's wall).
    const place = places.placeAt(theta, s);
    if (place) {
      const b = placeBiome[place.kind], k = place.share * (1 - smoothstep(biomes[b].slope - 0.1, biomes[b].slope + 0.1, slope));
      if (k > 0) {
        for (let n = 0; n < count; n++) out[n] *= 1 - k;
        out[b] += k;
      }
    }
    return out;
  };
  /** Nothing suits (very steep, or out of every range): the nearest fit, by moisture, takes it. */
  const nearestFit = (m: number, out: Float32Array): void => {
    let best = 0, gap = Infinity;
    for (let b = 0; b < count; b++) {
      if (biomes[b].placed) continue;
      const [lo, hi] = biomes[b].moisture, d = m < lo ? lo - m : m > hi ? m - hi : 0;
      if (d < gap) { gap = d; best = b; }
    }
    out.fill(0, 0, count);
    out[best] = 1;
  };
  /** The open, grassy biome: no trees, the most grass on its floor (a grove's lawn is it). */
  const open = biomes.reduce((best, b, k) => {
    const grass = (x: BiomeSpec) => (x.floor.grass ?? 0) + (x.floor['dry grass'] ?? 0) - (x.plants.some((p) => p.height[1] >= TREE_HEIGHT) ? 10 : 0) - (x.placed ? 20 : 0);
    return grass(b) > grass(biomes[best]) ? k : best;
  }, 0);

  /**
   * Which Gate face a point of the port endcap is on and how much of it is the face (1 inside it, 0 on the buttresses
   * between faces and on the floor), as the terrain shapes it (`gateAt` in terrain.ts).
   */
  const gateFace = (theta: number, s: number): { kind: FaceKind; share: number } | null => {
    const { valley, across } = terrain.form.acrossAt(theta, s);
    const share = (1 - smoothstep(0.6, 0.8, Math.abs(across))) * smoothstep(profile.floorEnd, profile.floorEnd + (profile.length - profile.floorEnd) * 0.1, s);
    return share > 0 ? { kind: terrain.form.faces[valley].kind, share } : null;
  };

  const snow = snowFieldOf(h);
  const snowAt = (theta: number, s: number, height: number): number => {
    const [x, y, z] = toWorld(profile, { theta, s, h: height });
    return snowCover(snow, x, y, z);
  };

  const shares = new Float32Array(count);
  // Each biome's floor as shares of the layers (summing to 1).
  const L = FLOOR_LAYERS.length, SAND = FLOOR_LAYERS.indexOf('sand'), GRAVEL = FLOOR_LAYERS.indexOf('gravel'), DIRT = FLOOR_LAYERS.indexOf('dirt'), ROCK = FLOOR_LAYERS.indexOf('rock');
  const floors = biomes.map((b) => {
    const f = FLOOR_LAYERS.map((l) => b.floor[l] ?? 0), sum = f.reduce((a, x) => a + x, 0) || 1;
    return f.map((x) => x / sum);
  });
  const layers = new Float32Array(L);
  // The paths' surfaces (gen/paths.ts): each floor layer a path can be laid with, in the colour it has from afar.
  const net = pathsOf(h);
  const { shore: sh, rock: rk, bed: bd } = climate;
  const gravelColor: Rgb = [(sh[0] + rk[0]) / 2, (sh[1] + rk[1]) / 2, (sh[2] + rk[2]) / 2];
  const laid: Partial<Record<FloorLayer, Rgb>> = {
    gravel: gravelColor,
    rock: [rk[0] * 1.2, rk[1] * 1.2, rk[2] * 1.2],
    sand: sh,
    dirt: bd,
    litter: [bd[0] * 0.7, bd[1] * 0.7, bd[2] * 0.7],
  };
  // The Sunwalk is dressed stone, paler than any gravel: a line one can read from the far side.
  const sunwalk: Rgb = [gravelColor[0] * 1.3, gravelColor[1] * 1.3, gravelColor[2] * 1.3];
  const colorAt = (theta: number, s: number, height: number, slope: number, out: Float32Array, i: number, canopy?: Float32Array, floor?: Uint8Array, wood?: Float32Array, cell = 0): void => {
    biomesAt(theta, s, height, slope, shares);
    const [x, y, z] = toWorld(profile, { theta, s, h: 0 });
    let c0 = 0, c1 = 0, c2 = 0;
    for (let b = 0; b < count; b++) {
      const w = shares[b];
      if (w === 0) continue;
      const spec = biomes[b], v = 1 + spec.vary * tint.fbm3(x / 90 + b * 7.3, y / 90, z / 90, 2);
      c0 += w * spec.color[0] * v; c1 += w * spec.color[1] * v; c2 += w * spec.color[2] * v;
    }
    let sand = 0, bed = 0, gravel = 0;
    const river = rivers.length ? riverAt(rivers, theta, s, 4) : null;
    if (river) {
      // Gravel at the river's edge (a strip a little above the water, as wide as a few steps), its bed below.
      const below = river.surface - height, out = Math.abs(river.across) - river.halfWidth;
      gravel = smoothstep(-0.8, -0.1, below) * (1 - smoothstep(1, 2.5 + river.halfWidth * 0.2, out));
      bed = smoothstep(0.2, 0.9, below);
      const g = climate.shore, rk = climate.rock, bd = climate.bed;
      c0 += ((g[0] + rk[0]) / 2 - c0) * gravel; c1 += ((g[1] + rk[1]) / 2 - c1) * gravel; c2 += ((g[2] + rk[2]) / 2 - c2) * gravel;
      c0 += (bd[0] - c0) * bed; c1 += (bd[1] - c1) * bed; c2 += (bd[2] - c2) * bed;
    }
    // An entrance's court (gen/plan.ts, `courtOf`): its floor laid in gravel and stone, no crowns over it or its ring.
    const court = terrain.courtAt(theta, s);
    let ring = 0;
    if (court) {
      const paved = 1 - smoothstep(court.court.radius * 0.95, court.court.radius, court.distance);
      ring = 1 - paved;
      const rk = climate.rock, sh = climate.shore;
      gravel = Math.max(gravel, paved);
      c0 += ((sh[0] + rk[0]) / 2 - c0) * paved; c1 += ((sh[1] + rk[1]) / 2 - c1) * paved; c2 += ((sh[2] + rk[2]) / 2 - c2) * paved;
    }
    if (lake && Math.abs(s - lake.s) < lake.halfWidth + reach) {
      // Sand at the waterline, the lake's bed below it (only by the lake: terraces elsewhere dip below its level too).
      const below = lake.level - height;
      sand = smoothstep(-1.5, 0, below) * (1 - smoothstep(0.5, 3, below));
      bed = Math.max(bed, smoothstep(0.5, 3, below));
      const sh = climate.shore, bd = climate.bed;
      c0 += (sh[0] - c0) * sand; c1 += (sh[1] - c1) * sand; c2 += (sh[2] - c2) * sand;
      c0 += (bd[0] - c0) * bed; c1 += (bd[1] - c1) * bed; c2 += (bd[2] - c2) * bed;
    }
    let rock = smoothstep(0.45, 0.75, slope + 0.15 * tint.fbm3(x / patch, y / patch, z / patch, 2)), r = climate.rock;
    // The Gate's faces read by what they are made of (gen/plan.ts, `faceAt`): the Stair face dressed stone, paler than
    // the rock it was cut from; the Vine face green over its walls; the Water face dark wet rock with pools on its treads.
    const gate = s > profile.floorEnd ? gateFace(theta, s) : null;
    if (gate) {
      const k = gate.share;
      if (gate.kind === 'stair') r = [r[0] * (1 + 0.6 * k), r[1] * (1 + 0.6 * k), r[2] * (1 + 0.6 * k)];
      else if (gate.kind === 'water') {
        r = [r[0] * (1 - 0.45 * k), r[1] * (1 - 0.45 * k), r[2] * (1 - 0.4 * k)];
        const b = climate.bed, pool = 0.6 * k * (1 - rock);
        c0 += (b[0] - c0) * pool; c1 += (b[1] - c1) * pool; c2 += (b[2] - c2) * pool;
      } else if (gate.kind === 'vine') {
        const g = biomes[open].color, vines = 0.7 * k * rock;
        c0 += (g[0] * 0.8 - c0) * vines; c1 += (g[1] * 0.8 - c1) * vines; c2 += (g[2] * 0.8 - c2) * vines;
        rock *= 1 - 0.7 * k;
      }
    }
    // Above the snow line the ground is bare rock between the snow (the shader lays the snow over it, near and far).
    if (s < profile.floorStart) rock += (1 - rock) * snowAt(theta, s, height);
    c0 += (r[0] - c0) * rock; c1 += (r[1] - c1) * rock; c2 += (r[2] - c2) * rock;
    // A path over it all, as much of the patch as it covers; not under water (the Sunwalk's bridges cross the lake), nor
    // on a court's floor, where the ways arrive.
    const way = net.pieces ? net.pathAt(theta, s, Math.max(cell / 2, 0.1)) : null;
    const path = way && !(lake && height < lake.level && Math.abs(s - lake.s) < lake.halfWidth) && !(court && court.distance < court.court.radius) ? pathCover(way, cell) : 0;
    if (path > 0 && way) {
      // A mown grass way is the meadow, a little paler and drier; the others their material.
      const c: Rgb = way.kind === 'sunwalk' ? sunwalk : laid[way.layer] ?? [c0 * 1.08, c1 * 1.06, c2 * 0.9];
      c0 += (c[0] - c0) * path; c1 += (c[1] - c1) * path; c2 += (c[2] - c2) * path;
    }
    out[i] = Math.min(1, Math.max(0, c0));
    out[i + 1] = Math.min(1, Math.max(0, c1));
    out[i + 2] = Math.min(1, Math.max(0, c2));
    if (floor) {
      // The biomes' floors, then gravel, sand, the bed (dirt) and rock over them, as the colour has them.
      layers.fill(0);
      for (let b = 0; b < count; b++) if (shares[b]) for (let l = 0; l < L; l++) layers[l] += shares[b] * floors[b][l];
      const over = (l: number, k: number) => { for (let m = 0; m < L; m++) layers[m] *= 1 - k; layers[l] += k; };
      over(GRAVEL, gravel); over(SAND, sand); over(DIRT, bed); over(ROCK, rock);
      if (path > 0 && way) over(FLOOR_LAYERS.indexOf(way.layer), path);
      const at = (i / 3) * L;
      for (let l = 0; l < L; l++) floor[at + l] = Math.round(layers[l] * 255);
    }
    if (!canopy && !wood) return;
    // The woods over it: crowns cover their biome's share of the point (rock and water hold none).
    // No crowns over the Sunwalk or a way; the trail runs under the reserve's trees.
    const bare = (1 - rock) * (1 - Math.max(gravel, bed)) * (court ? 1 - ring : 1) * (way && way.kind !== 'trail' ? 1 - path : 1);
    let cover = 0, tall = 0, apart = 0, k0 = 0, k1 = 0, k2 = 0;
    for (let b = 0; b < count; b++) {
      const w = shares[b] * woods[b].cover * bare;
      if (w === 0) continue;
      cover += w; tall += w * woods[b].height; apart += w * woods[b].spacing;
      k0 += w * woods[b].color[0]; k1 += w * woods[b].color[1]; k2 += w * woods[b].color[2];
    }
    if (cover > 0) { tall /= cover; apart /= cover; k0 /= cover; k1 /= cover; k2 /= cover; } else { k0 = out[i]; k1 = out[i + 1]; k2 = out[i + 2]; }
    // Planted crowns (gen/planted.ts: a grove's ring) over the scattered woods, or over open ground.
    const planted = plantedCanopy(terrain, theta, s);
    if (planted) {
      const a = planted.cover, was = Math.min(1, cover);
      k0 += (planted.color[0] - k0) * a; k1 += (planted.color[1] - k1) * a; k2 += (planted.color[2] - k2) * a;
      tall = was > 0 ? tall + (planted.height - tall) * a : planted.height;
      apart = was > 0 ? apart : planted.height * 0.55;
      cover = was + (1 - was) * a;
    }
    if (wood) { wood[(i / 3) * 2] = Math.min(1, cover); wood[(i / 3) * 2 + 1] = apart; }
    if (!canopy) return;
    const at = (i / 3) * 4;
    canopy[at] = k0; canopy[at + 1] = k1; canopy[at + 2] = k2;
    // Sparse trees barely raise it; closed woods raise it to their crowns' middle.
    canopy[at + 3] = tall * 0.75 * smoothstep(0.1, 0.7, cover);
  };

  return { terrain, climate, biomesAt, moistureAt, colorAt, snowAt };
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
