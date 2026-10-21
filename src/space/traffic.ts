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
 * 2. Coast: on thrusters (`rcs`) from there to a few ship lengths off the berth, speeding up and slowing down, the
 *    ship turning (in its first TURN seconds) from stern-first to nose toward the axis, its wings along it. Guidance
 *    holds it to the corridor; the orbital drift it cancels (n² × distance) is far below its thrust.
 * 3. Final: the last FINAL_LENGTHS ship lengths at DOCK_SPEED, straight in along the corridor, to the berth.
 * 4. Berthed: nose on the docking collar at the arm's tip, still with the spindle.
 *
 * Leaving is the same backwards. Pure: no three.js.
 */
import { Rng, deriveSeed, smoothstep, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
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
/** Seconds the ship takes to turn from stern-first to nose-in, at the far end of the coast. */
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

export type Phase = 'torch' | 'coast' | 'final' | 'berthed';

export interface ShipNow {
  visit: Visit;
  phase: Phase;
  /** The stern (ship frame origin), its nose's direction and its wings' side, in the habitat's spindle frame (m). */
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  /** The torch's throttle (0–1). */
  throttle: number;
  /** How far along the corridor from the berth (m), and how fast it moves along it (m/s, away from the berth +). */
  out: number;
  speed: number;
}

/** A berth: the docking collar's face at the arm's tip and the arm's outward direction, in the spindle frame. */
export function berthOf(h: Habitat, arm: number): { collar: Vec3; radial: Vec3 } {
  const s = h.exterior.spindle, a = (arm / s.berthArms) * 2 * Math.PI, radial: Vec3 = [Math.cos(a), Math.sin(a), 0];
  const r = s.radius + s.arms.length;
  return { collar: [radial[0] * r, radial[1] * r, s.arms.z], radial };
}

/** How a ship comes in to a berth: the corridor lengths (m) and how long each phase takes (s). */
interface Approach {
  /** From the berth: where the coast starts (the drive cut out), where the final approach starts. */
  coastFrom: number;
  finalFrom: number;
  peak: number;
  /** Phase lengths: torch, coast speeding up, coast slowing down, final. */
  torch: number;
  speedUp: number;
  slowDown: number;
  final: number;
}

function approachOf(h: Habitat, ship: ShipParams): Approach {
  const x = h.exterior, L = ship.length, plume = ship.plume * L;
  // The corridor runs at the ship's middle, half a length outside the collar; the keep-out sphere is about the centre.
  const rc = x.spindle.radius + x.spindle.arms.length + L / 2, above = x.spindle.arms.z - h.length / 2, K = x.radius * h.params.exterior.keepOut;
  const keepOut = Math.sqrt(Math.max(0, K * K - rc * rc)) - above;
  // The plume reaches back half a length from the middle to the stern, then its own length.
  const coastFrom = keepOut + L / 2 + plume, finalFrom = FINAL_LENGTHS * L, a = ship.rcs, v = DOCK_SPEED;
  const peak = Math.sqrt(a * (coastFrom - finalFrom) + (v * v) / 2);
  return { coastFrom, finalFrom, peak, torch: ship.drive === 'torch' ? TORCH_SHOWN : 0, speedUp: peak / a, slowDown: (peak - v) / a, final: finalFrom / v };
}

const inTime = (a: Approach): number => a.torch + a.speedUp + a.slowDown + a.final;

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

const smooth = (x: number): number => smoothstep(0, 1, x);

/** Where a visit's ship is at clock time t (null outside the visit). */
export function shipAt(h: Habitat, v: Visit, t: number): ShipNow | null {
  if (t < v.from || t > v.to) return null;
  const a = approachOf(h, v.ship), L = v.ship.length, { collar, radial } = berthOf(h, v.arm);
  // Seconds before berthing (arriving) or after leaving the berth (leaving); 0 while berthed.
  const leaving = t > v.undocked, u = t < v.docked ? v.docked - t : leaving ? t - v.undocked : 0;
  let out = 0, speed = 0, phase: Phase = 'berthed', throttle = 0;
  const coastEnd = a.final + a.slowDown + a.speedUp;
  if (u > 0 && u <= a.final) { phase = 'final'; out = DOCK_SPEED * u; speed = DOCK_SPEED; }
  else if (u > a.final && u <= a.final + a.slowDown) {
    const w = u - a.final; phase = 'coast'; out = a.finalFrom + DOCK_SPEED * w + 0.5 * v.ship.rcs * w * w; speed = DOCK_SPEED + v.ship.rcs * w;
  } else if (u > a.final + a.slowDown && u <= coastEnd) {
    const r = coastEnd - u; phase = 'coast'; out = a.coastFrom - 0.5 * v.ship.rcs * r * r; speed = v.ship.rcs * r;
  } else if (u > coastEnd) {
    const w = u - coastEnd; phase = 'torch'; out = a.coastFrom + 0.5 * v.ship.thrust * w * w; speed = v.ship.thrust * w;
    throttle = smooth(w / THROTTLE_FADE);
  }
  // Stern-first (nose away from the habitat, wings across the arm) until it has turned nose-in, wings along the axis.
  const turned = phase === 'torch' ? 0 : smooth((coastEnd - u) / TURN), th = turned * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const forward: Vec3 = [-radial[0] * s, -radial[1] * s, c], up: Vec3 = [radial[0] * c, radial[1] * c, s];
  const mid: Vec3 = [collar[0] + radial[0] * (L / 2), collar[1] + radial[1] * (L / 2), collar[2] + out];
  const position: Vec3 = [mid[0] - forward[0] * (L / 2), mid[1] - forward[1] * (L / 2), mid[2] - forward[2] * (L / 2)];
  return { visit: v, phase, position, forward, up, throttle, out, speed: leaving ? speed : -speed };
}

/** The ships at and around a placed habitat's spindle at clock time t. */
export function trafficAt(space: Space, p: PlacedHabitat, t: number): ShipNow[] {
  return visitsAt(p.habitat, p.id, space.params.seed, space.params.traffic, t).map((v) => shipAt(p.habitat, v, t)!);
}
