/**
 * The summit hut on the Mountain (gen/landmarks.ts places it on the plan's `summit-hut` site, under the snow line on
 * the main valley's flank). True up never follows the endcap's slope, so the Mountain's face there is a cliff, 65 to
 * 90° from level: the hut hangs on the rock instead of standing on ground. Nobody needs shelter in the habitat, so it
 * is a hall open to the view. What climbers and flyers come up for is the look down the whole length of the cylinder,
 * and the launch. From the rock outward:
 *
 * - the anchor: masonry built against the rock, filling the space between the hall and the uneven face, and carrying
 *   the chimney; its back is buried in the rock;
 * - stone corbels under the hall's back half, stepping out course by course;
 * - timber struts from under the hall, the terrace and the prow, raking back down into the anchor or the rock;
 * - the hall: a stone floor, low timber walls along both sides (the drop is right beside them), posts carrying a steep
 *   slate roof whose ridge points at the view, a hearth in the anchor's face, a long table with benches;
 * - the terrace beyond the roof, railed;
 * - the launch prow: a tapering boom out over the drop, railed along its sides and open at its tip, where flyers step
 *   off (gravity there is under a third of the floor's).
 *
 * Everything is in the hut's own frame (`frameOf`, gen/landmarks.ts): x out from the rock toward the view, y across, z
 * up (toward the axis); x = 0 is the hall's back wall, z = 0 its floor. Sizes are in handrails
 * (`HabitatParams.landmarks`). Lengths shrink with the site (`scale`, down to a bivouac); heights never do. Drawn at
 * the landmark levels (`LANDMARK_LEVELS`): far is the outline (anchor, chimney, roof, floor, walls, corbels, prow),
 * mid adds posts, struts, the hearth, beams and top rails, and near adds railings, table, benches, lanterns and
 * boards. Pure.
 */
import { v3add, v3cross, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { Shape, type RGB } from './shapes';
import { FINISH, railing, topRail, type LandmarkLevel } from './pavilion';
import type { Hut } from './landmarks';

const DEG = Math.PI / 180;

/** Its sizes in handrails at full size (`scale` 1). Lengths shrink with the site; heights stay. */
const HUT = {
  /** The hall's length and width at full size, and its least width. */
  length: 11, width: 7, narrowest: 4.2,
  /** The roof: its underside's height at the side walls, its pitch, its overhang at the front and the sides, its thickness. */
  eaves: 2.7, pitch: 40 * DEG, over: 1.4, side: 0.7, shell: 0.3,
  /** The floor's slab; the terrace's depth and the prow's length (each with a least); the prow's width at its root and tip. */
  slab: 0.4, terrace: 3.6, leastTerrace: 2.5, prow: 5, leastProw: 3, root: 1.6, tip: 0.8,
  /** The side walls' height and thickness; the posts' width, and the spacing they are set at. */
  sill: 0.95, wall: 0.25, post: 0.28, every: 3,
  /** The corbels: a course's height, how far each one steps out past the one under it, how much of the hall they carry. */
  course: 0.5, out: 0.6, carry: 0.45,
  /** The struts' thickness, and how far they drop for each metre they run back. */
  strut: 0.3, rake: 1,
  /** The anchor: how far it reaches past the roof's edges, how far over the ridge, how deep into the rock. */
  flank: 0.3, crown: 0.4, bury: 1,
  /** The hearth: its breast's width and depth, the firebox's width, sill height, mouth and depth. */
  breast: 2.6, deep: 0.9, fire: 1.4, hearth: 0.35, mouth: 1.0, box: 0.55,
  /** The chimney on the anchor: its width, and how far it rises over the anchor. */
  chimney: 1.5, flue: 2.2,
  /** How long a site must be (handrails) for the full-size hut, and the least share of that it may shrink to. */
  fits: 18, least: 0.45,
};

/** The Mountain's own granite, slate, weathered larch, bronze. Linear albedo. */
const STONE: RGB = [0.4, 0.39, 0.36];
const FLAGS: RGB = [0.46, 0.44, 0.4];
const SOOT: RGB = [0.07, 0.065, 0.06];
const TIMBER: RGB = [0.27, 0.18, 0.11];
const DECK: RGB = [0.27, 0.2, 0.14];
const SLATE: RGB = [0.19, 0.2, 0.21];
const BRONZE: RGB = [0.22, 0.15, 0.08];
const LANTERN: RGB = [0.8, 0.78, 0.7];

/** Every size of a hut (m), from the handrail's height and its scale. */
export interface HutPlan {
  handrail: number;
  /** The hall: length (x), width (y). */
  length: number;
  width: number;
  /** The roof: its underside's height at the side walls, rise per metre across, cos of the pitch, overhangs, thickness, the ridge's top. */
  eaves: number;
  slope: number;
  cos: number;
  over: number;
  side: number;
  shell: number;
  ridge: number;
  /** The floor's slab, the terrace's depth, the prow: its length, width at the root and at the tip. */
  slab: number;
  terrace: number;
  prow: number;
  root: number;
  tip: number;
  /** The side walls' height and thickness; the posts' width and where they stand along x. */
  sill: number;
  wall: number;
  post: number;
  posts: number[];
  /** Corbels: a course's height, the step out, how many. The carried length is `courses × out`. */
  course: number;
  out: number;
  courses: number;
  /** The struts' thickness and rake; the anchor's half width and crown (its top); how deep it is buried. */
  strut: number;
  rake: number;
  span: number;
  top: number;
  bury: number;
  /** The hearth and the chimney. */
  breast: number;
  deep: number;
  fire: number;
  hearth: number;
  mouth: number;
  box: number;
  chimney: number;
  flue: number;
  /** From the back wall to the prow's tip. */
  reach: number;
}

/** How far a hut on a site of this size (its radius, m) is shrunk, or null where even a bivouac would not fit. */
export function hutScale(size: number, handrail: number): number | null {
  const k = Math.min(1, size / (HUT.fits * handrail));
  return k >= HUT.least ? k : null;
}

export function hutPlan(hr: number, scale: number): HutPlan {
  const length = HUT.length * hr * scale, width = Math.max(HUT.narrowest, HUT.width * scale) * hr;
  const terrace = Math.max(HUT.leastTerrace, HUT.terrace * scale) * hr, prow = Math.max(HUT.leastProw, HUT.prow * scale) * hr;
  const slope = Math.tan(HUT.pitch), cos = Math.cos(HUT.pitch), shell = HUT.shell * hr, eaves = HUT.eaves * hr;
  const ridge = eaves + shell / cos + (width / 2) * slope, side = HUT.side * hr;
  const bays = Math.max(2, Math.round(length / (HUT.every * hr))), post = HUT.post * hr;
  const out = HUT.out * hr;
  return {
    handrail: hr, length, width, eaves, slope, cos, over: HUT.over * hr * Math.max(scale, 0.7), side, shell, ridge,
    slab: HUT.slab * hr, terrace, prow, root: HUT.root * hr, tip: HUT.tip * hr,
    sill: HUT.sill * hr, wall: HUT.wall * hr, post,
    posts: postsAlong(length, bays, post),
    course: HUT.course * hr, out, courses: Math.max(2, Math.floor((HUT.carry * length) / out)),
    strut: HUT.strut * hr, rake: HUT.rake, span: width / 2 + side + HUT.flank * hr, top: ridge + HUT.crown * hr, bury: HUT.bury * hr,
    breast: Math.min(HUT.breast * hr, width * 0.45), deep: HUT.deep * hr, fire: Math.min(HUT.fire * hr, width * 0.25), hearth: HUT.hearth * hr,
    mouth: HUT.mouth * hr, box: HUT.box * hr, chimney: HUT.chimney * hr, flue: HUT.flue * hr,
    reach: length + terrace + prow,
  };
}

/** Where the posts stand along a side wall: one at the end of each bay, the last flush with the hall's front. */
function postsAlong(length: number, bays: number, post: number): number[] {
  const xs: number[] = [];
  for (let i = 1; i < bays; i++) xs.push((length * i) / bays);
  xs.push(length - post / 2);
  return xs;
}

/** The roof's top over a point `y` across (its underside is `shell / cos` lower). */
export const roofTopAt = (q: HutPlan, y: number): number => q.ridge - Math.abs(y) * q.slope;

/** Half the prow's width at a share `u` of its length (0 at its root). */
const prowHalf = (q: HutPlan, u: number): number => (q.root + (q.tip - q.root) * u) / 2;

/**
 * Where the struts start, under the deck: a pair under the hall's front, a pair under the terrace's edge, one under
 * the prow's middle. The placing (gen/landmarks.ts) runs each back to where it buries.
 */
export function strutFeet(q: HutPlan): Vec3[] {
  const y = q.width / 2 - q.wall / 2, z = -q.slab;
  return [[q.length * 0.75, -y, z], [q.length * 0.75, y, z], [q.length + q.terrace - q.strut, -y, z], [q.length + q.terrace - q.strut, y, z], [q.length + q.terrace + q.prow * 0.5, 0, z]];
}

/** Which way a strut runs from its foot: back toward the rock and down, `rake` metres down for each metre back. */
export const strutDir = (q: HutPlan): Vec3 => v3norm([-1, 0, -q.rake]);

/** The box a hut fills in its frame, anchor and chimney included. */
export function hutBounds(l: Hut): { lo: Vec3; hi: Vec3 } {
  const q = hutPlan(l.handrail, l.scale);
  return { lo: [l.back, -q.span, l.foot], hi: [q.reach, q.span, q.top + q.flue + q.handrail * 0.2] };
}

/**
 * How high the walkable top of the hut is over a point of its frame (x, y), or null where it has none: the hall's
 * floor, the side walls' tops, the terrace and the prow. For setting someone down on it.
 */
export function hutTop(l: Hut, x: number, y: number): number | null {
  const q = hutPlan(l.handrail, l.scale), ay = Math.abs(y);
  if (x >= 0 && x <= q.length + q.terrace && ay <= q.width / 2) {
    if (x < q.deep && ay < q.breast / 2) return null;
    return x <= q.length && ay > q.width / 2 - q.wall ? q.sill : 0;
  }
  const u = (x - q.length - q.terrace) / q.prow;
  return u >= 0 && u <= 1 && ay <= prowHalf(q, u) ? 0 : null;
}

/** The hut at one level, in its own frame, as a mapped and coloured shape. */
export function buildHut(l: Hut, level: LandmarkLevel): Shape {
  const q = hutPlan(l.handrail, l.scale), sh = new Shape(8, true, true);
  const far = level === 'far', near = level === 'near', solid = level === 'solid';
  const hw = q.width / 2, hr = q.handrail;

  // The anchor against the rock, its front the hall's back wall; the chimney on it.
  sh.finish = FINISH.stone;
  cube(sh, [l.back, 0], [-q.span, q.span], [l.foot, q.top], STONE);
  const cx = Math.max(l.back + q.chimney / 2, -q.chimney / 2 - hr * 0.2);
  cube(sh, [cx - q.chimney / 2, cx + q.chimney / 2], [-q.chimney * 0.55, q.chimney * 0.55], [q.top, q.top + q.flue], STONE);
  if (!far && !solid) cube(sh, [cx - q.chimney / 2 - hr * 0.12, cx + q.chimney / 2 + hr * 0.12], [-q.chimney * 0.55 - hr * 0.12, q.chimney * 0.55 + hr * 0.12], [q.top + q.flue, q.top + q.flue + hr * 0.2], STONE);

  // The floor: stone flags in the hall, timber on the terrace; the prow tapering out.
  cube(sh, [0, q.length], [-hw, hw], [-q.slab, 0], FLAGS);
  sh.finish = FINISH.timber;
  cube(sh, [q.length, q.length + q.terrace], [-hw, hw], [-q.slab, 0], DECK);
  const x0 = q.length + q.terrace, x1 = x0 + q.prow;
  hexa(sh,
    [[x0, -q.root / 2, -q.slab], [x1, -q.tip / 2, -q.slab * 0.6], [x1, q.tip / 2, -q.slab * 0.6], [x0, q.root / 2, -q.slab]],
    [[x0, -q.root / 2, 0], [x1, -q.tip / 2, 0], [x1, q.tip / 2, 0], [x0, q.root / 2, 0]], DECK);

  // The side walls, low: the drop is beside them.
  for (const s of [-1, 1]) cube(sh, [0, q.length], s < 0 ? [-hw, -hw + q.wall] : [hw - q.wall, hw], [0, q.sill], TIMBER);

  // Corbels under the back of the hall, each course stepping out over the one below.
  if (!solid) {
    sh.finish = FINISH.stone;
    for (let i = 0; i < q.courses; i++) {
      const z1 = -q.slab - i * q.course;
      cube(sh, [0, (q.courses - i) * q.out], [-hw + hr * 0.2, hw - hr * 0.2], [z1 - q.course, z1], STONE);
    }
  }

  roof(sh, q, level);
  if (!far) {
    posts(sh, q);
    hearth(sh, q, solid);
  }
  if (!far && !solid) {
    for (const st of l.struts) strut(sh, st.from, st.to, q.strut, TIMBER);
    beams(sh, q);
  }
  const rails = railLines(q);
  if (solid || near) for (const line of rails) railing(sh, hr, line, solid);
  else if (!far) for (const line of rails) topRail(sh, hr, line);
  if (near) {
    furniture(sh, q);
    lanterns(sh, q);
    boards(sh, q);
    sh.finish = FINISH.bronze;
    for (const st of l.struts) strut(sh, st.from, v3add(st.from, v3scale(v3norm(v3sub(st.to, st.from)), hr * 0.5)), q.strut * 1.25, BRONZE);
  }
  return sh;
}

/** The slate roof: a slab each side of the ridge, timber under it, the ridge capped. */
function roof(sh: Shape, q: HutPlan, level: LandmarkLevel): void {
  const xb = -q.handrail * 0.05, xf = q.length + q.over, e = q.width / 2 + q.side, edge = roofTopAt(q, e);
  for (const s of [-1, 1]) {
    const n: Vec3 = [0, s * Math.sin(Math.atan(q.slope)), q.cos], down = v3scale(n, -q.shell);
    const top: Vec3[] = [[xb, 0, q.ridge], [xf, 0, q.ridge], [xf, s * e, edge], [xb, s * e, edge]];
    sh.finish = FINISH.timber;
    hexa(sh, top.map((p) => v3add(p, down)), top, TIMBER, [SLATE, FINISH.ceramic]);
  }
  if (level === 'far' || level === 'solid') return;
  sh.finish = FINISH.ceramic;
  cube(sh, [xb, xf + q.handrail * 0.05], [-q.handrail * 0.12, q.handrail * 0.12], [q.ridge - q.handrail * 0.1, q.ridge + q.handrail * 0.1], SLATE);
}

/** The posts along both side walls, from the floor up under the roof. */
function posts(sh: Shape, q: HutPlan): void {
  sh.finish = FINISH.timber;
  const y = q.width / 2 - q.wall / 2, p = q.post / 2;
  for (const x of q.posts) for (const s of [-1, 1]) cube(sh, [x - p, x + p], [s * y - p, s * y + p], [0, roofTopAt(q, y - p) - q.shell / q.cos], TIMBER);
}

/** Across the open front: a tie beam on the front posts and a king post up to the ridge. */
function beams(sh: Shape, q: HutPlan): void {
  sh.finish = FINISH.timber;
  const x = q.length - q.post / 2, p = q.post / 2, hw = q.width / 2, tie = q.eaves - q.handrail * 0.35;
  cube(sh, [x - p, x + p], [-hw + q.wall, hw - q.wall], [tie, q.eaves], TIMBER);
  cube(sh, [x - p, x + p], [-p, p], [q.eaves, roofTopAt(q, p) - q.shell / q.cos], TIMBER);
}

/** The hearth in the anchor's face: a stone breast with a sooted firebox, its hearthstone raised. */
function hearth(sh: Shape, q: HutPlan, solid: boolean): void {
  sh.finish = FINISH.stone;
  const b = q.breast / 2, f = q.fire / 2, high = q.eaves + q.handrail * 0.6, mouthTop = q.hearth + q.mouth;
  if (solid) { cube(sh, [0, q.deep], [-b, b], [0, high], STONE); return; }
  for (const s of [-1, 1]) cube(sh, [0, q.deep], s < 0 ? [-b, -f] : [f, b], [0, high], STONE);
  cube(sh, [0, q.deep], [-f, f], [0, q.hearth], FLAGS);
  cube(sh, [0, q.deep], [-f, f], [mouthTop, high], STONE);
  cube(sh, [0, q.deep - q.box], [-f, f], [q.hearth, mouthTop], SOOT);
}

/** The railings: along each side of the terrace, across its front to the prow, and out along the prow (open at its tip). */
function railLines(q: HutPlan): Vec3[][] {
  const hr = q.handrail, i = hr * 0.08, hw = q.width / 2 - i, x0 = q.length + q.terrace - i, step = hr * 0.65;
  return [-1, 1].map((s) => {
    const pts: Vec3[] = [[q.length + q.post, s * hw, 0], [x0, s * hw, 0], [x0, s * (q.root / 2 - i), 0]];
    for (let u = 0.1; u <= 1 - (hr * 0.9) / q.prow + 1e-9; u += 0.1) {
      const x = q.length + q.terrace + q.prow * u;
      pts.push([x, s * (prowHalf(q, u) - i), 0]);
    }
    return dense(pts, step);
  });
}

/** The long table down the hall with a bench on each side. */
function furniture(sh: Shape, q: HutPlan): void {
  const hr = q.handrail, a = q.deep + hr * 1.2, b = q.length - hr * 1.6;
  if (b - a < hr * 2) return;
  sh.finish = FINISH.timber;
  cube(sh, [a, b], [-hr * 0.5, hr * 0.5], [hr * 0.64, hr * 0.7], TIMBER);
  for (const x of [a + hr * 0.3, (a + b) / 2, b - hr * 0.3]) cube(sh, [x - hr * 0.05, x + hr * 0.05], [-hr * 0.4, hr * 0.4], [0, hr * 0.64], TIMBER);
  for (const s of [-1, 1]) {
    const y0 = s * hr * 0.8, y1 = s * hr * 1.15;
    cube(sh, [a, b], [Math.min(y0, y1), Math.max(y0, y1)], [hr * 0.38, hr * 0.43], TIMBER);
    for (const x of [a + hr * 0.3, b - hr * 0.3]) cube(sh, [x - hr * 0.04, x + hr * 0.04], [Math.min(y0, y1), Math.max(y0, y1)], [0, hr * 0.38], TIMBER);
  }
}

/** Two lanterns hanging from the tie beam over the front of the hall (night lights to come). */
function lanterns(sh: Shape, q: HutPlan): void {
  const hr = q.handrail, x = q.length - q.post / 2, tie = q.eaves - hr * 0.35;
  for (const y of [-q.width / 4, q.width / 4]) {
    sh.finish = FINISH.bronze;
    sh.prism([x, y, tie - hr * 0.4], [1, 0, 0], [0, 1, 0], [0, 0, 1], hr * 0.012, hr * 0.4, 4, BRONZE);
    sh.prism([x, y, tie - hr * 0.62], [1, 0, 0], [0, 1, 0], [0, 0, 1], hr * 0.1, hr * 0.04, 6, BRONZE);
    sh.finish = FINISH.ceramic;
    cube(sh, [x - hr * 0.07, x + hr * 0.07], [y - hr * 0.07, y + hr * 0.07], [tie - hr * 0.58, tie - hr * 0.42], LANTERN);
  }
}

/** Boards up close: barge boards along the front gable's edges, fascias along the eaves. */
function boards(sh: Shape, q: HutPlan): void {
  sh.finish = FINISH.timber;
  const hr = q.handrail, t = hr * 0.06, d = hr * 0.28, xf = q.length + q.over, e = q.width / 2 + q.side, edge = roofTopAt(q, e);
  for (const s of [-1, 1]) {
    // Along the gable's edge from the ridge to the eave, hanging below the slab's end.
    const a: Vec3 = [xf + t, 0, q.ridge + hr * 0.02], b: Vec3 = [xf + t, s * e, edge + hr * 0.02];
    hexa(sh, [[a[0] - t, a[1], a[2] - d], [b[0] - t, b[1], b[2] - d], [b[0] + t, b[1], b[2] - d], [a[0] + t, a[1], a[2] - d]], [[a[0] - t, a[1], a[2]], [b[0] - t, b[1], b[2]], [b[0] + t, b[1], b[2]], [a[0] + t, a[1], a[2]]], TIMBER);
    cube(sh, [-hr * 0.05, xf + t], s < 0 ? [-e - t, -e + t] : [e - t, e + t], [edge - d, edge + hr * 0.02], TIMBER);
  }
}

/** A box between two corners along the axes. */
function cube(sh: Shape, x: readonly [number, number], y: readonly [number, number], z: readonly [number, number], col: RGB): void {
  sh.box([(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], [(x[1] - x[0]) / 2, (y[1] - y[0]) / 2, (z[1] - z[0]) / 2], col);
}

/**
 * A six-sided solid from its bottom and top corners (each four around, the top's above the bottom's): every face
 * turned out from its middle. `top` paints the top face differently (the roof's slates over its timber).
 */
function hexa(sh: Shape, lo: readonly Vec3[], hi: readonly Vec3[], col: RGB, top?: readonly [RGB, number]): void {
  const mid = v3scale([...lo, ...hi].reduce((a, p) => v3add(a, p), [0, 0, 0] as Vec3), 1 / 8);
  const out = (pts: Vec3[], c: RGB): void => {
    const centre = v3scale(pts.reduce((a, p) => v3add(a, p), [0, 0, 0] as Vec3), 1 / 4);
    const n = v3cross(v3sub(pts[2], pts[0]), v3sub(pts[3], pts[1]));
    if (v3dot(n, v3sub(centre, mid)) >= 0) sh.face(pts[0], pts[1], pts[2], pts[3], c);
    else sh.face(pts[3], pts[2], pts[1], pts[0], c);
  };
  out([...lo], col);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; out([lo[i], lo[j], hi[j], hi[i]], col); }
  if (!top) { out([...hi], col); return; }
  const was = sh.finish;
  sh.finish = top[1];
  out([...hi], top[0]);
  sh.finish = was;
}

/** A square timber (or bronze) from one point to another. */
function strut(sh: Shape, a: Vec3, b: Vec3, width: number, col: RGB): void {
  const d = v3norm(v3sub(b, a)), across = v3norm(v3cross(d, Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1])), up = v3cross(across, d);
  const w = width / 2, ring = (p: Vec3): Vec3[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => v3add(p, v3add(v3scale(across, u * w), v3scale(up, v * w))));
  hexa(sh, ring(a), ring(b), col);
}

/** A line's points with more between them, so none is farther than `step` from the next (railing posts stand on points). */
function dense(pts: readonly Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 1; k <= n; k++) out.push(v3add(a, v3scale(v3sub(b, a), k / n)));
  }
  return out;
}
