/**
 * Ship blueprints (design "Solarpolis: the outside"). Two drives (Arnd, 2026-10-21): fusion torch ships, what citizens
 * take, thrusting the whole way and turning over at the midpoint, so there is always gravity on board, toward the
 * engine; and laser-sail freighters, pushed and braked by the arrays on the Moon, their sail folded into its drum
 * before the approach. Near a habitat both come in on thrusters (`rcs`).
 *
 * Ship frame: +x from the stern (x = 0, a torch's drive exit) to the nose (x = length), a torch's exhaust leaving along
 * −x; +z is the side the radiator wings stand out from. Every size comes from `ShipParams`; `deriveShip` makes them
 * from a seed and the berth the ship must fit. Pure.
 */
import { Rng, v3cross, v3norm, type Vec3 } from '@futuremagic/core';
import { fitOut } from './shipDetail';

/** A torch, a laser sail, or thrusters alone (a port's tugs and drones: space/portCraft.ts). */
export type Drive = 'torch' | 'sail' | 'thrusters';

export interface ShipParams {
  drive: Drive;
  /** Stern to nose (m). */
  length: number;
  /** The widest part of the hull, the crew section's (or the cargo ring's) diameter (m). */
  beam: number;
  /** How far a torch's exhaust glows behind the ship at full thrust, as a multiple of its length (0 for a sail). */
  plume: number;
  /** The torch's acceleration (m/s², about 1 g; 0 for a sail), and the thrusters' near a habitat (m/s²). */
  thrust: number;
  rcs: number;
  seed: number;
}

/**
 * What a part is: its albedo by default (render/ship.ts). `fitting` is small dark hardware (thrusters, booms, seams);
 * `window` gives off its own light (its `colour` is its luminance, relative to white paper in full sunlight).
 */
export type ShipRole = 'hull' | 'crew' | 'tank' | 'radiator' | 'drive' | 'truss' | 'cargo' | 'sail' | 'fitting' | 'window';

/** Where a part is off the ship's axis (y, z; m), and its own albedo in place of its role's. */
interface Placed {
  offset?: [number, number];
  colour?: [number, number, number];
}

/**
 * A round piece along the ship's axis (closed at both ends), a cone (closed at its wide end), a shell (one surface of
 * revolution between two rings, no ends, all round or only the angles `arc`: its front faces (x, r) along
 * (r0 − r1, to − from), so outward going forward at one radius, forward from the outer ring to the inner at one x),
 * a box, turned `turn` about the ship's axis (from +y toward +z), or a strut: a square beam `width` wide from a to b.
 * Angles around the axis are from +y toward +z.
 * Positions in the ship frame (m).
 */
export type ShipPart =
  | ({ shape: 'cylinder'; role: ShipRole; from: number; to: number; radius: number } & Placed)
  | ({ shape: 'cone'; role: ShipRole; from: number; to: number; r0: number; r1: number } & Placed)
  | ({ shape: 'shell'; role: ShipRole; from: number; r0: number; to: number; r1: number; arc?: [number, number] } & Placed)
  | ({ shape: 'box'; role: ShipRole; center: [number, number, number]; half: [number, number, number]; turn?: number } & Omit<Placed, 'offset'>)
  | ({ shape: 'strut'; role: ShipRole; a: [number, number, number]; b: [number, number, number]; width: number } & Omit<Placed, 'offset'>);

/** A part's extent along the ship's axis, how far it reaches from the axis, and how far out toward +z (m). */
export function partSpan(q: ShipPart): { x0: number; x1: number; radius: number; side: number } {
  if (q.shape === 'box' || q.shape === 'strut') {
    const pts: [number, number, number][] = [];
    if (q.shape === 'box') {
      const t = q.turn ?? 0, c = Math.cos(t), s = Math.sin(t);
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const d of [-1, 1]) {
        const y = b * q.half[1], z = d * q.half[2];
        pts.push([q.center[0] + a * q.half[0], q.center[1] + c * y - s * z, q.center[2] + s * y + c * z]);
      }
    } else for (const e of [q.a, q.b]) for (const b of [-1, 1]) for (const d of [-1, 1]) pts.push([e[0], e[1] + (b * q.width) / 2, e[2] + (d * q.width) / 2]);
    return { x0: Math.min(...pts.map((v) => v[0])), x1: Math.max(...pts.map((v) => v[0])), radius: Math.max(...pts.map((v) => Math.hypot(v[1], v[2]))), side: Math.max(...pts.map((v) => v[2])) };
  }
  const r = q.shape === 'cylinder' ? q.radius : Math.max(q.r0, q.r1), [oy, oz] = q.offset ?? [0, 0];
  return { x0: Math.min(q.from, q.to), x1: Math.max(q.from, q.to), radius: r + Math.hypot(oy, oz), side: r + oz };
}

/**
 * The ship frame's axes in the frame a ship is posed in: x its nose's direction, y its up made square to x, z = x × y
 * (the one way from a pose's forward and up to the ship frame: space and render alike).
 */
export function shipAxesOf(pose: { forward: Vec3; up: Vec3 }): { x: Vec3; y: Vec3; z: Vec3 } {
  const x = pose.forward, z = v3norm(v3cross(x, pose.up));
  return { x, y: v3cross(z, x), z };
}

/** A ship's crew section (the round part people live in), or null. */
export function crewSection(shape: ShipShape): Extract<ShipPart, { shape: 'cylinder' }> | null {
  for (const q of shape.parts) if (q.shape === 'cylinder' && q.role === 'crew') return q;
  return null;
}

/** Each role's albedo (linear), unless a part gives its own. A window's is its glass, unlit. */
export const ROLE_ALBEDO: Record<ShipRole, [number, number, number]> = {
  hull: [0.6, 0.6, 0.62],
  crew: [0.72, 0.71, 0.68],
  tank: [0.5, 0.48, 0.44],
  radiator: [0.06, 0.06, 0.065],
  drive: [0.3, 0.29, 0.28],
  truss: [0.35, 0.35, 0.36],
  cargo: [0.62, 0.6, 0.55],
  sail: [0.78, 0.78, 0.8],
  fitting: [0.16, 0.16, 0.17],
  window: [0.02, 0.025, 0.03],
};

export interface ShipShape {
  params: ShipParams;
  parts: ShipPart[];
  /** Optional recipe finish colours; traffic ships retain the shared defaults. */
  colours?: Partial<Record<ShipRole, [number, number, number]>>;
  /** A torch's drive exit: radius of the bell's mouth at x = 0 (m; 0 without a torch). */
  nozzle: number;
  /** The exhaust's glowing length at full thrust (m), and its radius where it ends (0 without a torch). */
  plumeLength: number;
  plumeRadius: number;
}
/** The torch ship of the title flight. */
export const TORCH_SHIP: ShipParams = { drive: 'torch', length: 180, beam: 16, plume: 8, thrust: 9.81, rcs: 0.5, seed: 11 };

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

/**
 * From the stern: the folded sail in its drum (the sail and its rigging packed for the approach), a truss spine
 * carrying a ring of cargo pods, a radiator pair, and the small control section at the nose.
 */
export function sailShip(p: ShipParams): ShipShape {
  const L = p.length, B = p.beam, rng = new Rng(p.seed);
  const parts: ShipPart[] = [];
  const drum = L * rng.range(0.12, 0.16);
  parts.push({ shape: 'cylinder', role: 'sail', from: 0, to: drum, radius: B * 0.42 });
  parts.push({ shape: 'cone', role: 'sail', from: drum, to: drum + L * 0.03, r0: B * 0.42, r1: B * 0.12 });
  // The spine and the cargo pods around it, in rings.
  const spineFrom = drum + L * 0.03, spineTo = L * 0.86;
  parts.push({ shape: 'box', role: 'truss', center: [(spineFrom + spineTo) / 2, 0, 0], half: [(spineTo - spineFrom) / 2, B * 0.06, B * 0.06] });
  const rings = rng.int(2, 4), pods = 6, podR = B * 0.16, ringLength = (spineTo - spineFrom - L * 0.08) / rings;
  for (let k = 0; k < rings; k++) {
    const from = spineFrom + L * 0.04 + k * ringLength, to = from + ringLength * 0.9;
    for (let q = 0; q < pods; q++) {
      const a = (q / pods) * 2 * Math.PI;
      parts.push({ shape: 'cylinder', role: 'cargo', from, to, radius: podR, offset: [Math.cos(a) * (B / 2 - podR), Math.sin(a) * (B / 2 - podR)] });
    }
  }
  // A radiator pair for the crew and the electronics, edge-on along the spine.
  const span = B * 0.5;
  for (const side of [-1, 1]) parts.push({ shape: 'box', role: 'radiator', center: [spineTo - L * 0.06, 0, side * (B * 0.2 + span / 2)], half: [L * 0.05, B * 0.01, span / 2] });
  parts.push({ shape: 'cylinder', role: 'crew', from: spineTo, to: L * 0.97, radius: B * 0.2 });
  parts.push({ shape: 'cone', role: 'hull', from: L * 0.97, to: L, r0: B * 0.2, r1: B * 0.08 });
  return { params: p, parts, nozzle: 0, plumeLength: 0, plumeRadius: 0 };
}

/** A ship's shape from its blueprint, with its fittings (space/shipDetail.ts). */
export const shipShape = (p: ShipParams): ShipShape => fitOut(p.drive === 'sail' ? sailShip(p) : torchShip(p));

/** The ranges ships are made in: length as a multiple of the berth arm's, beam of the length, thrusters (m/s²). */
export const SHIP_DESIGN = {
  torchShare: 0.7,
  torch: { length: [0.8, 1.5], beam: [0.08, 0.1], plume: 8, thrust: [0.8, 1.2], rcs: [0.4, 0.6] },
  sail: { length: [1, 1.8], beam: [0.12, 0.16], rcs: [0.15, 0.25] },
} as const;
/** Standard gravity (m/s²): a torch thrusts at about 1 g. */
const G0 = 9.80665;

/** A ship that fits a berth arm `berth` m long, from a seed; of the given drive, or either by `torchShare`. */
export function deriveShip(seed: number, berth: number, drive?: Drive): ShipParams {
  const rng = new Rng(seed), share = rng.chance(SHIP_DESIGN.torchShare), torch = drive ? drive === 'torch' : share;
  const d = torch ? SHIP_DESIGN.torch : SHIP_DESIGN.sail;
  const length = berth * rng.range(d.length[0], d.length[1]), beam = length * rng.range(d.beam[0], d.beam[1]);
  const rcs = rng.range(d.rcs[0], d.rcs[1]);
  if (!torch) return { drive: 'sail', length, beam, plume: 0, thrust: 0, rcs, seed: rng.nextU32() };
  const t = SHIP_DESIGN.torch;
  return { drive: 'torch', length, beam, plume: t.plume, thrust: G0 * rng.range(t.thrust[0], t.thrust[1]), rcs, seed: rng.nextU32() };
}
