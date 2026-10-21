/**
 * The land's shape: the height of the ground above the profile at every interior point (θ, s). What grows on it is the
 * ecology stage's (`ecology.ts`). Pure and continuous: any point can be asked in any order, so tiles
 * of any size agree at their edges, and the same habitat always gives the same land.
 *
 * The noise is sampled at the point's world position on the profile, so it wraps around the axis without a seam. Sizes
 * come from the blueprint's relief (`HabitatParams.relief`): hills, the ring lake, the terrace step, the rivers (laid out in
 * `rivers.ts` over the land, which they then carve).
 */
import { Noise, Rng, deriveSeed, smoothstep } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { carve, makeRivers, riverAt, valleyReach, type River, type RiverHit } from './rivers';

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
  /** The rivers into the lake (`rivers.ts`), with the land already carved for them. */
  readonly rivers: readonly River[];
  /** Where a point is across the river it is in, or null when it is in none. */
  riverAt(theta: number, s: number): RiverHit | null;
  /** Height of the ground above the profile, along its normal (m); negative in the lake. */
  heightAt(theta: number, s: number): number;
  /** Where something standing there rests: the ground, or the water's surface over the lake. */
  standAt(theta: number, s: number): number;
  /** How deep a world point lies under the lake's surface (m); 0 or less where there is no water over it. */
  waterDepth(p: Vec3): number;
}

/** How far the terraces' levels wander around the axis, in steps (`makeTerrain`). */
const TERRACE_WANDER = 0.8;
/** The terraces' ledges and walls: their angles from level (radians). */
const TERRACE_TREAD = (10 * Math.PI) / 180, TERRACE_RISER = (78 * Math.PI) / 180;

/**
 * How steep the ground is (0 level … 1 a wall), from its unit normal `n` (world, facing the air) at angle θ: three
 * times 1 − cos of its angle from level, level being square to true up (toward the axis). Up never follows the
 * ground, so on the endcap slopes a terrace's ledge is as level as it really is, not as steep as the slope it is cut
 * into. The one measure for colours, biomes and plants.
 */
export function groundSlope(n: Vec3, theta: number): number {
  const level = -(n[0] * Math.cos(theta) + n[1] * Math.sin(theta));
  return Math.min(1, Math.max(0, 3 * (1 - level)));
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

  /** The land before the rivers carve it. */
  const landAt = (theta: number, s: number): number => {
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
      // Terraces on the endcap slopes: ledges nearly level (`TERRACE_TREAD` from level) and rock walls nearly sheer
      // (`TERRACE_RISER`), one wall per `step` of elevation above the floor, so the slope climbs as a staircase. On
      // the steep upper slopes the ledges are narrow, at the foot broad; where the slope is already flatter than a
      // ledge or steeper than a wall there are none. Heights are along the profile's normal, so each piece leans by
      // its angle less the slope's, and a wall never tips past sheer (no overhang to fold the ground).
      // The steps follow the contours of a slope that is not quite round (the elevation warped by most of a step, over
      // ten steps' length), so they wander, merge and part around the axis instead of closing into rings; and here and
      // there the walls have worn down toward the plain slope.
      const at = profile.at(s), e = h.radius - at.r, alpha = Math.asin(Math.min(1, Math.abs(at.nz)));
      let terrace = 0;
      if (alpha > TERRACE_TREAD && alpha < TERRACE_RISER) {
        const wander = step * TERRACE_WANDER * noise.fbm3(x / (step * 10), y / (step * 10), z / (step * 10), 2);
        const q = (e + wander) / step, frac = q - Math.floor(q);
        const kept = smoothstep(-0.35, 0.15, detail.fbm3(x / (step * 7) + 17.3, y / (step * 7), z / (step * 7), 2));
        // Along the slope one step is `run` long; the ledge falls back from the wall's top, the wall climbs to the next.
        const run = step / Math.sin(alpha);
        const ledge = Math.tan(TERRACE_TREAD - alpha) * frac * run, wall = Math.tan(TERRACE_RISER - alpha) * (frac - 1) * run;
        // A ledge meets the wall above it in a rounded foot (a smooth maximum), its top edge stays a crisp brink.
        const k = step * 0.06, gap = Math.abs(ledge - wall);
        terrace = kept * (Math.max(ledge, wall) + (gap < k ? (k - gap) * (k - gap) / (4 * k) : 0));
      }
      // Fade out near the axis and the hub, where the steps would crowd together.
      const fade = smoothstep(0, profile.length * 0.03, s) * (1 - smoothstep(profile.length * 0.97, profile.length, s));
      const rough = step * 0.08 * detail.fbm3(x / (step * 2), y / (step * 2), z / (step * 2), 3);
      height += (1 - f) * fade * (terrace + rough);
    }
    // Small ground roughness everywhere: tufts and hollows of a few tens of centimetres.
    height += Math.min(0.3, hills * 0.01) * detail.fbm3(x / 25, y / 25, z / 25, 3);
    return height;
  };

  const rivers = makeRivers(h, lake, landAt);
  const reach = valleyReach(h);
  const heightAt = (theta: number, s: number): number => {
    const g = landAt(theta, s);
    const hit = rivers.length ? riverAt(rivers, theta, s, reach) : null;
    return hit ? carve(hit, hit.river.depth, g) : g;
  };
  const inRiver = (theta: number, s: number): RiverHit | null => {
    const hit = rivers.length ? riverAt(rivers, theta, s) : null;
    return hit && Math.abs(hit.across) < hit.halfWidth ? hit : null;
  };

  const standAt = (theta: number, s: number): number => {
    const g = heightAt(theta, s);
    if (lake && g < lake.level && (inLake(s) ?? -1) > -0.1) return lake.level;
    const r = inRiver(theta, s);
    return r && r.surface > g ? r.surface : g;
  };

  const waterDepth = (p: Vec3): number => {
    const at = fromWorld(profile, p[0], p[1], p[2]);
    const surface = standAt(at.theta, at.s);
    return surface > heightAt(at.theta, at.s) ? surface - at.h : 0;
  };

  return { habitat: h, lake, rivers, riverAt: inRiver, heightAt, standAt, waterDepth };
}
