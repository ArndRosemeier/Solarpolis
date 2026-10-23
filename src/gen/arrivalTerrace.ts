/** The existing Lift Stair's upper landing is the port's arrival overlook.
 * Its entrance, clear walking strip and exit all derive from that landing and its last leg. Pure. */
import type { Habitat, Vec3 } from '../blueprint';
import { liftStairOf, rampOf, type PlanPoint, type StairPlatform } from './liftStair';

/**
 * Where a transport capsule waits for the newcomer (thread "Transport capsules", `capStopsOf` in gen/capsules.ts
 * reads it): `at` on the landing's floor, the way its door faces (`out`, unit, along the floor toward the walking
 * strip), and the radius kept free of canopy, seats and rails around it and open toward the axis above it (m).
 */
export interface ArrivalBerth {
  at: Vec3;
  out: Vec3;
  clear: number;
}

export interface ArrivalTerrace {
  platform: StairPlatform;
  handrail: number;
  start: PlanPoint;
  finish: PlanPoint;
  exit: PlanPoint;
  feet: Vec3;
  exitWorld: Vec3;
  /** The plan z of the port door's face, at the back of the porch: the newcomer steps out of it. */
  door: number;
  /** The capsule berth on the open front of the landing, or null where the landing has no room for one. */
  berth: ArrivalBerth | null;
}

/** The door's face from the landing's back edge (handrails), and its half thickness. */
export const DOOR_BACK = 0.6, DOOR_HALF = 0.08;
/** The berth's clear radius (handrails): a capsule (about 3.4 × 2.2 m) and room to step round it. */
export const BERTH_CLEAR = 2.75;

export function arrivalTerraceOf(h: Habitat): ArrivalTerrace | null {
  const stair = liftStairOf(h);
  if (!stair) return null;
  const platform = stair.platforms[stair.platforms.length - 1], leg = stair.legs[stair.legs.length - 1];
  const mid = (platform.w0 + platform.w1) / 2, depth = platform.z1 - platform.z0;
  const start: PlanPoint = [platform.z1 - depth * 0.2, mid];
  const finish: PlanPoint = [platform.z0 + depth * 0.35, mid];
  const exit: PlanPoint = [leg.to.z, leg.to.w];
  const ramp = rampOf(h), hr = stair.handrail;
  return { platform, handrail: hr, start, finish, exit,
    feet: ramp.world(...finish, platform.e), exitWorld: ramp.world(...exit, platform.e),
    door: platform.z1 - hr * (DOOR_BACK + DOOR_HALF),
    berth: berthOf(h, platform, stair.parapet, hr, finish, exit) };
}

/**
 * The berth: in the open front of the landing, inside its parapets, on the side away from the stair's opening and
 * short of where the walk ends, so the walking strip and the way to the stair stay free. Null if it does not fit.
 */
function berthOf(h: Habitat, q: StairPlatform, parapet: number, hr: number, finish: PlanPoint, exit: PlanPoint): ArrivalBerth | null {
  const clear = BERTH_CLEAR * hr, edge = parapet + clear;
  const z = q.z0 + edge;
  // Away from the opening: on the other side of the landing's middle from the last leg's end.
  const side = exit[1] >= (q.w0 + q.w1) / 2 ? -1 : 1;
  const w = side < 0 ? q.w0 + edge : q.w1 - edge;
  // Room in front of the walk's end, and inside both side parapets.
  if (z + clear > finish[0] - hr * 0.2) return null;
  if (w - clear < q.w0 + parapet - 1e-9 || w + clear > q.w1 - parapet + 1e-9) return null;
  const ramp = rampOf(h), at = ramp.world(z, w, q.e);
  // The door faces the end of the walk, along the floor.
  const toward = ramp.world(finish[0], finish[1], q.e), d = toward.map((v, k) => v - at[k]) as Vec3;
  const up: Vec3 = [-at[0], -at[1], 0], u = Math.hypot(...up);
  const along = (d[0] * up[0] + d[1] * up[1]) / u;
  const flat = d.map((v, k) => v - (up[k] / u) * along) as Vec3, n = Math.hypot(...flat);
  return { at, out: flat.map((v) => v / n) as Vec3, clear };
}
