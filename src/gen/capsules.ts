/**
 * The transport capsules (Arnd 2026-10-23: "the player can call a cap easily ... just let him choose some
 * destinations"): small glass pods, each flown by a tiny mind on four ducted fans, that anyone calls through the
 * neural link. This is the pod itself and where it can be: its shape, its seats and door (in its own frame), where one
 * can set down (open ground, clear of trees, water and anything built), and the places one can ride to. Its flight is
 * world/capFlight.ts; getting in and out, world/mount.ts. Pure.
 *
 * The capsule's frame: x forward, y to its left, z up (true up, toward the axis, when it is parked); the origin on the
 * ground under its middle, where its feet stand. Its door is on its right (−y): a gull wing over the glass and the hull
 * below it, hinged near the spine. Sizes are in handrails (the habitat's human scale, as the lift's cabin is).
 */
import { hashToFloat, hash3i, deriveSeed, smoothstep, v3cross, v3dot, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { climateOf, fromWorld, toWorld, wrapAngle, type DebrisSpec, type Habitat, type PlantSpec } from '../blueprint';
import { arrivalTerraceOf } from './arrivalTerrace';
import type { Ecology } from './ecology';
import { fleetOf, HARBOUR } from './harbours';
import { keptClear, landmarkTopAt, landmarksOf } from './landmarks';
import { liftStairOf, rampOf } from './liftStair';
import { FINISH } from './pavilion';
import { COURT, entrancesOf, planOf, siteOf } from './plan';
import { standsIn, type Species } from './scatter';
import { Shape, floorAt, type Place, type RGB } from './shapes';
import type { Terrain } from './terrain';

/**
 * The capsule in handrails: its shell's length, width and height, how high its belly rides over the ground and its
 * cabin floor over that, the glass's lowest edge over the floor (amidships and at the nose), the door's run along the
 * shell (half of it) and how far down it opens, its fans (ducts' radius, depth, where they stand), the benches.
 */
export const CAP = {
  length: 3.4, width: 2, height: 2.05, belly: 0.16, floor: 0.38, wall: 0.035,
  belt: 0.62, beltNose: 0.3,
  door: 0.72, doorFoot: 0.06, hinge: 0.32,
  duct: 0.42, ductDeep: 0.26, ductAt: [1.28, 1.02, 0.5] as const,
  seat: 0.42, seatDeep: 0.46, seatEdge: 0.92, back: 0.62, seatWidth: 0.7,
};
/** The shell's plan and elevation curves (superellipse powers: higher is boxier), and its sections'. */
const CURVE = { plan: 2.3, nose: 2.0, tail: 2.6, belly: 3.4, section: 2.6 };
/** How far the door swings up and out when open (rad). */
export const DOOR_OPEN = 1.25;
/** Feet this far (m) out from the front of a bench when sitting on it (as on the courts' seats, sim/population.ts). */
const SEAT_FEET = 0.15;

const PEARL: RGB = [0.62, 0.62, 0.6];
const BRONZE: RGB = [0.22, 0.15, 0.08];
const GRAPHITE: RGB = [0.05, 0.05, 0.055];
const TIMBER: RGB = [0.3, 0.19, 0.11];
const CUSHION: RGB = [0.32, 0.12, 0.07];
const LINING: RGB = [0.45, 0.42, 0.38];
/** Glass: what it scatters back (its colour), and how much of what is behind it it keeps out (the `finish` of the glass kind). */
const GLASS: RGB = [0.05, 0.07, 0.08];
export const GLASS_VEIL = 0.1;
/** A fan's spinning blades, seen as a blur: dark, letting most through. */
const BLUR: RGB = [0.08, 0.08, 0.09];
export const BLUR_VEIL = 0.45;

const handrailOf = (h: Habitat): number => h.params.landmarks?.handrail ?? 1.1;

/** The shell at x (handrails, −length/2 tail … +length/2 nose): its half width, the top's and the belly's height over the shell's middle line. */
function section(x: number): { half: number; top: number; low: number } {
  const L = CAP.length / 2, u = Math.min(1, Math.abs(x) / L);
  const curve = (p: number): number => Math.pow(Math.max(0, 1 - Math.pow(u, p)), 1 / p);
  return { half: (CAP.width / 2) * curve(CURVE.plan), top: (CAP.height / 2) * curve(x > 0 ? CURVE.nose : CURVE.tail), low: (CAP.height / 2) * curve(CURVE.belly) };
}

/** The shell's middle line's height over the ground (handrails). */
const MIDDLE = CAP.belly + CAP.height / 2;

/** A point of the shell (handrails) at x and the angle φ round its section (0 the spine, +π/2 its left, ±π the keel). */
function shellPoint(x: number, phi: number, inset = 0): Vec3 {
  const s = section(x), q = 2 / CURVE.section, c = Math.cos(phi), sn = Math.sin(phi);
  const pow = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), q);
  return [x, (s.half - inset) * pow(sn), MIDDLE + (c >= 0 ? s.top - inset : s.low - inset) * pow(c)];
}

/** The angle round the section where the shell is `z` over the ground at x (on its left side; the right is its negative). */
function angleAt(x: number, z: number): number {
  let lo = 0, hi = Math.PI;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (shellPoint(x, mid)[2] > z) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The glass's lowest edge at x: over the floor amidships, sweeping down toward the nose so one sees ahead and down. */
const beltAt = (x: number): number => CAP.belly + CAP.floor + CAP.belt - (CAP.belt - CAP.beltNose) * smoothstep(0.1, 0.9, x / (CAP.length / 2));

/** The capsule's seat and door, in its frame (m): where one's feet are seated and the way one faces; the doorway's middle inside and a step out from it. */
export interface CapSeat {
  feet: Vec3;
  front: Vec3;
}
export interface CapDoor {
  inside: Vec3;
  outside: Vec3;
  out: Vec3;
}
export interface CapLayout {
  /** The seat a passenger alone takes: the back bench, on the door's side, facing forward. */
  seat: CapSeat;
  door: CapDoor;
  /** The cabin floor's height over the ground (m), and the door's hinge (a point on its line, along x). */
  floor: number;
  hinge: Vec3;
  /** How far from its middle anything of it reaches (m), and its half length and half width (m) on the ground. */
  reach: number;
  halfLength: number;
  halfWidth: number;
}

/** The capsule's layout for a habitat (sizes by its handrail). */
export function capLayout(h: Habitat): CapLayout {
  const hr = handrailOf(h), floor = (CAP.belly + CAP.floor) * hr;
  const edge = -CAP.seatEdge * hr, side = -(CAP.seatWidth / 2) * hr;
  const sill = shellPoint(0, -angleAt(0, CAP.belly + CAP.floor + CAP.doorFoot));
  const ductOut = (CAP.ductAt[1] + CAP.duct) * hr, hingeAt = shellPoint(0, -CAP.hinge);
  return {
    seat: { feet: [edge + SEAT_FEET, side, floor], front: [1, 0, 0] },
    door: { inside: [0, sill[1] * hr + 0.35 * hr, floor], outside: [0, sill[1] * hr - 0.75 * hr, 0], out: [0, -1, 0] },
    floor,
    hinge: [0, hingeAt[1] * hr, hingeAt[2] * hr],
    reach: Math.hypot((CAP.ductAt[0] + CAP.duct) * hr, ductOut, MIDDLE * hr + (CAP.height / 2) * hr),
    halfLength: Math.max(CAP.length / 2, CAP.ductAt[0] + CAP.duct) * hr,
    halfWidth: ductOut,
  };
}

/** The capsule's meshes in its frame (m): its body, its glass (and the fans' blur), and its door's body and glass, the door in the hinge's frame (origin on the hinge line). */
export interface CapsuleShapes {
  body: Shape;
  glass: Shape;
  doorBody: Shape;
  doorGlass: Shape;
}

/**
 * Build the capsule: a pearl ceramic shell, glass from the belt line over the top (lower toward the nose), a bronze band
 * along the belt, four ducted fans on short pylons at its corners (dark ducts with stator vanes and hubs, the blades a
 * blur), four feet; inside, a timber floor and two cushioned benches facing each other, the shell lined. The door is
 * the stretch of shell and glass amidships on its right. Built as `mapped` shapes for the BUILT kind (body) and the
 * glass kind (`finish` there: how much of what lies behind it the glass keeps out).
 */
export function buildCapsule(h: Habitat): CapsuleShapes {
  const hr = handrailOf(h), m = (p: Vec3): Vec3 => [p[0] * hr, p[1] * hr, p[2] * hr];
  const body = new Shape(24, true, true), glass = new Shape(24, true, true), doorBody = new Shape(24, true, true), doorGlass = new Shape(24, true, true);
  const L = CAP.length / 2, X = 40, door = CAP.door, hinge = m(shellPoint(0, -CAP.hinge));
  const beltPhi = (x: number): number => angleAt(x, beltAt(x)), footPhi = (x: number): number => angleAt(x, CAP.belly + CAP.floor + CAP.doorFoot);
  // A patch of the shell between x0 and x1 and two angles (functions of x), outside (normals out) or its lining inside.
  const patch = (sh: Shape, x0: number, x1: number, a0: (x: number) => number, a1: (x: number) => number, rows: number, cols: number, col: RGB, inside = false, origin: Vec3 = [0, 0, 0]): void => {
    const inset = inside ? CAP.wall : 0;
    // Each row's angles once (finding the belt is a search).
    const xs = Array.from({ length: rows + 1 }, (_, i) => x0 + ((x1 - x0) * i) / rows), from = xs.map(a0), to = xs.map(a1);
    sh.smoothGrid(rows, cols, (i, j) => {
      const x = xs[i], f = j / cols, phi = from[i] + (to[i] - from[i]) * f;
      const p = shellPoint(x, phi, inset), dx = 1e-3, da = 1e-3;
      const px = v3sub(shellPoint(Math.min(L, x + dx), phi, inset), shellPoint(Math.max(-L, x - dx), phi, inset));
      const pa = v3sub(shellPoint(x, phi + da, inset), shellPoint(x, phi - da, inset));
      let n = v3cross(px, pa);
      const away: Vec3 = [Math.abs(x) > L * 0.999 ? Math.sign(x) : 0, p[1], p[2] - MIDDLE];
      if (Math.hypot(...n) < 1e-12) n = away;
      n = v3norm(v3dot(n, away) < 0 ? [-n[0], -n[1], -n[2]] : n);
      if (inside) n = [-n[0], -n[1], -n[2]];
      const q = m(p);
      return { p: [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]], n, uv: [x * hr, phi * hr] };
    }, col);
  };
  const keel = (): number => Math.PI, keelR = (): number => -Math.PI;
  const belt = (x: number): number => beltPhi(x), beltR = (x: number): number => -beltPhi(x);
  const doorTop = (): number => -CAP.hinge, doorFoot = (x: number): number => -footPhi(x);
  // The glass: over the top from belt to belt; on the right, amidships, only down to the door's top edge.
  glass.finish = GLASS_VEIL;
  for (const [x0, x1, n] of [[-L, -door, 12], [door, L, 14]] as const) patch(glass, x0, x1, beltR, belt, n, 24, GLASS);
  patch(glass, -door, door, doorTop, belt, 8, 20, GLASS);
  // The hull: the left side and the keel; the right side below the belt, amidships only below the door.
  body.finish = FINISH.ceramic;
  patch(body, -L, L, belt, keel, X, 14, PEARL);
  for (const [x0, x1, n] of [[-L, -door, 12], [door, L, 14]] as const) patch(body, x0, x1, keelR, beltR, n, 14, PEARL);
  patch(body, -door, door, keelR, doorFoot, 8, 8, PEARL);
  // Its lining inside, where one sits.
  body.finish = FINISH.plaster;
  patch(body, -L, L, belt, keel, X, 10, LINING, true);
  for (const [x0, x1, n] of [[-L, -door, 12], [door, L, 14]] as const) patch(body, x0, x1, keelR, beltR, n, 10, LINING, true);
  patch(body, -door, door, keelR, doorFoot, 8, 6, LINING, true);
  // The door: its glass, its hull below the belt and lining, in the hinge's frame.
  doorGlass.finish = GLASS_VEIL;
  patch(doorGlass, -door, door, beltR, doorTop, 8, 10, GLASS, false, hinge);
  doorBody.finish = FINISH.ceramic;
  patch(doorBody, -door, door, doorFoot, beltR, 8, 8, PEARL, false, hinge);
  doorBody.finish = FINISH.plaster;
  patch(doorBody, -door, door, doorFoot, beltR, 8, 6, LINING, true, hinge);
  // The bronze band along the belt line, both sides (the door's piece goes with it), and a thin spine over the top.
  body.finish = FINISH.bronze;
  const band = (sh: Shape, x0: number, x1: number, side: 1 | -1, origin: Vec3 = [0, 0, 0]): void => patch(sh, x0, x1, (x) => side * (beltPhi(x) + 0.015), (x) => side * (beltPhi(x) + 0.06), Math.max(4, Math.round((x1 - x0) * 6)), 1, BRONZE, false, origin);
  band(body, -L * 0.97, L * 0.97, 1);
  band(body, -L * 0.97, -door, -1);
  band(body, door, L * 0.97, -1);
  doorBody.finish = FINISH.bronze;
  band(doorBody, -door, door, -1, hinge);
  patch(body, -L * 0.9, L * 0.8, () => -0.03, () => 0.03, 24, 1, BRONZE);
  // The cabin floor: timber boards across, on the shell's lining.
  body.finish = FINISH.timber;
  const floorZ = (CAP.belly + CAP.floor) * hr, boards = 14, fx = (L - 0.25) * hr;
  for (let k = 0; k < boards; k++) {
    // The shell is narrower at the floor than at its widest: about this share of it there.
    const x = -fx + ((k + 0.5) * 2 * fx) / boards, half = Math.max(0.1, section(x / hr).half * 0.86 - 0.06) * hr;
    body.block([x, 0, floorZ - 0.02 * hr], [1, 0, 0], [0, 1, 0], [0, 0, 1], [fx / boards - 0.004, half, 0.02 * hr], TIMBER);
  }
  // Two benches facing each other across the door, cushioned, with a back against the shell.
  for (const dir of [1, -1] as const) {
    const edge = -dir * CAP.seatEdge, deep = CAP.seatDeep, back = edge - dir * deep, mid = (edge + back) / 2, w = CAP.seatWidth;
    body.finish = FINISH.timber;
    body.block(m([mid, 0, CAP.belly + CAP.floor + CAP.seat / 2 - 0.03]), [1, 0, 0], [0, 1, 0], [0, 0, 1], m([deep / 2, w, CAP.seat / 2 - 0.03]), TIMBER);
    body.finish = FINISH.plaster;
    body.block(m([mid, 0, CAP.belly + CAP.floor + CAP.seat - 0.03]), [1, 0, 0], [0, 1, 0], [0, 0, 1], m([deep / 2 - 0.01, w - 0.02, 0.05]), CUSHION);
    const lean = 0.18, ax = v3norm([-dir * lean, 0, 1]);
    body.block(m([back + dir * 0.06, 0, CAP.belly + CAP.floor + CAP.seat + CAP.back / 2]), v3norm(v3cross([0, 1, 0], ax)), [0, 1, 0], ax, m([0.05, w - 0.04, CAP.back / 2]), CUSHION);
  }
  // The fans: four ducts on pylons from the shell, each with stator vanes, a hub and its blades' blur.
  const [dx, dy, dz] = CAP.ductAt;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const duct = new Shape(28, true, true), r = CAP.duct * hr, d = CAP.ductDeep * hr, t = 0.05 * hr;
    duct.finish = FINISH.ceramic;
    duct.band(-d / 2, r, d / 2, r, 0, 1, GRAPHITE);
    duct.band(d / 2, r - t, -d / 2, r - t, 0, -1, GRAPHITE);
    duct.band(d / 2, r, d / 2, r - t, 1, 0, PEARL);
    duct.band(-d / 2, r - t, -d / 2, r, -1, 0, GRAPHITE);
    duct.finish = FINISH.bronze;
    duct.prism([0, 0, -d / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.09 * hr, d * 0.8, 10, BRONZE);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * 2 * Math.PI + 0.3, c = Math.cos(a), s = Math.sin(a);
      duct.block([c * r * 0.5, s * r * 0.5, -d * 0.3], [c, s, 0], [-s, c, 0], [0, 0, 1], [r * 0.45, 0.012 * hr, d * 0.15], GRAPHITE);
    }
    const at: Vec3 = m([sx * dx, sy * dy, dz]);
    body.finish = FINISH.ceramic;
    body.append(duct, [1, 0, 0], [0, 1, 0], [0, 0, 1], at);
    // A pylon from the duct's inner side into the shell.
    const into = m(shellPoint(sx * dx * 0.86, sy * Math.PI * 0.62));
    const mid: Vec3 = [(into[0] + at[0]) / 2, (into[1] + at[1]) / 2, (into[2] + at[2]) / 2];
    const ax = v3norm(v3sub(at, into)), up: Vec3 = [0, 0, 1], side = v3norm(v3cross(up, ax));
    body.block(mid, ax, side, v3cross(ax, side), [Math.hypot(...v3sub(at, into)) / 2, 0.06 * hr, 0.04 * hr], PEARL);
    glass.finish = BLUR_VEIL;
    glass.arc(at[2] + 0.02 * hr, r - t, at[2] + 0.02 * hr, 0.09 * hr, 1, 0, 0, 2 * Math.PI, 24, BLUR);
    // Shift the blur disc out to its duct (the arc is round the frame's z axis).
    const n = glass.vertices, k0 = n - 50;
    for (let v = k0; v < n; v++) { glass.pos[v * 3] += at[0]; glass.pos[v * 3 + 1] += at[1]; }
  }
  // Four feet under the belly.
  body.finish = FINISH.bronze;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const foot: Vec3 = m([sx * 0.95, sy * 0.52, CAP.belly / 2 + 0.02]);
    body.block(foot, [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.05 * hr, 0.05 * hr, (CAP.belly / 2 + 0.02) * hr], BRONZE);
    body.block([foot[0], foot[1], 0.012 * hr], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.13 * hr, 0.09 * hr, 0.012 * hr], GRAPHITE);
  }
  return { body, glass, doorBody, doorGlass };
}


/** The door's frame at a share of its opening (0 shut, 1 open), in the capsule's frame: it swings up and out about its hinge. */
export function doorPlace(layout: CapLayout, open: number): Place {
  const a = -DOOR_OPEN * smoothstep(0, 1, open), c = Math.cos(a), s = Math.sin(a);
  return { at: layout.hinge, ex: [1, 0, 0], ey: [0, c, s], ez: [0, -s, c] };
}

/** How tall the tallest trees of a habitat's climate grow (m): a capsule cruises over them. */
export function tallestCrown(h: Habitat): number {
  return Math.max(0, ...(climateOf(h.params.climate)?.biomes.flatMap((b) => b.plants.map((p) => p.height[1])) ?? [0]));
}

/** Where a capsule stands, parked: a place (its frame) on open ground. */
export type CapPad = Place;

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
 * their crowns', and level enough under its four feet (along true up). Its door faces (θ, s); null where no such ground
 * is in reach.
 */
export function landingNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, reach: number, least = 0): CapPad | null {
  const t = ecology.terrain, h = t.habitat, { profile } = h, lay = capLayout(h), hr = handrailOf(h);
  const r0 = Math.max(1, profile.at(s).r), clear = Math.hypot(lay.halfLength, lay.halfWidth) + 0.3 * hr;
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
      // A tree's crown reaches out about a third of its height; a bush or a stone its own size.
      const keep = clear + (sp.what !== 'debris' && tall >= 6 ? 0.35 * tall : 0.6 * tall);
      standsIn(ecology, sp, bounds, 0, (pt, ps) => obstacles.push({ x: (wrapAngle(pt - theta + Math.PI) - Math.PI) * r0, y: ps - s, r: keep }));
    }
    for (; ring <= stage; ring += step) {
      const n = ring < 1e-6 ? 1 : Math.max(6, Math.ceil((2 * Math.PI * ring) / step)), turn = hashToFloat(hash3i(seed, Math.round(ring * 8), 0, 0));
      for (let k = 0; k < n; k++) {
        const a = ((k + turn) / n) * 2 * Math.PI, x = ring * Math.cos(a), y = ring * Math.sin(a);
        if (obstacles.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < o.r * o.r)) continue;
        const pt = theta + x / r0, ps = s + y;
        if (ps < 0 || ps > profile.length) continue;
        const pad = padAt(t, pt, ps, Math.atan2(-x, -y), lay);
        if (pad) return pad;
      }
    }
  }
  return null;
}

/**
 * A capsule parked at (θ, s), its door's side turned toward `toward` (rad over the floor: 0 toward +s, π/2 spinward),
 * or null where it cannot stand: wet, on or by something built, or not level enough under its feet.
 */
function padAt(t: Terrain, theta: number, s: number, toward: number, lay: CapLayout): CapPad | null {
  const h = t.habitat, hr = handrailOf(h);
  const ground = t.heightAt(theta, s);
  if (t.standAt(theta, s) > ground + 0.02 || t.waterDepth(toWorld(h.profile, { theta, s, h: ground })) > 0) return null;
  // True up: toward the axis (as world/motion.ts `upAt` has it; the generator stays below the world layer).
  const middle = toWorld(h.profile, { theta, s, h: ground }), rr = Math.hypot(middle[0], middle[1]);
  if (rr < 1e-6) return null;
  const up: Vec3 = [-middle[0] / rr, -middle[1] / rr, 0];
  // The door (−y) toward `toward`: y points away from it, x = y × z.
  const ct = Math.cos(toward), st = Math.sin(toward), r = Math.max(1, h.profile.at(s).r);
  const towardWorld = v3norm(v3sub(toWorld(h.profile, { theta: theta + st / r, s: s + ct, h: ground }), middle));
  const flat = v3norm(v3sub(towardWorld, [up[0] * v3dot(towardWorld, up), up[1] * v3dot(towardWorld, up), up[2] * v3dot(towardWorld, up)]));
  const ey: Vec3 = [-flat[0], -flat[1], -flat[2]], ex = v3cross(ey, up);
  // Level enough: its feet and corners within a small step of each other along true up, and none on anything built.
  let hi = -Infinity, lo = Infinity;
  for (const [fx, fy] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, -1.6]]) {
    const q = fromWorld(h.profile, ...[0, 1, 2].map((k) => middle[k] + ex[k] * fx * lay.halfLength + ey[k] * fy * lay.halfWidth) as Vec3);
    if (keptClear(t, q.theta, q.s) || landmarkTopAt(t, q.theta, q.s) !== null) return null;
    const g = t.heightAt(q.theta, q.s);
    if (t.standAt(q.theta, q.s) > g + 0.02) return null;
    const d = v3dot(toWorld(h.profile, { theta: q.theta, s: q.s, h: g }), up);
    hi = Math.max(hi, d);
    lo = Math.min(lo, d);
  }
  if (hi - lo > 0.35 * hr) return null;
  // It stands on its highest foot.
  const lift = hi - v3dot(middle, up);
  return { at: [middle[0] + up[0] * lift, middle[1] + up[1] * lift, middle[2] + up[2] * lift], ex, ey, ez: up };
}

/** A place one can ride a capsule to: what the link lists (`title`, `group`), and where on the land it is. */
export interface CapDestination {
  id: string;
  title: string;
  group: string;
  theta: number;
  s: number;
  /** How far round it the ground is taken by what is there (m: a court's pit and its clear ring): a capsule sets down beyond. */
  around: number;
}

/** How each district style's commons are named in the list of destinations. */
const STYLE_NAMES: Readonly<Record<string, string>> = {
  orchard: 'orchards', water: 'water gardens', stone: 'stone works', grove: 'groves', herd: 'pastures', play: 'playing fields', makers: "makers' commons", 'let-go': 'let-go land',
};

/**
 * The places of a habitat one can ride a capsule to (made once a terrain is; the capsule sets down on open ground near
 * each, `landingNear`): the landmarks (the arrival terrace, the foot of the Lift Stair, the lake pavilion's shore, the
 * founders' grove, the summit hut), every entrance court (down to the homes below), every harbour.
 */
export function capDestinations(t: Terrain): CapDestination[] {
  const h = t.habitat, plan = planOf(h), out: CapDestination[] = [], hr = handrailOf(h);
  const add = (id: string, title: string, group: string, theta: number, s: number, around = 0): void => { out.push({ id, title, group, theta: wrapAngle(theta), s, around }); };
  const terrace = arrivalTerraceOf(h);
  if (terrace) { const at = fromWorld(h.profile, ...terrace.feet); add('arrival', 'Arrival terrace', 'Landmarks', at.theta, at.s); }
  const stair = liftStairOf(h);
  if (stair) {
    const p = stair.platforms[0], at = fromWorld(h.profile, ...rampOf(h).world((p.z0 + p.z1) / 2, (p.w0 + p.w1) / 2, p.e));
    add('stair-foot', 'Foot of the Lift Stair', 'Landmarks', at.theta, at.s);
  }
  for (const l of landmarksOf(t)) {
    if (l.kind === 'pavilion') {
      // On the shore where its bridge lands (the nearer end, toward the port).
      const b = l.bridges.find((x) => x.dir === 1) ?? l.bridges[0];
      add('pavilion', 'Lake pavilion', 'Landmarks', l.theta, l.s + (b ? b.dir * (b.to + 4 * hr) : 0));
    } else add('summit-hut', 'Summit hut', 'Landmarks', l.theta, l.s);
  }
  const grove = siteOf(plan, 'founders-grove');
  if (grove) add('grove', "Founders' grove", 'Landmarks', grove.theta, grove.s);
  entrancesOf(plan).forEach((site, i) => {
    const style = plan.districts[site.district]?.style;
    add(`court-${i}`, `Court ${i + 1}${style ? `, ${STYLE_NAMES[style] ?? style}` : ''}`, 'Courts', site.theta, site.s, site.size + COURT.clear * hr);
  });
  const fleet = fleetOf(h), kinds = { ring: 'ring lake', great: 'great lake', mere: 'lake' } as const;
  fleet.harbours.forEach((hb, i) => {
    const shore = floorAt(h, hb.frame, -(HARBOUR.landing + 3) * hb.handrail, 0), basin = fleet.basins[hb.basin];
    add(`harbour-${i}`, `Harbour ${i + 1}, ${basin ? kinds[basin.kind] : 'water'}`, 'Harbours', shore.theta, shore.s);
  });
  return out;
}

/** How far over the floor from one point to another (m): along the axis and around it at the mean radius, the shorter way. */
export function overFloor(h: Habitat, t0: number, s0: number, t1: number, s1: number): number {
  const r = Math.max(1, (h.profile.at(s0).r + h.profile.at(s1).r) / 2);
  return Math.hypot((wrapAngle(t1 - t0 + Math.PI) - Math.PI) * r, s1 - s0);
}
