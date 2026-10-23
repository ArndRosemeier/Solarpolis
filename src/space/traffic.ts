/**
 * Ships at a habitat's spindle (design "Solarpolis: the outside", "Docking with a spinning habitat"): which ship is
 * at which berth arm, coming in or leaving, at any clock time, from the world's seed alone, like the population. A
 * ship's place is a formula of the clock until someone boards it (O7).
 *
 * Each berth arm's time is cut into slots (`TrafficParams.slot` of the slowest ships' round trips long); in a slot an
 * arm has one visit or none (`occupancy`), so two ships never meet at one berth. A visit, in the spindle's frame:
 *
 * 1. Torch (torch ships only): the last TORCH_SHOWN seconds of braking at about 1 g on the arm's corridor, a line
 *    parallel to the axis beyond the port end, stern and exhaust toward the habitat, the drive cutting out where the
 *    plume's tip reaches the keep-out distance (`exterior.keepOut` outer radii), so no exhaust ever touches it.
 * 2. Coast: on thrusters (`rcs`) down the corridor, speeding up and slowing to a stop level with the arm, a stand-off
 *    of FINAL_LENGTHS ship lengths out from the collar. In its first TURN seconds the ship flips nose-first. Guidance
 *    holds it to the corridor; the orbital drift it cancels (n² × distance) is far below its thrust.
 * 3. Turn: at the stand-off it pitches over in TURN seconds, nose toward the axis, its lock in line with the collar.
 * 4. Final: straight in along the arm at DOCK_SPEED, nose first, to the collar.
 * 5. Berthed: nose on the docking collar at the arm's tip, still with the spindle.
 *
 * Leaving is the same backwards, except that the ship pitches nose-out at the stand-off and leaves nose first.
 *
 * The passenger's own ship (`guestVisit`, the title's arrival) is one more visit, on an arm left free for it.
 * Pure: no three.js.
 */
import { Rng, deriveSeed, smoothstep, type Vec3 } from '@futuremagic/core';
import { berthArmAt, type Habitat } from '../blueprint';
import { SHIP_DESIGN, deriveShip, type ShipParams } from './ship';
import type { PlacedHabitat, Space } from './space';

export interface TrafficParams {
  /** The share of slots an arm has a visit in. */
  occupancy: number;
  /** A slot's length, as a multiple of the slowest ship's round trip (in and out) at the largest size. */
  slot: number;
}

/** Seconds of torch braking shown before the drive cuts out (before that the ship is still far out on its trip). */
export const TORCH_SHOWN = 1800;
/** Speed of the final approach (m/s), over the last FINAL_LENGTHS ship lengths. */
export const DOCK_SPEED = 0.5;
export const FINAL_LENGTHS = 2;
/** Seconds a ship takes to flip end over end on the coast, and to pitch over at the stand-off. */
export const TURN = 120;
/** How long the throttle takes to close (s). */
const THROTTLE_FADE = 5;

export interface Visit {
  /** `<habitat>/<arm>/<slot>`: the same ship every time the clock passes this way. */
  id: string;
  arm: number;
  ship: ShipParams;
  /** Clock times (s): first seen (torch braking, or the coast's start), berthed, unberthed, last seen. */
  from: number;
  docked: number;
  undocked: number;
  to: number;
}

export type Phase = 'torch' | 'coast' | 'turn' | 'final' | 'berthed';

export interface ShipNow {
  visit: Visit;
  phase: Phase;
  /** The stern (ship frame origin), its nose's direction and its wings' side, in the habitat's spindle frame (m). */
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  /** The torch's throttle (0–1). */
  throttle: number;
  /** How far it still has to go to the berth along its path (m), and how fast it moves along it (m/s, away from the berth +). */
  out: number;
  speed: number;
}

/** A berth: the docking collar's face at the arm's tip and the arm's outward direction, in the spindle frame. */
export function berthOf(h: Habitat, arm: number): { collar: Vec3; radial: Vec3 } {
  const s = h.exterior.spindle, radial: Vec3 = [...berthArmAt(s, arm), 0];
  const r = s.radius + s.arms.length;
  return { collar: [radial[0] * r, radial[1] * r, s.arms.z], radial };
}

/** How a ship comes in to a berth: the corridor's lengths (m) and how long each phase takes (s). */
export interface Approach {
  /** How far up the corridor from level with the arm the coast starts (where the drive cut out). */
  coastFrom: number;
  /** The stand-off: how far out along the arm from its berthed place the ship turns. */
  standOff: number;
  /** Phase lengths: torch, each half of the coast (speeding up, slowing down), its flip, the turn, the final. */
  torch: number;
  half: number;
  flip: number;
  turn: number;
  final: number;
}

export function approachOf(h: Habitat, ship: ShipParams): Approach {
  const x = h.exterior, L = ship.length, plume = ship.plume * L, standOff = FINAL_LENGTHS * L;
  // The corridor runs at the ship's middle at the stand-off; the keep-out sphere is about the habitat's centre.
  const rc = x.spindle.radius + x.spindle.arms.length + L / 2 + standOff, above = x.spindle.arms.z - h.length / 2;
  const K = x.radius * h.params.exterior.keepOut, keepOut = Math.sqrt(Math.max(0, K * K - rc * rc)) - above;
  // The plume reaches back half a length from the middle to the stern, then its own length.
  const coastFrom = Math.max(keepOut + L / 2 + plume, standOff), half = Math.sqrt(coastFrom / ship.rcs);
  return { coastFrom, standOff, torch: ship.drive === 'torch' ? TORCH_SHOWN : 0, half, flip: Math.min(TURN, half), turn: TURN, final: standOff / DOCK_SPEED };
}

const inTime = (a: Approach): number => a.torch + 2 * a.half + a.turn + a.final;

/** A slot's length for this habitat (s): `slot` round trips of the slowest, longest ship its berths take. */
export function slotLength(h: Habitat, p: TrafficParams): number {
  const berth = h.exterior.spindle.arms.length, d = SHIP_DESIGN;
  const slowest: ShipParams = { drive: 'torch', length: berth * Math.max(d.torch.length[1], d.sail.length[1]), beam: 1, plume: d.torch.plume, thrust: 1, rcs: Math.min(d.torch.rcs[0], d.sail.rcs[0]), seed: 0 };
  return p.slot * 2 * inTime(approachOf(h, slowest));
}

/** The visit an arm has in slot n, if any. */
export function visitIn(h: Habitat, habitatId: string, worldSeed: number, p: TrafficParams, arm: number, n: number): Visit | null {
  const rng = new Rng(deriveSeed(worldSeed, 'visit', habitatId, arm, n));
  if (!rng.chance(p.occupancy)) return null;
  const ship = deriveShip(rng.nextU32(), h.exterior.spindle.arms.length);
  const P = slotLength(h, p), t = inTime(approachOf(h, ship)), free = P - 2 * t;
  const stay = free * rng.range(0.6, 0.95), from = n * P + rng.range(0, free - stay);
  return { id: `${habitatId}/${arm}/${n}`, arm, ship, from, docked: from + t, undocked: from + t + stay, to: from + 2 * t + stay };
}

/** Every visit under way at clock time t. */
export function visitsAt(h: Habitat, habitatId: string, worldSeed: number, p: TrafficParams, t: number): Visit[] {
  const n = Math.floor(t / slotLength(h, p)), out: Visit[] = [];
  for (let arm = 0; arm < h.exterior.spindle.berthArms; arm++) {
    const v = visitIn(h, habitatId, worldSeed, p, arm, n);
    if (v && t >= v.from && t <= v.to) out.push(v);
  }
  return out;
}

/** 0 to 1 eased over x from 0 to 1, held beyond. */
export const smooth = (x: number): number => smoothstep(0, 1, Math.min(1, Math.max(0, x)));

/**
 * Where a visit's ship is at clock time t (null outside the visit). Its attitude is one pitch angle θ about the side
 * axis (z × radial): θ = 0 nose out along the axis, π nose in along it, 3π/2 nose in along the arm, 2π nose out again.
 */
export function shipAt(h: Habitat, v: Visit, t: number): ShipNow | null {
  if (t < v.from || t > v.to) return null;
  const a = approachOf(h, v.ship), L = v.ship.length, { collar, radial } = berthOf(h, v.arm), rcs = v.ship.rcs;
  // Seconds before berthing (arriving) or after leaving the berth (leaving); 0 while berthed.
  const leaving = t > v.undocked, u = t < v.docked ? v.docked - t : leaving ? t - v.undocked : 0;
  const turnFrom = a.final + a.turn, coastTo = turnFrom + 2 * a.half;
  // The middle's way out along the arm and up the corridor from its berthed place.
  let phase: Phase = 'berthed', along = 0, up = 0, speed = 0, throttle = 0, th = 1.5 * Math.PI;
  if (u <= 0) { /* berthed */ }
  else if (u <= a.final) { phase = 'final'; along = DOCK_SPEED * u; speed = DOCK_SPEED; }
  else if (u <= turnFrom) { phase = 'turn'; along = a.standOff; th = Math.PI * (1 + 0.5 * smooth((turnFrom - u) / a.turn)); }
  else if (u <= coastTo) {
    phase = 'coast'; along = a.standOff;
    const w = u - turnFrom, r = coastTo - u;
    if (w <= a.half) { up = 0.5 * rcs * w * w; speed = rcs * w; } else { up = a.coastFrom - 0.5 * rcs * r * r; speed = rcs * r; }
    th = Math.PI * smooth(r / a.flip);
  } else {
    const w = u - coastTo; phase = 'torch'; along = a.standOff; up = a.coastFrom + 0.5 * v.ship.thrust * w * w; speed = v.ship.thrust * w;
    throttle = smooth(w / THROTTLE_FADE); th = 0;
  }
  // Leaving pitches the other way at the stand-off and goes nose first: θ runs on from 3π/2 to 2π.
  if (leaving) th = phase === 'coast' || phase === 'torch' ? 2 * Math.PI : 3 * Math.PI - th;
  const c = Math.cos(th), s = Math.sin(th);
  const forward: Vec3 = [radial[0] * s, radial[1] * s, c], wing: Vec3 = [radial[0] * c, radial[1] * c, -s];
  const out = L / 2 + along;
  const mid: Vec3 = [collar[0] + radial[0] * out, collar[1] + radial[1] * out, collar[2] + up];
  const position: Vec3 = [mid[0] - forward[0] * (L / 2), mid[1] - forward[1] * (L / 2), mid[2] - forward[2] * (L / 2)];
  return { visit: v, phase, position, forward, up: wing, throttle, out: along + up, speed: leaving ? speed : -speed };
}

/** The passenger's ship (the title's): a torch ship for this habitat's berths, from the world's seed. */
export function guestShip(space: Space, p: PlacedHabitat): ShipParams {
  return deriveShip(deriveSeed(space.params.seed, 'guest', p.id), p.habitat.exterior.spindle.arms.length, 'torch');
}

/**
 * Seconds before berthing that a coming ship is `up` m up its corridor, slowing down on its thrusters (`up` at most
 * half the coast, where it slows).
 */
export function beforeBerth(h: Habitat, ship: ShipParams, up: number): number {
  const a = approachOf(h, ship), z = Math.min(Math.max(0, up), a.coastFrom / 2);
  return a.final + a.turn + Math.sqrt((2 * z) / ship.rcs);
}

/** The berth stays clear this long after the passenger's ship berths (s): no other ship is due there meanwhile. */
const GUEST_CLEAR = 3600;
/** Steps the passenger's berthing time is searched in (s), and how far (slots). */
const GUEST_STEP = 60;
const GUEST_SLOTS = 3;

/**
 * The passenger's ship, to be seen from `lead` seconds before it berths, at the earliest clock time from `after` on
 * when one arm (tried from a seeded one round) has no scheduled visit from then until GUEST_CLEAR after it berths.
 * Its arm's other visits give way to it (`trafficAt`); none of them shows from `lead` before it berths on. It stays.
 */
export function guestVisit(space: Space, p: PlacedHabitat, after: number, lead: number): Visit {
  const h = p.habitat, ship = guestShip(space, p), tp = space.params.traffic, P = slotLength(h, tp), n = h.exterior.spindle.berthArms;
  const first = new Rng(deriveSeed(space.params.seed, 'guest arm', p.id)).int(0, n - 1);
  const free = (arm: number, t0: number, t1: number): boolean => {
    for (let k = Math.floor(t0 / P); k <= Math.floor(t1 / P); k++) {
      const v = visitIn(h, p.id, space.params.seed, tp, arm, k);
      if (v && v.to >= t0 && v.from <= t1) return false;
    }
    return true;
  };
  const visit = (arm: number, docked: number): Visit => ({ id: `${p.id}/guest`, arm, ship, from: docked - arrivalTime(h, ship), docked, undocked: Infinity, to: Infinity });
  for (let docked = after + lead; docked < after + lead + GUEST_SLOTS * P; docked += GUEST_STEP) {
    for (let k = 0; k < n; k++) if (free((first + k) % n, docked - lead, docked + GUEST_CLEAR)) return visit((first + k) % n, docked);
  }
  return visit(first, after + lead);
}

/** How long a ship takes from first seen to berthed (s). */
export const arrivalTime = (h: Habitat, ship: ShipParams): number => inTime(approachOf(h, ship));

/**
 * The ships at and around a placed habitat's spindle at clock time t, with the passenger's ship when there is one:
 * from its first sighting on, the scheduled visits to its arm give way to it.
 */
export function trafficAt(space: Space, p: PlacedHabitat, t: number, guest: Visit | null = null): ShipNow[] {
  let visits = visitsAt(p.habitat, p.id, space.params.seed, space.params.traffic, t);
  if (guest && t >= guest.from) visits = [...visits.filter((v) => v.arm !== guest.arm || v.to < guest.from), guest];
  return visits.map((v) => shipAt(p.habitat, v, t)!);
}
