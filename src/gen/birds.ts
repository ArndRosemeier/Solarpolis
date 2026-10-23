/**
 * The birds of the land (design: thread "Birds in the interior"): what each species is like (size, wings, flight,
 * where it feeds and perches, its song, its looks) and its body, built at two levels for drawing many at once (the
 * BIRD kind, render/birdShaders.ts), each in the bird's own frame: x to its left wing, y up, z forward (beak), one unit
 * from tail tip (z = −0.5) to beak tip (z = +0.5); the instance's scale is the bird's length in metres.
 *
 *   near     the whole bird: a lofted body with its head, eyes and an opening beak; wings of single flight feathers
 *            (secondaries along the arm, primaries fanned from the hand, splayed at the tip in broad-winged birds)
 *            under rows of coverts; a tail of single feathers that fans; legs and toes that tuck away in flight;
 *   coarse   the same bird in a few dozen triangles (ported from Scale's src/fauna/birdMesh.ts: a body of rings, a
 *            tail fan, two-segment wings), the same size, colours and outline, for where it is a few dozen pixels.
 *
 * Every vertex says how it moves (`part`, `fiber`, `folded`): the wings beat about the shoulder with the hand lagging
 * the arm (Scale's flap), fold back along the body when the bird sits, the tail fans, the jaw drops while it sings and
 * the head turns about the neck. Its colour comes per instance from the bird's look, by the zone the vertex is in.
 * Pure: runs in the generation worker.
 */
import { clamp, smoothstep, v3norm, type Vec3 } from '@futuremagic/core';
import { hexColor, packColor } from './standIn';
import { bytesOf, icosphere } from './shapes';

/** The species of the land, in the order of their calls (sim/sounds.ts `CALLS`, files `call/<name>`). */
export const BIRD_KINDS = ['blackbird', 'robin', 'wren', 'thrush', 'woodpecker', 'pigeon', 'lark', 'owl', 'swallow', 'swift', 'starling'] as const;
export type BirdKind = (typeof BIRD_KINDS)[number];

/** Where on the bird a vertex is: what colour of its look it takes (render/birdShaders.ts reads the same numbers). */
export const ZONE = { crown: 0, back: 1, face: 2, breast: 3, belly: 4, coverts: 5, flight: 6, tail: 7, beak: 8, jaw: 9, eye: 10, legs: 11, mark: 12 } as const;
type Zone = (typeof ZONE)[keyof typeof ZONE];
/** Added to a wing vertex's zone: it beats and folds with the wing (a wing takes other zones' colours in its patches). */
export const WING = 16;

/**
 * A pattern over the plumage, drawn per pixel up close: none, spotted breast, fine bars, streaks, owl's mottle, faint
 * scaling, white-barred flight feathers, a starling's pale stars all over.
 */
export const PATTERN = { none: 0, spots: 1, bars: 2, streaks: 3, mottle: 4, scaled: 5, barredWings: 6, starry: 7 } as const;

/** A look (sRGB hex per zone): a sex or a colour morph. */
export interface BirdLook {
  crown: string; back: string; coverts: string; flight: string;
  face: string; breast: string; belly: string; mark: string;
  beak: string; legs: string;
  pattern: number;
  /** How glossy its dark feathers are (0 matt … 1): a sheen along its outline, steel blue, or a starling's purple and green. */
  gloss: number;
}

/**
 * What a species is like. Shape numbers are shares of its length (beak tip to tail tip); how it flies: wingbeats a
 * second in level flight under a full g in the floor's air, and how it flies between beats (`flight`): `flap` (beats
 * on), `glide` (beats and glides), `bound` (bursts of beats and closed-wing bounds, a woodpecker's).
 */
export interface BirdSpec {
  /** Length (m) and wingspan (m). */
  length: number;
  span: number;
  /** Wingbeats a second (1 g, floor air) and cruising speed (m/s). */
  beat: number;
  cruise: number;
  flight: 'flap' | 'glide' | 'bound';
  /** Body fullness (1 a thrush's), head radius, beak length and depth, tail length and width, legs below the belly. */
  girth: number;
  head: number;
  beak: [number, number];
  tail: [number, number];
  legs: number;
  /** The inner wing's chord; how pointed the wing is (0 rounded … 1 pointed) and how far its tip feathers splay (0 … 1). */
  chord: number;
  tip: number;
  fingers: number;
  /** A crest on the crown (0 … 1), the tail cocked up (rad), the body raised nose up when it sits (rad). */
  crest: number;
  cock: number;
  stance: number;
  /** Where it feeds: on the ground, in low bushes, or up in trees; where it perches to sing: tree tops or bush tops. */
  forage: 'ground' | 'bush' | 'tree';
  perch: 'top' | 'bush';
  /** Out by day or by night. */
  night: boolean;
  /** Its song: how long one lasts and how long from one to the next while it sings (s). */
  song: [number, number];
  /** Which patches of the plumage take another zone's colour: shoulder patches, wing bars, vent, neck patches. */
  marks: { shoulder?: Zone; wingbar?: Zone; vent?: Zone; neck?: Zone };
  /** Its looks and how common each is. */
  looks: readonly [BirdLook, number][];
  /**
   * The tail's fork: how much longer its outer feathers are than its middle ones (a share of the tail), and whether only
   * the outermost pair is drawn out into streamers (a swallow's). The arm's share of the half wing (a swift's is short,
   * its hand long). Absent: a square tail, the arm 0.45 of the wing.
   */
  fork?: number;
  streamers?: boolean;
  arm?: number;
}

const look = (c: Omit<BirdLook, 'pattern' | 'gloss'>, pattern = 0, gloss = 0): BirdLook => ({ ...c, pattern, gloss });

/** The species (sizes and beats from field guides; looks from life). */
export const BIRDS: Readonly<Record<BirdKind, BirdSpec>> = {
  blackbird: {
    length: 0.25, span: 0.36, beat: 11, cruise: 9, flight: 'glide', girth: 1, head: 0.085, beak: [0.085, 0.035], tail: [0.4, 0.13], legs: 0.15,
    chord: 0.27, tip: 0.3, fingers: 0.1, crest: 0, cock: 0.08, stance: 0.45, forage: 'ground', perch: 'top', night: false, song: [6.5, 13], marks: {},
    looks: [
      [look({ crown: '#17171a', back: '#1b1b1e', coverts: '#1d1d20', flight: '#121214', face: '#1a1a1c', breast: '#1c1c1e', belly: '#202022', mark: '#1c1c1e', beak: '#e09a1c', legs: '#4a3a2a' }, PATTERN.none, 0.6), 0.5],
      [look({ crown: '#4b3b2b', back: '#4e3d2c', coverts: '#4a3a2a', flight: '#3a2e24', face: '#5a4634', breast: '#6b5440', belly: '#5d4a38', mark: '#5a4634', beak: '#8a6a2a', legs: '#4a3a2a' }, PATTERN.scaled), 0.5],
    ],
  },
  robin: {
    length: 0.14, span: 0.21, beat: 14, cruise: 7, flight: 'flap', girth: 1.25, head: 0.1, beak: [0.075, 0.035], tail: [0.36, 0.12], legs: 0.19,
    chord: 0.27, tip: 0.2, fingers: 0.05, crest: 0, cock: 0.12, stance: 0.6, forage: 'ground', perch: 'top', night: false, song: [5.3, 10], marks: {},
    looks: [[look({ crown: '#6f6249', back: '#74664c', coverts: '#6e6048', flight: '#4f4636', face: '#cf5e28', breast: '#d66a30', belly: '#e6e0d4', mark: '#9aa0a2', beak: '#2a2622', legs: '#6a5848' }), 1]],
  },
  wren: {
    length: 0.095, span: 0.15, beat: 22, cruise: 5, flight: 'flap', girth: 1.3, head: 0.11, beak: [0.12, 0.03], tail: [0.28, 0.1], legs: 0.17,
    chord: 0.27, tip: 0.05, fingers: 0.05, crest: 0, cock: 0.75, stance: 0.35, forage: 'bush', perch: 'bush', night: false, song: [3.8, 10], marks: {},
    looks: [[look({ crown: '#6e4e32', back: '#75553a', coverts: '#6c4c32', flight: '#5a4030', face: '#a88a68', breast: '#b49674', belly: '#9c7c5c', mark: '#c8b090', beak: '#4a3a2c', legs: '#8a6a50' }, PATTERN.bars), 1]],
  },
  thrush: {
    length: 0.22, span: 0.34, beat: 11, cruise: 10, flight: 'glide', girth: 1.05, head: 0.085, beak: [0.085, 0.035], tail: [0.35, 0.13], legs: 0.15,
    chord: 0.27, tip: 0.4, fingers: 0.05, crest: 0, cock: 0.05, stance: 0.45, forage: 'ground', perch: 'top', night: false, song: [9.2, 14], marks: {},
    looks: [[look({ crown: '#7a5e40', back: '#7e6244', coverts: '#7a5e42', flight: '#604a36', face: '#c8aa80', breast: '#ead6b0', belly: '#f0e6d2', mark: '#c8aa80', beak: '#4a3a2a', legs: '#c8a890' }, PATTERN.spots), 1]],
  },
  woodpecker: {
    length: 0.23, span: 0.38, beat: 10, cruise: 9, flight: 'bound', girth: 0.95, head: 0.085, beak: [0.13, 0.035], tail: [0.37, 0.12], legs: 0.09,
    chord: 0.28, tip: 0.3, fingers: 0.15, crest: 0, cock: -0.1, stance: 0.9, forage: 'tree', perch: 'top', night: false, song: [2.8, 25],
    marks: { shoulder: ZONE.belly, vent: ZONE.mark },
    looks: [[look({ crown: '#121212', back: '#141414', coverts: '#151515', flight: '#161616', face: '#ece8e0', breast: '#e8e2d6', belly: '#e2dccf', mark: '#c41e28', beak: '#2a2a2a', legs: '#5a5a5a' }, PATTERN.barredWings), 1]],
  },
  pigeon: {
    length: 0.41, span: 0.75, beat: 6, cruise: 14, flight: 'glide', girth: 1.15, head: 0.065, beak: [0.05, 0.025], tail: [0.36, 0.14], legs: 0.08,
    chord: 0.3, tip: 0.6, fingers: 0.2, crest: 0, cock: 0, stance: 0.25, forage: 'ground', perch: 'top', night: false, song: [6.6, 20],
    marks: { neck: ZONE.mark, wingbar: ZONE.mark },
    looks: [[look({ crown: '#8c919e', back: '#8a8e98', coverts: '#9298a4', flight: '#4c5058', face: '#8e93a0', breast: '#b4979c', belly: '#a8acb4', mark: '#f0f0ee', beak: '#d8a060', legs: '#c06070' }), 1]],
  },
  lark: {
    length: 0.18, span: 0.32, beat: 12, cruise: 8, flight: 'glide', girth: 0.95, head: 0.085, beak: [0.075, 0.035], tail: [0.37, 0.12], legs: 0.13,
    chord: 0.3, tip: 0.5, fingers: 0.05, crest: 0.5, cock: 0, stance: 0.25, forage: 'ground', perch: 'top', night: false, song: [5, 5.5], marks: {},
    looks: [[look({ crown: '#8a6c4a', back: '#92764f', coverts: '#8c704c', flight: '#5c4a36', face: '#c4ad88', breast: '#d8c4a0', belly: '#ece2cc', mark: '#c4ad88', beak: '#8a7058', legs: '#b89070' }, PATTERN.streaks), 1]],
  },
  owl: {
    length: 0.38, span: 0.95, beat: 5, cruise: 6, flight: 'glide', girth: 1.35, head: 0.15, beak: [0.05, 0.04], tail: [0.27, 0.16], legs: 0.1,
    chord: 0.38, tip: 0, fingers: 0.6, crest: 0, cock: 0, stance: 1.1, forage: 'tree', perch: 'top', night: true, song: [3, 30], marks: {},
    looks: [
      [look({ crown: '#6e4a2c', back: '#73502f', coverts: '#7a5634', flight: '#5e4228', face: '#b08a60', breast: '#a07c56', belly: '#b89670', mark: '#3a2a1c', beak: '#c8b070', legs: '#b09a78' }, PATTERN.mottle), 0.7],
      [look({ crown: '#6a645c', back: '#706a60', coverts: '#78716a', flight: '#5a544c', face: '#a89e90', breast: '#9a9286', belly: '#b0a89a', mark: '#3a3630', beak: '#c8b070', legs: '#b0a89a' }, PATTERN.mottle), 0.3],
    ],
  },
  swallow: {
    length: 0.15, span: 0.33, beat: 7, cruise: 9, flight: 'glide', girth: 0.85, head: 0.1, beak: [0.04, 0.035], tail: [0.32, 0.11], legs: 0.07,
    chord: 0.22, tip: 0.85, fingers: 0, crest: 0, cock: 0, stance: 0.2, forage: 'ground', perch: 'top', night: false, song: [2.6, 9], marks: {},
    fork: 0.9, streamers: true, arm: 0.35,
    looks: [[look({ crown: '#1e2c4e', back: '#1d2a4a', coverts: '#1f2b48', flight: '#171c28', face: '#8c2c1c', breast: '#ead8b8', belly: '#f2e6cc', mark: '#1d2a4a', beak: '#16161a', legs: '#2a2420' }, PATTERN.none, 0.9), 1]],
  },
  swift: {
    length: 0.17, span: 0.42, beat: 7, cruise: 11, flight: 'glide', girth: 0.9, head: 0.1, beak: [0.03, 0.03], tail: [0.33, 0.1], legs: 0.03,
    chord: 0.15, tip: 1, fingers: 0, crest: 0, cock: 0, stance: 0.1, forage: 'ground', perch: 'top', night: false, song: [1.6, 6], marks: {},
    fork: 0.35, arm: 0.2,
    looks: [[look({ crown: '#2c2824', back: '#2a2622', coverts: '#2e2a26', flight: '#24211e', face: '#8e877e', breast: '#2e2a26', belly: '#2c2824', mark: '#2c2824', beak: '#141414', legs: '#2a2a2a' }, PATTERN.none, 0.25), 1]],
  },
  starling: {
    length: 0.21, span: 0.39, beat: 10, cruise: 13, flight: 'glide', girth: 1, head: 0.08, beak: [0.11, 0.03], tail: [0.27, 0.12], legs: 0.14,
    chord: 0.25, tip: 0.6, fingers: 0, crest: 0, cock: 0, stance: 0.35, forage: 'ground', perch: 'top', night: false, song: [4, 12], marks: {},
    looks: [
      [look({ crown: '#1c1d22', back: '#1e2026', coverts: '#22242a', flight: '#191a1f', face: '#202227', breast: '#1e2025', belly: '#222428', mark: '#e6d8b8', beak: '#2e2a26', legs: '#8a5a48' }, PATTERN.starry, 0.85), 0.6],
      [look({ crown: '#191a1e', back: '#1b1d22', coverts: '#202228', flight: '#17181d', face: '#1d1f24', breast: '#1b1d22', belly: '#1f2125', mark: '#d8c8a4', beak: '#d8b03a', legs: '#9a6650' }, PATTERN.starry, 1), 0.4],
    ],
  },
};

/** A built body's arrays (the BIRD kind's attributes). */
export interface BirdMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Where the vertex lies with the wings folded (as `positions` off the wings). */
  folded: Float32Array;
  /**
   * zone (on a wing, + `WING`); then per part: wings: the shoulder's x, the elbow's x, the shoulder's y; tail: its feather's share across
   * the fan (−1 … 1), the rump's y and z; legs: the hip's y and z; the jaw: its hinge's y and z.
   */
  part: Float32Array;
  /** How much it turns with the head (0 … 1), the neck's y and z; on a feather: across it (−1 … 1), along it (0 … 1). */
  fiber: Float32Array;
  index: Uint32Array;
}

/** A species' body at both levels, and its measures in shares of its length. */
export interface BirdBody {
  kind: BirdKind;
  near: BirdMesh;
  coarse: BirdMesh;
  /** How far below its origin its soles are (sitting or standing), and its half wingspan. */
  stand: number;
  halfSpan: number;
}

/** Bytes a body holds. */
export const bodyBytes = (b: BirdBody): number => bytesOf([b.near, b.coarse].flatMap((m) => [m.positions, m.normals, m.folded, m.part, m.fiber, m.index]));

/** A mesh as it is built. */
class Built {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly f: number[] = [];
  readonly part: number[] = [];
  readonly fiber: number[] = [];
  readonly index: number[] = [];

  vert(p: Vec3, n: Vec3, part: readonly number[], fiber: readonly number[] = [0, 0, 0, 0], folded: Vec3 = p): number {
    this.p.push(...p);
    this.n.push(...v3norm(n));
    this.f.push(...folded);
    this.part.push(part[0], part[1] ?? 0, part[2] ?? 0, part[3] ?? 0);
    this.fiber.push(fiber[0], fiber[1] ?? 0, fiber[2] ?? 0, fiber[3] ?? 0);
    return this.p.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.index.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  done(): BirdMesh {
    return {
      positions: Float32Array.from(this.p), normals: Float32Array.from(this.n), folded: Float32Array.from(this.f),
      part: Float32Array.from(this.part), fiber: Float32Array.from(this.fiber), index: Uint32Array.from(this.index),
    };
  }
}

/** The body plan of a species: where its parts are, in shares of its length. */
interface Plan {
  spec: BirdSpec;
  g: number;
  /** Rump, neck, head centre (z) and the head's height (y); the beak's base (z). */
  zRump: number;
  zNeck: number;
  zHead: number;
  yHead: number;
  zBeak: number;
  /** The shoulder (x, y, z), the elbow's x, the wing's half span (x of the tip). */
  xs: number;
  ys: number;
  zs: number;
  xe: number;
  hs: number;
  /** How far back the folded wing's tips lie from the shoulder. */
  foldLen: number;
}

function planOf(spec: BirdSpec): Plan {
  const zBeak = 0.5 - spec.beak[0], zHead = zBeak - spec.head * 0.93, zNeck = zHead - spec.head * 1.05;
  const zRump = -0.5 + spec.tail[0], hs = spec.span / (2 * spec.length);
  const xs = 0.095 * spec.girth, zs = zNeck - 0.08, xe = xs + (spec.arm ?? 0.45) * (hs - xs);
  return {
    spec, g: spec.girth, zRump, zNeck, zHead, yHead: 0.06 + spec.head * 0.3, zBeak, xs, ys: 0.05 + 0.02 * spec.girth, zs, xe, hs,
    foldLen: (zs - zRump) * (0.85 + 0.35 * spec.tip),
  };
}

/** The body's cross-section at u (0 the rump … 1 the neck): half width, half height and the centre's height. */
function sectionAt(q: Plan, u: number): { rx: number; ry: number; yc: number } {
  const p = Math.pow(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), 0.75)), 0.7);
  const rx = Math.max(0.035 * q.g, 0.12 * q.g * p), ry = Math.max(0.03 * q.g, 0.112 * q.g * p);
  return { rx, ry, yc: -0.015 * p + 0.03 * u };
}

/** Where a wing vertex at (x, y, z) of the spread wing (x ≥ 0) lies with the wing folded along the body. */
function foldedAt(q: Plan, side: number, x: number, y: number, z: number, layer: number): Vec3 {
  const t = clamp((x - q.xs) / (q.hs - q.xs), 0, 1), half = sectionAt(q, 0.7).rx;
  return [side * (half * (1.02 - 0.3 * t) + layer * 0.0015), q.ys - 0.01 - 0.05 * t + (y - q.ys), q.zs - 0.03 - t * q.foldLen + (z - q.zs) * 0.3];
}

/** A species' body at both levels. */
export function birdBody(kind: BirdKind): BirdBody {
  const spec = BIRDS[kind], q = planOf(spec);
  const near = new Built(), coarse = new Built();
  body(near, q, 12, false);
  body(coarse, q, 4, true);
  for (const side of [1, -1]) {
    wing(near, q, side, false);
    wing(coarse, q, side, true);
  }
  tail(near, q, kind === 'pigeon' || kind === 'owl' ? 12 : 10);
  tail(coarse, q, 1);
  beak(near, q, 8);
  beak(coarse, q, 2);
  eyes(near, q);
  const foot = legs(near, q);
  return { kind, near: near.done(), coarse: coarse.done(), stand: -foot, halfSpan: q.hs };
}

/** Where a species' feet are from its origin, sitting or standing (shares of its length): how far below, how far forward. */
export function feetOf(kind: BirdKind): { stand: number; hip: number } {
  const q = planOf(BIRDS[kind]);
  return { stand: -soleOf(q), hip: hipOf(q) };
}

/** How far forward the legs are (z). */
const hipOf = (q: Plan): number => q.zRump + (q.zNeck - q.zRump) * 0.55;

/** The soles' height (shares of length; negative, below the origin): under the belly by the legs' length. */
function soleOf(q: Plan): number {
  const mid = sectionAt(q, 0.55);
  return mid.yc - mid.ry - q.spec.legs;
}

/** How much a point turns with the head (by how far forward of the neck it is). */
const headShare = (q: Plan, z: number): number => smoothstep(q.zNeck - 0.02, q.zNeck + 0.04, z);

/**
 * The body and head: rings lofted from the rump to the beak's base, `around` vertices each (from the top, over the
 * left side). Zones by where a vertex is: crown and face on the head, back above, breast before the belly below.
 */
function body(b: Built, q: Plan, around: number, plain: boolean): void {
  const rings: { z: number; rx: number; ry: number; yc: number; top: number }[] = [];
  const stations = plain ? [0, 0.35, 0.75] : [0, 0.1, 0.24, 0.4, 0.56, 0.72, 0.86];
  for (const u of stations) rings.push({ z: q.zRump + (q.zNeck - q.zRump) * u, ...sectionAt(q, u), top: 0 });
  const neck = q.spec.head * 0.82;
  rings.push({ z: q.zNeck, rx: neck, ry: neck, yc: q.yHead - 0.02, top: 0 });
  const hr = q.spec.head, angles = plain ? [100, 45] : [150, 122, 95, 70, 48, 30];
  for (const a of angles) {
    const phi = (a * Math.PI) / 180, crest = q.spec.crest * hr * 0.6 * Math.max(0, Math.sin(phi * 2 - 0.6));
    rings.push({ z: q.zHead + hr * Math.cos(phi), rx: hr * Math.sin(phi), ry: hr * Math.sin(phi) * 0.95, yc: q.yHead, top: crest });
  }
  rings.push({ z: q.zBeak, rx: q.spec.beak[1] * 0.55, ry: q.spec.beak[1] * 0.5, yc: q.yHead - hr * 0.12, top: 0 });
  const index: number[][] = [];
  rings.forEach((r, k) => {
    const prev = rings[Math.max(0, k - 1)], next = rings[Math.min(rings.length - 1, k + 1)];
    const slope = -((next.rx + next.ry) - (prev.rx + prev.ry)) / 2 / Math.max(1e-4, next.z - prev.z);
    const row: number[] = [];
    for (let i = 0; i < around; i++) {
      const a = (2 * Math.PI * i) / around, sx = Math.sin(a), cy = Math.cos(a);
      const lift = cy > 0 ? r.top * cy : 0;
      const p: Vec3 = [r.rx * sx, r.yc + (r.ry + lift) * cy, r.z];
      const n: Vec3 = [sx / Math.max(r.rx, 1e-4), cy / Math.max(r.ry, 1e-4), 0], l = Math.hypot(n[0], n[1]);
      const head = headShare(q, r.z);
      row.push(b.vert(p, [n[0] / l, n[1] / l, clamp(slope, -3, 3)], [zoneOf(q, r.z, sx, cy)], [head, q.yHead - 0.02, q.zNeck, 0]));
    }
    index.push(row);
  });
  for (let k = 0; k + 1 < index.length; k++) for (let i = 0; i < around; i++) {
    const j = (i + 1) % around;
    b.quad(index[k][i], index[k + 1][i], index[k + 1][j], index[k][j]);
  }
  // The rump closed at a point.
  const r0 = rings[0], cap = b.vert([0, r0.yc, r0.z - 0.012], [0, 0, -1], [ZONE.back]);
  for (let i = 0; i < around; i++) b.tri(cap, index[0][i], index[0][(i + 1) % around]);
}

/** The zone of a body vertex at z, sx = sin and cy = cos of its angle round the ring (from the top). */
function zoneOf(q: Plan, z: number, sx: number, cy: number): Zone {
  const m = q.spec.marks;
  if (z > q.zNeck + 0.01) return cy > 0.15 ? ZONE.crown : ZONE.face;
  if (m.neck !== undefined && Math.abs(z - q.zNeck) < 0.05 && Math.abs(sx) > 0.6 && cy > -0.2 && cy < 0.7) return m.neck;
  if (z > q.zNeck - 0.01) return cy > 0.1 ? ZONE.back : ZONE.face;
  if (cy > 0.05) return ZONE.back;
  if (m.vent !== undefined && z < q.zRump + 0.1) return m.vent;
  return z > q.zRump + (q.zNeck - q.zRump) * 0.55 ? ZONE.breast : ZONE.belly;
}

/**
 * One wing (side +1 the left, x > 0), spread flat at the shoulder's height. Near: a row of secondaries along the arm,
 * ten primaries fanned from the hand (the tip pointed or rounded as the species' wing is, the outer ones narrowing to
 * fingers where they splay), coverts over their bases. Coarse: Scale's two quads, arm and hand.
 */
function wing(b: Built, q: Plan, side: number, plain: boolean): void {
  const s = q.spec, part = (zone: Zone): number[] => [WING + zone, q.xs, q.xe, q.ys];
  const at = (x: number, y: number, z: number, zone: Zone, fiber: number[], layer: number, n: Vec3 = [0, 1, 0]): number =>
    b.vert([side * x, y, z], [side * n[0], n[1], n[2]], part(zone), fiber, foldedAt(q, side, x, y, z, layer));
  const c = s.chord;
  if (plain) {
    // Scale's wing: the arm from the shoulder to the elbow, the hand swept back to the tip.
    const y = q.ys;
    const r0 = at(q.xs, y, q.zs + 0.02, ZONE.coverts, [0], 0), r1 = at(q.xs, y, q.zs - c, ZONE.coverts, [0], 0);
    const e0 = at(q.xe, y, q.zs + 0.01, ZONE.coverts, [0], 1), e1 = at(q.xe, y, q.zs - c * 1.05, ZONE.coverts, [0], 1);
    const f0 = at(q.xe, y, q.zs + 0.01, ZONE.flight, [0], 1), f1 = at(q.xe, y, q.zs - c * 1.05, ZONE.flight, [0], 1);
    const t0 = at(q.hs, y, q.zs - c * (0.35 + 0.3 * s.tip), ZONE.flight, [0], 2), t1 = at(q.hs - c * 0.25 * (1 - s.tip), y, q.zs - c * (0.85 + 0.2 * s.tip), ZONE.flight, [0], 2);
    if (side > 0) { b.quad(r0, e0, e1, r1); b.quad(f0, t0, t1, f1); } else { b.quad(r0, r1, e1, e0); b.quad(f0, f1, t1, t0); }
    return;
  }
  // A feather: from its base along `dir` (in the wing's plane, x out, z forward), `len` long, `width` wide at its
  // middle, narrowing to `tipWidth` of that; 3 × 3 vertices so its shaft and its curve show.
  const feather = (bx: number, bz: number, dir: number, len: number, width: number, tipWidth: number, y: number, zone: Zone, layer: number): void => {
    const dx = Math.cos(dir), dz = Math.sin(dir), ax = -dz, az = dx;
    const rows: number[][] = [];
    for (const [k, along] of [0, 0.55, 1].entries()) {
      const w = width * [0.75, 1, tipWidth][k] / 2, bend = -0.08 * len * along * along;
      const row: number[] = [];
      for (const across of [-1, 0, 1]) {
        const x = bx + dx * len * along + ax * w * across, z = bz + dz * len * along + az * w * across;
        row.push(at(x, y + bend * 0.15 + (across === 0 ? 0.002 * len : 0), z, zone, [0, across, along], layer, [0, 1, 0]));
      }
      rows.push(row);
    }
    for (let k = 0; k < 2; k++) for (let i = 0; i < 2; i++) {
      if (side > 0) b.quad(rows[k][i], rows[k][i + 1], rows[k + 1][i + 1], rows[k + 1][i]);
      else b.quad(rows[k][i], rows[k + 1][i], rows[k + 1][i + 1], rows[k][i + 1]);
    }
  };
  const ys = q.ys, armLen = q.xe - q.xs, handLen = q.hs - q.xe;
  // Secondaries (and the tertials over the body): along the arm, pointing back, a little out toward the hand.
  const n2 = 9;
  for (let i = 0; i < n2; i++) {
    const u = (i + 0.5) / n2, x = q.xs + armLen * u;
    feather(x, q.zs - 0.015, -Math.PI / 2 + 0.12 * u, c * (1.02 - 0.08 * u), (armLen / n2) * 1.7, 0.85, ys - 0.0012 * (n2 - i), ZONE.flight, i);
  }
  // Primaries: fanned from the hand, inner ones back, outer ones out; scaled so the longest reaches the wing tip.
  const n1 = 10, raw: { x: number; z: number; dir: number; len: number }[] = [];
  for (let i = 0; i < n1; i++) {
    const u = i / (n1 - 1), x = q.xe + 0.12 * handLen * u, z = q.zs - 0.01 - 0.02 * u;
    const dir = -(1.35 - (1.35 - 0.22 - 0.2 * (1 - s.tip)) * Math.pow(u, 0.9));
    const len = s.tip * (0.6 + 0.4 * u) + (1 - s.tip) * (0.62 + 0.38 * Math.sin(Math.PI * (0.25 + 0.6 * u)));
    raw.push({ x, z, dir, len });
  }
  const reach = Math.max(...raw.map((p) => (p.len * Math.cos(p.dir)) / Math.max(1e-3, q.hs - p.x)));
  raw.forEach((p, i) => {
    const u = i / (n1 - 1), finger = 1 - s.fingers * 0.65 * smoothstep(0.4, 1, u);
    feather(p.x, p.z, p.dir, p.len / reach, c * 0.3 * (1 - 0.25 * u), 0.7 * finger, ys - 0.012 - 0.0012 * i, ZONE.flight, n2 + i);
  });
  // Coverts over the feathers' bases: lesser and greater rows, from the shoulder out over the hand's base.
  const cols = 7, rows = 3, outTo = q.xe + 0.3 * handLen, grid: number[][] = [];
  for (let k = 0; k <= rows; k++) {
    const row: number[] = [];
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, x = q.xs + (outTo - q.xs) * u, chordHere = c * (0.5 - 0.15 * smoothstep(0.6, 1, u)), v = k / rows;
      const z = q.zs + 0.015 * (1 - v) - chordHere * v;
      const zone = q.spec.marks.shoulder !== undefined && u < 0.4 && v < 0.8 ? q.spec.marks.shoulder
        : q.spec.marks.wingbar !== undefined && Math.abs(u - 0.62) < 0.1 && v > 0.3 ? q.spec.marks.wingbar : ZONE.coverts;
      row.push(at(x, ys + 0.004 - 0.003 * v, z, zone, [0, 0, v], 30));
    }
    grid.push(row);
  }
  for (let k = 0; k < rows; k++) for (let i = 0; i < cols; i++) {
    if (side > 0) b.quad(grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]);
    else b.quad(grid[k][i], grid[k + 1][i], grid[k + 1][i + 1], grid[k][i + 1]);
  }
}

/** The tail: `count` feathers fanned from the rump, closed (they fan out in the shader), cocked up as the species holds it. */
function tail(b: Built, q: Plan, count: number): void {
  const s = q.spec, base: Vec3 = [0, sectionAt(q, 0).yc + 0.01, q.zRump + 0.02], len = s.tail[0] + 0.02;
  const cc = Math.cos(s.cock), sc = Math.sin(s.cock);
  const turn = (x: number, along: number): Vec3 => [x, base[1] + along * sc, base[2] - along * cc];
  const normal: Vec3 = [0, cc, sc];
  const fork = s.fork ?? 0;
  if (count === 1) {
    // Scale's tail fan: one quad; a forked tail notched in the middle, its outer corners drawn out.
    const w = s.tail[1] / 2, tipW = s.streamers ? w * 0.75 : w, part = (share: number): number[] => [ZONE.tail, share, base[1], base[2]];
    const a = b.vert(turn(-w * 0.35, 0), normal, part(0)), c = b.vert(turn(w * 0.35, 0), normal, part(0));
    const d = b.vert(turn(tipW, len * (1 + fork)), normal, part(1)), e = b.vert(turn(-tipW, len * (1 + fork)), normal, part(-1));
    if (fork <= 0) { b.quad(a, c, d, e); return; }
    const m = b.vert(turn(0, len * (1 - 0.35 * Math.min(1, fork))), normal, part(0));
    b.tri(a, c, m); b.tri(c, d, m); b.tri(a, m, e);
    return;
  }
  const half = Math.atan((s.tail[1] * 0.5) / len) * 0.75;
  for (let k = 0; k < count; k++) {
    // A forked tail's outer feathers are longer (a swallow's outermost pair drawn out into streamers).
    const share = (2 * k) / (count - 1) - 1, out = Math.abs(share), longer = fork * (s.streamers ? out ** 8 : out ** 1.5);
    const psi = share * half, l = len * (1 - 0.1 * out * (s.cock > 0.3 ? 2 : 1)) * (1 + longer);
    const w = (s.tail[1] / count) * 1.8 * (s.streamers && out > 0.99 ? 0.6 : 1), dx = Math.sin(psi), dz = Math.cos(psi), y = 0.003 * (1 - out);
    const rows: number[][] = [];
    for (const [i, along] of [0, 0.6, 1].entries()) {
      const width = w * [0.6, 1, 0.75][i] / 2, row: number[] = [];
      for (const across of [-1, 0, 1]) {
        const x = share * 0.012 + dx * l * along + dz * width * across, a = dz * l * along - dx * width * across;
        const p = turn(x, a);
        row.push(b.vert([p[0], p[1] + y, p[2]], normal, [ZONE.tail, share, base[1], base[2]], [0, across, along]));
      }
      rows.push(row);
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) b.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }
}

/** The beak: the upper mandible and the jaw (which drops while the bird sings), each half a cone from the face. */
function beak(b: Built, q: Plan, around: number): void {
  const s = q.spec, yc = q.yHead - s.head * 0.12, rx = s.beak[1] * 0.55, ry = s.beak[1] * 0.5;
  const hinge = [yc, q.zBeak - 0.01], neck = [headShare(q, q.zBeak), q.yHead - 0.02, q.zNeck, 0];
  const tipUp: Vec3 = [0, yc - ry * 0.15, 0.5], tipDown: Vec3 = [0, yc - ry * 0.45, 0.5 - s.beak[0] * 0.08];
  for (const jaw of [false, true]) {
    const zone = jaw ? ZONE.jaw : ZONE.beak, part = [zone, hinge[0], hinge[1], 0];
    const tip = b.vert(jaw ? tipDown : tipUp, [0, jaw ? -0.3 : 0.3, 1], part, neck);
    const ring: number[] = [];
    for (let i = 0; i <= around / 2; i++) {
      const a = (Math.PI * i) / (around / 2) * 0.5 + (jaw ? Math.PI / 2 : -Math.PI / 2), sx = Math.sin(a), cy = Math.cos(a);
      ring.push(b.vert([rx * sx, yc + ry * cy, q.zBeak], [sx, cy, 0.4], part, neck));
    }
    // Both halves: the left and the right side of the mandible.
    for (const mirror of [1, -1]) {
      const side = mirror > 0 ? ring : ring.map((i) => b.vert([-b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]], [-b.n[i * 3], b.n[i * 3 + 1], b.n[i * 3 + 2]], part, neck));
      for (let i = 0; i + 1 < side.length; i++) {
        if ((mirror > 0) !== jaw) b.tri(side[i], side[i + 1], tip);
        else b.tri(side[i + 1], side[i], tip);
      }
    }
  }
}

/** The eyes: a small dark ball each side of the head. */
function eyes(b: Built, q: Plan): void {
  const s = q.spec, r = s.head * (s.night ? 0.3 : 0.2), sphere = icosphere(s.night ? 1 : 0);
  for (const side of [1, -1]) {
    const c: Vec3 = [side * s.head * 0.8, q.yHead + s.head * 0.18, q.zHead + s.head * (s.night ? 0.5 : 0.35)];
    const first = b.p.length / 3;
    for (const v of sphere.verts) b.vert([c[0] + v[0] * r, c[1] + v[1] * r, c[2] + v[2] * r], v, [ZONE.eye], [1, q.yHead - 0.02, q.zNeck, 0]);
    for (const f of sphere.faces) b.tri(first + f[0], first + f[1], first + f[2]);
  }
}

/** The legs and feet: a shank from the belly down, three toes forward and one back. Returns the soles' height. */
function legs(b: Built, q: Plan): number {
  const s = q.spec, mid = sectionAt(q, 0.55), zHip = hipOf(q);
  const top = mid.yc - mid.ry + 0.02, foot = soleOf(q), r = 0.012 * (s.length < 0.15 ? 1.4 : 1);
  const part = [ZONE.legs, top + 0.02, zHip, 0];
  for (const side of [1, -1]) {
    const x = side * 0.04 * q.g;
    const ring = (y: number): number[] => [0, 1, 2, 3].map((i) => {
      const a = (Math.PI / 2) * i, n: Vec3 = [Math.sin(a), 0, Math.cos(a)];
      return b.vert([x + n[0] * r, y, zHip + n[2] * r], n, part);
    });
    const hi = ring(top), lo = ring(foot + r);
    for (let i = 0; i < 4; i++) b.quad(hi[i], lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4]);
    // Toes: flat strips from the foot.
    for (const [dir, length] of [[-0.4, 0.09], [0, 0.11], [0.4, 0.09], [Math.PI, 0.06]] as const) {
      const dx = Math.sin(dir), dz = Math.cos(dir), w = r * 0.8, ax = dz * w, az = -dx * w;
      const a = b.vert([x + ax, foot + r * 0.5, zHip + az], [0, 1, 0], part), c = b.vert([x - ax, foot + r * 0.5, zHip - az], [0, 1, 0], part);
      const d = b.vert([x + dx * length * 0.6 - ax * 0.4, foot, zHip + dz * length * 0.6 - az * 0.4], [0, 1, 0], part);
      const e = b.vert([x + dx * length * 0.6 + ax * 0.4, foot, zHip + dz * length * 0.6 + az * 0.4], [0, 1, 0], part);
      b.quad(a, e, d, c);
    }
  }
  return foot;
}

/** A look's gloss rides in its pattern number's fraction, at most this (so the number rounds down to the pattern). */
export const GLOSS_PACK = 0.45;

/** A bird's look, packed for its instance (sRGB bytes in one float each, `packColor`): ten zones' colours and the pattern. */
export interface PackedLook {
  /** crown, back, coverts, flight; face, breast, belly, mark; beak, legs, pattern. */
  coat: [number, number, number, number];
  front: [number, number, number, number];
  bits: [number, number, number];
  /** Its colour from afar in three bands (head and back, wings, underparts), for its speck. */
  bands: [number, number, number];
}

/** A species' looks packed for drawing. */
export function packedLooks(kind: BirdKind): PackedLook[] {
  return BIRDS[kind].looks.map(([l]) => {
    const c = (hex: string): number => packColor(hexColor(hex));
    const mean = (...hex: string[]): number => packColor([0, 1, 2].map((k) => hex.reduce((s, h) => s + hexColor(h)[k], 0) / hex.length) as Vec3);
    return {
      coat: [c(l.crown), c(l.back), c(l.coverts), c(l.flight)],
      front: [c(l.face), c(l.breast), c(l.belly), c(l.mark)],
      // The pattern's number, its gloss in the fraction (render/birdShaders.ts reads both).
      bits: [c(l.beak), c(l.legs), l.pattern + GLOSS_PACK * clamp(l.gloss, 0, 1)],
      bands: [mean(l.crown, l.back), mean(l.coverts, l.flight, l.back), mean(l.breast, l.belly, l.face)],
    };
  });
}

/** Which of a species' looks a bird with this pick (0 … 1) wears. */
export function lookFor(kind: BirdKind, pick: number): number {
  const looks = BIRDS[kind].looks;
  let acc = 0;
  for (let i = 0; i < looks.length; i++) { acc += looks[i][1]; if (pick < acc) return i; }
  return looks.length - 1;
}
