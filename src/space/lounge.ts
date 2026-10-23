/**
 * The lounge (plan "The Threshold", step 5: "You are on board"): the deck under a ship's nose with its band of tall
 * panoramic windows all round (shipDetail.ts `deckWindows`), where the newcomer and a few other passengers watch the
 * habitat come up. Pure: the room's measures, its couches and their places, which places the cabin shot sees, and
 * the shot's camera, all in the ship frame (m; +x to the nose, angles round the axis from +y toward +z).
 *
 * The room is the ship's own: its windows are the ones the hull shows from outside, at the same angles, so the cut
 * from outside to inside keeps the ship. Under the main drive down is aft, so the floor is the deck's aft side. On the
 * approach the ship only trims and slows on its thrusters, a few hundredths of a g: the passengers stay in their
 * couches, belted.
 */
import { angleDiff, v3add, v3dot, v3norm, v3scale, type Vec3 } from '@futuremagic/core';
import { DECK, deckWindows, type DeckWindows } from './shipDetail';
import { crewSection, shipAxesOf, type ShipShape } from './ship';

/** The room's measures (m, or shares of the deck's inner radius where marked). */
export const LOUNGE = {
  /** The hull's wall inside the plating, round the windows (m). */
  wall: 0.3,
  /** The core up the middle (lift, stair, pipes): its radius, a share of the room's; a room narrower than `coreFrom` (m) has none. */
  core: 0.16,
  coreFrom: 4,
  /** A couch: its front this far in from the wall, its seat's height, depth and width per place (m); its back's height. */
  couch: { from: 1.3, seat: 0.44, deep: 0.62, place: 0.64, back: 0.82 },
  /** Couches stand at every window but each `every`th (an aisle to the glass between them). */
  every: 3,
  /** The newcomer's eyes: this far from the axis (share of the room's radius; at least `clear` m off the core and behind the couches' backs), this high over the floor (m), standing. */
  eye: { out: 0.38, high: 1.62, clear: 0.25 },
  /** How far the shot tilts down toward the floor from straight out (rad): the couches and their sitters in the bottom of the frame, the window above them. */
  tilt: 0.3,
  /**
   * The light of the room's own lamps on the floor (relative to full sunlight: about 800 lux, a liner's lit lounge), and
   * the mean albedo of its walls, floor and couches as the eyes' meter takes it.
   */
  lamps: 0.008,
  albedo: 0.4,
};

/** A place on a couch: the middle of its seat at the front edge (where the knees bend), the way its sitter faces. */
export interface Place {
  at: Vec3;
  facing: Vec3;
  /** Which couch, which place on it. */
  couch: number;
  seat: number;
}

export interface Couch {
  /** The angle it faces out at (its window's), its middle's distance from the axis (m), its places. */
  angle: number;
  out: number;
  places: Place[];
}

export interface Lounge {
  /** The deck's floor and ceiling along the ship (m). */
  floor: number;
  ceiling: number;
  /** The room's radius (the wall's inside) and the hull's (m). */
  radius: number;
  hull: number;
  /** The panoramic windows (their sill, height, width, angles). */
  windows: DeckWindows;
  /** The core's radius (m). */
  core: number;
  couches: Couch[];
}

/** A point at angle a round the axis, r from it, x along it. */
const round = (x: number, r: number, a: number): Vec3 => [x, r * Math.cos(a), r * Math.sin(a)];

/** The lounge of a ship, or null for one without a decked crew section (a tender's cockpit, a ship with one deck). */
export function loungeOf(shape: ShipShape): Lounge | null {
  const crew = crewSection(shape);
  if (!crew || crew.offset) return null;
  const windows = deckWindows(crew).find((d) => d.panorama);
  if (!windows) return null;
  const radius = crew.radius - LOUNGE.wall, c = LOUNGE.couch, couches: Couch[] = [];
  // Up to three places a couch, as many as leave room to pass between it and the next.
  const out = radius - c.from - c.deep / 2, between = (2 * Math.PI * out * LOUNGE.every) / windows.count;
  const n = Math.max(1, Math.min(3, Math.floor(between / c.place) - 1));
  for (let k = 0; k < windows.count; k += LOUNGE.every) {
    const angle = windows.turn + (k * 2 * Math.PI) / windows.count, i = couches.length;
    const facing = round(0, 1, angle), across = round(0, 1, angle + Math.PI / 2);
    const front = round(windows.floor + c.seat, radius - c.from, angle);
    couches.push({
      angle, out,
      places: Array.from({ length: n }, (_, j) => ({ at: v3add(front, v3scale(across, (j - (n - 1) / 2) * c.place)), facing, couch: i, seat: j })),
    });
  }
  return { floor: windows.floor, ceiling: windows.floor + DECK, radius, hull: crew.radius, windows, core: radius < LOUNGE.coreFrom ? 0 : radius * LOUNGE.core, couches };
}

/** The angle round the axis (rad) of the window most nearly facing `toward` (a direction in the ship frame). */
export function windowFacing(l: Lounge, toward: Vec3): number {
  const a = Math.atan2(toward[2], toward[1]), w = l.windows, step = (2 * Math.PI) / w.count;
  return w.turn + Math.round((a - w.turn) / step) * step;
}

/**
 * The cabin shot's camera in the ship frame: standing behind the couches, looking out of the window at `look` (rad),
 * tilted a little down over them. Its up is the nose (the floor is aft).
 */
export function cabinCamera(l: Lounge, look: number): { eye: Vec3; target: Vec3 } {
  const e = LOUNGE.eye, behind = l.couches[0].out - LOUNGE.couch.deep / 2 - e.clear;
  const eye = round(l.floor + e.high, Math.min(behind, Math.max(l.core + e.clear, l.radius * e.out)), look);
  const out = round(0, 1, look), ahead = v3norm(v3add(out, [-Math.tan(LOUNGE.tilt), 0, 0]));
  return { eye, target: v3add(eye, v3scale(ahead, 10)) };
}

/**
 * The places the cabin shot sees, nearest the window it looks out of first: on the couches within `spread` (rad) of
 * `look`, between the camera and the glass.
 */
export function placesInView(l: Lounge, look: number, spread = 0.45): Place[] {
  const off = (a: number): number => Math.abs(angleDiff(look, a));
  return l.couches.filter((c) => off(c.angle) <= spread).sort((a, b) => off(a.angle) - off(b.angle)).flatMap((c) => c.places);
}

/** A point of the ship frame in the frame the ship is posed in (its stern at `position`, nose along `forward`). */
export function fromShip(pose: { position: Vec3; forward: Vec3; up: Vec3 }, p: Vec3): Vec3 {
  return v3add(pose.position, fromShipDirection(pose, p));
}

/** A direction of the ship frame in the frame the ship is posed in. */
export function fromShipDirection(pose: { forward: Vec3; up: Vec3 }, d: Vec3): Vec3 {
  const { x, y, z } = shipAxesOf(pose);
  return v3add(v3scale(x, d[0]), v3add(v3scale(y, d[1]), v3scale(z, d[2])));
}

/** A direction of the frame the ship is posed in, in the ship frame. */
export function toShipDirection(pose: { forward: Vec3; up: Vec3 }, d: Vec3): Vec3 {
  const { x, y, z } = shipAxesOf(pose);
  return [v3dot(d, x), v3dot(d, y), v3dot(d, z)];
}

/** How far the angle `a` round the axis is from the middle of the window nearest it (rad). */
const offWindow = (l: Lounge, a: number): number => {
  const step = (2 * Math.PI) / l.windows.count;
  return Math.abs(angleDiff(0, a - l.windows.turn - Math.round((a - l.windows.turn) / step) * step));
};

/** Half a window's width as an angle round the axis (rad): the hull's own (shipDetail.ts lays them at its radius). */
export const windowHalf = (l: Lounge): number => l.windows.wide / l.hull / 2;

/**
 * Whether a ray from `from` (in the room) along `d` (both in the ship frame) leaves the room through a window, not
 * against its wall, floor, ceiling or core: what the eyes' meter sees out of, and where the Sun shines in.
 */
export function throughWindow(l: Lounge, from: Vec3, d: Vec3): boolean {
  const a = d[1] * d[1] + d[2] * d[2];
  if (a < 1e-12) return false;
  const b = from[1] * d[1] + from[2] * d[2], c = from[1] ** 2 + from[2] ** 2;
  // The core first: the ray meets it if it comes in toward the axis close enough.
  if (l.core > 0 && b < 0 && b * b - a * (c - l.core ** 2) > 0 && c > l.core ** 2) return false;
  const t = (-b + Math.sqrt(Math.max(0, b * b - a * (c - l.radius ** 2)))) / a, x = from[0] + t * d[0];
  if (x < l.floor + l.windows.sill || x > l.floor + l.windows.sill + l.windows.high) return false;
  return offWindow(l, Math.atan2(from[2] + t * d[2], from[1] + t * d[1])) < windowHalf(l);
}

/**
 * The light the windows let into the room (relative to full sunlight) from what each looks out on: `luminance` of the
 * view along a direction out (ship frame). Each window gives its luminance times the solid angle it fills seen from the
 * room's middle, over π; `all` is their sum, `toward` the same weighted by each one's direction out, so a surface
 * facing `n` takes about (all + n · toward) / 2: the window it faces fully, those beside it half (the light the pale
 * room passes around), none from behind it.
 */
export function windowLight(l: Lounge, luminance: (d: Vec3) => number): { all: number; toward: Vec3 } {
  const w = l.windows, solid = (w.wide * w.high) / (l.hull * l.hull) / Math.PI;
  let all = 0, toward: Vec3 = [0, 0, 0];
  for (let k = 0; k < w.count; k++) {
    const a = w.turn + (k * 2 * Math.PI) / w.count, out = round(0, 1, a);
    // Straight out of the window, as someone in the room sees it.
    const e = luminance(out) * solid;
    all += e;
    toward = v3add(toward, v3scale(out, e));
  }
  return { all, toward };
}
