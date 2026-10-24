/**
 * Names on hover (the link's L2, Arnd 2026-10-23): whatever the mouse rests on, the link names. Pure: what is under a
 * ray from the eye, where the ray meets the ground, and what a person lets anyone's link show of them. The overlay
 * draws the name (app/link/link.ts), the view casts the ray (render/view.ts), `Namer` (naming.ts) knows the land.
 */
import { hash3i, hashToFloat, deriveSeed, type Vec3 } from '@futuremagic/core';
import { kept } from '../gen/kept';
import type { Habitat } from '../blueprint';
import { voiceOf } from '../sim';
import { PURSUIT_WORDS } from '../talk/words';

/** Something the link can name: a ball round it (world, m) and its words. */
export interface Nameable {
  /** Stays the same while it is the same thing (a label that only moves is not new). */
  key: string;
  at: Vec3;
  radius: number;
  name: string;
  detail?: string;
}

/** What the pointer rests on: its words, and how far along the ray (m). */
export interface Named {
  key: string;
  name: string;
  detail?: string;
  distance: number;
}

/**
 * How far off the ray something may be and still count as pointed at, per metre away (rad): about the pointer's own
 * size on screen, so a person far off is still easy to rest on.
 */
export const POINT_SLACK = 0.008;

/**
 * The nearest of `things` the ray from `eye` along `dir` (unit) meets before `ground` (m along it, where it meets the
 * land), or null. A thing the eye is inside of is not named: one is there.
 */
export function nameUnder(eye: Vec3, dir: Vec3, things: Iterable<Nameable>, ground = Infinity, slack = POINT_SLACK): Named | null {
  let best: Nameable | null = null, near = Infinity;
  for (const n of things) {
    const x = n.at[0] - eye[0], y = n.at[1] - eye[1], z = n.at[2] - eye[2];
    const t = x * dir[0] + y * dir[1] + z * dir[2], d2 = x * x + y * y + z * z;
    if (t <= 0 || d2 < n.radius * n.radius) continue;
    const reach = n.radius + t * slack, off2 = d2 - t * t;
    if (off2 > reach * reach) continue;
    // Where the ray enters its ball (or comes closest): hidden when the ground is nearer.
    const enter = t - Math.sqrt(Math.max(0, reach * reach - off2));
    if (enter > ground || enter >= near) continue;
    best = n; near = enter;
  }
  return best ? { key: best.key, name: best.name, detail: best.detail, distance: near } : null;
}

/**
 * Where the ray from `eye` along `dir` (unit) first meets the ground, within `most` m: `heightOf` gives a world point's
 * height over the ground under it (m; negative below it). Stepped by that height, so it goes fast over open air and
 * slows near the land (never finer than 1% of the way out); null when it meets nothing within `most`.
 */
export function groundUnder(eye: Vec3, dir: Vec3, heightOf: (p: Vec3) => number, most: number): number | null {
  const p: Vec3 = [0, 0, 0];
  const rise = (t: number): number => { p[0] = eye[0] + dir[0] * t; p[1] = eye[1] + dir[1] * t; p[2] = eye[2] + dir[2] * t; return heightOf(p); };
  let t = 0, h = rise(0);
  if (h <= 0) return 0;
  for (let i = 0; i < 600 && t < most; i++) {
    // Never finer than a hundredth of the way out: a ray skimming the land far off still gets there.
    const step = Math.max(0.25, 0.01 * t, Math.min(h * 0.7, 400));
    const t1 = Math.min(most, t + step), h1 = rise(t1);
    if (h1 <= 0) {
      // Halve the last step down to a few centimetres.
      let lo = t, hi = t1;
      for (let k = 0; k < 12 && hi - lo > 0.05; k++) { const mid = (lo + hi) / 2; if (rise(mid) <= 0) hi = mid; else lo = mid; }
      return hi;
    }
    t = t1; h = h1;
  }
  return null;
}

/** What someone lets anyone's link show: their name and what they care about, their name only, or nothing. */
export type Shown = 'all' | 'name' | 'none';

const shareSeed = kept((h: Habitat) => deriveSeed(h.seed, 'link', 'shares'));

/** What resident i shows (their own choice, the same every time; `HabitatParams.life.talk.shares`). */
export function shownOf(h: Habitat, i: number): Shown {
  const { name, pursuits } = h.params.life.talk.shares, seed = shareSeed(h);
  if (hashToFloat(hash3i(seed, i, 1, 0)) >= name) return 'none';
  return hashToFloat(hash3i(seed, i, 2, 0)) < pursuits ? 'all' : 'name';
}

/** The name resident i shows, or null when they keep it to themselves. */
export function shownName(h: Habitat, i: number): string | null {
  return shownOf(h, i) === 'none' ? null : voiceOf(h, i).name;
}

/** How the link names resident i: never their body, nor whether they are a mind (they choose what shows). */
export function personNamed(h: Habitat, i: number): { name: string; detail?: string } {
  const shown = shownOf(h, i);
  if (shown === 'none') return { name: 'Someone', detail: 'Keeps their name to themselves' };
  const v = voiceOf(h, i);
  if (shown === 'name') return { name: v.name };
  const cares = v.pursuits.slice(0, 2).map((p) => PURSUIT_WORDS[p].name);
  return { name: v.name, detail: cares.length ? `Into ${cares.join(' and ')}` : undefined };
}

/** 'fallen oaks' → 'Fallen oak': a scattered kind's name for one of them. */
export function oneOf(kind: string): string {
  const one = kind.replace(/(ch|sh)es$/, '$1').replace(/([^s])s$/, '$1');
  return capital(one);
}

export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
