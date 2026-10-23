/**
 * The animals that live on the land (design "Who is out on the land"; how many: `HabitatParams.life.animals`), and
 * where each is at any moment: a pure function of the habitat's seed, its land and the clock, as the people are.
 *
 * Squirrels. The woods are cut into cells two ranges a side (rows along the axis, as many cells round it as fit); a
 * cell holds as many squirrels as the woods there hold at `animals.squirrels` per hectare of closed crowns, each with
 * its own home tree: the nearest tree the scatter planted near a spot of the cell (gen/scatter.ts `standsIn`, so the
 * tree is one that is drawn). Asking for the squirrels near a point (`densNear`) looks only at the cells around it.
 *
 * A squirrel's day: it is down on the ground for its share of the bright hours (`animals.out`), centred on the hour
 * the bright stretch of the sunline passes its tree (as people's outings are), each squirrel starting and stopping a
 * little apart. Down, it lives in slots of `SLOT` seconds: at the start of each it hops (a short way) or runs (a long
 * one) to its next spot, then forages there, sits up alert, flicks its tail or rests till the slot is over. Spots are
 * round its tree, within its range, on dry, open ground; every few slots it goes back to the foot of its tree, and its
 * last slot always takes it there. Pure.
 */
import { hash3i } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { canopyOf } from '../gen/ecology';
import type { Ecology } from '../gen/ecology';
import { keptClear } from '../gen/landmarks';
import { plantedCanopy } from '../gen/planted';
import { LEVELS, poseOf, standsIn, type Species } from '../gen/scatter';
import { toWorld } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { dayPhase } from '../world/sunline';
import { localNoon, unit } from './population';
import { floorGap } from './walks';

const TURN = 2 * Math.PI;

/** A squirrel's home: where its tree stands and who it is. The same every time it is asked for. */
export interface Den {
  /** Its own number: the same squirrel every time (its cell's and its place in it). */
  id: number;
  /** Its tree's foot. */
  theta: number;
  s: number;
  /** Its own seed: its day, its spots and what it does. */
  seed: number;
}

/** What a squirrel is doing: moving (hopping, running), or at a spot. */
export type SquirrelDoing = 'hop' | 'run' | 'eat' | 'alert' | 'flick' | 'idle';

/** A squirrel down on the ground at a moment. */
export interface Squirrel {
  id: number;
  theta: number;
  s: number;
  /** The way it faces over the floor (radians: 0 toward the port end, +π/2 spinward), as people's heading. */
  heading: number;
  /** How fast it goes over the floor (m/s; 0 at a spot). */
  speed: number;
  doing: SquirrelDoing;
  /** How long it has been doing it (s): where its clip is. */
  since: number;
}

/** A squirrel's slot (s): the way to its next spot, then whatever it does there. */
export const SLOT = 24;
/** How fast a squirrel hops a short way and runs a long one (m/s), and how far is short (m). */
export const HOP = 1;
export const RUN = 3.2;
const SHORT = 4;
/** How far from its tree's middle it stands at the tree's foot (m): clear of the trunk. */
const FOOT = 0.6;
/** Its spots: the share of them at the foot of its tree. */
const AT_TREE = 0.2;
/** How far from a spot of its cell its tree may stand (m): squirrels live where trees are. */
const TREE_SEARCH = 10;
/** Trees at least this tall (m, full grown) are homes: fruit trees too, not shrubs. */
const HOME_HEIGHT = 4;
/** How steep a spot may be (rise per metre). */
const STEEPEST = 0.8;
/** What a squirrel does at a spot, and how often. */
const AT_SPOT: readonly [SquirrelDoing, number][] = [['eat', 0.55], ['alert', 0.2], ['flick', 0.1], ['idle', 0.15]];

/** The cells' side (m): twice a squirrel's range, so a squirrel stays within its cell's neighbours. */
const cellSide = (h: Habitat): number => 2 * h.params.life.animals.range;

/**
 * The squirrels whose trees stand within `radius` m of (θ, s): every cell around, its share of squirrels, each placed at
 * its tree. For the worker (it needs the ecology and the plants); `plants` is `plantsOf(ecology)`.
 */
export function densNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, radius: number): Den[] {
  const t = ecology.terrain, h = t.habitat, { profile } = h, a = h.params.life.animals, G = cellSide(h);
  if (!(a.squirrels > 0)) return [];
  const crowns = crownsOf(ecology);
  const trees = plants.filter((sp) => (sp.what === 'plant' || sp.what === 'planted') && sp.spec.height[1] >= HOME_HEIGHT);
  const seed = hash3i(h.seed, 0x5a1, 7, 0), out: Den[] = [];
  const rows = Math.floor(profile.length / G);
  for (let k = Math.max(0, Math.floor((s - radius) / G)); k <= Math.min(rows, Math.floor((s + radius) / G)); k++) {
    const sMid = Math.min(profile.length, (k + 0.5) * G), r = Math.max(1, profile.at(sMid).r);
    const n = Math.max(1, Math.round((TURN * r) / G)), dTheta = TURN / n, reach = radius / r + dTheta;
    const c0 = Math.floor((theta - reach) / dTheta), c1 = Math.min(c0 + n - 1, Math.floor((theta + reach) / dTheta));
    for (let cc = c0; cc <= c1; cc++) {
      const c = ((cc % n) + n) % n, mid = (c + 0.5) * dTheta, ground = t.heightAt(mid, sMid);
      if (t.standAt(mid, sMid) > ground + 0.05) continue;
      const cover = crowns(mid, sMid, ground);
      const expect = (a.squirrels * G * G * cover) / 1e4, cell = hash3i(seed, k, c, 0);
      const count = Math.floor(expect) + (unit(cell, 0, 0, 0) < expect - Math.floor(expect) ? 1 : 0);
      for (let j = 0; j < count; j++) {
        const home = treeNear(ecology, trees, cell, j, c * dTheta, k * G, dTheta, G);
        if (!home || floorGap(r, theta, s, home.theta, home.s) > radius) continue;
        out.push({ id: (k * 100000 + c) * 32 + j, theta: home.theta, s: home.s, seed: hash3i(cell, j, 1, 0) });
      }
    }
  }
  return out;
}

/**
 * How closed the crowns are over a point of the ground (0 open … 1 closed): the woods of its biomes, or what was planted
 * there. For the worker (it needs the ecology); `ground` is the ground's height there.
 */
export function crownsOf(ecology: Ecology): (theta: number, s: number, ground: number) => number {
  const woods = ecology.climate.biomes.map((b) => canopyOf(b).cover), shares = new Float32Array(woods.length);
  return (theta, s, ground) => {
    ecology.biomesAt(theta, s, ground, 0, shares);
    const cover = woods.reduce((x, w, b) => x + w * shares[b], 0);
    return Math.max(cover, plantedCanopy(ecology.terrain, theta, s)?.cover ?? 0);
  };
}

/**
 * A home tree for animal j of a cell (θ0, s0 its corner, dθ × G its size, `cell` its hash): the nearest of `trees` to a
 * spot of the cell, a few spots tried, with its height (m, as the scatter draws it); or none (no tree near). Squirrels'
 * trees, and songbirds' (sim/birds.ts).
 */
export function treeNear(ecology: Ecology, trees: readonly Species[], cell: number, j: number, theta0: number, s0: number, dTheta: number, G: number): { theta: number; s: number; height: number } | null {
  const { profile } = ecology.terrain.habitat, shapes = LEVELS[0].variants;
  for (let tries = 0; tries < 4; tries++) {
    const theta = theta0 + dTheta * unit(cell, j, 2, tries), s = Math.min(profile.length, s0 + G * unit(cell, j, 3, tries));
    const r = Math.max(1, profile.at(s).r), b = { theta0: theta - TREE_SEARCH / r, theta1: theta + TREE_SEARCH / r, s0: s - TREE_SEARCH, s1: s + TREE_SEARCH };
    let best: { theta: number; s: number; height: number } | null = null, d = Infinity;
    for (const sp of trees) standsIn(ecology, sp, b, 0, (pt, ps, ground, f, along) => {
      const e = floorGap(r, theta, s, pt, ps);
      if (e < d) { d = e; best = { theta: pt, s: ps, height: poseOf(ecology, sp, pt, ps, toWorld(profile, { theta: pt, s: ps, h: ground }), f, along, shapes).height }; }
    });
    if (best) return best;
  }
  return null;
}

/** When a squirrel's day down on the ground begins and ends (s into the day), by where its tree is. */
function hoursOf(h: Habitat, den: Den): [number, number] {
  const { length, daylight } = h.params.day, half = (h.params.life.animals.out * daylight) / 2, noon = localNoon(h, den.s);
  const jitter = (k: number): number => (unit(den.seed, 9, k, 0) - 0.5) * 0.2 * half;
  const from = Math.max(0, noon - half + jitter(0)), to = Math.min(daylight, noon + half + jitter(1));
  return [from * length, to * length];
}

/** A squirrel's spot for slot n of day `day`: round its tree, or at its foot. */
function forageSpot(t: Terrain, den: Den, day: number, n: number): [number, number] {
  const h = t.habitat, r = Math.max(1, h.profile.at(den.s).r), key = day * 4096 + n;
  const foot = (): [number, number] => {
    const a = TURN * unit(den.seed, key, 4, 0);
    return [den.theta + (FOOT * Math.cos(a)) / r, den.s + FOOT * Math.sin(a)];
  };
  if (n < 0 || unit(den.seed, key, 5, 0) < AT_TREE) return foot();
  const range = h.params.life.animals.range, d = range * Math.sqrt(unit(den.seed, key, 6, 0)), a = TURN * unit(den.seed, key, 7, 0);
  const theta = den.theta + (d * Math.cos(a)) / r, s = Math.min(h.profile.length, Math.max(0, den.s + d * Math.sin(a)));
  return open(t, theta, s) ? [theta, s] : foot();
}

/** Ground an animal may forage on: dry, not too steep, not down in a court or on a landmark. */
export function open(t: Terrain, theta: number, s: number): boolean {
  const ground = t.heightAt(theta, s), r = Math.max(1, t.habitat.profile.at(s).r), d = 0.5;
  if (t.standAt(theta, s) > ground + 0.05) return false;
  const rise = Math.hypot(t.heightAt(theta + d / r, s) - ground, t.heightAt(theta, s + d) - ground) / d;
  return rise <= STEEPEST && !t.courtAt(theta, s) && !keptClear(t, theta, s);
}

/** Each den's last slot: where it went from and to (worked out once a slot, not once a frame). */
const lastSlot = new WeakMap<Den, { day: number; n: number; a: [number, number]; b: [number, number] }>();

/** Where a squirrel goes in slot n: from its last spot to its next, or (`last`, its last slot) to the foot of its tree. */
function slotOf(t: Terrain, den: Den, day: number, n: number, last: boolean): [[number, number], [number, number]] {
  const was = lastSlot.get(den);
  if (was && was.day === day && was.n === n) return [was.a, was.b];
  const a = forageSpot(t, den, day, n - 1), b = forageSpot(t, den, day, last ? -1 : n);
  lastSlot.set(den, { day, n, a, b });
  return [a, b];
}

/** Squirrel `den` at clock time t (s), or null while it is up in its tree. */
export function squirrelAt(t: Terrain, den: Den, time: number): Squirrel | null {
  const h = t.habitat, L = h.params.day.length, day = Math.floor(time / L), tau = time - day * L;
  if (dayPhase(h, time) >= h.params.day.daylight) return null;
  const [from, to] = hoursOf(h, den);
  if (tau < from || tau >= to) return null;
  const n = Math.floor((tau - from) / SLOT), u = tau - from - n * SLOT;
  const [a, b] = slotOf(t, den, day, n, from + (n + 1) * SLOT >= to);
  const r = Math.max(1, h.profile.at(den.s).r), dTheta = b[0] - a[0], ds = b[1] - a[1], gap = Math.hypot(dTheta * r, ds);
  const fast = gap > SHORT, speed = fast ? RUN : HOP, way = gap > 1e-3 ? Math.atan2(dTheta * r, ds) : TURN * unit(den.seed, day * 4096 + n, 8, 0);
  const go = gap / speed;
  if (u < go) {
    const f = u / go;
    return { id: den.id, theta: a[0] + dTheta * f, s: a[1] + ds * f, heading: way, speed, doing: fast ? 'run' : 'hop', since: u };
  }
  let pick = unit(den.seed, day * 4096 + n, 9, 0), doing: SquirrelDoing = 'idle';
  for (const [what, share] of AT_SPOT) { if (pick < share) { doing = what; break; } pick -= share; }
  return { id: den.id, theta: b[0], s: b[1], heading: way, speed: 0, doing, since: u - go };
}

/** Bytes a list of dens holds (memory watchdog): about 40 each. */
export const densBytes = (dens: readonly Den[]): number => dens.length * 40;
