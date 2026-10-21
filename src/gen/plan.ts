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
 *   sites     the entrances down to the living layer and the landmarks (`Site`);
 *   paths     the Sunwalk (the long path along the main valley, walked with the travelling sun), the ways between the
 *             entrances, the trail up the Mountain.
 *
 * Pure and seeded: the same habitat always gets the same plan. Sizes are shares of the habitat (its radius, its floor,
 * its relief) or come from `HabitatParams.plan`, so every habitat of the blueprint matrix gets a plan of its own size.
 * Coordinates are the profile's (θ, s); distances over the floor are measured unrolled (θ times the radius, and s).
 */
import { Rng, Noise, angleDiff, deriveSeed, smoothstep } from '@futuremagic/core';
import { cultureOf, wrapAngle, type Culture, type DistrictStyle, type FaceKind, type Habitat } from '../blueprint';
import { kept } from './kept';

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

export type PathKind = 'sunwalk' | 'way' | 'trail';

export interface PlanPath {
  kind: PathKind;
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
  /** The port face a point of the port endcap belongs to (the face of the valley it lies in). */
  faceAt(theta: number, s: number): Face;
  /** Where a planned river's middle line runs at s (θ), before it meanders. */
  routeOf(river: PlannedRiver, s: number): number;
  /** The point of an endcap (`wild`, or the port's) where gravity is the share `g` of the floor's, along the profile. */
  endcapAt(wild: boolean, g: number): number;
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
  const valleyAt = (k: number, s: number): number => phase + gap * k + (gap / 6) * wander.fbm2(s / bend, k * 7.31, 2) + twist(s);
  // The valleys' lines at the last s asked: callers sweep θ at one s (a tile's row, a ring), so most asks reuse them.
  const lines = new Float64Array(N);
  let linesAt = NaN;
  const acrossAt = (theta: number, s: number): { valley: number; across: number } => {
    if (s !== linesAt) { for (let k = 0; k < N; k++) lines[k] = valleyAt(k, s); linesAt = s; }
    let best = 0, d = Infinity;
    for (let k = 0; k < N; k++) {
      const a = theta - lines[k], t = a - TURN * Math.round(a / TURN);
      if (Math.abs(t) < Math.abs(d)) { d = t; best = k; }
    }
    if (N === 1) return { valley: 0, across: d / Math.PI };
    // The ridge lies halfway to the neighbouring valley on the point's side.
    const next = (best + (d >= 0 ? 1 : N - 1)) % N, apart = lines[next] - lines[best];
    const half = Math.abs(apart - TURN * Math.round(apart / TURN)) / 2;
    return { valley: best, across: Math.max(-1, Math.min(1, d / half)) };
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

  return {
    habitat: h, lake, reserveEnd, valleys: N, faces, mountain, rivers, phase, stairHalfWidth: R * 0.02,
    careAt, gravityAt, bandAt, valleyAt, acrossAt, faceAt, routeOf, endcapAt,
  };
}

export function makePlan(h: Habitat): Plan {
  const culture = cultureOf(h.params.culture);
  if (!culture) throw new Error(`no culture "${h.params.culture}" in the catalogue`);
  const form = landformOf(h);
  const { profile, params } = h, R = h.radius, spec = params.plan;
  const { floorStart, floorEnd } = profile, floor = floorEnd - floorStart;
  const { lake, reserveEnd, faces, rivers, phase, careAt, valleyAt, acrossAt, routeOf, endcapAt } = form;
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
    if (lake && Math.abs(s - lake.s) < lake.halfWidth) return false;
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
      const apart = dist(own.theta, own.s, k.theta, k.s);
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

  // Entrances: dart throwing inside each district, kept apart by about the spacing, off the river lines and the lake.
  const erng = new Rng(deriveSeed(h.seed, 'plan', 'entrances'));
  const spacing = spec.entranceSpacing;
  const perDistrict = Math.max(1, Math.round((circumference * worked) / districts.length / (spacing * spacing)));
  const nearRiver = (theta: number, s: number): boolean => rivers.some((r) => Math.abs(wrap(theta - routeOf(r, s))) * R < riverWidth * (3 + r.meander));
  const placed: Site[] = [];
  const bin = new Map<string, Site[]>();
  const keyOf = (theta: number, s: number): string => `${Math.floor(wrapAngle(theta) * R / spacing)},${Math.floor(s / spacing)}`;
  const tooClose = (theta: number, s: number): boolean => {
    const [i, j] = keyOf(theta, s).split(',').map(Number), around = Math.ceil(circumference / spacing);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const o of bin.get(`${(((i + di) % around) + around) % around},${j + dj}`) ?? []) if (dist(o.theta, o.s, theta, s) < spacing * 0.6) return true;
    }
    return false;
  };
  for (const k of districts) {
    const reach = Math.max(rowLength, colWidth * R);
    for (let n = 0, tries = 0; n < perDistrict && tries < perDistrict * 30; tries++) {
      const s = k.s + erng.range(-0.75, 0.75) * reach, theta = wrap(k.theta + (erng.range(-0.75, 0.75) * reach) / R);
      if (districtAt(theta, s) !== k || nearRiver(theta, s) || tooClose(theta, s)) continue;
      if (lake && Math.abs(s - lake.s) < lake.halfWidth + spacing * 0.15) continue;
      const site: Site = { kind: 'entrance', theta, s, size: spacing * 0.025, facing: erng.range(0, TURN), district: k.id };
      k.entrances.push(site);
      placed.push(site);
      const key = keyOf(theta, s);
      bin.set(key, [...(bin.get(key) ?? []), site]);
      n++;
    }
    if (!k.entrances.length) {
      // Too cramped to keep apart: one entrance at the seed itself.
      const site: Site = { kind: 'entrance', theta: k.theta, s: k.s, size: spacing * 0.025, facing: 0, district: k.id };
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
  const paths: PlanPath[] = [{ kind: 'sunwalk', points: Float64Array.from(walk) }];

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
  paths.push({ kind: 'trail', points: Float64Array.from(trail) });

  // The ways: the shortest net joining every entrance to the Sunwalk (a spanning tree, Prim's), never across the
  // lake: water is crossed only by the Sunwalk, through the pavilion.
  const anchors: { theta: number; s: number }[] = [];
  for (let i = 0; i < walk.length; i += 2) if (walk[i + 1] >= reserveEnd) anchors.push({ theta: walk[i], s: walk[i + 1] });
  const nodes = [...anchors, ...placed];
  const crossesLake = (a: { s: number }, b: { s: number }): boolean => !!lake && Math.min(a.s, b.s) < lake.s && Math.max(a.s, b.s) > lake.s;
  const n = nodes.length, inTree = new Uint8Array(n), cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  for (let i = 0; i < anchors.length; i++) { inTree[i] = 1; }
  const relax = (i: number): void => {
    for (let j = anchors.length; j < n; j++) {
      if (inTree[j]) continue;
      const a = nodes[i], b = nodes[j];
      const c = dist(a.theta, a.s, b.theta, b.s) * (crossesLake(a, b) ? 1e6 : 1);
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
    paths.push({ kind: 'way', points: Float64Array.from([a.theta, a.s, a.theta + wrap(b.theta - a.theta), b.s]) });
    relax(pick);
  }

  return { ...form, culture, districts, sites: [...landmarks, ...placed], paths, districtAt, borderAt };
}
