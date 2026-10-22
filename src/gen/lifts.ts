/**
 * The lifts between the land and the Understorey (design "The Understorey: life below the land", 2026-10-22): each
 * entrance court's portal above (gen/courts.ts), its open bronze cage below in the next bay the portal faces
 * (gen/underMesh.ts, `underLiftOf`), and the cabin that rides the shaft between them. Where one uses a lift's doors,
 * where the cabin is at a point of its ride, and the cabin itself (in its own frame: x toward its door, z up from its
 * floor). Pure.
 */
import { smoothstep, v3cross, v3dot, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, type Habitat } from '../blueprint';
import { courtLayoutOf, courtWorld } from './courts';
import { FINISH } from './pavilion';
import { Shape, placeAt, type Place, type RGB } from './shapes';
import type { Terrain } from './terrain';
import { LIFT, underLiftIn, underLiftOf } from './underMesh';
import { levelsOf } from './underLevels';
import { underOf } from './under';

/** A lift's doors: its court, the doorway's middle (world), the way out of it (world, unit), and whether it is the cage's below. */
export interface LiftDoors {
  court: number;
  at: Vec3;
  out: Vec3;
  below: boolean;
  /** The doorway's half width and its height (m). */
  half: number;
  high: number;
}

/** How near (in handrails) one must stand to a lift's doors to use them. */
export const LIFT_REACH = 4;
/** How far past a doorway's edges a click still finds it (a share of its size). */
const DOOR_SLACK = 1.2;
/**
 * The cabin's ride: its top speed (m/s; a tower's lift, quick but easy on the ears), the least time a ride takes (s),
 */
const TOP_SPEED = 6;
const SHORTEST = 3;

/** The cabin, in handrails: its walls in from the cage's side, its height, the panels' and the rail's height, its parts' thickness. */
const CABIN = { gap: 0.15, high: 2.4, panel: 1.0, rail: 0.95, post: 0.1, plate: 0.12, lamp: 0.5 };
const BRONZE: RGB = [0.22, 0.15, 0.08];
const FLOOR: RGB = [0.3, 0.22, 0.15];
const LAMP: RGB = [1, 0.92, 0.78];

/** The handrail lifts are sized by (a habitat without landmarks has no courts, and so no lifts). */
const handrailOf = (h: Habitat): number => h.params.landmarks?.handrail ?? 1;

/** A court's portal doors, above on its paving (null for a court without a lift). */
export function doorsAbove(t: Terrain, court: number): LiftDoors | null {
  const l = courtLayoutOf(t, court), c = t.courts[court];
  if (!l || !underLiftOf(t, court)) return null;
  const a = l.portal.angle, ca = Math.cos(a), sa = Math.sin(a), z = l.pave + l.portal.high / 2;
  const at = courtWorld(t.habitat, c, [ca * l.face, sa * l.face, z]), inward = courtWorld(t.habitat, c, [ca * (l.face - 1), sa * (l.face - 1), z]);
  return { court, at, out: v3norm(v3sub(inward, at)), below: false, half: l.portal.width / 2, high: l.portal.high };
}

/** A court's lift cage's doorway, below on the Understorey's floor (null for a court without a lift). */
export function doorsBelow(t: Terrain, court: number): LiftDoors | null {
  const lift = underLiftOf(t, court), hr = handrailOf(t.habitat);
  if (!lift) return null;
  const p = cabinPlace(t, court, 0)!, x = lift.side / 2, z = (LIFT.door * hr) / 2;
  const at: Vec3 = [0, 1, 2].map((k) => p.at[k] + p.ex[k] * x + p.ez[k] * z) as Vec3;
  return { court, at, out: p.ex, below: true, half: x, high: LIFT.door * hr };
}

/** The lift doors a point (world) is near enough to use, on its level (the land's or the one below), or null. */
export function liftDoorsNear(t: Terrain, p: Vec3, below: boolean): LiftDoors | null {
  const h = t.habitat, hr = handrailOf(h), at = fromWorld(h.profile, p[0], p[1], p[2]);
  let doors: LiftDoors | null = null;
  if (below) {
    const u = underOf(h), bay = u.bayAt(at.theta, at.s);
    for (let dj = -1; bay && !doors && dj <= 1; dj++) for (let di = -1; !doors && di <= 1; di++) {
      const near = underLiftIn(t, bay.i + di, bay.j + dj);
      if (near) doors = doorsBelow(t, near.court);
    }
  } else {
    const c = t.courtAt(at.theta, at.s);
    if (c) doors = doorsAbove(t, t.courts.indexOf(c.court));
  }
  return doors && Math.hypot(doors.at[0] - p[0], doors.at[1] - p[1], doors.at[2] - p[2]) <= LIFT_REACH * hr ? doors : null;
}

/**
 * Whether a ray from the eye (`dir` unit) meets a lift's doorway from its front, within `DOOR_SLACK` of its edges: the
 * doorway stands upright (its up toward the axis) across `out`.
 */
export function doorsHit(doors: LiftDoors, eye: Vec3, dir: Vec3): boolean {
  const facing = v3dot(dir, doors.out);
  if (facing >= 0) return false;
  const along = v3dot(v3sub(doors.at, eye), doors.out) / facing;
  if (along <= 0) return false;
  const r = Math.hypot(doors.at[0], doors.at[1]), up: Vec3 = [-doors.at[0] / r, -doors.at[1] / r, 0], side = v3norm(v3cross(doors.out, up));
  const d = v3sub([0, 1, 2].map((k) => eye[k] + dir[k] * along) as Vec3, doors.at);
  return Math.abs(v3dot(d, side)) <= doors.half * DOOR_SLACK && Math.abs(v3dot(d, up)) <= (doors.high / 2) * DOOR_SLACK;
}

/** How far the cabin rides: from the Understorey's floor under its cage up to the court's paving (heights over the profile). */
export function rideOf(t: Terrain, court: number): { bottom: number; top: number } | null {
  const lift = underLiftOf(t, court);
  if (!lift) return null;
  const c = underOf(t.habitat).centreOf(lift.i, lift.j);
  return { bottom: levelsOf(t).levelAt(c.theta, c.s).floor, top: lift.above };
}

/**
 * The cabin's frame at a share `k` of its ride (0 on the floor below, 1 at the court's level): at the cage's middle,
 * x toward its doors (toward the court's bay), z up.
 */
export function cabinPlace(t: Terrain, court: number, k: number): Place | null {
  const lift = underLiftOf(t, court), ride = rideOf(t, court);
  if (!lift || !ride) return null;
  const c = underOf(t.habitat).centreOf(lift.i, lift.j), p = placeAt(t.habitat, c.theta, c.s, ride.bottom + (ride.top - ride.bottom) * Math.min(1, Math.max(0, k)));
  // The bay's frame is x along the axis (the place's ex), y round it (its ey).
  const ex = v3norm([0, 1, 2].map((a) => p.ex[a] * lift.toward[0] + p.ey[a] * lift.toward[1]) as Vec3);
  return { at: p.at, ex, ey: v3cross(p.ez, ex), ez: p.ez };
}

/** Where one stands on stepping `steps` handrails out of a lift's doors (θ, s); they then face `doors.out`. */
export function outside(h: Habitat, doors: LiftDoors, steps: number): { theta: number; s: number } {
  const step = steps * handrailOf(h), at = fromWorld(h.profile, doors.at[0] + doors.out[0] * step, doors.at[1] + doors.out[1] * step, doors.at[2] + doors.out[2] * step);
  return { theta: at.theta, s: at.s };
}

/**
 * A ride of the cabin from share `from` of its way to share `to` (`cabinPlace`): how long it takes (s), easing out of
 * the one stop and into the other (`rideShare`). A called cabin comes from out of sight above the vaults (`calledFrom`).
 */
export function rideSeconds(t: Terrain, court: number, from: number, to: number): number {
  const ride = rideOf(t, court);
  if (!ride) return SHORTEST;
  // Eased with smoothstep, the top speed is 1.5 times the mean.
  return Math.max(SHORTEST, (1.5 * Math.abs(to - from) * (ride.top - ride.bottom)) / TOP_SPEED);
}

/** The share of the way from `from` to `to` the cabin is at after `elapsed` of a ride of `seconds`. */
export const rideShare = (from: number, to: number, elapsed: number, seconds: number): number => from + (to - from) * smoothstep(0, seconds, elapsed);

/**
 * Where a called cabin sets off from, a share of its ride: one cabin's height above the vaults over its cage, in the
 * shaft and out of sight, so it is first seen coming down out of the vault.
 */
export function calledFrom(t: Terrain, court: number): number {
  const lift = underLiftOf(t, court), ride = rideOf(t, court), hr = handrailOf(t.habitat);
  if (!lift || !ride) return 1;
  const c = underOf(t.habitat).centreOf(lift.i, lift.j), ceiling = levelsOf(t).levelAt(c.theta, c.s).ceiling;
  return Math.min(1, (ceiling + CABIN.high * hr - ride.bottom) / Math.max(1e-6, ride.top - ride.bottom));
}

/**
 * The cabin of a lift whose cage is `side` wide (m), in its frame: a bronze floor, four posts, panels to waist height
 * on three sides with a rail along them, its door side open, a roof with a lamp under it. The same for every detail:
 * it is drawn only near the one riding it.
 */
export function buildCabin(h: Habitat, side: number): Shape {
  const hr = handrailOf(h), C = CABIN, w = side / 2 - C.gap * hr, top = C.high * hr, sh = new Shape(16, true, true);
  const ex: Vec3 = [1, 0, 0], ey: Vec3 = [0, 1, 0], ez: Vec3 = [0, 0, 1];
  sh.finish = FINISH.timber;
  sh.block([0, 0, -(C.plate * hr) / 2], ex, ey, ez, [w, w, (C.plate * hr) / 2], FLOOR);
  sh.finish = FINISH.bronze;
  sh.block([0, 0, top + (C.plate * hr) / 2], ex, ey, ez, [w, w, (C.plate * hr) / 2], BRONZE);
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) sh.block([a * w, b * w, top / 2], ex, ey, ez, [(C.post * hr) / 2, (C.post * hr) / 2, top / 2], BRONZE);
  // The panels and rail: the back (−x) and both sides (±y).
  const t = (C.post * hr) / 4;
  for (const [c, half] of [[[-w, 0, 0], [t, w, 0]], [[0, w, 0], [w, t, 0]], [[0, -w, 0], [w, t, 0]]] as [Vec3, Vec3][]) {
    sh.block([c[0], c[1], (C.panel * hr) / 2], ex, ey, ez, [half[0], half[1], (C.panel * hr) / 2], BRONZE);
    sh.block([c[0], c[1], C.rail * hr + C.panel * hr * 0.05], ex, ey, ez, [half[0] + t, half[1] + t, t], BRONZE);
  }
  // The lamp: a glowing disc under the roof.
  sh.finish = FINISH.lamp;
  sh.arc(top - 0.01, 0, top - 0.01, C.lamp * hr, -1, 0, 0, 2 * Math.PI, 16, LAMP);
  return sh;
}

/** The world eye of one standing in the cabin at `p`, `eye` m over its floor. */
export const eyeInCabin = (p: Place, eye: number): Vec3 => [0, 1, 2].map((a) => p.at[a] + p.ez[a] * eye) as Vec3;
