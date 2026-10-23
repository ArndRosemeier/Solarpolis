/**
 * Where a called capsule can set down near any spot (gen/capsules.ts is the pod, its stops and `padAt`): the nearest
 * open, level, dry ground clear of what grows and lies there. Its own module, as it reads the plants (gen/scatter.ts),
 * which keep off the capsules' stops. Pure.
 */
import { deriveSeed, hash3i, hashToFloat } from '@futuremagic/core';
import { wrapAngle, type DebrisSpec, type PlantSpec } from '../blueprint';
import { capLayout, capStopsOf, padAt, tallestCrown, type CapPad } from './capsules';
import { handrailOf } from './lifts';
import type { Ecology } from './ecology';
import { standsIn, type Species } from './scatter';

/** Something on the ground near a spot that a capsule keeps off: where it stands (m around and along from the spot) and how far off it keeps one's middle. */
interface Obstacle {
  x: number;
  y: number;
  r: number;
}

/**
 * Where a capsule can set down near (θ, s): the nearest open ground within `reach` m (and no nearer than `least` m, not
 * on top of who called it) that is dry, not on or by anything built (`keptClear`, `landmarkTopAt`: courts, crossings,
 * halls, harbours, the Lift Stair, the landmarks), clear of trees, bushes, stones and fallen trunks by its own size and
 * their crowns', and level enough under its four feet (along true up). Its door faces (θ, s). Where no such ground is
 * in reach, the nearest capsule stop within `orStop` m; else null.
 */
export function landingNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, reach: number, least = 0, orStop = 0): CapPad | null {
  const t = ecology.terrain, h = t.habitat, { profile } = h, lay = capLayout(h), hr = handrailOf(h);
  // A stop kept clear for capsules (or the arrival terrace's berth) is where one sets down near it.
  const stop = capStopsOf(t).closest(theta, s, reach);
  if (stop) return stop.pad;
  const r0 = Math.max(1, profile.at(s).r), margin = 0.3 * hr, clear = Math.hypot(lay.halfLength, lay.halfWidth) + margin;
  // Its footprint on the ground, in its frame: its length and width, and on its door's side out to where one steps down.
  const fx = lay.halfLength + margin, fy0 = -(Math.abs(lay.door.outside[1]) + margin), fy1 = lay.halfWidth + margin;
  // The search goes out in stages, each first gathering what stands in the square it can reach (in metres from the
  // spot): most of the time open ground is found near, and the near square is a small part of the far one's work.
  const step = Math.max(1.5, 0.6 * clear), seed = deriveSeed(h.seed, 'cap');
  let ring = Math.max(least, 0);
  for (const stage of [Math.min(reach, ring + 12), Math.min(reach, ring + 30), reach]) {
    if (ring > stage) continue;
    const span = stage + clear + 0.4 * tallestCrown(h);
    const bounds = { theta0: theta - span / r0, theta1: theta + span / r0, s0: Math.max(0, s - span), s1: Math.min(profile.length, s + span) };
    const obstacles: Obstacle[] = [];
    for (const sp of plants) {
      if (sp.what === 'cover') continue;
      const spec = sp.spec as PlantSpec | DebrisSpec, tall = spec.height[1];
      if (sp.what === 'debris' ? (spec as DebrisSpec).form === 'branch' : false) continue;
      if (tall < 0.25) continue;
      // A tree's crown reaches out about a third of its height (the pod comes down through where it spreads); a bush, a
      // stone or a reed about half its height.
      const keep = sp.what !== 'debris' && tall >= 6 ? 0.35 * tall : 0.5 * tall;
      standsIn(ecology, sp, bounds, 0, (pt, ps) => obstacles.push({ x: (wrapAngle(pt - theta + Math.PI) - Math.PI) * r0, y: ps - s, r: keep }));
    }
    for (; ring <= stage; ring += step) {
      const n = ring < 1e-6 ? 1 : Math.max(6, Math.ceil((2 * Math.PI * ring) / step)), turn = hashToFloat(hash3i(seed, Math.round(ring * 8), 0, 0));
      for (let k = 0; k < n; k++) {
        const a = ((k + turn) / n) * 2 * Math.PI, x = ring * Math.cos(a), y = ring * Math.sin(a);
        // Its door toward the spot: its −y that way over the floor, so its footprint is the box round it turned so.
        const toward = Math.atan2(-x, -y), dx = Math.sin(toward), dy = Math.cos(toward);
        if (obstacles.some((o) => {
          const ox = o.x - x, oy = o.y - y, ly = -(ox * dx + oy * dy), lx = ox * dy - oy * dx;
          return Math.abs(lx) < fx + o.r && ly > fy0 - o.r && ly < fy1 + o.r;
        })) continue;
        const pt = theta + x / r0, ps = s + y;
        if (ps < 0 || ps > profile.length) continue;
        const pad = padAt(t, pt, ps, toward, lay);
        if (pad) return pad;
      }
    }
  }
  return orStop > reach ? capStopsOf(t).closest(theta, s, orStop)?.pad ?? null : null;
}
