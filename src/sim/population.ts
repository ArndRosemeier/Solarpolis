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
 * join the Sunwalk where the bright stretch is and walk with it for hours.
 *
 * Parties (design "What people do on the land"). Most people go up with others (`life.parties`): neighbouring slots of
 * the day's shuffle go together (regulars keep the same party every week), the first of them choosing where and when.
 * A party walks two abreast, the rest behind, and stands in a shape its place asks for (`Form`): a ring facing in to
 * talk, a row facing the view, side by side on the seat round a court's light well, or loosely near each other. A court
 * is a stop, not an afternoon (`life.pause`): people meet there and go on. Pure.
 */
import { hash3i, hashToFloat, deriveSeed } from '@futuremagic/core';
import { kept } from '../gen/kept';
import { fromLake, planOf } from '../gen/plan';
import type { Habitat } from '../blueprint';
import { shuffleOf, type Shuffle } from './permute';
import { floorGap, pointAlong, sunwalkOf, walksOf, type Route } from './walks';
import { besideLake, venuesOf, type Activity, type Venue, type Venues } from './venues';
import { courtFloorOf, courtPassageOf, courtWayIn, courtWayOut } from '../gen/courts';
import type { Terrain } from '../gen/terrain';
import { POSE } from '../gen/standIn';
import { beatAt, type Act } from './beats';

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
  /** A grown body, a shell (a plated humanoid body), or a drone (one of the `person` kit's designs, `design`). */
  body: 'grown' | 'shell' | 'drone';
  /** Which of the drone bodies they wear (0 … `drones.bodies` − 1), or −1. */
  design: number;
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
  /** Their place in their party (0 is the one who chose where to go: `outing − member` is theirs), and its size. */
  member: number;
  size: number;
  /** What they do in the beat they are in (sim/beats.ts; `walk` on their way). */
  act: Act;
  /** How they hold themselves (`POSE`), how they did before it last changed, and how long ago that was (s). */
  posture: number;
  from: number;
  since: number;
}

/** Someone on their way: upright, as they have been for long. */
const ON_THE_WAY = { act: 'walk', posture: POSE.upright, from: POSE.upright, since: 1e6 } as const;

/**
 * How a party stands at its place: loosely near each other, in a ring facing in (to talk, to dance, round a workbench),
 * in a row facing one way (the view, the sky), or side by side on the seat round a court's light well, facing out.
 */
const FORMS = ['loose', 'ring', 'row', 'bench'] as const;
type Form = (typeof FORMS)[number];

const FORM: Readonly<Record<Activity, Form>> = {
  meet: 'ring', gather: 'ring', sit: 'ring', make: 'ring', play: 'ring',
  picnic: 'row', stargaze: 'row', watch: 'row', bench: 'bench',
  walk: 'loose', stroll: 'loose', bathe: 'loose', herd: 'loose', wander: 'loose', swim: 'loose',
  climb: 'loose', fly: 'loose', hike: 'loose', sunwalk: 'loose',
};

/** How far apart neighbours stand in a ring (m): close to talk, an arm's reach round a bench, wide to dance or play catch. */
const RING_GAP: Partial<Record<Activity, number>> = { play: 2.2, make: 1.0 };
const TALK_GAP = 1.1;
/** Neighbours in a row (m), lying side by side a little wider; walking two abreast, and each pair this far behind the one ahead. */
const ROW_GAP = 0.7;
const LIE_GAP = 0.9;
const ABREAST = 0.7;
const BEHIND = 1.2;
/** Of the parties that meet at a court, the share that sits on the seat round its light well; of those standing, the share down on its floor. */
const ON_SEAT = 0.4;
const ON_FLOOR = 0.6;
/** How far a party strolls off its spot at most: this share of its place's spread, within these bounds (m). */
const STROLL = { share: 0.5, least: 8, most: 60 };

/** A party's size from a draw in [0, 1) by the habitat's shares. */
function partySize(shares: readonly number[], pick: number): number {
  let x = pick;
  for (let k = 0; k < shares.length; k++) { x -= shares[k]; if (x < 0) return k + 1; }
  return shares.length;
}

/** Where a member walks in their party: across the way (m, to the left) and behind the first pair. */
function walkSlot(member: number, size: number): [number, number] {
  const row = Math.floor(member / 2), alone = size % 2 === 1 && member === size - 1;
  return [alone ? 0 : ((member % 2) - 0.5) * ABREAST, row * BEHIND];
}

/** One day's outings from one court, in plain arrays: one entry per person, a party's members one after another. */
interface Outings {
  resident: Int32Array;
  venue: Int32Array;
  start: Float64Array;
  stay: Float32Array;
  night: Uint8Array;
  /** Place in the party and its size; the party's pace (its slowest walker's, m/s) and how it stands (`Form`). */
  member: Uint8Array;
  size: Uint8Array;
  pace: Float32Array;
  form: Uint8Array;
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

/** A float in [0, 1) from a seed and three numbers (the population's and the drones'). */
export const unit = (seed: number, a: number, b: number, c: number): number => hashToFloat(hash3i(seed, a, b, c));
/** A standard normal from the same. */
function normal(seed: number, a: number, b: number, c: number): number {
  const u = Math.max(1e-9, unit(seed, a, b, c)), v = unit(seed, a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TURN * v);
}

/** The population's seeds, derived once per habitat (hashing their names each time would cost more than the rest). */
const seedsOf = kept((h: Habitat) => {
  const of = (name: string): number => deriveSeed(h.seed, 'life', name);
  return { resident: of('resident'), outing: of('outing'), rhythm: of('rhythm'), spot: of('spot'), face: of('face'), sunwalk: of('sunwalk'), beat: of('beat') };
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
  const regular = i < c.regulars, worn = unit(seed, i, 2, 0);
  const home = courts ? Math.min(courts - 1, Math.floor(regular ? (i * courts) / Math.max(1, c.regulars) : ((i - c.regulars) * courts) / Math.max(1, c.residents - c.regulars))) : 0;
  return {
    id: i, regular, home,
    being: unit(seed, i, 1, 0) < life.minds ? 'mind' : 'human',
    body: worn < life.shells ? 'shell' : worn < life.shells + life.drones.persons ? 'drone' : 'grown',
    design: worn < life.shells || worn >= life.shells + life.drones.persons ? -1 : Math.min(life.drones.bodies - 1, Math.floor(unit(seed, i, 5, 0) * life.drones.bodies)),
    look: hash3i(seed, i, 3, 0),
    walk: life.walk * (0.85 + 0.3 * unit(seed, i, 4, 0)),
  };
}

/** Where in the day the bright stretch is over a place along the profile (phase 0 … daylight). */
export function localNoon(h: Habitat, s: number): number {
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

/** How long an outing lasts: about `life.stay`, more or less; a stop at a court about `life.pause`. */
const stayOf = (h: Habitat, n: number): number => h.params.life.stay * Math.min(3, Math.max(0.25, Math.exp(0.4 * n)));
const pauseOf = (h: Habitat, n: number): number => h.params.life.pause * Math.min(3, Math.max(0.25, Math.exp(0.5 * n)));

/** One day's outings from one court: its regulars whose weekday it is, and the visitors the shuffle sends it, in parties. */
function outingsFrom(h: Habitat, day: number, court: number): Outings {
  const c = censusOf(h), v = venuesOf(h), life = h.params.life, seed = seedsOf(h).outing;
  const resident: number[] = [], venue: number[] = [], start: number[] = [], stay: number[] = [], night: number[] = [];
  const member: number[] = [], size: number[] = [], pace: number[] = [], form: number[] = [];
  const seats = !!courtFloorOf(h, 1);
  // A party: its first member chooses the place and the hour; all of them keep the slowest one's pace.
  const add = (party: readonly number[], k: number, centreJitter: number, n: number, dayPick: number): void => {
    const lead = party[0], place = v.venues[k], atNight = !place.evening && unit(seed, lead, day, 11) < life.night;
    const long = (place.kind === 'court' ? pauseOf(h, n) : stayOf(h, n)) * (place.evening ? 1.2 : 1);
    const [t0, dt] = timing(h, localNoon(h, place.s), long, place.evening, atNight, centreJitter, dayPick);
    const shape: Form = place.kind === 'court' && seats && unit(seed, lead, day, 13) < ON_SEAT ? 'bench' : FORM[place.activity];
    let slowest = Infinity;
    for (const i of party) slowest = Math.min(slowest, residentOf(h, i).walk);
    party.forEach((i, m) => {
      resident.push(i); venue.push(k); start.push(day * h.params.day.length + t0); stay.push(Math.min(dt, h.params.day.length - t0)); night.push(atNight ? 1 : 0);
      member.push(m); size.push(party.length); pace.push(slowest); form.push(FORMS.indexOf(shape));
    });
  };
  const mine = v.byCourt[court];
  // Regulars: the same party, the same weekdays, the same hour, the same place.
  const courts = v.courts.length, r0 = Math.ceil((court * c.regulars) / courts), r1 = Math.ceil(((court + 1) * c.regulars) / courts);
  const weekday = ((day % WEEK) + WEEK) % WEEK, rseed = seedsOf(h).rhythm;
  if (mine.length) for (let i = r0; i < r1;) {
    const lead = i, n = Math.min(partySize(life.parties, unit(rseed, lead, 6, 6)), r1 - lead);
    i += n;
    if (unit(rseed, lead, weekday, 0) >= life.outings) continue;
    const k = favourite(v, mine, unit(rseed, lead, 2, 2));
    add(Array.from({ length: n }, (_, q) => lead + q), k, normal(rseed, lead, 3, 3) + 0.1 * normal(seed, lead, day, 4), 0.5 * normal(rseed, lead, 5, 5) + 0.3 * normal(seed, lead, day, 6), unit(seed, lead, day, 7));
  }
  // Visitors: the slots of the court's blocks, turned back into residents, neighbouring slots together.
  const sh = shuffleFor(h, day);
  for (const b of c.courtBlocks[court]) {
    const k0 = c.blockVenue[b];
    if (k0 < 0 && !mine.length) continue;
    for (let j = c.blockStart[b], end = c.blockStart[b + 1]; j < end;) {
      const n = Math.min(partySize(life.parties, unit(seed, j, day, 14)), end - j);
      const party = Array.from({ length: n }, (_, q) => c.regulars + sh.unpermute(j + q)), lead = party[0];
      j += n;
      const k = k0 >= 0 ? k0 : favourite(v, mine, unit(seed, lead, day, 8));
      add(party, k, normal(seed, lead, day, 9), normal(seed, lead, day, 10), unit(seed, lead, day, 12));
    }
  }
  return {
    resident: Int32Array.from(resident), venue: Int32Array.from(venue), start: Float64Array.from(start),
    stay: Float32Array.from(stay), night: Uint8Array.from(night),
    member: Uint8Array.from(member), size: Uint8Array.from(size), pace: Float32Array.from(pace), form: Uint8Array.from(form),
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
const bytesOf = (o: Outings): number => o.resident.byteLength + o.venue.byteLength + o.start.byteLength + o.stay.byteLength + o.night.byteLength
  + o.member.byteLength + o.size.byteLength + o.pace.byteLength + o.form.byteLength;
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

/** Bytes the population keeps for a habitat (its outings and routes, and those through the courts of `ground`), for the memory watchdog. */
export function lifeBytes(h: Habitat, ground?: Terrain): number {
  let n = outingCache.get(h)?.bytes ?? 0;
  for (const r of (ground && passages.get(ground)?.values()) || []) n += r.points.byteLength + r.along.byteLength;
  for (const w of walkerCache.get(h)?.values() ?? []) n += w.resident.byteLength * 9;
  for (const r of routeCache.get(h)?.values() ?? []) n += r.points.byteLength + r.along.byteLength;
  return n;
}

/** Routes kept per habitat, a bounded number (the one way to a route between two points of the walk net: people and couriers). */
const KEEP_ROUTES = 4096;
const routeCache = new WeakMap<Habitat, Map<number, Route>>();
export function routeOf(h: Habitat, from: number, to: number): Route {
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

/** A party's middle at its place: a seeded offset within its spread (θ, s), kept out of the lake unless they swim or stand on the pavilion. */
function spotOf(h: Habitat, place: Venue, i: number, day: number): [number, number] {
  const seed = seedsOf(h).spot, a = TURN * unit(seed, i, day, 0), r = place.spread * Math.sqrt(unit(seed, i, day, 1));
  const ring = Math.max(1, h.profile.at(place.s).r), lake = planOf(h).lake;
  let s = place.s + r * Math.sin(a);
  if (lake && place.activity !== 'swim' && place.kind !== 'landmark' && fromLake(lake, s) < 0) s = besideLake(lake, place.s, r * 0.1);
  return [place.theta + (r * Math.cos(a)) / ring, s];
}

/** Feet this far (m) out from the edge of the seat round a court's light well: sitting on it, facing out. */
const SEAT_FEET = 0.15;

/**
 * Where a party meets in a court, standing: down on its open floor or up round it on the land, never on its wall or
 * stairs. Null in a habitat built without landmarks (no court is built): there the venue's spread, as anywhere.
 */
function courtSpotOf(h: Habitat, place: Venue, lead: number, day: number): [number, number] | null {
  const site = venuesOf(h).courts[place.court], f = courtFloorOf(h, site.size);
  if (!f) return null;
  const seed = seedsOf(h).spot, a = TURN * unit(seed, lead, day, 0), u = unit(seed, lead, day, 1);
  const [r0, r1] = f.free[0] < f.free[1] && unit(seed, lead, day, 3) < ON_FLOOR ? f.free : [f.walk + 2, f.walk + 2 + 0.5 * site.size];
  const r = Math.sqrt(r0 * r0 + u * (r1 * r1 - r0 * r0)), ring = Math.max(1, h.profile.at(site.s).r);
  return [site.theta + (r * Math.sin(a)) / ring, site.s + r * Math.cos(a)];
}

/** Where member m of a party of `size` is at its place (θ, s), and the way they face, by how the party stands. */
function memberSpot(h: Habitat, place: Venue, form: Form, activity: Activity, lead: number, m: number, size: number, day: number): [number, number, number] {
  const seed = seedsOf(h).spot, face = seedsOf(h).face;
  if (form === 'bench') {
    // Side by side round the seat, facing out over the court.
    const site = venuesOf(h).courts[place.court], r = courtFloorOf(h, site.size)!.seat + SEAT_FEET, ring = Math.max(1, h.profile.at(site.s).r);
    const a = TURN * unit(seed, lead, day, 2) + (m * ROW_GAP) / r;
    return [site.theta + (r * Math.sin(a)) / ring, site.s + r * Math.cos(a), a];
  }
  const [ct, cs] = (place.kind === 'court' && courtSpotOf(h, place, lead, day)) || spotOf(h, place, lead, day);
  const ring = Math.max(1, h.profile.at(cs).r);
  let ds = 0, dy = 0, heading: number;
  if (form === 'ring' && size > 1) {
    const gap = RING_GAP[activity] ?? TALK_GAP, rr = Math.max(gap * 0.6, (size * gap) / TURN), a = TURN * unit(seed, lead, day, 4) + (TURN * m) / size;
    ds = rr * Math.cos(a); dy = rr * Math.sin(a); heading = a + Math.PI;
  } else if (form === 'row') {
    heading = TURN * unit(face, lead, day, 0);
    const across = (m - (size - 1) / 2) * (activity === 'picnic' || activity === 'stargaze' ? LIE_GAP : ROW_GAP);
    ds = -across * Math.sin(heading); dy = across * Math.cos(heading);
  } else {
    heading = TURN * unit(face, lead, day, 1 + m);
    if (m > 0) {
      const a = TURN * unit(seed, lead, day, 20 + m), r = (1.5 + size) * Math.sqrt(unit(seed, lead, day, 40 + m));
      ds = r * Math.cos(a); dy = r * Math.sin(a);
    }
  }
  // Nobody is put into the lake who did not come to swim.
  const lake = planOf(h).lake;
  if (lake && activity !== 'swim' && place.kind !== 'landmark' && fromLake(lake, cs + ds) < 0) ds = -ds;
  return [ct + dy / ring, cs + ds, heading];
}

/** The ways into a court toward spots on its floor: one per sector round its middle. */
const SECTORS = 12;

/**
 * The way from a court to a point of the walk net. On built ground (`ground`: the courts' stairs are the terrain's) it
 * starts at the lift's portal and goes up the court's stair and out over its walk, then on along the paths from where
 * they leave the court; to a spot in the court itself (`inside`: the angle of the spot round its middle), out of the
 * portal and round the aisle to the spot's sector. Without, it starts at the court's middle, where its way begins.
 */
function wayOf(h: Habitat, ground: Terrain | undefined, court: number, to: number, inside: number | null): Route {
  const v = venuesOf(h), paths = routeOf(h, v.courtVertex[court], to);
  const pass = ground && courtPassageOf(ground, court);
  if (!pass) return paths;
  let m = passages.get(ground);
  if (!m) { m = new Map(); passages.set(ground, m); }
  const sector = inside === null ? -1 : (((Math.round((inside / TURN) * SECTORS) % SECTORS) + SECTORS) % SECTORS);
  const key = (court * walksOf(h).size + to) * (SECTORS + 1) + sector + 1;
  let r = m.get(key);
  if (!r) {
    if (m.size >= KEEP_ROUTES) m.clear();
    r = sector < 0 ? joined(h, ground, court, paths) : routeThrough(h, courtWayIn(ground, court, (sector * TURN) / SECTORS)!);
    m.set(key, r);
  }
  return r;
}

/**
 * The way out of a court and round its rim to where the paths leave it, then the paths on from the first of their
 * points beyond its walk (θ kept unwrapped).
 */
function joined(h: Habitat, ground: Terrain, court: number, paths: Route): Route {
  const site = venuesOf(h).courts[court], R = h.radius, out = (courtFloorOf(h, site.size)?.walk ?? site.size) + 1, p = paths.points;
  let k = 0;
  while (k < p.length && floorGap(R, site.theta, site.s, p[k], p[k + 1]) <= out) k += 2;
  // The paths' first point outside, by its angle round the court in the court's frame (x along the axis, y around).
  const ring = Math.max(1, h.profile.at(site.s).r), dth = k < p.length ? p[k] - site.theta - TURN * Math.round((p[k] - site.theta) / TURN) : 0;
  const pass = k < p.length ? courtWayOut(ground, court, Math.atan2(dth * ring, p[k + 1] - site.s))! : courtPassageOf(ground, court)!;
  const last = pass[pass.length - 2], shift = k < p.length ? TURN * Math.round((last - p[k]) / TURN) : 0;
  const all = new Float64Array(pass.length + p.length - k);
  all.set(pass);
  for (let i = k; i < p.length; i += 2) { all[pass.length + i - k] = p[i] + shift; all[pass.length + i - k + 1] = p[i + 1]; }
  return routeThrough(h, all);
}

/** A route through points (θ, s, …). */
function routeThrough(h: Habitat, points: Float64Array): Route {
  const n = points.length / 2, along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot((points[i * 2] - points[i * 2 - 2]) * h.radius, points[i * 2 + 1] - points[i * 2 - 1]);
  return { points, along, length: n ? along[n - 1] : 0 };
}

/** Routes through the courts, kept per terrain (a bounded number). */
const passages = new WeakMap<Terrain, Map<number, Route>>();

/** Where outing n of a court's day is at clock time t, or null if it is not up on the land then. */
function placeOf(h: Habitat, o: Outings, n: number, court: number, day: number, t: number, ground?: Terrain): Person | null {
  const u = t - o.start[n], stay = o.stay[n];
  if (u < 0 || u > stay) return null;
  const v = venuesOf(h), place = v.venues[o.venue[n]], i = o.resident[n], R = h.radius;
  const member = o.member[n], size = o.size[n], lead = o.resident[n - member], pace = o.pace[n];
  const night = o.night[n] === 1, bench = FORMS[o.form[n]] === 'bench';
  const activity: Activity = bench ? 'bench' : night && place.activity !== 'watch' ? 'stargaze' : place.activity;
  const form: Form = night && !bench ? 'row' : FORMS[o.form[n]];
  const [st, ss, facing] = memberSpot(h, place, form, activity, lead, member, size, day);
  // A spot in a court is reached round its aisle (by its angle in the court's frame: x along the axis, y around).
  const site = v.courts[court], ring = Math.max(1, h.profile.at(site.s).r), dth = st - site.theta - TURN * Math.round((st - site.theta) / TURN);
  const inside = place.kind === 'court' && floorGap(R, site.theta, site.s, st, ss) < site.size ? Math.atan2(dth * ring, ss - site.s) : null;
  const route = wayOf(h, ground, court, place.vertex, inside);
  // Two abreast along the paths (each keeps their side of the way they walk), then each to their spot over the land.
  const back = u > stay / 2, [across, behind] = walkSlot(member, size), side = back ? -across : across;
  const end = pointAlong(route, R, route.length);
  const lt = end.theta + (side * Math.cos(end.heading)) / R, ls = end.s - side * Math.sin(end.heading);
  const dt = st - lt - TURN * Math.round((st - lt) / TURN);
  const off = Math.hypot(dt * R, ss - ls), whole = route.length + off;
  const legs = Math.min((whole + behind) / pace, stay / 2);
  let d: number;
  if (u < legs) d = u * pace - behind;
  else if (u > stay - legs) d = (stay - u) * pace - behind;
  else {
    // At their place: the party's beat, now (a stroll takes them off their spot and back).
    const reach = Math.min(STROLL.most, Math.max(STROLL.least, place.spread * STROLL.share));
    const b = beatAt(seedsOf(h).beat, activity, lead, size, day, u, legs, stay - legs, pace, reach);
    // A game of catch: every other one goes out the other way, so they face each other over twice its length.
    const across = b.act === 'catch' && member % 2 === 1 ? Math.PI : 0;
    let toward = b.toward + across, off = b.away > 0;
    // Nobody strolls into the lake who did not come to swim: the other way, or not at all.
    const lake = off && activity !== 'swim' ? planOf(h).lake : null;
    if (lake && fromLake(lake, ss + Math.cos(toward) * reach) < 0) {
      toward += Math.PI;
      // A game of catch needs both ways dry (each goes out its own way).
      if (across || b.act === 'catch' || fromLake(lake, ss + Math.cos(toward) * reach) < 0) off = false;
    } else if (lake && b.act === 'catch' && fromLake(lake, ss - Math.cos(toward) * reach) < 0) off = false;
    const away = off ? b.away : 0, moving = off && b.moving;
    const act: Act = !off && (b.act === 'stroll' || b.act === 'catch') ? 'quiet' : b.act;
    // Looking about where they stand faces away from the ring; at the end of a stroll, on the way they went; at catch,
    // back toward the one they throw to.
    const heading = moving ? toward + (b.back ? Math.PI : 0) : off ? (act === 'catch' ? toward + Math.PI : toward) : act === 'look' && form === 'ring' ? facing + Math.PI : facing;
    const dTheta = away > 0 ? (away * Math.sin(toward)) / Math.max(1, h.profile.at(ss).r) : 0;
    return {
      resident: i, theta: st + dTheta, s: ss + away * Math.cos(toward), heading, moving, speed: moving ? pace : 0,
      activity, court, outing: n, member, size, act, posture: b.posture, from: b.from, since: b.since,
    };
  }
  d = Math.min(whole, Math.max(0, d));
  if (d <= route.length) {
    const p = pointAlong(route, R, d);
    return { resident: i, theta: p.theta + (side * Math.cos(p.heading)) / R, s: p.s - side * Math.sin(p.heading), heading: back ? p.heading + Math.PI : p.heading, moving: true, speed: pace, activity: 'walk', court, outing: n, member, size, ...ON_THE_WAY };
  }
  const f = (d - route.length) / Math.max(off, 1e-9), heading = Math.atan2(dt * R, ss - ls);
  return { resident: i, theta: lt + dt * f, s: ls + (ss - ls) * f, heading: back ? heading + Math.PI : heading, moving: true, speed: pace, activity: 'walk', court, outing: n, member, size, ...ON_THE_WAY };
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

/** One day's Sunwalkers, worked out once: who, when they set out, for how long, where and how fast, their side, their party. */
interface Sunwalkers {
  resident: Int32Array;
  t0: Float64Array;
  span: Float32Array;
  s0: Float64Array;
  speed: Float32Array;
  side: Float32Array;
  member: Uint8Array;
  size: Uint8Array;
}

function sunwalkersFrom(h: Habitat, day: number): Sunwalkers {
  const n = censusOf(h).sunwalk, regulars = censusOf(h).regulars, sh = shuffleFor(h, day), seed = seedsOf(h).sunwalk;
  const { length, daylight, peakWidth } = h.params.day, L = h.params.length;
  const { floorStart } = h.profile, z0 = h.profile.at(floorStart).z, width = planOf(h).paths[0]?.width ?? 0;
  const pace = ((1 + 2 * peakWidth) * L) / (daylight * length);
  const w: Sunwalkers = {
    resident: new Int32Array(n), t0: new Float64Array(n), span: new Float32Array(n), s0: new Float64Array(n), speed: new Float32Array(n), side: new Float32Array(n),
    member: new Uint8Array(n), size: new Uint8Array(n),
  };
  // Parties of neighbouring slots: the first sets out, the others walk beside and behind them.
  for (let j = 0; j < n;) {
    const size = Math.min(partySize(h.params.life.parties, unit(seed, j, day, 5)), n - j), i = regulars + sh.unpermute(j);
    const t0 = day * length + daylight * length * (0.05 + 0.7 * unit(seed, i, day, 0));
    // The bright stretch's middle, in z, moves at a steady pace through the day; walkers keep near it.
    const zMid = -peakWidth * L + pace * (t0 - day * length);
    const span = Math.min(stayOf(h, normal(seed, i, day, 1)) * 2.5, day * length + daylight * length - t0);
    const s0 = floorStart + (zMid - z0) + normal(seed, i, day, 2) * 0.35 * peakWidth * L;
    const speed = pace * (0.85 + 0.3 * unit(seed, i, day, 3)), side = (unit(seed, i, day, 4) - 0.5) * width;
    for (let m = 0; m < size; m++, j++) {
      const [across, behind] = walkSlot(m, size);
      w.resident[j] = regulars + sh.unpermute(j);
      w.t0[j] = t0; w.span[j] = span; w.s0[j] = s0 - behind; w.speed[j] = speed;
      w.side[j] = (side + across) / Math.max(1, h.radius);
      w.member[j] = m; w.size[j] = size;
    }
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
  return { resident: w.resident[j], theta: theta + w.side[j], s, heading: Math.atan2(across, 1), moving: true, speed: w.speed[j] * Math.hypot(1, across), activity: 'sunwalk', court: -1, outing: j, member: w.member[j], size: w.size[j], ...ON_THE_WAY };
}

/** An area to look in: around (θ, s) out to `radius` m over the floor. */
export interface Near {
  theta: number;
  s: number;
  radius: number;
}

/** One number for someone up on the land today, the same for every level that draws them (court and outing, or the Sunwalker). */
export function personKey(p: Pick<Person, 'court' | 'outing'>): number {
  return p.court < 0 ? -1 - p.outing : p.court * 2 ** 22 + p.outing;
}

/** How long one turn to speak lasts in a party that talks (s), at least; a turn runs on to twice this. */
const TURN_TALK = 4;

/**
 * Who in someone's party is speaking at clock time t (their `member`), or −1 for a party of one: turns of 4 to 8 s,
 * passed round at the toss of the party's own coin, so everyone in it agrees. Pure.
 */
export function talkerAt(p: Pick<Person, 'court' | 'outing' | 'member' | 'size'>, t: number): number {
  if (p.size < 2) return -1;
  const party = personKey({ court: p.court, outing: p.outing - p.member }) | 0;
  // Turns in steps of TURN_TALK s; a step continues the last turn half the time, so turns run from one step to many.
  const step = Math.floor(t / TURN_TALK);
  let k = step;
  while (k > step - 8 && hashToFloat(hash3i(party, k, 0, 1)) < 0.5) k--;
  return Math.floor(hashToFloat(hash3i(party, k, 0, 2)) * p.size);
}

/**
 * Everyone up on the land at clock time t (s), or only those within an area. Each court's day is made once and kept
 * (a bounded number), routes too; asking for an area looks only at the courts whose people can reach it. `ground`: the
 * terrain, so people come up out of the courts' lifts and climb their stairs (`wayOf`); every level that draws people
 * passes it, so they agree on where everyone is.
 */
export function peopleAt(h: Habitat, t: number, near?: Near, ground?: Terrain): Person[] {
  const out: Person[] = [], v = venuesOf(h), c = censusOf(h), R = h.radius;
  if (!v.courts.length || !c.residents) return out;
  const day = Math.floor(t / h.params.day.length);
  const inArea = (theta: number, s: number, extra: number): boolean => !near || floorGap(R, near.theta, near.s, theta, s) <= near.radius + extra;
  for (let court = 0; court < v.courts.length; court++) {
    const site = v.courts[court];
    if (!inArea(site.theta, site.s, v.reach[court])) continue;
    const o = outingsOf(h, day, court);
    for (let n = 0; n < o.resident.length; n++) {
      const p = placeOf(h, o, n, court, day, t, ground);
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
export function whereIs(h: Habitat, t: number, who: Pick<Person, 'court' | 'outing'>, ground?: Terrain): Person | null {
  const day = Math.floor(t / h.params.day.length);
  if (who.court < 0) return who.outing < censusOf(h).sunwalk ? sunwalkerAt(h, sunwalkersOf(h, day), who.outing, t) : null;
  const o = outingsOf(h, day, who.court);
  return who.outing < o.resident.length ? placeOf(h, o, who.outing, who.court, day, t, ground) : null;
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
