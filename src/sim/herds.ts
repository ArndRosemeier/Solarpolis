/**
 * Deer (design "Who is out on the land": "a herd is one seeded entity with a home range and a dawn and dusk rhythm, its
 * deer spaced around the herd's path"; how many: `HabitatParams.life.animals`). Pure functions of the habitat's seed,
 * its land and the clock, as the people and the squirrels are.
 *
 * Where. Deer live on the land left to them: the wild reserve at the wild end of the floor, and the districts kept for
 * herds or let go (`DistrictStyle` 'herd', 'let-go'). That land is cut into cells two roams a side; a cell holds its
 * share of `animals.deer` per km² in herds of about `animals.herd`, each with a home in the cell. Asking for the herds
 * near a point (`herdsNear`, in the worker: it needs the ecology) looks at the cells around it and gives each herd its
 * places within its roam: lying-up spots under closed crowns, and grazing on open, dry, gentle ground, each with room
 * for the whole herd round it and a way to it from home that fords no more than a stream.
 *
 * When. A herd's day follows the light where it lives (`localNoon`, as people's outings do): it leaves its night cover
 * as the light comes up and grazes on the open ground through the morning, walks into the woods to lie up round the
 * light's peak, comes out again to graze through the afternoon and evening, and goes back under the trees after dark
 * (to the cover it starts the next day in, so the days join up). Grazing, the herd drifts slowly over its meadow. Each
 * day is laid out once (`dayOf`) as legs: resting, grazing, walking from place to place (by way of home where the
 * straight way crosses water).
 *
 * Who. The herd's deer walk in file along the herd's path, each a couple of seconds behind the one before; settled,
 * they spread out round it, each in its own place, grazing, looking up, lifting its head or standing (Actors' deer have
 * no lying-down clip yet, so resting deer stand). `deerAt` gives one deer at a clock time.
 */
import { hash3i } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import type { Ecology } from '../gen/ecology';
import { planOf } from '../gen/plan';
import type { Terrain } from '../gen/terrain';
import { crownsOf, open } from './fauna';
import { localNoon, unit } from './population';
import { floorGap } from './walks';

const TURN = 2 * Math.PI;

/** A herd: its home, how many deer, and its places (θ, s pairs, flat): lying-up spots in cover and grazing spots. */
export interface Herd {
  id: number;
  seed: number;
  theta: number;
  s: number;
  size: number;
  cover: number[];
  graze: number[];
}

/** What a deer is doing: walking, or settled grazing (`eat`, `headLow`), looking round (`idle2`) or standing (`idle`). */
export type DeerDoing = 'walk' | 'eat' | 'headLow' | 'idle' | 'idle2';

/** One deer at a moment. */
export interface Deer {
  /** Its herd's id × 64 + its place in the herd. */
  id: number;
  theta: number;
  s: number;
  /** The way it faces over the floor (radians: 0 toward the far end, +π/2 spinward), as the squirrels'. */
  heading: number;
  /** How fast it goes over the floor (m/s). */
  speed: number;
  doing: DeerDoing;
  /** How long it has been doing it (s): where its clip is. */
  since: number;
}

/** How fast a herd walks between its places, and drifts as it grazes (m/s). */
export const DEER_WALK = 1.1;
export const DEER_DRIFT = 0.25;
/** The most deer in a herd (ids leave room for 64). */
export const HERD_MOST = 48;
/** How far a grazing herd drifts round its spot (m), and how long it stays at each point of it (s). */
const DRIFT = 25;
const DRIFT_EVERY = 300;
/** How far apart deer walk in file (s behind the one before), and how widely they spread when settled (m per √deer). */
export const DEER_LAG = 2.4;
const SPREAD = 3.5;
/** How long a herd takes to spread out once settled, and to close up into file when it sets off (s). */
const SETTLE = 25;
const CLOSE = 8;
/** How long a settled deer keeps to one thing (s), and how far it turns from its herd's way for it (radians, ±). */
export const DEER_BOUT = 18;
const TURNS = 1.2;
/** What a settled deer does, and how often: grazing, then resting. */
const GRAZING: readonly [DeerDoing, number][] = [['eat', 0.6], ['headLow', 0.15], ['idle2', 0.15], ['idle', 0.1]];
const RESTING: readonly [DeerDoing, number][] = [['idle', 0.6], ['idle2', 0.4]];
/** How many places of each kind a herd has, and how many tries each before it gives up. */
const PLACES = 6;
const TRIES = 24;
/** Crowns at least this closed are cover; at most this open is grazing. */
const COVER = 0.5;
const OPEN = 0.25;
/** How far apart the ground is looked at along a way (m), and how much water a herd fords (m across). */
const STEP = 6;
const FORD = 12;
/**
 * A herd's day, as shares of the bright hours: it goes out this long after the light comes up, lies up this long
 * either side of the light's peak where it lives (grazing at least `graze` first), and goes in this share of the night
 * after dark. Its hours wander by `jitter` from day to day.
 */
const DAY = { out: 0.03, lieUp: 0.15, graze: 0.1, home: 0.08, jitter: 0.03 } as const;
/** A herd is back in its night cover this long before the day ends (s), so the days join up. */
const HOME_BY = 120;

/** Whether deer live at a point: the wild reserve, or a district kept for herds or let go. */
export function deerLand(h: Habitat, theta: number, s: number): boolean {
  const plan = planOf(h), { profile } = h;
  if (s >= profile.floorStart && s < plan.reserveEnd) return true;
  const d = plan.districtAt(theta, s);
  return !!d && (d.style === 'herd' || d.style === 'let-go');
}

/** How widely a herd of `size` spreads when settled (m). */
const spreadOf = (size: number): number => SPREAD * Math.sqrt(size);

/** Water at a point: the ground is under it. */
const wet = (t: Terrain, theta: number, s: number): boolean => t.standAt(theta, s) > t.heightAt(theta, s) + 0.05;

/** Whether a herd can walk straight from one point to another: open ground all the way, but for streams it fords. */
function walkable(t: Terrain, a: readonly number[], b: readonly number[]): boolean {
  const r = Math.max(1, t.habitat.profile.at(a[1]).r), gap = floorGap(r, a[0], a[1], b[0], b[1]), n = Math.ceil(gap / STEP);
  let water = 0;
  for (let i = 1; i < n; i++) {
    const f = i / n, theta = a[0] + (b[0] - a[0]) * f, s = a[1] + (b[1] - a[1]) * f;
    if (open(t, theta, s)) { water = 0; continue; }
    if (!wet(t, theta, s) || (water += gap / n) > FORD) return false;
  }
  return true;
}

/** Whether a herd of `size` has room round a point: open ground there and all round it. */
function roomy(t: Terrain, theta: number, s: number, size: number): boolean {
  if (!open(t, theta, s)) return false;
  const r = Math.max(1, t.habitat.profile.at(s).r), d = spreadOf(size);
  for (let i = 0; i < 6; i++) {
    const a = (TURN * i) / 6;
    if (!open(t, theta + (d * Math.cos(a)) / r, s + d * Math.sin(a))) return false;
  }
  return true;
}

/** The cells' side (m): two roams. */
const herdCell = (h: Habitat): number => 2 * h.params.life.animals.roam;

/**
 * The herds whose homes lie within `radius` m of (θ, s), each with its places. For the worker (it needs the ecology).
 * The same every time.
 */
export function herdsNear(ecology: Ecology, theta: number, s: number, radius: number): Herd[] {
  const t = ecology.terrain, h = t.habitat, { profile } = h, a = h.params.life.animals, G = herdCell(h);
  if (!(a.deer > 0)) return [];
  const crowns = crownsOf(ecology), seed = hash3i(h.seed, 0xdee7, 3, 0), out: Herd[] = [];
  const rows = Math.ceil(profile.length / G);
  for (let k = Math.max(0, Math.floor((s - radius) / G)); k < Math.min(rows, Math.floor((s + radius) / G) + 1); k++) {
    const s0 = k * G, depth = Math.min(G, profile.length - s0), r = Math.max(1, profile.at(s0 + depth / 2).r);
    const n = Math.max(1, Math.round((TURN * r) / G)), dTheta = TURN / n, reach = radius / r + dTheta;
    const c0 = Math.floor((theta - reach) / dTheta), c1 = Math.min(c0 + n - 1, Math.floor((theta + reach) / dTheta));
    for (let cc = c0; cc <= c1; cc++) {
      const c = ((cc % n) + n) % n, cell = hash3i(seed, k, c, 0);
      // The cell's share of deer land, from a few points of it.
      let land = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (deerLand(h, (c + (i + 0.5) / 4) * dTheta, s0 + (depth * (j + 0.5)) / 4)) land++;
      if (land === 0) continue;
      const area = (r * dTheta * depth * land) / 16 / 1e6;
      const expect = (a.deer * area) / a.herd, herds = Math.floor(expect) + (unit(cell, 0, 0, 0) < expect - Math.floor(expect) ? 1 : 0);
      for (let j = 0; j < herds; j++) {
        const hs = hash3i(cell, j, 11, 0), size = Math.min(HERD_MOST, Math.max(2, Math.round(a.herd * (0.5 + unit(hs, 1, 0, 0)))));
        const home = homeOf(t, cell, j, c * dTheta, s0, dTheta, depth, size);
        if (!home || floorGap(r, theta, s, home[0], home[1]) > radius) continue;
        const places = placesOf(t, crowns, hs, home, size);
        out.push({ id: (k * 100000 + c) * 16 + j, seed: hs, theta: home[0], s: home[1], size, ...places });
      }
    }
  }
  return out;
}

/** A herd's home: a point of its cell on deer land with room for the herd, a few tried; or none. */
function homeOf(t: Terrain, cell: number, j: number, theta0: number, s0: number, dTheta: number, depth: number, size: number): [number, number] | null {
  for (let tries = 0; tries < 8; tries++) {
    const theta = theta0 + dTheta * unit(cell, j, 2, tries), s = s0 + depth * unit(cell, j, 3, tries);
    if (deerLand(t.habitat, theta, s) && roomy(t, theta, s, size)) return [theta, s];
  }
  return null;
}

/** Whether the ground round a point is out of closed woods as far as a grazing herd drifts (`DRIFT`), every way. */
function openRound(t: Terrain, crowns: (theta: number, s: number, ground: number) => number, theta: number, s: number, r: number): boolean {
  for (let q = 0; q < 6; q++) {
    const a = (q / 6) * TURN, pt = theta + (DRIFT * Math.cos(a)) / r, ps = s + DRIFT * Math.sin(a);
    if (crowns(pt, ps, t.heightAt(pt, ps)) >= COVER) return false;
  }
  return true;
}

/**
 * A herd's places within its roam, each on deer land, with room for the herd and a way from home: lying-up spots under
 * closed crowns and grazing in the open. Home stands in for a kind it finds none of.
 */
function placesOf(t: Terrain, crowns: (theta: number, s: number, ground: number) => number, seed: number, home: [number, number], size: number): { cover: number[]; graze: number[] } {
  const h = t.habitat, roam = h.params.life.animals.roam, r = Math.max(1, h.profile.at(home[1]).r), cover: number[] = [], graze: number[] = [];
  for (let i = 0; i < TRIES * PLACES && (cover.length < 2 * PLACES || graze.length < 2 * PLACES); i++) {
    const d = roam * Math.sqrt(unit(seed, i, 4, 0)), a = TURN * unit(seed, i, 5, 0);
    const pt = home[0] + (d * Math.cos(a)) / r, ps = Math.min(h.profile.length, Math.max(0, home[1] + d * Math.sin(a)));
    if (!deerLand(h, pt, ps)) continue;
    const c = crowns(pt, ps, t.heightAt(pt, ps)), list = c >= COVER ? cover : c <= OPEN ? graze : null;
    if (!list || list.length >= 2 * PLACES || !roomy(t, pt, ps, size) || !walkable(t, home, [pt, ps])) continue;
    // A grazing place is open as far as the herd drifts round it, not the edge of a wood it would wander into.
    if (list === graze && !openRound(t, crowns, pt, ps, r)) continue;
    list.push(pt, ps);
  }
  if (cover.length === 0) cover.push(...home);
  if (graze.length === 0) graze.push(...home);
  return { cover, graze };
}

/** A leg of a herd's day: walking from → to, grazing round `from` (drifting over it), or resting at `from`. */
interface Leg {
  t0: number;
  t1: number;
  mode: 'walk' | 'graze' | 'rest';
  from: [number, number];
  to: [number, number];
}

/**
 * Each herd's last few days, laid out (a herd's deer walk seconds apart, so round midnight they are in two days), and
 * the points its grazing drifts to: worked out once, as asked for.
 */
const days = new WeakMap<Herd, Map<number, Leg[]>>();
const drifts = new WeakMap<Herd, Map<string, [number, number]>>();

/** A herd's place of a kind for a day and a key (its night cover, its morning meadow…). */
function placeOf(herd: Herd, list: number[], day: number, key: number): [number, number] {
  const i = Math.floor(unit(herd.seed, day, key, 7) * (list.length / 2)) * 2;
  return [list[i], list[i + 1]];
}

/** Point n of the drift of a herd grazing round `spot` (leg `leg` of day `day`): the spot itself first. */
function driftPoint(t: Terrain, herd: Herd, day: number, leg: number, spot: [number, number], n: number): [number, number] {
  if (n <= 0) return spot;
  let kept = drifts.get(herd);
  if (!kept) { kept = new Map(); drifts.set(herd, kept); }
  const key = `${day}:${leg}:${n}`, known = kept.get(key);
  if (known) return known;
  const r = Math.max(1, t.habitat.profile.at(spot[1]).r), u = hash3i(herd.seed, day, leg, 8);
  const d = DRIFT * Math.sqrt(unit(u, n, 0, 0)), a = TURN * unit(u, n, 1, 0);
  let p: [number, number] = [spot[0] + (d * Math.cos(a)) / r, spot[1] + d * Math.sin(a)];
  if (!roomy(t, p[0], p[1], herd.size) || !walkable(t, spot, p)) p = spot;
  if (kept.size > 64) kept.clear();
  kept.set(key, p);
  return p;
}

/** Where a herd grazing in leg `k` is at time tau of its day, whether it is drifting, and the way it last went. */
function grazing(t: Terrain, herd: Herd, day: number, k: number, leg: Leg, tau: number): { at: [number, number]; moving: boolean; way: [number, number] | null } {
  const n = Math.max(0, Math.floor((tau - leg.t0) / DRIFT_EVERY));
  const a = driftPoint(t, herd, day, k, leg.from, n), b = driftPoint(t, herd, day, k, leg.from, n + 1);
  const r = Math.max(1, t.habitat.profile.at(a[1]).r), gap = floorGap(r, a[0], a[1], b[0], b[1]);
  const depart = leg.t0 + (n + 1) * DRIFT_EVERY - gap / DEER_DRIFT;
  if (gap > 0.01 && tau >= depart) {
    const f = Math.min(1, (tau - depart) / (gap / DEER_DRIFT));
    return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], moving: true, way: [(b[0] - a[0]) * r, b[1] - a[1]] };
  }
  const last = n > 0 ? driftPoint(t, herd, day, k, leg.from, n - 1) : null;
  return { at: a, moving: false, way: last && floorGap(r, last[0], last[1], a[0], a[1]) > 0.5 ? [(a[0] - last[0]) * r, a[1] - last[1]] : null };
}

/** Herd `herd`'s day `day`, laid out once (a few days kept). */
function dayOf(t: Terrain, herd: Herd, day: number): Leg[] {
  let kept = days.get(herd);
  if (!kept) { kept = new Map(); days.set(herd, kept); }
  const known = kept.get(day);
  if (known) return known;
  const h = t.habitat, { length, daylight } = h.params.day, dusk = daylight * length, noon = localNoon(h, herd.s) * length;
  const r = Math.max(1, h.profile.at(herd.s).r), home: [number, number] = [herd.theta, herd.s];
  const legs: Leg[] = [];
  const end = (): number => (legs.length ? legs[legs.length - 1].t1 : 0);
  const stay = (mode: 'graze' | 'rest', at: [number, number], until: number): void => {
    legs.push({ t0: end(), t1: Math.max(end() + 60, until), mode, from: at, to: at });
  };
  const where = (): [number, number] => {
    const k = legs.length - 1, leg = legs[k];
    return leg.mode === 'graze' ? grazing(t, herd, day, k, leg, leg.t1).at : leg.to;
  };
  /** The walk to a place: straight, or by way of home where the straight way is wet. */
  const route = (to: [number, number]): [number, number][] => {
    const from = where();
    return walkable(t, from, to) ? [from, to] : [from, home, to];
  };
  const took = (path: [number, number][]): number => path.slice(1).reduce((x, p, i) => x + floorGap(r, path[i][0], path[i][1], p[0], p[1]), 0) / DEER_WALK;
  const goAlong = (path: [number, number][]): void => {
    for (let i = 1; i < path.length; i++) {
      const t0 = end(), gap = floorGap(r, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
      legs.push({ t0, t1: t0 + Math.max(1, gap / DEER_WALK), mode: 'walk', from: path[i - 1], to: path[i] });
    }
  };
  const bright = dusk, wander = (key: number): number => (unit(herd.seed, day, key, 6) - 0.5) * 2 * DAY.jitter * bright;
  const out = DAY.out * bright + wander(1);
  const up = Math.max(out + DAY.graze * bright, noon - DAY.lieUp * bright + wander(2));
  const back = dusk + DAY.home * (length - dusk) + wander(4);
  const down = Math.min(back - DAY.graze * bright, noon + DAY.lieUp * bright + wander(3));
  const night = placeOf(herd, herd.cover, day, 0), tomorrow = placeOf(herd, herd.cover, day + 1, 0);
  stay('rest', night, out);
  goAlong(route(placeOf(herd, herd.graze, day, 2)));
  stay('graze', where(), up);
  goAlong(route(placeOf(herd, herd.cover, day, 3)));
  stay('rest', where(), down);
  goAlong(route(placeOf(herd, herd.graze, day, 4)));
  // Grazing ends in time for the herd to be in its cover for the night before the day is out.
  const k = legs.length;
  stay('graze', where(), back);
  legs[k].t1 = Math.max(legs[k].t0 + 60, Math.min(legs[k].t1, length - HOME_BY - took(route(tomorrow))));
  goAlong(route(tomorrow));
  stay('rest', tomorrow, length);
  if (kept.size > 4) kept.delete(kept.keys().next().value!);
  kept.set(day, legs);
  return legs;
}

/** The leg a time of day falls in. */
function legAt(legs: readonly Leg[], tau: number): number {
  let lo = 0, hi = legs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (legs[m].t0 <= tau) lo = m; else hi = m - 1; }
  return lo;
}

/** The way a leg walks (over the floor, m), or the way the herd last walked before it; null if it never has today. */
function lastWay(legs: readonly Leg[], k: number, r: number): [number, number] | null {
  for (let i = Math.min(k, legs.length - 1); i >= 0; i--) if (legs[i].mode === 'walk') return [(legs[i].to[0] - legs[i].from[0]) * r, legs[i].to[1] - legs[i].from[1]];
  return null;
}

/** Deer `i` of herd `herd` at clock time t (s). */
export function deerAt(t: Terrain, herd: Herd, i: number, time: number): Deer {
  const h = t.habitat, L = h.params.day.length, r = Math.max(1, h.profile.at(herd.s).r);
  const behind = time - i * DEER_LAG, day = Math.floor(behind / L), tau = behind - day * L;
  const legs = dayOf(t, herd, day), k = legAt(legs, tau), leg = legs[k];
  // Settled, the deer spread out round the herd's place; setting off, they close up into file. A night's rest runs on
  // from the day before.
  const since = tau - leg.t0 + (k === 0 ? L : 0);
  let spread: number;
  if (leg.mode !== 'walk') spread = Math.min(1, since / SETTLE);
  else {
    const before = legs[k - 1], settled = before && before.mode !== 'walk' ? Math.min(1, (before.t1 - before.t0 + (k === 1 ? L : 0)) / SETTLE) : 0;
    spread = settled * Math.max(0, 1 - since / CLOSE);
  }
  const id = hash3i(herd.seed, i, 21, 0), d = spreadOf(herd.size) * Math.sqrt(unit(id, 0, 0, 0)), a = TURN * unit(id, 0, 1, 0);
  const g = leg.mode === 'graze' ? grazing(t, herd, day, k, leg, tau) : null;
  const f = leg.mode === 'walk' ? Math.min(1, (tau - leg.t0) / (leg.t1 - leg.t0)) : 0;
  const at: [number, number] = g ? g.at : [leg.from[0] + (leg.to[0] - leg.from[0]) * f, leg.from[1] + (leg.to[1] - leg.from[1]) * f];
  const theta = at[0] + (spread * d * Math.cos(a)) / r, s = at[1] + spread * d * Math.sin(a), who = herd.id * 64 + i;
  // The way the herd last walked: today, or (lying up at the start of the day) the evening before.
  const walked = (): [number, number] | null => lastWay(legs, k, r) ?? (k === 0 ? lastWay(dayOf(t, herd, day - 1), Infinity, r) : null);
  const toHeading = (w: [number, number] | null): number => (w ? Math.atan2(w[0], w[1]) : TURN * unit(id, 0, 2, 0));
  if (leg.mode === 'walk') {
    const speed = floorGap(r, leg.from[0], leg.from[1], leg.to[0], leg.to[1]) / (leg.t1 - leg.t0);
    return { id: who, theta, s, heading: toHeading(lastWay(legs, k, r)), speed, doing: 'walk', since: tau - leg.t0 };
  }
  if (g?.moving) return { id: who, theta, s, heading: toHeading(g.way), speed: DEER_DRIFT, doing: 'walk', since: tau - leg.t0 };
  // Settled: bouts of one thing each, each facing a little off the herd's way.
  const n = Math.floor(behind / DEER_BOUT), u = behind - n * DEER_BOUT;
  const heading = toHeading(g?.way ?? walked()) + (unit(id, n, 3, 0) - 0.5) * 2 * TURNS;
  let pick = unit(id, n, 4, 0), doing: DeerDoing = 'idle';
  for (const [what, share] of leg.mode === 'graze' ? GRAZING : RESTING) { if (pick < share) { doing = what; break; } pick -= share; }
  return { id: who, theta, s, heading, speed: 0, doing, since: Math.min(u, since) };
}

/** Bytes a list of herds holds (memory watchdog). */
export const herdsBytes = (herds: readonly Herd[]): number => herds.reduce((n, x) => n + 64 + 8 * (x.cover.length + x.graze.length), 0);

/** The days a herd's deer are in at clock time t: its first deer's, and its last's (seconds behind). */
const daysAt = (h: Habitat, herd: Herd, time: number): [number, number] => {
  const L = h.params.day.length;
  return [Math.floor(time / L), Math.floor((time - (herd.size - 1) * DEER_LAG) / L)];
};

/** Whether a herd's day at clock time t is laid out yet (laying a day out takes milliseconds: see `prepareHerd`). */
export function herdReady(t: Terrain, herd: Herd, time: number): boolean {
  const kept = days.get(herd);
  return !!kept && daysAt(t.habitat, herd, time).every((d) => kept.has(d));
}

/** Lay out a herd's day at clock time t (and the day before, for the way its deer last walked), so `deerAt` is quick. */
export function prepareHerd(t: Terrain, herd: Herd, time: number): void {
  const [a, b] = daysAt(t.habitat, herd, time);
  for (let d = b - 1; d <= a; d++) dayOf(t, herd, d);
}
