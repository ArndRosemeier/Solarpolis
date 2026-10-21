/**
 * Rivers: springs high on both endcaps (fed by the habitat's pumped return, which runs back underground in the service
 * layer), falling down the terraces in cascades and winding across the floor into the ring lake. Without a lake there
 * are no rivers: on a level floor water has nowhere else to go.
 *
 * A river is a path along the profile, `θ` a function of `s` (it never turns back along the axis), sampled every
 * `step` metres. Its water surface only ever falls downstream: walking from the spring, the surface is the lower of
 * where it was and a little under the ground there, and never below the lake. So the river cuts its own channel and
 * valley through the hills in its way, and every terrace riser on the endcaps becomes a fall.
 *
 * Sizes come from `HabitatParams.relief.rivers`; the meanders scale with the river's width. Pure.
 */
import { Noise, Rng, deriveSeed } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import type { Lake } from './terrain';

export interface River {
  /** The end its spring is on: wild rivers flow toward larger s, port rivers toward smaller. */
  from: 'wild' | 'port';
  /** Samples along s: the first at `s0`, then every `step` metres, `count` in all (ordered by s, not by flow). */
  s0: number;
  step: number;
  count: number;
  /**
   * Per sample: the river's middle (θ, unwrapped: it never jumps by a turn between samples, so it may stray outside
   * [0, 2π)), its water surface (height above the profile, m), its half width (m).
   */
  theta: Float64Array;
  surface: Float64Array;
  halfWidth: Float64Array;
  /** Per sample: how far downstream of the spring it is (m, along the water): the flow's own coordinate. */
  run: Float64Array;
  /** Per sample: the profile's radius there (m), so a point's distance across needs no profile lookup. */
  radius: Float64Array;
  /** Per sample: how steeply the water falls there (m down per m run): 0 on the floor's slow stretches, high on a fall. */
  steep: Float32Array;
  depth: number;
}

/** The river nearest a point, where the point is across it. */
export interface RiverHit {
  river: River;
  /** Distance from the river's middle, across it (m, signed: positive toward larger θ). */
  across: number;
  surface: number;
  halfWidth: number;
  run: number;
}

/** A whole turn (rad). */
const TURN = 2 * Math.PI;
/** How steeply the valley walls rise from the bank (height per metre out). */
const VALLEY = 0.25;
/** How far below the ground beside it the water surface stays (m, as a share of the depth). */
const FREEBOARD = 0.2;
/** The least fall per metre, so water always runs. */
const LEAST_FALL = 2e-5;

/**
 * The habitat's rivers, laid over the land before it is carved (`ground`: the land's height without rivers).
 */
export function makeRivers(h: Habitat, lake: Lake | null, ground: (theta: number, s: number) => number): River[] {
  const spec = h.params.relief.rivers;
  if (!spec || !lake || spec.count <= 0) return [];
  const { profile } = h;
  const rng = new Rng(deriveSeed(h.seed, 'rivers'));
  const meander = new Noise(deriveSeed(h.seed, 'rivers', 'meander'));
  const half = spec.width / 2, step = Math.max(half, 1);
  const out: River[] = [];
  for (let k = 0; k < spec.count; k++) {
    const from = k % 2 === 0 ? 'wild' : 'port';
    // Springs spread around the axis, half on each end, partway up the endcap.
    const theta0 = (2 * Math.PI * (Math.floor(k / 2) + rng.range(0.15, 0.85))) / Math.ceil(spec.count / 2) + (from === 'port' ? Math.PI / spec.count : 0);
    const up = rng.range(0.55, 0.85);
    const spring = from === 'wild' ? profile.floorStart * (1 - up) : profile.floorEnd + (profile.length - profile.floorEnd) * up;
    // The mouth: a little way into the lake, so the river joins its water.
    const mouth = from === 'wild' ? lake.s - lake.halfWidth * 0.9 : lake.s + lake.halfWidth * 0.9;
    const lo = Math.min(spring, mouth), hi = Math.max(spring, mouth);
    const count = Math.max(2, Math.ceil((hi - lo) / step) + 1);
    const r: River = {
      from, s0: lo, step: (hi - lo) / (count - 1), count, depth: spec.depth,
      theta: new Float64Array(count), surface: new Float64Array(count), halfWidth: new Float64Array(count), run: new Float64Array(count), radius: new Float64Array(count), steep: new Float32Array(count),
    };
    // Meanders: a slow wander across, a few widths out to either side, longer bends than they are wide.
    const swing = spec.width * 6, bend = spec.width * 40;
    for (let i = 0; i < count; i++) {
      const s = lo + i * r.step, rad = Math.max(profile.at(s).r, half);
      r.radius[i] = rad;
      r.theta[i] = theta0 + (swing * meander.fbm2(s / bend, k * 7.3, 3)) / rad;
    }
    // Walk downstream from the spring in elevation (how far in from the hull, which is what water runs down): the surface
    // only falls, stays under the banks, and ends no lower than the lake.
    let level = Infinity, run = 0, prev: { s: number; theta: number; level: number; i: number } | null = null;
    for (let n = 0; n < count; n++) {
      const i = from === 'wild' ? n : count - 1 - n, s = lo + i * r.step;
      const flow = n / (count - 1);
      const w = half * (0.35 + 0.65 * flow);
      const p = profile.at(s), rad = Math.max(p.r, half), dTheta = w / rad;
      const elevation = (height: number): number => h.radius - p.r - height * p.nr;
      const bank = Math.min(elevation(ground(r.theta[i], s)), elevation(ground(r.theta[i] - dTheta, s)), elevation(ground(r.theta[i] + dTheta, s)));
      level = Math.max(lake.level, Math.min(level - LEAST_FALL * r.step, bank - spec.depth * FREEBOARD));
      const surface = (h.radius - p.r - level) / p.nr;
      // Where it runs: along the profile, around the axis, and down.
      if (prev) {
        const along = Math.hypot(s - prev.s, (r.theta[i] - prev.theta) * rad), drop = prev.level - level;
        run += Math.hypot(along, drop);
        // The fall shows on the sample above it (where the water tips over) and the one below (where it lands).
        const steep = drop / Math.max(along, 1e-6);
        r.steep[prev.i] = Math.max(r.steep[prev.i], steep);
        r.steep[i] = steep;
      }
      prev = { s, theta: r.theta[i], level, i };
      r.surface[i] = surface;
      r.halfWidth[i] = w;
      r.run[i] = run;
    }
    out.push(r);
  }
  return out;
}

/** A point of a river's middle line, between its samples (s clamped to the river's). */
export interface RiverPoint {
  s: number;
  theta: number;
  surface: number;
  halfWidth: number;
  run: number;
  steep: number;
}

export function riverPoint(r: River, s: number): RiverPoint {
  const f = Math.min(r.count - 1, Math.max(0, (s - r.s0) / r.step));
  const i = Math.min(r.count - 2, Math.floor(f)), t = f - i;
  const ofSample = (a: ArrayLike<number>) => a[i] + (a[i + 1] - a[i]) * t;
  return { s, theta: ofSample(r.theta), surface: ofSample(r.surface), halfWidth: ofSample(r.halfWidth), run: ofSample(r.run), steep: Math.max(r.steep[i], r.steep[i + 1]) };
}

/** Where a point is across the nearest river whose valley reaches it, or null. */
export function riverAt(rivers: readonly River[], theta: number, s: number, reach = 0): RiverHit | null {
  let best: RiverHit | null = null;
  for (const river of rivers) {
    const f = (s - river.s0) / river.step;
    if (!(f >= 0 && f <= river.count - 1)) continue;
    const i = Math.min(river.count - 2, Math.floor(f)), t = f - i;
    // The middle there, and how far around the point is from it (brought into a half turn either way).
    let turn = theta - (river.theta[i] + (river.theta[i + 1] - river.theta[i]) * t);
    turn -= TURN * Math.round(turn / TURN);
    const across = turn * (river.radius[i] + (river.radius[i + 1] - river.radius[i]) * t);
    const halfWidth = river.halfWidth[i] + (river.halfWidth[i + 1] - river.halfWidth[i]) * t;
    if (Math.abs(across) > halfWidth + reach) continue;
    if (best && Math.abs(across) >= Math.abs(best.across)) continue;
    best = {
      river, across, halfWidth,
      surface: river.surface[i] + (river.surface[i + 1] - river.surface[i]) * t,
      run: river.run[i] + (river.run[i + 1] - river.run[i]) * t,
    };
  }
  return best;
}

/** The land carved by a river: its channel under the water, the valley walls rising from its banks. */
export function carve(hit: RiverHit, depth: number, ground: number): number {
  const d = Math.abs(hit.across), w = hit.halfWidth;
  const bed = hit.surface - depth;
  const target = d < w ? bed + depth * (d / w) ** 2 * (1 + FREEBOARD) : hit.surface + depth * FREEBOARD + (d - w) * VALLEY;
  return Math.min(ground, target);
}

/** How far out from its banks a river may carve: as far as the valley walls climb to the highest hill. */
export function valleyReach(h: Habitat): number {
  const r = h.params.relief;
  return r.rivers ? (r.hills + r.terraceStep + r.rivers.depth) / VALLEY : 0;
}

/** The river sample nearest (θ, s) that `pick` accepts (by distance over the ground), or null. */
export function nearestSample(rivers: readonly River[], theta: number, s: number, pick: (r: River, i: number) => boolean = () => true): { river: River; i: number } | null {
  let best: { river: River; i: number } | null = null, gap = Infinity;
  for (const river of rivers) for (let i = 0; i < river.count; i++) {
    let turn = river.theta[i] - theta;
    turn -= TURN * Math.round(turn / TURN);
    const d = Math.hypot(turn * river.radius[i], river.s0 + i * river.step - s);
    if (d < gap && pick(river, i)) { gap = d; best = { river, i }; }
  }
  return best;
}

/**
 * A place to watch a river from: `down` metres downstream of sample `i` (negative: upstream) and `aside` metres out
 * from its middle, with the heading that looks back at the sample (the walker's: 0 along +s, rising toward −θ).
 */
export function besideRiver(r: River, i: number, down: number, aside: number): { theta: number; s: number; heading: number } {
  const s0 = r.s0 + i * r.step, s = Math.min(r.s0 + r.step * (r.count - 1), Math.max(r.s0, s0 + (r.from === 'wild' ? down : -down)));
  const at = riverPoint(r, s), rad = Math.max(r.radius[Math.min(r.count - 1, Math.round((s - r.s0) / r.step))], 1);
  const theta = at.theta + aside / rad;
  // From there back to the sample: across (θ·r) and along s.
  const x = (r.theta[i] - theta) * rad, y = s0 - s;
  return { theta, s, heading: Math.atan2(-x, y) };
}
