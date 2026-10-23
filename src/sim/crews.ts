/**
 * Who sails the boats (Arnd 2026-10-23: sail boats on the lakes and the ring lake; residents sail them, silently): each
 * boat of the fleet (gen/harbours.ts) has its own crew, the same residents every time, as many as its design takes
 * (`BoatSpec.crew`). They live under the court nearest its harbour, and are the last residents of the population
 * (`crewsOf(h).first` on): the outings of the land never deal them out, and on a day their boat stays in they stay
 * below. A pure function of the seed and the clock, like everyone else (sim/population.ts).
 *
 * A day their boat goes out (`outingOf`, sim/sailing.ts), they come up out of their court's lift together, walk the
 * paths to the harbour, out along its pier and its pontoon to their berth, and step aboard over the stern, the last of
 * them `SETTLE` before it casts off; each takes their place aboard (`seatsOf`, gen/boat.ts): in the cockpit or on the
 * trampolines on its drive, hiked out to windward under sail (crossing over as it goes about). Back in its berth, they
 * step off `SETTLE` after it is moored and walk home. A boat at a mooring buoy has its crew aboard while it is out.
 *
 * Aboard, someone is where their place is as the boat is now: its heel lifts the windward side, a foiler's foils lift
 * them all (`deck`); they go with the boat (`drift`, its way over the water), and the view draws them on the boat as it
 * is drawn (render/people.ts asks the boats' view). Pure.
 */
import { angleDiff, deriveSeed } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { kept } from '../gen/kept';
import { BOAT_KINDS, seatsOf } from '../gen/boat';
import { HARBOUR, basinPoint, fleetOf, type Boat } from '../gen/harbours';
import { landingOf } from '../gen/harbourBuild';
import { floorAt } from '../gen/shapes';
import { POSE } from '../gen/standIn';
import { boatAt, outingOf, type BoatState } from './sailing';
import { venuesOf } from './venues';
import { floorGap, pointAlong, routeThrough, walksOf, type Route } from './walks';
import { residentOf, unit, walkSlot, wayOf, type Near, type Person } from './population';

/** A boat's crew: residents `first` … `first + size − 1`, living under court `court`. */
export interface Crew {
  boat: number;
  first: number;
  size: number;
  court: number;
}

export interface Crews {
  crews: readonly Crew[];
  /** The first crew member's resident id; how many sail. */
  first: number;
  sailors: number;
  /** Each court's crews (indices into `crews`). */
  byCourt: readonly (readonly number[])[];
}

/** How long before it casts off the last of its crew is aboard, and after it is moored they step off (s). */
export const SETTLE = 120;
/** Of the residents who keep no rhythm, at most this share crew the boats (a habitat too small to spare them sails none). */
const SPARE = 0.5;

/** The crews of a habitat's boats, made once. */
export const crewsOf: (h: Habitat) => Crews = kept((h: Habitat): Crews => {
  const fleet = fleetOf(h), courts = venuesOf(h).courts, N = Math.max(0, Math.floor(h.params.population)), seed = deriveSeed(h.seed, 'life', 'crew');
  const sizes = fleet.boats.map((b) => {
    const [lo, hi] = BOAT_KINDS[b.kind].crew;
    // Mostly the few it takes to sail it; a big boat sometimes a crowd of friends.
    return lo + Math.min(hi - lo, Math.floor((hi - lo + 1) * Math.pow(unit(seed, b.id, 0, 0), hi - lo > 2 ? 2 : 1)));
  });
  const sailors = sizes.reduce((a, n) => a + n, 0);
  if (!courts.length || sailors > (N - Math.round(N * h.params.life.regulars)) * SPARE) return { crews: [], first: N, sailors: 0, byCourt: courts.map(() => []) };
  const first = N - sailors, crews: Crew[] = [], byCourt: number[][] = courts.map(() => []);
  let at = first;
  fleet.boats.forEach((b, i) => {
    // Home: the court nearest where the boat lies.
    const p = homeOf(h, b);
    let court = 0, best = Infinity;
    courts.forEach((c, k) => { const d = floorGap(h.radius, c.theta, c.s, p.theta, p.s); if (d < best) { best = d; court = k; } });
    byCourt[court].push(crews.length);
    crews.push({ boat: b.id, first: at, size: sizes[i], court });
    at += sizes[i];
  });
  return { crews, first, sailors, byCourt };
});

/** Where a boat lies when it is in (its harbour's landing, or its buoy), on the floor. */
function homeOf(h: Habitat, b: Boat): { theta: number; s: number } {
  const fleet = fleetOf(h);
  if (b.harbour < 0) return basinPoint(fleet.basins[b.basin], b.home.u, b.home.v);
  const hb = fleet.harbours[b.harbour];
  return floorAt(h, hb.frame, landingOf(hb), 0);
}

/** A boat's crew, or null (its habitat has none). */
export const crewOf = (h: Habitat, boat: number): Crew | null => crewsOf(h).crews[boat] ?? null;

/** The crew a resident sails in, or null. */
export function crewOfResident(h: Habitat, i: number): Crew | null {
  const c = crewsOf(h);
  if (i < c.first || i >= c.first + c.sailors) return null;
  let lo = 0, hi = c.crews.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.crews[m].first <= i) lo = m; else hi = m - 1; }
  return c.crews[lo];
}

/** A crew's pace: its slowest walker's (m/s). */
const paces = kept((_h: Habitat) => new Map<number, number>());
function paceOf(h: Habitat, crew: Crew): number {
  const m = paces(h);
  let p = m.get(crew.boat);
  if (p === undefined) {
    p = Infinity;
    for (let k = 0; k < crew.size; k++) p = Math.min(p, residentOf(h, crew.first + k).walk);
    m.set(crew.boat, p);
  }
  return p;
}

/**
 * The way from a crew's court to their boat's berth: out of the court and along the paths to the point of them nearest
 * the harbour's landing, over the land onto it, out along the pier, along the pontoon to the berth and across to the
 * boat's stern. Kept per terrain (or habitat, without one).
 */
const routes = new WeakMap<object, Map<number, Route>>();
export function crewRoute(h: Habitat, ground: Terrain | undefined, crew: Crew): Route | null {
  const fleet = fleetOf(h), boat = fleet.boats[crew.boat];
  if (boat.harbour < 0) return null;
  const owner: object = ground ?? h;
  let m = routes.get(owner);
  if (!m) { m = new Map(); routes.set(owner, m); }
  let r = m.get(crew.boat);
  if (!r) {
    const hb = fleet.harbours[boat.harbour], hr = hb.handrail, berth = hb.berths.find((b) => b.boat === boat.id)!;
    const mid = hb.pontoon + (HARBOUR.pontoon * hr) / 2, stern = hb.pontoon + HARBOUR.pontoon * hr - 0.3 * hr;
    const along = [[landingOf(hb) - hr, 0], [0, 0], [hb.pontoon, 0], [mid, 0], [mid, berth.y], [stern, berth.y]].map(([x, y]) => floorAt(h, hb.frame, x, y));
    const net = walksOf(h), v = net.vertexNear(along[0].theta, along[0].s), paths = wayOf(h, ground, crew.court, v, null).points;
    const out = new Float64Array(paths.length + along.length * 2);
    out.set(paths);
    let last = paths.length ? paths[paths.length - 2] : along[0].theta;
    along.forEach((p, k) => {
      const theta = last + angleDiff(0, p.theta - last);
      out[paths.length + k * 2] = theta; out[paths.length + k * 2 + 1] = p.s;
      last = theta;
    });
    r = routeThrough(h, out);
    m.set(crew.boat, r);
  }
  return r;
}

/** Bytes the crews' routes hold for a habitat (and its terrain), for the memory watchdog. */
export function crewBytes(h: Habitat, ground?: Terrain): number {
  let n = 0;
  for (const owner of [h, ground]) for (const r of (owner && routes.get(owner)?.values()) || []) n += r.points.byteLength + r.along.byteLength;
  return n;
}

/** When a crew's day on the water begins and ends (their first leaves their court, their last is home), or null on a day their boat stays in. */
export function crewWindow(h: Habitat, crew: Crew, day: number, ground?: Terrain): { start: number; end: number } | null {
  const o = outingOf(h, fleetOf(h).boats[crew.boat], day);
  if (!o) return null;
  const r = crewRoute(h, ground, crew), pace = paceOf(h, crew), walk = r ? (r.length + walkSlot(crew.size - 1, crew.size)[1]) / pace : 0;
  return { start: o.start - (r ? SETTLE + walk : 0), end: o.end + (r ? SETTLE + walk : 0) };
}

/**
 * Member `member` of a crew at clock time t: on their way to the boat or home, or aboard; null when they are not up
 * (their boat stays in, or they are not yet come or already gone). `state`: the boat's, if it is known already.
 */
export function crewMemberAt(h: Habitat, t: number, crew: Crew, member: number, ground?: Terrain, state?: BoatState): Person | null {
  const day = Math.floor(t / h.params.day.length), boat = fleetOf(h).boats[crew.boat], o = outingOf(h, boat, day);
  if (!o || member >= crew.size) return null;
  const route = crewRoute(h, ground, crew), i = crew.first + member, size = crew.size;
  const base: Crewed = { resident: i, activity: 'sail', court: crew.court, outing: member, member, size, boat: crew.boat };
  if (!route) return t >= o.start && t < o.end ? aboard(h, t, crew, member, base, t - o.start, state) : null;
  const pace = paceOf(h, crew), [across, behind] = walkSlot(member, size), last = walkSlot(size - 1, size)[1];
  const board = o.start - SETTLE, leave = board - (route.length + last) / pace, off = o.end + SETTLE;
  const there = leave + (route.length + behind) / pace, goes = off + behind / pace;
  if (t < leave || t > goes + route.length / pace) return null;
  if (t >= there && t < goes) return aboard(h, t, crew, member, base, t - there, state);
  // On the way: out along the route, or home along it (each on their own side of the way they walk).
  const back = t >= goes, d = back ? route.length - (t - goes) * pace : (t - leave) * pace - behind;
  const p = pointAlong(route, h.radius, Math.max(0, Math.min(route.length, d))), side = back ? -across : across;
  return {
    ...base, theta: p.theta + (side * Math.cos(p.heading)) / h.radius, s: p.s - side * Math.sin(p.heading), heading: back ? p.heading + Math.PI : p.heading,
    moving: d > 0 && d < route.length, speed: pace, act: 'walk', posture: POSE.upright, from: POSE.upright, since: 1e6,
  };
}

/** Who someone of a crew is, wherever they are. */
type Crewed = Pick<Person, 'resident' | 'activity' | 'court' | 'outing' | 'member' | 'size' | 'boat'>;

/** Someone aboard their boat at its place for them, as the boat is at t; `since` they came aboard (s). */
function aboard(h: Habitat, t: number, crew: Crew, member: number, base: Crewed, since: number, state?: BoatState): Person {
  const boat = fleetOf(h).boats[crew.boat], b = state ?? boatAt(h, boat, t), spec = BOAT_KINDS[boat.kind], seats = seatsOf(boat.kind);
  // Under sail (not going about), hiked out to windward where the design does; at rest, on its drive or going about, in their place inboard.
  const hiking = b.sailing && !b.motoring && !b.turning && seats.sailing !== seats.still;
  const seat = (hiking ? seats.sailing : seats.still)[member], side = hiking ? -b.tack : 1;
  const x = seat.x * side, facing = seat.facing * side, roll = -b.tack * b.heel, lift = b.foiling && spec.foil ? spec.foil.lift : 0;
  const c = Math.cos(b.heading), sn = Math.sin(b.heading);
  const around = sn * seat.z + c * x, along = c * seat.z - sn * x;
  return {
    ...base, theta: b.theta + around / h.radius, s: b.s + along, heading: b.heading + facing, moving: false, speed: b.speed,
    act: 'quiet', posture: seat.pose, from: POSE.upright, since,
    seat: [x, seat.y, seat.z], facing, deck: b.level + x * Math.sin(roll) + seat.y * Math.cos(roll) + lift, drift: b.astern ? b.heading + Math.PI : b.heading,
  };
}

/** The crews out on a day and when (`crewWindow`), kept for the last two days asked per terrain (or habitat). */
const days = new WeakMap<object, Map<number, { crew: Crew; start: number; end: number }[]>>();
function outOn(h: Habitat, day: number, ground?: Terrain): { crew: Crew; start: number; end: number }[] {
  const owner: object = ground ?? h;
  let m = days.get(owner);
  if (!m) { m = new Map(); days.set(owner, m); }
  let out = m.get(day);
  if (!out) {
    if (m.size >= 2) m.clear();
    out = [];
    for (const crew of crewsOf(h).crews) { const w = crewWindow(h, crew, day, ground); if (w) out.push({ crew, ...w }); }
    m.set(day, out);
  }
  return out;
}

/** Everyone of the crews up at clock time t (within `near`, if given). */
export function crewsAt(h: Habitat, t: number, near?: Near, ground?: Terrain): Person[] {
  const out: Person[] = [], day = Math.floor(t / h.params.day.length), R = h.radius;
  for (const { crew, start, end } of outOn(h, day, ground)) {
    if (t < start || t > end) continue;
    let state: BoatState | undefined;
    for (let m = 0; m < crew.size; m++) {
      const p = crewMemberAt(h, t, crew, m, ground, state);
      if (!p) continue;
      if (p.boat !== undefined && p.seat && !state) state = boatAt(h, fleetOf(h).boats[crew.boat], t);
      if (!near || floorGap(R, near.theta, near.s, p.theta, p.s) <= near.radius) out.push(p);
    }
  }
  return out;
}

/** Residents of a court's crews who spend a day below: those whose boat stays in. */
export function crewsBelow(h: Habitat, day: number, court: number): number[] {
  const c = crewsOf(h), out: number[] = [];
  for (const k of c.byCourt[court] ?? []) {
    const crew = c.crews[k];
    if (outingOf(h, fleetOf(h).boats[crew.boat], day)) continue;
    for (let m = 0; m < crew.size; m++) out.push(crew.first + m);
  }
  return out;
}
