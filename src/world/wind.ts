/**
 * The wind over the floor: what fills a sail, bends the grass and carries a kite. The air turns with the habitat, so a
 * wind in here is air the habitat moves on purpose (its ventilation) or that the light moves (the land warming under
 * the bright stretch). Three parts, each a pure function of the seed, the place and the clock:
 *
 *   breeze   the prevailing wind, `HabitatParams.air.wind` along the axis and around it, swinging slowly in strength
 *            and veering a little in direction over a few days (the habitat's weather, as the clouds have theirs);
 *   sun      the land under the sunline's bright stretch warms and its air rises, so the air near the floor is drawn
 *            along the axis toward the stretch from both sides, strongest about a stretch's width from its middle; as
 *            the stretch travels from the wild end to the port end over the day, the wind at a place backs and veers
 *            with it (a morning breeze toward the wild end, an evening one toward the port end);
 *   gusts    cells of stronger and weaker air a few hundred metres across, carried along by the mean wind and
 *            changing as they go, each turning the wind a little (`air.wind.gust` of the mean, at the most).
 *
 * The spin does not turn the wind. On a planet the Coriolis force bends a moving air mass sideways, but here the spin
 * axis lies along the floor: air moving along the axis feels no Coriolis force at all, and air moving around it is only
 * pressed down (spinward) or lifted (against the spin), never pushed sideways. So the wind blows where it is sent, at
 * every height; what the spin changes is how heavy whatever moves feels (`feltGravity`, world/motion.ts).
 *
 * Over open water and open land; nothing yet shelters the air behind woods and hills. Pure.
 */
import { Noise, deriveSeed } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { brightCentre, dayLevel, dayPhase } from './sunline';

/** The wind at a place near the floor (m/s): along the axis (+s) and around it (+θ, spinward). */
export interface Wind {
  along: number;
  around: number;
}

/**
 * How the habitat's weather swings the breeze: over about `days` days, its strength by up to `swing` of itself either
 * way and its direction by up to `veer` (rad) either way.
 */
const WEATHER = { days: 2.5, swing: 0.45, veer: 0.35 };
/**
 * Gust cells: about `size` m across, each living about `life` s, turning the wind by up to `turn` (rad) at full gust
 * strength. Physical sizes (the air near a floor gusts the same in any habitat).
 */
const GUSTS = { size: 260, life: 90, turn: 0.35 };
/** The peak of x·e^(−x²/2) (at x = 1): the sun breeze is scaled by it so `air.wind.sun` is its strongest. */
const SUN_PEAK = Math.exp(-0.5);

/** The habitat's noise fields for the wind, made once per habitat. */
const fields = new WeakMap<Habitat, { weather: Noise; gusts: Noise }>();
const fieldsOf = (h: Habitat) => {
  let f = fields.get(h);
  if (!f) {
    f = { weather: new Noise(deriveSeed(h.seed, 'wind', 'weather')), gusts: new Noise(deriveSeed(h.seed, 'wind', 'gusts')) };
    fields.set(h, f);
  }
  return f;
};

/** The prevailing breeze at clock time `t` (s), the same everywhere: the habitat's weather, before the sun and the gusts. */
export function breezeAt(h: Habitat, t: number): Wind {
  const w = h.params.air.wind, { weather } = fieldsOf(h);
  const u = t / (WEATHER.days * h.params.day.length);
  const strength = Math.max(0, 1 + WEATHER.swing * weather.fbm2(u, 0.5, 3)), turn = WEATHER.veer * weather.fbm2(u, 7.5, 3);
  const c = Math.cos(turn), sn = Math.sin(turn);
  return { along: strength * (w.along * c - w.around * sn), around: strength * (w.along * sn + w.around * c) };
}

/** How the bright stretch draws the air along the axis at s, at clock time `t` (m/s, toward larger s positive). */
export function sunBreezeAt(h: Habitat, t: number, s: number): number {
  const sun = h.params.air.wind.sun, { daylight, peakWidth } = h.params.day, phase = dayPhase(h, t);
  if (sun <= 0 || phase >= daylight) return 0;
  const d = (brightCentre(h, phase) - h.profile.at(s).z / h.params.length) / peakWidth;
  return (sun * dayLevel(h, phase) * d * Math.exp(-0.5 * d * d)) / SUN_PEAK;
}

/** The wind at (θ, s) near the floor at clock time `t` (s). */
export function windAt(h: Habitat, t: number, theta: number, s: number): Wind {
  const mean = breezeAt(h, t), along = mean.along + sunBreezeAt(h, t, s), around = mean.around;
  const gust = h.params.air.wind.gust;
  if (gust <= 0) return { along, around };
  // The gust cells, carried by the mean wind: the place looked up where the air passing over now was at the start.
  const R = h.radius, a = theta - (around * t) / R, z = (s - along * t) / GUSTS.size;
  const x = (Math.cos(a) * R) / GUSTS.size, y = (Math.sin(a) * R) / GUSTS.size, k = t / GUSTS.life, { gusts } = fieldsOf(h);
  const strength = Math.max(0, 1 + gust * 1.6 * gusts.fbm3(x, y, z + k, 3)), turn = gust * GUSTS.turn * 1.6 * gusts.fbm3(x + 31.7, y - 12.9, z - k, 2);
  const c = Math.cos(turn) * strength, sn = Math.sin(turn) * strength;
  return { along: along * c - around * sn, around: along * sn + around * c };
}
