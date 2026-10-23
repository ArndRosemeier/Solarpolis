/**
 * Docking is mechanical (plan "The Threshold", step 5: "Clamps swing closed, lights go from amber to green"). Each berth
 * arm's docking collar carries:
 *
 * - CLAMPS hinged arms on housings round the ring's rim (between the collar's navigation lights, space/lights.ts). Open,
 *   they stand out from the ring like petals; after contact each swings forward and in until its jaw meets the ship's
 *   nose (`closedSwing`: as far as that ship's own shape lets it, so a slim sail ship's nose is gripped further in than
 *   a torch ship's broad one), one after another, each ending in the clunk the arrival's score plays (`CLAMP_CLUNKS`).
 *   Before a ship leaves they open again, the last closed first.
 * - A ring of SIGNALS lamps round the collar's face: dark while the berth is idle, amber running round the ring while a
 *   ship comes in or goes out (from its turn at the stand-off), steady amber from contact, green once every clamp is
 *   home and the seal holds (`SEALED`), amber again as it lets go.
 * - FLOODS: a floodlight on each clamp's housing, aimed out along the arm at the final approach, on while the berth has
 *   a ship coming, berthed or going. Seen from in front they are the brightest points at the port; from the side they
 *   fall off as real floodlights do (`FLOODS.power`).
 *
 * Positions are in the spindle's frame (the arm's tip and its outward direction from `berthOf`); every size is a share
 * of the arm's width, every time comes from the visit (space/traffic.ts), so the dock's state is a formula of the
 * clock like the traffic itself. Pure: no three.js.
 */
import { v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { LIGHT_COLOUR, type Blink, type HullLight } from './lights';
import { partSpan, type ShipPart, type ShipShape } from './ship';
import { approachOf, berthOf, smooth, type Visit } from './traffic';

/** Clamps per berth, and signal lamps round its collar. */
export const CLAMPS = 4;

/**
 * The collar and its clamps, as shares of the arm's width: the ring's outer radius and depth back from its face; each
 * clamp's housing on the rim (how far back from the face it starts, how far out over the rim it stands, its width);
 * the hinge in it (back from the face, out from the axis); the clamp's arm (its reach from the hinge, its depth in the
 * swing's plane, its width) and its jaw, which turns in toward the ship at the arm's end.
 */
export const DOCK = {
  ring: 0.9,
  deep: 0.5,
  housing: { back: 0.3, out: 0.16, wide: 0.24 },
  hinge: { back: 0.07, out: 0.1 },
  reach: 0.85,
  beam: 0.09,
  wide: 0.15,
  jaw: 0.13,
  /** The swing (rad) open: out from the ring and a little forward. Closing turns it forward, then in toward the axis. */
  open: (-65 * Math.PI) / 180,
  /** The most a clamp swings (rad) where nothing stops it first. */
  most: (100 * Math.PI) / 180,
} as const;

/** Seconds after contact each clamp is home (its clunk); how long its swing takes; when the seal holds (green). */
export const CLAMP_CLUNKS = [0.7, 1.2, 1.8, 2.4] as const;
export const CLAMP_SWING = 0.55;
export const SEALED = 2.85;
/** Seconds before a ship leaves its berth that the lights turn amber again; the clamps open in the time after. */
export const RELEASE = 4;

/** The ring of signal lamps: how many, how bright (cd), how fast the amber runs round it (s a turn). */
export const SIGNALS = { lights: 8, candela: 1500, turn: 1.6 } as const;
/** The floodlights: on-axis intensity (cd), and the power of the cosine their intensity falls off with off the axis. */
export const FLOODS = { candela: 200_000, power: 4 } as const;

export type Signal = 'idle' | 'approach' | 'contact' | 'latched';

export interface DockNow {
  /** Each clamp's swing (rad, `DOCK.open` open). */
  swing: number[];
  signal: Signal;
  /** Whether the floodlights are on. */
  flood: boolean;
}

/** A berth's collar in the spindle's frame: its face's middle, the arm's outward direction, its width (m). */
export interface Berth {
  collar: Vec3;
  radial: Vec3;
  width: number;
  /** Each clamp's direction out from the arm's axis (unit, square to `radial`). */
  spokes: Vec3[];
}

export function berthDockOf(h: Habitat, arm: number): Berth {
  const { collar, radial } = berthOf(h, arm), around: Vec3 = [-radial[1], radial[0], 0], axial: Vec3 = [0, 0, 1];
  // On the diagonals, between the collar's red, green and white lights.
  const spokes = Array.from({ length: CLAMPS }, (_, k) => {
    const a = Math.PI / 4 + (k * 2 * Math.PI) / CLAMPS;
    return v3add(v3scale(around, Math.cos(a)), v3scale(axial, Math.sin(a)));
  });
  return { collar, radial, width: h.exterior.spindle.arms.width, spokes };
}

/** In a clamp's plane: `d` m out from the collar's face along the arm, `rho` m from the arm's axis. */
type Planar = [number, number];

/** A clamp's arm at a swing, in its plane: the hinge, the arm's direction, and its jaw's (toward the axis when it points out along the arm). */
function clampPlane(w: number, swing: number): { hinge: Planar; dir: Planar; jaw: Planar } {
  const c = Math.cos(swing), s = Math.sin(swing);
  return { hinge: [-DOCK.hinge.back * w, (DOCK.ring + DOCK.hinge.out) * w], dir: [c, -s], jaw: [-s, -c] };
}

/** A clamp's pose at a swing: its hinge in the spindle frame and its axes (x along the arm, z its jaw's way, y = z × x). */
export function clampPose(b: Berth, k: number, swing: number): { at: Vec3; ex: Vec3; ey: Vec3; ez: Vec3 } {
  const p = clampPlane(b.width, swing), P = b.spokes[k], R = b.radial;
  const inPlane = (q: Planar): Vec3 => v3add(v3scale(R, q[0]), v3scale(P, q[1]));
  const ex = inPlane(p.dir), ez = inPlane(p.jaw);
  return { at: v3add(b.collar, inPlane(p.hinge)), ex, ey: v3cross(ez, ex), ez };
}

/** How far a ship's parts reach from its axis at x along it (its frame, m): its round parts exactly, its boxes and struts by their reach. */
export function reachAt(shape: ShipShape, x: number, parts: readonly ShipPart[] = shape.parts): number {
  let r = 0;
  for (const q of parts) {
    if (q.shape === 'box' || q.shape === 'strut') {
      const s = partSpan(q);
      if (x >= s.x0 && x <= s.x1) r = Math.max(r, s.radius);
      continue;
    }
    const lo = Math.min(q.from, q.to), hi = Math.max(q.from, q.to), off = Math.hypot(...(q.offset ?? [0, 0]));
    if (x < lo || x > hi) continue;
    if (q.shape === 'cylinder') r = Math.max(r, q.radius + off);
    else r = Math.max(r, (hi > lo ? q.r0 + ((q.r1 - q.r0) * (x - q.from)) / (q.to - q.from) : Math.max(q.r0, q.r1)) + off);
  }
  return r;
}

/** The swing is searched in steps this large (rad), then halved this many times; points along the arm tested at each. */
const SWING_STEP = (2 * Math.PI) / 180;
const HALVINGS = 8;
const ALONG = 8;

/**
 * The swing (rad) at which a berth's clamps close on a berthed ship: turning from open, the first at which any part of
 * the arm or its jaw would touch the ship's nose (its nose on the collar's face, `reachAt` round its axis) or the
 * collar's own face. With no ship they come to rest on the face.
 */
export function closedSwing(h: Habitat, shape: ShipShape | null): number {
  const w = h.exterior.spindle.arms.width, L = shape?.params.length ?? 0, gap = DOCK.beam * w * 0.5, a = DOCK.reach * w;
  // Only the nose's parts: those within the clamps' reach of the collar's face.
  const nose = shape ? shape.parts.filter((q) => partSpan(q).x1 >= L - (DOCK.reach + DOCK.jaw + DOCK.hinge.back) * w) : [];
  const touches = ([d, rho]: Planar): boolean => {
    if (d < 0) return rho < DOCK.ring * w;
    return !!shape && d <= L && rho < reachAt(shape, L - d, nose) + gap;
  };
  const blocked = (swing: number): boolean => {
    const p = clampPlane(w, swing), inner: Planar = [p.hinge[0] + p.jaw[0] * gap, p.hinge[1] + p.jaw[1] * gap];
    for (let k = 1; k <= ALONG; k++) if (touches([inner[0] + (p.dir[0] * a * k) / ALONG, inner[1] + (p.dir[1] * a * k) / ALONG])) return true;
    return touches([p.hinge[0] + p.dir[0] * a + p.jaw[0] * DOCK.jaw * w, p.hinge[1] + p.dir[1] * a + p.jaw[1] * DOCK.jaw * w]);
  };
  let free: number = DOCK.open;
  for (let swing = DOCK.open + SWING_STEP; swing <= DOCK.most; swing += SWING_STEP) {
    if (!blocked(swing)) { free = swing; continue; }
    // Between the last free step and this one: halve down to where it first touches.
    let hit = swing;
    for (let k = 0; k < HALVINGS; k++) {
      const mid = (free + hit) / 2;
      if (blocked(mid)) hit = mid; else free = mid;
    }
    return free;
  }
  return free;
}

/** Eased so it starts gently and lands hard (its clunk): x²(2 − x) over 0–1. */
const landing = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (2 - c);
};

/**
 * A berth's state at clock time t with this visit at it (or none), its clamps closing to `closed` (`closedSwing` of its
 * ship): the clamps' swings, the signal, the floodlights.
 */
export function dockAt(h: Habitat, visit: Visit | null, closed: number, t: number): DockNow {
  const open = (): number[] => new Array<number>(CLAMPS).fill(DOCK.open);
  if (!visit) return { swing: open(), signal: 'idle', flood: false };
  const a = approachOf(h, visit.ship), out = a.final + a.turn;
  if (t < visit.docked) return { swing: open(), signal: t >= visit.docked - out ? 'approach' : 'idle', flood: t >= visit.docked - out };
  if (t > visit.undocked) return { swing: open(), signal: t <= visit.undocked + out ? 'approach' : 'idle', flood: t <= visit.undocked + out };
  const since = t - visit.docked, before = visit.undocked - t;
  const swing = CLAMP_CLUNKS.map((clunk, k) => {
    const shut = landing((since - (clunk - CLAMP_SWING)) / CLAMP_SWING);
    // Letting go: the last one home opens first, each over a slower swing, all open before the ship moves.
    const from = RELEASE - 0.6 - (CLAMPS - 1 - k) * CLAMP_SWING, opened = smooth((from - before) / (1.5 * CLAMP_SWING));
    return DOCK.open + (closed - DOCK.open) * shut * (1 - opened);
  });
  return { swing, signal: since >= SEALED && before > RELEASE ? 'latched' : 'contact', flood: true };
}

const STEADY: Blink = { period: 0, on: 0, phase: 0 };

/**
 * The berth's lamps as the eye sees them at its state (the eye in the spindle's frame): the signal ring and the
 * floodlights, each's intensity already turned for the eye's direction (the signals face out of the collar's rim and
 * face, the floods along their aim). None while the berth is idle.
 */
export function dockLightsAt(b: Berth, now: DockNow, eye: Vec3): HullLight[] {
  const out: HullLight[] = [], w = b.width, R = b.radial;
  const cosTo = (at: Vec3, n: Vec3): number => v3dot(v3norm(v3sub(eye, at)), n);
  if (now.signal !== 'idle') {
    const around: Vec3 = [-R[1], R[0], 0], axial: Vec3 = [0, 0, 1], colour = now.signal === 'latched' ? LIGHT_COLOUR.green : LIGHT_COLOUR.amber;
    for (let j = 0; j < SIGNALS.lights; j++) {
      const a = (j / SIGNALS.lights) * 2 * Math.PI, P = v3add(v3scale(around, Math.cos(a)), v3scale(axial, Math.sin(a)));
      // On the edge between the face and the rim, seen from in front of the collar and from round its side.
      const at = v3add(b.collar, v3add(v3scale(P, DOCK.ring * w), v3scale(R, -0.01 * w))), n = v3norm(v3add(P, R));
      const facing = Math.max(0, cosTo(at, n) + 0.3) / 1.3;
      if (facing <= 0) continue;
      const blink: Blink = now.signal === 'approach' ? { period: SIGNALS.turn, on: SIGNALS.turn / SIGNALS.lights * 1.5, phase: (j * SIGNALS.turn) / SIGNALS.lights } : STEADY;
      out.push({ frame: 'spindle', at, colour, candela: SIGNALS.candela * facing, blink });
    }
  }
  if (now.flood) {
    for (const P of b.spokes) {
      const at = v3add(b.collar, v3add(v3scale(P, (DOCK.ring + DOCK.housing.out) * w), v3scale(R, -0.02 * w))), aim = v3norm(v3add(R, v3scale(P, 0.25)));
      const c = cosTo(at, aim);
      if (c > 0) out.push({ frame: 'spindle', at, colour: LIGHT_COLOUR.white, candela: FLOODS.candela * c ** FLOODS.power, blink: STEADY });
    }
  }
  return out;
}

/** Whether a berth is worth drawing clamps at from this far (m): they are at least a tenth of a pixel. */
export function dockShows(b: Berth, eye: Vec3, pixelsPerRadian: number): boolean {
  return ((DOCK.reach * b.width) / Math.max(1e-9, v3len(v3sub(eye, b.collar)))) * pixelsPerRadian > 0.1;
}
