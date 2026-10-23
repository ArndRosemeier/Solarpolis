/** The existing Lift Stair's upper landing is the port's arrival overlook.
 * Its entrance, clear walking strip and exit all derive from that landing and its last leg. Pure. */
import type { Habitat, Vec3 } from '../blueprint';
import { BERTH_CLEAR, centreOf, liftStairOf, rampOf, type PlanPoint, type StairPlatform } from './liftStair';

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
  /**
   * The capsule berth: on the Threshold's lowest gallery (gen/threshold.ts), or where a habitat has no galleries on the
   * open front of the landing; null where neither has room for one.
   */
  berth: ArrivalBerth | null;
}

/** The door's face from the landing's back edge (handrails), and its half thickness. */
export const DOOR_BACK = 0.6, DOOR_HALF = 0.08;
export { BERTH_CLEAR };

export function arrivalTerraceOf(h: Habitat): ArrivalTerrace | null {
  const stair = liftStairOf(h);
  if (!stair) return null;
  const platform = stair.top, leg = stair.topLeg;
  const mid = (platform.w0 + platform.w1) / 2, depth = platform.z1 - platform.z0;
  const start: PlanPoint = [platform.z1 - depth * 0.2, mid];
  const finish: PlanPoint = [platform.z0 + depth * 0.35, mid];
  const exit: PlanPoint = [leg.to.z, leg.to.w];
  const ramp = rampOf(h), hr = stair.handrail;
  return { platform, handrail: hr, start, finish, exit,
    feet: ramp.world(...finish, platform.e), exitWorld: ramp.world(...exit, platform.e),
    door: platform.z1 - hr * (DOOR_BACK + DOOR_HALF),
    berth: stair.threshold ? (stair.threshold.berth && berthAt(h, stair.threshold.berth.at, stair.threshold.berth.e, stair.threshold.berth.toward, BERTH_CLEAR * hr))
      : landingBerth(h, platform, stair.parapet, hr, finish, exit) };
}

/**
 * The berth: in the open front of the landing, inside its parapets, on the side away from the stair's opening and
 * short of where the walk ends, so the walking strip and the way to the stair stay free. Null if it does not fit.
 */
function landingBerth(h: Habitat, q: StairPlatform, parapet: number, hr: number, finish: PlanPoint, exit: PlanPoint): ArrivalBerth | null {
  const clear = BERTH_CLEAR * hr, edge = parapet + clear;
  const z = q.z0 + edge;
  // Away from the opening: on the other side of the landing's middle from the last leg's end.
  const side = exit[1] >= centreOf(q)[1] ? -1 : 1;
  const w = side < 0 ? q.w0 + edge : q.w1 - edge;
  // Room in front of the walk's end, and inside both side parapets.
  if (z + clear > finish[0] - hr * 0.2) return null;
  if (w - clear < q.w0 + parapet - 1e-9 || w + clear > q.w1 - parapet + 1e-9) return null;
  // The door faces the end of the walk.
  return berthAt(h, [z, w], q.e, finish, clear);
}

/** A berth at a plan point on a floor at height e, its door facing along the floor toward another plan point. */
function berthAt(h: Habitat, p: PlanPoint, e: number, facing: PlanPoint, clear: number): ArrivalBerth {
  const ramp = rampOf(h), at = ramp.world(p[0], p[1], e);
  const toward = ramp.world(facing[0], facing[1], e), d = toward.map((v, k) => v - at[k]) as Vec3;
  const up: Vec3 = [-at[0], -at[1], 0], u = Math.hypot(...up);
  const along = (d[0] * up[0] + d[1] * up[1]) / u;
  const flat = d.map((v, k) => v - (up[k] / u) * along) as Vec3, n = Math.hypot(...flat);
  return { at, out: flat.map((v) => v / n) as Vec3, clear };
}
