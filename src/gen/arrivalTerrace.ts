/** The existing Lift Stair's upper landing is the port's arrival overlook.
 * Its entrance, clear walking strip and exit all derive from that landing and its last leg. */
import type { Habitat, Vec3 } from '../blueprint';
import { liftStairOf, rampOf, type PlanPoint, type StairPlatform } from './liftStair';

export interface ArrivalTerrace {
  platform: StairPlatform;
  handrail: number;
  start: PlanPoint;
  finish: PlanPoint;
  exit: PlanPoint;
  feet: Vec3;
  exitWorld: Vec3;
}

export function arrivalTerraceOf(h: Habitat): ArrivalTerrace | null {
  const stair = liftStairOf(h);
  if (!stair) return null;
  const platform = stair.platforms[stair.platforms.length - 1], leg = stair.legs[stair.legs.length - 1];
  const mid = (platform.w0 + platform.w1) / 2, depth = platform.z1 - platform.z0;
  const start: PlanPoint = [platform.z1 - depth * 0.2, mid];
  const finish: PlanPoint = [platform.z0 + depth * 0.35, mid];
  const exit: PlanPoint = [leg.to.z, leg.to.w];
  const ramp = rampOf(h);
  return { platform, handrail: stair.handrail, start, finish, exit,
    feet: ramp.world(...finish, platform.e), exitWorld: ramp.world(...exit, platform.e) };
}
