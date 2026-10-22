/**
 * The assembly pavilion on the ring lake (gen/landmarks.ts places it): the civic centre where the habitat meets for
 * festivals and assemblies, built in the round. From the middle outward:
 *
 * - an open pool of lake water under the roof's wide oculus (a well of daylight over the speaking floor, as in the
 *   Pantheon), so the sunline shines down onto water at the heart of it;
 * - the speaking floor around the pool, in stone;
 * - seating in the round, rows rising outward, cut by four passages (two of them to the bridges) and climbed by four
 *   stairs; on the outside a sloping skirt down to the deck;
 * - the promenade around the seats, with benches facing out over the lake;
 * - a ring of tree-like columns that branch into the roof;
 * - a thin shell roof, highest at the oculus, its eaves overhanging the deck;
 * - piers down to the lake bed, and a bridge to each shore, arched a little over the water.
 *
 * Everything is in the pavilion's own frame: x along the axis (toward the port end), y around (the spin), z up (toward
 * the axis), z = 0 at the water's surface. Every size follows from the deck's radius and the handrail's height
 * (`HabitatParams.landmarks`), so a small habitat's pavilion is small and a large one's large, with steps and seats of
 * human size in all of them.
 *
 * Drawn at three levels (`LANDMARK_LEVELS`): far (the deck, the seats as a cone, the columns, the roof: its outline
 * from across the habitat), mid (the rows and stairs, piers, column capitals, roof edges, the top rails) and near
 * (fluted columns, railings with posts and rails, benches, lamps, the ribs under the roof). Each level is the whole
 * pavilion, finer; the finest parts of each are under a pixel where the next coarser one takes over. `solid` is what
 * the physics stands on and bumps into. Pure.
 */
import { v3cross, v3norm, type Vec3 } from '@futuremagic/core';
import { Shape, type RGB } from './shapes';
import type { Pavilion } from './landmarks';

/**
 * What the surfaces are made of (the BUILT kind reads it, render/materials.ts). `lamp` is a lamp's glowing face,
 * `sky` a light well's glass seen from below, bright with the day above, and `screen` the first of a hamlet's sky
 * screens (`screen + k` shows sky k of gen/skies.ts); only the Understorey's VAULT kind draws those (gen/underMesh.ts).
 */
export const FINISH = { stone: 0, timber: 1, bronze: 2, ceramic: 3, lamp: 4, sky: 5, screen: 6 } as const;

/** The levels every landmark is drawn at (the summit hut's too, gen/summitHut.ts), and `solid` for the physics. */
export const LANDMARK_LEVELS = ['far', 'mid', 'near'] as const;
export type LandmarkLevel = (typeof LANDMARK_LEVELS)[number] | 'solid';

/** Linear albedo of each material. */
const STONE: RGB = [0.52, 0.49, 0.43];
const STONE_DARK: RGB = [0.36, 0.34, 0.3];
const TIMBER: RGB = [0.3, 0.19, 0.11];
const SEAT: RGB = [0.34, 0.22, 0.13];
const BRONZE: RGB = [0.22, 0.15, 0.08];
const ROOF: RGB = [0.62, 0.61, 0.58];
const SOFFIT: RGB = [0.4, 0.27, 0.16];

/** Every size of a pavilion, from its deck radius and the handrail's height. */
export interface PavilionPlan {
  /** The deck's radius and the handrail's height (m). */
  radius: number;
  handrail: number;
  /** The deck's top above the water, and its slab's thickness. */
  deck: number;
  slab: number;
  /** Radii: the open pool, the speaking floor's edge (where the seats begin), the top of the seats, the skirt's foot. */
  pool: number;
  floor: number;
  stand: number;
  skirt: number;
  /** Seat rows, each `riser` high and `tread` deep. */
  rows: number;
  riser: number;
  tread: number;
  /** The columns: their ring's radius, how many, their base radius. */
  ring: number;
  columns: number;
  column: number;
  /** The roof: its eaves' height, its outer radius, the oculus's radius, how much higher it is there, its thickness. */
  eaves: number;
  reach: number;
  oculus: number;
  rise: number;
  shell: number;
  /** Widths: a bridge, a passage through the seats, a stair. */
  bridge: number;
  passage: number;
  stair: number;
  /** Piers: radius and spacing; how deep the lake is under them. */
  pier: number;
  span: number;
  depth: number;
}

export function pavilionPlan(p: Pavilion): PavilionPlan {
  const R = p.radius, hr = p.handrail;
  const pool = R * 0.12, floor = R * 0.26, stand = R * 0.62;
  const riser = hr * 0.4, rows = Math.max(2, Math.floor((stand - floor) / (hr * 0.8)));
  const tread = (stand - floor) / rows, standH = rows * riser;
  const deck = hr * 1.4;
  const ring = R * 0.93;
  const columns = Math.max(8, 4 * Math.round((2 * Math.PI * ring) / Math.max(R * 0.15, hr * 3.5) / 4));
  const bridge = Math.max(hr * 2.6, R * 0.07);
  return {
    radius: R, handrail: hr, deck, slab: Math.max(hr * 0.45, R * 0.006),
    pool, floor, stand, skirt: stand + standH * 0.35, rows, riser, tread,
    ring, columns, column: Math.max(hr * 0.25, R * 0.007),
    eaves: deck + Math.max(R * 0.26, standH + hr * 4), reach: R * 1.06, oculus: R * 0.24, rise: R * 0.2, shell: Math.max(hr * 0.35, R * 0.01),
    bridge, passage: bridge * 1.2, stair: hr * 1.3,
    pier: Math.max(hr * 0.3, R * 0.005), span: Math.max(hr * 6, R * 0.16), depth: p.depth,
  };
}

/** The roof's top at a radius (its underside is `shell` lower): highest at the oculus, curving down to the eaves. */
export function roofAt(q: PavilionPlan, r: number): number {
  const u = Math.min(1, Math.max(0, (r - q.oculus) / (q.reach - q.oculus)));
  return q.eaves + q.rise * Math.pow(1 - u, 1.5);
}

/** A bridge's deck height above the water at a distance x from the centre (from the deck's edge to its far end). */
export function bridgeAt(q: PavilionPlan, b: { from: number; to: number; end: number }, x: number): number {
  const u = Math.min(1, Math.max(0, (x - b.from) / (b.to - b.from)));
  const arch = Math.min(q.handrail * 1.2, (b.to - b.from) * 0.03);
  return q.deck + (b.end - q.deck) * u + arch * Math.sin(Math.PI * u);
}

/** The passages (toward ±x and ±y) and stairs (between them) cut through the seats: their angles. */
const PASSAGES = [0, 0.5, 1, 1.5].map((k) => k * Math.PI);
const STAIR_ANGLES = [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI);
/** The stairs, where the floor's edge leaves room for them between the passages (a small pavilion has none). */
export const stairsOf = (q: PavilionPlan): number[] => ((Math.PI / 4) * q.floor > (q.passage + q.stair) / 2 + q.handrail ? STAIR_ANGLES : []);

/** Segments around a full circle at each level. */
function around(q: PavilionPlan, level: LandmarkLevel): number {
  if (level === 'far') return 48;
  if (level === 'mid' || level === 'solid') return 128;
  return Math.min(512, Math.max(128, 8 * Math.round((2 * Math.PI * q.radius) / q.handrail / 8)));
}

/** A point at radius r and angle a (from +x toward +y), height z. */
export const polar = (r: number, a: number, z: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), z];

/** The pavilion at one level, in its own frame, as a mapped and coloured shape. */
export function buildPavilion(p: Pavilion, level: LandmarkLevel): Shape {
  const q = pavilionPlan(p), n = around(q, level), sh = new Shape(n, true, true);
  const far = level === 'far', near = level === 'near', solid = level === 'solid';
  // Steps for an arc: as many as the level's full circle has, fewer at a smaller radius (the same length each).
  const steps = (a0: number, a1: number, r = q.radius) => Math.max(1, Math.ceil((n * (a1 - a0) * Math.min(1, r / q.radius + 0.15)) / (2 * Math.PI)));
  const set = (f: number) => { sh.finish = f; };

  // The deck: stone around the pool, timber beyond; its edges and underside.
  set(FINISH.stone);
  sh.arc(q.deck, q.floor, q.deck, q.pool, 1, 0, 0, 2 * Math.PI, n, STONE);
  set(FINISH.timber);
  sh.arc(q.deck, q.radius, q.deck, q.floor, 1, 0, 0, 2 * Math.PI, n, TIMBER);
  set(FINISH.stone);
  sh.band(q.deck - q.slab, q.radius, q.deck, q.radius, 0, 1, STONE_DARK);
  sh.band(q.deck, q.pool, q.deck - q.slab, q.pool, 0, -1, STONE_DARK);
  if (!far && !solid) sh.band(q.deck - q.slab, q.pool, q.deck - q.slab, q.radius, -1, 0, STONE_DARK);

  seats(sh, q, level, steps);
  if (!far) piers(sh, q);
  columns(sh, q, level);
  if (!solid) roof(sh, q, level);
  for (const b of p.bridges) bridge(sh, q, b, level);
  if (near || solid) railings(sh, q, p, level);
  else if (level === 'mid') topRails(sh, q, p);
  if (near) { benches(sh, q); lamps(sh, q); }
  return sh;
}

/** The seats: rows rising outward between the passages and stairs, the stairs in their gaps, the skirt outside. */
function seats(sh: Shape, q: PavilionPlan, level: LandmarkLevel, steps: (a0: number, a1: number, r?: number) => number): void {
  const top = q.deck + q.rows * q.riser;
  if (level === 'far') {
    // From afar the rows read as one cone: from the floor's edge up to the top, and the skirt back down.
    const l = Math.hypot(q.stand - q.floor, top - q.deck), k = Math.hypot(q.skirt - q.stand, top - q.deck);
    sh.finish = FINISH.timber;
    sh.band(top, q.stand, q.deck, q.floor, (q.stand - q.floor) / l, -(top - q.deck) / l, SEAT);
    sh.finish = FINISH.stone;
    sh.band(q.deck, q.skirt, top, q.stand, (q.skirt - q.stand) / k, (top - q.deck) / k, STONE);
    return;
  }
  const stairs = stairsOf(q);
  const gaps = [...PASSAGES.map((a) => ({ a, w: q.passage })), ...stairs.map((a) => ({ a, w: q.stair }))].sort((x, y) => x.a - y.a);
  for (let i = 0; i < q.rows; i++) {
    const r0 = q.floor + i * q.tread, r1 = r0 + q.tread, rm = (r0 + r1) / 2;
    const z0 = q.deck + i * q.riser, z1 = z0 + q.riser;
    for (let g = 0; g < gaps.length; g++) {
      const from = gaps[g], to = gaps[(g + 1) % gaps.length];
      const a0 = from.a + from.w / 2 / rm, a1 = (to.a <= from.a ? to.a + 2 * Math.PI : to.a) - to.w / 2 / rm;
      const k = steps(a0, a1, rm);
      // Timber tiers (the far level's cone is timber too), each row's riser down to the deck; stone where they end.
      sh.finish = FINISH.timber;
      sh.arc(z1, r1, z1, r0, 1, 0, a0, a1, k, SEAT);
      sh.arc(z1, r0, q.deck, r0, 0, -1, a0, a1, k, TIMBER);
      sh.finish = FINISH.stone;
      // The row's ends: walls down to the deck (the passage's sides, or the stair's).
      end(sh, a0, -1, [r0, q.deck], [r1, q.deck], [r1, z1], [r0, z1]);
      end(sh, a1, 1, [r0, q.deck], [r1, q.deck], [r1, z1], [r0, z1]);
    }
    // The stairs: two steps to a row.
    for (const s of stairs) {
      const a0 = s - q.stair / 2 / rm, a1 = s + q.stair / 2 / rm;
      for (let j = 0; j < 2; j++) {
        const ra = r0 + (j * q.tread) / 2, rb = ra + q.tread / 2, za = z0 + (j * q.riser) / 2, zb = za + q.riser / 2;
        sh.finish = FINISH.stone;
        sh.arc(zb, rb, zb, ra, 1, 0, a0, a1, 2, STONE);
        sh.arc(zb, ra, za, ra, 0, -1, a0, a1, 2, STONE_DARK);
      }
    }
  }
  // The skirt, from the top row down to the deck, between the passages; its ends against them.
  sh.finish = FINISH.stone;
  for (let g = 0; g < PASSAGES.length; g++) {
    const w = q.passage / 2;
    const a0 = PASSAGES[g] + w / q.stand, a1 = PASSAGES[(g + 1) % 4] + (g === 3 ? 2 * Math.PI : 0) - w / q.stand;
    const l = Math.hypot(q.skirt - q.stand, top - q.deck);
    sh.arc(q.deck, q.skirt, top, q.stand, (q.skirt - q.stand) / l, (top - q.deck) / l, a0, a1, steps(a0, a1), STONE);
    end(sh, a0, -1, [q.stand, q.deck], [q.skirt, q.deck], [q.stand, top], [q.stand, top]);
    end(sh, a1, 1, [q.stand, q.deck], [q.skirt, q.deck], [q.stand, top], [q.stand, top]);
  }
}

/**
 * A flat wall in the plane of the angle `a`, from four (r, z) corners counter-clockwise seen from −θ: facing away from
 * the angles beyond it (`side` −1 faces −θ, +1 faces +θ).
 */
function end(sh: Shape, a: number, side: -1 | 1, ...corners: [number, number][]): void {
  const pts = corners.map(([r, z]) => polar(r, a, z));
  const t: Vec3 = [-Math.sin(a) * side, Math.cos(a) * side, 0];
  if (side < 0) sh.quad(pts[0], pts[1], pts[2], pts[3], t, STONE);
  else sh.quad(pts[3], pts[2], pts[1], pts[0], t, STONE);
}

/** Piers under the deck, in rings, down to the lake bed. */
function piers(sh: Shape, q: PavilionPlan): void {
  sh.finish = FINISH.stone;
  for (const r of [q.radius * 0.95, q.stand, q.radius * 0.3, q.pool * 1.25]) {
    const count = Math.max(6, Math.round((2 * Math.PI * r) / q.span));
    for (let k = 0; k < count; k++) {
      const a = ((k + 0.5) / count) * 2 * Math.PI;
      sh.prism(polar(r, a, -q.depth), [1, 0, 0], [0, 1, 0], [0, 0, 1], q.pier, q.depth + q.deck - q.slab, 8, STONE_DARK);
    }
  }
}

/** The ring of columns: each a tapering shaft that branches into four struts under the roof. */
function columns(sh: Shape, q: PavilionPlan, level: LandmarkLevel): void {
  const under = (r: number) => roofAt(q, r) - q.shell;
  const t = new Shape(8, true, true), r = q.ring, c = q.column, h = under(r) - q.deck;
  t.finish = FINISH.stone;
  if (level === 'far' || level === 'solid') {
    t.prism([r, 0, q.deck], [1, 0, 0], [0, 1, 0], [0, 0, 1], c, h, 6, STONE);
  } else {
    const near = level === 'near', sides = near ? 24 : 10, knee = q.deck + h * 0.78;
    const plinth = q.handrail * 0.4;
    t.prism([r, 0, q.deck], [1, 0, 0], [0, 1, 0], [0, 0, 1], c * 1.6, plinth, 8, STONE_DARK);
    // The shaft: tapering from the plinth to the knee; fluted up close (every other edge set in).
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * 2 * Math.PI, a1 = ((k + 1) / sides) * 2 * Math.PI;
      const inset = (j: number) => (near && j % 2 === 1 ? 0.93 : 1);
      const rim = (a: number, j: number, z: number, w: number): Vec3 => [r + Math.cos(a) * w * inset(j), Math.sin(a) * w * inset(j), z];
      const am = (a0 + a1) / 2;
      t.quad(rim(a0, k, q.deck + plinth, c), rim(a1, k + 1, q.deck + plinth, c), rim(a1, k + 1, knee, c * 0.75), rim(a0, k, knee, c * 0.75), v3norm([Math.cos(am), Math.sin(am), (c * 0.25) / (knee - q.deck - plinth)]), STONE);
    }
    // The collar where it branches, in bronze.
    t.finish = FINISH.bronze;
    t.prism([r, 0, knee - q.handrail * 0.15], [1, 0, 0], [0, 1, 0], [0, 0, 1], c * 0.95, q.handrail * 0.3, near ? 16 : 8, BRONZE);
    // Four struts up into the roof: out, in, and to each side.
    t.finish = FINISH.stone;
    const spread = (under(r) - knee) * 0.9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tr = Math.hypot(r + dx * spread, dy * spread);
      const end: Vec3 = [r + dx * spread, dy * spread, under(tr) + q.shell * 0.3];
      const from: Vec3 = [r, 0, knee];
      const d: Vec3 = [end[0] - from[0], end[1] - from[1], end[2] - from[2]], len = Math.hypot(d[0], d[1], d[2]);
      const up = v3norm(d), ex = v3norm(v3cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], up)), ey = v3cross(up, ex);
      t.prism(from, ex, ey, up, c * 0.45, len, near ? 10 : 6, STONE);
    }
  }
  for (let k = 0; k < q.columns; k++) {
    const a = ((k + 0.5) / q.columns) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    sh.append(t, [ca, sa, 0], [-sa, ca, 0], [0, 0, 1], [0, 0, 0]);
  }
}

/** The shell roof: its top, its underside, the eaves' edge and the oculus's bronze ring; ribs under it up close. */
function roof(sh: Shape, q: PavilionPlan, level: LandmarkLevel): void {
  // Around, half the level's steps: the shell is smooth, and its edge is the only outline it has.
  const pieces = level === 'far' ? 6 : level === 'mid' ? 10 : 16, n = Math.max(48, around(q, level) / 2);
  const shellRing = (z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, c: RGB) => sh.arc(z0, r0, z1, r1, nz, nr, 0, 2 * Math.PI, n, c);
  const rAt = (j: number) => q.oculus + ((q.reach - q.oculus) * j) / pieces;
  for (let j = 0; j < pieces; j++) {
    const ri = rAt(j), ro = rAt(j + 1), zi = roofAt(q, ri), zo = roofAt(q, ro);
    const l = Math.hypot(ro - ri, zi - zo);
    sh.finish = FINISH.ceramic;
    shellRing(zo, ro, zi, ri, (ro - ri) / l, (zi - zo) / l, ROOF);
    sh.finish = FINISH.timber;
    shellRing(zi - q.shell, ri, zo - q.shell, ro, -(ro - ri) / l, -(zi - zo) / l, SOFFIT);
  }
  sh.finish = FINISH.stone;
  shellRing(roofAt(q, q.reach) - q.shell, q.reach, roofAt(q, q.reach), q.reach, 0, 1, ROOF);
  sh.finish = FINISH.bronze;
  const zo = roofAt(q, q.oculus);
  sh.band(zo + q.shell * 0.6, q.oculus, zo - q.shell * 1.4, q.oculus, 0, -1, BRONZE);
  sh.band(zo + q.shell * 0.6, q.oculus * 1.06, zo + q.shell * 0.6, q.oculus, 1, 0, BRONZE);
  sh.band(zo, q.oculus * 1.06, zo + q.shell * 0.6, q.oculus * 1.06, 0, 1, BRONZE);
  if (level !== 'near') return;
  // Ribs under the shell, one over each column's branches, following it from the oculus to the eaves.
  sh.finish = FINISH.timber;
  const w = q.shell * 0.4, d = q.shell * 0.9, ribs = q.columns;
  const profile: [number, number][] = [[-w, -d], [w, -d], [w, 0], [-w, 0]];
  for (let k = 0; k < ribs; k++) {
    const a = ((k + 0.5) / ribs) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < pieces; j++) {
      const ri = rAt(j), ro = rAt(j + 1);
      const A: Vec3 = [ri * ca, ri * sa, roofAt(q, ri) - q.shell], B: Vec3 = [ro * ca, ro * sa, roofAt(q, ro) - q.shell];
      const along = v3norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]), across: Vec3 = [-sa, ca, 0];
      sh.sweep(profile, A, B, across, v3cross(along, across), SOFFIT);
    }
  }
}

/** A bridge from the deck's edge to the shore: arched deck, edges, underside, and piers in pairs. */
function bridge(sh: Shape, q: PavilionPlan, b: { dir: 1 | -1; from: number; to: number; end: number }, level: LandmarkLevel): void {
  const len = b.to - b.from, k = level === 'far' ? 4 : level === 'near' ? Math.ceil(len / (q.handrail * 1.5)) : 12;
  const w = q.bridge / 2, slab = q.slab * 0.8, s = b.dir;
  const station = (j: number) => b.from + (len * j) / k;
  const onBridge = (x: number, y: number, dz = 0): Vec3 => [s * x, s * y, bridgeAt(q, b, x) + dz];
  for (let j = 0; j < k; j++) {
    const x0 = station(j), x1 = station(j + 1);
    const slope = (bridgeAt(q, b, x1) - bridgeAt(q, b, x0)) / (x1 - x0);
    const up = v3norm([-s * slope, 0, 1]), down: Vec3 = [-up[0], -up[1], -up[2]];
    sh.finish = FINISH.timber;
    sh.quad(onBridge(x0, -w), onBridge(x1, -w), onBridge(x1, w), onBridge(x0, w), up, TIMBER);
    sh.finish = FINISH.stone;
    sh.quad(onBridge(x0, w), onBridge(x1, w), onBridge(x1, w, -slab), onBridge(x0, w, -slab), [0, s, 0], STONE);
    sh.quad(onBridge(x0, -w, -slab), onBridge(x1, -w, -slab), onBridge(x1, -w), onBridge(x0, -w), [0, -s, 0], STONE);
    if (level !== 'far') sh.quad(onBridge(x0, w, -slab), onBridge(x1, w, -slab), onBridge(x1, -w, -slab), onBridge(x0, -w, -slab), down, STONE_DARK);
  }
  if (level === 'far') return;
  sh.finish = FINISH.stone;
  for (let x = b.from + q.span; x < b.to - q.handrail * 2; x += q.span) {
    const bottom = bridgeAt(q, b, x) - slab;
    for (const y of [-w + q.pier * 1.2, w - q.pier * 1.2]) sh.prism([s * x, s * y, -q.depth], [1, 0, 0], [0, 1, 0], [0, 0, 1], q.pier * 0.8, q.depth + bottom, 8, STONE_DARK);
  }
}

/**
 * A railing along a line of points (each with its height), `hr` high: posts about a handrail and a third apart, a top
 * rail and a cable between them; or, for the physics (`solid`), a wall as high as the rail. Every landmark's railings.
 */
export function railing(sh: Shape, hr: number, line: readonly Vec3[], solid: boolean): void {
  if (solid) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], n = v3norm(v3cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [0, 0, 1]));
      sh.quad(a, b, [b[0], b[1], b[2] + hr], [a[0], a[1], a[2] + hr], n, BRONZE);
    }
    return;
  }
  sh.finish = FINISH.bronze;
  const rail: [number, number][] = [[-0.03, -0.05], [0.03, -0.05], [0.03, 0], [-0.03, 0]].map(([x, y]) => [x * hr, y * hr]);
  const cable: [number, number][] = [[-0.009, -0.006], [0.009, -0.006], [0, 0.01]].map(([x, y]) => [x * hr, y * hr]);
  // Posts at the line's points closest to every 1.3 handrails along it; rails run straight from post to post.
  const posts: Vec3[] = [line[0]];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (run >= hr * 1.3 || i === line.length - 1) { posts.push(line[i]); run = 0; }
  }
  for (let i = 0; i < posts.length; i++) {
    const a = posts[i];
    sh.prism(a, [1, 0, 0], [0, 1, 0], [0, 0, 1], hr * 0.035, hr, 4, BRONZE);
    if (i + 1 === posts.length) break;
    const b = posts[i + 1], along = v3norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const across = v3norm(v3cross([0, 0, 1], along)), up = v3cross(along, across);
    for (const [h, prof] of [[hr, rail], [hr * 0.5, cable]] as const)
      sh.sweep(prof, [a[0], a[1], a[2] + h], [b[0], b[1], b[2] + h], across, up, BRONZE);
  }
}

/** Points around a circle (or an arc a0 … a1) at a height. */
const circle = (r: number, z: number, n: number, a0 = 0, a1 = 2 * Math.PI): Vec3[] => Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + ((a1 - a0) * i) / n, z));

/** The railings: round the pool, the deck's edge (open to the bridges), the top of the seats, the passages, the bridges. */
function railings(sh: Shape, q: PavilionPlan, p: Pavilion, level: LandmarkLevel): void {
  const solid = level === 'solid', n = around(q, level), top = q.deck + q.rows * q.riser, inset = q.handrail * 0.1;
  railing(sh, q.handrail, circle(q.pool + inset, q.deck, Math.ceil(n / 4)), solid);
  // The deck's edge, open where each bridge leaves.
  const gap = (q.bridge / 2) / q.radius;
  for (const [a0, a1] of [[gap, Math.PI - gap], [Math.PI + gap, 2 * Math.PI - gap]]) railing(sh, q.handrail, circle(q.radius - inset, q.deck, Math.ceil((n * (a1 - a0)) / (2 * Math.PI)), a0, a1), solid);
  // Along the top of the seats, between the passages, and down each passage's sides.
  for (let g = 0; g < 4; g++) {
    const w = q.passage / 2, a0 = PASSAGES[g] + w / q.stand, a1 = PASSAGES[g] + Math.PI / 2 - w / q.stand;
    railing(sh, q.handrail, circle(q.stand - inset, top, Math.ceil((n * (a1 - a0)) / (2 * Math.PI)), a0, a1), solid);
    for (const side of [-1, 1]) {
      const line: Vec3[] = [];
      for (let i = 0; i <= q.rows; i++) {
        const r = Math.min(q.stand, q.floor + i * q.tread), a = PASSAGES[g] + (side * w) / r;
        line.push(polar(r, a, q.deck + Math.min(i + 1, q.rows) * q.riser));
      }
      railing(sh, q.handrail, line, solid);
    }
  }
  for (const b of p.bridges) {
    const k = Math.ceil((b.to - b.from) / q.handrail);
    for (const side of [-1, 1]) {
      const y = side * (q.bridge / 2 - inset);
      railing(sh, q.handrail, Array.from({ length: k + 1 }, (_, j) => { const x = b.from + ((b.to - b.from) * j) / k; return [b.dir * x, b.dir * y, bridgeAt(q, b, x)] as Vec3; }), solid);
    }
  }
}

/** A railing's top rail alone along a line of points (`hr` over them): from the middle distance only that shows. */
export function topRail(sh: Shape, hr: number, line: readonly Vec3[]): void {
  sh.finish = FINISH.bronze;
  const rail: [number, number][] = [[-0.03 * hr, -0.05 * hr], [0.03 * hr, -0.05 * hr], [0.03 * hr, 0], [-0.03 * hr, 0]];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], d = v3norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const across = v3norm(v3cross([0, 0, 1], d));
    sh.sweep(rail, [a[0], a[1], a[2] + hr], [b[0], b[1], b[2] + hr], across, v3cross(d, across), BRONZE);
  }
}

/** From the middle distance only the railings' top rails show (posts and cables are under a pixel). */
function topRails(sh: Shape, q: PavilionPlan, p: Pavilion): void {
  const hr = q.handrail, top = q.deck + q.rows * q.riser;
  topRail(sh, hr, circle(q.pool, q.deck, 32));
  topRail(sh, hr, circle(q.radius, q.deck, 96));
  topRail(sh, hr, circle(q.stand, top, 96));
  for (const b of p.bridges) for (const side of [-1, 1]) {
    topRail(sh, hr, Array.from({ length: 13 }, (_, j) => { const x = b.from + ((b.to - b.from) * j) / 12; return [b.dir * x, b.dir * side * q.bridge / 2, bridgeAt(q, b, x)] as Vec3; }));
  }
}

/** Benches on the promenade between the columns, facing out over the lake (none in front of a passage). */
function benches(sh: Shape, q: PavilionPlan): void {
  const hr = q.handrail, r = (q.skirt + q.ring) / 2;
  sh.finish = FINISH.timber;
  for (let k = 0; k < q.columns; k++) {
    if (k % (q.columns / 4) === 0) continue;
    const a = (k / q.columns) * 2 * Math.PI, out: Vec3 = [Math.cos(a), Math.sin(a), 0], side: Vec3 = [-out[1], out[0], 0], up: Vec3 = [0, 0, 1];
    const seatAt = (o: number, z: number): Vec3 => [out[0] * (r + o), out[1] * (r + o), q.deck + z];
    // Seat, backrest (on the side toward the middle), two legs.
    sh.block(seatAt(0, hr * 0.38), out, side, up, [hr * 0.2, hr * 0.9, hr * 0.03], SEAT);
    sh.block(seatAt(-hr * 0.2, hr * 0.62), out, side, up, [hr * 0.025, hr * 0.9, hr * 0.17], SEAT);
    for (const s of [-1, 1]) {
      const c = seatAt(0, hr * 0.175), leg: Vec3 = [c[0] + side[0] * s * hr * 0.75, c[1] + side[1] * s * hr * 0.75, c[2]];
      sh.finish = FINISH.bronze;
      sh.block(leg, out, side, up, [hr * 0.2, hr * 0.03, hr * 0.175], BRONZE);
      sh.finish = FINISH.timber;
    }
  }
}

/** Lamp posts at the deck's edge, one by each column (night lights to come). */
function lamps(sh: Shape, q: PavilionPlan): void {
  const hr = q.handrail, r = q.radius - hr * 0.6;
  sh.finish = FINISH.bronze;
  for (let k = 0; k < q.columns; k++) {
    const a = ((k + 0.5) / q.columns) * 2 * Math.PI, base = polar(r, a, q.deck);
    sh.prism(base, [1, 0, 0], [0, 1, 0], [0, 0, 1], hr * 0.05, hr * 2.6, 8, BRONZE);
    sh.prism([base[0], base[1], base[2] + hr * 2.6], [1, 0, 0], [0, 1, 0], [0, 0, 1], hr * 0.14, hr * 0.3, 8, BRONZE);
  }
}

/**
 * How high a walkable top of the pavilion is over a point of its frame (x, y), or null where it has none: the deck,
 * the seats (the row's top; a stair's step) and the bridges. For setting someone down on it.
 */
export function pavilionTop(p: Pavilion, x: number, y: number): number | null {
  const q = pavilionPlan(p), r = Math.hypot(x, y);
  for (const b of p.bridges) {
    const along = x * b.dir;
    if (along >= q.radius - q.handrail && along <= b.to && Math.abs(y) <= q.bridge / 2) return bridgeAt(q, b, Math.max(along, b.from));
  }
  if (r < q.pool || r > q.radius) return null;
  if (r < q.floor || r > q.stand) return q.deck;
  const a = Math.atan2(y, x), i = Math.min(q.rows - 1, Math.floor((r - q.floor) / q.tread));
  const within = (g: number, w: number) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) * r < w / 2;
  if (PASSAGES.some((g) => within(g, q.passage))) return q.deck;
  if (stairsOf(q).some((g) => within(g, q.stair))) {
    const j = Math.min(1, Math.floor(((r - q.floor - i * q.tread) / q.tread) * 2));
    return q.deck + i * q.riser + ((j + 1) * q.riser) / 2;
  }
  return q.deck + (i + 1) * q.riser;
}
