/**
 * The boats (Arnd 2026-10-23: "sail boats, slick, futuristic"): what each design is (`BOAT_KINDS`: its size, how close
 * to the wind it points, how fast it goes; sim/sailing.ts sails them) and how it looks, built once from its sizes in a
 * worker and flattened for drawing many at once, as the drones are (gen/drone.ts):
 *
 *   skiff    a narrow planing hull with hiking racks, a daggerboard and a rudder on its transom, and a two-element
 *            wing: a carbon main element and a ribbed film flap behind a slot;
 *   foiler   a trimaran: a slim main hull and two floats on arched beams with trampolines between, a T-foil under the
 *            main hull and the rudder, L-foils under the floats, the cockpit under a low glass canopy, a tall wing;
 *   cruiser  a catamaran: two hulls and a bridge deck between them carrying a glass-roofed deckhouse on slender ribs,
 *            rails round it, a net forward, and the wing on a short mast above the roof.
 *
 * Every vertex carries its finish (`BOAT_FINISH`: matte, gloss composite, the boat's own livery, tinted glass, a light,
 * the wing's ribbed film) and its part (`BOAT_PART`): the wing turns about its mast to the wind, the rest is fixed. The
 * wake is a mesh of its own on the water (a trail behind each hull and the bow waves off it), stretched with the
 * boat's speed by its shader. Two levels: the whole build, and a coarse one (gen/simplify.ts) that keeps its size,
 * colours and outline; from further off, a speck in its wing's and its hull's colours.
 *
 * The boat's frame: y up from the water's surface, the bow along +z, x to port; the origin at mid-length on its
 * centreline. Every size is a share of the design's length, beam and mast height. Pure: runs in the generation worker.
 */
import { v3cross, v3norm, v3sub } from '@futuremagic/core';
import type { Vec3 } from '../blueprint';
import { Shape as Builder, bytesOf, type RGB } from './shapes';
import { simplify, type Shape } from './simplify';

const DEG = Math.PI / 180;

export type BoatKind = 'skiff' | 'foiler' | 'cruiser';

/** A design of boat: its size, how close to the wind it sails, how fast, how it turns. */
export interface BoatSpec {
  /** Hull length, beam over all hulls, mast or wing height (m). */
  length: number;
  beam: number;
  mast: number;
  /** The closest it points to the wind (rad from dead upwind); it beats a little freer, at `beat`. */
  noGo: number;
  beat: number;
  /** The deepest it sails downwind (rad from dead upwind; π: dead downwind). */
  deep: number;
  /** Its speed at its best reach as a share of the true wind, in a moderate breeze. */
  reach: number;
  /** The most it goes in standard gravity (m/s): the power its hulls and crew can hold (grows with √g). */
  top: number;
  /** A foiler: its take-off speed in standard gravity (m/s) and how much faster it goes once flying. */
  foil: { takeoff: number; lift: number } | null;
  /** How long a tack or gybe takes (s), sailing at `TURNING` of its speed. */
  turn: number;
  /** How far it heels at the most (rad), in a gust on a reach. */
  heel: number;
  /** How many sail it, at least and at the most. */
  crew: [number, number];
  /** How much room it needs: the narrowest water it is sailed on, in its own lengths. */
  room: number;
  /** How deep it reaches below its waterline (m): its daggerboard, keels or foils. */
  draft: number;
  /** How fast it goes on its quiet drive in and out of its harbour (m/s), its wing feathered. */
  motor: number;
}

/**
 * The designs. The skiff: a planing two-hander with a wing, quick to tack. The foiler: a trimaran on hydrofoils with a
 * rigid wing, slow until it lifts out, then twice as fast as the wind. The cruiser: a catamaran with a glass deckhouse,
 * a rotating wing mast, a dozen friends aboard and no hurry.
 */
export const BOAT_KINDS: Readonly<Record<BoatKind, BoatSpec>> = {
  skiff: { length: 4.6, beam: 1.9, mast: 7.5, noGo: 40 * DEG, beat: 44 * DEG, deep: 155 * DEG, reach: 0.95, top: 8, foil: null, turn: 5, heel: 22 * DEG, crew: [1, 2], room: 8, draft: 1.15, motor: 1.4 },
  foiler: { length: 9.5, beam: 6.8, mast: 13, noGo: 35 * DEG, beat: 40 * DEG, deep: 145 * DEG, reach: 1.15, top: 16, foil: { takeoff: 3.8, lift: 1.8 }, turn: 9, heel: 8 * DEG, crew: [2, 3], room: 16, draft: 2.4, motor: 2.2 },
  cruiser: { length: 12.5, beam: 6.4, mast: 15, noGo: 46 * DEG, beat: 50 * DEG, deep: 180 * DEG, reach: 0.75, top: 7.5, foil: null, turn: 14, heel: 3 * DEG, crew: [2, 12], room: 10, draft: 1.7, motor: 1.8 },
};
export const BOAT_KIND_LIST = Object.keys(BOAT_KINDS) as BoatKind[];

/** What a surface is (a vertex's `paint` alpha byte, exactly): its kind's shader lights each its own way. */
export const BOAT_FINISH = { matte: 0, gloss: 1, livery: 2, glass: 3, light: 4, film: 5 } as const;
/** What a vertex moves with (`rig` z): the hull and all on it, the wing (turning about its mast), the wake. */
export const BOAT_PART = { fixed: 0, wing: 1, wake: 2 } as const;

/**
 * A mesh of a design, ready to draw (the BOAT and BOAT_WAKE kinds): per vertex its position and normal (the boat's
 * frame, m), its `paint` (4 bytes: rgb its colour, linear; a its finish, or on the wake its foam's opacity) and its
 * `rig` (4 floats: x and z of the point it turns or stretches about, its part, and on the wake how far along it is,
 * 0 at the hull to 1 at its end).
 */
export interface BoatMesh {
  positions: Float32Array;
  normals: Float32Array;
  paint: Uint8Array;
  rig: Float32Array;
  index: Uint32Array;
}

export interface BoatDesign {
  kind: BoatKind;
  name: string;
  body: BoatMesh;
  /** The coarse level: the same boat with far fewer triangles. */
  coarse: BoatMesh;
  wake: BoatMesh;
  /** Bounds of the boat (its frame, m). */
  min: Vec3;
  max: Vec3;
  /** Its wing's colour from afar (linear): the mean of its surfaces by area. */
  wing: Vec3;
}

/** Colours (linear). The livery's is the boat's own (`LIVERIES`), multiplying white. */
const LOOK = {
  white: [1, 1, 1] as RGB,
  deck: [0.6, 0.6, 0.56] as RGB,
  carbon: [0.035, 0.038, 0.043] as RGB,
  composite: [0.78, 0.79, 0.78] as RGB,
  film: [0.74, 0.76, 0.73] as RGB,
  glass: [0.025, 0.04, 0.05] as RGB,
  net: [0.07, 0.075, 0.08] as RGB,
  metal: [0.5, 0.52, 0.55] as RGB,
  masthead: [1, 0.96, 0.88] as RGB,
  port: [1, 0.08, 0.05] as RGB,
  starboard: [0.08, 1, 0.3] as RGB,
};

/**
 * The hulls' colours a boat is painted in (linear): pearl, graphite, deep blue, sea green, sand, oxide red, silver,
 * slate. Muted, as composites a thousand years on would be: no toy colours.
 */
export const LIVERIES: readonly RGB[] = [
  [0.8, 0.8, 0.77], [0.055, 0.06, 0.066], [0.025, 0.04, 0.09], [0.05, 0.16, 0.13],
  [0.5, 0.41, 0.27], [0.3, 0.06, 0.04], [0.42, 0.44, 0.46], [0.11, 0.16, 0.23],
];

/** How finely a hull is cut: stations from stern to bow, points down each side, across the deck. */
const STATIONS = 28;
const SIDE = 8;
const ACROSS = 6;
/** A wing's cut: rows up it, points down each face of an element. */
const SPAN = 16;
const CHORD = 10;
/** The coarse level's cells: the boat's size over this many. */
const COARSE_CELLS = 16;
/** Where the bilge turns into the topsides (a share of the way round a side), how far the topsides flare, the deck's camber (of its half width). */
const BILGE = 0.7;
const FLARE = 0.9;
const CAMBER = 0.06;
/** The bow waves leave at the Kelvin angle; the wake behind runs this many boat lengths at full speed, the bow waves this many. */
const KELVIN = 19.47 * DEG;
const TRAIL = 5;
const ARMS = 1.6;

/** A hull: where its centreline is (x, and z of its middle), its length, beam at the deck, depth under water, freeboard. */
interface Hull {
  x: number;
  z: number;
  length: number;
  beam: number;
  draft: number;
  free: number;
  /** Where it is widest (share of its length from the stern), its transom's width (share of its beam). */
  widest: number;
  transom: number;
  /** Its sections' shape low down: under 1 flat (planing), about 1 round, over 1 a vee. */
  vee: number;
}

/** A hull's lines: its half beam, depth and freeboard at t (0 stern, 1 bow); a point on its skin at t, u (−1 … 1 round from the starboard sheer by the keel to the port sheer); its deck's height. */
function linesOf(f: Hull) {
  const half = (t: number): number => {
    if (t <= f.widest) return (f.beam / 2) * (f.transom + (1 - f.transom) * Math.sin((t / f.widest) * Math.PI / 2));
    return (f.beam / 2) * (1 - Math.pow((t - f.widest) / (1 - f.widest), 1.8));
  };
  const depth = (t: number): number => f.draft * (0.22 + 0.78 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + 0.95 * t)), 0.7));
  const free = (t: number): number => f.free * (0.92 + 0.16 * t);
  const zOf = (t: number): number => f.z + (t - 0.5) * f.length;
  const skin = (t: number, u: number): Vec3 => {
    const h = half(t), a = Math.abs(u), side = Math.sign(u);
    let x: number, y: number;
    if (a <= BILGE) {
      const phi = (a / BILGE) * Math.PI / 2;
      x = h * FLARE * Math.pow(Math.sin(phi), f.vee * 0.6);
      y = -depth(t) * Math.pow(Math.cos(phi), 1.4);
    } else {
      const k = (a - BILGE) / (1 - BILGE);
      x = h * (FLARE + (1 - FLARE) * k);
      y = free(t) * k;
    }
    return [f.x + side * x, y, zOf(t)];
  };
  const deck = (t: number, w: number): number => free(t) + CAMBER * half(t) * (1 - w * w);
  return { half, depth, free, zOf, skin, deck };
}

/** A smooth surface's normal at (a, b) from its points round it, turned the way `out` says is outward. */
function normalBy(at: (a: number, b: number) => Vec3, a: number, b: number, out: (n: Vec3) => boolean): Vec3 {
  const e = 1e-3;
  const da = v3sub(at(Math.min(1, a + e), b), at(Math.max(0, a - e), b)), db = v3sub(at(a, b + e), at(a, b - e));
  let n = v3cross(db, da);
  const l = Math.hypot(n[0], n[1], n[2]);
  n = l > 1e-12 ? v3norm(n) : [0, 1, 0];
  return out(n) ? n : [-n[0], -n[1], -n[2]];
}

/** The surfaces of a boat being built, by finish and part, each its own builder. */
class Parts {
  private readonly all = new Map<string, { b: Builder; finish: number; part: number }>();
  /** Where the wing turns (x, z). */
  hub: [number, number] = [0, 0];
  on(finish: number, part: number = BOAT_PART.fixed): Builder {
    const key = `${finish}/${part}`;
    let p = this.all.get(key);
    if (!p) this.all.set(key, (p = { b: new Builder(12, true), finish, part }));
    return p.b;
  }

  /** Everything as one shape: colour and finish in `colors`, the turning point and part in `parts`. */
  flat(): Shape {
    const list = [...this.all.values()];
    const verts = list.reduce((n, p) => n + p.b.vertices, 0), tris = list.reduce((n, p) => n + p.b.idx.length, 0);
    const out: Shape = { positions: new Float32Array(verts * 3), normals: new Float32Array(verts * 3), colors: new Float32Array(verts * 4), parts: new Float32Array(verts * 4), index: new Uint32Array(tris) };
    let v = 0, i = 0;
    for (const { b, finish, part } of list) {
      for (let k = 0; k < b.idx.length; k++) out.index[i++] = b.idx[k] + v;
      for (let k = 0; k < b.vertices; k++, v++) {
        out.positions.set(b.pos.slice(k * 3, k * 3 + 3), v * 3);
        out.normals.set(b.nrm.slice(k * 3, k * 3 + 3), v * 3);
        out.colors.set([b.col[k * 3], b.col[k * 3 + 1], b.col[k * 3 + 2], finish], v * 4);
        if (part === BOAT_PART.wing) out.parts.set([this.hub[0], this.hub[1], part, 0], v * 4);
      }
    }
    return out;
  }
}

/** A hull's skin (in the boat's livery), its deck, and its transom closing the stern. */
function hullOf(parts: Parts, f: Hull): ReturnType<typeof linesOf> {
  const lines = linesOf(f), { skin, deck, zOf, half } = lines;
  // Outward: away from the centreline on each side, down at the keel.
  const out = (u: number) => (n: Vec3): boolean => (u > 1e-6 ? n[0] : u < -1e-6 ? -n[0] : -n[1]) >= 0;
  parts.on(BOAT_FINISH.livery).smoothGrid(STATIONS, 2 * SIDE, (a, b) => {
    const t = a / STATIONS, u = b / SIDE - 1;
    return { p: skin(t, u), n: normalBy((x, y) => skin(x, y * 2 - 1), t, (u + 1) / 2, out(u)), uv: [0, 0] };
  }, LOOK.white);
  const deckPoint = (t: number, w: number): Vec3 => [f.x + w * half(t), deck(t, w), zOf(t)];
  parts.on(BOAT_FINISH.matte).smoothGrid(STATIONS, ACROSS, (a, b) => {
    const t = a / STATIONS, w = (2 * b) / ACROSS - 1;
    return { p: deckPoint(t, w), n: v3norm([2 * CAMBER * w, 1, 0]), uv: [0, 0] };
  }, LOOK.deck);
  const ring: Vec3[] = [];
  for (let b = 0; b <= 2 * SIDE; b++) ring.push(skin(0, b / SIDE - 1));
  for (let b = ACROSS - 1; b >= 1; b--) ring.push(deckPoint(0, (2 * b) / ACROSS - 1));
  const mid = ring.reduce((c, p) => [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length, c[2] + p[2] / ring.length] as Vec3, [0, 0, 0]);
  parts.on(BOAT_FINISH.livery).capFan(mid, ring, [0, 0, -1], LOOK.white);
  return lines;
}

/** NACA four-digit symmetric thickness (half, as a share of the chord) at x along it, for thickness ratio `thick`. */
const naca = (x: number, thick: number): number =>
  5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);

/**
 * One element of a wing or foil, standing up: its section at height share η from `lead(η)` (z of the leading edge)
 * back over `chord(η)`, `thick` thick, centred on x; its foot closed. Up from `foot` over `height`.
 */
function element(b: Builder, x: number, foot: number, height: number, lead: (eta: number) => number, chord: (eta: number) => number, thick: number, col: RGB): void {
  const surface = (eta: number, s: number): Vec3 => {
    const q = (1 - Math.cos(Math.PI * Math.abs(s))) / 2, c = chord(eta);
    return [x + Math.sign(s) * naca(q, thick) * c, foot + eta * height, lead(eta) - q * c];
  };
  const out = (s: number) => (n: Vec3): boolean => (Math.abs(s) > 1e-6 ? Math.sign(s) * n[0] : n[2]) >= 0;
  b.smoothGrid(SPAN, 2 * CHORD, (a, k) => {
    const eta = a / SPAN, s = k / CHORD - 1;
    return { p: surface(eta, s), n: normalBy((e, w) => surface(e, w * 2 - 1), eta, (s + 1) / 2, out(s)), uv: [0, 0] };
  }, col);
  const ring = Array.from({ length: 2 * CHORD }, (_, k) => surface(0, k / CHORD - 1));
  b.capFan([x, foot, lead(0) - chord(0) * 0.4], ring, [0, -1, 0], col);
}

/**
 * The wing: a main element turning on its mast at a quarter of its chord, and a flap behind it past a slot. Its plan
 * tapers and rounds off at the head; a light at the masthead.
 */
function wingOf(parts: Parts, at: { x: number; z: number }, foot: number, height: number, chord: number, main: { finish: number; col: RGB }): void {
  parts.hub = [at.x, at.z];
  const chordAt = (eta: number): number => chord * (1 - 0.45 * eta) * Math.sqrt(Math.max(0, 1 - Math.pow(eta, 3)));
  const mainChord = (eta: number): number => 0.6 * chordAt(eta), flapChord = (eta: number): number => 0.42 * chordAt(eta);
  const mainLead = (eta: number): number => at.z + 0.25 * mainChord(eta);
  element(parts.on(main.finish, BOAT_PART.wing), at.x, foot, height, mainLead, mainChord, 0.18, main.col);
  element(parts.on(BOAT_FINISH.film, BOAT_PART.wing), at.x, foot, height * 0.97, (eta) => mainLead(eta) - mainChord(eta) * 0.97, flapChord, 0.12, LOOK.film);
  parts.on(BOAT_FINISH.light, BOAT_PART.wing).prism([at.x, foot + height * 0.985, at.z], [1, 0, 0], [0, 0, -1], [0, 1, 0], 0.035, 0.07, 6, LOOK.masthead);
}

/** A foil or board: a thin aerofoil strut from `top` down to `bottom` at (x, z), and with `span` a wing across its foot. */
function foilOf(parts: Parts, x: number, z: number, top: number, bottom: number, chord: number, span = 0, toward = 0): void {
  const b = parts.on(BOAT_FINISH.gloss);
  element(b, x, bottom, top - bottom, () => z + chord * 0.3, () => chord, 0.12, LOOK.carbon);
  if (span <= 0) return;
  // The lifting foil: flat across, from the strut's foot, both ways (a T) or one way inboard (an L).
  const from = toward === 0 ? x - span / 2 : x, to = toward === 0 ? x + span / 2 : x + toward * span;
  b.block([(from + to) / 2, bottom + 0.02, z - chord * 0.2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [Math.abs(to - from) / 2, 0.025, chord * 0.45], LOOK.carbon);
}

/** A light: a small bead of its colour. */
const lightAt = (parts: Parts, p: Vec3, col: RGB): void =>
  parts.on(BOAT_FINISH.light).prism(p, [1, 0, 0], [0, 0, -1], [0, 1, 0], 0.03, 0.05, 6, col);

/** A glass shell over a deck: a rounded box in plan and section, lower toward its front; returns its points (q along it 0 … 1 aft to fore, φ 0 … π round from starboard). */
function canopyOf(b: Builder, c: { x: number; base: number; z0: number; z1: number; width: number; height: number; square: number }, col: RGB): (q: number, phi: number) => Vec3 {
  const m = c.square, plan = (q: number): number => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * q - 1), m)), 1 / m);
  const shell = (q: number, phi: number): Vec3 => {
    const r = plan(q), cp = Math.cos(phi), sp = Math.sin(phi);
    const x = Math.sign(cp) * Math.pow(Math.abs(cp), 2 / m), y = Math.pow(Math.abs(sp), 2 / m);
    return [c.x - x * r * c.width / 2, c.base + y * Math.sqrt(r) * c.height * (1 - 0.3 * q), c.z0 + q * (c.z1 - c.z0)];
  };
  const centre: Vec3 = [c.x, c.base, (c.z0 + c.z1) / 2];
  const out = (n: Vec3, p: Vec3): boolean => n[0] * (p[0] - centre[0]) + n[1] * (p[1] - centre[1]) + n[2] * (p[2] - centre[2]) >= 0;
  b.smoothGrid(16, 16, (a, k) => {
    const q = a / 16, phi = (k / 16) * Math.PI, p = shell(q, phi);
    return { p, n: normalBy((x, y) => shell(x, y * Math.PI), q, k / 16, (n) => out(n, p)), uv: [0, 0] };
  }, col);
  return shell;
}

/** A tube through some points (a beam, a rack, a rib, a rail), round. */
const tubeOf = (b: Builder, points: Vec3[], radius: number, col: RGB): void => b.curvedTube(points, points.map(() => radius), 8, col);

/** The skiff (`BOAT_KINDS.skiff`). */
/** Each design's hulls (the first its main one, or the port one of a catamaran), from its sizes. */
const HULLS: Readonly<Record<BoatKind, (s: BoatSpec) => Hull[]>> = {
  skiff: (s) => [{ x: 0, z: 0, length: s.length, beam: 0.76 * s.beam, draft: 0.055 * s.length, free: 0.085 * s.length, widest: 0.42, transom: 0.85, vee: 0.6 }],
  foiler: (s) => {
    const L = s.length, B = s.beam, out = B / 2 - 0.04 * B;
    return [
      { x: 0, z: 0, length: L, beam: 0.19 * B, draft: 0.045 * L, free: 0.075 * L, widest: 0.5, transom: 0.6, vee: 0.9 },
      ...[1, -1].map((side) => ({ x: side * out, z: -0.03 * L, length: 0.86 * L, beam: 0.08 * B, draft: 0.03 * L, free: 0.06 * L, widest: 0.5, transom: 0.4, vee: 1 })),
    ];
  },
  cruiser: (s) => [1, -1].map((side) => ({ x: side * (s.beam / 2 - 0.1 * s.beam), z: 0, length: s.length, beam: 0.2 * s.beam, draft: 0.055 * s.length, free: 0.08 * s.length, widest: 0.45, transom: 0.75, vee: 0.85 })),
};

function skiff(parts: Parts, s: BoatSpec): Hull[] {
  const L = s.length, B = s.beam, hull = HULLS.skiff(s)[0];
  const lines = hullOf(parts, hull), t = (z: number): number => z / L + 0.5;
  // Hiking racks out to the full beam: a tube each side on three struts from the sheer.
  const rack = parts.on(BOAT_FINISH.gloss);
  for (const side of [1, -1]) {
    const y = lines.free(0.3) + 0.06, rail: Vec3[] = [-0.32, -0.15, 0.02, 0.12].map((k) => [side * (B / 2 - 0.03), y, k * L]);
    tubeOf(rack, rail, 0.022, LOOK.carbon);
    for (const k of [-0.3, -0.08, 0.1]) tubeOf(rack, [[side * lines.half(t(k * L)) * 0.95, lines.free(t(k * L)), k * L], [side * (B / 2 - 0.03), y, k * L]], 0.016, LOOK.carbon);
  }
  // The cockpit: a dark sole sunk in the deck aft, low coamings round it.
  const z0 = -0.44 * L, z1 = -0.06 * L, w = 0.27 * B, sole = lines.deck(t(z0), 0) + 0.004;
  parts.on(BOAT_FINISH.matte).box([0, sole, (z0 + z1) / 2], [w, 0.004, (z1 - z0) / 2], LOOK.net);
  for (const side of [1, -1]) parts.on(BOAT_FINISH.gloss).box([side * w, sole + 0.03, (z0 + z1) / 2], [0.012, 0.03, (z1 - z0) / 2], LOOK.composite);
  // Daggerboard, rudder on the transom and its tiller.
  foilOf(parts, 0, 0.06 * L, -hull.draft * 0.4, -hull.draft - 0.19 * L, 0.07 * L);
  foilOf(parts, 0, -0.5 * L - 0.02 * L, lines.free(0), -0.16 * L, 0.06 * L);
  tubeOf(parts.on(BOAT_FINISH.gloss), [[0, lines.free(0) + 0.05, -0.5 * L], [0, lines.free(0) + 0.12, -0.3 * L]], 0.014, LOOK.metal);
  const mast = { x: 0, z: 0.16 * L }, foot = lines.deck(t(mast.z), 0) + 0.04;
  wingOf(parts, mast, foot, s.mast - foot, 0.3 * L, { finish: BOAT_FINISH.gloss, col: LOOK.carbon });
  return [hull];
}

/** The foiling trimaran (`BOAT_KINDS.foiler`). */
function foiler(parts: Parts, s: BoatSpec): Hull[] {
  const L = s.length, B = s.beam, lift = s.foil?.lift ?? 0;
  const [main, ...floats] = HULLS.foiler(s);
  const lines = hullOf(parts, main), t = (z: number): number => z / L + 0.5;
  const floatLines = floats.map((f) => hullOf(parts, f));
  // The beams, arched over the water, and the trampolines between them.
  const beams = parts.on(BOAT_FINISH.livery), fore = 0.12 * L, aft = -0.17 * L;
  for (const [k, f] of floats.entries()) {
    const side = Math.sign(f.x), fl = floatLines[k], ft = (z: number): number => (z - f.z) / f.length + 0.5;
    for (const z of [fore, aft]) {
      const a: Vec3 = [side * lines.half(t(z)) * 0.8, lines.free(t(z)) * 0.9, z], b: Vec3 = [f.x, fl.free(ft(z)) * 0.95, z];
      const arch: Vec3[] = [0, 0.25, 0.5, 0.75, 1].map((q) => [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q + 0.045 * L * Math.sin(Math.PI * q), z]);
      tubeOf(beams, arch, 0.013 * L, LOOK.white);
    }
    const inner = lines.half(t(0)) * 0.9, outer = Math.abs(f.x) - f.beam * 0.45, y = (lines.free(0.5) + fl.free(0.5)) / 2 + 0.03 * L;
    parts.on(BOAT_FINISH.matte).box([side * (inner + outer) / 2, y, (fore + aft) / 2], [(outer - inner) / 2, 0.012, (fore - aft) / 2 - 0.013 * L], LOOK.net);
    // An L-foil under each float, its tip turned in.
    foilOf(parts, f.x, 0.06 * L, -f.draft * 0.5, -lift - 0.04 * L, 0.04 * L, 0.1 * B, -side);
    lightAt(parts, [f.x, fl.free(1), f.z + f.length / 2 - 0.02], side > 0 ? LOOK.port : LOOK.starboard);
  }
  // The T-foil under the main hull, the rudder's.
  foilOf(parts, 0, 0.04 * L, -main.draft * 0.5, -lift - 0.06 * L, 0.045 * L, 0.24 * B);
  foilOf(parts, 0, -0.5 * L - 0.02 * L, lines.free(0), -lift - 0.05 * L, 0.035 * L, 0.15 * B);
  // The cockpit under a low glass canopy, aft of the wing.
  canopyOf(parts.on(BOAT_FINISH.glass), { x: 0, base: lines.deck(t(-0.25 * L), 0) - 0.02, z0: -0.4 * L, z1: -0.12 * L, width: main.beam * 0.78, height: 0.05 * L, square: 2.4 }, LOOK.glass);
  const mast = { x: 0, z: 0.1 * L }, foot = lines.deck(t(mast.z), 0) + 0.06;
  wingOf(parts, mast, foot, s.mast - foot, 0.27 * L, { finish: BOAT_FINISH.gloss, col: LOOK.carbon });
  return [main, ...floats];
}

/** The glass-roofed catamaran (`BOAT_KINDS.cruiser`). */
function cruiser(parts: Parts, s: BoatSpec): Hull[] {
  const L = s.length, B = s.beam, hulls = HULLS.cruiser(s);
  const lines = hulls.map((h) => hullOf(parts, h)), free = lines[0].free(0.5);
  // The bridge deck between the hulls, its deck on top.
  const z0 = -0.36 * L, z1 = 0.22 * L, inner = Math.abs(hulls[0].x), under = free * 0.72, top = free * 1.1;
  parts.on(BOAT_FINISH.livery).box([0, (under + top) / 2, (z0 + z1) / 2], [inner, (top - under) / 2, (z1 - z0) / 2], LOOK.white);
  parts.on(BOAT_FINISH.matte).box([0, top + 0.005, (z0 + z1) / 2 - 0.01], [inner + hulls[0].beam * 0.35, 0.005, (z1 - z0) / 2], LOOK.deck);
  // The net forward between the bows.
  parts.on(BOAT_FINISH.matte).box([0, free * 1.02, (z1 + 0.44 * L) / 2], [inner - hulls[0].beam * 0.4, 0.01, (0.44 * L - z1) / 2], LOOK.net);
  // The deckhouse: glass on white ribs, a spine along its top.
  const house = { x: 0, base: top, z0: -0.3 * L, z1: 0.14 * L, width: 0.62 * B, height: 0.15 * L, square: 3 };
  const roof = canopyOf(parts.on(BOAT_FINISH.glass), house, LOOK.glass);
  const frame = parts.on(BOAT_FINISH.gloss), arc = (q: number): Vec3[] => Array.from({ length: 13 }, (_, k) => roof(q, (k / 12) * Math.PI));
  for (const q of [0.08, 0.27, 0.46, 0.65, 0.84]) tubeOf(frame, arc(q), 0.03, LOOK.composite);
  tubeOf(frame, Array.from({ length: 13 }, (_, k) => roof(0.02 + (k / 12) * 0.96, Math.PI / 2)), 0.035, LOOK.composite);
  // Rails round the bridge deck: posts and a top rail, either side and across the stern.
  const rail = parts.on(BOAT_FINISH.gloss), edge = inner + hulls[0].beam * 0.3, high = 0.65;
  for (const side of [1, -1]) {
    const posts: Vec3[] = [];
    for (let z = z0 + 0.2; z <= z1 - 0.1; z += 1.1) {
      posts.push([side * edge, top + high, z]);
      tubeOf(rail, [[side * edge, top, z], [side * edge, top + high, z]], 0.014, LOOK.metal);
    }
    tubeOf(rail, posts, 0.012, LOOK.metal);
  }
  // Daggerboards and rudders under each hull; lights at the bows.
  for (const [k, h] of hulls.entries()) {
    foilOf(parts, h.x, 0.05 * L, -h.draft * 0.5, -h.draft - 0.08 * L, 0.06 * L);
    foilOf(parts, h.x, -0.46 * L, -h.draft * 0.3, -h.draft - 0.05 * L, 0.05 * L);
    lightAt(parts, [h.x, lines[k].free(1), L / 2 - 0.02], h.x > 0 ? LOOK.port : LOOK.starboard);
  }
  // The wing on a short mast stub above the roof.
  const mast = { x: 0, z: 0.18 * L }, foot = top + house.height + 0.35;
  parts.on(BOAT_FINISH.gloss).prism([0, top, mast.z], [1, 0, 0], [0, 0, -1], [0, 1, 0], 0.012 * L, foot - top, 10, LOOK.composite);
  wingOf(parts, mast, foot, s.mast - foot, 0.24 * L, { finish: BOAT_FINISH.gloss, col: LOOK.composite });
  return hulls;
}

const BUILDS: Record<BoatKind, (parts: Parts, s: BoatSpec) => Hull[]> = { skiff, foiler, cruiser };

/** The wake of hulls (`BOAT_PART.wake`): a trail behind each and its bow waves out at the Kelvin angle, foam fading to their ends. */
function wakeOf(hulls: readonly Hull[], length: number): BoatMesh {
  const pos: number[] = [], paint: number[] = [], rig: number[] = [], idx: number[] = [];
  /** A strip along its middle line (x, z per step), `width` across it at each step, opacity `alpha` along its middle, fading to nothing at its sides. */
  const foamStrip = (anchor: [number, number], steps: number, mid: (q: number) => [number, number], width: (q: number) => number, alpha: number): void => {
    const base = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const q = i / steps, [x, z] = mid(q), [x1, z1] = mid(Math.min(1, q + 1e-3)), [x0, z0] = mid(Math.max(0, q - 1e-3));
      const dz = z1 - z0, dx = x1 - x0, l = Math.hypot(dx, dz) || 1, ax = -dz / l, az = dx / l, w = width(q) / 2;
      for (const k of [-1, 0, 1]) {
        pos.push(x + ax * w * k, 0.02, z + az * w * k);
        paint.push(242, 245, 247, k === 0 ? Math.round(alpha * 255) : 0);
        rig.push(anchor[0], anchor[1], BOAT_PART.wake, q);
      }
    }
    for (let i = 0; i < steps; i++) for (const k of [0, 1]) {
      const a = base + i * 3 + k;
      idx.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  };
  for (const h of hulls) {
    const stern = h.z - h.length / 2, bow = h.z + h.length / 2, run = TRAIL * length, arm = ARMS * length, share = h.length / length;
    foamStrip([h.x, stern], 12, (q) => [h.x, stern - q * run], (q) => h.beam * (0.7 + 2.2 * q), 0.75 * share);
    for (const side of [1, -1]) {
      const start = h.beam * 0.35;
      foamStrip([h.x, bow], 8, (q) => [h.x + side * (start + Math.tan(KELVIN) * q * (arm + h.length)), bow - q * (arm + h.length)], (q) => 0.04 * length * (0.4 + q), 0.55 * share);
    }
  }
  const n = pos.length / 3;
  return {
    positions: Float32Array.from(pos), normals: Float32Array.from({ length: n * 3 }, (_, k) => (k % 3 === 1 ? 1 : 0)),
    paint: Uint8Array.from(paint), rig: Float32Array.from(rig), index: Uint32Array.from(idx),
  };
}

/** A shape's colours as paint (`BoatMesh`): the colour in bytes, the finish as it is. */
function boatPaint(m: Shape): BoatMesh {
  const c = m.colors, paint = new Uint8Array(c.length);
  for (let i = 0; i < c.length; i += 4) {
    for (let j = 0; j < 3; j++) paint[i + j] = Math.round(Math.min(1, Math.max(0, c[i + j])) * 255);
    paint[i + 3] = c[i + 3];
  }
  return { positions: m.positions, normals: m.normals, paint, rig: m.parts, index: m.index };
}

/** Vertex i of a shape's positions. */
const vertexOf = (p: Float32Array, i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];

/** The mean colour of a shape's wing by area (its far colour). */
function wingColour(m: Shape): Vec3 {
  const sum: Vec3 = [0, 0, 0], c = m.colors;
  let area = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t];
    if (m.parts[a * 4 + 2] !== BOAT_PART.wing || c[a * 4 + 3] === BOAT_FINISH.light) continue;
    const o = vertexOf(m.positions, a), n = v3cross(v3sub(vertexOf(m.positions, m.index[t + 1]), o), v3sub(vertexOf(m.positions, m.index[t + 2]), o));
    const A = Math.hypot(n[0], n[1], n[2]) / 2;
    for (let j = 0; j < 3; j++) sum[j] += A * c[a * 4 + j];
    area += A;
  }
  return area > 0 ? [sum[0] / area, sum[1] / area, sum[2] / area] : [0.5, 0.5, 0.5];
}

/** A design's boat, both levels and its wake (a pure function of its kind). */
export function boatDesign(kind: BoatKind): BoatDesign {
  const spec = BOAT_KINDS[kind], parts = new Parts(), hulls = BUILDS[kind](parts, spec), shape = parts.flat();
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < shape.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], shape.positions[i]); max[i % 3] = Math.max(max[i % 3], shape.positions[i]); }
  const size = Math.max(...max.map((v, k) => v - min[k]));
  return {
    kind, name: kind, body: boatPaint(shape), coarse: boatPaint(simplify(shape, size / COARSE_CELLS)), wake: wakeOf(hulls, spec.length),
    min, max, wing: wingColour(shape),
  };
}

/**
 * Where someone of a boat's crew is aboard, in its frame (x to port, y up from the water, z forward; m): the place
 * their feet are, which way they face (rad from the bow, to port), and how they hold themselves (`POSE` of
 * gen/standIn.ts: 0 upright, 1 kneeling).
 */
export interface Seat {
  x: number;
  y: number;
  z: number;
  facing: number;
  pose: number;
}

/**
 * The places of a design's crew, member k at place k: at rest and on its drive (`still`), and under sail (`sailing`,
 * its x on the windward side, the sign turned there: the skiff's two hike out on the rack, the foiler's kneel out on its
 * windward trampoline). The skiff's sit in its cockpit; the foiler's kneel on its trampolines; aboard the cruiser one
 * stands at the helm aft, eight stand in the glass deckhouse facing each other across it, two on the foredeck and one
 * kneels on the net. Heights from the design's own lines.
 */
export function seatsOf(kind: BoatKind): { still: readonly Seat[]; sailing: readonly Seat[] } {
  const spec = BOAT_KINDS[kind], L = spec.length, B = spec.beam, hulls = HULLS[kind](spec), lines = linesOf(hulls[0]), t = (z: number): number => z / L + 0.5;
  const seat = (x: number, y: number, z: number, facing = 0, pose = 1): Seat => ({ x, y, z, facing, pose });
  if (kind === 'skiff') {
    const sole = lines.deck(t(-0.44 * L), 0) + 0.004, rack = B / 2 - 0.3, inboard = -Math.PI / 3;
    return {
      still: [seat(0, sole, -0.3 * L), seat(0, sole, -0.16 * L)],
      sailing: [-0.3, -0.15].map((k) => seat(rack, lines.free(t(k * L)), k * L, inboard)),
    };
  }
  if (kind === 'foiler') {
    const net = (lines.free(0.5) + linesOf(hulls[1]).free(0.5)) / 2 + 0.03 * L + 0.012;
    return {
      still: [seat(0.2 * B, net, -0.06 * L), seat(-0.2 * B, net, -0.06 * L), seat(0.2 * B, net, -0.13 * L)],
      sailing: [seat(0.25 * B, net, -0.06 * L), seat(0.36 * B, net, -0.1 * L), seat(0.25 * B, net, -0.14 * L)],
    };
  }
  const top = lines.free(0.5) * 1.1 + 0.01, net = lines.free(0.5) * 1.02 + 0.01, across = 0.18 * B, up = 0;
  const all = [
    seat(-0.22 * B, top, -0.33 * L, 0, up),
    ...[-0.24, -0.14, -0.04, 0.06].flatMap((k) => [seat(across, top, k * L, -Math.PI / 2, up), seat(-across, top, k * L, Math.PI / 2, up)]),
    seat(0.14 * B, top, 0.18 * L, 0, up), seat(-0.14 * B, top, 0.18 * L, 0, up),
    seat(0, net, 0.3 * L),
  ];
  return { still: all, sailing: all };
}

/** Bytes a design's meshes hold. */
export const boatBytes = (d: BoatDesign): number => bytesOf([d.body, d.coarse, d.wake].flatMap((m) => Object.values(m) as ArrayBufferView[]));

/** A boat's livery from its seed (a whole number). */
export const liveryOf = (seed: number): RGB => LIVERIES[(seed >>> 0) % LIVERIES.length];
