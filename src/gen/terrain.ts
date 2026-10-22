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
import { LEVEL_STEP, gradePath, pathsOf } from './paths';
import { carve, makeRivers, riverAt, valleyReach, type River, type RiverHit } from './rivers';
import { COURT, courtOf, fromLake, landformOf, planOf, type Court, type Lake, type Landform, type OnGround } from './plan';

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
  /**
   * The entrance court near a point (gen/plan.ts, `courtOf`) and how far the point is from its middle (m), when it is
   * within the court's radius and its clear ring (`COURT.clear` handrails); else null.
   */
  courtAt(theta: number, s: number): { court: PlacedCourt; distance: number } | null;
  /** Every entrance's court, with the height of its floor. */
  readonly courts: readonly PlacedCourt[];
  /** Which of a Gate face's terraces a point of the port endcap lies on, or null off the faces (the buttresses, the floor). */
  terraceAt(theta: number, s: number): GateTerrace | null;
  /**
   * How high a landform the plan built (a Ring, a Height: `Landform.landformAt`) and a district's work (gen/works.ts)
   * raise the land at a point, a Ring's terraces and a Height's rock included (m; 0 off them; a dug work lowers it).
   */
  builtAt(theta: number, s: number): number;
  /**
   * How much of the land at a point is built volume the living layer keeps under (m): a landform's designed top and a
   * raised work's; hollow, so the Understorey's deck keeps to the land under them (a dug work it follows down).
   */
  hollowAt(theta: number, s: number): number;
}

/**
 * A point on the Gate's terraces: its face, which terrace from the foot (one per wall), how much of it is the face
 * (0 … 1); the level the terraces are cut at there (m: a terrace's ledge follows a line of one level, its wall is where
 * the level crosses a whole `step`).
 */
export interface GateTerrace {
  face: FaceKind;
  tier: number;
  body: number;
  level: number;
  step: number;
}

/** A court as the terrain digs it: `floor` is its floor's height above the profile (m), `depth` under its lowest rim. */
export interface PlacedCourt extends Court {
  floor: number;
}

const DEG = Math.PI / 180;
/**
 * The Mountain's natural benches: their step (in terrace steps), how far their levels wander (in steps), their ledges'
 * and walls' angles from level, how worn their brinks are.
 */
const BENCH = { step: 2, wander: 0.8, tread: 10 * DEG, riser: 78 * DEG, worn: 0.15 };
/**
 * The Gate's faces, by kind: the step as a share of the terrace step, how far the levels wander (in steps), the
 * ledges' and walls' angles from level (a tread below level tilts back toward its wall and holds a pool).
 */
export const GATE_TERRACES: Readonly<Record<FaceKind, { step: number; wander: number; tread: number; riser: number }>> = {
  stair: { step: 0.3, wander: 0, tread: 1 * DEG, riser: 87 * DEG },
  vine: { step: 0.25, wander: 0.3, tread: 3 * DEG, riser: 84 * DEG },
  water: { step: 0.5, wander: 2.5, tread: -3 * DEG, riser: 88 * DEG },
};
/** The Mountain's horn and cirque: where they stand (gravity, as a share of the floor's), their sizes in massifs. */
/**
 * The floor's valleys (gen/plan.ts, `acrossAt`): the ground rises from each valley's middle to the ridges between
 * valleys by this many hill heights, and the hills on a valley's floor are this share of those on its ridges, so each
 * valley is a long room with a broad meadow floor, its river down the middle, and rolling woods up its sides.
 */
export const FLOOR_VALLEYS = { ridge: 1.2, floor: 0.45 };
/**
 * The wild's bolder relief (`relief.landforms.wild`): up a valley's sides the hills grow that many times higher again
 * where the land is let be, fading in from `care` (`Landform.careAt`) down to the reserve's 0. The valleys' floors, where
 * the rivers and the Sunwalk run, stay as gentle as they were.
 */
export const WILD_RELIEF = { care: 0.4 };

/**
 * The Rings' fronts (gen/plan.ts), cut in terraces like the Gate's Vine face at the floor's scale: the step as a share
 * of the terrace step, how far the levels wander (in steps), the ledges' and walls' angles from level.
 */
export const RING_TERRACES = { step: 0.25, wander: 0.3, tread: 3 * DEG, riser: 80 * DEG };
/** The Heights' flanks: crags a `crag` share of the Height wide and a `depth` share deep, over the Mountain's benches. */
export const HEIGHT_ROCK = { crag: 0.4, depth: 0.05 };

/** A ridged noise (0 … 1) from a noise value: sharp crests, rounded over a few hundredths so one can stand on them. */
const ridged = (f: number): number => {
  const n = Math.max(0, 1 - Math.sqrt(f * f + 0.0225) * 1.8);
  return n * n;
};

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

  const form = landformOf(h), lake = form.lake, plan = planOf(h), wildBoost = relief.landforms?.wild ?? 0;
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
  const crags = (x: number, y: number, s: number, w: number, octaves: number): number => ridged(cragNoise.fbm3(x / w, y / w, s / (w * 3), octaves));

  /** The Mountain's shape at a point of the wild endcap, as a height over the slope (`g`: gravity there). */
  const mountainAt = (theta: number, s: number, x: number, y: number, e: number, alpha: number, g: number, nr: number): number => {
    const r = Math.max(R * g, 1e-6);
    // Spurs between the couloirs, from the foothills to the snow near the axis: the main spur on the ridge between two
    // valleys, side spurs down each valley's flanks (sharp crests over rounded gullies, wandering a little), then crags.
    // Near the axis the valleys crowd together: a spur only stands as tall as it has room to be wide (half the gap
    // between two valleys there), so the summit band closes into one broad dome instead of a ring of thin fins.
    const room = (Math.PI / form.valleys) * r;
    const grow = smoothstep(0.97, 0.75, g) * smoothstep(0.03, 0.2, g) * smoothstep(massif * 1.5, massif * 4, room);
    const a = Math.abs(form.acrossAt(theta, s).across);
    const spur = massif * 1.4 * Math.pow(smoothstep(0.05, 0.95, a), 1.3);
    const q = a * flanks + 0.25 * noise.fbm3(x / (massif * 8), y / (massif * 8), s / (massif * 8), 2);
    const crest = 0.5 - 0.5 * Math.cos(2 * Math.PI * q);
    // Side spurs likewise give way where they would be narrower than about two massifs.
    const sideSpur = massif * smoothstep(0.08, 0.3, a) * crest * crest * smoothstep(1.5, 3, room / flanks / Math.max(massif, 1e-6));
    // Broad fractures, not fine wrinkles: the smaller rock is the stones' and boulders'.
    const side = sideSpur + massif * (0.1 + 0.15 * a) * (crags(x, y, s, crag * 4, 2) - 0.35);
    // The natural benches: a few rock steps across the slope, each ending within an arc, none in the couloirs.
    const bench = step * BENCH.step;
    const wander = bench * BENCH.wander * noise.fbm3(x / (bench * 10), y / (bench * 10), s / (bench * 10), 2);
    const kept = smoothstep(0.1, 0.35, detail.fbm3(x / (massif * 4) + 17.3, y / (massif * 4), s / (massif * 4), 2)) * smoothstep(0.15, 0.35, a);
    // They follow the contours of the spurs (the elevation of the shaped slope), as strata wrap round a ridge.
    let shape = grow * (spur + side);
    const benches = kept * terraces(e + shape * nr + wander, bench, alpha, BENCH.tread, BENCH.riser, BENCH.worn);
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

  /**
   * How a Gate face's terraces are cut at a world point `e` m up the endcap (`grow`: how much the faces stand out there):
   * one wall per `tier` of the `level`, which is the elevation less the Vine face's folds, plus the levels' wander.
   */
  const cutOf = (kind: FaceKind, x: number, y: number, z: number, e: number, grow: number): { tier: number; folds: number; level: number } => {
    const spec = GATE_TERRACES[kind], tier = step * spec.step;
    // Vine face: broad folds the contour terraces curve round. Water face: basins lobed like travertine rims.
    const fold = massif * 3 + 1;
    const folds = kind === 'vine' ? grow * massif * 0.6 * noise.fbm3(x / fold, y / fold, z / fold, 2) : 0;
    // The Water face's basins are tens of metres across, a few to a face's width from afar (not a fine crinkle).
    const lobe = tier * (kind === 'water' ? 16 : 12);
    const wander = tier * spec.wander * noise.fbm3(x / lobe, y / lobe, z / lobe, 2);
    return { tier, folds, level: e - folds + wander };
  };

  /** The Gate's shape at a point of the port endcap, as a height over the slope (and how rough it is left, `built`). */
  const gateAt = (theta: number, s: number, x: number, y: number, z: number, e: number, alpha: number, g: number): number => {
    const r = Math.max(R * g, 1e-6);
    const { valley, across } = form.acrossAt(theta, s), a = Math.abs(across), face = form.faces[valley];
    // Buttresses between the faces: broad piers of rock from the foot to the hub.
    const grow = smoothstep(0.97, 0.8, g);
    const buttress = grow * massif * 1.3 * Math.pow(smoothstep(0.65, 1, a), 1.3) * (0.85 + 0.3 * crags(x, y, s, crag * 2, 2));
    const body = 1 - smoothstep(0.6, 0.8, a);
    if (body <= 0) return buttress;
    const spec = GATE_TERRACES[face.kind], { tier, folds, level } = cutOf(face.kind, x, y, z, e, grow);
    let shape = terraces(level, tier, alpha, spec.tread, spec.riser) + folds;
    // Stair face: the Lift Stair's ramp, a plain even slope up the main valley's line.
    // The Stair face is dressed stone, the Vine face tilled; the Water face keeps the rock it was cut from.
    built = 1 - body * (face.kind === 'stair' ? 0.95 : face.kind === 'vine' ? 0.6 : 0);
    if (face.kind === 'stair') shape *= smoothstep(form.stairHalfWidth, form.stairHalfWidth * 1.3, Math.abs(turnOf(theta - form.valleyAt(0, s))) * r);
    return body * shape + buttress;
  };

  /**
   * A landform's surface over the land at a world point (`base` m up before it): its designed shape (`plan.landformAt`), a
   * Ring's front cut in terraces along the contours, a Height's flanks broken by crags and rock benches.
   */
  const formAt = (on: OnGround, x: number, y: number, z: number, base: number): number => {
    const g = on.form, H = g.height;
    let top = on.top;
    const alpha = Math.atan(on.slope), e = base + top;
    if (g.kind === 'ring') {
      if (on.face <= 0) return top;
      const tier = step * RING_TERRACES.step, lobe = tier * 12;
      const wander = tier * RING_TERRACES.wander * noise.fbm3(x / lobe, y / lobe, z / lobe, 2);
      return top + on.face * terraces(e + wander, tier, alpha, RING_TERRACES.tread, RING_TERRACES.riser);
    }
    // A Height: its plateau and its foot smooth, its flanks rock.
    const flank = smoothstep(0.02, 0.2, on.share) * (1 - smoothstep(0.8, 0.97, on.share));
    if (flank <= 0) return top;
    const w = H * HEIGHT_ROCK.crag;
    let rock = H * HEIGHT_ROCK.depth * (ridged(cragNoise.fbm3(x / w + 41.7, y / w, z / w, 2)) - 0.35);
    const bench = step * BENCH.step;
    const wander = bench * BENCH.wander * noise.fbm3(x / (bench * 10), y / (bench * 10), z / (bench * 10), 2);
    const kept = smoothstep(0.1, 0.35, detail.fbm3(x / (massif * 4) + 17.3, y / (massif * 4), z / (massif * 4), 2));
    rock += kept * terraces(e + rock + wander, bench, alpha, BENCH.tread, BENCH.riser, BENCH.worn);
    return top + flank * rock;
  };

  /** How high `landAt` last found a landform raising the land. */
  let raised = 0;

  /** The land before the rivers carve it. */
  const landAt = (theta: number, s: number): number => {
    const [x, y, z] = at(theta, s);
    let height = 0;
    const f = onFloor(s);
    // The landforms the plan built on the floor (gen/plan.ts: the Rings and the Heights).
    const on = f > 0 ? form.landformAt(theta, s) : null;
    if (f > 0 && hills > 0) {
      const n = noise.fbm3(x / hillWave, y / hillWave, z / hillWave, 5);
      // Up a valley's sides to the ridge: the land rises, and the hills roll more than on the valley's floor.
      const side = form.valleys > 1 ? smoothstep(0.15, 0.95, form.ridgeAt(theta, s)) : 0;
      // In the wild the valleys' sides rise bolder (the reserve, and land let go toward it).
      const wild = wildBoost > 0 ? 1 + wildBoost * (1 - smoothstep(0, WILD_RELIEF.care, form.careAt(s))) : 1;
      let hill = hills * Math.pow(smoothstep(-0.25, 0.85, n), 1.6) * (FLOOR_VALLEYS.floor + (1 - FLOOR_VALLEYS.floor) * side * wild);
      // A Height's top is a garden, kept level: the hills die away on it.
      if (on && on.form.kind === 'height') hill *= 1 - smoothstep(0.85, 1, on.share);
      hill += hills * FLOOR_VALLEYS.ridge * side;
      const k = inLake(s);
      if (k !== null && lake) hill *= smoothstep(0, shore, -k * lake.halfWidth); // 0 at the water, full a shore away
      height += f * hill;
    }
    raised = on ? f * formAt(on, x, y, z, height) : 0;
    // The districts' works (gen/works.ts), raised or dug.
    if (f > 0 && plan.works.length) raised += f * plan.worksAt(theta, s);
    height += raised;
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

  // The paths (gen/paths.ts): the ground levelled across each at the land of its middle line, except where that lies
  // under the lake (the Sunwalk crosses it on the pavilion's bridges) or in a river; the courts the ways lead down into
  // are dug after.
  // The level along each piece is the land's, taken every `LEVEL_STEP` widths, the first time the piece is met (at
  // most the paths' length over that step, in floats: a few hundred kB for the reference, all of it walked).
  const net = pathsOf(h);
  const levels: (Float32Array | undefined)[] = [];
  const levelOf = (piece: number, t: number, width: number): number => {
    let line = levels[piece];
    if (!line) {
      const n = Math.max(1, Math.ceil(net.lengthOf(piece) / (width * LEVEL_STEP)));
      line = levels[piece] = new Float32Array(n + 1);
      for (let i = 0; i <= n; i++) { const p = net.pointOf(piece, i / n); line[i] = carved(p.theta, p.s); }
    }
    const f = t * (line.length - 1), i = Math.min(line.length - 2, Math.floor(f));
    return line.length < 2 ? line[0] : line[i] + (line[i + 1] - line[i]) * (f - i);
  };
  /** The land with the rivers' channels and valleys carved into it. */
  const carved = (theta: number, s: number): number => {
    const g = landAt(theta, s);
    const hit = rivers.length ? riverAt(rivers, theta, s, reach) : null;
    return hit ? carve(hit, hit.river.depth, g) : g;
  };

  /** The ground before the courts are dug: the land, the rivers carved into it, the paths levelled over it. */
  const uncut = (theta: number, s: number): number => {
    const g = landAt(theta, s);
    const hit = rivers.length ? riverAt(rivers, theta, s, reach) : null;
    let ground = hit ? carve(hit, hit.river.depth, g) : g;
    // A path over the carved land (down a river's valley side and up the other), but not through its water: there
    // the river's bed is the ground (a ford, for now).
    const way = net.pieces ? net.pathAt(theta, s) : null;
    if (way && !(hit && Math.abs(hit.across) < hit.halfWidth)) {
      const level = levelOf(way.piece, way.along, way.width);
      if (!(lake && level < lake.level && fromLake(lake, way.s) < 0)) ground = gradePath(ground, level, way);
    }
    return ground;
  };

  // The entrances' courts, each with the level of its floor, filed in a grid over the unrolled floor by every cell its
  // clear ring touches, so a point looks in one cell.
  const clear = COURT.clear * (h.params.landmarks?.handrail ?? 0);
  const courts: { court: PlacedCourt; floor: number; reach: number }[] = [];
  for (const site of planOf(h).sites) {
    const c = site.kind === 'entrance' ? courtOf(h, site) : null;
    if (!c) continue;
    // The floor lies its depth under the lowest ground on the rim (a river's bank or a way cut into it included), so
    // it never opens to daylight downhill.
    let low = uncut(c.theta, c.s);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      low = Math.min(low, uncut(c.theta + (c.radius * Math.cos(a)) / R, c.s + c.radius * Math.sin(a)));
    }
    const floor = low - c.depth;
    courts.push({ court: { ...c, floor }, floor, reach: c.radius + clear });
  }
  const cell = Math.max(1, ...courts.map((c) => c.reach * 2)), columns = Math.max(1, Math.floor((2 * Math.PI * R) / cell));
  const turn = (theta: number): number => theta - 2 * Math.PI * Math.floor(theta / (2 * Math.PI));
  const cellOf = (column: number, row: number): number => row * columns + (((column % columns) + columns) % columns);
  const filed = new Map<number, typeof courts>();
  for (const c of courts) {
    const u = (turn(c.court.theta) / (2 * Math.PI)) * columns, v = c.court.s / cell, w = c.reach / cell;
    for (let row = Math.floor(v - w); row <= Math.floor(v + w); row++) for (let column = Math.floor(u - w); column <= Math.floor(u + w); column++) {
      const key = cellOf(column, row), list = filed.get(key);
      if (list) list.push(c); else filed.set(key, [c]);
    }
  }
  const nearCourt = (theta: number, s: number): { at: (typeof courts)[number]; distance: number } | null => {
    const list = filed.get(cellOf(Math.floor((turn(theta) / (2 * Math.PI)) * columns), Math.floor(s / cell)));
    if (!list) return null;
    for (const at of list) {
      const a = theta - at.court.theta, du = (a - 2 * Math.PI * Math.round(a / (2 * Math.PI))) * R, ds = s - at.court.s, d = Math.sqrt(du * du + ds * ds);
      if (d < at.reach) return { at, distance: d };
    }
    return null;
  };
  const courtAt = (theta: number, s: number): { court: PlacedCourt; distance: number } | null => {
    const near = nearCourt(theta, s);
    return near ? { court: near.at.court, distance: near.distance } : null;
  };
  /** The ground dug for a court: its level floor, then a wall at least `COURT.wall` steep up to the ground at the rim. */
  const dig = (ground: number, floor: number, radius: number, d: number): number => {
    const inner = radius * COURT.floor;
    if (d <= inner) return floor;
    const t = (d - inner) / (radius - inner), up = ground - floor;
    return up > 0 ? floor + up * Math.min(1, Math.max(t, ((d - inner) * Math.tan(COURT.wall)) / up)) : floor + up * t;
  };

  const heightAt = (theta: number, s: number): number => {
    const ground = uncut(theta, s), near = courts.length ? nearCourt(theta, s) : null;
    return near && near.distance < near.at.court.radius ? dig(ground, near.at.floor, near.at.court.radius, near.distance) : ground;
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

  const terraceAt = (theta: number, s: number): GateTerrace | null => {
    if (!(s > floorEnd && s < profile.length)) return null;
    const p = profile.at(s), g = p.r / R, [x, y, z] = at(theta, s);
    const { valley, across } = form.acrossAt(theta, s), face = form.faces[valley].kind;
    const body = 1 - smoothstep(0.6, 0.8, Math.abs(across));
    if (body <= 0) return null;
    const { tier, level } = cutOf(face, x, y, z, R - p.r, smoothstep(0.97, 0.8, g));
    return { face, tier: Math.floor(level / tier), body, level, step: tier };
  };

  const builtAt = (theta: number, s: number): number => {
    landAt(theta, s);
    return raised;
  };
  const hollowAt = (theta: number, s: number): number => {
    const f = onFloor(s);
    return f > 0 ? f * ((form.landformAt(theta, s)?.top ?? 0) + Math.max(0, plan.worksAt(theta, s))) : 0;
  };

  return { habitat: h, form, lake, rivers, riverAt: inRiver, heightAt, standAt, waterDepth, courtAt, courts: courts.map((c) => c.court), terraceAt, builtAt, hollowAt };
}
