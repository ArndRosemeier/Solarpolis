/**
 * The habitat's sailing water and its harbours (Arnd 2026-10-23: "sail boats, slick and futuristic", on the lakes and
 * on the ring lake): every stretch of water a boat can sail (`Basin`), the boats each is given, and the harbours where
 * they lie when they are not out. Laid out once per habitat from its plan; sim/sailing.ts sails the boats, the harbours
 * are built and stood on as things at sites (gen/harbourBuild.ts).
 *
 * The water. A `Basin` is the ring lake (a band round the whole cylinder, cut where the lake pavilion's bridges cross
 * it) or a lake on the floor (`Landform.meres`). Its sailing water is convex and kept clear of its shore (a lake's bays
 * and headlands lie outside it), and of its harbours: a boat under sail keeps `seaRoom` off the edge, so a straight leg
 * between two points of it never touches land, a pier or a boat lying at its berth.
 *
 * A harbour. A pier runs out from the shore, square to it, to where the water is deep enough for the boats it serves;
 * there a floating pontoon runs along the shore, and fingers stand out from its far side between the berths. Each boat
 * lies stern to the pontoon, bow out, between two fingers, so its crew steps aboard over its stern (a mooring the
 * Mediterranean has used for millennia, here for wing-sailed trimarans). Leaving, a boat motors straight out on its
 * quiet drive to its sailing water (`Boat.out`), and coming back it turns there and backs in.
 *
 * Where. A harbour stands where people come by: as near a path as the shore allows, clear of the courts and the
 * landmarks, spread round its water; on a lake in a bay, where the shore comes nearest the sailing water. A boat for
 * which no harbour could be found lies at a mooring buoy out in its water (`harbour` −1). Pure.
 */
import { Rng, angleDiff, deriveSeed, smoothstep } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { kept } from './kept';
import { MERE, mereDeep, mereEdge, planOf, siteOf, type Mere, type Plan } from './plan';
import { BOAT_KINDS, BOAT_KIND_LIST, type BoatKind } from './boat';
import { floorAt, type FloorFrame } from './shapes';

const TURN = 2 * Math.PI;

/**
 * A stretch of sailing water, in its own flat frame: `u` m around the axis (spinward) and `v` m along it from its
 * middle (θ, s). Its water stands `level` m above the profile, `depth` m deep at its deepest.
 */
export interface Basin {
  id: number;
  kind: 'ring' | 'great' | 'mere';
  theta: number;
  s: number;
  level: number;
  depth: number;
  /** Its narrowest and longest stretch of sailing water (m), and its area (m²). */
  width: number;
  length: number;
  area: number;
  /** The radius its frame is unrolled at (m). */
  radius: number;
  /** How far out from its shore its harbours reach (m): boats under sail keep further off. */
  moorings: number;
  /** The ring lake: half its width, and half the length round from the pavilion's one side to its other (m). */
  half?: { across: number; around: number };
  /** A lake on the floor. */
  mere?: Mere;
}

/** Whether a point of a basin's frame lies in its sailing water, `margin` m clear of its edge. */
export function inBasin(b: Basin, u: number, v: number, margin: number): boolean {
  if (b.half) return Math.abs(v) <= b.half.across - margin && Math.abs(u) <= b.half.around - margin;
  const m = b.mere!, x = v * m.cos + u * m.sin, y = u * m.cos - v * m.sin;
  // The lake's outline with its bays drawn in all the way (they lie outside), and the margin, inside its shore.
  const q = 1 - m.wild * MERE.bays - margin / m.across;
  if (q <= 0) return false;
  const p = m.power, qx = Math.abs(x) / m.along, qy = Math.abs(y) / m.across;
  return Math.pow(qx, p) + Math.pow(qy, p) <= Math.pow(q, p);
}

/** How far a straight line from a point of a basin (in its water) runs in its water, `margin` m clear of the edge. */
export function runIn(b: Basin, u: number, v: number, heading: number, margin: number): number {
  const du = Math.sin(heading), dv = Math.cos(heading);
  let lo = 0, hi = b.length + b.width;
  if (!inBasin(b, u, v, margin)) return 0;
  if (inBasin(b, u + du * hi, v + dv * hi, margin)) return hi;
  // The water is convex: one crossing out along the line.
  for (let i = 0; i < 40 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    if (inBasin(b, u + du * mid, v + dv * mid, margin)) lo = mid; else hi = mid;
  }
  return lo;
}

/** A point of a basin's frame on the floor (θ, s). */
export const basinPoint = (b: Basin, u: number, v: number): { theta: number; s: number } => ({ theta: b.theta + u / b.radius, s: b.s + v });

/** A point of the floor in a basin's frame (u, v). */
export const inBasinFrame = (b: Basin, theta: number, s: number): { u: number; v: number } => ({ u: angleDiff(0, theta - b.theta) * b.radius, v: s - b.s });

/** How far into a basin's water a point lies from its shore (m; negative on land): its real shore, bays and all. */
export function offShore(b: Basin, u: number, v: number): number {
  if (b.half) return b.half.across - Math.abs(v);
  return -mereEdge(b.mere!, b.radius, b.theta + u / b.radius, b.s + v);
}

/** How deep a basin's water is at a point (m; 0 on land), as the terrain digs it (gen/terrain.ts). */
export function depthAt(b: Basin, u: number, v: number): number {
  const off = offShore(b, u, v);
  if (off <= 0) return 0;
  if (b.half) return b.depth * Math.sqrt(smoothstep(0, 0.6, off / b.half.across));
  return b.depth * Math.sqrt(smoothstep(0, 1, mereDeep(b.mere!, -off)));
}

/** How far a boat under sail keeps off the edge of the water: its own room, and clear of the harbours. */
const SEA_ROOM = 3, SEA_SHARE = 0.15, HARBOUR_CLEAR = 1.5, HARBOUR_SHARE = 0.3;

/** How far a boat of a kind under sail keeps off the shore of a basin's water (m): a few of its lengths, and its harbours' reach with room to spare. */
export function seaRoom(b: Basin, kind: BoatKind): number {
  const own = Math.min(BOAT_KINDS[kind].length * SEA_ROOM, b.width * SEA_SHARE);
  return b.moorings > 0 ? Math.max(own, Math.min(b.moorings + BOAT_KINDS[kind].length * HARBOUR_CLEAR, b.width * HARBOUR_SHARE)) : own;
}

/**
 * A harbour's parts, in handrails: the pier's width, its deck over the water and how far it reaches onto the land; its
 * piles' spacing and size; the pontoon's width and its deck over the water; a finger's width and how far it runs out
 * along a berth (a share of the longer boat beside it); the room beside a boat and behind its stern; how much water
 * there is under a boat's deepest part at its berth; the guide piles' spacing along the pontoon and how high they
 * stand; the most berths one harbour has.
 */
export const HARBOUR = {
  pier: 2, deck: 0.5, landing: 2.5, piles: 5.5, pile: 0.14,
  pontoon: 2.6, float: 0.42,
  finger: 0.75, fingerShare: 0.62, beside: 0.4, stern: 0.35,
  under: 0.6, guide: 16, guideHigh: 2.4,
  most: 12,
} as const;

/** A berth along a harbour's pontoon: its middle and width along it (y, m), the boat that lies there. */
export interface Berth {
  y: number;
  width: number;
  boat: number;
}

/**
 * A harbour, laid out in its frame lying on the water (`FloorFrame`: x out from the shore over the water, y along the
 * shore to its left, z up from the water's surface; its origin where the pier leaves the shore). The pier runs from the
 * land (x < 0) out to the pontoon's inner edge at x = `pontoon`; the pontoon is `HARBOUR.pontoon` handrails wide and
 * runs from y0 to y1; fingers (`fingers`: y and how far out past the pontoon) stand between the berths.
 */
export interface Harbour {
  id: number;
  basin: number;
  seed: number;
  handrail: number;
  frame: FloorFrame;
  pontoon: number;
  y0: number;
  y1: number;
  berths: Berth[];
  fingers: { y: number; length: number }[];
  /** The furthest out a boat of it lies (m from the shore). */
  reach: number;
}

export interface Boat {
  id: number;
  kind: BoatKind;
  basin: number;
  /** Its harbour, or −1: it lies at a mooring buoy out in its water. */
  harbour: number;
  /** Where it lies when it is not out (its berth's middle, or its buoy), in its basin's frame; the way its bow points there (NaN at a buoy: head to wind). */
  home: { u: number; v: number };
  berthHeading: number;
  /** Where it motors out to from its berth, in its sailing water, and from where it backs in again (its buoy: `home`). */
  out: { u: number; v: number };
  seed: number;
}

export interface Fleet {
  basins: readonly Basin[];
  harbours: readonly Harbour[];
  boats: readonly Boat[];
}

/** Which designs each kind of water is given, by weight (where there is room for them). */
const MIX: Record<Basin['kind'], Record<BoatKind, number>> = {
  ring: { skiff: 0.4, foiler: 0.35, cruiser: 0.25 },
  great: { skiff: 0.4, foiler: 0.3, cruiser: 0.3 },
  mere: { skiff: 0.7, foiler: 0.1, cruiser: 0.2 },
};

/** The habitat's sailing water, its harbours and its boats, laid out once per habitat and kept. */
export const fleetOf: (h: Habitat) => Fleet = kept(makeFleet);

/** The handrail a habitat's harbours are sized by: its landmarks', else its hull parts'. */
export const harbourRail = (h: Habitat): number => h.params.landmarks?.handrail ?? h.params.exterior.parts.handrail;

function basinsOf(h: Habitat, plan: Plan): Basin[] {
  const R = h.radius, basins: Basin[] = [], lake = plan.lake;
  if (lake) {
    // Cut where the Sunwalk crosses on the pavilion's bridges: the frame's middle is round the far side from them.
    const pavilion = siteOf(plan, 'lake-pavilion'), cut = pavilion ? pavilion.theta : 0;
    const clear = pavilion ? pavilion.size * 1.5 : 0, around = Math.PI * R - clear;
    basins.push({
      id: basins.length, kind: 'ring', theta: cut + Math.PI, s: lake.s, level: lake.level, depth: lake.depth, radius: R, moorings: 0,
      width: lake.halfWidth * 2, length: around * 2, area: lake.halfWidth * 2 * around * 2, half: { across: lake.halfWidth, around },
    });
  }
  for (const m of plan.meres) {
    const q = 1 - m.wild * MERE.bays;
    basins.push({ id: basins.length, kind: m.kind === 'great' ? 'great' : 'mere', theta: m.theta, s: m.s, level: m.level, depth: m.depth, radius: R, moorings: 0, width: 2 * m.across * q, length: 2 * m.along * q, area: Math.PI * m.along * m.across * q * q, mere: m });
  }
  return basins;
}

function makeFleet(h: Habitat): Fleet {
  const plan = planOf(h), basins = basinsOf(h, plan), spec = h.params.life.sailing, boats: Boat[] = [], harbours: Harbour[] = [];
  const near = pathFinder(h, plan);
  for (const b of basins) {
    const rng = new Rng(deriveSeed(h.seed, 'sailing', 'fleet', b.id));
    const fits = BOAT_KIND_LIST.filter((k) => b.width >= BOAT_KINDS[k].room * BOAT_KINDS[k].length);
    if (!fits.length || spec.boats <= 0) continue;
    const count = Math.max(1, Math.floor((b.area / 1e6) * spec.boats + rng.float()));
    const weights = fits.map((k) => MIX[b.kind][k]), sum = weights.reduce((a, w) => a + w, 0), kinds: BoatKind[] = [];
    for (let n = 0; n < count; n++) {
      let pick = rng.float() * sum, kind = fits[fits.length - 1];
      for (let i = 0; i < fits.length; i++) { pick -= weights[i]; if (pick < 0) { kind = fits[i]; break; } }
      kinds.push(kind);
    }
    // The harbours, as many as its boats fill, each with its share of them; then where each boat lies and motors out to.
    const first = boats.length, groups = Math.ceil(kinds.length / HARBOUR.most), per = Math.ceil(kinds.length / groups);
    const laid = placeHarbours(h, plan, b, Array.from({ length: groups }, (_, g) => kinds.slice(g * per, (g + 1) * per)), near, harbours.length);
    for (const x of laid) b.moorings = Math.max(b.moorings, x.reach);
    // Each boat's berth (by its index among the basin's boats), before the berths take the boats' ids.
    const berthOf = new Map<number, { harbour: Harbour; berth: Berth }>();
    for (const harbour of laid) for (const berth of harbour.berths) berthOf.set(berth.boat, { harbour, berth });
    kinds.forEach((kind, n) => {
      const id = first + n, at = berthOf.get(n), seed = deriveSeed(h.seed, 'sailing', 'boat', id);
      if (!at) {
        // A mooring buoy: in from the edge of its water a few lengths, somewhere round it (on the ring lake, along a shore).
        const margin = seaRoom(b, kind);
        let home: { u: number; v: number };
        if (b.half) home = { u: rng.range(-1, 1) * (b.half.around - margin * 4), v: (rng.chance(0.5) ? 1 : -1) * (b.half.across - margin * 1.2) };
        else {
          const a = rng.range(0, TURN), r = runIn(b, 0, 0, a, margin);
          home = { u: Math.sin(a) * r, v: Math.cos(a) * r };
        }
        boats.push({ id, kind, basin: b.id, harbour: -1, home, berthHeading: NaN, out: home, seed });
        return;
      }
      const { harbour, berth } = at, home = inBasinFrame(b, ...pointOf(h, harbour.frame, berthX(harbour, kind), berth.y));
      berth.boat = id;
      boats.push({ id, kind, basin: b.id, harbour: harbour.id, home, berthHeading: harbour.frame.heading, out: outFrom(b, home, harbour.frame.heading, kind, BOAT_KINDS[kind].length), seed });
    });
    harbours.push(...laid);
  }
  return { basins, harbours, boats };
}

/** A point of a frame on the floor, as θ and s. */
const pointOf = (h: Habitat, f: FloorFrame, x: number, y: number): [number, number] => {
  const p = floorAt(h, f, x, y);
  return [p.theta, p.s];
};

/** Where a boat of a kind lies at a harbour's berth: its middle's x (its stern a little off the pontoon). */
export const berthX = (hb: Harbour, kind: BoatKind): number => hb.pontoon + (HARBOUR.pontoon + HARBOUR.stern) * hb.handrail + BOAT_KINDS[kind].length / 2;

/** Where a boat motors out to from its berth: straight on along its bow until it is in its sailing water, a length on. */
function outFrom(b: Basin, home: { u: number; v: number }, heading: number, kind: BoatKind, length: number): { u: number; v: number } {
  const margin = seaRoom(b, kind), du = Math.sin(heading), dv = Math.cos(heading), most = b.width + b.length;
  for (let d = length; d < most; d += 1) {
    const u = home.u + du * d, v = home.v + dv * d;
    if (inBasin(b, u, v, margin + length)) return { u, v };
  }
  return home;
}

/** How far a point of the floor lies from the nearest point of the plan's paths (m; `PATH_FAR` and more when none is near). */
const PATH_FAR = 120;
function pathFinder(h: Habitat, plan: Plan): (theta: number, s: number) => number {
  const R = h.radius, bin = PATH_FAR / 2, n = Math.max(1, Math.round((TURN * R) / bin)), bins: number[][] = Array.from({ length: n }, () => []);
  const binOf = (theta: number): number => ((Math.floor(((((theta / TURN) % 1) + 1) % 1) * n) % n) + n) % n;
  for (const p of plan.paths) for (let i = 0; i < p.points.length; i += 2) bins[binOf(p.points[i])].push(p.points[i], p.points[i + 1]);
  const reach = Math.min(Math.floor((n - 1) / 2), 2);
  return (theta, s) => {
    const k = binOf(theta);
    let best = PATH_FAR * 2;
    for (let d = -reach; d <= reach; d++) {
      const list = bins[(k + d + n) % n];
      for (let i = 0; i < list.length; i += 2) {
        const ds = list[i + 1] - s;
        if (Math.abs(ds) < best) best = Math.min(best, Math.hypot(angleDiff(0, list[i] - theta) * R, ds));
      }
    }
    return best;
  };
}

/** A candidate place for a harbour: its root on the shore (basin frame) and the way out over the water. */
interface Spot {
  u: number;
  v: number;
  heading: number;
  score: number;
}

/**
 * The harbours of a basin, one for each group of boats (by index into the basin's boats), placed round its shore where
 * people come by: each the best spot of its own stretch of shore that has room for it. A group with no spot is left
 * without (its boats lie at buoys).
 */
function placeHarbours(h: Habitat, plan: Plan, b: Basin, groups: BoatKind[][], near: (theta: number, s: number) => number, firstId: number): Harbour[] {
  const hr = harbourRail(h), spots = shoreSpots(b, near), out: Harbour[] = [];
  if (!spots.length) return out;
  const taken: Harbour[] = [];
  let boat = 0;
  groups.forEach((kinds, g) => {
    // Its own stretch of the shore (the spots are in order round it), the best spot there it fits at.
    const lo = Math.floor((g * spots.length) / groups.length), hi = Math.floor(((g + 1) * spots.length) / groups.length);
    const order = spots.slice(lo, hi).sort((p, q) => p.score - q.score);
    const ids = kinds.map((_, k) => boat + k);
    boat += kinds.length;
    for (const spot of order) {
      const hb = layHarbour(h, plan, b, spot, kinds, ids, hr, firstId + out.length);
      if (hb && taken.every((o) => apart(h, o, hb))) { out.push(hb); taken.push(hb); return; }
    }
  });
  return out;
}

/** Whether two harbours keep clear of each other (their pontoons and boats with room between). */
function apart(h: Habitat, a: Harbour, b: Harbour): boolean {
  const pa = floorAt(h, a.frame, a.reach / 2, (a.y0 + a.y1) / 2), pb = floorAt(h, b.frame, b.reach / 2, (b.y0 + b.y1) / 2);
  const d = Math.hypot(angleDiff(0, pa.theta - pb.theta) * h.radius, pa.s - pb.s);
  return d > Math.hypot(a.reach, a.y1 - a.y0) / 2 + Math.hypot(b.reach, b.y1 - b.y0) / 2 + 2 * a.handrail * HARBOUR.guide;
}

/** Spots round a basin's shore, in order round it, each scored (lower is better): near a path, and on a lake in a bay. */
function shoreSpots(b: Basin, near: (theta: number, s: number) => number): Spot[] {
  const out: Spot[] = [];
  if (b.half) {
    // Along both shores of the ring lake, clear of the cut at the pavilion.
    const step = 30, end = b.half.around - b.width * 0.5;
    for (let u = -end; u <= end; u += step) {
      for (const side of [1, -1]) {
        const v = side * b.half.across, p = basinPoint(b, u, v);
        out.push({ u, v, heading: side > 0 ? Math.PI : 0, score: near(p.theta, p.s) });
      }
    }
    return out;
  }
  const m = b.mere!, n = 72, deepest = 1 - m.wild * MERE.bays;
  for (let k = 0; k < n; k++) {
    const a = (TURN * k) / n, du = Math.sin(a), dv = Math.cos(a);
    // The shore along the line out from the middle (the lake's outline is a star round it).
    let lo = 0, hi = Math.max(m.along, m.across) * 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (offShore(b, du * mid, dv * mid) > 0) lo = mid; else hi = mid;
    }
    const r = lo, x = dv * m.cos + du * m.sin, y = du * m.cos - dv * m.sin;
    // How far the shore is from the deepest a bay can draw it in (0: at the bottom of a bay).
    const conv = deepest / Math.pow(Math.pow(Math.abs(x) / m.along, m.power) + Math.pow(Math.abs(y) / m.across, m.power), 1 / m.power);
    const p = basinPoint(b, du * r, dv * r);
    out.push({ u: du * r, v: dv * r, heading: a + Math.PI, score: near(p.theta, p.s) + (r / Math.max(conv, 1e-9) - 1) * m.across });
  }
  return out;
}

/** A harbour for some boats at a spot, or null where the water does not let it be built (too shallow or too narrow there). */
function layHarbour(h: Habitat, plan: Plan, b: Basin, spot: Spot, kinds: readonly BoatKind[], ids: readonly number[], hr: number, id: number): Harbour | null {
  const p = basinPoint(b, spot.u, spot.v), frame: FloorFrame = { theta: p.theta, s: p.s, height: b.level, heading: spot.heading };
  // A point of its frame in the basin's (as floorAt, unrolled at the basin's radius).
  const k = b.radius / h.profile.at(frame.s).r, c = Math.cos(frame.heading), sn = Math.sin(frame.heading);
  const at = (x: number, y: number): { u: number; v: number } => ({ u: spot.u + (x * sn + y * c) * k, v: spot.v + x * c - y * sn });
  const wet = (x: number, y: number, by: number): boolean => { const q = at(x, y); return offShore(b, q.u, q.v) > by; };
  const deep = (x: number, y: number, need: number): boolean => { const q = at(x, y); return depthAt(b, q.u, q.v) >= need; };
  // The berths along the pontoon, fingers between them; the pier comes in at the middle.
  const gap = HARBOUR.beside * hr, finger = HARBOUR.finger * hr, widths = kinds.map((k) => BOAT_KINDS[k].beam + 2 * gap + finger);
  const total = widths.reduce((a, w) => a + w, 0) + finger, berths: Berth[] = [], fingers: { y: number; length: number }[] = [];
  let y = -total / 2 + finger;
  kinds.forEach((k, i) => {
    fingers.push({ y: y - finger / 2, length: HARBOUR.fingerShare * Math.max(BOAT_KINDS[k].length, i > 0 ? BOAT_KINDS[kinds[i - 1]].length : 0) });
    berths.push({ y: y + widths[i] / 2 - finger / 2, width: widths[i], boat: ids[i] });
    y += widths[i];
  });
  fingers.push({ y: y - finger / 2, length: HARBOUR.fingerShare * BOAT_KINDS[kinds[kinds.length - 1]].length });
  const y0 = -total / 2, y1 = total / 2, under = HARBOUR.under * hr, wide = HARBOUR.pontoon * hr;
  // Out along the pier until the pontoon floats in water deep enough at both its ends and its berths, every boat in water.
  const most = Math.min(b.width * 0.25, 60 * hr);
  for (let x = 2 * hr; x <= most; x += hr) {
    if (!wet(x, y0, hr) || !wet(x, y1, hr) || !deep(x + wide, y0, under) || !deep(x + wide, y1, under)) continue;
    const hb: Harbour = { id, basin: b.id, seed: deriveSeed(h.seed, 'harbour', id), handrail: hr, frame, pontoon: x, y0, y1, berths, fingers, reach: 0 };
    let ok = true, reach = 0;
    kinds.forEach((k, i) => {
      const s = BOAT_KINDS[k], bx = berthX(hb, k), by = berths[i].y, half = s.beam / 2 + gap;
      for (const [cx, cy] of [[bx - s.length / 2, by - half], [bx - s.length / 2, by + half], [bx + s.length / 2, by - half], [bx + s.length / 2, by + half]]) {
        if (!wet(cx, cy, gap) || !deep(cx, cy, s.draft + under)) ok = false;
      }
      reach = Math.max(reach, bx + s.length / 2);
      // Its way out: straight on from its bow, in water a beam wide, until it is out in the sailing water.
      for (let d = bx + s.length / 2; ok; d += s.length) {
        const q = at(d, by);
        if (inBasin(b, q.u, q.v, 0)) break;
        if (offShore(b, q.u, q.v) < half || d > b.width + b.length) ok = false;
      }
    });
    if (!ok) continue;
    hb.reach = reach;
    // The pier on dry land and clear of the courts, landmarks and halls; the whole harbour clear of them too.
    const centre = floorAt(h, frame, reach / 2, 0), room = Math.hypot(reach, total) / 2 + HARBOUR.guide * hr;
    for (const site of plan.sites) {
      if (Math.abs(site.s - centre.s) > site.size + room) continue;
      if (Math.hypot(angleDiff(0, site.theta - centre.theta) * h.radius, site.s - centre.s) < site.size + room) return null;
    }
    return hb;
  }
  return null;
}
