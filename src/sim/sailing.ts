/**
 * Sailing (Arnd 2026-10-23: "sail boats, slick and futuristic", on the lakes and on the ring lake). Which boats the
 * habitat has, on which water, and where each one is at a clock time: pure functions of the seed, the plan and the
 * clock, as the people and the deer are.
 *
 * The water. Every stretch of open water a boat can sail is a `Basin`: the ring lake (a band round the whole cylinder,
 * cut where the lake pavilion's bridges cross it, so a boat sails round the habitat from one side of the pavilion to
 * the other) and each lake on the floor (`Landform.meres`). A basin's sailing water is convex and kept clear of its
 * shore (a lake's bays and headlands lie outside it), so a straight leg between two points in it never touches land.
 *
 * The boats. Three designs, each a real sailing machine a thousand years on (`BOAT_KINDS`): a two-person skiff with a
 * wing sail, a foiling trimaran that lifts out of the water once it is fast enough, and a glass-roofed catamaran for
 * an afternoon out with friends. How many: `HabitatParams.life.sailing.boats` per km² of water, at least one on any
 * water a skiff has room on; which design by the room the water gives (a foiler needs space to get going).
 *
 * The day. Each boat goes out on a day by `sailing.outings`, less often in a calm or a gale (`breezeAt`), sometime in
 * the light hours for about `sailing.stay`: a race round marks set upwind and downwind of its mooring, a cruise
 * between points of the water, or on the ring lake a passage far round the cylinder and back. It sails each leg as a
 * sailor would: straight at a mark it can lay; upwind on the better tack until the mark is on the other tack's line or
 * the water ends, then tacks; deep downwind it gybes between broad reaches. The wind is looked up every `LEG` seconds
 * where the boat is (`windAt`: the breeze, the sun's draw and the gusts), so boats lift and head with the shifts. A
 * tack or gybe costs time (`turn`). Back at its mooring it lies head to wind. A day is sailed once, when first asked,
 * and kept (`Outing`, a few kB, a bounded cache).
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
import { kept } from '../gen/kept';
import { MERE, planOf, siteOf, type Mere } from '../gen/plan';
import { dayNumber } from '../world/sunline';
import { breezeAt, windAt } from '../world/wind';
import { BOAT_KINDS, BOAT_KIND_LIST, type BoatKind, type BoatSpec } from '../gen/boat';

const TURN = 2 * Math.PI;
const DEG = Math.PI / 180;

export { BOAT_KINDS, BOAT_KIND_LIST, type BoatKind, type BoatSpec };
const KINDS = BOAT_KIND_LIST;

/** The wind angle (rad from upwind) a boat goes fastest at for its wind. */
const BEST = 106 * DEG;
/** How fast a boat goes through a tack or gybe, as a share of its speed. */
const TURNING = 0.4;
/** How often a sailor looks at the wind again (s): the longest leg. */
const LEG = 90;
/** How far a boat keeps off the shore of its water: this many of its own lengths, at most this share of the water's width. */
const SEA_ROOM = 3, SEA_SHARE = 0.15;
/** How near a mark counts as rounding it, in boat lengths. */
const ROUND = 2;
/** The most legs a day's sailing may take (a guard; a day takes a few hundred). */
const MOST_LEGS = 4000;
/** Below this true wind (m/s) a boat ghosts along at `DRIFT` straight for where it is going. */
const CALM = 0.4;
const DRIFT = 0.3;

/**
 * A stretch of sailing water, in its own flat frame: `u` m around the axis (spinward) and `v` m along it from its
 * middle (θ, s). Its water stands `level` m above the profile.
 */
export interface Basin {
  id: number;
  kind: 'ring' | 'great' | 'mere';
  theta: number;
  s: number;
  level: number;
  /** Its narrowest and longest stretch of sailing water (m), and its area (m²). */
  width: number;
  length: number;
  area: number;
  /** The radius its frame is unrolled at (m). */
  radius: number;
  /** The ring lake: half its width, and half the length round from the pavilion's one side to its other (m). */
  half?: { across: number; around: number };
  /** A lake on the floor. */
  mere?: Mere;
}

/** Whether a point of a basin's frame lies in its sailing water, `margin` m clear of its edge. */
export function inBasin(b: Basin, u: number, v: number, margin: number): boolean {
  if (b.half) return Math.abs(v) <= b.half.across - margin && Math.abs(u) <= b.half.around - margin;
  const m = b.mere!, x = v * m.cos + u * m.sin, y = u * m.cos - v * m.sin;
  // The lake's outline with its bays drawn in all the way (they lie outside), and the margin, inside its shore.
  const q = 1 - m.wild * MERE.bays - margin / m.across;
  if (q <= 0) return false;
  const p = m.power, qx = Math.abs(x) / m.along, qy = Math.abs(y) / m.across;
  return Math.pow(qx, p) + Math.pow(qy, p) <= Math.pow(q, p);
}

/** How far a straight line from a point of a basin (in its water) runs in its water, `margin` m clear of the edge. */
export function runIn(b: Basin, u: number, v: number, heading: number, margin: number): number {
  const du = Math.sin(heading), dv = Math.cos(heading);
  let lo = 0, hi = b.length + b.width;
  if (!inBasin(b, u, v, margin)) return 0;
  if (inBasin(b, u + du * hi, v + dv * hi, margin)) return hi;
  // The water is convex: one crossing out along the line.
  for (let i = 0; i < 40 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    if (inBasin(b, u + du * mid, v + dv * mid, margin)) lo = mid; else hi = mid;
  }
  return lo;
}

/** How far a boat of a kind keeps off the shore of a basin's water (m). */
const seaRoom = (b: Basin, kind: BoatKind): number => Math.min(BOAT_KINDS[kind].length * SEA_ROOM, b.width * SEA_SHARE);

/** A point of a basin's frame on the floor (θ, s). */
export const basinPoint = (b: Basin, u: number, v: number): { theta: number; s: number } => ({ theta: b.theta + u / b.radius, s: b.s + v });

export interface Boat {
  id: number;
  kind: BoatKind;
  basin: number;
  /** Its mooring, in its basin's frame. */
  home: { u: number; v: number };
  seed: number;
}

export interface Fleet {
  basins: readonly Basin[];
  boats: readonly Boat[];
}

/** Which designs each kind of water is given, by weight (where there is room for them). */
const MIX: Record<Basin['kind'], Record<BoatKind, number>> = {
  ring: { skiff: 0.4, foiler: 0.35, cruiser: 0.25 },
  great: { skiff: 0.4, foiler: 0.3, cruiser: 0.3 },
  mere: { skiff: 0.7, foiler: 0.1, cruiser: 0.2 },
};

/** The habitat's sailing water and its boats, made once per habitat and kept. */
export const sailingOf: (h: Habitat) => Fleet = kept(makeSailing);

function makeSailing(h: Habitat): Fleet {
  const plan = planOf(h), R = h.radius, basins: Basin[] = [];
  const lake = plan.lake;
  if (lake) {
    // Cut where the Sunwalk crosses on the pavilion's bridges: the frame's middle is round the far side from them.
    const pavilion = siteOf(plan, 'lake-pavilion'), cut = pavilion ? pavilion.theta : 0;
    const clear = pavilion ? pavilion.size * 1.5 : 0, around = Math.PI * R - clear;
    basins.push({
      id: basins.length, kind: 'ring', theta: cut + Math.PI, s: lake.s, level: lake.level, radius: R,
      width: lake.halfWidth * 2, length: around * 2, area: lake.halfWidth * 2 * around * 2, half: { across: lake.halfWidth, around },
    });
  }
  for (const m of plan.meres) {
    const q = 1 - m.wild * MERE.bays;
    basins.push({ id: basins.length, kind: m.kind === 'great' ? 'great' : 'mere', theta: m.theta, s: m.s, level: m.level, radius: R, width: 2 * m.across * q, length: 2 * m.along * q, area: Math.PI * m.along * m.across * q * q, mere: m });
  }
  const spec = h.params.life.sailing, boats: Boat[] = [];
  for (const b of basins) {
    const rng = new Rng(deriveSeed(h.seed, 'sailing', 'fleet', b.id));
    const fits = KINDS.filter((k) => b.width >= BOAT_KINDS[k].room * BOAT_KINDS[k].length);
    if (!fits.length || spec.boats <= 0) continue;
    const count = Math.max(1, Math.floor((b.area / 1e6) * spec.boats + rng.float()));
    const weights = fits.map((k) => MIX[b.kind][k]), sum = weights.reduce((a, w) => a + w, 0);
    for (let n = 0; n < count; n++) {
      let pick = rng.float() * sum, kind = fits[fits.length - 1];
      for (let i = 0; i < fits.length; i++) { pick -= weights[i]; if (pick < 0) { kind = fits[i]; break; } }
      // Its mooring: in from the shore of its water a few lengths, somewhere round it (on the ring lake, along a shore).
      const margin = seaRoom(b, kind);
      let home: { u: number; v: number };
      if (b.half) home = { u: rng.range(-1, 1) * (b.half.around - margin * 4), v: (rng.chance(0.5) ? 1 : -1) * (b.half.across - margin * 1.2) };
      else {
        const a = rng.range(0, TURN), r = runIn(b, 0, 0, a, margin);
        home = { u: Math.sin(a) * r, v: Math.cos(a) * r };
      }
      boats.push({ id: boats.length, kind, basin: b.id, home, seed: deriveSeed(h.seed, 'sailing', 'boat', boats.length) });
    }
  }
  return { basins, boats };
}

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
  /** Legs, `LEG_FIELDS` floats each: start (s after `start`), u, v, heading, speed, flags (`TURNING_LEG`, `FOILING`). */
  legs: Float32Array;
  count: number;
}
const LEG_FIELDS = 6;
const TURNING_LEG = 1, FOILING = 2;

/** One leg of an outing: when it starts (s after the outing's), where, which way, how fast, going about or flying. */
export interface Leg {
  t: number;
  u: number;
  v: number;
  heading: number;
  speed: number;
  turning: boolean;
  foiling: boolean;
}

/** An outing's legs, read out (for tests and the debug menu). */
export function legsOf(o: Outing): Leg[] {
  const out: Leg[] = [], L = o.legs;
  for (let i = 0; i < o.count * LEG_FIELDS; i += LEG_FIELDS) {
    out.push({ t: L[i], u: L[i + 1], v: L[i + 2], heading: L[i + 3], speed: L[i + 4], turning: (L[i + 5] & TURNING_LEG) !== 0, foiling: (L[i + 5] & FOILING) !== 0 });
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
  const margin = seaRoom(b, boat.kind);
  // The course: marks in its water, set by the wind when it casts off.
  const w0 = windAt(h, start, basinPoint(b, boat.home.u, boat.home.v).theta, basinPoint(b, boat.home.u, boat.home.v).s);
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
    const mid = toward(boat.home.u, boat.home.v, up + Math.PI, 0.5), top = toward(mid.u, mid.v, up, rng.range(0.6, 0.9)), bottom = toward(mid.u, mid.v, up + Math.PI, rng.range(0.4, 0.8));
    more = (m) => (m.length % 2 ? bottom : top);
  } else {
    // A cruise from point to point of the water.
    more = (m) => cruise(m.length ? m[m.length - 1] : boat.home);
  }
  return sail(h, b, boat, (k) => { while (marks.length <= k) marks.push(more(marks)); return marks[k]; }, start, end);
}

/**
 * Sail a course from the mooring, mark after mark (`markAt`, as many as it takes), from `start`, heading home in time
 * to be moored by `end`.
 */
function sail(h: Habitat, b: Basin, boat: Boat, markAt: (k: number) => { u: number; v: number }, start: number, end: number): Outing {
  const bs = BOAT_KINDS[boat.kind], margin = seaRoom(b, boat.kind), round = bs.length * ROUND;
  const legs: number[] = [];
  let u = boat.home.u, v = boat.home.v, t = start, heading = NaN, side = 1, k = 0, homeward = false, stuck = 0;
  const leg = (heading: number, speed: number, flags: number): void => { legs.push(t - start, u, v, heading, speed, flags); };
  for (let step = 0; step < MOST_LEGS * 4 && legs.length / LEG_FIELDS < MOST_LEGS; step++) {
    const target = homeward ? boat.home : markAt(k);
    const du = target.u - u, dv = target.v - v, d = Math.hypot(du, dv);
    if (d < round) {
      if (target === boat.home) break;
      k++;
      continue;
    }
    // Time to head home: as long as the way back took at a quarter of its top speed.
    if (!homeward && t + Math.hypot(boat.home.u - u, boat.home.v - v) / (bs.top * 0.25) > end) { homeward = true; continue; }
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
      leg(want, through / bs.turn, TURNING_LEG);
      u += Math.sin(want) * through; v += Math.cos(want) * through; t += bs.turn;
      // (Round, it looks at the wind again.)
      heading = want;
      continue;
    }
    const go = Math.min(run, runIn(b, u, v, want, margin), speed * LEG);
    if (go <= 0) { heading = want; continue; }
    heading = want;
    leg(want, speed, at2.foiling ? FOILING : 0);
    u += Math.sin(want) * go; v += Math.cos(want) * go; t += go / speed;
  }
  leg(Number.isFinite(heading) ? heading : 0, 0, 0);
  return { start, end: t, legs: Float32Array.from(legs), count: legs.length / LEG_FIELDS };
}

/** A boat at a moment. */
export interface BoatState {
  boat: Boat;
  theta: number;
  s: number;
  /** Its water's surface (height above the profile). */
  level: number;
  /** Where its bow points (0: along +s, π/2: spinward) and how fast it goes (m/s). */
  heading: number;
  speed: number;
  /** Out sailing (false: lying at its mooring, head to wind). */
  sailing: boolean;
  /** Going about (a tack or gybe), flying on its foils. */
  turning: boolean;
  foiling: boolean;
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
  let u = boat.home.u, v = boat.home.v, heading = NaN, speed = 0, sailing = false, turning = false, foiling = false;
  if (o && t >= o.start && t < o.end) {
    const L = o.legs, dt = t - o.start;
    // The leg it is on: the last one started.
    let lo = 0, hi = o.count - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid * LEG_FIELDS] <= dt) lo = mid; else hi = mid - 1; }
    const i = lo * LEG_FIELDS, into = dt - L[i];
    heading = L[i + 3]; speed = L[i + 4]; sailing = true;
    turning = (L[i + 5] & TURNING_LEG) !== 0; foiling = (L[i + 5] & FOILING) !== 0;
    u = L[i + 1] + Math.sin(heading) * speed * into; v = L[i + 2] + Math.cos(heading) * speed * into;
    // Going about, the bow swings round from the last heading to the new one.
    if (turning && lo > 0) heading = L[i - LEG_FIELDS + 3] + angleDiff(0, heading - L[i - LEG_FIELDS + 3]) * Math.min(1, into / bs.turn);
  }
  const at = basinPoint(b, u, v), wind = windAt(h, t, at.theta, at.s);
  if (!Number.isFinite(heading)) heading = headingOf(-wind.around, -wind.along);
  // The wind over the boat: the true wind less its own way; heeling with the push across it, to leeward.
  const au = wind.around - Math.sin(heading) * speed, av = wind.along - Math.cos(heading) * speed;
  const across = (-au) * Math.cos(heading) - (-av) * Math.sin(heading), aws = Math.hypot(au, av);
  const tack: 1 | -1 = across >= 0 ? 1 : -1;
  const push = sailing ? Math.min(1, (aws / (bs.top * 0.9)) ** 2) * Math.min(1, Math.abs(across) / Math.max(aws, 1e-6) * 1.5) : 0;
  return { boat, theta: at.theta, s: at.s, level: b.level, heading: angleDiff(0, heading), speed, sailing, turning, foiling, tack, heel: bs.heel * push * (foiling ? -0.5 : 1), wind };
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
