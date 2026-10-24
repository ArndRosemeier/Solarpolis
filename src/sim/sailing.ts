/**
 * Sailing (Arnd 2026-10-23: "sail boats, slick and futuristic", on the lakes and on the ring lake). Which boats the
 * habitat has, on which water, and where each one is at a clock time: pure functions of the seed, the plan and the
 * clock, as the people and the deer are.
 *
 * The water and the boats (gen/harbours.ts). Every stretch of open water a boat can sail is a `Basin`: the ring lake
 * (cut where the lake pavilion's bridges cross it, so a boat sails round the habitat from one side of the pavilion to
 * the other) and each lake on the floor. Three designs, each a real sailing machine a thousand years on
 * (`BOAT_KINDS`): a two-person skiff with a wing sail, a foiling trimaran that lifts out of the water once it is fast
 * enough, and a glass-roofed catamaran for an afternoon out with friends. How many: `HabitatParams.life.sailing.boats`
 * per km² of water; each lies at a berth in one of its water's harbours, stern to the pontoon (or at a buoy).
 *
 * The day. Each boat goes out on a day by `sailing.outings`, less often in a calm or a gale (`breezeAt`), sometime in
 * the light hours for about `sailing.stay`: a race round marks set upwind and downwind of its mooring, a cruise
 * between points of the water, or on the ring lake a passage far round the cylinder and back. It sails each leg as a
 * sailor would: straight at a mark it can lay; upwind on the better tack until the mark is on the other tack's line or
 * the water ends, then tacks; deep downwind it gybes between broad reaches. The wind is looked up every `LEG` seconds
 * where the boat is (`windAt`: the breeze, the sun's draw and the gusts), so boats lift and head with the shifts. A
 * tack or gybe costs time (`turn`). It leaves its berth on its quiet drive (`motor`), straight out to its sailing water
 * (`Boat.out`), and comes back the same way: there it turns and backs into its berth. At a buoy it lies head to wind.
 * A day is sailed once, when first asked, and kept (`Outing`, a few kB, a bounded cache).
 *
 * The spin. A boat moving spinward is heavier (its weight is (ωr + v_spinward)²/r, `feltGravity`), against the spin
 * lighter; along the axis the same. Heavier, it stands up better to its sails and can be driven harder (its top speed
 * grows with √g); a foiler needs more speed to lift out (take-off speed grows with √g), so foilers fly sooner sailing
 * against the spin. On a small fast-spinning habitat that is plain to see; on the reference, a few per cent. The spin
 * never pushes a boat sideways: moving across the axis's direction only presses it down or lifts it (world/wind.ts).
 *
 * Boats do not yet keep clear of each other. Pure.
 */
import { Rng, angleDiff, deriveSeed, smoothstep } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { dayNumber } from '../world/sunline';
import { breezeAt, windAt } from '../world/wind';
import { BOAT_KINDS, BOAT_KIND_LIST, type BoatKind, type BoatSpec } from '../gen/boat';
import { basinPoint, fleetOf, inBasin, offShore, runIn, seaRoom, type Basin, type Boat, type Fleet, type Harbour } from '../gen/harbours';

const TURN = 2 * Math.PI;
const DEG = Math.PI / 180;

export { BOAT_KINDS, BOAT_KIND_LIST, type BoatKind, type BoatSpec };
export { basinPoint, inBasin, offShore, runIn, seaRoom, type Basin, type Boat, type Fleet, type Harbour };

/** The wind angle (rad from upwind) a boat goes fastest at for its wind. */
const BEST = 106 * DEG;
/** How fast a boat goes through a tack or gybe, as a share of its speed. */
const TURNING = 0.4;
/** How often a sailor looks at the wind again (s): the longest leg. */
const LEG = 90;
/** How near a mark counts as rounding it, in boat lengths. */
const ROUND = 2;
/** The most legs a day's sailing may take (a guard; a day takes a few hundred). */
const MOST_LEGS = 4000;
/** Below this true wind (m/s) a boat ghosts along at `DRIFT` straight for where it is going. */
const CALM = 0.4;
const DRIFT = 0.3;

/** The habitat's sailing water, its harbours and its boats, laid out once per habitat (gen/harbours.ts). */
export const sailingOf: (h: Habitat) => Fleet = fleetOf;

/**
 * How fast a boat sails (m/s) at `twa` from the true wind (rad from upwind, 0 … π) in a true wind of `tws` m/s, felt
 * gravity `g` times standard (heavier: it holds more power; a foiler lifts out later). In a light breeze boats go
 * nearer the wind's own speed than in a strong one.
 */
export function polarSpeed(kind: BoatKind, tws: number, twa: number, g = 1): { speed: number; foiling: boolean } {
  const b = BOAT_KINDS[kind], a = Math.abs(twa);
  if (a < b.noGo || a > b.deep + 1e-9 || tws <= 0) return { speed: 0, foiling: false };
  const k = a <= BEST
    ? 0.55 + 0.45 * Math.sin((Math.PI / 2) * ((a - b.noGo) / (BEST - b.noGo)))
    : 1 - 0.35 * ((a - BEST) / (Math.PI - BEST)) ** 1.5;
  const stand = Math.sqrt(Math.max(g, 0.05)), top = b.top * stand;
  const plain = Math.min(top, b.reach * k * tws * (1 + 0.4 * Math.exp(-tws / 2.5)));
  if (b.foil && plain > b.foil.takeoff * stand) return { speed: Math.min(top, plain * b.foil.lift), foiling: true };
  return { speed: plain, foiling: false };
}

/** How heavy a boat feels sailing at `speed` on `heading` (0: along +s, π/2: spinward), as a share of standing still. */
export const feltShare = (h: Habitat, radius: number, speed: number, heading: number): number => {
  const round = h.spin * radius;
  return (1 + (speed * Math.sin(heading)) / round) ** 2;
};

/** The heading (0: along +s, π/2: spinward) a vector over the floor points (u around, v along). */
const headingOf = (u: number, v: number): number => Math.atan2(u, v);

/** A boat's sailing speed on a heading in a wind, with the spin's weight on it (settled over two rounds). */
function sailSpeed(h: Habitat, b: Basin, kind: BoatKind, wind: { along: number; around: number }, heading: number): { speed: number; foiling: boolean } {
  const tws = Math.hypot(wind.along, wind.around);
  const twa = Math.abs(angleDiff(0, heading - headingOf(-wind.around, -wind.along)));
  let at = polarSpeed(kind, tws, twa);
  for (let i = 0; i < 2; i++) at = polarSpeed(kind, tws, twa, feltShare(h, b.radius - b.level, at.speed, heading));
  return at;
}

/** A day's sailing: from leaving the mooring to lying at it again, as legs (each straight, at one speed). */
export interface Outing {
  /** When it casts off and when it is moored again (clock time, s). */
  start: number;
  end: number;
  /** Legs, `LEG_FIELDS` floats each: start (s after `start`), u, v, heading, speed, flags (`TURNING_LEG`, `FOILING`, `MOTOR`, `ASTERN`, `SPIN`, `STARBOARD`). */
  legs: Float32Array;
  count: number;
}
const LEG_FIELDS = 6;
/**
 * A leg's flags: going about, flying on its foils, under its drive (the wing feathered), going astern, turning on the
 * spot; under sail, the wind over its starboard side (else its port side) as the leg was planned: held for the whole
 * leg, so a gust on a run never throws the wing and the crew from side to side.
 */
const TURNING_LEG = 1, FOILING = 2, MOTOR = 4, ASTERN = 8, SPIN = 16, STARBOARD = 32;

/** The side the wind comes over a boat heading so at a speed (its own way taken off the true wind): +1 starboard, −1 port. */
function tackOf(wind: { along: number; around: number }, heading: number, own: number): 1 | -1 {
  const au = wind.around - Math.sin(heading) * own, av = wind.along - Math.cos(heading) * own;
  return -au * Math.cos(heading) + av * Math.sin(heading) >= 0 ? 1 : -1;
}

/**
 * One leg of an outing: when it starts (s after the outing's), where, which way its bow points, how fast, going about
 * or flying; under its drive in or out of its harbour (`motoring`), going astern into its berth, turning on the spot.
 */
export interface Leg {
  t: number;
  u: number;
  v: number;
  heading: number;
  speed: number;
  turning: boolean;
  foiling: boolean;
  motoring: boolean;
  astern: boolean;
  spinning: boolean;
}

/** An outing's legs, read out (for tests and the debug menu). */
export function legsOf(o: Outing): Leg[] {
  const out: Leg[] = [], L = o.legs;
  for (let i = 0; i < o.count * LEG_FIELDS; i += LEG_FIELDS) {
    const f = L[i + 5];
    out.push({ t: L[i], u: L[i + 1], v: L[i + 2], heading: L[i + 3], speed: L[i + 4], turning: (f & TURNING_LEG) !== 0, foiling: (f & FOILING) !== 0, motoring: (f & MOTOR) !== 0, astern: (f & ASTERN) !== 0, spinning: (f & SPIN) !== 0 });
  }
  return out;
}

/**
 * The outings sailed, kept by boat and day, up to `KEEP` bytes of legs (an outing is a few kB; a day of the large
 * habitat's fleet about 1 MB, and two days are kept: today's and tomorrow's) and `KEEP_DAYS` entries.
 */
const KEEP = 4 << 20, KEEP_DAYS = 4096;
const outings = new WeakMap<Habitat, { byKey: Map<number, Outing | null>; bytes: number }>();

/** The kept outings of a habitat. */
function keptOf(h: Habitat): { byKey: Map<number, Outing | null>; bytes: number } {
  let kept = outings.get(h);
  if (!kept) { kept = { byKey: new Map(), bytes: 0 }; outings.set(h, kept); }
  return kept;
}

/** Boat `boat`'s outing on day `day` (whole days of the clock), or null if it stays moored. */
export function outingOf(h: Habitat, boat: Boat, day: number): Outing | null {
  const key = boat.id * 1e6 + day, known = keptOf(h).byKey;
  if (known.has(key)) return known.get(key)!;
  const o = sailDay(h, boat, day);
  keepOuting(h, key, o);
  return o;
}

/**
 * Every boat's outing on day `day`, by boat id, sailed afresh and not kept (a worker plans a day ahead with it, so the
 * frame never waits for a day's sailing: `keepDay` takes its answer).
 */
export const planDay = (h: Habitat, day: number): (Outing | null)[] => sailingOf(h).boats.map((boat) => sailDay(h, boat, day));

/** A day planned elsewhere (`planDay`), kept as if sailed here. */
export function keepDay(h: Habitat, day: number, planned: readonly (Outing | null)[]): void {
  const known = keptOf(h).byKey;
  planned.forEach((o, id) => { if (!known.has(id * 1e6 + day)) keepOuting(h, id * 1e6 + day, o); });
}

/** Whether day `day`'s sailing of every boat is known already. */
export const dayKnown = (h: Habitat, day: number): boolean => sailingOf(h).boats.every((b) => keptOf(h).byKey.has(b.id * 1e6 + day));

/** Bytes the kept outings hold (memory watchdog). */
export const sailingBytes = (h: Habitat): number => outings.get(h)?.bytes ?? 0;

function keepOuting(h: Habitat, key: number, o: Outing | null): void {
  const kept = keptOf(h), { byKey } = kept;
  byKey.set(key, o);
  kept.bytes += o ? o.legs.byteLength : 0;
  // The oldest given up first.
  while (kept.bytes > KEEP || byKey.size > KEEP_DAYS) {
    const [k, old] = byKey.entries().next().value!;
    byKey.delete(k);
    kept.bytes -= old ? old.legs.byteLength : 0;
  }
}

/** How good a day's breeze is for going out: none in a calm, most in a fresh breeze, fewer in a gale. */
const goodWind = (speed: number): number => smoothstep(0.6, 2.5, speed) * (1 - smoothstep(9, 15, speed));

function sailDay(h: Habitat, boat: Boat, day: number): Outing | null {
  const { length, daylight } = h.params.day, spec = h.params.life.sailing, fleet = sailingOf(h), b = fleet.basins[boat.basin];
  const rng = new Rng(deriveSeed(boat.seed, day)), dawn = day * length, dusk = dawn + daylight * length;
  const breeze = breezeAt(h, dawn + daylight * length * 0.6);
  if (!(rng.float() < spec.outings * goodWind(Math.hypot(breeze.along, breeze.around)))) return null;
  const start = dawn + daylight * length * rng.range(0.1, 0.8), end = Math.min(start + spec.stay * rng.range(0.5, 1.5), dusk - daylight * length * 0.02);
  if (end - start < 600) return null;
  const margin = seaRoom(b, boat.kind), mouth = boat.out;
  // The course: marks in its water, set by the wind when it casts off.
  const w0 = windAt(h, start, basinPoint(b, mouth.u, mouth.v).theta, basinPoint(b, mouth.u, mouth.v).s);
  const up = headingOf(-w0.around, -w0.along), marks: { u: number; v: number }[] = [];
  const toward = (u: number, v: number, heading: number, share: number): { u: number; v: number } => {
    const r = runIn(b, u, v, heading, margin) * share;
    return { u: u + Math.sin(heading) * r, v: v + Math.cos(heading) * r };
  };
  const cruise = (from: { u: number; v: number }): { u: number; v: number } => toward(from.u, from.v, rng.range(0, TURN), rng.range(0.3, 0.85));
  const roll = rng.float();
  let more: (marks: { u: number; v: number }[]) => { u: number; v: number };
  if (b.half && boat.kind !== 'skiff' && roll < 0.3) {
    // A passage: far round the ring lake one way, then on from point to point.
    const way = rng.chance(0.5) ? 1 : -1, far = way * rng.range(0.3, 0.9) * b.half.around;
    marks.push({ u: far, v: rng.range(-0.5, 0.5) * (b.half.across - margin) });
    more = (m) => cruise(m[m.length - 1]);
  } else if (roll < 0.65) {
    // A race: laps round a windward and a leeward mark, as many as the time allows.
    const mid = toward(mouth.u, mouth.v, up + Math.PI, 0.5), top = toward(mid.u, mid.v, up, rng.range(0.6, 0.9)), bottom = toward(mid.u, mid.v, up + Math.PI, rng.range(0.4, 0.8));
    more = (m) => (m.length % 2 ? bottom : top);
  } else {
    // A cruise from point to point of the water.
    more = (m) => cruise(m.length ? m[m.length - 1] : mouth);
  }
  return sail(h, b, boat, (k) => { while (marks.length <= k) marks.push(more(marks)); return marks[k]; }, start, end);
}

/**
 * Sail a course from the berth, mark after mark (`markAt`, as many as it takes), from `start`, heading home in time to
 * be in its berth by `end`: out of the harbour on its drive first, and back into it the same way at the end.
 */
function sail(h: Habitat, b: Basin, boat: Boat, markAt: (k: number) => { u: number; v: number }, start: number, end: number): Outing {
  const bs = BOAT_KINDS[boat.kind], margin = seaRoom(b, boat.kind), round = bs.length * ROUND, mouth = boat.out;
  const legs: number[] = [];
  let u = boat.home.u, v = boat.home.v, t = start, heading = NaN, side = 1, k = 0, homeward = false, stuck = 0;
  const leg = (heading: number, speed: number, flags: number): void => { legs.push(t - start, u, v, heading, speed, flags); };
  const berthed = boat.harbour >= 0, docking = berthed ? Math.hypot(mouth.u - boat.home.u, mouth.v - boat.home.v) / bs.motor + bs.turn : 0;
  if (berthed) {
    // Out of the harbour, bow first, on its drive.
    leg(boat.berthHeading, bs.motor, MOTOR);
    t += Math.hypot(mouth.u - u, mouth.v - v) / bs.motor;
    u = mouth.u; v = mouth.v; heading = boat.berthHeading;
  }
  for (let step = 0; step < MOST_LEGS * 4 && legs.length / LEG_FIELDS < MOST_LEGS; step++) {
    const target = homeward ? mouth : markAt(k);
    const du = target.u - u, dv = target.v - v, d = Math.hypot(du, dv);
    if (d < round) {
      if (target === mouth) break;
      k++;
      continue;
    }
    // Time to head home: as long as the way back took at a quarter of its top speed, and berthing.
    if (!homeward && t + Math.hypot(mouth.u - u, mouth.v - v) / (bs.top * 0.25) + docking > end) { homeward = true; continue; }
    if (t > end + 3600) break;
    const at = basinPoint(b, u, v), wind = windAt(h, t, at.theta, at.s), tws = Math.hypot(wind.along, wind.around);
    const upwind = headingOf(-wind.around, -wind.along), bearing = headingOf(du, dv), off = angleDiff(0, bearing - upwind);
    let want = bearing, run = d;
    if (tws >= CALM && (Math.abs(off) < bs.beat || Math.abs(off) > bs.deep)) {
      // Not to be laid straight: on two headings either side of the wind (beating, or gybing downwind), the share of
      // the way on each from the target's place between them; this tack (or gybe) while it still gets closer.
      const angle = Math.abs(off) < bs.beat ? bs.beat : bs.deep;
      const hA = upwind + angle, hB = upwind - angle;
      const ax = Math.sin(hA), ay = Math.cos(hA), bx = Math.sin(hB), by = Math.cos(hB), det = ax * by - ay * bx;
      const onA = (du * by - dv * bx) / det, onB = (ax * dv - ay * du) / det;
      if ((side > 0 ? onA : onB) <= round * 0.5) side = -side;
      want = side > 0 ? hA : hB;
      run = Math.max(side > 0 ? onA : onB, 0);
    }
    const room = runIn(b, u, v, want, margin);
    if (room < 1) {
      // At the edge of the water: about (tack or gybe), or, twice over, back toward the middle.
      // (Toward the middle as near as it can sail.)
      if (++stuck > 2) {
        const off = angleDiff(0, headingOf(-u, -v) - upwind), clamp = Math.min(bs.deep, Math.max(bs.beat, Math.abs(off)));
        want = upwind + (off < 0 ? -clamp : clamp); run = Math.max(Math.hypot(u, v) * 0.5, round);
      } else { side = -side; continue; }
    } else stuck = 0;
    const at2 = tws >= CALM ? sailSpeed(h, b, boat.kind, wind, want) : { speed: DRIFT, foiling: false };
    const speed = Math.max(at2.speed, DRIFT);
    // A tack or gybe first, where it turns through the wind's eye or its tail: slower, on the way round.
    if (Number.isFinite(heading) && Math.abs(angleDiff(0, want - heading)) > 30 * DEG) {
      const through = Math.min(speed * TURNING * bs.turn, runIn(b, u, v, want, margin));
      leg(want, through / bs.turn, TURNING_LEG | (tackOf(wind, want, speed) > 0 ? STARBOARD : 0));
      u += Math.sin(want) * through; v += Math.cos(want) * through; t += bs.turn;
      // (Round, it looks at the wind again.)
      heading = want;
      continue;
    }
    const go = Math.min(run, runIn(b, u, v, want, margin), speed * LEG);
    if (go <= 0) { heading = want; continue; }
    heading = want;
    leg(want, speed, (at2.foiling ? FOILING : 0) | (tackOf(wind, want, speed) > 0 ? STARBOARD : 0));
    u += Math.sin(want) * go; v += Math.cos(want) * go; t += go / speed;
  }
  if (berthed) {
    // In to the harbour's mouth on its drive, round on the spot to face out, and astern into its berth.
    const to = Math.hypot(mouth.u - u, mouth.v - v);
    if (to > 0.01) { heading = headingOf(mouth.u - u, mouth.v - v); leg(heading, bs.motor, MOTOR); t += to / bs.motor; u = mouth.u; v = mouth.v; }
    leg(boat.berthHeading, 0, MOTOR | SPIN);
    t += bs.turn;
    leg(boat.berthHeading, bs.motor, MOTOR | ASTERN);
    t += Math.hypot(boat.home.u - u, boat.home.v - v) / bs.motor;
    u = boat.home.u; v = boat.home.v; heading = boat.berthHeading;
  }
  leg(Number.isFinite(heading) ? heading : 0, 0, berthed ? MOTOR : 0);
  return { start, end: t, legs: Float32Array.from(legs), count: legs.length / LEG_FIELDS };
}

/** A boat at a moment. */
export interface BoatState {
  boat: Boat;
  theta: number;
  s: number;
  /** Its water's surface (height above the profile). */
  level: number;
  /** Where its bow points (0: along +s, π/2: spinward) and how fast it goes (m/s; backwards when `astern`). */
  heading: number;
  speed: number;
  /** Out (false: lying at its berth, bow out, or at its buoy, head to wind). */
  sailing: boolean;
  /** Going about (a tack or gybe), flying on its foils. */
  turning: boolean;
  foiling: boolean;
  /** On its drive in or out of its harbour, its wing feathered; going astern into its berth. */
  motoring: boolean;
  astern: boolean;
  /** The wind over its starboard side (+1) or its port side (−1), and how far it heels (rad, to leeward positive). */
  tack: 1 | -1;
  heel: number;
  /** The true wind where it is (m/s). */
  wind: { along: number; around: number };
}

/** Where a boat is and what it is doing at clock time `t` (s). */
export function boatAt(h: Habitat, boat: Boat, t: number): BoatState {
  const b = sailingOf(h).basins[boat.basin], bs = BOAT_KINDS[boat.kind], day = dayNumber(h, t);
  const o = outingOf(h, boat, day);
  let u = boat.home.u, v = boat.home.v, heading = boat.berthHeading, speed = 0, sailing = false, turning = false, foiling = false, motoring = false, astern = false, side: -1 | 0 | 1 = 0;
  if (o && t >= o.start && t < o.end) {
    const L = o.legs, dt = t - o.start;
    // The leg it is on: the last one started.
    let lo = 0, hi = o.count - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid * LEG_FIELDS] <= dt) lo = mid; else hi = mid - 1; }
    const i = lo * LEG_FIELDS, into = dt - L[i], flags = L[i + 5];
    heading = L[i + 3]; speed = L[i + 4]; sailing = true;
    turning = (flags & TURNING_LEG) !== 0; foiling = (flags & FOILING) !== 0; motoring = (flags & MOTOR) !== 0; astern = (flags & ASTERN) !== 0;
    const way = astern ? -1 : 1;
    u = L[i + 1] + Math.sin(heading) * speed * into * way; v = L[i + 2] + Math.cos(heading) * speed * into * way;
    // Going about, or turning on the spot, the bow swings round from the last heading to the new one.
    if ((turning || (flags & SPIN) !== 0) && lo > 0) heading = L[i - LEG_FIELDS + 3] + angleDiff(0, heading - L[i - LEG_FIELDS + 3]) * Math.min(1, into / bs.turn);
    const held = turning && lo > 0 && into < bs.turn / 2 ? L[i - LEG_FIELDS + 5] : flags;
    if (!motoring && !((held & MOTOR) !== 0)) side = (held & STARBOARD) !== 0 ? 1 : -1;
  }
  const at = basinPoint(b, u, v), wind = windAt(h, t, at.theta, at.s);
  if (!Number.isFinite(heading)) heading = headingOf(-wind.around, -wind.along);
  // The wind over the boat: the true wind less its own way; heeling with the push across it, to leeward (not on its drive).
  const own = astern ? -speed : speed;
  const au = wind.around - Math.sin(heading) * own, av = wind.along - Math.cos(heading) * own;
  const across = (-au) * Math.cos(heading) - (-av) * Math.sin(heading), aws = Math.hypot(au, av);
  // Under sail, the side its leg was planned on (going about, the last leg's until halfway round); else as the wind is now.
  const tack: 1 | -1 = side !== 0 ? side : across >= 0 ? 1 : -1;
  const push = sailing && !motoring ? Math.min(1, (aws / (bs.top * 0.9)) ** 2) * Math.min(1, Math.abs(across) / Math.max(aws, 1e-6) * 1.5) : 0;
  return { boat, theta: at.theta, s: at.s, level: b.level, heading: angleDiff(0, heading), speed, sailing, turning, foiling, motoring, astern, tack, heel: bs.heel * push * (foiling ? -0.5 : 1), wind };
}

/** The boats within `reach` m of (θ, s) at clock time `t`, nearest first. */
export function boatsNear(h: Habitat, t: number, theta: number, s: number, reach: number): BoatState[] {
  const R = h.radius, out: { at: BoatState; d: number }[] = [];
  const fleet = sailingOf(h);
  for (const boat of fleet.boats) {
    const b = fleet.basins[boat.basin];
    // (A basin wholly out of reach is passed by.)
    if (Math.abs(b.s - s) > reach + b.length + b.width) continue;
    const at = boatAt(h, boat, t), d = Math.hypot(angleDiff(0, at.theta - theta) * R, at.s - s);
    if (d <= reach) out.push({ at, d });
  }
  return out.sort((a, b) => a.d - b.d).map((x) => x.at);
}
