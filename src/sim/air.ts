/**
 * The drones that work the land (design "Who is out on the land": couriers, tenders, surveyors, lifters, gliders,
 * guardians and the Mind's watchers; how many: `HabitatParams.life.drones`), and where each is at any moment: a pure function of the habitat's
 * seed, its land and the clock. Nobody steers them; anyone can be worked out on their own.
 *
 * Every drone has a job at a place, made once per terrain (`fleetOf`), and its job says how it moves:
 *
 *   round    a courier: up from its pad beside its court, along the ways (the walk net) at the lane's height to a place
 *            near the court, down for a stop, back the same way, and a rest on the pad until the next round;
 *   roam     tenders over their orchard block or vine parcel, lifters at the makers' commons, guardians over the lake,
 *            watchers over the places people go:
 *            a while at work hovering low at one spot, then a short hop to the next;
 *   orbit    surveyors over the reserve and the Mountain, guardians off the flight launch: wide slow circles;
 *   shuttle  the Gate's lifters: up the Gate's face to near the hub and back down to its foot with a load;
 *   drift    gliders: round the axis near it, slowly, in the thin air, swinging along it.
 *
 * Heights are over the ground (or the water) under them, except a glider's, which is its distance from the axis. Pure.
 */
import { deriveSeed, hash3i } from '@futuremagic/core';
import { kept } from '../gen/kept';
import { planOf, siteOf } from '../gen/plan';
import { VINE_TOP, placesOf } from '../gen/places';
import type { Terrain } from '../gen/terrain';
import { DRONE_ROLES, type DroneRole, type Habitat } from '../blueprint';
import { floorGap, pointAlong, type Route } from './walks';
import { routeOf, unit } from './population';
import { venuesOf } from './venues';

const TURN = 2 * Math.PI;

export type Role = DroneRole;
export const ROLES: readonly Role[] = DRONE_ROLES;

type Move = 'round' | 'roam' | 'orbit' | 'shuttle' | 'drift';

/** A drone's job: the same every time. */
export interface Job {
  role: Role;
  /** Which of its role's designs it is (0 … `drones.designs` − 1). */
  design: number;
  move: Move;
  /** Where: the middle of its area (round: its pad; shuttle: the foot; drift: where along the axis it swings about). */
  theta: number;
  s: number;
  /** How far it goes from there (m): around the axis and along it (shuttle: `along` up the face; drift: its swing). */
  around: number;
  along: number;
  /** How high it flies (m over the ground; drift: its distance from the axis). */
  height: number;
  /** How fast it goes (m/s). */
  speed: number;
  /** A courier's court (index into `venuesOf(h).courts`), else −1. */
  court: number;
  /** Its own seed: its timing and its spots. */
  seed: number;
}

/** What a drone is doing. */
export type Doing = 'fly' | 'work' | 'rest';

/** A drone at a moment. */
export interface Flier {
  /** Its index in the fleet: the same drone every time. */
  id: number;
  role: Role;
  design: number;
  theta: number;
  s: number;
  /** Height of its lowest point over the profile (m). */
  h: number;
  /** The way it faces over the floor (radians: 0 toward the port end, +π/2 spinward), as people's heading. */
  heading: number;
  /** How fast it goes over the floor (m/s) and climbs (m/s, up positive). */
  speed: number;
  climb: number;
  doing: Doing;
}

/** How fast drones climb and sink (m/s), how high they work (m over the ground) and hop between spots. */
const CLIMB = 3;
const WORK_HEIGHT = 3;
const HOP_HEIGHT = 7;
/** How high a watcher hangs over the people it watches (m over the ground): above their heads, below the trees. */
const WATCH_HEIGHT = 6;
/** A roamer's beat (s): at work at least this long at a spot, then the hop to the next (at least this long). */
const BEAT = { work: 30, hop: 6 } as const;
/** A courier's stop at the place it flew to (s). */
const STOP = 90;

/** The short way from one angle to another. */
const turnTo = (d: number): number => d - TURN * Math.round(d / TURN);

/** The habitat's drones, each with its job (made once per terrain). */
export const fleetOf: (t: Terrain) => readonly Job[] = kept(makeFleet);

function makeFleet(t: Terrain): Job[] {
  const h = t.habitat, d = h.params.life.drones, { profile } = h, R = h.radius, plan = planOf(h), v = venuesOf(h);
  const seed = deriveSeed(h.seed, 'life', 'drones'), jobs: Job[] = [];
  const add = (role: Role, job: Omit<Job, 'role' | 'design' | 'seed'>): void => {
    const n = jobs.length, s = hash3i(seed, n, 1, 0);
    jobs.push({ role, design: Math.min(d.designs - 1, Math.floor(unit(seed, n, 2, 0) * d.designs)), seed: s, ...job });
  };
  const ring = (s: number): number => Math.max(1, profile.at(s).r);
  /** `count` drones for a fractional share: the whole part, and one more by chance. */
  const howMany = (x: number, a: number): number => Math.floor(x) + (unit(seed, a, 3, 0) < x - Math.floor(x) ? 1 : 0);

  // Couriers: from a pad just outside their court's rim.
  v.courts.forEach((c, k) => {
    for (let j = howMany(d.couriers, k); j-- > 0;) {
      const a = TURN * unit(seed, k, 4, j), r = c.size * 1.6;
      add('courier', { move: 'round', theta: c.theta + (r * Math.cos(a)) / ring(c.s), s: c.s + r * Math.sin(a), around: 0, along: 0, height: d.lane, speed: d.cruise, court: k });
    }
  });
  // Tenders: over the orchard blocks, and the Vine face's vine parcels (rows of them around the face, at its foot).
  const places = placesOf(t);
  places.plots.forEach((p, k) => {
    for (let j = howMany(d.tenders, 100 + k); j-- > 0;) add('tender', { move: 'roam', theta: p.theta, s: p.s, around: p.halfAround, along: p.halfAlong, height: WORK_HEIGHT, speed: d.cruise / 3, court: -1 });
  });
  const gate = siteOf(plan, 'lift-stair');
  if (gate) {
    const top = sOfRadius(h, VINE_TOP * R, gate.s), parcel = h.params.plan.places.parcel;
    const want = Math.round((d.tenders * TURN * ring(gate.s)) / parcel / 2);
    for (let k = 0, found = 0; k < want * 20 && found < want; k++) {
      const theta = TURN * unit(seed, k, 5, 0), s = gate.s + (top - gate.s) * unit(seed, k, 5, 1);
      if (places.placeAt(theta, s)?.kind !== 'vineyard') continue;
      found++;
      add('tender', { move: 'roam', theta, s, around: parcel / 2, along: parcel / 4, height: WORK_HEIGHT, speed: d.cruise / 3, court: -1 });
    }
  }
  // Surveyors: circling the reserve's hike points, and the Mountain off its flight launch.
  const launch = siteOf(plan, 'summit-hut');
  const wide = Math.min(h.params.life.reach, h.params.plan.entranceSpacing) / 4;
  const circles = v.venues.filter((x) => x.kind === 'reserve').map((x) => ({ theta: x.theta, s: x.s, wide, height: d.lane * 2.5 }));
  // Over the Mountain: out from the flight launch, as wide as the hut is big a few times.
  if (launch) circles.push({ theta: launch.theta, s: launch.s + 3 * launch.size, wide: 2 * launch.size, height: d.lane * 1.5 });
  circles.forEach((c, k) => {
    for (let j = howMany(d.surveyors, 200 + k); j-- > 0;) add('surveyor', { move: 'orbit', theta: c.theta, s: c.s, around: c.wide, along: c.wide * (0.6 + 0.4 * unit(seed, k, 6, j)), height: c.height, speed: d.cruise / 2, court: -1 });
  });
  // Lifters: up and down the Gate's face beside the Stair; one at each makers' commons.
  if (gate) {
    const top = sOfRadius(h, Math.max(3 * h.params.hubRadius, 0.15 * R), gate.s);
    for (let j = howMany(d.lifters, 300); j-- > 0;) {
      const side = (unit(seed, j, 7, 0) - 0.5) * 12 * gate.size;
      add('lifter', { move: 'shuttle', theta: gate.theta + side / ring(gate.s), s: gate.s, around: 0, along: top - gate.s, height: d.lane, speed: d.cruise / 2, court: -1 });
    }
  }
  for (const x of v.venues) if (x.activity === 'make') add('lifter', { move: 'roam', theta: x.theta, s: x.s, around: x.spread, along: x.spread, height: WORK_HEIGHT * 2, speed: d.cruise / 3, court: -1 });
  // Gliders: near the axis, spread along the floor.
  const floor = profile.floorEnd - profile.floorStart, gliders = Math.round((d.gliders * floor) / 1000);
  for (let j = 0; j < gliders; j++) {
    const radius = R * (0.15 + 0.15 * unit(seed, j, 8, 0));
    add('glider', { move: 'drift', theta: TURN * unit(seed, j, 8, 1), s: profile.floorStart + floor * ((j + 0.5) / gliders), around: 0, along: Math.min(floor / (2 * gliders), 4 * radius), height: radius, speed: d.cruise, court: -1 });
  }
  // Guardians: over the water near both shores of the ring lake, evenly round it; two off the flight launch.
  const lake = plan.lake;
  if (lake) {
    const shores = (2 * TURN * R) / 1000, each = Math.round((d.guardians * shores) / 2);
    for (let side = 0; side < 2; side++) for (let j = 0; j < each; j++) {
      const s = lake.s + (side ? 1 : -1) * lake.halfWidth * 0.75;
      add('guardian', { move: 'roam', theta: (TURN * (j + 0.5 * side)) / each, s, around: Math.min((TURN * R) / each / 4, 60), along: Math.min(lake.halfWidth * 0.2, 60), height: 12, speed: d.cruise / 2, court: -1 });
    }
  }
  // Watchers, the Mind's eyes: over the places people go, a while over the people at one spot, then on to the next.
  v.venues.forEach((x, k) => {
    for (let j = howMany(d.watchers, 500 + k); j-- > 0;) add('watcher', { move: 'roam', theta: x.theta, s: x.s, around: x.spread, along: x.spread, height: WATCH_HEIGHT, speed: d.cruise / 2, court: -1 });
  });
  if (launch) for (let j = 0; j < 2; j++) add('guardian', { move: 'orbit', theta: launch.theta, s: launch.s + launch.size * 2, around: launch.size * 2, along: launch.size, height: d.lane, speed: d.cruise / 4, court: -1 });
  return jobs;
}

/** How many neighbouring courts a courier also flies to. */
const NEIGHBOURS = 4;
/** Shorter ways than this (m) are no trip. */
const SHORTEST = 50;

/**
 * Where each court's couriers fly to (points of the walk net): the places of the court (not its own rim) and the rims
 * of its nearest neighbouring courts. Made once per habitat.
 */
const stopsOf = kept((h: Habitat): readonly (readonly number[])[] => {
  const v = venuesOf(h), R = h.radius, courts = v.courts;
  // Courts in order along the axis: the nearest are found looking outward from each until no nearer can be left.
  const order = courts.map((_, k) => k).sort((a, b) => courts[a].s - courts[b].s), rank = new Int32Array(courts.length);
  order.forEach((k, i) => { rank[k] = i; });
  return courts.map((c, k) => {
    const best: { j: number; g: number }[] = [];
    const weigh = (j: number): void => {
      const g = floorGap(R, c.theta, c.s, courts[j].theta, courts[j].s);
      if (best.length < NEIGHBOURS || g < best[best.length - 1].g) {
        best.push({ j, g });
        best.sort((x, y) => x.g - y.g);
        if (best.length > NEIGHBOURS) best.pop();
      }
    };
    const far = (): number => (best.length < NEIGHBOURS ? Infinity : best[best.length - 1].g);
    for (let i = rank[k] + 1; i < order.length && courts[order[i]].s - c.s <= far(); i++) weigh(order[i]);
    for (let i = rank[k] - 1; i >= 0 && c.s - courts[order[i]].s <= far(); i--) weigh(order[i]);
    const own = v.byCourt[k].filter((i) => v.venues[i].kind !== 'court').map((i) => v.venues[i].vertex);
    return [...new Set([...own, ...best.map((x) => v.courtVertex[x.j])])].filter((w) => w !== v.courtVertex[k]);
  });
});

/** Where along the profile, from `from` on toward the port end, the profile comes within `radius` of the axis. */
function sOfRadius(h: Habitat, radius: number, from: number): number {
  const { profile } = h;
  let a = from, b = profile.length;
  if (profile.at(b).r > radius) return b;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (profile.at(m).r > radius) a = m; else b = m; }
  return a;
}

/** Drone `id` of the fleet at clock time t (s). */
export function flierAt(t: Terrain, id: number, time: number): Flier {
  const job = fleetOf(t)[id], h = t.habitat;
  const at = job.move === 'round' ? round(h, job, time) : job.move === 'roam' ? roam(h, job, time) : job.move === 'orbit' ? orbit(h, job, time) : job.move === 'shuttle' ? shuttle(job, time) : drift(job, time);
  const ground = job.move === 'drift' ? 0 : t.standAt(at.theta, at.s);
  const s = Math.min(h.profile.length, Math.max(0, at.s));
  return { id, role: job.role, design: job.design, theta: at.theta, s, h: job.move === 'drift' ? h.radius - job.height : ground + at.height, heading: at.heading, speed: at.speed, climb: at.climb, doing: at.doing };
}

/** Every drone of the habitat at clock time t (s). */
export function fliersAt(t: Terrain, time: number): Flier[] {
  return fleetOf(t).map((_, id) => flierAt(t, id, time));
}

/** Where a job puts its drone over the floor, how high (as the job counts it), its way and what it is doing. */
interface Spot {
  theta: number;
  s: number;
  height: number;
  heading: number;
  speed: number;
  climb: number;
  doing: Doing;
}

/**
 * Where a courier is in its round: rounds start at its own offset; each goes to a place of its court picked for that
 * round. Its way: from its pad straight to the court's end of the ways, along them to the place.
 */
function round(h: Habitat, job: Job, time: number): Spot {
  const d = h.params.life.drones, T = d.round, v = venuesOf(h), R = h.radius;
  const shifted = time + T * unit(job.seed, 0, 0, 0), n = Math.floor(shifted / T), u = shifted - n * T;
  const rest: Spot = { theta: job.theta, s: job.s, height: 0, heading: TURN * unit(job.seed, 1, 0, 0), speed: 0, climb: 0, doing: 'rest' };
  // Where it goes this round: a stop of its court picked for the round, or the next that fits in a round.
  const stops = stopsOf(h)[job.court], up = job.height / CLIMB;
  let route: Route | null = null;
  for (let k = 0, first = Math.floor(unit(job.seed, n, 1, 1) * stops.length); k < stops.length && !route; k++) {
    const r = routeOf(h, v.courtVertex[job.court], stops[(first + k) % stops.length]);
    if (r.length >= SHORTEST && 2 * (2 * up + (r.length + SHORTEST) / job.speed) + STOP < T * 0.9) route = r;
  }
  if (!route) return rest;
  const ring = Math.max(1, h.profile.at(job.s).r), dt = turnTo(route.points[0] - job.theta);
  const hop = Math.hypot(dt * ring, route.points[1] - job.s), length = hop + route.length;
  /** The way out, `x` m from the pad. */
  const wayAt = (x: number): { theta: number; s: number; heading: number } => {
    if (x >= hop) return pointAlong(route, R, x - hop);
    const f = hop > 0 ? x / hop : 0;
    return { theta: job.theta + dt * f, s: job.s + (route.points[1] - job.s) * f, heading: Math.atan2(dt * ring, route.points[1] - job.s) };
  };
  // Up, out, down; the stop; up, back, down: it fits in the round, or it rests the round out.
  const leg = length / job.speed, there = 2 * up + leg;
  if (2 * there + STOP > T || u >= 2 * there + STOP) return rest;
  const back = u >= there + STOP, w = back ? u - there - STOP : u;
  const flying = (x: number, height: number, speed: number, climb: number): Spot => {
    const p = wayAt(x);
    return { theta: p.theta, s: p.s, height, heading: back ? p.heading + Math.PI : p.heading, speed, climb, doing: 'fly' };
  };
  // The stop: hovering low over the place.
  if (!back && w >= there) return { ...flying(length, WORK_HEIGHT, 0, 0), doing: 'work' };
  // Up at one end, along the way, down at the other.
  const from = back ? length : 0, to = back ? 0 : length, low = back ? WORK_HEIGHT : 0, end = back ? 0 : WORK_HEIGHT;
  if (w < up) return flying(from, low + (job.height - low) * (w / up), 0, (job.height - low) / up);
  if (w < up + leg) return flying(from + (to - from) * ((w - up) / leg), job.height, job.speed, 0);
  const f = Math.min(1, (w - up - leg) / up);
  return flying(to, job.height + (end - job.height) * f, 0, (end - job.height) / up);
}

/**
 * A roamer: at work at one spot of its area for a while, then a hop to the next, eased out and in (at most its speed);
 * spots are seeded per beat, and a beat is as long as the longest hop across the area needs.
 */
function roam(h: Habitat, job: Job, time: number): Spot {
  const ring = Math.max(1, h.profile.at(job.s).r), hopTime = (gap: number): number => Math.max(BEAT.hop, (1.5 * gap) / job.speed);
  const beat = BEAT.work + hopTime(2 * Math.hypot(job.around, job.along));
  const shifted = time + beat * unit(job.seed, 0, 0, 0), n = Math.floor(shifted / beat), u = shifted - n * beat;
  const spot = (k: number): [number, number] => [job.theta + ((2 * unit(job.seed, k, 2, 0) - 1) * job.around) / ring, job.s + (2 * unit(job.seed, k, 2, 1) - 1) * job.along];
  const way = (a: [number, number], b: [number, number]): number => Math.atan2(turnTo(b[0] - a[0]) * ring, b[1] - a[1]);
  const here = spot(n), next = spot(n + 1), gap = Math.hypot(turnTo(next[0] - here[0]) * ring, next[1] - here[1]), hop = hopTime(gap);
  if (u < beat - hop) return { theta: here[0], s: here[1], height: job.height, heading: way(spot(n - 1), here), speed: 0, climb: 0, doing: 'work' };
  // The hop: up over what is between, and down at the next spot.
  const f = (u - beat + hop) / hop, e = f * f * (3 - 2 * f), rise = Math.max(0, HOP_HEIGHT - job.height);
  return {
    theta: here[0] + turnTo(next[0] - here[0]) * e, s: here[1] + (next[1] - here[1]) * e, height: job.height + rise * Math.sin(Math.PI * f),
    heading: way(here, next), speed: (gap * 6 * f * (1 - f)) / hop, climb: (rise * Math.PI * Math.cos(Math.PI * f)) / hop, doing: 'fly',
  };
}

/** An orbiter: round an ellipse over its middle, at its own speed and phase, the way it goes alternating by drone. */
function orbit(h: Habitat, job: Job, time: number): Spot {
  const ring = Math.max(1, h.profile.at(job.s).r), mean = Math.max(1, (job.around + job.along) / 2);
  const sense = unit(job.seed, 3, 0, 0) < 0.5 ? 1 : -1, phi = TURN * unit(job.seed, 0, 0, 0) + (sense * job.speed * time) / mean;
  const dx = -Math.sin(phi) * job.around * sense, ds = Math.cos(phi) * job.along * sense;
  return {
    theta: job.theta + (Math.cos(phi) * job.around) / ring, s: job.s + Math.sin(phi) * job.along, height: job.height,
    heading: Math.atan2(dx, ds), speed: (job.speed * Math.hypot(dx, ds)) / mean, climb: 0, doing: 'fly',
  };
}

/** A Gate lifter: up the face from its foot to near the hub, a stop to load, down again, a stop to unload. */
function shuttle(job: Job, time: number): Spot {
  const leg = job.along / job.speed, T = 2 * leg + 2 * STOP, shifted = time + T * unit(job.seed, 0, 0, 0), u = shifted - Math.floor(shifted / T) * T;
  const spotAt = (s: number, heading: number, speed: number, doing: Doing): Spot => ({ theta: job.theta, s, height: job.height, heading, speed, climb: 0, doing });
  if (u < STOP) return spotAt(job.s, Math.PI, 0, 'work');
  if (u < STOP + leg) return spotAt(job.s + (u - STOP) * job.speed, 0, job.speed, 'fly');
  if (u < 2 * STOP + leg) return spotAt(job.s + job.along, 0, 0, 'work');
  return spotAt(job.s + job.along - (u - 2 * STOP - leg) * job.speed, Math.PI, job.speed, 'fly');
}

/** A glider: round the axis at its distance from it, slowly, swinging along it. */
function drift(job: Job, time: number): Spot {
  const ring = job.height, w = job.speed / ring, swing = job.along > 0 ? (job.speed * 0.3) / job.along : 0;
  const theta = job.theta + w * time + TURN * unit(job.seed, 0, 0, 0), phase = swing * time + TURN * unit(job.seed, 1, 0, 0);
  const ds = job.along * swing * Math.cos(phase), dx = job.speed;
  return { theta, s: job.s + job.along * Math.sin(phase), height: job.height, heading: Math.atan2(dx, ds), speed: Math.hypot(dx, ds), climb: 0, doing: 'fly' };
}

/** Bytes the fleets keep (memory watchdog): their jobs, about 100 bytes each. */
export function airBytes(t: Terrain): number {
  return fleetOf(t).length * 100;
}

