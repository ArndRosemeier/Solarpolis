/**
 * The title's attract loop (design "Solarpolis: the outside", "The title sequence", shots 1 to 3): a live flight at
 * real speed, cut between shots, framed by a small cinematographer for every habitat and seed instead of by hand.
 *
 * 1. Wide, behind a torch ship braking at the keep-out distance, Earth's limb low in the frame, the ring's glints
 *    strung along it; the flame shrinks and goes out. One glint is home.
 * 2. The ship's own camera at about 50 outer radii, zooming slowly from wide to long: the glint becomes a spool.
 * 3. Alongside the drum, one outer radius off it, flying toward the port end while the patchwork streams past.
 *
 * After Start (`arrival`), the passenger's own ship (space/traffic.ts, `guestVisit`) comes in to its berth:
 *
 * 4. Above the ship, looking down the corridor past its nose: the still spindle grows in front of the turning endcap.
 * 5. Close on the berth: the nose meets the collar, a soft jolt as it latches.
 * 6. The passenger's eyes, floating down the spindle's still bore, through the bearing's seal into the sleeve that
 *    turns with the habitat; the air there carries them into the spin, so the walls around begin to turn less fast
 *    than the stars in its window. Light ahead: the Hub.
 *
 * Each shot plays at real speed; the clock jumps at the cuts, so nothing moves faster than it would (the real
 * approach takes many minutes).
 *
 * Before shot 1, once per page (`opening`): the Necklace round Earth from far beyond home, the ring's habitats strung
 * as glints round the planet, home the nearest just under its limb. It is drawn the moment the page opens, by its own
 * small renderer (src/boot), while the Outside view loads behind it; the cut to shot 1 is where the two hand over.
 *
 * Every distance is a multiple of the home habitat's outer radius, so the same shots frame the smallest and the
 * largest habitat (the opening's are multiples of the ring's radius: it frames the ring, not the habitat). Positions are in the home habitat's orbit frame (its centre at the origin), float64. Pure.
 */
import { hash3i, hashToFloat, v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { EARTH } from './constants';
import type { Habitat } from '../blueprint';
import type { Space } from './space';
import { skyFrom } from './sky';
import { cabinCamera, fromShip, loungeOf, toShipDirection, windowFacing } from './lounge';
import { shipShape } from './ship';
import { approachOf as phasesOf, beforeBerth, berthOf, guestShip, guestVisit, shipAt, type Visit } from './traffic';

/** Shot lengths (s), as the plan has them. */
export const SHOTS = [12, 13, 15] as const;
export const LOOP = SHOTS[0] + SHOTS[1] + SHOTS[2];
/** Where Earth's centre sits below the middle of shot 1 (rad): its upper limb in the lower part of the frame. */
const EARTH_BELOW = (17 * Math.PI) / 180;
/** The ship's camera in shot 2, in outer radii from the habitat; shot 3's speed along the drum, in outer radii per second. */
const SHOT2_DISTANCE = 50;
const SHOT3_SPEED = 0.25;
/** At the end of shot 2 the habitat spans 1 / SHOT2_FILL of the frame's height: the middle, between the name and Start. */
const SHOT2_FILL = 1.9;
/** How much of Earth's disc is lit at the start (chooseStart). */
export const LIT_FROM = 0.55;
export const LIT_TO = 0.85;

export interface Frame {
  shot: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Seconds into the shot, and the shot's length. */
  time: number;
  length: number;
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view (degrees). */
  fov: number;
  /** The torch ship, in shot 1 only: where its drive exit is, which way its nose points, how hard it thrusts (0–1). */
  ship: { position: Vec3; forward: Vec3; up: Vec3; throttle: number } | null;
  /** How far the title has faded in (0–1). */
  title: number;
}

export interface Cinema {
  /** Clock time the loop starts at (s since the space's epoch). */
  start: number;
  /** Unit direction the ship comes in along, toward the habitat. */
  approach: Vec3;
  /** The frame at `elapsed` seconds into the loop (it repeats every LOOP seconds). */
  at(elapsed: number): Frame;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much of Earth's disc seen from the habitat is lit (0 new, 1 full). */
function earthLit(sunDir: Vec3, earthDir: Vec3): number {
  return (1 - v3dot(sunDir, earthDir)) / 2;
}

/**
 * The first moment from `from` on (searching `hours` ahead in ten-minute steps) with the habitat in full sunlight and
 * Earth gibbous behind it (between LIT_FROM and LIT_TO of its disc lit): the Sun is then behind the camera's
 * shoulder, out of every shot, and lights most of the side the long lens of shot 2 sees. Falls back to `from`.
 */
export function chooseStart(space: Space, from: number, hours = 48): number {
  const f = space.home.orbitFrame;
  for (let k = 0; k < hours * 6; k++) {
    const t = from + k * 600;
    const sky = skyFrom(space, f, [0, 0, 0], t);
    const e = v3norm(sky.earth.center);
    const lit = earthLit(sky.sunDir, e);
    const look = approachOf(e);
    if (sky.sunlight >= 1 && lit > LIT_FROM && lit < LIT_TO && v3dot(look, sky.sunDir) < 0) return t;
  }
  return from;
}

/** Toward Earth, tipped toward the ecliptic pole, so Earth sits low in the frame behind the habitat. */
function approachOf(earthDir: Vec3): Vec3 {
  const pole: Vec3 = [0, 0, 1];
  const p = v3norm(v3sub(pole, v3scale(earthDir, v3dot(pole, earthDir))));
  return v3norm(v3add(v3scale(earthDir, Math.cos(EARTH_BELOW)), v3scale(p, Math.sin(EARTH_BELOW))));
}

/**
 * The attract loop for the home habitat, from clock time `start`. `keepOut` is where torch ships cut their drive (in
 * outer radii), `shipLength` the ship's length (m). `titled`: the opening already brought the title up, so it stays up
 * through the first pass instead of fading in again over shot 1.
 */
export function attractLoop(space: Space, start: number, keepOut: number, shipLength: number, titled = false): Cinema {
  const h = space.home.habitat, Ro = h.exterior.radius, L = h.exterior.portFace - h.exterior.wildFace;
  const sky = skyFrom(space, space.home.orbitFrame, [0, 0, 0], start);
  const earthDir = v3norm(sky.earth.center);
  const approach = approachOf(earthDir);
  // Camera up: the pole, made square to the approach.
  const pole: Vec3 = [0, 0, 1];
  const up = v3norm(v3sub(pole, v3scale(approach, v3dot(pole, approach))));
  const side = v3norm(v3cross(approach, up));
  // The port end's direction in the orbit frame (the body's +z).
  const pose = space.frames.relative(space.home.bodyFrame, space.home.orbitFrame, start);
  const port: Vec3 = [pose.axes[2], pose.axes[5], pose.axes[8]];
  // The sunlit side of the drum, a little round from the Sun, for shot 3.
  const sunAcross = v3norm(v3sub(sky.sunDir, v3scale(port, v3dot(sky.sunDir, port))));
  const across = v3norm(v3add(v3scale(sunAcross, Math.cos(0.7)), v3scale(v3cross(port, sunAcross), Math.sin(0.7))));
  const span = Math.max(L, 2 * Math.max(Ro, ...h.exterior.brims.map((b) => b.tip)));

  return {
    start,
    approach,
    at(elapsed: number): Frame {
      let t = ((elapsed % LOOP) + LOOP) % LOOP;
      if (t < SHOTS[0]) {
        // Shot 1: the ship hangs at the keep-out distance, its stern toward home, braking to a stop.
        const ship = v3scale(approach, -keepOut * Ro);
        const eye = v3add(ship, v3add(v3scale(approach, -3 * shipLength), v3add(v3scale(up, 0.5 * shipLength), v3scale(side, 0.7 * shipLength))));
        const drift = v3scale(side, (t / SHOTS[0]) * 0.4 * shipLength);
        return {
          shot: 0, time: t, length: SHOTS[0], eye: v3add(eye, drift), target: [0, 0, 0], up, fov: 40,
          ship: { position: ship, forward: v3scale(approach, -1), up, throttle: 1 - smooth(5, 10, t) },
          title: titled && elapsed < LOOP ? 1 : smooth(3, 8, t),
        };
      }
      t -= SHOTS[0];
      if (t < SHOTS[1]) {
        // Shot 2: from the ship, the long lens closing in on the habitat.
        const dist = SHOT2_DISTANCE * Ro;
        const eye = v3scale(approach, -dist);
        const wide = 30, long = ((SHOT2_FILL * span) / dist) * (180 / Math.PI);
        const fov = wide * Math.pow(long / wide, smooth(0, SHOTS[1], t));
        return { shot: 1, time: t, length: SHOTS[1], eye, target: [0, 0, 0], up, fov, ship: null, title: 1 };
      }
      t -= SHOTS[1];
      // Shot 3: one outer radius off the sunlit drum, flying toward the port end, looking ahead and in.
      const z = -0.3 * L + t * SHOT3_SPEED * Ro;
      const eye = v3add(v3scale(across, 2 * Ro), v3scale(port, z));
      const target = v3add(v3scale(across, Ro * 0.6), v3scale(port, z + 2.5 * Ro));
      return { shot: 2, time: t, length: SHOTS[2], eye, target, up: across, fov: 50, ship: null, title: 1 };
    },
  };
}

/**
 * The opening (before shot 1, once per page): at least this long after its first frame (s), so the name can come up
 * over it; it lasts until the Outside view is ready behind it, however long that takes.
 */
export const OPENING_MIN = 7;
/**
 * Where the opening's eye hangs, in radii of the ring (the geostationary orbit): this far beyond home, away from Earth
 * (home is then the nearest glint, Earth about 10° across), and this far above the ring's plane (the ring opens into
 * a slim ellipse round Earth, home just under its limb). It drifts round Earth by OPENING_DRIFT rad per second, so the
 * ring turns slowly against the planet.
 */
const OPENING_BACK = 0.7;
const OPENING_LIFT = 0.19;
const OPENING_SIDE = 0.1;
const OPENING_DRIFT = 0.0015;
/** The opening's field of view (degrees), and how far Earth's centre sits below the middle, in Earth radii. */
export const OPENING_FOV = 40;
const OPENING_EARTH_LOW = 0.9;

export interface OpeningFrame {
  /** Seconds since the opening's first frame, and the clock time it shows (real speed from `start`). */
  time: number;
  clock: number;
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
}

export interface Opening {
  start: number;
  at(elapsed: number): OpeningFrame;
}

/**
 * The opening for the home habitat from clock time `start` (chooseStart's moment: home sunlit, Earth gibbous, the Sun
 * behind the eye). Positions in the home orbit frame, as every frame here.
 */
export function opening(space: Space, start: number): Opening {
  return {
    start,
    at(elapsed: number): OpeningFrame {
      const clock = start + elapsed, f = space.frames;
      const earth = f.position([0, 0, 0], 'earth', space.home.orbitFrame, clock);
      const R = v3len(earth);
      const a = f.relative('earth.fixed', space.home.orbitFrame, clock).axes;
      const north = v3norm([a[2], a[5], a[8]]);
      // Home's radial from Earth (in the ring's plane), and the ring's direction of travel.
      const out = v3norm(v3sub(v3scale(earth, -1), v3scale(north, v3dot(v3scale(earth, -1), north))));
      const along = v3cross(north, out);
      const phi = OPENING_SIDE + OPENING_DRIFT * elapsed;
      const radial = v3add(v3scale(out, Math.cos(phi)), v3scale(along, Math.sin(phi)));
      const eye = v3add(earth, v3add(v3scale(radial, R * (1 + OPENING_BACK)), v3scale(north, R * OPENING_LIFT)));
      // Look at a point above Earth's centre, so Earth sits low and the name has the stars above it.
      const toEarth = v3sub(earth, eye), dist = v3len(toEarth);
      const lowered = Math.asin(EARTH.radius / dist) * OPENING_EARTH_LOW;
      const flat = v3norm(v3sub(north, v3scale(toEarth, v3dot(north, toEarth) / (dist * dist))));
      const look = v3norm(v3add(v3scale(toEarth, Math.cos(lowered) / dist), v3scale(flat, Math.sin(lowered))));
      const up = v3norm(v3sub(north, v3scale(look, v3dot(north, look))));
      return { time: elapsed, clock, eye, target: v3add(eye, v3scale(look, dist)), up, fov: OPENING_FOV };
    },
  };
}

/**
 * The arrival's shot lengths (s): shot 4 down the corridor, the cabin shot from the lounge (space/lounge.ts) as the
 * ship creeps in along its berth arm with the port face beside it, shot 5 at the berth (long enough after contact to see the clamps home and
 * the collar's lights turn green, space/dock.ts), shot 6 through the bore.
 */
export const ARRIVAL_SHOTS = [7, 8, 13, 15] as const;
export const ARRIVAL = ARRIVAL_SHOTS[0] + ARRIVAL_SHOTS[1] + ARRIVAL_SHOTS[2] + ARRIVAL_SHOTS[3];
/** When the berth shot starts, and the crossing (s after Start). */
const BERTH_SHOT = ARRIVAL_SHOTS[0] + ARRIVAL_SHOTS[1];
const CROSSING_SHOT = BERTH_SHOT + ARRIVAL_SHOTS[2];
/** The cabin shot's field of view (degrees): a person's, standing in a room. */
export const CABIN_FOV = 62;
/** Shot 4 starts with the ship this far up its corridor (outer radii; at most half its coast, where it slows). */
const SHOT4_UP = 1.5;
/** Shot 5 starts this long before the ship berths (s); the rest of it is the jolt, the clamps and the green light. */
const SHOT5_BEFORE = 7;
/** The cabin shot starts this long before the berth (s): on the final creep in, the ship beside the port face. */
const CABIN_BEFORE = 30;
/** On the final creep in, the thrusters trim about this often (s), and a turn's start and stop is a pair of pulses this far apart (s). */
const TRIM = 2.6, PAIR = 0.35;
/** Shot 6: this long after the berth (s; through the lock and along the arm), floating at this pace (m/s), the bearing
 * passed this share of the way through the shot. The air in the sleeve brings a passenger up to the spin in SPIN_UP s. */
const SHOT6_AFTER = 90;
const DRIFT = 1;
const BEARING_AT = 0.45;
export const SPIN_UP = 60;

export interface ArrivalFrame extends Frame {
  /** The clock time this frame shows (s since the space's epoch). */
  clock: number;
  /**
   * In the cabin shot: the window it looks out of (rad round the ship's axis, space/lounge.ts) and where the ship is
   * (its stern, nose and up in the orbit frame, as the frame's eye), so the lounge is drawn round the eye.
   */
  cabin?: { look: number; ship: { position: Vec3; forward: Vec3; up: Vec3 } };
}

/**
 * When the arrival's moments come, in seconds since Start, from what the ship really does in the time each shot shows
 * (space/traffic.ts `shipAt`): its thrusters burning steadily as it slows up its corridor, the pulses that start and
 * stop its turn and trim its final creep in, the berth, then the passenger through the lock and past the bearing.
 */
export interface ArrivalMoments {
  /** Spans of a steady burn (the coast, slowing on the thrusters). */
  burns: Array<[number, number]>;
  /** Single thruster pulses, in order. */
  pulses: number[];
  berth: number;
  /** Shot 6 begins: through the lock, into the bore. */
  through: number;
  /** The bearing is passed: from here the air turns the passenger with the habitat. */
  bearing: number;
}

export interface Arrival {
  /** The passenger's ship's visit (draw it with the traffic: `trafficAt(..., guest)`). */
  guest: Visit;
  moments: ArrivalMoments;
  /** The frame at `elapsed` seconds after Start; null once the arrival is over. */
  at(elapsed: number): ArrivalFrame | null;
}

/** The arrival after Start, pressed at clock time `after`: the passenger's ship's last minutes in two shots. */
export function arrival(space: Space, after: number): Arrival {
  const p = space.home, h = p.habitat, ship = guestShip(space, p), L = ship.length, B = ship.beam;
  const lead = beforeBerth(h, ship, SHOT4_UP * h.exterior.radius);
  const guest = guestVisit(space, p, after, lead), { collar, radial } = berthOf(h, guest.arm);
  const toOrbit = (q: Vec3, t: number): Vec3 => space.frames.position(q, p.spindleFrame, p.orbitFrame, t);
  const dirOrbit = (q: Vec3, t: number): Vec3 => space.frames.direction(q, p.spindleFrame, p.orbitFrame, t);
  // Shot 5 looks from the sunlit side of the arm, so the ship's flank in it is lit.
  const sun = space.frames.direction(skyFrom(space, p.orbitFrame, [0, 0, 0], guest.docked).sunDir, p.orbitFrame, p.spindleFrame, guest.docked);
  const across = v3cross([0, 0, 1], radial), side = v3dot(across, sun) >= 0 ? across : v3scale(across, -1);
  // Shot 6, in the spindle's frame: a third of the way out from the axis, down the bore at DRIFT, the bearing passed
  // BEARING_AT of the way through (sooner or later where the bore is short), then turning with the air.
  const b = h.exterior.spindle.bore, T = ARRIVAL_SHOTS[3];
  const z0 = Math.min(b.to - b.radius, b.bearing + BEARING_AT * T * DRIFT), z1 = Math.max(b.from + 1.5 * b.radius, b.bearing - (1 - BEARING_AT) * T * DRIFT);
  const bearingIn = (T * (z0 - b.bearing)) / (z0 - z1);
  // The cabin shot looks out at the port face's middle, where the spindle stands (a ship without a lounge stays outside).
  const lounge = loungeOf(shipShape(ship)), face: Vec3 = [0, 0, h.exterior.spindle.from];
  const crossing = (time: number): ArrivalFrame => {
    const clock = guest.docked + SHOT6_AFTER + time, z = z0 + (z1 - z0) * (time / T);
    // Seconds since the bearing, and how far the air has turned the passenger round the axis since (rad).
    const since = Math.max(0, time - bearingIn);
    const a = (h.spin * Math.min(since, SPIN_UP) ** 2) / (2 * SPIN_UP) + h.spin * Math.max(0, since - SPIN_UP);
    const r = b.radius / 3, out: Vec3 = [Math.cos(a), Math.sin(a), 0];
    const eye: Vec3 = [out[0] * r, out[1] * r, z], target: Vec3 = [0, 0, z - 20 * b.radius];
    return { shot: 6, time, length: T, eye: toOrbit(eye, clock), target: toOrbit(target, clock), up: dirOrbit(v3scale(out, -1), clock), fov: 70, ship: null, title: 0, clock };
  };
  return {
    guest,
    moments: momentsOf(h, guest, lead, CROSSING_SHOT + bearingIn, lounge !== null),
    at(elapsed: number): ArrivalFrame | null {
      if (elapsed < 0 || elapsed >= ARRIVAL) return null;
      if (elapsed < BERTH_SHOT && lounge && elapsed >= ARRIVAL_SHOTS[0]) {
        // The cabin shot: in the lounge under the nose, looking out of the window that faces the port face, past the
        // other passengers in their couches, as the ship creeps in along its arm.
        const time = elapsed - ARRIVAL_SHOTS[0], clock = guest.docked - CABIN_BEFORE + time, s = shipAt(h, guest, clock)!;
        const toFace = toShipDirection(s, v3sub(face, fromShip(s, [lounge.floor, 0, 0]))), look = windowFacing(lounge, toFace);
        // Up is the nose: the floor is aft.
        const c = cabinCamera(lounge, look);
        return { shot: 4, time, length: ARRIVAL_SHOTS[1], eye: toOrbit(fromShip(s, c.eye), clock), target: toOrbit(fromShip(s, c.target), clock), up: dirOrbit(s.forward, clock), fov: CABIN_FOV, ship: null, title: 0, clock,
          cabin: { look, ship: { position: toOrbit(s.position, clock), forward: dirOrbit(s.forward, clock), up: dirOrbit(s.up, clock) } } };
      }
      if (elapsed < BERTH_SHOT) {
        // Shot 4: behind the ship, above its back (toward the axis) and out to its sunlit side, looking past its nose
        // at the spindle: the ship in three-quarter view, low and to one side of the frame.
        const clock = guest.docked - lead + elapsed, s = shipAt(h, guest, clock)!;
        const mid = v3add(s.position, v3scale(s.forward, L / 2));
        const eye = v3add(mid, v3add(v3scale(s.forward, -2.2 * L), v3add(v3scale(s.up, 0.45 * L), v3scale(side, 0.6 * L))));
        const target: Vec3 = [0, 0, h.exterior.spindle.arms.z];
        return { shot: 3, time: elapsed, length: lounge ? ARRIVAL_SHOTS[0] : BERTH_SHOT, eye: toOrbit(eye, clock), target: toOrbit(target, clock), up: dirOrbit(s.up, clock), fov: 50, ship: null, title: 0, clock };
      }
      if (elapsed >= CROSSING_SHOT) return crossing(elapsed - CROSSING_SHOT);
      // Shot 5: beside the arm's tip, a little out along it, the collar in the middle; a soft jolt as it latches.
      const time = elapsed - BERTH_SHOT, clock = guest.docked - SHOT5_BEFORE + time, since = clock - guest.docked;
      const jolt = since > 0 ? 0.03 * B * Math.exp(-3 * since) * Math.sin(4 * Math.PI * since) : 0;
      const eye = v3add(collar, v3add(v3scale(radial, 0.6 * L - jolt), v3add(v3scale(side, 0.8 * L), [0, 0, 0.28 * L])));
      const target = v3add(collar, v3scale(radial, 0.35 * L));
      return { shot: 5, time, length: ARRIVAL_SHOTS[2], eye: toOrbit(eye, clock), target: toOrbit(target, clock), up: dirOrbit([0, 0, 1], clock), fov: 58, ship: null, title: 0, clock };
    },
  };
}

/**
 * The arrival's moments (ArrivalMoments) for a guest whose shot 4 starts `lead` s before it berths: shot 4, the cabin
 * shot (`cabin`: the ship has a lounge) and shot 5 each show a stretch of its approach (`u` s before the berth,
 * counting down), cut between; the burns, pulses and the berth are heard where they fall in what is shown.
 */
function momentsOf(h: Habitat, guest: Visit, lead: number, bearing: number, cabin: boolean): ArrivalMoments {
  const a = phasesOf(h, guest.ship), turnFrom = a.final + a.turn, coastTo = turnFrom + 2 * a.half;
  const shown = [
    ...(cabin ? [{ from: 0, to: ARRIVAL_SHOTS[0], u: lead }, { from: ARRIVAL_SHOTS[0], to: BERTH_SHOT, u: CABIN_BEFORE }] : [{ from: 0, to: BERTH_SHOT, u: lead }]),
    { from: BERTH_SHOT, to: CROSSING_SHOT, u: SHOT5_BEFORE },
  ];
  const burns: Array<[number, number]> = [], pulses: number[] = [];
  /** Where `u` s before the berth is shown (s since Start), if it is. */
  const when = (u: number): number[] => shown.map((w) => w.from + w.u - u).filter((e, k) => e >= shown[k].from && e < shown[k].to);
  for (const w of shown) {
    const from = Math.max(w.from, w.from + w.u - coastTo), to = Math.min(w.to, w.from + w.u - turnFrom);
    if (to > from) burns.push([from, to]);
  }
  for (const u of [turnFrom, a.final]) for (const e of when(u)) pulses.push(e, e + PAIR);
  // Trims on the final creep in, on the clock (so a shot cut does not move them), each a little early or late.
  for (const w of shown) {
    const uHi = Math.min(a.final, w.u), uLo = Math.max(0, w.u - (w.to - w.from));
    for (let n = Math.ceil((guest.docked - uHi) / TRIM); n * TRIM <= guest.docked - uLo; n++) {
      const u = guest.docked - (n + 0.6 * (hashToFloat(hash3i(guest.ship.seed, n, 0x7219, 0)) - 0.5)) * TRIM;
      if (u > uLo && u <= uHi) pulses.push(w.from + w.u - u);
    }
  }
  return { burns, pulses: pulses.sort((x, y) => x - y), berth: when(0)[0] ?? BERTH_SHOT + SHOT5_BEFORE, through: CROSSING_SHOT, bearing };
}

/**
 * Where the passenger floats out of the bore into the Hub, in the habitat's frame (m): just inside the port end,
 * halfway between the sunline and the Hub's rim (the bore lies on the axis, inside the sunline's radius, so the way out
 * of it comes out beside the light), looking down the sunline to the wild end. The Inside view takes over here.
 */
export function hubView(h: Habitat): { eye: Vec3; look: Vec3 } {
  const { hubRadius, sunlineRadius } = h.params, r = (hubRadius + sunlineRadius) / 2;
  return { eye: [r, 0, h.exterior.spindle.bore.from - (hubRadius - sunlineRadius) / 2], look: [0, 0, -1] };
}
