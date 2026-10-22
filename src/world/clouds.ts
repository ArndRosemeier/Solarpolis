/**
 * The clouds' schedule: where the cloud layer lies, how much of the sky it covers at an hour, and how far the wind has
 * carried it. The habitat chooses its weather, so it is a schedule, not a forecast: a seeded drift over a few days (some
 * days nearly clear, some grey), and cumulus building up through the afternoon. The shapes themselves are drawn on the
 * GPU (render/materials.ts, `CLOUDS_NEAR` / `CLOUDS_FAR`) from this state; the same field shades the land below.
 *
 * Everything follows from `HabitatParams.clouds` and the clock. Pure.
 */
import { Noise, deriveSeed } from '@futuremagic/core';
import { toWorld, type Habitat } from '../blueprint';
import { planOf } from '../gen/plan';
import { dayPhase } from './sunline';

/** Where the cloud layer is: radii of its top and its flat base, and the stretch of the axis clear of the endcaps (m). */
export interface CloudSpan {
  /** Radius of the layer's top (toward the axis) and of its base. */
  top: number;
  base: number;
  /** Where along the axis the layer begins and ends: where the endcap slopes are still well below its base. */
  z0: number;
  z1: number;
  /** How far in from each end the clouds thin out to nothing (m). */
  fade: number;
}

/** How far something drifting with the air has been carried: along the axis (m) and around it (rad, 0 … 2π). */
export interface Drift {
  along: number;
  turn: number;
}

/** The layer at one hour. */
export interface CloudState extends Drift {
  /** The share of the sky covered (0 … 1). */
  cover: number;
  /**
   * How far the clouds' finer shapes have drifted: a little faster than the clouds themselves and a little across, so
   * their heaps and edges slide through the big shapes and every cloud changes as it goes.
   */
  fine: Drift;
}

/** How many days the weather takes to change, about. */
const WEATHER_DAYS = 3;
/** How far the weather moves the day's cover, as a share of the average. */
const WEATHER_SWING = 0.8;
/** How much cumulus adds in the afternoon (share of the sky), and when it peaks (share of the daylight hours). */
const AFTERNOON = 0.15;
const AFTERNOON_PEAK = 0.65;
/** How far the clouds keep from the endcap slopes, as a share of their height above the floor. */
const CLEARANCE = 0.25;
/**
 * How the clouds' finer shapes move against the big ones: faster with the wind by this share (the wind picks up with
 * height, and the tops are higher), and across it at this speed (m/s), so clouds change even in still air.
 */
const SHEAR = 0.4;
const CHURN = 1.2;

/** The layer's place in a habitat, or null if it has none. */
export function cloudSpan(h: Habitat): CloudSpan | null {
  const c = h.params.clouds;
  if (!c) return null;
  const base = h.radius - c.base, top = base - c.thickness;
  // Walk in from each end of the profile until the slope is below the layer's base, with room to spare.
  const { profile } = h, clear = base + c.base * CLEARANCE;
  const edge = (from: number, to: number): number => {
    const n = 256;
    for (let i = 0; i <= n; i++) {
      const p = profile.at(from + ((to - from) * i) / n);
      if (p.r >= clear) return p.z;
    }
    return profile.at(to).z;
  };
  const z0 = edge(0, profile.floorStart), z1 = edge(profile.length, profile.floorEnd);
  return { top, base, z0, z1, fade: Math.min(c.size, (z1 - z0) / 4) };
}

/**
 * Where the clouds part round a Height that stands into the layer (gen/plan.ts `grounds`): its axis in world space
 * (`dir`, the unit direction from the cylinder's axis, and `z`), no cloud within `inner` m of it (out to where its
 * flank falls below the layer's base), the clouds back in full `outer` m from it (a cloud's width further). The air
 * that meets the mount flows up and round it, and from its top one looks down on the clouds.
 */
export interface CloudClearing {
  dir: readonly [number, number];
  z: number;
  inner: number;
  outer: number;
}

/** The share of the cloud base the land under a Height may make up (`cloudClearings`). */
const CLEAR_LAND = 0.1;

/** How many clearings the clouds' shader takes. */
export const MAX_CLEARINGS = 4;

/** The clearings in a habitat's cloud layer, the tallest Heights first (at most `MAX_CLEARINGS`). */
export function cloudClearings(h: Habitat): CloudClearing[] {
  const c = h.params.clouds;
  if (!c) return [];
  const plan = planOf(h), out: CloudClearing[] = [];
  for (const g of plan.grounds) {
    // A tenth of the base spared for the land it stands on (the ridges between the valleys rise a little).
    const low = c.base * (1 - CLEAR_LAND);
    if (g.kind !== 'height' || g.height <= low || out.length >= MAX_CLEARINGS) continue;
    // Out from its middle along the axis until its surface is below the base.
    let inner = g.radius;
    for (let i = 0; i <= 128; i++) {
      const d = (g.radius * i) / 128, on = plan.landformAt(g.theta, g.s + d);
      if (!on || on.form !== g || on.top < low) { inner = d; break; }
    }
    const w = toWorld(h.profile, { theta: g.theta, s: g.s, h: 0 }), l = Math.hypot(w[0], w[1]) || 1;
    out.push({ dir: [w[0] / l, w[1] / l], z: w[2], inner, outer: inner + c.size });
  }
  return out;
}

/** The cloud layer at clock time `t` (s), or null if the habitat has none. */
export function cloudsAt(h: Habitat, t: number): CloudState | null {
  const c = h.params.clouds;
  if (!c) return null;
  const day = h.params.day;
  const weather = new Noise(deriveSeed(h.seed, 'clouds', 'weather')).fbm2(t / (WEATHER_DAYS * day.length), 0.5, 3);
  // Cumulus: rising through the afternoon, gone by night.
  const phase = dayPhase(h, t), u = phase / day.daylight;
  const afternoon = u < 1 ? Math.exp(-(((u - AFTERNOON_PEAK) / 0.22) ** 2)) : 0;
  const cover = Math.min(1, Math.max(0, c.cover * (1 + WEATHER_SWING * weather) + AFTERNOON * afternoon * Math.min(1, c.cover * 4)));
  const middle = h.radius - c.base - c.thickness / 2, { along, around } = c.wind;
  // Across the wind: square to it, or around the axis in still air.
  const speed = Math.hypot(along, around), across = speed > 1e-9 ? [-around / speed, along / speed] : [0, 1];
  const carried = (a: number, b: number): Drift => {
    const turn = (b * t) / middle;
    return { along: a * t, turn: turn - 2 * Math.PI * Math.floor(turn / (2 * Math.PI)) };
  };
  return { cover, ...carried(along, around), fine: carried(along * (1 + SHEAR) + across[0] * CHURN, around * (1 + SHEAR) + across[1] * CHURN) };
}

/**
 * The threshold over which a field of normally spread values (mean 0, spread 1) covers `cover` of its area: where the
 * shaders' noise field is higher than this (times its own spread), there is a cloud. Very high for no cover at all.
 * (A rational approximation of the normal quantile, Abramowitz & Stegun 26.2.23, good to 5e-4.)
 */
export function coverThreshold(cover: number): number {
  if (cover <= 1e-4) return 1e3;
  if (cover >= 1 - 1e-4) return -1e3;
  const p = Math.min(cover, 1 - cover), t = Math.sqrt(-2 * Math.log(p));
  const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return cover < 0.5 ? z : -z;
}
