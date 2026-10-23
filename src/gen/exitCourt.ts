/** The nearest usable court exit, measured over the floor with the cylindrical seam wrapped. */
import { fromWorld } from '../blueprint';
import { doorsBelow, type LiftDoors } from './lifts';
import { underOf } from './under';
import type { Terrain } from './terrain';

export interface ExitCourt { court: number; theta: number; s: number; distance: number; doors: LiftDoors }
export function nearestExitCourt(t: Terrain, theta: number, s: number): ExitCourt | null {
  const h = t.habitat;
  if (!h.params.landmarks) return null;
  let best: ExitCourt | null = null;
  for (const m of underOf(h).hamlets) {
    const d = m.site.theta - theta, approximate = Math.hypot(Math.atan2(Math.sin(d), Math.cos(d)) * h.radius, m.site.s - s);
    // A lift is in the neighbouring bay: skip courts that cannot beat the current exit even with that offset.
    if (best && approximate > best.distance + h.params.under.bay * 2) continue;
    const doors = doorsBelow(t, m.court);
    if (!doors) continue;
    const at = fromWorld(h.profile, ...doors.at), dt = at.theta - theta;
    const distance = Math.hypot(Math.atan2(Math.sin(dt), Math.cos(dt)) * h.radius, at.s - s);
    if (!best || distance < best.distance) best = { court: m.court, theta: at.theta, s: at.s, distance, doors };
  }
  return best;
}
