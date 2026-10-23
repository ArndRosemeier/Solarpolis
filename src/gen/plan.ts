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
 *   works     the ground each district shaped in its style inside that frame (gen/works.ts: stone pyramids, makers'
 *             mesas, orchard domes, herd downs, grove vales, water bowls, play half-pipes, let-go drumlins …);
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
import { SIGNATURE, SIGNATURE_KINDS, STYLE_WORKS, WORKS, WORK_KINDS, isSignature, workAt, type DistrictWorkKind, type Work } from './works';

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

/** How wide the lake's shore is (m): the band past its water where the hills flatten down to meet it (gen/terrain.ts). */
export const shoreOf = (lake: Lake | null): number => (lake ? Math.max(lake.depth * 10, lake.halfWidth * 0.3) : 0);

/**
 * A lake on the floor besides the ring lake (`HabitatParams.relief.lakes`, Arnd 2026-10-23): the great lake, where the
 * great river leaves the Mountain's foot and runs through it, and the smaller ones (`kind` 'mere') in the rooms between
 * the Rings. Its shore is a superellipse over the floor unrolled, round (`theta`, `s`): `along` m from its middle along
 * its long axis (turned `heading` from +s toward +θ) and `across` m square to it, its bays and headlands from `lobes`.
 * How natural it is (`wild`, 1 in the reserve, 0 in tended land) follows the care where it lies: a made basin's crisp,
 * squarer edge and steep sides in the tended rooms, a ragged shore shelving gently in the wild.
 */
export interface Mere {
  id: number;
  kind: 'great' | 'mere';
  theta: number;
  s: number;
  along: number;
  across: number;
  heading: number;
  /** How deep it is in its middle (m). */
  depth: number;
  /** Its water's surface, as a height above the profile: its room's level, where a river through it rests too. */
  level: number;
  wild: number;
  /** The shore's lobes: for each harmonic 2, 3, … its amplitude and phase. */
  lobes: Float64Array;
}

/**
 * The lakes' shapes: how far a wild shore's bays reach in (a share of the radius to the shore), how square a made basin
 * is and how round a natural one (the superellipse's power), how much of the way to its middle a lake shelves down to
 * its depth (natural, made), how far out its shore reaches (`shoreOf`: depths, or a share of its half width), and how
 * steeply the land rises from its water within it (m per m).
 */
export const MERE = { bays: 0.32, harmonics: 6, round: 2, square: 4.5, shelf: [0.6, 0.12], shore: { depths: 10, natural: 0.3, made: 0.08 }, rise: 0.025 } as const;

/** Where a point lies by a lake on the floor: which, and how far from its shore (m, negative in the water). */
export interface MereHit {
  mere: Mere;
  edge: number;
}

/** How wide a lake's shore is (m): the band past its water where the land comes down to meet it (gen/terrain.ts). */
export const mereShore = (m: Mere): number =>
  Math.max(m.depth * MERE.shore.depths * m.wild, m.across * (MERE.shore.made + (MERE.shore.natural - MERE.shore.made) * m.wild));

/** How far a lake's shore reaches from its middle at most (m), its shore band not counted. */
export const mereReach = (m: Mere): number => Math.max(m.along, m.across);

/**
 * How far a point (θ, s) lies from a lake's shore (m, negative in the water), measured along the line from the lake's
 * middle through it (exact there, and never more than the distance to the nearest shore for these shapes); `radius`
 * unrolls θ. At the middle itself, minus its half width.
 */
export function mereEdge(m: Mere, radius: number, theta: number, s: number): number {
  const a = theta - m.theta, du = (a - TURN * Math.round(a / TURN)) * radius, dv = s - m.s;
  const c = Math.cos(m.heading), sn = Math.sin(m.heading);
  const x = dv * c + du * sn, y = du * c - dv * sn, r = Math.hypot(x, y);
  const qx = Math.abs(x) / m.along, qy = Math.abs(y) / m.across, p = MERE.round + (MERE.square - MERE.round) * (1 - m.wild);
  const rho = Math.pow(Math.pow(qx, p) + Math.pow(qy, p), 1 / p);
  // The bays: the shore drawn in by up to `bays` of the way to the middle, by the lobes round it.
  let f = 1;
  if (m.wild > 0) {
    const phi = Math.atan2(y / m.across, x / m.along);
    let wave = 0, sum = 0;
    for (let k = 0; k < m.lobes.length; k += 2) { wave += m.lobes[k] * Math.cos((k / 2 + 2) * phi + m.lobes[k + 1]); sum += m.lobes[k]; }
    f = 1 - m.wild * MERE.bays * (0.5 + (0.5 * wave) / Math.max(sum, 1e-9));
  }
  if (rho < 1e-9) return -m.across * f;
  return r * (1 - f / rho);
}

/** How far into a lake a point lies, 0 at its shore … 1 well out (where it is as deep as it gets, by `MERE.shelf`). */
export const mereDeep = (m: Mere, edge: number): number => {
  const shelf = MERE.shelf[1] + (MERE.shelf[0] - MERE.shelf[1]) * m.wild;
  return Math.min(1, Math.max(0, -edge / (m.across * shelf)));
};

/** The Sunwalk's line runs along the main valley's side, this share of the way out to the ridge. */
export const SUNWALK_SIDE = 0.25;

/**
 * How far in from each end of the floor the land ramps from the endcap's slope onto the floor proper (m): the terrain's
 * hills and landforms grow in over it (gen/terrain.ts), and the lakes keep beyond it.
 */
export const floorRamp = (h: Habitat): number => {
  const floor = h.profile.floorEnd - h.profile.floorStart;
  return Math.min(floor * 0.05, Math.max(h.params.relief.hills * 40, 1) * 0.5);
};

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
  /**
   * A Ring's step (m): the room beyond it, away from the lake, lies this much higher than the room on the lake's side,
   * the Ring holding it like a dam; where a river breaks through, it falls the step (`relief.landforms.fall`). 0 for a
   * Height, and without a lake.
   */
  step: number;
  /** Which way along the axis is up the step (away from the lake): +1, −1, or 0 with no step. */
  up: number;
}

/**
 * Where a point lies on a landform: which, its designed surface over the land there (m), 0 at its foot … 1 at its
 * crest, and how much of it is a built face (1 on a Ring's steep front over a ridge, where the terrain cuts terraces;
 * 0 on its saddles, its long slope and the Heights, which are shaped as rock).
 */
export interface OnGround {
  form: GroundForm;
  top: number;
  share: number;
  face: number;
  /** How steeply its designed surface rises there (m per m). */
  slope: number;
  /**
   * How much of a Ring's step lies under the point (m): its whole step on the side away from the lake, 0 on the lake's
   * side. The Ring stands on the lower room: the land over the point is the higher of its surface and this.
   */
  room: number;
}

/**
 * The landforms' shapes, in shares of a form's height. A Ring's crest is `crest` heights wide; its steep face falls in
 * `face` heights, its long slope in `slope`; it keeps `saddle` of its height over a valley's middle (where the ways
 * and the Sunwalk cross it, both sides as gentle as the long slope), and opens to the land within `gorge` of a river's
 * route (at least `gorgeMin` of the river's width). Its line wanders `wander` radii along the axis. Its step (the
 * fall where a river breaks through) is cut over `lip` of the step either side of its line, and is at most `stepMax` of
 * its height (well under its saddle). A Height's plateau is
 * `plateau` of its height across, its foot `foot` heights out.
 */
export const GROUND = { crest: 0.15, face: 1, slope: 4, saddle: 0.22, gorge: 0.25, gorgeMin: 4, wander: 0.08, plateau: 0.2, foot: 1.3, lip: 0.15, stepMax: 0.16 };

/** How close to a Height a way may pass, as a share of the Height's reach to its foot (its plateau and flanks kept clear). */
export const WAY_CLEAR = 0.8;

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
  /**
   * How far the floor's room at a point lies below the floor's ends (m, ≤ 0): the rooms between the Rings step down
   * toward the lake, a Ring's `step` at each (cut sharply at its line, where a river falls through the gorge).
   */
  roomAt(theta: number, s: number): number;
  /** The lakes on the floor besides the ring lake: the great lake first, then the smaller ones (`Mere`). */
  readonly meres: readonly Mere[];
  /** The lake on the floor whose shore lies nearest a point, if within `reach` m of it (negative: in the water). */
  mereAt(theta: number, s: number, reach?: number): MereHit | null;
  /** How far a point lies from any water standing on the floor: the ring lake's shore or a lake's (m, negative in it). */
  fromWater(theta: number, s: number): number;
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
  /** Whether a point lies in district `d`, at least `margin` metres inside its borders. */
  inside(d: District, theta: number, s: number, margin: number): boolean;
  /** The districts' works (gen/works.ts): the ground each district shaped in its style, the ways bent round them. */
  readonly works: readonly Work[];
  /** The works' designed surface over the land at a point (m: up where one raises it, down where one is dug; else 0). */
  worksAt(theta: number, s: number): number;
  /** The work whose footprint holds a point, or null. */
  workOf(theta: number, s: number): Work | null;
}

/** Something a way goes round: a court or a district's work, kept `keep` metres off its middle. */
interface Obstacle {
  theta: number;
  s: number;
  keep: number;
  work: boolean;
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

  const { grounds, ringLine, landformAt, roomAt } = groundsOf(h, { lake, reserveEnd, valleys: N, rivers, valleyAt, ridgeAt, routeOf });
  // The lake lies in the lowest room, every Ring's step below the floor's ends: its water as far down.
  const stepped = lake ? { ...lake, level: lake.level + roomAt(0, lake.s) } : null;
  const meres = meresOf(h, { lake, reserveEnd, valleys: N, rivers, valleyAt, ridgeAt, routeOf, careAt, grounds, ringLine, landformAt, roomAt });
  /** The most any lake reaches from its middle, its shore included: a point further than that from every middle is dry. */
  const reaches = meres.map((m) => mereReach(m) + mereShore(m));
  const mereAt = (theta: number, s: number, reach = 0): MereHit | null => {
    let best: MereHit | null = null;
    for (let i = 0; i < meres.length; i++) {
      const m = meres[i];
      if (Math.abs(s - m.s) > reaches[i] + reach) continue;
      const edge = mereEdge(m, R, theta, s);
      if (edge <= reach && (!best || edge < best.edge)) best = { mere: m, edge };
    }
    return best;
  };
  const fromWater = (theta: number, s: number): number => {
    let d = fromLake(stepped, s);
    for (let i = 0; i < meres.length; i++) if (Math.abs(s - meres[i].s) - reaches[i] < d) d = Math.min(d, mereEdge(meres[i], R, theta, s));
    return d;
  };

  return {
    habitat: h, lake: stepped, reserveEnd, valleys: N, faces, mountain, rivers, phase, stairHalfWidth: R * 0.02,
    careAt, gravityAt, bandAt, valleyAt, acrossAt, ridgeAt, faceAt, routeOf, endcapAt, grounds, ringLine, landformAt, roomAt, meres, mereAt, fromWater,
  };
}

/** What the lakes are placed by: the parts of the landform made before them (`lake` before its room's step). */
type MereBase = GroundBase & Pick<Landform, 'careAt' | 'grounds' | 'ringLine' | 'landformAt' | 'roomAt'>;

/**
 * The habitat mind's lakes on the floor (`HabitatParams.relief.lakes`). The great lake lies where the great river
 * leaves the Mountain's foot: down the main valley from the end of the ramp onto the floor, as long as the room before
 * the first Ring's long slope (or the ring lake) allows, as wide as fits between the valley's far side and the Sunwalk,
 * so the river runs through it and the Sunwalk along its shore. The smaller ones lie in the rooms between the Rings,
 * a room each where they can, in the lowest ground thrown (down the valleys' sides), clear of the landforms, the rivers,
 * the Sunwalk, the ring lake, each other and the port end (the Gate's foot and the founders' grove). Each lies level in
 * its room (`roomAt`: where the rivers rest too, so a river through a lake runs in at its level and out again). Pure.
 */
function meresOf(h: Habitat, base: MereBase): Mere[] {
  const spec = h.params.relief.lakes, R = h.radius, { floorStart, floorEnd } = h.profile, floor = floorEnd - floorStart;
  if (!spec) return [];
  const { lake, valleys, rivers, valleyAt, ridgeAt, routeOf, careAt, grounds, ringLine, landformAt, roomAt } = base;
  const gap = TURN / valleys, ramp = floorRamp(h), widths = h.params.plan.pathWidth;
  const riverWidth = h.params.relief.rivers?.width ?? 0;
  // The rivers' water rests no lower than its room's level less this (gen/rivers.ts): so does a lake's.
  const sink = lake ? lake.level : -1;
  const rng = new Rng(deriveSeed(h.seed, 'plan', 'meres'));
  const out: Mere[] = [];
  const lobes = (): Float64Array => {
    const l = new Float64Array(MERE.harmonics * 2);
    for (let k = 0; k < MERE.harmonics; k++) { l[k * 2] = rng.range(0.3, 1) / (k + 1); l[k * 2 + 1] = rng.range(0, TURN); }
    return l;
  };
  const wildOf = (s: number): number => 1 - smoothstep(0.25, 0.7, careAt(s));
  const walkTheta = (s: number): number => valleyAt(0, s) + (SUNWALK_SIDE * gap) / 2;
  const make = (kind: Mere['kind'], theta: number, s: number, along: number, across: number, heading: number): Mere => ({
    id: out.length, kind, theta: wrap(theta), s, along, across, heading, depth: spec.depth * across * 2, level: sink + roomAt(theta, s), wild: wildOf(s), lobes: lobes(),
  });
  /** Whether a lake's footprint and its shore stay off every landform (the Rings' slopes, the Heights). */
  const offForms = (m: Mere): boolean => {
    if (landformAt(m.theta, m.s)) return false;
    const c = Math.cos(m.heading), sn = Math.sin(m.heading), shore = mereShore(m);
    for (let q = 0; q < 24; q++) {
      const a = (q / 24) * TURN, x = Math.cos(a) * m.along, y = Math.sin(a) * m.across;
      // On the line out from its middle through its shore, a shore's width beyond the water.
      const k = 1 + shore / Math.max(1, Math.hypot(x, y));
      if (landformAt(m.theta + ((x * sn + y * c) * k) / R, m.s + (x * c - y * sn) * k)) return false;
    }
    return true;
  };

  if (spec.great) {
    // From the end of the ramp onto the floor to the first Ring's long slope, or the ring lake's shore.
    const first = grounds.filter((g) => g.kind === 'ring').sort((a, b) => a.s - b.s)[0];
    const lo = floorStart + ramp, hi = Math.min(first ? first.s - first.radius : floorEnd - ramp, lake ? lake.s - lake.halfWidth - shoreOf(lake) : Infinity);
    const swing = rivers.length ? riverWidth * (rivers[0].meander + 2) : 0;
    // Shrunk until it fits clear of every landform (a Height by the valley), down to two fifths of what was asked.
    for (let k = 1; k > 0.35; k -= 0.1) {
      const want = make('great', 0, 0, (spec.great.length * R * k) / 2, (spec.great.width * R * k) / 2, 0), shore = mereShore(want);
      const along = Math.min(want.along, (hi - lo) / 2 - shore);
      if (along < want.along * 0.4) break;
      const s = lo + shore + along, line = valleyAt(0, s);
      // Across the main valley: over the great river's line (meanders and all), its far side out toward the next
      // ridge, its near side a few of the Sunwalk's widths off the walk's nearest point along it.
      let walk = Infinity;
      for (let i = 0; i <= 16; i++) walk = Math.min(walk, (walkTheta(s - along + (i / 8) * along) - line) * R);
      const top = walk - widths.sunwalk * 3, across = want.across, mid = Math.min(top - across, 0);
      if (!(mid + across > swing && mid - across < -swing)) break;
      const m = make('great', line + mid / R, s, along, across, 0);
      if (offForms(m)) { out.push(m); break; }
    }
  }

  // The smaller lakes: thrown over the floor between the ramp and the port end's Gate foot and grove, each the lowest of
  // its throws that fit, in a room no other lake has where one is left.
  const rings = grounds.filter((g) => g.kind === 'ring');
  const roomOf = (theta: number, s: number): number => rings.reduce((n, g) => n + (s > ringLine(g, theta) ? 1 : 0), 0);
  const portEnd = floorEnd - floor * 0.12, size = spec.size * R;
  for (let n = 0; n < spec.count; n++) {
    let best: { m: Mere; score: number } | null = null;
    for (let tries = 0; tries < 48; tries++) {
      const d = size * rng.range(0.7, 1.35), aspect = rng.range(1, 1.8), heading = rng.range(0, Math.PI);
      const along = (d / 2) * Math.sqrt(aspect), across = d / 2 / Math.sqrt(aspect);
      const s = rng.range(floorStart, floorEnd), theta = rng.range(0, TURN);
      const m = make('mere', theta, s, along, across, heading), reach = mereReach(m) + mereShore(m);
      if (s - reach < floorStart + ramp || s + reach > portEnd) continue;
      if (lake && fromLake(lake, s) < reach + shoreOf(lake)) continue;
      if (out.some((o) => Math.hypot(wrap(o.theta - theta) * R, o.s - s) < reach + mereReach(o) + mereShore(o))) continue;
      let clear = true;
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        const at = s + f * mereReach(m);
        if (Math.abs(wrap(theta - walkTheta(at))) * R < reach + widths.sunwalk * 3) { clear = false; break; }
        for (const r of rivers) {
          if (lake && (r.from === 'wild') !== (at < lake.s)) continue;
          if (Math.abs(wrap(theta - routeOf(r, at))) * R < reach + riverWidth * (r.meander + 3)) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (!clear || !offForms(m)) continue;
      // Low ground first (down a valley's side, not up on its ridge), and a room of its own.
      const room = roomOf(theta, s), score = ridgeAt(theta, s) + (out.some((o) => o.kind === 'mere' && roomOf(o.theta, o.s) === room) ? 1 : 0);
      if (!best || score < best.score) best = { m, score };
    }
    if (best) { best.m.id = out.length; out.push(best.m); }
  }
  return out;
}

/** What the landforms are placed by: the parts of the landform made before them. */
type GroundBase = Pick<Landform, 'lake' | 'reserveEnd' | 'valleys' | 'rivers' | 'valleyAt' | 'ridgeAt' | 'routeOf'>;

/**
 * The habitat mind's landforms on the floor. The Rings stand `ringEvery` radii apart from the reserve's edge to the
 * Gate's foot, each moved clear of the lake; the Heights on the ridges between the valleys, the tallest nearest the wild
 * end, each clear of the lake, the floor's ends and the Rings' crests (it may rise out of a Ring's slopes). Shapes in
 * shares of each form's height (`GROUND`); where two overlap, the higher surface is the land's.
 */
function groundsOf(h: Habitat, base: GroundBase): Pick<Landform, 'grounds' | 'ringLine' | 'landformAt' | 'roomAt'> {
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
      // A step down toward the lake (none without one: no water to fall); its size below, once all are placed.
      grounds.push({ id, kind: 'ring', theta: 0, s: at, height, radius: back, facing: 1, step: 0, up: lake ? (at < lake.s ? -1 : 1) : 0 });
    }
  }
  const rings = grounds.length;
  // The steps: both ends of the floor stand as high over the lake, `fall` of a Ring's height for each Ring on average,
  // shared out among the Rings on each side (a side with fewer Rings has taller falls, each kept under `stepMax` of a
  // Ring's height so it stays a Ring). Rings on one side only: no steps (the lake would have a cliff under it).
  const wildRings = grounds.filter((g) => g.up < 0).length, portRings = grounds.filter((g) => g.up > 0).length;
  if (spec && wildRings && portRings) {
    const drop = Math.min(((spec.fall ?? 0) * rings) / 2, GROUND.stepMax * Math.min(wildRings, portRings)) * spec.ring * R;
    for (const g of grounds) g.step = drop / (g.up < 0 ? wildRings : portRings);
  }
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
        grounds.push({ id: grounds.length, kind: 'height', theta, s, height, radius: reach, facing: 0, step: 0, up: 0 });
        break;
      }
    }
  }
  /** A smoothstep's rise per unit of x. */
  const smoothRise = (e0: number, e1: number, x: number): number => {
    const k = (x - e0) / (e1 - e0);
    return k <= 0 || k >= 1 ? 0 : (6 * k * (1 - k)) / (e1 - e0);
  };
  const riverWidth = h.params.relief.rivers?.width ?? 0;
  // Each Ring's gorges: every river's gorge width there (as wide as the river may wander from its route, `meander`
  // widths and its banks, or a share of the Ring), its route's angle at the Ring, and how far round the axis from that
  // a point may lie and still be near it over the Ring's reach (so a point far from every river skips them).
  const gorges = grounds.map((g) => g.kind !== 'ring' ? [] : rivers.map((river) => {
    const w = Math.max(g.height * GROUND.gorge, riverWidth * (GROUND.gorgeMin + river.meander)), mid = routeOf(river, g.s);
    let stray = 0;
    for (let i = 0; i <= 64; i++) stray = Math.max(stray, Math.abs(wrap(routeOf(river, g.s + g.radius * (i / 32 - 1)) - mid)));
    return { river, w, mid, near: stray * 1.2 + (w * 2) / R };
  }));
  const landformAt = (theta: number, s: number): OnGround | null => {
    // The highest form over the point (made into an `OnGround` once, at the end).
    let best = -1, bestTop = 0, bestShare = 0, bestFace = 0, bestSlope = 0, bestRoom = 0;
    for (let n = 0; n < grounds.length; n++) {
      const g = grounds[n];
      if (Math.abs(s - g.s) >= g.radius) continue;
      // Its share at the point, and how fast that changes across the form and along its edges (per metre).
      let share = 0, face = 0, across = 0, edge = 0;
      if (g.kind === 'ring') {
        const d = (s - ringLine(g, theta)) * g.facing, H = g.height, c = (H * GROUND.crest) / 2;
        if (Math.abs(d) - c >= H * GROUND.slope) continue;
        // Saddles over the valleys, high and steep over the ridges between them; the long slope the same everywhere.
        const high = GROUND.saddle + (1 - GROUND.saddle) * smoothstep(0.3, 0.75, ridgeAt(theta, s));
        const front = H * GROUND.face + (H * GROUND.slope - H * GROUND.face) * (1 - smoothstep(0.3, 0.8, high));
        const run = d >= 0 ? front : H * GROUND.slope, u = Math.max(0, Math.abs(d) - c) / run;
        if (u >= 1) continue;
        // The long slope falls as (1 − u)^1.5: steepest under the crest, easing out at its foot.
        const q = 1 - u, rq = Math.sqrt(q);
        share = high * (d >= 0 ? 1 - smoothstep(0, 1, u) : q * rq);
        across = u > 0 ? (high * (d >= 0 ? 6 * u * q : 1.5 * rq)) / run : 0;
        // A saddle's front falls as gently as the long slope, but ends at the lake's shore.
        if (lake) {
          const shore = fromLake(lake, s), k = smoothstep(0, H * GROUND.face, shore);
          across = Math.abs(across * k - share * smoothRise(0, H * GROUND.face, shore));
          share *= k;
        }
        face = smoothstep(-c, c, d) * smoothstep(0.5, 0.8, high);
        // Open to the land where a river runs through.
        const near = gorges[g.id];
        for (let i = 0; i < near.length; i++) {
          const x = near[i];
          if (Math.abs(wrap(theta - x.mid)) > x.near) continue;
          const off = Math.abs(wrap(theta - routeOf(x.river, s))) * R, w = x.w;
          if (off < w * 2) {
            const k = smoothstep(w, w * 2, off);
            edge = Math.max(edge * k, share * smoothRise(w, w * 2, off));
            across *= k;
            share *= k;
          }
        }
      } else {
        const r = Math.hypot(wrap(theta - g.theta) * R, s - g.s);
        if (r >= g.radius) continue;
        const plateau = (g.height * GROUND.plateau) / 2, run = g.radius - plateau, u = Math.max(0, r - plateau) / run;
        // Sheer flanks under a rounded brink: half a cosine over u^0.75.
        const v = Math.sqrt(u) * Math.sqrt(Math.sqrt(u));
        share = 0.5 + 0.5 * Math.cos(Math.PI * v);
        across = u > 0 ? (0.375 * Math.PI * Math.sin(Math.PI * v) * v) / u / run : 0;
      }
      const top = share * g.height;
      if (top > bestTop) { best = n; bestTop = top; bestShare = share; bestFace = face; bestSlope = g.height * Math.hypot(across, edge); bestRoom = g.step ? stepOver(g, theta, s) : 0; }
    }
    return best < 0 ? null : { form: grounds[best], top: bestTop, share: bestShare, face: bestFace, slope: bestSlope, room: bestRoom };
  };
  /** How much of a Ring's step lies under a point: all of it up the step, none down it, cut over `lip` at its line. */
  const stepOver = (g: GroundForm, theta: number, s: number): number => {
    const c = g.step * GROUND.lip;
    return g.step * smoothstep(-c, c, (s - ringLine(g, theta)) * g.up);
  };
  // Each side of the lake steps down by its own Rings (both reach the lake equally low).
  const wildSteps = grounds.filter((g) => g.step > 0 && g.up < 0), portSteps = grounds.filter((g) => g.step > 0 && g.up > 0);
  const roomAt = (theta: number, s: number): number => {
    if (!lake) return 0;
    const steps = s < lake.s ? wildSteps : portSteps;
    let room = 0;
    for (let i = 0; i < steps.length; i++) room += stepOver(steps[i], theta, s) - steps[i].step;
    return room;
  };
  return { grounds, ringLine, landformAt, roomAt };
}

export function makePlan(h: Habitat): Plan {
  const culture = cultureOf(h.params.culture);
  if (!culture) throw new Error(`no culture "${h.params.culture}" in the catalogue`);
  const form = landformOf(h);
  const { profile, params } = h, R = h.radius, spec = params.plan;
  const { floorStart, floorEnd } = profile, floor = floorEnd - floorStart;
  const { lake, reserveEnd, faces, rivers, phase, careAt, valleyAt, acrossAt, routeOf, endcapAt, landformAt, meres, mereAt } = form;
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
  // A seed thrown into a lake on the floor is moved out onto its shore, a shore's width beyond the water: the district's
  // commons lie by the lake, not in it.
  for (const d of districts) {
    const hit = mereAt(d.theta, d.s);
    if (!hit) continue;
    const m = hit.mere, du = wrap(d.theta - m.theta) * R, dv = d.s - m.s, r = Math.hypot(du, dv) || 1, out = -hit.edge + mereShore(m) * 1.5;
    d.theta = wrap(d.theta + ((du || 1) / r) * out / R);
    d.s += (dv / r) * out;
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
    if (form.fromWater(theta, s) < 0) return false;
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
  const inside = (d: District, theta: number, s: number, margin: number): boolean => {
    const at = borderAt(theta, s);
    return !!at && at.district === d && at.edge >= margin;
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

  const spacing = spec.entranceSpacing, widths = spec.pathWidth;
  const firstEntrance = reserveEnd + spacing * 0.15, lastEntrance = Math.max(firstEntrance, floorEnd - spacing * 0.15);
  // The Sunwalk's line: along the main valley's side, a quarter of the way out to the ridge.
  const sunwalkSide = (SUNWALK_SIDE * gap) / 2;
  const walkTheta = (s: number): number => valleyAt(0, s) + sunwalkSide;

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
  const grove = landmarks.find((l) => l.kind === 'founders-grove');

  // Whether a work's footprint of `radius` at a point stays on the land a work may stand on: off the Heights and the
  // Rings' fronts and crests (it may stand on a Ring's long slope, low down), its middle and `rim` points round it.
  const onLand = (theta: number, s: number): boolean => {
    const on = landformAt(theta, s);
    return !on || (on.form.kind === 'ring' && on.face <= 0 && on.share < 0.5);
  };
  const landUnder = (theta: number, s: number, radius: number, rim: number): boolean => {
    if (!onLand(theta, s)) return false;
    for (let q = 0; q < rim; q++) {
      const a = (q / rim) * TURN;
      if (!onLand(theta + (radius * Math.cos(a)) / R, s + radius * Math.sin(a))) return false;
    }
    return true;
  };
  /**
   * Whether a footprint of `radius` keeps `walk` metres off the Sunwalk and `river` widths (past its meander) off each
   * river's line, at the places `at` along it (shares of its radius either way).
   */
  const offLines = (theta: number, s: number, radius: number, walk: number, river: number, at: readonly number[]): boolean => {
    for (const f of at) {
      const ds = f * radius;
      if (Math.abs(wrap(theta - walkTheta(s + ds))) * R < radius + walk) return false;
      for (const r of rivers) {
        if (lake && (r.from === 'wild') !== (s + ds < lake.s)) continue;
        if (Math.abs(wrap(theta - routeOf(r, s + ds))) * R < radius + riverWidth * (river + r.meander)) return false;
      }
    }
    return true;
  };

  // The lakes on the floor as the ways see them: a row of discs down each one's long axis, each holding the lake's
  // width there and a way's width more, together its whole footprint. A way is bent round them as round a work (and
  // through one costs as much); courts and works keep off them far enough that a way bent round fits between.
  const mereDiscs: Obstacle[] = [];
  for (const m of meres) {
    const n = Math.max(1, Math.ceil((m.along / m.across) * 1.5)), c = Math.cos(m.heading), sn = Math.sin(m.heading);
    const p = MERE.round + (MERE.square - MERE.round) * (1 - m.wild);
    for (let i = 0; i < n; i++) {
      // (Its widest across the disc's stretch is at the end nearer the middle.)
      const x = m.along * (-1 + (2 * i + 1) / n), near = Math.max(0, Math.abs(x) - m.along / n) / m.along;
      const half = m.across * Math.pow(Math.max(0, 1 - near ** p), 1 / p);
      mereDiscs.push({ theta: wrap(m.theta + (x * sn) / R), s: m.s + x * c, keep: Math.hypot(half, m.along / n) + widths.way * 2, work: true });
    }
  }
  /** Whether something reaching `reach` m from a point keeps clear of every lake's discs, and of a way bent round them. */
  const offMeres = (theta: number, s: number, reach: number): boolean =>
    mereDiscs.every((o) => dist(o.theta, o.s, theta, s) >= o.keep * 1.25 + reach + widths.way * 2);

  // The signature works (gen/works.ts `SIGNATURE_KINDS`): `landforms.signature` of them, the Spiral, the Wave Field and
  // the Tilt in turn, placed before the entrances (whose courts keep off them) by sightlines: of the throws that fit (on
  // the worked floor, clear of the lake, the Sunwalk, the rivers, the founders' grove, the Heights and the Rings' fronts
  // and crests), the one nearest the Sunwalk's edge, so it stands in full view of the walk and over it from the far
  // side, and in a room between the Rings no other has where one fits.
  const works: Work[] = [];
  const signatures = Math.min(SIGNATURE.order.length, Math.max(0, Math.round(params.relief.landforms?.signature ?? 0)));
  const ringsOn = form.grounds.filter((g) => g.kind === 'ring');
  const roomOf = (theta: number, s: number): string => ringsOn.map((g) => (s > form.ringLine(g, theta) ? 1 : 0)).join('');
  if (signatures > 0) {
    const grng = new Rng(deriveSeed(h.seed, 'plan', 'signature'));
    const walkKeep = widths.sunwalk * WORKS.walk, along = [-1, -0.5, 0, 0.5, 1] as const;
    // How long a room between two Rings is (the whole floor without any).
    const room = ringsOn.length ? (params.relief.landforms?.ringEvery ?? 1) * R : floor;
    const sigFits = (theta: number, s: number, radius: number): boolean => {
      if (s - radius < firstEntrance || s + radius > lastEntrance) return false;
      if (fromLake(lake, s) < radius + spacing * 0.2 || !offMeres(theta, s, radius + spacing * 0.2)) return false;
      if (!offLines(theta, s, radius, walkKeep, WORKS.river, along)) return false;
      if (grove && dist(grove.theta, grove.s, theta, s) < radius + grove.size * 1.2) return false;
      for (const o of works) if (dist(o.theta, o.s, theta, s) < (o.radius + radius) * 1.2) return false;
      // Never over a district's seed: every district keeps the middle of its ground (and room there for an entrance).
      for (const d of districts) if (dist(d.theta, d.s, theta, s) < radius + spacing * 0.25) return false;
      // Off a Ring's crest and front by its way's width, over its whole width round the axis.
      for (const g of ringsOn) for (const f of [-1, 0, 1]) {
        const th = theta + (f * radius) / R, line = form.ringLine(g, th), side = s > line ? 1 : -1;
        if (Math.abs(s - line) < radius + g.height * (GROUND.crest / 2 + (side === g.facing ? GROUND.face : 0)) + widths.way * 2) return false;
      }
      return landUnder(theta, s, radius, 16) && landUnder(theta, s, radius * 0.5, 8);
    };
    for (let i = 0; i < signatures; i++) {
      const kind = SIGNATURE.order[i], spec = SIGNATURE_KINDS[kind];
      const radius = Math.min(spec.radius * R, spec.room * room), height = spec.height * R * (radius / (spec.radius * R));
      let best: { theta: number; s: number; score: number } | null = null;
      const lo = firstEntrance + radius, hi = lastEntrance - radius;
      for (let k = 0; k < SIGNATURE.tries && lo < hi; k++) {
        const s = grng.range(lo, hi), side = grng.chance(0.5) ? 1 : -1, off = radius + walkKeep + grng.float() ** 2 * gap * R * 0.5;
        const theta = wrap(walkTheta(s) + (side * off) / R);
        if (!sigFits(theta, s, radius)) continue;
        // Nearest the walk, in a room of its own.
        const shared = works.some((o) => roomOf(o.theta, o.s) === roomOf(theta, s));
        const score = Math.abs(wrap(theta - walkTheta(s))) * R - radius + (shared ? floor : 0);
        if (!best || score < best.score) best = { theta, s, score };
      }
      if (!best) continue;
      const care = careAt(best.s), facing = spec.axial ? (grng.chance(0.5) ? 0 : Math.PI) : grng.range(0, TURN);
      works.push({
        id: works.length, kind, district: districtAt(best.theta, best.s)?.id ?? -1, theta: best.theta, s: best.s, height, radius, facing,
        crisp: Math.max(SIGNATURE.crisp, smoothstep(WORKS.care[0], WORKS.care[1], care)), vary: grng.float(),
      });
    }
  }
  /** Whether a point lies where an entrance's court may not: on a signature work or by its rim. */
  const onSignature = (theta: number, s: number): boolean => works.some((w) => dist(w.theta, w.s, theta, s) < w.radius + spacing * WORKS.court);

  // Entrances: dart throwing inside each district, kept apart by about the spacing, off the river lines and the lake,
  // and as far from the worked floor's ends (the Gate's foot rising at one, the reserve at the other) as from the lake.
  const erng = new Rng(deriveSeed(h.seed, 'plan', 'entrances'));
  const perDistrict = Math.max(1, Math.round((circumference * worked) / districts.length / (spacing * spacing)));
  const nearRiver = (theta: number, s: number): boolean => rivers.some((r) => Math.abs(wrap(theta - routeOf(r, s))) * R < riverWidth * (3 + r.meander));
  const placed: Site[] = [], bays = baysOf(h);
  // On a landform an entrance keeps to its foot or a low terrace, never its top or a face: the lift down is as deep
  // as the court stands over the layer, which rises inside a landform only as high as a great hall (`under.hall`).
  const lowest = courtCap(h), court = spacing * 0.025;
  // (Its rim too: a court just off a Ring's foot must not have its rim up the Ring's front.)
  const onFoot = (theta: number, s: number): boolean => {
    const top = (t: number, u: number): number => landformAt(t, u)?.top ?? 0;
    if (top(theta, s) > lowest) return false;
    return Math.abs(top(theta, s + court) - top(theta, s - court)) + Math.abs(top(theta + court / R, s) - top(theta - court / R, s)) <= court * COURT_SLOPE * 2;
  };
  // Nor in the Sunwalk's way: its court stands clear of the walk's edge.
  const walkClear = court + COURT.clear * (params.landmarks?.handrail ?? 0) + spec.pathWidth.sunwalk / 2;
  const fits = (theta: number, s: number): boolean => Math.abs(wrap(theta - walkTheta(s))) * R >= walkClear && onFoot(theta, s) && !onSignature(theta, s) && offMeres(theta, s, court + COURT.clear * (params.landmarks?.handrail ?? 0));
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
      if (fromLake(lake, s) < Math.max(spacing * 0.15, shoreOf(lake) + court * 2) || !offMeres(theta, s, court * 2) || s < firstEntrance || s > lastEntrance) continue;
      if (tooClose(theta, s) || districtAt(theta, s) !== k || nearRiver(theta, s) || !fits(theta, s)) continue;
      const site: Site = { kind: 'entrance', theta, s, size: spacing * 0.025, facing: erng.range(0, TURN), district: k.id };
      k.entrances.push(site);
      placed.push(site);
      fileUnder(bin, grid.key(grid.column(theta), grid.row(s)), site);
      n++;
    }
    if (!k.entrances.length) {
      // Too cramped to keep apart: one entrance at the seed itself (its bay's middle), kept off the floor's ends, or
      // the nearest bay round it at a landform's foot and clear of the Sunwalk.
      let at = bays.middleNear(k.theta, k.s, firstEntrance, lastEntrance);
      for (let ring = 1; ring < 64 && !fits(wrap(at.theta), at.s); ring++) {
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
  const walkStep = Math.max(floor / 200, 1);
  const walk: number[] = [];
  for (let s = floorStart; s < floorEnd; s += walkStep) walk.push(walkTheta(s), s);
  walk.push(walkTheta(floorEnd), floorEnd);
  const paths: PlanPath[] = [{ kind: 'sunwalk', width: widths.sunwalk, points: Float64Array.from(walk) }];

  // The trail up the Mountain: switchbacks from the Sunwalk's start to the summit hut.
  const trail: number[] = [];
  const legs = 12, start = walkTheta(floorStart), end = landmarks[1].theta, swing = gap * 0.04;
  const endUnwrapped = start + wrap(end - start);
  for (let i = 0; i <= legs; i++) {
    const t = i / legs, s = floorStart + (hutAt - floorStart) * t;
    trail.push(start + (endUnwrapped - start) * t + (i % 2 ? swing : -swing) * Math.sin(Math.PI * t), s);
  }
  paths.push({ kind: 'trail', width: widths.trail, points: Float64Array.from(trail) });

  // The things a way goes round, filed by cell over the floor unrolled (a spacing wide): every court but its own ends'
  // (nobody walks down into another hamlet's court and over its light well), and the districts' works. Each keeps a way
  // `keep` metres from its middle.
  const courtCell = Math.max(spacing, 1), courtColumns = Math.max(1, Math.floor((TURN * R) / courtCell));
  const courtKey = (column: number, row: number): number => row * courtColumns + (((column % courtColumns) + courtColumns) % courtColumns);
  const courtFiles = new Map<number, Obstacle[]>();
  const columnOf = (theta: number): number => Math.floor((((theta % TURN) + TURN) % TURN) * R / courtCell);
  const keepOff = (e: Site): number => e.size + COURT.clear * (h.params.landmarks?.handrail ?? 0) + widths.way;
  // (One wider than a cell, a signature work, in every cell its keep reaches past the next.)
  const fileObstacle = (o: Obstacle): void => {
    const c = columnOf(o.theta), r = Math.floor(o.s / courtCell), n = Math.max(0, Math.ceil(o.keep / courtCell) - 1);
    for (let dr = -n; dr <= n; dr++) for (let dc = -n; dc <= n; dc++) fileUnder(courtFiles, courtKey(c + dc, r + dr), o);
  };
  for (const e of placed) fileObstacle({ theta: e.theta, s: e.s, keep: keepOff(e), work: false });
  for (const o of mereDiscs) fileObstacle(o);
  /** The obstacles near a point, but the courts at `a` and `b`. */
  const obstaclesNear = (theta: number, s: number, a?: { theta: number; s: number }, b?: { theta: number; s: number }): Obstacle[] => {
    const out: Obstacle[] = [], column = columnOf(theta), row = Math.floor(s / courtCell);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) for (const e of courtFiles.get(courtKey(column + dc, row + dr)) ?? []) {
      if (a && b && ((e.theta === a.theta && e.s === a.s) || (e.theta === b.theta && e.s === b.s))) continue;
      out.push(e);
    }
    return out;
  };

  // The districts' works (gen/works.ts): each district shapes up to `WORKS.perDistrict` pieces of its ground in the
  // kinds of its style, in turn, thrown inside it: wholly in the district, clear of the courts, the Sunwalk, the rivers'
  // lines, the lake, the founders' grove, each other, the Heights and the Rings' fronts and crests (a work may stand on
  // a Ring's long slope). Sizes are shares of the tallest (`landforms.works` radii), the footprint at most `WORKS.reach`
  // of the entrance spacing; how crisply each is kept follows its district's care. Those that face along the axis do,
  // one way or the other.
  for (const w of works) fileObstacle({ theta: w.theta, s: w.s, keep: w.radius + widths.way * 2, work: true });
  const workScale = (params.relief.landforms?.works ?? 0) * R, workReach = spacing * WORKS.reach;
  /** Whether a work fits at a point: in district `k` (or the reserve, for null), clear of everything above. */
  const workFits = (k: District | null, theta: number, s: number, radius: number): boolean => {
    if (k ? s - radius < reserveEnd || s + radius > lastEntrance : s - radius < floorStart + spacing * 0.15 || s + radius > reserveEnd) return false;
    if (fromLake(lake, s) < radius + spacing * 0.2 || !offMeres(theta, s, radius * WORKS.apart)) return false;
    if (k && !inside(k, theta, s, radius * 0.7)) return false;
    if (!offLines(theta, s, radius, widths.sunwalk * WORKS.walk, WORKS.river, [-1, 0, 1])) return false;
    if (grove && dist(grove.theta, grove.s, theta, s) < radius + grove.size * 1.2) return false;
    for (const o of obstaclesNear(theta, s)) if (dist(o.theta, o.s, theta, s) < (o.work ? (o.keep + radius) * WORKS.apart : radius + spacing * WORKS.court)) return false;
    // Off the Rings' lines by more than a way bent round it swings out, so no way is bent over a Ring.
    for (const g of form.grounds) if (g.kind === 'ring' && Math.abs(s - form.ringLine(g, theta)) < (radius + widths.way * 2) * 1.3 + radius * 0.1 + widths.way) return false;
    return landUnder(theta, s, radius, 8);
  };
  if (workScale > 0) {
    const krng = new Rng(deriveSeed(h.seed, 'plan', 'works'));
    /** Up to `count` works in the kinds given, in turn, thrown round (θ, s) within `around` and `along` (m) each way. */
    const throwWorks = (k: District | null, kinds: readonly DistrictWorkKind[], count: number, theta0: number, s0: number, around: number, along: number): void => {
      for (let n = 0, tries = 0; n < count && tries < count * WORKS.tries; tries++) {
        const kind = kinds[(n + (k?.id ?? 0)) % kinds.length], spec = WORK_KINDS[kind];
        let height = workScale * krng.range(spec.height[0], spec.height[1]), radius = height * spec.spread;
        if (radius > workReach) { height *= workReach / radius; radius = workReach; }
        const theta = wrap(theta0 + (krng.range(-1, 1) * around) / R), s = s0 + krng.range(-1, 1) * along;
        const facing = spec.axial ? (krng.chance(0.5) ? 0 : Math.PI) : krng.range(0, TURN), vary = krng.float();
        if (!workFits(k, theta, s, radius)) continue;
        // Kept as crisply as its district is cared for; the reserve's are nature's own.
        works.push({ id: works.length, kind, district: k?.id ?? -1, theta, s, height, radius, facing, crisp: k ? smoothstep(WORKS.care[0], WORKS.care[1], k.care) : 0, vary });
        // Its keep counts the way's own width too: the way's edge, not its middle, stays off the work.
        fileObstacle({ theta, s, keep: radius + widths.way * 2, work: true });
        n++;
      }
    };
    for (const k of districts) throwWorks(k, STYLE_WORKS[k.style], WORKS.perDistrict, k.theta, k.s, side / 2, side / 2);
    // The wild reserve: nature's own drumlins and tors, about as many as the districts' works over the same ground.
    const wild = reserveEnd - floorStart;
    if (wild > 0) throwWorks(null, STYLE_WORKS['let-go'], Math.round((WORKS.perDistrict * circumference * wild) / (side * side)), 0, floorStart + wild / 2, Math.PI * R, wild / 2);
  }
  // The works filed by every cell of a grid their footprint touches, so a point looks in one cell.
  // (Cells as wide as the districts' works; a signature work is filed in each of the many its footprint covers.)
  const cellWorks = works.some((w) => !isSignature(w)) ? works.filter((w) => !isSignature(w)) : works;
  const workGrid = floorGrid(R, Math.max(1, ...cellWorks.map((w) => w.radius * 2))), workFiles = new Map<number, Work[]>();
  for (const w of works) {
    const reach = w.radius / workGrid.size, c = workGrid.column(w.theta);
    for (let j = Math.floor((w.s - w.radius) / workGrid.cell); j <= Math.floor((w.s + w.radius) / workGrid.cell); j++) {
      for (let i = c - Math.ceil(reach) - 1; i <= c + Math.ceil(reach) + 1; i++) fileUnder(workFiles, workGrid.key(i, j), w);
    }
  }
  const workOf = (theta: number, s: number): Work | null => {
    for (const w of workFiles.get(workGrid.key(workGrid.column(theta), workGrid.row(s))) ?? []) {
      if (dist(w.theta, w.s, theta, s) < w.radius) return w;
    }
    return null;
  };
  const worksAt = (theta: number, s: number): number => {
    const list = workFiles.get(workGrid.key(workGrid.column(theta), workGrid.row(s)));
    if (!list) return 0;
    let sum = 0;
    for (const w of list) {
      const a = theta - w.theta, du = (a - TURN * Math.round(a / TURN)) * R, dv = s - w.s;
      if (du * du + dv * dv < w.radius * w.radius) sum += workAt(w, du, dv);
    }
    return sum;
  };

  // The ways: the shortest net joining every entrance to the Sunwalk (a spanning tree, Prim's), never across the
  // lake: water is crossed only by the Sunwalk, through the pavilion. Nor over a Ring or a Height: a way keeps to its
  // room between two Rings and meets the Sunwalk there, which crosses each Ring at its saddle. Each way swings gently
  // from side to side, as a path walked for two hundred years does (a tenth of its length at most), and never into the
  // lake.
  const wrng = new Rng(deriveSeed(h.seed, 'plan', 'ways'));
  const wayStep = Math.max(spacing / 12, widths.way * 4);
  /** A way's points (θ unwrapped from `a`, s) bent round the courts and works they pass: points pushed out, pieces split round. */
  const roundCourts = (way: Float64Array, a: { theta: number; s: number }, b: { theta: number; s: number }): Float64Array => {
    if (!courtFiles.size) return way;
    const pts = Array.from(way);
    /** Push point i out of every court it is in (not the ends). */
    const pushOut = (i: number): void => {
      for (const e of obstaclesNear(pts[i * 2], pts[i * 2 + 1], a, b)) {
        const keep = e.keep * 1.2, du = wrap(pts[i * 2] - e.theta) * R, dv = pts[i * 2 + 1] - e.s, d = Math.hypot(du, dv);
        if (d >= keep) continue;
        const ux = d > 1e-6 ? du / d : 1, vx = d > 1e-6 ? dv / d : 0;
        pts[i * 2] += (ux * keep - du) / R;
        pts[i * 2 + 1] = e.s + vx * keep;
      }
    };
    for (let i = 1; i < pts.length / 2 - 1; i++) pushOut(i);
    // Each piece that still cuts one: split at its middle, pushed out; a few times over (a work's rim takes more).
    for (let round = 0; round < 6; round++) {
      let split = false;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const mt = (pts[i] + pts[i + 2]) / 2, ms = (pts[i + 1] + pts[i + 3]) / 2;
        const pu = (pts[i + 2] - pts[i]) * R, pv = pts[i + 3] - pts[i + 1], l2 = Math.max(pu * pu + pv * pv, 1e-9);
        const cuts = obstaclesNear(mt, ms, a, b).some((e) => {
          const eu = wrap(e.theta - pts[i]) * R, ev = e.s - pts[i + 1], k = Math.min(1, Math.max(0, (eu * pu + ev * pv) / l2));
          return Math.hypot(eu - pu * k, ev - pv * k) < e.keep;
        });
        if (!cuts) continue;
        pts.splice(i + 2, 0, mt, ms);
        pushOut(i / 2 + 1);
        split = true;
        i += 2;
      }
      if (!split) break;
    }
    return Float64Array.from(pts);
  };
  const wayRings = form.grounds.filter((g) => g.kind === 'ring');
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
      // Kept off the water, all but its ends: an entrance or a point of the Sunwalk by the shore stays where it is, so
      // the way joins it.
      if (lake && i > 0 && i < n) {
        const shore = lake.halfWidth + spacing * 0.1, d = ps - lake.s;
        if (Math.abs(d) < shore) ps = lake.s + Math.sign(a.s - lake.s) * shore;
      }
      const pt = a.theta + (du * t + nu * off) / R;
      // Nor over a Ring's crest (or up its steep front), on whichever side the way starts: it keeps to its room.
      if (i > 0 && i < n) for (const g of wayRings) {
        const line = form.ringLine(g, pt), side = a.s > form.ringLine(g, a.theta) ? 1 : -1;
        const keep = g.height * (GROUND.crest / 2 + (side === g.facing ? GROUND.face : 0)) + widths.way;
        if ((ps - line) * side < keep && Math.abs(ps - line) < g.radius) ps = line + side * keep;
      }
      out[i * 2] = pt;
      out[i * 2 + 1] = Math.min(floorEnd, Math.max(reserveEnd, ps));
    }
    return roundCourts(out, a, b);
  };
  const anchors: { theta: number; s: number }[] = [];
  // The Sunwalk's points a way may join: on the worked floor, and on land (over the lake it is the pavilion's bridges).
  for (let i = 0; i < walk.length; i += 2) if (walk[i + 1] >= reserveEnd && (!lake || fromLake(lake, walk[i + 1]) >= spacing * 0.1)) anchors.push({ theta: walk[i], s: walk[i + 1] });
  const nodes = [...anchors, ...placed];
  const crossesLake = (a: { s: number }, b: { s: number }): boolean => !!lake && Math.min(a.s, b.s) < lake.s && Math.max(a.s, b.s) > lake.s;
  const n = nodes.length, inTree = new Uint8Array(n), cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  for (let i = 0; i < anchors.length; i++) { inTree[i] = 1; }
  // Squared distances: the shortest net is the same for any measure that keeps their order, and a lake crossing costs
  // a million times over either way.
  const nt = Float64Array.from(nodes, (k) => k.theta), ns = Float64Array.from(nodes, (k) => k.s);
  // Which side of each Ring every node lies on, and the Heights' places.
  const rings = form.grounds.filter((g) => g.kind === 'ring'), mounts = form.grounds.filter((g) => g.kind === 'height');
  const sides = rings.map((r) => Int8Array.from(nodes, (k) => (k.s > form.ringLine(r, k.theta) ? 1 : -1)));
  const overLand = (i: number, j: number, u: number, v: number): boolean => {
    for (const side of sides) if (side[i] !== side[j]) return true;
    // Through a district's work (those by its middle; a longer way is bent round the rest).
    if (works.length) for (const o of obstaclesNear(nt[i] + u / (2 * R), ns[i] + v / 2)) {
      if (!o.work) continue;
      const a = o.theta - nt[i], ou = (a - TURN * Math.round(a / TURN)) * R, ov = o.s - ns[i];
      const t = Math.min(1, Math.max(0, (ou * u + ov * v) / Math.max(u * u + v * v, 1e-9)));
      if (Math.hypot(ou - u * t, ov - v * t) < o.keep) return true;
    }
    for (const g of mounts) {
      const a = g.theta - nt[i], gu = (a - TURN * Math.round(a / TURN)) * R, gv = g.s - ns[i];
      // Nearer than its clearance, and nearer than the way's own ends (an entrance at a Height's foot is left its way).
      const t = (gu * u + gv * v) / Math.max(u * u + v * v, 1e-9);
      if (t > 0 && t < 1 && Math.hypot(gu - u * t, gv - v * t) < g.radius * WAY_CLEAR) return true;
    }
    return false;
  };
  const relax = (i: number): void => {
    for (let j = anchors.length; j < n; j++) {
      if (inTree[j]) continue;
      const a = nt[j] - nt[i], u = (a - TURN * Math.round(a / TURN)) * R, v = ns[j] - ns[i];
      // (A crossing only raises the cost, so it is only looked for where the plain cost would win.)
      let c = u * u + v * v;
      if (c >= cost[j]) continue;
      c *= crossesLake(nodes[i], nodes[j]) ? 1e12 : overLand(i, j, u, v) ? 1e6 : 1;
      if (c < cost[j]) { cost[j] = c; from[j] = i; }
    }
  };
  for (let i = 0; i < anchors.length; i++) relax(i);
  // Each entrance's way to it, by node.
  const wayTo = new Map<number, Float64Array>();
  for (let added = anchors.length; added < n; added++) {
    let pick = -1;
    for (let j = anchors.length; j < n; j++) if (!inTree[j] && (pick < 0 || cost[j] < cost[pick])) pick = j;
    if (pick < 0) break;
    inTree[pick] = 1;
    const b = nodes[pick];
    let a = nodes[from[pick]];
    // From another entrance: it leaves that entrance's way where it is clear of its court, so those who pass keep out
    // of the court (a court is its hamlet's door, not a crossroads).
    const before = wayTo.get(from[pick]);
    if (before) {
      const e = nodes[from[pick]] as Site, keep = keepOff(e) * 1.2;
      // (Its first point beyond the court and in the entrance's own room, or where it starts if it is all that short.)
      let k = before.length - 4;
      const room = (j: number): boolean => wayRings.every((g) => (before[j + 1] > form.ringLine(g, before[j])) === (e.s > form.ringLine(g, e.theta)));
      while (k > 0 && (Math.hypot(wrap(before[k] - e.theta) * R, before[k + 1] - e.s) < keep || !room(k))) k -= 2;
      a = { theta: before[Math.max(0, k)], s: before[Math.max(0, k) + 1] };
    }
    const points = wayPoints(a, b);
    wayTo.set(pick, points);
    paths.push({ kind: 'way', width: widths.way, points });
    relax(pick);
  }

  return { ...form, culture, districts, sites: [...landmarks, ...placed], paths, districtAt, borderAt, inside, works, worksAt, workOf };
}
