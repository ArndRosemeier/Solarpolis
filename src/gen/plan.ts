/**
 * The habitat plan: the macro layout stage, the habitat mind's design for its land before anything grows (design doc
 * "A land people make", Arnd 2026-10-21). Nothing in the interior should be noise at the large scale: every place has
 * an author and a reason. This stage holds the authors' big decisions as a few hundred shapes that terrain, ecology,
 * scatter and the landmarks read:
 *
 *   care      how made and tended the land is along the axis: 0 in the wild reserve, 1 at the port end;
 *   gravity   the bands up the endcaps (`GRAVITY_BANDS`): foothills, middle slopes, high slopes, the top near the axis;
 *   valleys   long valleys along the axis, evenly round it, with ridges between (`acrossAt`);
 *   endcaps   the port end is the Gate, one face per valley (the Stair face, Vine and Water faces); the wild end is the
 *             Mountain, one massif with its summit at the end of the main valley and a snowfield near the axis;
 *   rivers    each with a role: the great river down the main valley, a canal from the Water face, brooks, cascades;
 *   districts the worked floor cut into districts, one over each neighbourhood of the living layer, each shaping its
 *             commons in a style of the habitat's culture (blueprint/cultures.ts), never the same as its neighbours;
 *   grounds   the big landforms built on the floor (design "Shaped ground", Arnd 2026-10-22): the Rings, ridges round the
 *             whole cylinder across its axis that part the floor into landscape rooms, and the Heights, lone mounts on
 *             the ridges between the valleys (`GroundForm`, `landformAt`);
 *   sites     the entrances down to the living layer and the landmarks (`Site`);
 *   paths     the Sunwalk (the long path along the main valley, walked with the travelling sun), the ways between the
 *             entrances, the trail up the Mountain.
 *
 * Pure and seeded: the same habitat always gets the same plan. Sizes are shares of the habitat (its radius, its floor,
 * its relief) or come from `HabitatParams.plan`, so every habitat of the blueprint matrix gets a plan of its own size.
 * Coordinates are the profile's (θ, s); distances over the floor are measured unrolled (θ times the radius, and s).
 */
import { Rng, Noise, angleDiff, deriveSeed, smoothstep } from '@futuremagic/core';
import { cultureOf, type Culture, type DistrictStyle, type FaceKind, type Habitat } from '../blueprint';
import { kept } from './kept';
import { fileUnder, floorGrid } from './floorGrid';
import { baysOf } from './bays';

const TURN = 2 * Math.PI;

/** Gravity, as a share of the floor's, where the endcap bands meet: foothills above the first, the top below the last. */
export const GRAVITY_BANDS = [0.75, 0.4, 0.15] as const;
export type Band = 'foot' | 'middle' | 'high' | 'top';

/** The ring lake: where its centre line lies along the profile, its half width and depth (m), its water surface. */
export interface Lake {
  s: number;
  halfWidth: number;
  depth: number;
  /** The water's surface, as a height above the profile (on the flat floor that is a constant radius). */
  level: number;
}

/** How far a place along the axis lies from the ring lake's shore (m, negative in the water; far without a lake). */
export const fromLake = (lake: Lake | null, s: number): number => (lake ? Math.abs(s - lake.s) - lake.halfWidth : Infinity);

export type { FaceKind } from '../blueprint';

export interface Face {
  index: number;
  kind: FaceKind;
  /** The face's middle, around the axis (at the endcap wall). */
  theta: number;
}

/** The wild end's mountain. */
export interface Mountain {
  /** Its summit and its cirque (the hollow on the far side), around the axis. */
  summit: number;
  cirque: number;
  /** Above this height on the endcap (below this share of the floor's gravity) lies the snowfield. */
  snowLine: number;
}

export type RiverRole = 'great' | 'canal' | 'brook' | 'cascade';

/** A river as the plan intends it; `gen/rivers.ts` lays the water along it. */
export interface PlannedRiver {
  role: RiverRole;
  from: 'wild' | 'port';
  /** The valley it runs down, and how far off the valley's middle line (a share of half the valley's width, signed). */
  valley: number;
  offset: number;
  /** Where its spring is along the profile. */
  spring: number;
  /** How far it swings to either side, in river widths (0 for the canal: it runs straight). */
  meander: number;
}

export type SiteKind = 'entrance' | 'lift-stair' | 'summit-hut' | 'lake-pavilion' | 'founders-grove';

/**
 * A place the plan keeps for something: an entrance down to the living layer, or a landmark. `size` is the radius of
 * the ground kept for it (m); `facing` the way it looks, in the ground's plane: 0 toward the port end (+s), π/2 spinward
 * (+θ).
 */
export interface Site {
  kind: SiteKind;
  theta: number;
  s: number;
  size: number;
  facing: number;
  /** The district it belongs to, or -1. */
  district: number;
}

export interface District {
  id: number;
  /** Its seed: the middle it grew from (the district is every point of the worked floor nearer this than any other). */
  theta: number;
  s: number;
  style: DistrictStyle;
  care: number;
  /** Its neighbours' ids. */
  neighbours: number[];
  entrances: Site[];
}

/**
 * A big landform on the floor. A Ring runs round the whole cylinder: `s` is its middle line's mean (it wanders a little
 * round the axis, `ringLine`), its steep face looks along `facing` (+1: toward the port end), its long slope the other
 * way, and it falls to saddles over the valleys and opens to gorges where the rivers run. A Height stands alone at
 * (`theta`, `s`): sheer flanks round a summit plateau. `height` is its crest's (m over the land it stands on), `radius`
 * how far its footprint reaches from its middle (a Ring: from its mean line, down its long slope, wander and all).
 */
export interface GroundForm {
  id: number;
  kind: 'ring' | 'height';
  theta: number;
  s: number;
  height: number;
  radius: number;
  facing: number;
}

/** Where a point lies on a landform: which, its designed surface over the land there (m), and 0 at its foot … 1 at its crest. */
export interface OnGround {
  form: GroundForm;
  top: number;
  share: number;
}

/**
 * The landforms' shapes, in shares of a form's height. A Ring's crest is `crest` heights wide; its steep face falls in
 * `face` heights, its long slope in `slope`; it keeps `saddle` of its height over a valley's middle (where the ways
 * and the Sunwalk cross it, both sides as gentle as the long slope), and opens to the land within `gorge` of a river's
 * route (at least `gorgeMin` of the river's width). Its line wanders `wander` radii along the axis. A Height's plateau
 * is `plateau` of its height across, its foot `foot` heights out.
 */
export const GROUND = { crest: 0.15, face: 1, slope: 4, saddle: 0.3, gorge: 0.25, gorgeMin: 4, wander: 0.08, plateau: 0.2, foot: 1.3 };

export type PathKind = 'sunwalk' | 'way' | 'trail';

export interface PlanPath {
  kind: PathKind;
  /** How wide it is (m, `LandPlan.pathWidth`). */
  width: number;
  /** Points along it: θ, s, θ, s, … (θ unwrapped: it never jumps by a turn between points). */
  points: Float64Array;
}

/**
 * The plan's big shapes, which the land itself is made from (terrain, rivers): the gradients, the valleys, the endcaps
 * and the rivers' roles. Cheap to make (no districts, sites or paths), so every terrain makes its own.
 */
export interface Landform {
  readonly habitat: Habitat;
  readonly lake: Lake | null;
  /** Where the reserve ends and the worked floor begins, along the profile. */
  readonly reserveEnd: number;
  readonly valleys: number;
  readonly faces: readonly Face[];
  readonly mountain: Mountain;
  readonly rivers: readonly PlannedRiver[];
  /** Where the first valley starts around the axis, before it wanders. */
  readonly phase: number;
  /** Half the width of the Lift Stair, the plain ramp up the middle of the Stair face (m). */
  readonly stairHalfWidth: number;
  /** How made and tended the land is at s: 0 in the wild reserve, rising to 1 at the hub. */
  careAt(s: number): number;
  /** Gravity at the ground at s as a share of the floor's, and its band. */
  gravityAt(s: number): number;
  bandAt(s: number): Band;
  /**
   * The middle line of valley k at s (θ, unwrapped near the valley's own start). Up the endcaps the valleys turn
   * spinward (`LandPlan.spiral`), so their couloirs, the Gate's faces and the rivers in them spiral toward the axis.
   */
  valleyAt(k: number, s: number): number;
  /** Where (θ, s) lies across the valleys: the nearest valley, and −1 … 1 from one ridge over its middle (0) to the next. */
  acrossAt(theta: number, s: number): { valley: number; across: number };
  /** How far up its valley's side (θ, s) lies: |across|, 0 on the valley's middle line … 1 on the ridge (no allocation). */
  ridgeAt(theta: number, s: number): number;
  /** The port face a point of the port endcap belongs to (the face of the valley it lies in). */
  faceAt(theta: number, s: number): Face;
  /** Where a planned river's middle line runs at s (θ), before it meanders. */
  routeOf(river: PlannedRiver, s: number): number;
  /** The point of an endcap (`wild`, or the port's) where gravity is the share `g` of the floor's, along the profile. */
  endcapAt(wild: boolean, g: number): number;
  /** The big landforms on the floor (`HabitatParams.relief.landforms`): the Rings in order along the axis, then the Heights. */
  readonly grounds: readonly GroundForm[];
  /** A Ring's middle line at θ (s). */
  ringLine(ring: GroundForm, theta: number): number;
  /** The landform a point of the floor lies on and its designed surface there, or null off every footprint. */
  landformAt(theta: number, s: number): OnGround | null;
}

export interface Plan extends Landform {
  readonly culture: Culture;
  readonly districts: readonly District[];
  /** Every site: the landmarks first, then the entrances. */
  readonly sites: readonly Site[];
  readonly paths: readonly PlanPath[];
  /** The district a point of the worked floor belongs to, or null (the reserve, the lake, the endcaps). */
  districtAt(theta: number, s: number): District | null;
  /**
   * The district a point belongs to, with how far it lies inside it (m, to the nearest border with another district)
   * and the district across that border; null where `districtAt` is.
   */
  borderAt(theta: number, s: number): { district: District; other: District; edge: number } | null;
}

/** Brings an angle into [−π, π] (the shortest turn to it). */
const wrap = (a: number): number => angleDiff(0, a);

/** The ring lake of a habitat, or null: in the port half of the floor, away from the endcap's foot. */
export function lakeOf(h: Habitat): Lake | null {
  const relief = h.params.relief, { floorStart, floorEnd } = h.profile, floor = floorEnd - floorStart;
  if (!relief.ringLake) return null;
  const rng = new Rng(deriveSeed(h.seed, 'terrain', 'lake'));
  const half = relief.ringLake.width / 2;
  const lo = floorStart + floor * 0.55 + half, hi = floorEnd - floor * 0.1 - half;
  const s = lo < hi ? rng.range(lo, hi) : (floorStart + floorEnd) / 2;
  return { s, halfWidth: half, depth: relief.ringLake.depth, level: -Math.min(1, relief.ringLake.depth * 0.1) };
}

/** The port faces' kinds by valley: the main valley ends in the Stair face, the others alternate Vine and Water. */
function faceKinds(n: number): FaceKind[] {
  const out: FaceKind[] = ['stair'];
  for (let k = 1; k < n; k++) out.push(n === 2 || k % 2 === 0 ? 'water' : 'vine');
  return out;
}

/** A plan's site of a kind: the first (a landmark has one), or undefined. */
export const siteOf = (plan: Plan, kind: SiteKind): Site | undefined => plan.sites.find((x) => x.kind === kind);

/** The plan's entrances down to the living layer, in the plan's order (the courts residents live under, the hamlets below). */
export const entrancesOf = (plan: Plan): Site[] => plan.sites.filter((x) => x.kind === 'entrance');

/**
 * An entrance's court: the hole the terrain digs for it, its floor level `depth` m under the lowest ground on its rim
 * out to `COURT.floor` of its `radius`, then a wall at least `COURT.wall` steep up to the ground at the rim (the floor's
 * height is the terrain's: `Terrain.courts`). The court's walls, stairs and floor are built by the landmarks
 * (gen/landmarks.ts); trees and stones keep `COURT.clear` handrails off it.
 */
export interface Court {
  theta: number;
  s: number;
  radius: number;
  depth: number;
}

/** The steepest a landform's designed surface may be under an entrance court (rise per run). */
export const COURT_SLOPE = 0.12;

/**
 * How high over the land a court may stand on a landform: as high as the living layer rises inside one (its great
 * halls, `under.hall`), or a fiftieth of the radius where the habitat names no such height.
 */
export const courtCap = (h: Habitat): number => (h.params.under as { hall?: number }).hall ?? h.radius * 0.02;

/** The courts' shape: the floor's share of the radius, the wall's least steepness, the depth and the clear ring in handrails. */
export const COURT = { floor: 0.9, wall: (60 * Math.PI) / 180, depth: 3, clear: 2 };

/** The court an entrance site digs, or null in a habitat built without landmarks (nothing to build its walls). */
export const courtOf = (h: Habitat, site: Site): Court | null =>
  h.params.landmarks ? { theta: site.theta, s: site.s, radius: site.size, depth: COURT.depth * h.params.landmarks.handrail } : null;

/** The habitat's plan, made once per habitat and then kept (making one walks the whole floor). */
export const planOf: (h: Habitat) => Plan = kept(makePlan);

/** The habitat's landform, made once per habitat and kept (the terrain and the plan share it). */
export const landformOf: (h: Habitat) => Landform = kept(makeLandform);

export function makeLandform(h: Habitat): Landform {
  const { profile, params } = h, R = h.radius, spec = params.plan;
  const { floorStart, floorEnd } = profile, floor = floorEnd - floorStart;
  const N = Math.max(1, Math.round(spec.valleys)), gap = TURN / N;
  const rng = new Rng(deriveSeed(h.seed, 'plan'));
  const wander = new Noise(deriveSeed(h.seed, 'plan', 'valleys'));
  const lake = lakeOf(h);
  const reserveEnd = floorStart + floor * spec.reserve;

  // Care: knots along the profile, joined by smooth steps, so it only ever rises toward the port.
  const knots: [number, number][] = [[0, 0], [floorStart, 0], [reserveEnd, 0.2], [Math.min(floorEnd, reserveEnd + floor * 0.06), 0.35], [floorEnd, 0.85], [profile.length, 1]];
  const careAt = (s: number): number => {
    for (let i = 1; i < knots.length; i++) {
      const [s1, c1] = knots[i];
      if (s <= s1) {
        const [s0, c0] = knots[i - 1];
        return s1 > s0 ? c0 + (c1 - c0) * smoothstep(s0, s1, s) : c1;
      }
    }
    return 1;
  };
  const gravityAt = (s: number): number => Math.min(1, profile.at(s).r / R);
  // The turn up the endcaps: none on the floor, the whole spiral at the axis.
  const twist = (s: number): number => (s < floorStart || s > floorEnd ? spec.spiral * (1 - gravityAt(s)) : 0);
  const bandAt = (s: number): Band => {
    const g = gravityAt(s);
    return g >= GRAVITY_BANDS[0] ? 'foot' : g >= GRAVITY_BANDS[1] ? 'middle' : g >= GRAVITY_BANDS[2] ? 'high' : 'top';
  };

  // Valleys: evenly round the axis from a seeded start, each wandering a little to either side along its length (at
  // most a sixth of the gap to its neighbour, in bends about two valley widths long).
  const phase = rng.range(0, gap);
  const bend = Math.max(gap * R * 2, 1);
  // Each valley's wander, which bends over many kilometres, kept in a table along the profile (every height asks for
  // it, a tile's horizons along s as much as its rows across): linear between points a two-thousandth of the length
  // apart, far closer than it bends.
  const STEPS = 2048, length = profile.length, wandered = new Float64Array((STEPS + 1) * N);
  for (let i = 0; i <= STEPS; i++) for (let k = 0; k < N; k++) wandered[i * N + k] = (gap / 6) * wander.fbm2(((i / STEPS) * length) / bend, k * 7.31, 2);
  const valleyAt = (k: number, s: number): number => {
    const u = (Math.min(length, Math.max(0, s)) / length) * STEPS, i = Math.min(STEPS - 1, Math.floor(u)), f = u - i;
    return phase + gap * k + wandered[i * N + k] * (1 - f) + wandered[(i + 1) * N + k] * f + twist(s);
  };
  // Where a point lies across the valleys, into `found` (no allocation: every height on the floor asks).
  const lines = new Float64Array(N), found = { valley: 0, across: 0 };
  const locate = (theta: number, s: number): void => {
    for (let k = 0; k < N; k++) lines[k] = valleyAt(k, s);
    let best = 0, d = Infinity;
    for (let k = 0; k < N; k++) {
      const a = theta - lines[k], t = a - TURN * Math.round(a / TURN);
      if (Math.abs(t) < Math.abs(d)) { d = t; best = k; }
    }
    found.valley = best;
    if (N === 1) { found.across = d / Math.PI; return; }
    // The ridge lies halfway to the neighbouring valley on the point's side.
    const next = (best + (d >= 0 ? 1 : N - 1)) % N, apart = lines[next] - lines[best];
    const half = Math.abs(apart - TURN * Math.round(apart / TURN)) / 2;
    found.across = Math.max(-1, Math.min(1, d / half));
  };
  const acrossAt = (theta: number, s: number): { valley: number; across: number } => {
    locate(theta, s);
    return { valley: found.valley, across: found.across };
  };
  const ridgeAt = (theta: number, s: number): number => {
    locate(theta, s);
    return Math.abs(found.across);
  };

  // The Gate's faces, one per valley, each centred where its valley meets the port wall.
  const kinds = faceKinds(N);
  const faces: Face[] = kinds.map((kind, index) => ({ index, kind, theta: wrap(valleyAt(index, profile.length)) }));
  const faceAt = (theta: number, s: number): Face => faces[acrossAt(theta, s).valley];

  // The Mountain: its summit at the end of the main valley, the cirque on the far side, the snow on the top band.
  const summit = wrap(valleyAt(0, 0));
  const mountain: Mountain = { summit, cirque: wrap(summit + Math.PI), snowLine: GRAVITY_BANDS[2] };

  /** The point on an endcap (`wild` or port) where gravity is the given share of the floor's. */
  const endcapAt = (wild: boolean, g: number): number => {
    let lo = wild ? 0 : floorEnd, hi = wild ? floorStart : profile.length;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      // Gravity rises toward the floor: on the wild end with s, on the port end against it.
      if ((gravityAt(mid) < g) === wild) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // Rivers, by role: the great river down the main valley from the Mountain's snow, then a canal from the Water face
  // (or the Stair face), then brooks off the Mountain and cascades off the Gate into the other valleys.
  const rivers: PlannedRiver[] = [];
  const count = lake ? params.relief.rivers?.count ?? 0 : 0;
  const water = faces.find((f) => f.kind === 'water') ?? faces[0];
  // Cascades come down the faces beside the Stair face (its own water is the Stair's fountains, not a river).
  const gateFaces = faces.length > 1 ? faces.filter((f) => f.kind !== 'stair') : faces;
  const used = new Map<string, number>();
  const offsetIn = (from: string, valley: number): number => {
    const key = `${from}${valley}`, n = used.get(key) ?? 0;
    used.set(key, n + 1);
    // The first down the middle, the next ones out to either side, clear of the Sunwalk's line (a quarter out).
    return n === 0 ? 0 : n % 2 ? -Math.min(0.9, 0.3 * Math.ceil(n / 2)) : Math.min(0.9, 0.25 + 0.3 * (n / 2));
  };
  for (let i = 0; i < count; i++) {
    let role: RiverRole, from: 'wild' | 'port', valley: number;
    if (i === 0) { role = 'great'; from = 'wild'; valley = 0; }
    else if (i === 1) { role = 'canal'; from = 'port'; valley = water.index; }
    else if (i % 2 === 0) { role = 'brook'; from = 'wild'; valley = (i / 2) % N; }
    else { role = 'cascade'; from = 'port'; valley = gateFaces[(Math.floor(i / 2) - 1) % gateFaces.length].index; }
    const spring = role === 'great' ? endcapAt(true, mountain.snowLine * 1.4)
      : role === 'canal' ? endcapAt(false, 0.7)
      : endcapAt(from === 'wild', rng.range(0.25, 0.45));
    const meander = role === 'great' ? 8 : role === 'canal' ? 0 : role === 'brook' ? 5 : 3;
    rivers.push({ role, from, valley, offset: offsetIn(from, valley), spring, meander });
  }
  /** Where a planned river's middle runs at s. */
  const routeOf = (r: PlannedRiver, s: number): number => valleyAt(r.valley, s) + r.offset * gap / 2;

  const { grounds, ringLine, landformAt } = groundsOf(h, { lake, reserveEnd, valleys: N, rivers, valleyAt, ridgeAt, routeOf });

  return {
    habitat: h, lake, reserveEnd, valleys: N, faces, mountain, rivers, phase, stairHalfWidth: R * 0.02,
    careAt, gravityAt, bandAt, valleyAt, acrossAt, ridgeAt, faceAt, routeOf, endcapAt, grounds, ringLine, landformAt,
  };
}

/** What the landforms are placed by: the parts of the landform made before them. */
type GroundBase = Pick<Landform, 'lake' | 'reserveEnd' | 'valleys' | 'rivers' | 'valleyAt' | 'ridgeAt' | 'routeOf'>;

/**
 * The habitat mind's landforms on the floor. The Rings stand `ringEvery` radii apart from the reserve's edge to the
 * Gate's foot, each moved clear of the lake; the Heights on the ridges between the valleys, the tallest nearest the wild
 * end, each clear of the lake, the floor's ends and the Rings' crests (it may rise out of a Ring's slopes). Shapes in
 * shares of each form's height (`GROUND`); where two overlap, the higher surface is the land's.
 */
function groundsOf(h: Habitat, base: GroundBase): Pick<Landform, 'grounds' | 'ringLine' | 'landformAt'> {
  const spec = h.params.relief.landforms, R = h.radius, { floorEnd } = h.profile;
  const { lake, reserveEnd, valleys, rivers, valleyAt, ridgeAt, routeOf } = base;
  const grounds: GroundForm[] = [];
  const reachOf = (height: number, kind: GroundForm['kind']): number => kind === 'ring' ? height * (GROUND.crest + GROUND.face + GROUND.slope) : height * GROUND.foot;
  // A Ring's wander round the axis, in a table (every height on the floor asks): sampled on a circle, so it closes.
  const LINE = 512, wander = new Noise(deriveSeed(h.seed, 'plan', 'rings'));
  const lines: Float64Array[] = [];
  const ringLine = (ring: GroundForm, theta: number): number => {
    const t = lines[ring.id], u = ((((theta / TURN) % 1) + 1) % 1) * LINE, i = Math.floor(u) % LINE, f = u - Math.floor(u);
    return ring.s + t[i] * (1 - f) + t[(i + 1) % LINE] * f;
  };
  if (spec && spec.ring > 0 && spec.ringEvery > 0) {
    const height = spec.ring * R, every = spec.ringEvery * R, amp = GROUND.wander * R;
    // The long slope runs wild-ward, the steep face toward the port: one climbs gently out of the wilder room and
    // looks down into the tended one.
    const back = height * (GROUND.crest / 2 + GROUND.slope) + amp, front = height * (GROUND.crest / 2 + GROUND.face) + amp;
    for (let s = reserveEnd + every; s + front < floorEnd - every * 0.25; s += every) {
      let at = s;
      // Clear of the lake: moved to whichever shore is nearer.
      if (lake && at + front > lake.s - lake.halfWidth && at - back < lake.s + lake.halfWidth) {
        at = at < lake.s ? lake.s - lake.halfWidth - front : lake.s + lake.halfWidth + back;
        if (at + front > floorEnd - every * 0.25) continue;
      }
      if (grounds.length && at - back < grounds[grounds.length - 1].s + reachOf(height, 'ring')) continue;
      const id = grounds.length, t = new Float64Array(LINE);
      for (let i = 0; i < LINE; i++) { const a = (i / LINE) * TURN; t[i] = amp * wander.fbm2(Math.cos(a) * 3 + id * 11.7, Math.sin(a) * 3, 2); }
      lines.push(t);
      grounds.push({ id, kind: 'ring', theta: 0, s: at, height, radius: back, facing: 1 });
    }
  }
  const rings = grounds.length;
  if (spec && spec.height > 0 && spec.heights > 0 && valleys > 1) {
    const rng = new Rng(deriveSeed(h.seed, 'plan', 'heights')), worked = floorEnd - reserveEnd;
    // Round the axis from one another: each on the next ridge, unless there is no room on it.
    const first = rng.int(0, valleys - 1);
    for (let n = 0; n < spec.heights; n++) {
      // The tallest nearest the wild end, each next a little lower and further toward the port.
      const height = spec.height * R * (1 - (0.45 * n) / Math.max(1, spec.heights - 1)), reach = reachOf(height, 'height');
      for (let tries = 0; tries < 24; tries++) {
        const s = reserveEnd + worked * ((n + 0.5) / spec.heights + rng.range(-0.15, 0.15) / spec.heights);
        // On the ridge: halfway between the two valleys' lines there (they wander).
        const k = (first + n + Math.floor(tries / 8)) % valleys, a = valleyAt(k, s), b = valleyAt((k + 1) % valleys, s);
        const theta = wrap(a + ((((b - a) % TURN) + TURN) % TURN) / 2);
        if (s - reach < reserveEnd || s + reach > floorEnd || fromLake(lake, s) < reach) continue;
        // It may rise out of a Ring's slopes (a peak on the range), never out of its crest or steep face.
        if (grounds.slice(0, rings).some((r) => Math.abs(s - r.s) < reach * 0.45 + r.height * (GROUND.crest / 2 + GROUND.face) + GROUND.wander * R)) continue;
        if (grounds.slice(rings).some((o) => Math.hypot(wrap(o.theta - theta) * R, o.s - s) < reach + o.radius)) continue;
        grounds.push({ id: grounds.length, kind: 'height', theta, s, height, radius: reach, facing: 0 });
        break;
      }
    }
  }
  const landformAt = (theta: number, s: number): OnGround | null => {
    let best: OnGround | null = null;
    for (const g of grounds) {
      let share = 0;
      if (g.kind === 'ring') {
        if (Math.abs(s - g.s) > g.radius) continue;
        const d = (s - ringLine(g, theta)) * g.facing, H = g.height, c = (H * GROUND.crest) / 2;
        // Saddles over the valleys, high and steep over the ridges between them; the long slope the same everywhere.
        const high = GROUND.saddle + (1 - GROUND.saddle) * smoothstep(0.15, 0.7, ridgeAt(theta, s));
        const front = H * GROUND.face + (H * GROUND.slope - H * GROUND.face) * (1 - smoothstep(0.3, 0.8, high));
        const u = d >= 0 ? Math.max(0, d - c) / front : Math.max(0, -d - c) / (H * GROUND.slope);
        if (u >= 1) continue;
        share = high * (d >= 0 ? 1 - smoothstep(0, 1, u) : Math.pow(1 - u, 1.6));
        // Open to the land where a river runs through.
        for (const r of rivers) {
          // As wide as the river may wander from its route (`meander` widths and its banks), or a share of the Ring.
          const w = Math.max(H * GROUND.gorge, (h.params.relief.rivers?.width ?? 0) * (GROUND.gorgeMin + r.meander));
          const off = Math.abs(wrap(theta - routeOf(r, s))) * R;
          if (off < w * 2) share *= smoothstep(w, w * 2, off);
        }
      } else {
        const r = Math.hypot(wrap(theta - g.theta) * R, s - g.s);
        if (r >= g.radius) continue;
        const plateau = (g.height * GROUND.plateau) / 2, u = Math.max(0, r - plateau) / (g.radius - plateau);
        share = 0.5 + 0.5 * Math.cos(Math.PI * Math.pow(u, 0.8));
      }
      const top = share * g.height;
      if (top > 0 && (!best || top > best.top)) best = { form: g, top, share };
    }
    return best;
  };
  return { grounds, ringLine, landformAt };
}

export function makePlan(h: Habitat): Plan {
  const culture = cultureOf(h.params.culture);
  if (!culture) throw new Error(`no culture "${h.params.culture}" in the catalogue`);
  const form = landformOf(h);
  const { profile, params } = h, R = h.radius, spec = params.plan;
  const { floorStart, floorEnd } = profile, floor = floorEnd - floorStart;
  const { lake, reserveEnd, faces, rivers, phase, careAt, valleyAt, acrossAt, routeOf, endcapAt, landformAt } = form;
  const N = form.valleys, gap = TURN / N;
  const riverWidth = params.relief.rivers?.width ?? 0;

  // Districts: the worked floor (from the reserve's end to the Gate's foot) cut by the seeds of a jittered grid, its
  // columns lined up with the valleys (a valley's sides are districts of their own when there is room), its cells
  // about square, as many as the population fills at `districtPeople` each.
  const circumference = TURN * R, worked = Math.max(0, floorEnd - reserveEnd);
  const wanted = Math.max(1, Math.round(params.population / spec.districtPeople));
  const side = Math.sqrt((circumference * worked) / wanted);
  const perValley = wanted < N ? 0 : Math.max(1, Math.round(circumference / (N * side)));
  const columns = perValley ? N * perValley : wanted, rows = Math.max(1, Math.round(wanted / columns));
  const rowLength = worked / rows;
  const drng = new Rng(deriveSeed(h.seed, 'plan', 'districts'));
  const districts: District[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const s = reserveEnd + (r + 0.5 + drng.range(-0.3, 0.3)) * rowLength;
      const theta = perValley
        ? valleyAt(Math.floor(c / perValley), s) + ((c % perValley + 0.5) / perValley - 0.5) * gap + drng.range(-0.15, 0.15) * gap / perValley
        : phase + (c + 0.5 + drng.range(-0.3, 0.3)) * (TURN / columns);
      districts.push({ id: districts.length, theta: wrap(theta), s, style: 'let-go', care: careAt(s), neighbours: [], entrances: [] });
    }
  }
  const cell = (c: number, r: number): District => districts[r * columns + (((c % columns) + columns) % columns)];
  const dist = (t0: number, s0: number, t1: number, s1: number): number => Math.hypot(wrap(t1 - t0) * R, s1 - s0);
  const colWidth = TURN / columns;
  // The borders bend with the land, about a seventh of a district's side either way, over half its length: a district
  // is a piece of country with a shape of its own, not a cell.
  const bend = new Noise(deriveSeed(h.seed, 'plan', 'borders')), sway = side * 0.15, bendWidth = side * 0.6;
  /** The seeds near (θ, s) that could own it, from the grid around its cell, and their squared distances to it. */
  const near: District[] = [], near2: number[] = [];
  const nearby = (theta: number, s: number): boolean => {
    near.length = 0; near2.length = 0;
    if (!(s >= reserveEnd && s <= floorEnd) || districts.length === 0) return false;
    if (fromLake(lake, s) < 0) return false;
    const u = Math.cos(theta) * R, v = Math.sin(theta) * R;
    theta += (sway / R) * bend.fbm3(u / bendWidth, v / bendWidth, s / bendWidth, 1);
    s += sway * bend.fbm3(u / bendWidth + 31.7, v / bendWidth, s / bendWidth, 1);
    const r0 = Math.min(rows - 1, Math.max(0, Math.floor((s - reserveEnd) / rowLength)));
    // Columns lined up with the valleys start half a valley before the first one's middle. A seed strays at most a
    // third of a row along the axis, so the rows either side hold every rival; around the axis the valleys wander more.
    const c0 = Math.floor(wrap(theta - phase + (perValley ? gap / 2 : 0)) / colWidth);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(rows - 1, r0 + 1); r++) {
      for (let c = c0 - 2; c <= c0 + 2; c++) {
        const k = cell(c, r), a = (k.theta - theta - TURN * Math.round((k.theta - theta) / TURN)) * R, b = k.s - s;
        near.push(k); near2.push(a * a + b * b);
      }
    }
    return true;
  };
  /** The nearest of `near`, by index. */
  const nearest = (): number => {
    let best = 0;
    for (let i = 1; i < near.length; i++) if (near2[i] < near2[best]) best = i;
    return best;
  };
  const districtAt = (theta: number, s: number): District | null => (nearby(theta, s) ? near[nearest()] : null);
  const borderAt = (theta: number, s: number): { district: District; other: District; edge: number } | null => {
    if (!nearby(theta, s)) return null;
    const i = nearest(), own = near[i];
    // The border with each other seed is the line halfway between the two: its distance is (d₂² − d₁²) / 2|p₁p₂|.
    let other = own, edge = Infinity;
    for (let j = 0; j < near.length; j++) {
      const k = near[j];
      if (k === own) continue;
      // The border is no nearer than half the difference of the two distances: most seeds are passed by on that.
      const lower = (Math.sqrt(near2[j]) - Math.sqrt(near2[i])) / 2;
      if (lower >= edge) continue;
      const a = k.theta - own.theta, du = (a - TURN * Math.round(a / TURN)) * R, ds = k.s - own.s, apart = Math.sqrt(du * du + ds * ds);
      if (apart <= 0) continue;
      const e = (near2[j] - near2[i]) / (2 * apart);
      if (e < edge) { edge = e; other = k; }
    }
    return { district: own, other, edge };
  };
  // Neighbours: the grid's eight around (wrapping around the axis), when there is more than one column.
  for (const k of districts) {
    const r = Math.floor(k.id / columns), c = k.id % columns, seen = new Set<number>();
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dr === 0 && dc === 0) || r + dr < 0 || r + dr >= rows) continue;
      const n = cell(c + dc, r + dr);
      if (n.id !== k.id) seen.add(n.id);
    }
    k.neighbours = [...seen];
  }
  // Styles: each district picks from the culture by its valley's character (the face the valley runs into) and by how
  // well a style suits its care, never one a neighbour has; so a valley reads as one long room, care shifts it from
  // the reserve to the port, and next-door districts still differ.
  const srng = new Rng(deriveSeed(h.seed, 'plan', 'styles'));
  const fit = (care: number, [lo, hi]: readonly [number, number]): number => (care < lo ? Math.max(0.03, 1 - (lo - care) / 0.25) : care > hi ? Math.max(0.03, 1 - (care - hi) / 0.25) : 1);
  const assigned = new Set<number>();
  for (const k of districts) {
    const theme = culture.valleys[faces[acrossAt(k.theta, k.s).valley].kind];
    const taken = new Set(k.neighbours.filter((n) => assigned.has(n)).map((n) => districts[n].style));
    const free = culture.styles.filter((st) => !taken.has(st.style));
    const pool = free.length ? free : culture.styles;
    k.style = srng.weighted(pool, (st) => st.weight * fit(k.care, st.care) ** 2 * (theme.includes(st.style) ? 4 : 0.25)).style;
    assigned.add(k.id);
  }

  // Entrances: dart throwing inside each district, kept apart by about the spacing, off the river lines and the lake,
  // and as far from the worked floor's ends (the Gate's foot rising at one, the reserve at the other) as from the lake.
  const erng = new Rng(deriveSeed(h.seed, 'plan', 'entrances'));
  const spacing = spec.entranceSpacing;
  const perDistrict = Math.max(1, Math.round((circumference * worked) / districts.length / (spacing * spacing)));
  const nearRiver = (theta: number, s: number): boolean => rivers.some((r) => Math.abs(wrap(theta - routeOf(r, s))) * R < riverWidth * (3 + r.meander));
  const placed: Site[] = [], bays = baysOf(h);
  // On a landform an entrance keeps to its foot or a low terrace, never its top or a face: the lift down is as deep
  // as the court stands over the layer, which rises inside a landform only as high as a great hall (`under.hall`).
  const lowest = courtCap(h), court = spacing * 0.025;
  const onFoot = (theta: number, s: number): boolean => {
    const on = landformAt(theta, s);
    if (!on) return true;
    if (on.top > lowest) return false;
    const top = (t: number, u: number): number => landformAt(t, u)?.top ?? 0;
    return Math.abs(top(theta, s + court) - top(theta, s - court)) + Math.abs(top(theta + court / R, s) - top(theta - court / R, s)) <= court * COURT_SLOPE * 2;
  };
  const firstEntrance = reserveEnd + spacing * 0.15, lastEntrance = Math.max(firstEntrance, floorEnd - spacing * 0.15);
  // Entrances filed by a grid a spacing wide (around the axis, along it), so a new one checks only its neighbours.
  const bin = new Map<number, Site[]>(), grid = floorGrid(R, spacing);
  const tooClose = (theta: number, s: number): boolean => {
    const i = grid.column(theta), j = grid.row(s);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const o of bin.get(grid.key(i + di, j + dj)) ?? []) if (dist(o.theta, o.s, theta, s) < spacing * 0.6) return true;
    }
    return false;
  };
  for (const k of districts) {
    const reach = Math.max(rowLength, colWidth * R);
    for (let n = 0, tries = 0; n < perDistrict && tries < perDistrict * 30; tries++) {
      // Each throw lands on the middle of a bay below (gen/bays.ts), where the vault reaches the deck and the court's
      // light well can come down through it; the cheap checks first, and each must pass them all where it lands.
      const at = bays.middleNear(k.theta + (erng.range(-0.75, 0.75) * reach) / R, k.s + erng.range(-0.75, 0.75) * reach), theta = wrap(at.theta), s = at.s;
      if (fromLake(lake, s) < spacing * 0.15 || s < firstEntrance || s > lastEntrance) continue;
      if (tooClose(theta, s) || districtAt(theta, s) !== k || nearRiver(theta, s) || !onFoot(theta, s)) continue;
      const site: Site = { kind: 'entrance', theta, s, size: spacing * 0.025, facing: erng.range(0, TURN), district: k.id };
      k.entrances.push(site);
      placed.push(site);
      fileUnder(bin, grid.key(grid.column(theta), grid.row(s)), site);
      n++;
    }
    if (!k.entrances.length) {
      // Too cramped to keep apart: one entrance at the seed itself (its bay's middle), kept off the floor's ends, or
      // the nearest bay round it at a landform's foot.
      let at = bays.middleNear(k.theta, k.s, firstEntrance, lastEntrance);
      for (let ring = 1; ring < 64 && !onFoot(wrap(at.theta), at.s); ring++) {
        const a = ring * 2.399963, d = Math.sqrt(ring) * bays.bay;
        at = bays.middleNear(k.theta + (Math.sin(a) * d) / R, k.s + Math.cos(a) * d, firstEntrance, lastEntrance);
      }
      const site: Site = { kind: 'entrance', theta: wrap(at.theta), s: at.s, size: spacing * 0.025, facing: 0, district: k.id };
      k.entrances.push(site);
      placed.push(site);
    }
  }

  // The Sunwalk: along the main valley's side, from the Mountain's foot to the foot of the Lift Stair, a quarter of
  // the way out to the ridge so the great river stays in sight below it. It crosses the lake through the pavilion.
  const sunwalkSide = 0.25 * gap / 2;
  const walkTheta = (s: number): number => valleyAt(0, s) + sunwalkSide;
  const walkStep = Math.max(floor / 200, 1);
  const walk: number[] = [];
  for (let s = floorStart; s < floorEnd; s += walkStep) walk.push(walkTheta(s), s);
  walk.push(walkTheta(floorEnd), floorEnd);
  const widths = spec.pathWidth;
  const paths: PlanPath[] = [{ kind: 'sunwalk', width: widths.sunwalk, points: Float64Array.from(walk) }];

  // Landmarks.
  const hutAt = endcapAt(true, 0.3);
  // The Lift Stair climbs the Stair face from the floor's end, up the main valley's line.
  const landmarks: Site[] = [
    { kind: 'lift-stair', theta: wrap(valleyAt(0, floorEnd)), s: floorEnd, size: form.stairHalfWidth, facing: 0, district: -1 },
    { kind: 'summit-hut', theta: wrap(valleyAt(0, hutAt) + gap * 0.12), s: hutAt, size: Math.max(R * 0.005, 1), facing: 0, district: -1 },
    { kind: 'founders-grove', theta: wrap(valleyAt(0, floorEnd - floor * 0.06) - gap * 0.18), s: floorEnd - floor * 0.06, size: R * 0.05, facing: 0, district: -1 },
  ];
  if (lake) landmarks.push({ kind: 'lake-pavilion', theta: wrap(walkTheta(lake.s)), s: lake.s, size: lake.halfWidth * 0.5, facing: 0, district: -1 });
  for (const l of landmarks) if (l.s >= reserveEnd && l.s <= floorEnd) l.district = districtAt(l.theta, l.s)?.id ?? -1;

  // The trail up the Mountain: switchbacks from the Sunwalk's start to the summit hut.
  const trail: number[] = [];
  const legs = 12, start = walkTheta(floorStart), end = landmarks[1].theta, swing = gap * 0.04;
  const endUnwrapped = start + wrap(end - start);
  for (let i = 0; i <= legs; i++) {
    const t = i / legs, s = floorStart + (hutAt - floorStart) * t;
    trail.push(start + (endUnwrapped - start) * t + (i % 2 ? swing : -swing) * Math.sin(Math.PI * t), s);
  }
  paths.push({ kind: 'trail', width: widths.trail, points: Float64Array.from(trail) });

  // The ways: the shortest net joining every entrance to the Sunwalk (a spanning tree, Prim's), never across the
  // lake: water is crossed only by the Sunwalk, through the pavilion. Each way swings gently from side to side, as a
  // path walked for two hundred years does (a tenth of its length at most), and never into the lake.
  const wrng = new Rng(deriveSeed(h.seed, 'plan', 'ways'));
  const wayStep = Math.max(spacing / 12, widths.way * 4);
  const wayPoints = (a: { theta: number; s: number }, b: { theta: number; s: number }): Float64Array => {
    const du = wrap(b.theta - a.theta) * R, dv = b.s - a.s, length = Math.hypot(du, dv);
    const n = Math.max(1, Math.ceil(length / wayStep)), out = new Float64Array((n + 1) * 2);
    // Two swings of random phase: one long, one shorter, each fading out at the ends.
    const p1 = wrng.range(0, TURN), p2 = wrng.range(0, TURN), a1 = wrng.range(-0.07, 0.07), a2 = wrng.range(-0.03, 0.03);
    const nu = length > 0 ? -dv / length : 0, nv = length > 0 ? du / length : 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, ends = Math.sin(Math.PI * t);
      const off = length * ends * (a1 * Math.sin(Math.PI * t + p1) + a2 * Math.sin(3 * Math.PI * t + p2));
      let ps = a.s + dv * t + nv * off;
      if (lake) {
        const shore = lake.halfWidth + spacing * 0.1, d = ps - lake.s;
        if (Math.abs(d) < shore) ps = lake.s + Math.sign(a.s - lake.s) * shore;
      }
      out[i * 2] = a.theta + (du * t + nu * off) / R;
      out[i * 2 + 1] = Math.min(floorEnd, Math.max(reserveEnd, ps));
    }
    return out;
  };
  const anchors: { theta: number; s: number }[] = [];
  for (let i = 0; i < walk.length; i += 2) if (walk[i + 1] >= reserveEnd) anchors.push({ theta: walk[i], s: walk[i + 1] });
  const nodes = [...anchors, ...placed];
  const crossesLake = (a: { s: number }, b: { s: number }): boolean => !!lake && Math.min(a.s, b.s) < lake.s && Math.max(a.s, b.s) > lake.s;
  const n = nodes.length, inTree = new Uint8Array(n), cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  for (let i = 0; i < anchors.length; i++) { inTree[i] = 1; }
  // Squared distances: the shortest net is the same for any measure that keeps their order, and a lake crossing costs
  // a million times over either way.
  const nt = Float64Array.from(nodes, (k) => k.theta), ns = Float64Array.from(nodes, (k) => k.s);
  const relax = (i: number): void => {
    for (let j = anchors.length; j < n; j++) {
      if (inTree[j]) continue;
      const a = nt[j] - nt[i], u = (a - TURN * Math.round(a / TURN)) * R, v = ns[j] - ns[i];
      const c = (u * u + v * v) * (crossesLake(nodes[i], nodes[j]) ? 1e12 : 1);
      if (c < cost[j]) { cost[j] = c; from[j] = i; }
    }
  };
  for (let i = 0; i < anchors.length; i++) relax(i);
  for (let added = anchors.length; added < n; added++) {
    let pick = -1;
    for (let j = anchors.length; j < n; j++) if (!inTree[j] && (pick < 0 || cost[j] < cost[pick])) pick = j;
    if (pick < 0) break;
    inTree[pick] = 1;
    const a = nodes[from[pick]], b = nodes[pick];
    paths.push({ kind: 'way', width: widths.way, points: wayPoints(a, b) });
    relax(pick);
  }

  return { ...form, culture, districts, sites: [...landmarks, ...placed], paths, districtAt, borderAt };
}
