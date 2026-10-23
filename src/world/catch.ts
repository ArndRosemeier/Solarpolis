/**
 * A catch (design "Nobody falls far"): the habitat's Mind has foreseen a fall that would hurt (world/fall.ts), and the
 * guardians posted along the drop (world/posts.ts) catch it. A plan made once, the moment the fall is seen, and then a
 * pure function of time, as a capsule's flight is (world/capFlight.ts):
 *
 *   launch    a moment after the Mind sees it, `Guard.hands` guardians leave their posts;
 *   join      each flies to a point beside the body, arriving with its velocity (a cubic from rest at the post, its
 *             acceleration within the fans' `thrust` beyond holding it up, its speed within `speed`): they fall with it;
 *   meet      they close in and take hold (soft bands round chest and thighs), once the body is within `late` m of what
 *             it would land on (at once for an ordinary fall; late for the Long Drop off the Threshold);
 *   stop      they slow it to rest in a straight line, at most `brake` floor gravities as felt (the bands' pull with the
 *             spin's weight); a fall caught so low that this would not stop it in the air is slowed harder, never
 *             let land;
 *   carry     they fly it, over the ground and whatever stands on it, to where it is set down: back on the edge it went
 *             over, or (a late catch) the nearest open ground; then lower it onto its feet and let go;
 *   home      they fly back to their posts.
 *
 * Everything is in the habitat's turning frame (world axes); the guardians' thrust holds them against the spin's
 * gravity and the Coriolis force (`apparentAcceleration`). Pure.
 */
import { smoothstep, v3cross, v3dot, v3madd, v3norm } from '@futuremagic/core';
import { apart, fromWorld, toWorld, wrapAngle, type Guard, type Habitat, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { fallAt, fallOf, footingNormal, footingOf, gapOf, harmful, hermite, type Fall, type FallPoint, type Footing } from './fall';
import { apparentAcceleration, spinwardAt, upAt } from './motion';
import { postsNear, type Post } from './posts';

/** The Mind sees a fall and the guardians leave their posts this long after it starts (s). */
export const REACTION = 0.3;
/** The shortest flight from a post to a faller (s); the guardians close in from beside it over this long (s). */
const SHORTEST = 0.4;
const CLOSE = 0.7;
/** They fall beside the body this far out (m) before closing in, and hold it from either side and above its feet (m). */
const ESCORT = 4;
const GRIP_SIDE = 0.7;
const GRIP_UP = 1.75;
/** Held at rest this long (s) before they carry it; carried this high over what stands below (m), at most this steeply. */
const HOVER = 0.6;
const CLEAR = 3;
const CLIMB = 1;
/** They lower the body onto its feet from this high (m), and the bands let go over this long (s). */
const LIFT = 0.6;
const LET_GO = 0.8;
/** A stop leaves at least this much air under the feet (m, about a body's height); the way along the brake is searched in steps this long (m). */
const MARGIN = 2;
const RAY_STEP = 1;
/** Ground this steep (radians from up) or wet is no place to set someone down; searched out to this far (m), this finely. */
const SET_DOWN_SLOPE = (30 * Math.PI) / 180;
const SEARCH = 240;
const SEARCH_STEP = 6;
/** The bag: at least this tall and wide (m), this wide for its height, squashed to this under a body at rest (m),
 * up from the ground in this long plus its height over this pace (s, m/s), holding the body this long before letting
 * it down over this long, spreading at most this much as it squashes, folded away this long after (s). */
const BAG_LEAST = 2.5;
const BAG_WIDE = 0.7;
const BAG_REST = 0.9;
const BAG_BURST = 0.15;
const BAG_RISE = 40;
const BAG_HOLD = 1.2;
const BAG_DOWN = 2.5;
const BAG_SPREAD = 1.35;
const BAG_FOLD = 8;
/** Guardians fly home at this share of their top speed. */
const HOMEWARD = 0.4;

export type CatchPhase = 'falling' | 'closing' | 'holding' | 'carrying' | 'lowering' | 'released';

/** One guardian's part: its post, which side it holds from (±1), when it reaches the body and where (beside it, with its velocity). */
export interface GuardianPlan {
  post: Post;
  side: number;
  join: FallPoint;
}

/** Where the body is set down: its (θ, s), its feet (world), the way it faces (world, along the ground). */
export interface SetDown {
  theta: number;
  s: number;
  feet: Vec3;
  front: Vec3;
}

/** A catch, from the moment the fall was seen (t = 0). Times in s. */
export interface CatchPlan {
  fall: Fall;
  guardians: GuardianPlan[];
  launch: number;
  join: number;
  meet: number;
  /** At rest, held: when, and where (feet, world). */
  stop: number;
  rest: Vec3;
  /** The brake's way (unit), its deceleration (m/s²), and what it feels like (in floor gravities). */
  brakeDir: Vec3;
  brake: number;
  felt: number;
  /** The way carried, feet points (world) with the time each is reached; the last is the set-down. */
  way: Vec3[];
  wayTimes: number[];
  setDown: SetDown;
  /** The bands let go (the player stands), and the guardians are home again. */
  end: number;
  home: number;
  /** Sideways (unit, world): the guardians come in from ± this. */
  across: Vec3;
  /** How far the body would have fallen (m, down the spin's gravity), and whether it was a late catch. */
  depth: number;
  late: boolean;
  /** The ground's bag, where it took the fall instead of guardians. */
  bag: BagPlan | null;
}

/** The body and its guardians at one moment of a catch. */
export interface CatchState {
  phase: CatchPhase;
  feet: Vec3;
  v: Vec3;
  /** Each guardian's centre of its bands (world) and velocity. */
  guardians: { at: Vec3; v: Vec3 }[];
}

/** What a plan needs besides the fall: how late to take hold (m over the footing; 0: at once), where to set down. */
export interface CatchOptions {
  late: number;
  /** Where to set the body down (θ, s; the edge it went over), or null: the nearest open ground under where it stops. */
  home: { theta: number; s: number } | null;
}

/**
 * The last resort, where no guardian is close enough to catch a fall gently (Arnd, 2026-10-23: "an airbag, out of the
 * ground"): the ground bursts a bag under where the body comes down. Its site (the ground under the stop, world), up
 * (away from the axis's pull), size when full (m), and its moments: it bursts, is full, takes the body, holds it at rest,
 * lets it down and folds back into the ground.
 */
export interface BagPlan {
  site: Vec3;
  up: Vec3;
  height: number;
  radius: number;
  burst: number;
  full: number;
  touch: number;
  rest: number;
  down: number;
  gone: number;
}

/** Guardians look this many post spacings round where the fall starts. */
export const POST_REACH = 2.5;

/**
 * Everything at once, as the worker does it when the player leaves the ground: the fall foreseen from `p` at `v`
 * (`drag`: the body's drag area over its mass), and if it would hurt, its catch; else null.
 */
export function catchFor(terrain: Terrain, p: Vec3, v: Vec3, drag: number, options: CatchOptions): CatchPlan | null {
  const h = terrain.habitat, footing = footingOf(terrain), fall = fallOf(h, footing, p, v, drag);
  if (!harmful(fall, h.params.life.guard)) return null;
  const at = fromWorld(h.profile, p[0], p[1], p[2]);
  return planCatch(h, footing, fall, postsNear(h, footing, at.theta, at.s, POST_REACH * h.params.life.guard.posts), options);
}

/**
 * Plan the catch of a fall that would hurt. The guardians at the `posts` nearest its start fly (a late catch, the Long
 * Drop, has them beside the body from the start: they go with whoever takes it); the first moment they can all be
 * beside it that leaves room to stop it gently is taken. If there is none, or no post near, the ground's bag takes it.
 */
export function planCatch(h: Habitat, footing: Footing, fall: Fall, posts: readonly Post[], options: CatchOptions): CatchPlan {
  const guard = h.params.life.guard, start = fall.path[0], end = fall.lands ? fall.lands.t : fall.path[fall.path.length - 1].t;
  const floorG = h.gravityAt(h.radius);
  // When the body first comes within `late` m of what it would land on (late catches wait for it).
  let lateAt = 0;
  if (options.late > 0) {
    lateAt = end;
    for (const q of fall.path) if (gapOf(h, footing, q.p) <= options.late) { lateAt = q.t; break; }
  }
  const besideStart = (k: number): Post => {
    const p = v3madd(start.p, acrossAt(start), sideOf(k) * ESCORT), at = fromWorld(h.profile, p[0], p[1], p[2]);
    return { p, theta: at.theta, s: at.s, drop: 0, toward: 0 };
  };
  const chosen = options.late > 0 ? Array.from({ length: guard.hands }, (_, k) => besideStart(k)) : posts.slice(0, guard.hands);
  while (chosen.length > 0 && chosen.length < guard.hands) chosen.push(chosen[chosen.length - 1]);
  const launch = Math.min(REACTION, end);
  let best: { join: number; meet: number; brake: number; targets: FallPoint[]; across: Vec3 } | null = null;
  // The gentle brake from the body's moment at `meet`, if it stops clear of the ground (and a body's height more).
  const brakeFits = (meet: number): number | null => {
    const m = fallAt(fall, meet), speed = Math.hypot(...m.v), gentle = stopBrake(h, guard, m.p, m.v);
    const room = speed > 1e-3 ? rayRoom(h, footing, m.p, v3norm(m.v), (speed * speed) / (2 * Math.min(gentle, 0.5 * floorG)) + 10) - MARGIN : Infinity;
    return room > 0 && (speed * speed) / (2 * room) <= gentle ? gentle : null;
  };
  // Where the guardians join the body at moment q (beside it, the escort's distance out), if all of them reach it in time.
  const joining = (q: FallPoint): { targets: FallPoint[]; across: Vec3 } | null => {
    if (q.t < launch + SHORTEST || q.t + CLOSE >= end) return null;
    const across = acrossAt(q), targets = chosen.map((_, k) => ({ t: q.t, p: v3madd(q.p, across, sideOf(k) * ESCORT), v: q.v }));
    return chosen.every((post: Post, k: number) => reaches(h, guard, { t: launch, p: post.p, v: [0, 0, 0] }, targets[k])) ? { targets, across } : null;
  };
  if (chosen.length > 0 && options.late > 0) {
    // Late: they join as soon as they can and go along; they take hold at the latest moment that still brakes gently
    // before the body is `late` m over the ground.
    let meet = -1, brake = 0;
    for (let k = fall.path.length - 1; k >= 0 && meet < 0; k--) {
      const q = fall.path[k], b = q.t + CLOSE <= lateAt && q.t >= launch + SHORTEST ? brakeFits(q.t + CLOSE) : null;
      if (b !== null) { meet = q.t + CLOSE; brake = b; }
    }
    if (meet > 0) for (const q of fall.path) {
      if (q.t + CLOSE > meet) break;
      const j = joining(q);
      if (j) { best = { join: q.t, meet, brake, ...j }; break; }
    }
  } else if (chosen.length > 0) for (const q of fall.path) {
    // The earliest catch that fits.
    const j = joining(q), brake = j ? brakeFits(q.t + CLOSE) : null;
    if (j && brake !== null) { best = { join: q.t, meet: q.t + CLOSE, brake, ...j }; break; }
  }
  if (!best) return bagCatch(h, footing, fall, options);
  const m = fallAt(fall, best.meet), speed = Math.hypot(...m.v), dir = speed > 1e-3 ? v3norm(m.v) : [0, 0, 0] as Vec3;
  const stopIn = speed > 1e-3 ? speed / best.brake : 0, rest = v3madd(m.p, dir, (speed * stopIn) / 2), stop = best.meet + stopIn;
  const feltG = (best.brake + h.gravityAt(Math.hypot(rest[0], rest[1]))) / floorG;
  const homeAt = (options.home && standable(h, footing, options.home.theta, options.home.s) ? options.home : null)
    ?? standingNear(h, footing, options.home ? toWorld(h.profile, { ...options.home, h: 0 }) : rest)
    ?? fromWorld(h.profile, start.p[0], start.p[1], start.p[2]);
  const setDown = setDownAt(h, footing, homeAt.theta, homeAt.s, rest);
  const { way, times } = carryWay(h, footing, rest, setDown, guard.carry, stop + HOVER);
  const done = times[times.length - 1] + LET_GO;
  const homeFlight = Math.max(...chosen.map((post) => apart(post.p, v3madd(setDown.feet, upAt(setDown.feet) ?? [0, 0, 0], GRIP_UP)))) / (guard.speed * HOMEWARD);
  return {
    fall, launch, join: best.join, meet: best.meet, stop, rest, brakeDir: dir, brake: best.brake, felt: feltG,
    guardians: chosen.map((post, k) => ({ post, side: sideOf(k), join: best!.targets[k] })),
    way, wayTimes: times, setDown, end: done, home: done + Math.max(2, homeFlight), across: best.across,
    depth: depthOf(fall), late: options.late > 0, bag: null,
  };
}

/**
 * The ground's bag: as tall as stopping the body at `cushion` floor gravities (felt) takes, at most `bag` m (a faster
 * fall is stopped harder), so wide that it holds the body wherever it sinks in; it bursts up in time to be full when
 * the body reaches its top, stops it to rest lying on it squashed, lets it down to its feet, and folds away.
 */
function bagCatch(h: Habitat, footing: Footing, fall: Fall, options: CatchOptions): CatchPlan {
  const guard = h.params.life.guard, floorG = h.gravityAt(h.radius), lands = fall.lands ?? fall.path[fall.path.length - 1];
  const vLand = Math.hypot(...lands.v), cushion = Math.max(0.5 * floorG, guard.cushion * floorG - h.gravityAt(Math.hypot(lands.p[0], lands.p[1])));
  const height = Math.min(guard.bag, Math.max(BAG_LEAST, (vLand * vLand) / (2 * cushion) + BAG_REST));
  let touch = lands.t;
  for (const q of fall.path) if (gapOf(h, footing, q.p) <= height) { touch = q.t; break; }
  const m = fallAt(fall, touch), speed = Math.hypot(...m.v), dir = speed > 1e-3 ? v3norm(m.v) : [0, 0, 0] as Vec3;
  // Straight on along its way into the bag, to rest lying on it, squashed to BAG_REST over the ground.
  const sink = Math.max(0.3, rayRoom(h, footing, m.p, dir, height * 3) - BAG_REST), brake = speed > 1e-3 ? Math.max(cushion, (speed * speed) / (2 * sink)) : cushion;
  const stopIn = speed > 1e-3 ? speed / brake : 0, rest = v3madd(m.p, dir, (speed * stopIn) / 2), stop = touch + stopIn;
  const at = fromWorld(h.profile, rest[0], rest[1], rest[2]), ground = footing(at.theta, at.s, at.h).h;
  const site = toWorld(h.profile, { theta: at.theta, s: at.s, h: ground }), up = upAt(site) ?? [1, 0, 0];
  const burst = Math.max(Math.min(REACTION, touch - 0.1), touch - BAG_BURST - height / BAG_RISE), full = Math.max(burst + 0.1, touch - 0.05);
  const setDown = setDownAt(h, footing, at.theta, at.s, fall.path[0].p);
  const down = stop + BAG_HOLD + BAG_DOWN, way = [rest, setDown.feet], times = [stop + BAG_HOLD, down];
  return {
    fall, launch: burst, join: touch, meet: touch, stop, rest, brakeDir: dir, brake, felt: (brake + h.gravityAt(Math.hypot(rest[0], rest[1]))) / floorG,
    guardians: [], way, wayTimes: times, setDown, end: down + LET_GO, home: down + BAG_FOLD, across: acrossAt(m),
    depth: depthOf(fall), late: options.late > 0,
    bag: { site, up, height, radius: Math.max(BAG_LEAST, height * BAG_WIDE), burst, full, touch, rest: stop, down, gone: down + BAG_FOLD },
  };
}

/** How big the bag is at time t of a catch (height and radius, m), or null before it bursts and after it is gone. */
export function bagAt(plan: CatchPlan, t: number): { height: number; radius: number } | null {
  const b = plan.bag;
  if (!b || t < b.burst || t >= b.gone) return null;
  if (t < b.full) {
    const u = (t - b.burst) / Math.max(1e-3, b.full - b.burst), over = 1 + 2.2 * (u - 1) * (u - 1) * (u - 1) + 1.2 * (u - 1) * (u - 1);
    return { height: b.height * Math.max(0.05, over), radius: b.radius * (0.4 + 0.6 * smoothstep(0, 1, u)) };
  }
  if (t < b.touch) return { height: b.height, radius: b.radius };
  if (t < b.down) {
    // Under the body: its top where the feet are, wider as it squashes.
    const feet = bodyAt(plan, t).feet, top = Math.max(0.15, Math.min(b.height, v3dot([feet[0] - b.site[0], feet[1] - b.site[1], feet[2] - b.site[2]], b.up)));
    return { height: top, radius: b.radius * Math.min(BAG_SPREAD, Math.sqrt(b.height / top)) };
  }
  const u = (t - b.down) / Math.max(1e-3, b.gone - b.down);
  return { height: 0.15 * (1 - u), radius: b.radius * BAG_SPREAD * (1 - 0.7 * u) };
}

/** How far a fall would have gone (m, down the spin's gravity: away from the axis). */
function depthOf(fall: Fall): number {
  const a = fall.path[0].p, b = fall.lands?.p ?? fall.path[fall.path.length - 1].p;
  return Math.max(0, Math.hypot(b[0], b[1]) - Math.hypot(a[0], a[1]));
}

/** The body and the guardians at time t of a catch (s from when the fall was seen). */
export function catchAt(plan: CatchPlan, t: number): CatchState {
  const body = bodyAt(plan, t), up = upAt(body.feet) ?? [0, 0, 0];
  const guardians = plan.guardians.map((g) => guardianAt(plan, g, t, body, up));
  return { ...body, guardians };
}

/** The body alone: falling as foreseen, slowed to rest, held, carried, lowered, standing. */
function bodyAt(plan: CatchPlan, t: number): { phase: CatchPhase; feet: Vec3; v: Vec3 } {
  if (t < plan.meet) {
    const q = fallAt(plan.fall, t);
    return { phase: t < plan.join ? 'falling' : 'closing', feet: q.p, v: q.v };
  }
  if (t < plan.stop) {
    const m = fallAt(plan.fall, plan.meet), speed = Math.hypot(...m.v), tau = t - plan.meet;
    return { phase: 'holding', feet: v3madd(m.p, plan.brakeDir, speed * tau - (plan.brake * tau * tau) / 2), v: v3madd([0, 0, 0], plan.brakeDir, speed - plan.brake * tau) };
  }
  const way = plan.way, times = plan.wayTimes, last = times.length - 1;
  if (t < times[0]) return { phase: 'holding', feet: [...plan.rest], v: [0, 0, 0] };
  if (t >= times[last]) return { phase: t < plan.end ? 'lowering' : 'released', feet: [...way[last]], v: [0, 0, 0] };
  let k = 0;
  while (k < last - 1 && times[k + 1] <= t) k++;
  const a = { t: times[k], p: way[k], v: wayVelocity(plan, k) }, b = { t: times[k + 1], p: way[k + 1], v: wayVelocity(plan, k + 1) };
  const q = hermite(a, b, t);
  return { phase: k === last - 1 ? 'lowering' : 'carrying', feet: q.p, v: q.v };
}

/** The velocity at a point of the carried way: zero at its ends, else across its neighbours (a smooth path through them). */
function wayVelocity(plan: CatchPlan, k: number): Vec3 {
  const way = plan.way, times = plan.wayTimes, last = way.length - 1;
  if (k <= 0 || k >= last - 1) return [0, 0, 0];
  const dt = times[k + 1] - times[k - 1];
  return dt > 1e-6 ? [0, 1, 2].map((i) => (way[k + 1][i] - way[k - 1][i]) / dt) as Vec3 : [0, 0, 0];
}

/** One guardian: on its post, flying to the body, beside it closing in, holding it, flying home. */
function guardianAt(plan: CatchPlan, g: GuardianPlan, t: number, body: { feet: Vec3; v: Vec3 }, up: Vec3): { at: Vec3; v: Vec3 } {
  const grip = (feet: Vec3, u: Vec3): Vec3 => v3madd(v3madd(feet, plan.across, g.side * GRIP_SIDE), u, GRIP_UP);
  if (t <= plan.launch) return { at: [...g.post.p], v: [0, 0, 0] };
  if (t < plan.join) { const q = hermite({ t: plan.launch, p: g.post.p, v: [0, 0, 0] }, g.join, t); return { at: q.p, v: q.v }; }
  if (t < plan.meet) {
    // Beside the body, easing in from the escort's distance to the grip.
    const k = smoothstep(Math.max(plan.join, plan.meet - CLOSE), plan.meet, t), out = ESCORT + (GRIP_SIDE - ESCORT) * k;
    return { at: v3madd(v3madd(body.feet, plan.across, g.side * out), up, GRIP_UP * k), v: body.v };
  }
  if (t < plan.end) return { at: grip(body.feet, up), v: body.v };
  const from = grip(plan.setDown.feet, upAt(plan.setDown.feet) ?? up);
  if (t >= plan.home) return { at: [...g.post.p], v: [0, 0, 0] };
  const q = hermite({ t: plan.end, p: from, v: [0, 0, 0] }, { t: plan.home, p: g.post.p, v: [0, 0, 0] }, t);
  return { at: q.p, v: q.v };
}

/**
 * Whether a guardian at rest at `from` reaches `to` (place and velocity, at its time) on a cubic: its acceleration at
 * both ends within the fans' thrust beyond the spin's pull there, its speed along the way within its top speed.
 */
function reaches(h: Habitat, guard: Guard, from: FallPoint, to: FallPoint): boolean {
  const T = to.t - from.t;
  if (T <= 0) return false;
  const d = [0, 1, 2].map((i) => to.p[i] - from.p[i]) as Vec3;
  const a0 = [0, 1, 2].map((i) => (6 * d[i] - 2 * to.v[i] * T) / (T * T)) as Vec3;
  const a1 = [0, 1, 2].map((i) => (-6 * d[i] + 4 * to.v[i] * T) / (T * T)) as Vec3;
  const pull0 = apparentAcceleration(h, from.p, [0, 0, 0]), pull1 = apparentAcceleration(h, to.p, to.v);
  if (Math.hypot(a0[0] - pull0[0], a0[1] - pull0[1], a0[2] - pull0[2]) > guard.thrust) return false;
  if (Math.hypot(a1[0] - pull1[0], a1[1] - pull1[1], a1[2] - pull1[2]) > guard.thrust) return false;
  for (const u of [0.25, 0.5, 0.75]) {
    const v = [0, 1, 2].map((i) => (6 * u * (1 - u) * d[i]) / T + (3 * u * u - 2 * u) * to.v[i]);
    if (Math.hypot(v[0], v[1], v[2]) > guard.speed) return false;
  }
  return true;
}

/**
 * The gentlest stop of a body at `p` going at `v` (m/s²): what `brake` floor gravities, felt, leave beyond the spin's
 * weight where it comes to rest (heaviest there, being furthest out), found by going there and back a few times.
 */
function stopBrake(h: Habitat, guard: Guard, p: Vec3, v: Vec3): number {
  const speed = Math.hypot(v[0], v[1], v[2]);
  let a = gentleBrake(h, guard, p);
  if (speed < 1e-3) return a;
  const dir = v3norm(v);
  for (let k = 0; k < 4; k++) a = Math.min(a, gentleBrake(h, guard, v3madd(p, dir, (speed * speed) / (2 * a))));
  return a;
}

/** The gentlest stop's deceleration at `p` (m/s²): what `brake` floor gravities, felt, leave beyond the spin's weight there. */
function gentleBrake(h: Habitat, guard: Guard, p: Vec3): number {
  const g0 = h.gravityAt(h.radius);
  return Math.max(0.5 * g0, guard.brake * g0 - h.gravityAt(Math.hypot(p[0], p[1])));
}

/** How far (m) from `p` along `dir` the body (its height) is clear of what stands below, up to `most`. */
function rayRoom(h: Habitat, footing: Footing, p: Vec3, dir: Vec3, most: number): number {
  const under = (d: number): boolean => gapOf(h, footing, v3madd(p, dir, d)) < 0;
  for (let d = RAY_STEP; d <= most; d += RAY_STEP) {
    if (!under(d)) continue;
    // Halve the last step down to a few centimetres.
    let lo = d - RAY_STEP, hi = d;
    while (hi - lo > 0.04) { const mid = (lo + hi) / 2; if (under(mid)) hi = mid; else lo = mid; }
    return lo;
  }
  return most + MARGIN;
}

/** Sideways to a fall at a moment (unit): across its way and up, or spinward where it falls straight down. */
function acrossAt(q: FallPoint): Vec3 {
  const up = upAt(q.p) ?? [1, 0, 0], v = q.v, speed = Math.hypot(...v);
  const c = speed > 0.5 ? v3cross(v, up) : [0, 0, 0] as Vec3;
  return Math.hypot(...c) > 0.3 * speed && speed > 0.5 ? v3norm(c) : (spinwardAt(q.p) ?? [0, 1, 0]);
}

/** Whether (θ, s) is open ground to stand on: not water, and no steeper than `SET_DOWN_SLOPE`. */
function standable(h: Habitat, footing: Footing, theta: number, s: number): boolean {
  const f = footing(theta, s, Infinity);
  if (f.water) return false;
  const p = toWorld(h.profile, { theta, s, h: f.h }), up = upAt(p);
  return !!up && v3dot(footingNormal(h, footing, theta, s, f.h), up) >= Math.cos(SET_DOWN_SLOPE);
}

/** The nearest open ground to stand on under a point (world), searched in rings out to `SEARCH` m, or null. */
export function standingNear(h: Habitat, footing: Footing, p: Vec3): { theta: number; s: number } | null {
  const at = fromWorld(h.profile, p[0], p[1], p[2]), r = Math.max(1, h.profile.at(at.s).r), L = h.profile.length;
  if (standable(h, footing, at.theta, at.s)) return { theta: at.theta, s: at.s };
  for (let d = SEARCH_STEP; d <= SEARCH; d += SEARCH_STEP) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / SEARCH_STEP));
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, s = at.s + d * Math.cos(a), theta = at.theta + (d * Math.sin(a)) / r;
      if (s >= 0 && s <= L && standable(h, footing, theta, s)) return { theta, s };
    }
  }
  return null;
}

/** Where at (θ, s) the body is set down, facing back toward where it was held (along the ground). */
function setDownAt(h: Habitat, footing: Footing, theta: number, s: number, from: Vec3): SetDown {
  const feet = toWorld(h.profile, { theta, s, h: footing(theta, s, Infinity).h }), up = upAt(feet) ?? [1, 0, 0];
  const toward = [0, 1, 2].map((i) => from[i] - feet[i]) as Vec3, flat = v3madd(toward, up, -v3dot(toward, up));
  const front = Math.hypot(...flat) > 1e-3 ? v3norm(flat) : (spinwardAt(feet) ?? [0, 1, 0]);
  return { theta, s, feet, front };
}

/**
 * The way the guardians carry the body from rest to its set-down: over the line between them on the profile, `CLEAR`
 * m over whatever stands under it, rising and sinking no steeper than `CLIMB`, then down onto the feet from `LIFT` m.
 * Feet points (world) with the times they are reached at `pace` m/s, from `t0`.
 */
function carryWay(h: Habitat, footing: Footing, rest: Vec3, to: SetDown, pace: number, t0: number): { way: Vec3[]; times: number[] } {
  const a = fromWorld(h.profile, rest[0], rest[1], rest[2]);
  const dTheta = wrapAngle(to.theta - a.theta + Math.PI) - Math.PI, r = Math.max(1, h.profile.at((a.s + to.s) / 2).r);
  const span = Math.hypot(to.s - a.s, dTheta * r), n = Math.max(2, Math.min(64, Math.ceil(span / 8)));
  const topAt = (theta: number, s: number): number => footing(theta, s, Infinity).h;
  const end = topAt(to.theta, to.s);
  const pts: { theta: number; s: number; h: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, theta = a.theta + dTheta * u, s = a.s + (to.s - a.s) * u;
    const line = a.h + (end + LIFT - a.h) * u;
    pts.push({ theta, s, h: i === n ? end + LIFT : Math.max(line, i === 0 ? a.h : topAt(theta, s) + CLEAR) });
  }
  // No dips steeper than CLIMB: carry the highest point forward and back as a slope.
  const step = span / n;
  for (let i = 1; i <= n; i++) if (i < n) pts[i].h = Math.max(pts[i].h, pts[i - 1].h - CLIMB * step);
  for (let i = n - 1; i >= 1; i--) pts[i].h = Math.max(pts[i].h, pts[i + 1].h - CLIMB * step);
  const way = pts.map((q) => toWorld(h.profile, q)).concat([to.feet]);
  way[0] = [...rest];
  const times = [t0];
  for (let i = 1; i < way.length; i++) times.push(times[i - 1] + Math.max(0.4, apart(way[i - 1], way[i]) / (i === way.length - 1 ? pace / 4 : pace)));
  return { way, times };
}

const sideOf = (k: number): number => (k % 2 === 0 ? 1 : -1) * (1 + Math.floor(k / 2));
