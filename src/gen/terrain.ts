/**
 * The land's shape: the height of the ground above the profile at every interior point (θ, s). What grows on it is the
 * ecology stage's (`ecology.ts`). Pure and continuous: any point can be asked in any order, so tiles
 * of any size agree at their edges, and the same habitat always gives the same land.
 *
 * The noise is sampled at the point's world position on the profile, so it wraps around the axis without a seam. Sizes
 * come from the blueprint's relief (`HabitatParams.relief`): hills, the ring lake, the terrace step, the endcaps' massif,
 * the rivers (laid out in `rivers.ts` over the land, which they then carve).
 *
 * The endcaps are the habitat plan's (`plan.ts`, `Landform`), designed at the big scale and wild only in the small:
 *   the Mountain (wild end)  couloirs climbing up each valley's line, spiralling with it, spurs between them broken by
 *                            side ridges and crags; a horn at the head of the main valley; a cirque on the far side, its
 *                            floor dug level under a headwall; natural benches of rock wandering across the slope;
 *   the Gate (port end)      one face per valley between buttresses: the Stair face in level rings of formal terraces,
 *                            with the Lift Stair's plain ramp up its middle; the Vine face in narrow contour terraces that
 *                            curve round its folds; the Water face in broad basins whose treads tilt back to hold pools,
 *                            over sheer risers the rivers fall from.
 */
import { Noise, deriveSeed, smoothstep } from '@futuremagic/core';
import { fromWorld, toWorld, type FaceKind, type Habitat, type Vec3 } from '../blueprint';
import { carve, makeRivers, riverAt, valleyReach, type River, type RiverHit } from './rivers';
import { landformOf, type Lake, type Landform } from './plan';

export type { Lake } from './plan';

export interface Terrain {
  readonly habitat: Habitat;
  /** The plan's big shapes the land is made from. */
  readonly form: Landform;
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

const DEG = Math.PI / 180;
/** The Mountain's natural benches: how far their levels wander, in steps, and their ledges' and walls' angles from level. */
const BENCH = { wander: 0.8, tread: 10 * DEG, riser: 78 * DEG, worn: 0.15 };
/**
 * The Gate's faces, by kind: the step as a share of the terrace step, how far the levels wander (in steps), the
 * ledges' and walls' angles from level (a tread below level tilts back toward its wall and holds a pool).
 */
export const GATE_TERRACES: Readonly<Record<FaceKind, { step: number; wander: number; tread: number; riser: number }>> = {
  stair: { step: 0.5, wander: 0, tread: 1 * DEG, riser: 87 * DEG },
  vine: { step: 1 / 3, wander: 0.3, tread: 3 * DEG, riser: 84 * DEG },
  water: { step: 0.8, wander: 0.5, tread: -3 * DEG, riser: 88 * DEG },
};
/** The Mountain's horn and cirque: where they stand (gravity, as a share of the floor's), their sizes in massifs. */
export const HORN = { gravity: 0.25, radius: 3, height: 2 };
export const CIRQUE = { gravity: 0.6, halfWidth: 2.5, depth: 2.5 };

/**
 * Terraces cut into a slope `alpha` steep (radians from level) at elevation `e` (m above the floor): one wall per `step`
 * of elevation, ledges `tread` from level and walls `riser`, as a height along the profile's normal. Each piece leans by
 * its angle less the slope's, so a wall never tips past sheer; a ledge meets the wall above in a rounded foot. The brink
 * is crisp where `worn` is 0 (cut stone) and rounded over that share of a step where it is weathered rock. Where the
 * slope is already flatter than a ledge or steeper than a wall there are none.
 */
function terraces(e: number, step: number, alpha: number, tread: number, riser: number, worn = 0): number {
  if (!(alpha > Math.max(tread, 0.01) && alpha < riser)) return 0;
  const q = e / step, frac = q - Math.floor(q);
  // Along the slope one step is `run` long; the ledge falls back from the wall's top, the wall climbs to the next. A
  // ledge that tilts back holds a pool at most a tenth of a step deep, however long the ledge.
  const run = step / Math.sin(alpha);
  const fall = Math.max(Math.tan(tread - alpha), Math.tan(-alpha) - step * 0.1 / run), climb = Math.tan(riser - alpha);
  const ledge = fall * frac * run, wall = climb * (frac - 1) * run;
  const k = step * (0.06 + worn * 0.5), gap = Math.abs(ledge - wall);
  let h = Math.max(ledge, wall) + (gap < k ? (k - gap) * (k - gap) / (4 * k) : 0);
  if (worn > 0) {
    // The brink, where the ledge (above it) meets the wall (below it): a smooth minimum of the two over `worn` of a step.
    const d = frac < 0.5 ? frac : frac - 1, b = step * worn, edge = Math.abs((climb - fall) * d * run);
    if (edge < b) h -= (b - edge) * (b - edge) / (4 * b);
  }
  return h;
}

/** Brings an angle into [−π, π]. */
const turnOf = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

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

  const form = landformOf(h), lake = form.lake;
  const massif = relief.massif, R = h.radius;
  const cragNoise = new Noise(deriveSeed(h.seed, 'terrain', 'crags'));
  const hornS = form.endcapAt(true, HORN.gravity), hornRadius = Math.max(massif * HORN.radius, 1e-6);
  // The finest crags: half a massif, but never finer than a terrace step (smaller rock is the stones' and boulders').
  const crag = Math.max(massif * 0.5, step);
  // Side spurs down each flank of a valley on the Mountain, about three massifs apart halfway up.
  const flanks = Math.max(1, Math.round(((Math.PI / form.valleys) * R * 0.5) / Math.max(massif * 3, 1e-6)));
  const cirqueLip = R * (1 - CIRQUE.gravity), cirqueHalf = Math.max(massif * CIRQUE.halfWidth, 1e-6), cirqueDepth = Math.max(massif * CIRQUE.depth, 1e-6);
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

  /** The ridged crags of the endcaps: sharp crests between rounded hollows (0 … 1), stretched down the slope. */
  const crags = (x: number, y: number, s: number, w: number, octaves: number): number => {
    // The crest is rounded over a few hundredths of the crag's width (a soft |n|), so the rock is sharp from afar
    // and still a surface one can stand on up close.
    const f = cragNoise.fbm3(x / w, y / w, s / (w * 3), octaves), n = Math.max(0, 1 - Math.sqrt(f * f + 0.0225) * 1.8);
    return n * n;
  };

  /** The Mountain's shape at a point of the wild endcap, as a height over the slope (`g`: gravity there). */
  const mountainAt = (theta: number, s: number, x: number, y: number, e: number, alpha: number, g: number, nr: number): number => {
    const r = Math.max(R * g, 1e-6);
    // Spurs between the couloirs, from the foothills to the snow near the axis: the main spur on the ridge between two
    // valleys, side spurs down each valley's flanks (sharp crests over rounded gullies, wandering a little), then crags.
    const grow = smoothstep(0.97, 0.75, g) * smoothstep(0.03, 0.2, g);
    const a = Math.abs(form.acrossAt(theta, s).across);
    const spur = massif * Math.pow(smoothstep(0.05, 0.95, a), 1.3);
    const q = a * flanks + 0.25 * noise.fbm3(x / (massif * 8), y / (massif * 8), s / (massif * 8), 2);
    const crest = 0.5 - 0.5 * Math.cos(2 * Math.PI * q);
    const sideSpur = massif * 0.7 * smoothstep(0.08, 0.3, a) * crest * crest;
    const side = sideSpur + massif * (0.08 + 0.12 * a) * (crags(x, y, s, crag * 4, 2) - 0.35) + massif * 0.06 * (crags(x, y, s, crag, 1) - 0.35);
    // The natural benches: rock steps that wander across the slope, worn away here and there.
    const wander = step * BENCH.wander * noise.fbm3(x / (step * 10), y / (step * 10), s / (step * 10), 2);
    const kept = smoothstep(-0.35, 0.15, detail.fbm3(x / (step * 7) + 17.3, y / (step * 7), s / (step * 7), 2));
    // They follow the contours of the spurs (the elevation of the shaped slope), as strata wrap round a ridge.
    let shape = grow * (spur + side);
    const benches = kept * terraces(e + shape * nr + wander, step, alpha, BENCH.tread, BENCH.riser, BENCH.worn);
    shape += benches;
    // The horn at the head of the main valley: a pyramid of three faces between sharp arêtes.
    const main = form.valleyAt(0, s);
    const hx = (turnOf(theta - main) * r) / hornRadius, hy = (s - hornS) / hornRadius;
    if (hx * hx + hy * hy < 1.5) {
      let d = 0;
      for (let k = 0; k < 3; k++) { const c = Math.cos(k * 2.0944 + 0.5), sn = Math.sin(k * 2.0944 + 0.5); d = Math.max(d, hx * c + hy * sn); }
      d *= 1.6;
      if (d < 1) shape += massif * HORN.height * Math.pow(1 - d, 1.3) * (0.9 + 0.2 * crags(x, y, s, crag * 1.5, 2));
    }
    // The cirque on the far side: a floor dug level back into the slope, under a headwall, between steep sides.
    const over = e - cirqueLip;
    if (over > -cirqueDepth * 0.3 && over < cirqueDepth) {
      // Round at its head (the headwall an arc), open at its lip.
      const off = Math.abs(turnOf(theta - main - Math.PI)) * r / cirqueHalf, up = Math.max(0, over / cirqueDepth - 0.35) / 0.65;
      const inside = 1 - smoothstep(0.6, 1, Math.hypot(off, up));
      if (inside > 0) {
        const bowl = over > 0 ? -over / Math.max(nr, 0.2) : 0;
        // A low lip where the floor ends, the threshold the cirque's water spills over.
        const lip = massif * 0.12 * Math.exp(-((over / (cirqueDepth * 0.12)) ** 2));
        shape = shape * (1 - inside) + inside * (bowl + lip + benches * 0.2);
      }
    }
    return shape;
  };

  /** How rough the endcap is left where `gateAt` last shaped it: 1 wild, less on the Gate's built faces. */
  let built = 1;

  /** The Gate's shape at a point of the port endcap, as a height over the slope (and how rough it is left, `built`). */
  const gateAt = (theta: number, s: number, x: number, y: number, z: number, e: number, alpha: number, g: number): number => {
    const r = Math.max(R * g, 1e-6);
    const { valley, across } = form.acrossAt(theta, s), a = Math.abs(across), face = form.faces[valley];
    // Buttresses between the faces: narrow piers of rock from the foot to the hub.
    const grow = smoothstep(0.97, 0.8, g);
    const buttress = grow * massif * 0.8 * Math.pow(smoothstep(0.8, 1, a), 1.5) * (0.85 + 0.3 * crags(x, y, s, crag, 2));
    const body = 1 - smoothstep(0.72, 0.9, a);
    if (body <= 0) return buttress;
    const spec = GATE_TERRACES[face.kind], tier = step * spec.step;
    // Vine face: gentle folds the contour terraces curve round.
    const folds = face.kind === 'vine' ? grow * massif * 0.2 * noise.fbm3(x / (massif * 2 + 1), y / (massif * 2 + 1), z / (massif * 2 + 1), 2) : 0;
    const wander = tier * spec.wander * noise.fbm3(x / (tier * 12), y / (tier * 12), z / (tier * 12), 2);
    let shape = terraces(e - folds + wander, tier, alpha, spec.tread, spec.riser) + folds;
    // Stair face: the Lift Stair's ramp, a plain even slope up the main valley's line.
    // The Stair face is dressed stone, the Vine face tilled; the Water face keeps the rock it was cut from.
    built = 1 - body * (face.kind === 'stair' ? 0.95 : face.kind === 'vine' ? 0.6 : 0);
    if (face.kind === 'stair') shape *= smoothstep(form.stairHalfWidth, form.stairHalfWidth * 1.3, Math.abs(turnOf(theta - form.valleyAt(0, s))) * r);
    return body * shape + buttress;
  };

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
      const p = profile.at(s), e = h.radius - p.r, alpha = Math.asin(Math.min(1, Math.abs(p.nz)));
      const g = p.r / R, wild = s < floorStart;
      built = 1;
      const shaped = wild ? mountainAt(theta, s, x, y, e, alpha, g, Math.abs(p.nr)) : gateAt(theta, s, x, y, z, e, alpha, g);
      // Fade out near the axis and the hub, where everything crowds together.
      const fade = smoothstep(0, floorStart * 0.15, s) * (1 - smoothstep(profile.length - (profile.length - floorEnd) * 0.15, profile.length, s));
      // Rough ground, except where the Gate is built (`gateAt` sets how much of it is left).
      const rough = step * 0.08 * built * detail.fbm3(x / (step * 2), y / (step * 2), z / (step * 2), 3);
      height += (1 - f) * fade * (shaped + rough);
    }
    // Small ground roughness everywhere: tufts and hollows of a few tens of centimetres.
    height += Math.min(0.3, hills * 0.01) * detail.fbm3(x / 25, y / 25, z / 25, 3);
    return height;
  };

  const rivers = makeRivers(form, landAt);
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

  return { habitat: h, form, lake, rivers, riverAt: inRiver, heightAt, standAt, waterDepth };
}
