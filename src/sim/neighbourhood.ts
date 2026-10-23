/** First neighbourhood routines: home frontages, the walks beside the pillars, and hall frontages.
 * Seed + clock, existing resident IDs; no agent per inhabitant. Surface travellers keep their surface schedule.
 * Only nearby hamlets are generated; geometry, routes and the day's roster share a bounded, shed-able cache. */
import { deriveSeed } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { homePlan, homeUseAt } from '../gen/homeInterior';
import { floorAt, inFloorFrame, type FloorFrame } from '../gen/shapes';
import type { House } from '../gen/homes';
import { doorToward, WALK } from '../gen/homes';
import { hallAt, type HallKind } from '../gen/halls';
import { baysOfHamlet, underOf } from '../gen/under';
import { bayFrame, underFloorAt, underHousesIn, underPlinth, underLiftOf } from '../gen/underMesh';
import type { Terrain } from '../gen/terrain';
import { kept } from '../gen/kept';
import { floorGap, pointAlong, routeThrough, type Route } from './walks';
import { residentOf, stayingBelow, unit, type Near, type Person } from './population';

interface Front { theta: number; s: number; node: number; kind: HallKind | 'home' | 'lift'; house?: House; frame?: FloorFrame }
interface Neighbourhood {
  homes: Front[];
  halls: Front[];
  points: number[];
  links: number[][];
  routes: Map<string, Route | null>;
  paths: Map<number, Int32Array>;
  day: number;
  residents: number[];
  household: Map<number, number[]>;
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
  const out: Neighbourhood = { homes: [], halls: [], points: [], links: [], routes: new Map(), paths: new Map(), day: NaN, residents: [], household: new Map(), bytes: 0 };
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
    if (u.useAt(i, j) === 'home') for (const house of underHousesIn(t, i, j).houses) if (house.lived) {
      const p = homePlan(house, hr);
      out.homes.push({ ...front(p.doorX, 'home'), house, frame: bayFrame(u, i, j) });
    }
  }
  for (const { i, j } of bays) {
    const a = nodes.get(u.key(i, j))!, across = nodes.get(u.key(i + 1, j)), along = nodes.get(u.key(i, j + 1));
    if (across !== undefined) { link(a + 2, across + 1); link(a + 3, across); }
    if (along !== undefined) { link(a + 1, along); link(a + 2, along + 3); }
  }
  out.bytes = out.points.length * 8 + out.links.reduce((n, a) => n + 32 + a.length * 8, 0) + out.homes.length * 512 + out.halls.length * 64;
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
    n.household.clear();
    for (const id of n.residents) {
      const home = Math.min(n.homes.length - 1, Math.floor(unit(seedOf(t.habitat), id, 0, 0) * n.homes.length));
      const members = n.household.get(home) ?? [];
      if (members.length < 2) { members.push(id); n.household.set(home, members); }
    }
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
    const pts: number[] = [];
    if (a.house && a.frame) {
      const p = homePlan(a.house, h.params.landmarks?.handrail ?? 1);
      for (const [x, y] of [p.resident, [p.doorX, p.resident[1]], [p.doorX, p.doorY]]) {
        const at = floorAt(h, a.frame, x, y); pts.push(at.theta, at.s);
      }
    }
    pts.push(a.theta, a.s);
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
  const homeFront = n.homes[home], house = homeFront.house!, hr = h.params.landmarks?.handrail ?? 1;
  const plan = homePlan(house, hr), slot = n.household.get(home)?.indexOf(id) ?? -1;
  const homeOffset = Math.max(0, slot) * Math.min(hr * 1.9, (plan.room.y1 - plan.room.y0) * 0.3);
  const whole = homeOffset + route.length + Math.abs(offsetS), walk = whole / who.walk;
  const pause = h.params.life.pause * (0.15 + 0.4 * unit(seed, id, trip, 3)), duration = 2 * walk + pause;
  const atHome = (): Person | null => {
    if (slot < 0) return null;
    const p = floorAt(h, homeFront.frame!, plan.resident[0], plan.resident[1] + homeOffset);
    const mode = homeUseAt(house, clock, h.params.life.pause);
    return atHomeActivity({ ...p, below: true, interiorFloor: house.base, gathering: house.seed, resident: id, court: who.home, outing: id, member: slot, size: n.household.get(home)!.length,
      heading: slot ? -Math.PI / 2 : Math.PI / 2, moving: false, speed: 0,
      activity: 'sit', act: 'quiet', posture: 0, from: 0, since: phase }, mode);
  };
  // At home between trips, and at either side of midnight: no incomplete trip when a day's surface roster changes.
  const start = clock - phase, end = start + duration;
  if (duration >= period || phase > duration || start < day * h.params.day.length || end >= (day + 1) * h.params.day.length) return atHome();
  const back = phase > walk + pause, moving = phase < walk || back;
  const distance = back ? (duration - phase) * who.walk : Math.min(whole, phase * who.walk);
  const along = Math.max(0, distance - homeOffset), at = pointAlong(route, h.radius, along);
  if (distance < homeOffset) { at.theta += (homeOffset - distance) / h.radius; at.heading = -Math.PI / 2; }
  if (along > route.length) { at.s += Math.sign(offsetS) * (along - route.length); at.heading = offsetS >= 0 ? 0 : Math.PI; }
  return {
    ...at, below: true,
    interiorFloor: (() => {
      const [x, y] = inFloorFrame(h, homeFront.frame!, at.theta, at.s), b = house.body;
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return house.base;
      const plan = homePlan(house, hr), outside = (y - plan.doorY) * house.door;
      if (Math.abs(x - plan.doorX) > plan.doorWidth / 2 || outside < 0) return undefined;
      const ground = underFloorAt(t, at.theta, at.s), rise = Math.max(0, house.base - ground);
      const depth = Math.ceil(rise / (hr * 0.16)) * hr * 0.28 + hr * 0.15;
      return outside < depth ? ground + rise * (1 - outside / depth) : undefined;
    })(), resident: id, court: who.home, outing: id, member: 0, size: 1,
    heading: at.heading + (back ? Math.PI : 0), moving, speed: moving ? who.walk : 0,
    activity: moving ? 'walk' : 'meet', act: moving ? 'walk' : 'look', posture: 0, from: 0, since: moving ? 1e6 : phase - walk,
  };
}

/** Room intent changes the activity without changing a resident's identity, route or place. */
export function atHomeActivity(p: Person, mode: import('../gen/homeInterior').HomeMode): Person {
  return { ...p, activity: mode === 'gather' ? 'meet' : 'sit', act: mode === 'gather' ? 'talk' : mode === 'clear' ? 'stretch' : 'quiet' };
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
