/**
 * Music moments (design "Solarpolis: how it sounds": music only where it means something): a short piece, once, when
 * the player is somewhere and at a time that deserves one. This says which moment, if any, the listener is in now;
 * the player keeps each to once a visit, wants it held a while, and leaves long quiet between them (audio/sound.ts).
 *
 *   summit    at a summit hut as the light comes up over it;
 *   sunwalk   walking the Sunwalk in full day;
 *   lake      by the lake, or on it, at night;
 *   below     in the Understorey (the first time down is the one heard).
 *
 * Pure: from the habitat, the clock and where the listener is.
 */
import type { Ecology } from '../gen/ecology';
import { landmarksOf } from '../gen/landmarks';
import { pathsOf } from '../gen/paths';
import { HUT_REACH, LIGHT_LAG, lightAt, type Listener, type Soundscape } from './sounds';
import { floorGap } from './walks';

export const MOMENTS = ['summit', 'sunwalk', 'lake', 'below'] as const;
export type Moment = (typeof MOMENTS)[number];

/** Each moment's piece (files `music/moment-*`). */
export const MOMENT_MUSIC: Readonly<Record<Moment, string>> = {
  summit: 'music/moment-summit', sunwalk: 'music/moment-sunwalk', lake: 'music/moment-lake', below: 'music/moment-below',
};

/** Dawn: the light over the listener rising through this range (share of the bright stretch). */
const DAWN_FROM = 0.03, DAWN_TO = 0.5;
/** Full day, and night (share of the bright stretch). */
const DAY = 0.6, NIGHT = 0.04;
/** On the Sunwalk: within this far of its edge (m), going at least this fast (m/s). */
const ON_WALK = 1, WALKING = 0.5;
/** By the lake: its bed at least this loud. */
const BY_LAKE = 0.5;

/** The moment the listener is in at clock time t, if any (`scape`: the soundscape there now). */
export function momentAt(e: Ecology, t: number, l: Listener, scape: Soundscape): Moment | null {
  if (l.below) return 'below';
  const terrain = e.terrain, h = terrain.habitat, light = scape.light;
  if (light >= DAWN_FROM && light <= DAWN_TO && lightAt(h, l.s, t - LIGHT_LAG) < light) {
    const r = h.profile.at(l.s).r;
    for (const m of landmarksOf(terrain)) {
      if (m.kind === 'hut' && Math.hypot(floorGap(r, l.theta, l.s, m.theta, m.s), l.ground - m.level) < HUT_REACH) return 'summit';
    }
  }
  if (light >= DAY && l.speed >= WALKING && pathsOf(h).pathAt(l.theta, l.s, ON_WALK)?.kind === 'sunwalk') return 'sunwalk';
  if (light < NIGHT && scape.beds.lake >= BY_LAKE) return 'lake';
  return null;
}
