/**
 * The title's attract loop (design "Solarpolis: the outside", "The title sequence", shots 1 to 3): a live flight at
 * real speed, cut between shots, framed by a small cinematographer for every habitat and seed instead of by hand.
 *
 * 1. Wide, behind a torch ship braking at the keep-out distance, Earth's limb low in the frame, the ring's glints
 *    strung along it; the flame shrinks and goes out. One glint is home.
 * 2. The ship's own camera at about 50 outer radii, zooming slowly from wide to long: the glint becomes a spool.
 * 3. Alongside the drum, one outer radius off it, flying toward the port end while the patchwork streams past.
 *
 * Every distance is a multiple of the home habitat's outer radius, so the same shots frame the smallest and the
 * largest habitat. Positions are in the home habitat's orbit frame (its centre at the origin), float64. Pure.
 */
import { v3add, v3cross, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Space } from './space';
import { skyFrom } from './sky';

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
  shot: 0 | 1 | 2;
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
 * outer radii), `shipLength` the ship's length (m).
 */
export function attractLoop(space: Space, start: number, keepOut: number, shipLength: number): Cinema {
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
          title: smooth(3, 8, t),
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
