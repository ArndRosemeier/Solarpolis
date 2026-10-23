/** First neighbourhood routines: home frontages, the walks beside the pillars, and hall frontages.
 * Seed + clock, existing resident IDs; no agent per inhabitant. Surface travellers keep their surface schedule.
 * Only nearby hamlets are generated; geometry, routes and the day's roster share a bounded, shed-able cache. */
import { deriveSeed } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { doorToward, WALK } from '../gen/homes';
import { hallAt, type HallKind } from '../gen/halls';
import { baysOfHamlet, underOf } from '../gen/under';
import { underHousesIn, underPlinth, underLiftOf } from '../gen/underMesh';
import type { Terrain } from '../gen/terrain';
import { kept } from '../gen/kept';
import { floorGap, pointAlong, routeThrough, type Route } from './walks';
import { residentOf, stayingBelow, unit, type Near, type Person } from './population';

interface Front { theta: number; s: number; node: number; kind: HallKind | 'home' | 'lift' }
interface Neighbourhood {
  homes: Front[];
  halls: Front[];
  points: number[];
  links: number[][];
  routes: Map<string, Route | null>;
  paths: Map<number, Int32Array>;
  day: number;
  residents: number[];
  bytes: number;
}
const MAX_BYTES = 8 * 1024 * 1024;
const cache = new WeakMap<Terrain, Map<number, Neighbourhood>>();
const seedOf = kept((h: Habitat) => deriveSeed(h.seed, 'neighbourhood'));
/** Includes estimates for JS arrays and map entries, as well as route buffers. */
export function neighbourhoodBytes(t: Terrain): number {
  let n = 0;
  for (const m of cache.get(t)?.values() ?? []) n += m.bytes;
  return n;
}
export function shedNeighbourhoods(t: Terrain): void { cache.delete(t); }

/** Four inset corners per bay: perimeter walks stay outside houses, halls and the pillars' plinths.
 * Across a bay boundary the short joins keep the same clearance from its pillar. No diagonal cuts. */
function makeNeighbourhood(t: Terrain, court: number): Neighbourhood {
  const h = t.habitat, u = underOf(h), m = u.hamlets[court];
  const out: Neighbourhood = { homes: [], halls: [], points: [], links: [], routes: new Map(), paths: new Map(), day: NaN, residents: [], bytes: 0 };
  if (!m || !h.params.landmarks) return out;
  const hr = h.params.landmarks.handrail, inset = underPlinth(h) + WALK * hr / 2, width = u.dTheta * h.radius;
  if (2 * inset >= Math.min(u.bay, width)) return out;
  const lift = underLiftOf(t, court);
  const nodes = new Map<number, number>();
  const link = (a: number, b: number): void => { out.links[a].push(b); out.links[b].push(a); };
  const bays = [...baysOfHamlet(u, m, Math.ceil(m.edge * 1.3) + 1)].filter(({ i, j }) => j >= 0 && j < u.along && u.useAt(i, j) !== 'cistern');
  for (const { i, j } of bays) {
    const first = out.links.length, c = u.centreOf(i, j), lowS = c.s - u.bay / 2, lowT = c.theta - u.dTheta / 2;
    nodes.set(u.key(i, j), first);
    for (const [x, y] of [[inset, inset], [u.bay - inset, inset], [u.bay - inset, width - inset], [inset, width - inset]]) {
      out.points.push(lowT + y / h.radius, lowS + x); out.links.push([]);
    }
    for (let q = 0; q < 4; q++) link(first + q, first + (q + 1) % 4);
    const toward = doorToward(u, m, i), y = toward > 0 ? width - inset : inset;
    const front = (x: number, kind: Front['kind']): Front => ({ theta: lowT + y / h.radius, s: lowS + x, node: first + (toward > 0 ? (x < u.bay / 2 ? 3 : 2) : (x < u.bay / 2 ? 0 : 1)), kind });
    const kind = lift && u.key(lift.i, lift.j) === u.key(i, j) ? 'lift' : hallAt(h, i, j);
    if (kind) out.halls.push(front(u.bay / 2, kind));
    if (u.useAt(i, j) === 'home') for (const house of underHousesIn(t, i, j).houses) if (house.lived) out.homes.push(front((house.plot.x0 + house.plot.x1) / 2, 'home'));
  }
  for (const { i, j } of bays) {
    const a = nodes.get(u.key(i, j))!, across = nodes.get(u.key(i + 1, j)), along = nodes.get(u.key(i, j + 1));
    if (across !== undefined) { link(a + 2, across + 1); link(a + 3, across); }
    if (along !== undefined) { link(a + 1, along); link(a + 2, along + 3); }
  }
  out.bytes = out.points.length * 8 + out.links.reduce((n, a) => n + 32 + a.length * 8, 0) + (out.homes.length + out.halls.length) * 64;
  return out;
}

function neighbourhoodOf(t: Terrain, court: number, day: number): Neighbourhood {
  let all = cache.get(t);
  if (!all) { all = new Map(); cache.set(t, all); }
  let n = all.get(court);
  if (!n) {
    n = makeNeighbourhood(t, court);
    while (all.size && neighbourhoodBytes(t) + n.bytes > MAX_BYTES) all.delete(all.keys().next().value!);
    all.set(court, n);
  }
  if (n.day !== day) {
    n.bytes -= n.residents.length * 8;
    n.residents = stayingBelow(t.habitat, day, court);
    n.bytes += n.residents.length * 8;
    n.day = day;
  }
  return n;
}

/** A frontage-to-frontage route, or null if the dry walks do not connect (never cut through a cistern). */
function routeOf(h: Habitat, n: Neighbourhood, home: number, hall: number): Route | null {
  const key = `${home}/${hall}`;
  if (n.routes.has(key)) return n.routes.get(key)!;
  const a = n.homes[home], b = n.halls[hall];
  let previous = n.paths.get(b.node);
  if (!previous) {
    previous = new Int32Array(n.links.length).fill(-1);
    const queue = [b.node];
    previous[b.node] = b.node;
    for (let k = 0; k < queue.length; k++) for (const v of n.links[queue[k]]) if (previous[v] < 0) { previous[v] = queue[k]; queue.push(v); }
    if (n.bytes < MAX_BYTES / 8) { n.paths.set(b.node, previous); n.bytes += previous.byteLength + 48; }
  }
  let route: Route | null = null;
  if (previous[a.node] >= 0) {
    const chain = [a.node];
    while (chain[chain.length - 1] !== b.node) chain.push(previous[chain[chain.length - 1]]);
    const pts = [a.theta, a.s];
    for (const v of chain) {
      const last = pts[pts.length - 2], theta = n.points[2 * v];
      pts.push(theta + 2 * Math.PI * Math.round((last - theta) / (2 * Math.PI)), n.points[2 * v + 1]);
    }
    pts.push(b.theta + 2 * Math.PI * Math.round((pts[pts.length - 2] - b.theta) / (2 * Math.PI)), b.s);
    route = routeThrough(h, Float64Array.from(pts));
  }
  // Routes can always be rebuilt; retain at most a small share of the total budget in each hamlet.
  if (n.bytes < MAX_BYTES / 8) { n.routes.set(key, route); n.bytes += 64 + (route ? route.points.byteLength + route.along.byteLength : 0); }
  return route;
}

/** A resident's stable home, chosen hall and clock phase. Only the active trip is materialized. */
function placeOf(t: Terrain, n: Neighbourhood, id: number, clock: number): Person | null {
  if (!n.homes.length || !n.halls.length) return null;
  const h = t.habitat, who = residentOf(h, id), seed = seedOf(h), day = Math.floor(clock / h.params.day.length);
  const home = Math.min(n.homes.length - 1, Math.floor(unit(seed, id, 0, 0) * n.homes.length));
  const period = h.params.life.stay, offset = unit(seed, id, 1, 0) * period, trip = Math.floor((clock + offset) / period);
  const phase = clock + offset - trip * period;
  const hall = Math.min(n.halls.length - 1, Math.floor(unit(seed, id, trip, 2) * n.halls.length));
  const route = routeOf(h, n, home, hall);
  if (!route || !route.length) return null;
  const offsetS = (unit(seed, id, trip, 4) - 0.5) * h.params.under.bay * 0.45;
  const whole = route.length + Math.abs(offsetS), walk = whole / who.walk;
  const pause = h.params.life.pause * (0.15 + 0.4 * unit(seed, id, trip, 3)), duration = 2 * walk + pause;
  // At home between trips, and at either side of midnight: no incomplete trip when a day's surface roster changes.
  const start = clock - phase, end = start + duration;
  if (duration >= period || phase > duration || start < day * h.params.day.length || end >= (day + 1) * h.params.day.length) return null;
  const back = phase > walk + pause, moving = phase < walk || back;
  const distance = back ? (duration - phase) * who.walk : Math.min(whole, phase * who.walk);
  const at = pointAlong(route, h.radius, distance);
  if (distance > route.length) { at.s += Math.sign(offsetS) * (distance - route.length); at.heading = offsetS >= 0 ? 0 : Math.PI; }
  return {
    ...at, below: true, resident: id, court: who.home, outing: id, member: 0, size: 1,
    heading: at.heading + (back ? Math.PI : 0), moving, speed: moving ? who.walk : 0,
    activity: moving ? 'walk' : 'meet', act: moving ? 'walk' : 'look', posture: 0, from: 0, since: moving ? 1e6 : phase - walk,
  };
}

export function neighboursAt(t: Terrain, clock: number, near: Near): Person[] {
  const h = t.habitat, out: Person[] = [], day = Math.floor(clock / h.params.day.length);
  for (const m of underOf(h).hamlets) {
    if (floorGap(h.radius, near.theta, near.s, m.site.theta, m.site.s) > near.radius + m.edge * 1.3 * h.params.under.bay) continue;
    const n = neighbourhoodOf(t, m.court, day);
    for (const id of n.residents) { const p = placeOf(t, n, id, clock); if (p && floorGap(h.radius, near.theta, near.s, p.theta, p.s) <= near.radius) out.push(p); }
  }
  return out;
}

export function neighbourAt(t: Terrain, clock: number, p: Person): Person | null {
  const n = neighbourhoodOf(t, p.court, Math.floor(clock / t.habitat.params.day.length));
  return n.residents.includes(p.resident) ? placeOf(t, n, p.resident, clock) : null;
}
