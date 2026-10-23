/**
 * The small craft round a habitat's dock (plan "The Threshold", the flight, step 4 "life around the ship"): what makes
 * the port read as a working harbour, and the ships and the hull read at their size. Like the ships they serve
 * (traffic.ts) each is a formula of the clock and the world's seed. Two kinds:
 *
 * - Tugs: each berth arm has its own, parked nose-in in a cradle on the spindle beside the arm's root. When a ship
 *   comes in to the arm, the tug launches TUG_TRANSIT before the ship turns at the stand-off, flies out to hold station
 *   a little off the ship's side level with its middle, and comes in with it; TUG_HOLD after the ship berths it flies
 *   home. A ship leaving is seen out the same way, from TUG_HOLD before it unberths until it has turned at the
 *   stand-off.
 * - Inspectors: while a ship is berthed, INSPECTORS small drones leave the arm's collar one after another and work
 *   slowly up and down its crew section on a helix a little off the hull, each back at the collar before it leaves.
 *
 * Positions, noses and up directions are in the habitat's spindle frame, like the ships'. Pure.
 */
import { Rng, deriveSeed, v3add, v3cross, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { approachOf, shipAt, smooth, type ShipNow, type Visit } from './traffic';
import { shipShape, type ShipPart, type ShipShape } from './ship';

/** A tug's length, as a share of the berth arm's, and never less than TUG_LEAST (m): a crewed craft people fit in. */
export const TUG_SIZE = 0.1;
const TUG_LEAST = 4;
/** An inspector's length (m): a drone the size of a person. */
export const INSPECTOR_SIZE = 1.6;
/** Seconds a tug takes from its cradle to the ship's side, and stays after the ship berths (or comes out before it leaves). */
export const TUG_TRANSIT = 150;
export const TUG_HOLD = 90;
/** Inspectors per berthed ship, seconds between their launches, seconds out from the collar to the hull. */
export const INSPECTORS = 3;
const INSPECTOR_STAGGER = 40;
const INSPECTOR_OUT = 60;
/** How far off the hull an inspector works (m), how fast it goes round (rad/s) and up and down the crew section (rad/s). */
const INSPECTOR_GAP = 2.5;
const INSPECTOR_ROUND = 0.012;
const INSPECTOR_ALONG = 0.004;

export type CraftKind = 'tug' | 'inspector';

export interface CraftNow {
  /** `<visit id>/tug` or `<visit id>/inspector/<k>`: the same craft every time the clock passes this way. */
  id: string;
  kind: CraftKind;
  /** Its length (m), its middle, its nose's direction and its up, in the spindle frame. */
  length: number;
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  /** Its seed, for its look and its lights' timing. */
  seed: number;
}

const mix = (a: Vec3, b: Vec3, s: number): Vec3 => v3add(a, v3scale(v3sub(b, a), s));

/** A pose: its middle, nose and up. */
interface Pose { at: Vec3; forward: Vec3; up: Vec3 }

/** Between two poses: the middles moved along, the nose and up turned with them, kept square to each other. */
function poseBetween(a: Pose, b: Pose, s: number): Pose {
  const forward = v3norm(mix(a.forward, b.forward, s)), u = mix(a.up, b.up, s);
  return { at: mix(a.at, b.at, s), forward, up: v3norm(v3sub(u, v3scale(forward, v3dot(u, forward)))) };
}

/** A tug's length at a habitat. */
export const tugLength = (h: Habitat): number => Math.max(TUG_LEAST, h.exterior.spindle.arms.length * TUG_SIZE);

/** An arm's tug in its cradle: on the spindle, halfway round to the next arm, level with the arms, nose in. */
export function tugCradle(h: Habitat, arm: number): Pose {
  const s = h.exterior.spindle, a = ((arm + 0.5) / s.berthArms) * 2 * Math.PI, radial: Vec3 = [Math.cos(a), Math.sin(a), 0];
  const L = tugLength(h);
  return { at: v3add(v3scale(radial, s.radius + L * 0.3), [0, 0, s.arms.z]), forward: v3scale(radial, -1), up: [0, 0, 1] };
}

/** The ship's middle, its frame (nose, side, up), from where it is now. */
function shipFrame(ship: ShipNow): { mid: Vec3; side: Vec3; up: Vec3 } {
  const L = ship.visit.ship.length, x = ship.forward, z = v3norm(v3cross(x, ship.up)), y = v3cross(z, x);
  return { mid: v3add(ship.position, v3scale(x, L / 2)), side: y, up: z };
}

/** Where a tug holds station beside its ship: off its +y side (the radiators stand out along z, the dish on −y), level with its middle. */
function escort(h: Habitat, ship: ShipNow): Pose {
  const f = shipFrame(ship), off = ship.visit.ship.beam / 2 + tugLength(h) * 1.2;
  return { at: v3add(f.mid, v3scale(f.side, off)), forward: ship.forward, up: ship.up };
}

/** Where an arm's tug is at clock time t while it serves a visit to the arm, or null while it is in its cradle. */
function tugPose(h: Habitat, v: Visit, t: number): Pose | null {
  const a = approachOf(h, v.ship), turnFrom = v.docked - a.final - a.turn, turnTo = v.undocked + a.final + a.turn;
  const home = tugCradle(h, v.arm);
  const at = (tt: number): Pose => escort(h, shipAt(h, v, Math.min(Math.max(tt, v.from), v.to))!);
  if (t >= turnFrom - TUG_TRANSIT && t <= v.docked + TUG_HOLD + TUG_TRANSIT) {
    // Coming in: out to the ship, beside it in, home again.
    const out = smooth((t - (turnFrom - TUG_TRANSIT)) / TUG_TRANSIT), back = smooth((t - (v.docked + TUG_HOLD)) / TUG_TRANSIT);
    return poseBetween(poseBetween(home, at(t), out), home, back);
  }
  if (t >= v.undocked - TUG_HOLD - TUG_TRANSIT && t <= turnTo + TUG_TRANSIT) {
    // Leaving: out to the berthed ship, with it to the stand-off, home again.
    const out = smooth((t - (v.undocked - TUG_HOLD - TUG_TRANSIT)) / TUG_TRANSIT), back = smooth((t - turnTo) / TUG_TRANSIT);
    return poseBetween(poseBetween(home, at(t), out), home, back);
  }
  return null;
}

/**
 * Every arm's tug at clock time t: out with the ship it serves among `ships` (trafficAt's), or in its cradle.
 * `habitatId` names them: `<habitat>/tug/<arm>`.
 */
export function tugsAt(h: Habitat, habitatId: string, worldSeed: number, ships: readonly ShipNow[], t: number): CraftNow[] {
  const out: CraftNow[] = [], L = tugLength(h);
  for (let arm = 0; arm < h.exterior.spindle.berthArms; arm++) {
    let pose: Pose = tugCradle(h, arm);
    for (const s of ships) if (s.visit.arm === arm) pose = tugPose(h, s.visit, t) ?? pose;
    out.push({ id: `${habitatId}/tug/${arm}`, kind: 'tug', length: L, position: pose.at, forward: pose.forward, up: pose.up, seed: deriveSeed(worldSeed, 'tug', habitatId, arm) });
  }
  return out;
}

/** The crew section of a ship's shape: where inspectors work (x from, x to, radius; m). */
function crewOf(s: ShipShape): { from: number; to: number; radius: number } {
  const crew = s.parts.find((q) => q.shape === 'cylinder' && q.role === 'crew');
  return crew && crew.shape === 'cylinder' ? { from: crew.from, to: crew.to, radius: crew.radius } : { from: s.params.length * 0.8, to: s.params.length * 0.95, radius: s.params.beam / 2 };
}

/** A visit's inspectors at clock time t: each out from the collar, round the crew section, back before it leaves. */
export function inspectorsAt(h: Habitat, v: Visit, t: number, shape: ShipShape = shipShape(v.ship)): CraftNow[] {
  if (t < v.docked || t > v.undocked) return [];
  const ship = shipAt(h, v, t)!, f = shipFrame(ship);
  const c = crewOf(shape), L = v.ship.length, out: CraftNow[] = [];
  const rng = new Rng(deriveSeed(v.ship.seed, 'inspectors'));
  for (let k = 0; k < INSPECTORS; k++) {
    const phase = rng.range(0, 2 * Math.PI), wave = rng.range(0, 2 * Math.PI), seed = rng.nextU32();
    const go = v.docked + TUG_HOLD + k * INSPECTOR_STAGGER, end = v.undocked - TUG_HOLD - (INSPECTORS - k) * INSPECTOR_STAGGER;
    if (t < go || t > end + INSPECTOR_OUT || end - go < 2 * INSPECTOR_OUT) continue;
    // On its helix round the crew section: x along it (from the stern), the angle round the ship's axis.
    const x = c.from + (c.to - c.from) * (0.5 + 0.45 * Math.sin(wave + INSPECTOR_ALONG * (t - go))), angle = phase + INSPECTOR_ROUND * (t - go);
    const across = v3add(v3scale(f.side, Math.cos(angle)), v3scale(f.up, Math.sin(angle))), r = c.radius + INSPECTOR_GAP + INSPECTOR_SIZE;
    const nose = ship.forward, stern = v3sub(f.mid, v3scale(nose, L / 2));
    const work: Pose = { at: v3add(v3add(stern, v3scale(nose, x)), v3scale(across, r)), forward: v3norm(v3cross(nose, across)), up: across };
    // It comes out of the arm's collar beside the ship's nose, clear of the hull, and goes back in there.
    // It comes out of the arm's collar beside the ship's nose, rises clear of the hull there, then goes along it to its
    // place on the helix, and back the same way.
    const tip = v3add(stern, v3scale(nose, L)), dock: Pose = { at: v3add(tip, v3scale(across, c.radius * 0.5)), forward: nose, up: across };
    const lift: Pose = { at: v3add(tip, v3scale(across, r)), forward: work.forward, up: across };
    const s = Math.min(smooth((t - go) / INSPECTOR_OUT), 1 - smooth((t - end) / INSPECTOR_OUT));
    if (s <= 0) continue;
    const p = s < 0.5 ? poseBetween(dock, lift, s * 2) : poseBetween(lift, work, s * 2 - 1);
    out.push({ id: `${v.id}/inspector/${k}`, kind: 'inspector', length: INSPECTOR_SIZE, position: p.at, forward: p.forward, up: p.up, seed });
  }
  return out;
}

/** Every craft at a habitat's dock at clock time t: its tugs, and the inspectors at the berthed ships among `ships`. */
export function craftAt(h: Habitat, habitatId: string, worldSeed: number, ships: readonly ShipNow[], t: number, shapes?: (v: Visit) => ShipShape): CraftNow[] {
  return [...tugsAt(h, habitatId, worldSeed, ships, t), ...ships.flatMap((s) => inspectorsAt(h, s.visit, t, shapes?.(s.visit)))];
}

/** A harbour tug's colours: high-visibility orange and white, as tugs always were, and its stripe. */
const TUG_HULL: [number, number, number] = [0.62, 0.22, 0.04], TUG_WHITE: [number, number, number] = [0.7, 0.69, 0.66];
const INSPECTOR_BODY: [number, number, number] = [0.55, 0.55, 0.57];
/** A tug's cabin windows and an inspector's lamp eye (luminance, relative to white paper in full sunlight). */
const CABIN_GLOW = 0.02, EYE_GLOW = 0.4;

/**
 * A craft's shape, in the ship frame (+x to the nose; space/ship.ts):
 *
 * - a tug: a stubby orange hull with a lit cabin band at the front, a white stripe, a fender ring and a grapple at the
 *   nose, four thruster pods on outriggers, and a radiator fin along its back;
 * - an inspector: a small pale body with a ring of thrusters, two sensor booms and a bright lamp eye at the front.
 */
export function craftShape(c: Pick<CraftNow, 'kind' | 'length' | 'seed'>): ShipShape {
  const L = c.length, parts: ShipPart[] = [];
  if (c.kind === 'tug') {
    const R = L * 0.2, beam = L * 0.62;
    parts.push({ shape: 'cone', role: 'drive', from: 0, to: L * 0.12, r0: R * 0.55, r1: R * 0.8, colour: TUG_WHITE });
    parts.push({ shape: 'cylinder', role: 'crew', from: L * 0.12, to: L * 0.78, radius: R, colour: TUG_HULL });
    parts.push({ shape: 'shell', role: 'hull', from: L * 0.36, r0: R * 1.01, to: L * 0.44, r1: R * 1.01, colour: TUG_WHITE });
    // The cabin band of windows, then the nose with its fender and the grapple's jaws.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 2 * Math.PI;
      parts.push({ shape: 'shell', role: 'window', from: L * 0.62, r0: R * 1.015, to: L * 0.7, r1: R * 1.015, arc: [a + 0.08, a + (2 * Math.PI) / 10 - 0.08], colour: [CABIN_GLOW, CABIN_GLOW * 0.85, CABIN_GLOW * 0.62] });
    }
    parts.push({ shape: 'cone', role: 'hull', from: L * 0.78, to: L * 0.9, r0: R, r1: R * 0.6, colour: TUG_HULL });
    parts.push({ shape: 'cylinder', role: 'fitting', from: L * 0.88, to: L * 0.93, radius: R * 0.85, colour: [0.05, 0.05, 0.05] });
    for (const s of [-1, 1]) for (const u of [-1, 1]) parts.push({ shape: 'strut', role: 'fitting', a: [L * 0.92, s * R * 0.4, u * R * 0.4], b: [L, s * R * 0.25, u * R * 0.25], width: R * 0.12 });
    // Thruster pods on outriggers, at the four corners: their reach is the tug's beam.
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, y = Math.cos(a) * (beam / 2 - R * 0.25), z = Math.sin(a) * (beam / 2 - R * 0.25);
      parts.push({ shape: 'strut', role: 'truss', a: [L * 0.3, Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8], b: [L * 0.3, y, z], width: R * 0.15, colour: TUG_WHITE });
      parts.push({ shape: 'cylinder', role: 'drive', from: L * 0.18, to: L * 0.42, radius: R * 0.25, offset: [y, z], colour: TUG_WHITE });
    }
    parts.push({ shape: 'box', role: 'radiator', center: [L * 0.4, R * 1.4, 0], half: [L * 0.18, R * 0.4, R * 0.03] });
    return { params: { drive: 'thrusters', length: L, beam, plume: 0, thrust: 0, rcs: 0.5, seed: c.seed }, parts, nozzle: 0, plumeLength: 0, plumeRadius: 0 };
  }
  const R = L * 0.3;
  parts.push({ shape: 'cone', role: 'hull', from: 0, to: L * 0.2, r0: R * 0.5, r1: R, colour: INSPECTOR_BODY });
  parts.push({ shape: 'cylinder', role: 'crew', from: L * 0.2, to: L * 0.75, radius: R, colour: INSPECTOR_BODY });
  parts.push({ shape: 'cone', role: 'hull', from: L * 0.75, to: L, r0: R, r1: R * 0.45, colour: INSPECTOR_BODY });
  parts.push({ shape: 'shell', role: 'window', from: L, r0: R * 0.4, to: L, r1: 0, colour: [EYE_GLOW, EYE_GLOW, EYE_GLOW * 0.92] });
  for (const s of [-1, 1]) parts.push({ shape: 'strut', role: 'fitting', a: [L * 0.6, s * R, 0], b: [L * 0.95, s * R * 1.8, 0], width: L * 0.03 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, c0 = Math.cos(a), s0 = Math.sin(a);
    parts.push({ shape: 'box', role: 'fitting', center: [L * 0.45, c0 * R * 1.05, s0 * R * 1.05], half: [L * 0.05, L * 0.04, L * 0.04], turn: a });
  }
  return { params: { drive: 'thrusters', length: L, beam: 2 * R, plume: 0, thrust: 0, rcs: 0.2, seed: c.seed }, parts, nozzle: 0, plumeLength: 0, plumeRadius: 0 };
}
