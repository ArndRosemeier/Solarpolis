/**
 * A torch ship's shape (design "Solarpolis: the outside": fusion torch ships are what citizens take, thrusting the
 * whole way and turning over at the midpoint, so there is always gravity on board, toward the engine). The first
 * ship blueprint, for the title flight; O6 adds its mind, berth and crossing.
 *
 * Ship frame: +x from the drive's exit (x = 0) to the nose (x = length), the exhaust leaving along −x; +z is the side
 * the radiator wings stand out from. Every size comes from `ShipParams`. Pure.
 */
import { Rng } from '@futuremagic/core';

export interface ShipParams {
  /** Drive exit to nose (m). */
  length: number;
  /** The widest part of the hull, the crew section's diameter (m). */
  beam: number;
  /** How far the exhaust glows behind the ship at full thrust, as a multiple of its length. */
  plume: number;
  seed: number;
}

export type ShipRole = 'hull' | 'crew' | 'tank' | 'radiator' | 'drive' | 'truss';

/** A round piece along the ship's axis, or a box (radiator wings, truss). Positions in the ship frame (m). */
export type ShipPart =
  | { shape: 'cylinder'; role: ShipRole; from: number; to: number; radius: number; offset?: [number, number] }
  | { shape: 'cone'; role: ShipRole; from: number; to: number; r0: number; r1: number }
  | { shape: 'box'; role: ShipRole; center: [number, number, number]; half: [number, number, number] };

export interface ShipShape {
  params: ShipParams;
  parts: ShipPart[];
  /** The drive's exit: radius of the bell's mouth at x = 0 (m). */
  nozzle: number;
  /** The exhaust's glowing length at full thrust (m), and its radius where it ends. */
  plumeLength: number;
  plumeRadius: number;
}

/** The torch ship of the title flight. */
export const TORCH_SHIP: ShipParams = { length: 180, beam: 16, plume: 8, seed: 11 };

/**
 * From the stern: the drive bell, the reactor, a truss spine carrying the radiator wings (in the plane of the axis,
 * so they stay edge-on to the exhaust), a ring of propellant tanks, and the crew section at the nose.
 */
export function torchShip(p: ShipParams): ShipShape {
  const L = p.length, B = p.beam, rng = new Rng(p.seed);
  const nozzle = B * 0.45;
  const parts: ShipPart[] = [];
  // Drive bell and reactor.
  const bell = L * 0.08, reactor = L * 0.12;
  parts.push({ shape: 'cone', role: 'drive', from: 0, to: bell, r0: nozzle, r1: B * 0.18 });
  parts.push({ shape: 'cylinder', role: 'drive', from: bell, to: bell + reactor, radius: B * 0.3 });
  // The spine: a square truss from the reactor to the tanks.
  const spineFrom = bell + reactor, spineTo = L * 0.62;
  parts.push({ shape: 'box', role: 'truss', center: [(spineFrom + spineTo) / 2, 0, 0], half: [(spineTo - spineFrom) / 2, B * 0.08, B * 0.08] });
  // Radiator wings, one each side, edge-on to the exhaust.
  const wing = (spineTo - spineFrom) * 0.8, span = B * rng.range(1.6, 2.2);
  for (const side of [-1, 1]) {
    parts.push({ shape: 'box', role: 'radiator', center: [(spineFrom + spineTo) / 2, 0, side * (B * 0.1 + span / 2)], half: [wing / 2, B * 0.01, span / 2] });
  }
  // Propellant tanks: a ring of four around the forward spine.
  const tankFrom = spineTo, tankTo = L * 0.8, tr = B * 0.22;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * 2 * Math.PI + Math.PI / 4;
    parts.push({ shape: 'cylinder', role: 'tank', from: tankFrom, to: tankTo, radius: tr, offset: [Math.cos(a) * tr * 1.25, Math.sin(a) * tr * 1.25] });
  }
  // Crew section and its nose.
  parts.push({ shape: 'cylinder', role: 'crew', from: tankTo, to: L * 0.96, radius: B / 2 });
  parts.push({ shape: 'cone', role: 'hull', from: L * 0.96, to: L, r0: B / 2, r1: B * 0.2 });
  return { params: p, parts, nozzle, plumeLength: p.plume * L, plumeRadius: nozzle * 6 };
}
