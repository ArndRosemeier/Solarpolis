/**
 * Who is up on the land, and where, at any moment (design "Who is out on the land", 2026-10-22): a pure function of
 * the habitat's seed, the residents and the clock. Nobody is simulated; anyone can be worked out on their own.
 *
 * Residents. Resident i of the population (`HabitatParams.population`) is the same person every time: their body, look
 * and whether they are a human or a mind (`residentOf`). The first share (`life.regulars`) keep a rhythm: they live
 * under one court, go up on the same weekdays at about the same hour to the same place near it. The rest go up now and
 * then, anywhere.
 *
 * Outings. Each day the others are dealt out by a seeded shuffle (sim/permute.ts): slot j = shuffle(i) says where
 * resident i goes that day. The first slots walk the Sunwalk, the next go to the landmarks (each its share), then to
 * the courts, each court as many as its places draw; the remaining slots stay below. A court's visitors are found by
 * turning its slots back into residents, so asking one court never looks at anyone else, and nobody is in two places.
 *
 * Time. People follow the light: the bright stretch of the sunline travels from the wild end to the port end over the
 * day (world/sunline.ts), and an outing is centred on the hour it passes the place, so the crowd moves down the tube
 * like a wave. Evening places (the Stair at dusk) fill as the tube dims; a few go out at night. Every outing ends the
 * day it began.
 *
 * Where. An outing comes up at a court, walks the walk net (sim/walks.ts) to its place, stays, and walks back. Sunwalkers
 * join the Sunwalk where the bright stretch is and walk with it for hours. Pure.
 */
import { hash3i, hashToFloat, deriveSeed } from '@futuremagic/core';
import { kept } from '../gen/kept';
import { fromLake, planOf } from '../gen/plan';
import type { Habitat } from '../blueprint';
import { shuffleOf, type Shuffle } from './permute';
import { floorGap, pointAlong, sunwalkOf, walksOf, type Route } from './walks';
import { besideLake, venuesOf, type Activity, type Venue, type Venues } from './venues';

const TURN = 2 * Math.PI;
const WEEK = 7;

export interface Resident {
  id: number;
  /** Keeps a rhythm (same weekdays, hour and place near home). */
  regular: boolean;
  /** The court they live under (index into `venuesOf(h).courts`). */
  home: number;
  /** Never shown by the body: only what they choose to share. */
  being: 'human' | 'mind';
  /** A grown body, or a shell (a plated humanoid body). */
  body: 'grown' | 'shell';
  /** The seed of their look (body, face, hair, clothes). */
  look: number;
  /** How fast they walk (m/s). */
  walk: number;
}

/** Someone up on the land at a moment. */
export interface Person {
  resident: number;
  theta: number;
  s: number;
  /** The way they face over the floor (radians: 0 toward the port end, +π/2 spinward). */
  heading: number;
  /** Walking, or staying put at their place. */
  moving: boolean;
  /** How fast they go over the floor (m/s; 0 staying put). */
  speed: number;
  activity: Activity;
  /** The court they came up at, or −1 for a Sunwalker. */
  court: number;
  /** Which of the court's outings that day (or which Sunwalker): with `court`, finds them again (`whereIs`). */
  outing: number;
}

/** One day's outings from one court, in plain arrays. */
interface Outings {
  resident: Int32Array;
  venue: Int32Array;
  start: Float64Array;
  stay: Float32Array;
  night: Uint8Array;
}

interface Census {
  readonly residents: number;
  readonly regulars: number;
  /** Where each slot of the day's shuffle goes: [0, sunwalk) Sunwalk, then a block per landmark venue, then per court. */
  readonly sunwalk: number;
  /** Block starts (slot), the venue a landmark block goes to (−1: the court chooses), and the court. */
  readonly blockStart: Float64Array;
  readonly blockVenue: Int32Array;
  readonly blockCourt: Int32Array;
  /** Each court's blocks. */
  readonly courtBlocks: readonly (readonly number[])[];
  /** Slots that go up at all (the rest stay below). */
  readonly going: number;
}

/** A float in [0, 1) from the habitat's seed and three numbers. */
const unit = (seed: number, a: number, b: number, c: number): number => hashToFloat(hash3i(seed, a, b, c));
/** A standard normal from the same. */
function normal(seed: number, a: number, b: number, c: number): number {
  const u = Math.max(1e-9, unit(seed, a, b, c)), v = unit(seed, a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TURN * v);
}

/** The population's seeds, derived once per habitat (hashing their names each time would cost more than the rest). */
const seedsOf = kept((h: Habitat) => {
  const of = (name: string): number => deriveSeed(h.seed, 'life', name);
  return { resident: of('resident'), outing: of('outing'), rhythm: of('rhythm'), spot: of('spot'), face: of('face'), sunwalk: of('sunwalk') };
});

function makeCensus(h: Habitat): Census {
  const life = h.params.life, v = venuesOf(h);
  const residents = Math.max(0, Math.floor(h.params.population)), regulars = Math.round(residents * life.regulars);
  const others = residents - regulars, going = Math.round(others * life.outings);
  const all = residents * life.outings;
  const sunwalk = Math.min(going, Math.round(all * life.sunwalk));
  const starts: number[] = [], venues: number[] = [], courts: number[] = [];
  let at = sunwalk;
  // Landmarks draw their share of all outings, at most half of what is left.
  const marks = v.venues.map((x, k) => ({ x, k })).filter(({ x }) => x.share > 0);
  const wanted = marks.reduce((a, { x }) => a + x.share * all, 0), scale = Math.min(1, ((going - sunwalk) * 0.5) / Math.max(wanted, 1e-9));
  for (const { x, k } of marks) { starts.push(at); venues.push(k); courts.push(x.court); at += Math.round(x.share * all * scale); }
  const rest = going - at, total = v.draw.reduce((a, b) => a + b, 0);
  let given = 0, sum = 0;
  v.courts.forEach((_, c) => {
    starts.push(at + given); venues.push(-1); courts.push(c);
    sum += v.draw[c];
    given = total > 0 ? Math.round((rest * sum) / total) : 0;
  });
  starts.push(going);
  const courtBlocks: number[][] = v.courts.map(() => []);
  courts.forEach((c, b) => courtBlocks[c].push(b));
  return {
    residents, regulars, sunwalk, going,
    blockStart: Float64Array.from(starts), blockVenue: Int32Array.from(venues), blockCourt: Int32Array.from(courts), courtBlocks,
  };
}

const censusOf: (h: Habitat) => Census = kept(makeCensus);

/** The day's shuffle of the residents who keep no rhythm. */
const shuffles = new WeakMap<Habitat, Map<number, Shuffle>>();
function shuffleFor(h: Habitat, day: number): Shuffle {
  let byDay = shuffles.get(h);
  if (!byDay) { byDay = new Map(); shuffles.set(h, byDay); }
  let sh = byDay.get(day);
  if (!sh) {
    if (byDay.size > 8) byDay.clear();
    const c = censusOf(h);
    sh = shuffleOf(c.residents - c.regulars, deriveSeed(h.seed, 'life', 'day', day));
    byDay.set(day, sh);
  }
  return sh;
}

/** Resident i: the same person every time. */
export function residentOf(h: Habitat, i: number): Resident {
  const c = censusOf(h), life = h.params.life, courts = venuesOf(h).courts.length, seed = seedsOf(h).resident;
  const regular = i < c.regulars;
  const home = courts ? Math.min(courts - 1, Math.floor(regular ? (i * courts) / Math.max(1, c.regulars) : ((i - c.regulars) * courts) / Math.max(1, c.residents - c.regulars))) : 0;
  return {
    id: i, regular, home,
    being: unit(seed, i, 1, 0) < life.minds ? 'mind' : 'human',
    body: unit(seed, i, 2, 0) < life.shells ? 'shell' : 'grown',
    look: hash3i(seed, i, 3, 0),
    walk: life.walk * (0.85 + 0.3 * unit(seed, i, 4, 0)),
  };
}

/** Where in the day the bright stretch is over a place along the profile (phase 0 … daylight). */
function localNoon(h: Habitat, s: number): number {
  const { daylight, peakWidth } = h.params.day, z = h.profile.at(s).z / h.params.length;
  return (daylight * (z + peakWidth)) / (1 + 2 * peakWidth);
}

/** When an outing starts (s into its day) and how long it lasts, from the hour it centres on. */
function timing(h: Habitat, centre: number, stay: number, evening: boolean, night: boolean, jitter: number, pick: number): [number, number] {
  const { length, daylight } = h.params.day, dusk = daylight * length;
  if (night) {
    const room = Math.max(0, length - dusk - stay);
    return [dusk + room * pick, Math.min(stay, length - dusk)];
  }
  if (evening) return [Math.max(0, dusk - 1.5 * 3600 + jitter * 1800), stay];
  const start = centre * length + jitter * daylight * length * 0.18 - stay / 2;
  return [Math.min(Math.max(0.01 * length, start), Math.max(0.01 * length, dusk - 0.25 * stay)), stay];
}

/** How long an outing lasts: about `life.stay`, more or less. */
const stayOf = (h: Habitat, n: number): number => h.params.life.stay * Math.min(3, Math.max(0.25, Math.exp(0.4 * n)));

/** One day's outings from one court: its regulars whose weekday it is, and the visitors the shuffle sends it. */
function outingsFrom(h: Habitat, day: number, court: number): Outings {
  const c = censusOf(h), v = venuesOf(h), life = h.params.life, seed = seedsOf(h).outing;
  const resident: number[] = [], venue: number[] = [], start: number[] = [], stay: number[] = [], night: number[] = [];
  const add = (i: number, k: number, centreJitter: number, n: number, dayPick: number): void => {
    const place = v.venues[k], atNight = !place.evening && unit(seed, i, day, 11) < life.night;
    const long = stayOf(h, n) * (place.evening ? 1.2 : 1);
    const [t0, dt] = timing(h, localNoon(h, place.s), long, place.evening, atNight, centreJitter, dayPick);
    resident.push(i); venue.push(k); start.push(day * h.params.day.length + t0); stay.push(Math.min(dt, h.params.day.length - t0)); night.push(atNight ? 1 : 0);
  };
  const mine = v.byCourt[court];
  // Regulars: the same weekdays, the same hour, the same place.
  const courts = v.courts.length, r0 = Math.ceil((court * c.regulars) / courts), r1 = Math.ceil(((court + 1) * c.regulars) / courts);
  const weekday = ((day % WEEK) + WEEK) % WEEK, rseed = seedsOf(h).rhythm;
  if (mine.length) for (let i = r0; i < r1; i++) {
    if (unit(rseed, i, weekday, 0) >= life.outings) continue;
    const k = favourite(v, mine, unit(rseed, i, 2, 2));
    add(i, k, normal(rseed, i, 3, 3) + 0.1 * normal(seed, i, day, 4), 0.5 * normal(rseed, i, 5, 5) + 0.3 * normal(seed, i, day, 6), unit(seed, i, day, 7));
  }
  // Visitors: the slots of the court's blocks, turned back into residents.
  const sh = shuffleFor(h, day);
  for (const b of c.courtBlocks[court]) {
    const k0 = c.blockVenue[b];
    if (k0 < 0 && !mine.length) continue;
    for (let j = c.blockStart[b]; j < c.blockStart[b + 1]; j++) {
      const i = c.regulars + sh.unpermute(j);
      const k = k0 >= 0 ? k0 : favourite(v, mine, unit(seed, i, day, 8));
      add(i, k, normal(seed, i, day, 9), normal(seed, i, day, 10), unit(seed, i, day, 12));
    }
  }
  return {
    resident: Int32Array.from(resident), venue: Int32Array.from(venue), start: Float64Array.from(start),
    stay: Float32Array.from(stay), night: Uint8Array.from(night),
  };
}

/** A court's venue picked by their pulls (not its landmarks: those have their own visitors). */
function favourite(v: Venues, mine: readonly number[], pick: number): number {
  let total = 0;
  for (const k of mine) total += v.venues[k].pull;
  let x = pick * total;
  for (const k of mine) { x -= v.venues[k].pull; if (x < 0) return k; }
  return mine[0];
}

/** Outings kept per habitat, by day and court, within a byte budget (they are cheap to make again). */
const KEEP_BYTES = 16 * 2 ** 20;
const outingCache = new WeakMap<Habitat, { bytes: number; days: Map<number, Outings> }>();
const bytesOf = (o: Outings): number => o.resident.byteLength + o.venue.byteLength + o.start.byteLength + o.stay.byteLength + o.night.byteLength;
function outingsOf(h: Habitat, day: number, court: number): Outings {
  let m = outingCache.get(h);
  if (!m) { m = { bytes: 0, days: new Map() }; outingCache.set(h, m); }
  const key = day * 1e6 + court;
  let o = m.days.get(key);
  if (!o) {
    o = outingsFrom(h, day, court);
    if (m.bytes + bytesOf(o) > KEEP_BYTES) { m.days.clear(); m.bytes = 0; }
    m.days.set(key, o);
    m.bytes += bytesOf(o);
  }
  return o;
}

/** Bytes the population keeps for a habitat (its outings and routes), for the memory watchdog. */
export function lifeBytes(h: Habitat): number {
  let n = outingCache.get(h)?.bytes ?? 0;
  for (const w of walkerCache.get(h)?.values() ?? []) n += w.resident.byteLength * 8;
  for (const r of routeCache.get(h)?.values() ?? []) n += r.points.byteLength + r.along.byteLength;
  return n;
}

/** Routes kept per habitat, a bounded number. */
const KEEP_ROUTES = 4096;
const routeCache = new WeakMap<Habitat, Map<number, Route>>();
function routeOf(h: Habitat, from: number, to: number): Route {
  let m = routeCache.get(h);
  if (!m) { m = new Map(); routeCache.set(h, m); }
  const net = walksOf(h), key = from * net.size + to;
  let r = m.get(key);
  if (!r) {
    if (m.size >= KEEP_ROUTES) m.clear();
    r = net.between(from, to);
    m.set(key, r);
  }
  return r;
}

/** Someone's spot at their place: a seeded offset within its spread (θ, s), kept out of the lake unless they swim or stand on the pavilion. */
function spotOf(h: Habitat, place: Venue, i: number, day: number): [number, number] {
  const seed = seedsOf(h).spot, a = TURN * unit(seed, i, day, 0), r = place.spread * Math.sqrt(unit(seed, i, day, 1));
  const ring = Math.max(1, h.profile.at(place.s).r), lake = planOf(h).lake;
  let s = place.s + r * Math.sin(a);
  if (lake && place.activity !== 'swim' && place.kind !== 'landmark' && fromLake(lake, s) < 0) s = besideLake(lake, place.s, r * 0.1);
  return [place.theta + (r * Math.cos(a)) / ring, s];
}

/** Where outing n of a court's day is at clock time t, or null if it is not up on the land then. */
function placeOf(h: Habitat, o: Outings, n: number, court: number, day: number, t: number): Person | null {
  const u = t - o.start[n];
  if (u < 0 || u > o.stay[n]) return null;
  const v = venuesOf(h), place = v.venues[o.venue[n]], i = o.resident[n], who = residentOf(h, i);
  const route = routeOf(h, v.courtVertex[court], place.vertex);
  const [st, ss] = spotOf(h, place, i, day);
  // The last stretch from the paths to the spot, over the land.
  const end = route.points.length - 2, lt = route.points[end], ls = route.points[end + 1];
  const dt = st - lt - TURN * Math.round((st - lt) / TURN), R = h.radius;
  const off = Math.hypot(dt * R, ss - ls), whole = route.length + off;
  const legs = Math.min(whole / who.walk, o.stay[n] / 2);
  const activity: Activity = o.night[n] && place.activity !== 'watch' ? 'stargaze' : place.activity;
  let d: number, back = false;
  if (u < legs) d = u * who.walk;
  else if (u > o.stay[n] - legs) { d = (o.stay[n] - u) * who.walk; back = true; }
  else return { resident: i, theta: st, s: ss, heading: TURN * unit(seedsOf(h).face, i, day, 0), moving: false, speed: 0, activity, court, outing: n };
  if (d <= route.length) {
    const p = pointAlong(route, R, d);
    return { resident: i, theta: p.theta, s: p.s, heading: back ? p.heading + Math.PI : p.heading, moving: true, speed: who.walk, activity: 'walk', court, outing: n };
  }
  const f = (d - route.length) / Math.max(off, 1e-9), heading = Math.atan2(dt * R, ss - ls);
  return { resident: i, theta: lt + dt * f, s: ls + (ss - ls) * f, heading: back ? heading + Math.PI : heading, moving: true, speed: who.walk, activity: 'walk', court, outing: n };
}

function sunwalkThetaAt(p: Float64Array, s: number): number {
  const n = p.length / 2;
  if (s <= p[1]) return p[0];
  if (s >= p[p.length - 1]) return p[p.length - 2];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m * 2 + 1] <= s) lo = m; else hi = m; }
  const t = (s - p[lo * 2 + 1]) / Math.max(p[hi * 2 + 1] - p[lo * 2 + 1], 1e-9), d = p[hi * 2] - p[lo * 2];
  return p[lo * 2] + (d - TURN * Math.round(d / TURN)) * t;
}

/** One day's Sunwalkers, worked out once: who, when they set out, for how long, where and how fast, and their side. */
interface Sunwalkers {
  resident: Int32Array;
  t0: Float64Array;
  span: Float32Array;
  s0: Float64Array;
  speed: Float32Array;
  side: Float32Array;
}

function sunwalkersFrom(h: Habitat, day: number): Sunwalkers {
  const n = censusOf(h).sunwalk, regulars = censusOf(h).regulars, sh = shuffleFor(h, day), seed = seedsOf(h).sunwalk;
  const { length, daylight, peakWidth } = h.params.day, L = h.params.length;
  const { floorStart } = h.profile, z0 = h.profile.at(floorStart).z, width = planOf(h).paths[0]?.width ?? 0;
  const pace = ((1 + 2 * peakWidth) * L) / (daylight * length);
  const w: Sunwalkers = { resident: new Int32Array(n), t0: new Float64Array(n), span: new Float32Array(n), s0: new Float64Array(n), speed: new Float32Array(n), side: new Float32Array(n) };
  for (let j = 0; j < n; j++) {
    const i = regulars + sh.unpermute(j);
    const t0 = day * length + daylight * length * (0.05 + 0.7 * unit(seed, i, day, 0));
    // The bright stretch's middle, in z, moves at a steady pace through the day; walkers keep near it.
    const zMid = -peakWidth * L + pace * (t0 - day * length);
    w.resident[j] = i;
    w.t0[j] = t0;
    w.span[j] = Math.min(stayOf(h, normal(seed, i, day, 1)) * 2.5, day * length + daylight * length - t0);
    w.s0[j] = floorStart + (zMid - z0) + normal(seed, i, day, 2) * 0.35 * peakWidth * L;
    w.speed[j] = pace * (0.85 + 0.3 * unit(seed, i, day, 3));
    w.side[j] = ((unit(seed, i, day, 4) - 0.5) * width) / Math.max(1, h.radius);
  }
  return w;
}

/** Sunwalker tables kept per habitat: today's and yesterday's are all a clock needs. */
const walkerCache = new WeakMap<Habitat, Map<number, Sunwalkers>>();
function sunwalkersOf(h: Habitat, day: number): Sunwalkers {
  let m = walkerCache.get(h);
  if (!m) { m = new Map(); walkerCache.set(h, m); }
  let w = m.get(day);
  if (!w) {
    if (m.size >= 2) m.clear();
    w = sunwalkersFrom(h, day);
    m.set(day, w);
  }
  return w;
}

/** Sunwalker j of a day at clock time t, or null if they are not walking then (or not within `near`). */
function sunwalkerAt(h: Habitat, w: Sunwalkers, j: number, t: number, near?: Near): Person | null {
  const walk = sunwalkOf(h), u = t - w.t0[j];
  if (!walk || u < 0 || u > w.span[j]) return null;
  const s = w.s0[j] + w.speed[j] * u;
  if (s < h.profile.floorStart || s > h.profile.floorEnd || (near && Math.abs(s - near.s) > near.radius)) return null;
  // They keep pace along the axis; where the Sunwalk winds, their way over the floor is longer and they walk faster.
  const theta = sunwalkThetaAt(walk, s), turn = (sunwalkThetaAt(walk, s + 1) - sunwalkThetaAt(walk, s - 1)) / 2;
  const across = h.radius * (turn - TURN * Math.round(turn / TURN));
  return { resident: w.resident[j], theta: theta + w.side[j], s, heading: Math.atan2(across, 1), moving: true, speed: w.speed[j] * Math.hypot(1, across), activity: 'sunwalk', court: -1, outing: j };
}

/** An area to look in: around (θ, s) out to `radius` m over the floor. */
export interface Near {
  theta: number;
  s: number;
  radius: number;
}

/**
 * Everyone up on the land at clock time t (s), or only those within an area. Each court's day is made once and kept
 * (a bounded number), routes too; asking for an area looks only at the courts whose people can reach it.
 */
export function peopleAt(h: Habitat, t: number, near?: Near): Person[] {
  const out: Person[] = [], v = venuesOf(h), c = censusOf(h), R = h.radius;
  if (!v.courts.length || !c.residents) return out;
  const day = Math.floor(t / h.params.day.length);
  const inArea = (theta: number, s: number, extra: number): boolean => !near || floorGap(R, near.theta, near.s, theta, s) <= near.radius + extra;
  for (let court = 0; court < v.courts.length; court++) {
    const site = v.courts[court];
    if (!inArea(site.theta, site.s, v.reach[court])) continue;
    const o = outingsOf(h, day, court);
    for (let n = 0; n < o.resident.length; n++) {
      const p = placeOf(h, o, n, court, day, t);
      if (p && inArea(p.theta, p.s, 0)) out.push(p);
    }
  }
  const w = sunwalkersOf(h, day);
  for (let j = 0; j < c.sunwalk; j++) {
    const p = sunwalkerAt(h, w, j, t, near);
    if (p && inArea(p.theta, p.s, 0)) out.push(p);
  }
  return out;
}

/**
 * Someone found by `peopleAt` (their court and outing), at another clock time of the same day: where they are now, or
 * null once they have gone below. Cheap enough to ask for everyone in view every frame.
 */
export function whereIs(h: Habitat, t: number, who: Pick<Person, 'court' | 'outing'>): Person | null {
  const day = Math.floor(t / h.params.day.length);
  if (who.court < 0) return who.outing < censusOf(h).sunwalk ? sunwalkerAt(h, sunwalkersOf(h, day), who.outing, t) : null;
  const o = outingsOf(h, day, who.court);
  return who.outing < o.resident.length ? placeOf(h, o, who.outing, who.court, day, t) : null;
}

/** The busiest spot within an area at clock time t: the middle of the `cell`-metre square of floor with the most people. */
export function busiestNear(h: Habitat, t: number, near: Near, cell = 20): { theta: number; s: number; count: number } | null {
  const R = h.radius, counts = new Map<string, { n: number; theta: number; s: number }>();
  let best: { n: number; theta: number; s: number } | null = null;
  for (const p of peopleAt(h, t, near)) {
    // Squares on the unrolled floor around the area's middle, so θ wraps nowhere inside it.
    const d = p.theta - near.theta, x = Math.floor(((d - TURN * Math.round(d / TURN)) * R) / cell), y = Math.floor((p.s - near.s) / cell);
    const key = `${x},${y}`, c = counts.get(key) ?? { n: 0, theta: near.theta + ((x + 0.5) * cell) / R, s: near.s + (y + 0.5) * cell };
    c.n++;
    counts.set(key, c);
    if (!best || c.n > best.n) best = c;
  }
  return best && { theta: best.theta, s: best.s, count: best.n };
}
