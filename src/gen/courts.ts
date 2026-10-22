/**
 * The entrance courts: the ways down from the land to the living layer below (the plan's entrance sites; the terrain
 * digs each one, gen/terrain.ts `courts`). By day a court reads as a hollow of stone in the land; the city's light
 * will rise out of it at night. Each one, in its own frame (x along the axis, y around, z up from its dug floor):
 *
 * - a floor paved in rings round a light well (glass over the city below, a stone seat round it), and a wall lining
 *   the dug edge from it up to the rim: a darker plinth, pilasters, a coping, its top a stone walk railed on the drop;
 * - two stairs curving down along the wall from a landing at the rim's lowest point, one each way (one alone where
 *   two would not fit);
 * - facing one of the four ways along the bays below, where the wall is highest, the portal: a stone frame rising
 *   through the walk, bronze lift doors, lamps beside it;
 * - stone benches along the wall's foot.
 *
 * The stone is the district's (`STYLE_STONE`: each style builds its courts its own way), and a district that let its
 * land go keeps its courts without railings, slabs missing from their paving. Sizes come from the court (its radius and depth, `courtOf` in
 * gen/plan.ts) and the handrail; steps follow gravity (`riserAt`). Courts are things at sites (`courtSites`,
 * gen/siteTiles.ts): they stream in tiles over the floor, far, mid and near detail by a tile's size; `solids` gives the
 * physics the courts near a point, and `topAt` what people stand on. Pure.
 */
import type { DistrictStyle, Habitat, Vec3 } from '../blueprint';
import { Rng, deriveSeed } from '@futuremagic/core';
import type { PlacedCourt, Terrain } from './terrain';
import { planOf } from './plan';
import { kept, keptEach } from './kept';
import { FLIGHT, REST, TREAD, riserAt } from './liftStair';
import { FINISH, polar, railing, topRail } from './pavilion';
import { Shape, floorPoint, shade, type FloorFrame, type RGB } from './shapes';
import { siteParts, type Site, type SiteDetail } from './siteTiles';

/** A court's parts, in handrails. */
const PART = {
  /** The wall's face this far inside the dug floor's edge; the walk this far past the rim; the coping's rise; its lip. */
  face: 0.5, walk: 0.6, coping: 0.12, lip: 0.6,
  /** The paving's top over the dug floor; how deep wall and stairs go into the ground. */
  pave: 0.08, bury: 0.3,
  /** The stairs' width, the landing's length along the wall; how far a railing stands in from an edge. */
  stair: 1.8, landing: 2.6, inset: 0.12,
  /** The portal: the doorway's width and its highest, the frame's pilaster width and projection, the lintel's depth. */
  door: 2.4, high: 2.8, pilaster: 0.45, project: 0.4, lintel: 0.55,
  /** Benches: length, depth, seat height. */
  bench: 2.6, deep: 0.45, seat: 0.42,
  /** The wall: its darker plinth's height, the coping's overhang and thickness; pilasters' spacing, width and depth. */
  plinth: 0.6, over: 0.15, thick: 0.22, spacing: 6, pier: 0.7, proud: 0.3,
  /** The light well in the middle: its glass (a share of the court's radius) set this far down, the seat round it. */
  well: 0.13, sink: 0.05, kerb: 0.55,
  /** The paving's rings and slabs across; the share of slabs gone where the land was let go. */
  ring: 2.6, slab: 3, gone: 0.22,
};

/** Rim samples round a court. */
const RIM = 64;
const TAU = 2 * Math.PI;

/** Linear albedo of each district style's court stone, and its finish. */
export const STYLE_STONE: Readonly<Record<DistrictStyle, { stone: RGB; finish: number }>> = {
  // Warm sandstone among the fruit trees; pale limestone by the water; grey granite in the stone gardens.
  orchard: { stone: [0.55, 0.47, 0.36], finish: FINISH.stone },
  water: { stone: [0.6, 0.58, 0.53], finish: FINISH.stone },
  stone: { stone: [0.46, 0.46, 0.44], finish: FINISH.stone },
  // Dark, mossy stone under the living halls; fieldstone on the pastures; light stone where people play.
  grove: { stone: [0.34, 0.35, 0.3], finish: FINISH.stone },
  herd: { stone: [0.48, 0.43, 0.36], finish: FINISH.stone },
  play: { stone: [0.62, 0.6, 0.56], finish: FINISH.stone },
  // The makers fire their own: glazed brick.
  makers: { stone: [0.44, 0.23, 0.16], finish: FINISH.ceramic },
  // Weathered and darkened, unrailed.
  'let-go': { stone: [0.37, 0.36, 0.33], finish: FINISH.stone },
};
const PLAIN = { stone: [0.5, 0.48, 0.44] as RGB, finish: FINISH.stone };
const BRONZE: RGB = [0.22, 0.15, 0.08];
const LANTERN: RGB = [0.8, 0.78, 0.7];

/** A step of a court's stair (or its landing): from angle `a0` (uphill) to `a1`, its top over the dug floor. */
export interface CourtStep {
  a0: number;
  a1: number;
  top: number;
}

/** Everything about one court, in its frame. Angles from +x (along the axis) toward +y (around). */
export interface CourtLayout {
  habitat: Habitat;
  seed: number;
  court: PlacedCourt;
  handrail: number;
  style: DistrictStyle | null;
  /** The ground at the rim over the dug floor, at `RIM` angles round (the higher of the rim and the walk's outer edge). */
  rim: Float64Array;
  /** Radii: the stairs' inner edge, the wall's face, the walk's outer edge. */
  inner: number;
  face: number;
  outer: number;
  /** The paving's top and the coping's rise over the rim. */
  pave: number;
  coping: number;
  /** The landing at the rim's lowest point (its top is the walk there), and each stair down from it, landing first. */
  landing: CourtStep;
  stairs: { dir: 1 | -1; steps: CourtStep[] }[];
  /** The arc the landing and stairs take: from `used[0]` up to `used[1]`. */
  used: [number, number];
  /** The portal: its angle, the doorway's width and height. */
  portal: { angle: number; width: number; high: number };
  /** Bench angles. */
  benches: number[];
  /** The light well's glass radius, and the seat round it. */
  well: number;
  kerb: number;
}

/**
 * A court's light well: its glass's radius and the glass's height over the profile, or null in a habitat built without
 * landmarks. The Understorey's well shaft comes up to it from the vault below (gen/underMesh.ts).
 */
export function lightWellOf(h: Habitat, c: PlacedCourt): { radius: number; height: number } | null {
  const hr = h.params.landmarks?.handrail;
  return hr ? { radius: c.radius * PART.well, height: c.floor + (PART.pave - PART.sink) * hr } : null;
}

/** The rim's height over a court's dug floor at an angle (between its samples). */
export function rimAt(l: CourtLayout, a: number): number {
  const u = ((((a / TAU) % 1) + 1) % 1) * RIM, i = Math.floor(u) % RIM, f = u - Math.floor(u);
  return l.rim[i] * (1 - f) + l.rim[(i + 1) % RIM] * f;
}

/** The walk's top at an angle. */
const walkAt = (l: CourtLayout, a: number): number => rimAt(l, a) + l.coping;

/** Whether angle `a` lies on the arc from `lo` up to `hi` (lo ≤ hi, any number of turns apart from `a`). */
function within(a: number, lo: number, hi: number): boolean {
  return lo + ((((a - lo) % TAU) + TAU) % TAU) <= hi;
}

/** Each court's index among the terrain's courts. */
const indexOf = kept((t: Terrain) => new Map(t.courts.map((c, i) => [c, i])));

/** A court's layout (its index in `terrain.courts`), or null for one too small to stair; laid out when first asked for. */
export const courtLayoutOf: (t: Terrain, index: number) => CourtLayout | null = keptEach(layCourt);

function layCourt(t: Terrain, index: number): CourtLayout | null {
  const h = t.habitat, c = t.courts[index], hr = h.params.landmarks?.handrail;
  if (!c || !hr) return null;
  const R = h.profile.at(c.s).r, outer = c.radius + PART.walk * hr;
  const ground = (r: number, a: number): number => t.heightAt(c.theta + (r * Math.sin(a)) / R, c.s + r * Math.cos(a)) - c.floor;
  // Each sample the highest ground near it (between its neighbours, at the rim and the walk's outer edge), so the walk
  // drawn straight between samples never dips under a bump of the land.
  const raw = new Float64Array(RIM), rim = new Float64Array(RIM);
  for (let i = 0; i < RIM; i++) {
    for (const f of [-1 / 3, 0, 1 / 3]) for (const r of [c.radius, outer]) raw[i] = Math.max(raw[i], ground(r, ((i + f) / RIM) * TAU));
  }
  for (let i = 0; i < RIM; i++) rim[i] = Math.max(raw[(i + RIM - 1) % RIM], raw[i], raw[(i + 1) % RIM]);
  const face = c.radius * 0.9 - PART.face * hr, inner = face - PART.stair * hr, mid = (face + inner) / 2;
  if (inner < c.radius * 0.4) return null;
  const pave = PART.pave * hr, coping = PART.coping * hr;
  // The landing where the rim is lowest (the shortest way down), flush with the walk there.
  let low = 0;
  for (let i = 1; i < RIM; i++) if (rim[i] < rim[low]) low = i;
  const aLow = (low / RIM) * TAU, half = (PART.landing * hr) / 2 / mid, top = rim[low] + coping;
  const landing = { a0: aLow - half, a1: aLow + half, top };
  // The stairs down from it: risers by gravity, a rest after every flight. Two, one each way, where both fit beside
  // the portal; else one, as steep as it must be to fit.
  const g = Math.max(0.05, (R - c.floor) / R), n = Math.max(1, Math.round((top - pave) / riserAt(hr, g))), riser = (top - pave) / n;
  const runOf = (i: number): number => (i % FLIGHT === 0 ? REST : TREAD) * hr;
  let need = 0;
  for (let i = 1; i < n; i++) need += runOf(i) / mid;
  const room = TAU - 2 * half - ((PART.door + 2 * PART.pilaster + 2.5) * hr) / face;
  const both = 2 * need <= room, squeeze = Math.min(1, room / Math.max(need, 1e-9));
  const stairs: CourtLayout['stairs'] = [];
  for (const dir of both ? ([1, -1] as const) : ([1] as const)) {
    const steps: CourtStep[] = [];
    let a = dir > 0 ? landing.a1 : landing.a0;
    for (let i = 1; i < n; i++) {
      const b = a + (dir * runOf(i) * (both ? 1 : squeeze)) / mid;
      steps.push({ a0: a, a1: b, top: top - i * riser });
      a = b;
    }
    stairs.push({ dir, steps });
  }
  const end = (dir: number): number => stairs.find((st) => st.dir === dir)?.steps.at(-1)?.a1 ?? (dir > 0 ? landing.a1 : landing.a0);
  const used: [number, number] = [end(-1), end(1)];
  const l: CourtLayout = {
    habitat: h, seed: deriveSeed(h.seed, 'court', index), court: c, handrail: hr, well: lightWellOf(h, c)!.radius, kerb: PART.kerb * hr, style: planOf(h).districtAt(c.theta, c.s)?.style ?? null, rim, inner, face, outer, pave, coping,
    landing, stairs, used, portal: { angle: 0, width: PART.door * hr, high: 0 }, benches: [],
  };
  // The portal faces one of the four ways along the bays below (its lift comes down in the next bay that way, gen/
  // underMesh.ts): of those clear of the stairs, where the wall is highest; if none is, the one furthest from them.
  const margin = ((PART.door / 2 + PART.pilaster + 0.5) * hr) / face;
  const clear = (a: number): boolean => !within(a, used[0] - margin, used[1] + margin);
  const fromStairs = (a: number): number => Math.min(...[used[0], used[1], (used[0] + used[1]) / 2].map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))));
  let best = 0;
  for (let k = 1; k < 4; k++) {
    const a = (k * TAU) / 4;
    if (clear(a) ? !clear(best) || rimAt(l, a) > rimAt(l, best) : !clear(best) && fromStairs(a) > fromStairs(best)) best = a;
  }
  const high = Math.max(2 * hr, Math.min(PART.high * hr, walkAt(l, best) - pave - (PART.lintel + 0.3) * hr));
  l.portal = { angle: best, width: PART.door * hr, high };
  // Benches along the wall's foot, either side of the portal, where the stairs leave room.
  const benchArc = (PART.bench * hr) / face;
  for (const k of [-2, -1, 1, 2]) {
    const a = best + k * (benchArc + margin);
    if (!within(a, used[0] - benchArc, used[1] + benchArc)) l.benches.push(a);
  }
  return l;
}

/** Detail a court is built at; `solid` is what the physics touches. */
export type CourtDetail = SiteDetail;

/** Segments round a full circle at each detail. */
const ROUND: Record<CourtDetail, number> = { far: 24, mid: 64, near: 128, solid: 64 };

/** Angles from a0 to a1 (either way) in steps no wider than a full circle's `round`-th part. */
function arc(a0: number, a1: number, round: number): number[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * round) / TAU));
  return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n);
}

/** A court's shape: its round walls mapped by arc length and height, so their courses run on round the court. */
class CourtShape extends Shape {
  constructor() { super(8, true, true); }

  /** A piece of round wall at radius r between angles a and b, from z0 to z1 at each end, facing in (or out). */
  wall(r: number, a: number, b: number, z0a: number, z1a: number, z0b: number, z1b: number, inward: boolean, col: RGB): void {
    const base = this.vertices, s = inward ? -1 : 1;
    for (const [an, z] of [[a, z0a], [b, z0b], [b, z1b], [a, z1a]]) this.put(polar(r, an, z), [s * Math.cos(an), s * Math.sin(an), 0], col, [an * r, z]);
    if (inward === b > a) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** A court at one detail, in its own frame. */
export function buildCourt(l: CourtLayout, detail: CourtDetail): Shape {
  const sh = new CourtShape(), hr = l.handrail, look = (l.style && STYLE_STONE[l.style]) ?? PLAIN, stone = look.stone;
  const far = detail === 'far', near = detail === 'near', solid = detail === 'solid', round = ROUND[detail];
  const bury = -PART.bury * hr;
  sh.finish = look.finish;
  paving(sh, l, detail, stone);
  // The wall all the way round: a darker plinth, its face, the coping over it (not over the landing, which is flush
  // with the walk), the walk on top, its outer lip into the ground.
  const ring = arc(0, TAU, round), plinth = l.pave + PART.plinth * hr, over = PART.over * hr, thick = PART.thick * hr, dark = shade(stone, 0.72);
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1], wa = walkAt(l, a), wb = walkAt(l, b), lip = !solid && !far && !within((a + b) / 2, l.landing.a0, l.landing.a1);
    if (far || solid) sh.wall(l.face, a, b, bury, wa, bury, wb, true, stone);
    else {
      sh.wall(l.face, a, b, bury, plinth, bury, plinth, true, dark);
      sh.wall(l.face, a, b, plinth, lip ? wa - thick : wa, plinth, lip ? wb - thick : wb, true, stone);
    }
    const inner = lip ? l.face - over : l.face;
    if (lip) {
      sh.wall(inner, a, b, wa - thick, wa, wb - thick, wb, true, stone);
      sh.faceToward(polar(inner, a, wa - thick), polar(inner, b, wb - thick), polar(l.face, b, wb - thick), polar(l.face, a, wa - thick), [0, 0, -1], stone);
    }
    sh.faceToward(polar(inner, a, wa), polar(inner, b, wb), polar(l.outer, b, wb), polar(l.outer, a, wa), [0, 0, 1], stone);
    if (!solid) sh.wall(l.outer, a, b, rimAt(l, a) - PART.lip * hr, wa, rimAt(l, b) - PART.lip * hr, wb, false, stone);
  }
  if (!far && !solid) pilasters(sh, l, stone);
  // The landing and the stairs, as blocks against the wall: their tops, their open sides, the riser down from each.
  const tread = (s: CourtStep, next: number, dir: number, top: boolean): void => {
    const pts = arc(s.a0, s.a1, round * 4);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (top) sh.faceToward(polar(l.inner, a, s.top), polar(l.inner, b, s.top), polar(l.face, b, s.top), polar(l.face, a, s.top), [0, 0, 1], stone);
      sh.wall(l.inner, a, b, bury, s.top, bury, s.top, true, stone);
    }
    if (next < s.top) {
      const a = s.a1, along: Vec3 = [-Math.sin(a) * dir, Math.cos(a) * dir, 0];
      sh.faceToward(polar(l.inner, a, next), polar(l.face, a, next), polar(l.face, a, s.top), polar(l.inner, a, s.top), along, stone);
    }
  };
  l.stairs.forEach((st, k) => {
    const steps = far ? coarse(st.steps) : st.steps, land = st.dir > 0 ? l.landing : { a0: l.landing.a1, a1: l.landing.a0, top: l.landing.top };
    tread(land, steps[0]?.top ?? l.pave, st.dir, k === 0);
    steps.forEach((s, i) => tread(s, steps[i + 1]?.top ?? l.pave, st.dir, true));
  });
  portal(sh, l, detail, stone);
  if (far) return sh;
  // Railings round the walk (open over the landing) and down each stair's open side; none where the land was let go.
  if (l.style !== 'let-go') {
    const rail = (line: Vec3[]): void => { if (near || solid) railing(sh, hr, line, solid); else topRail(sh, hr, line); };
    const r = l.face + PART.inset * hr;
    rail(arc(l.landing.a1, l.landing.a0 + TAU, round).map((a) => polar(r, a, walkAt(l, a))));
    for (const st of l.stairs) {
      const ri = l.inner + PART.inset * hr, end = st.dir > 0 ? l.landing.a1 : l.landing.a0;
      rail([polar(ri, end, l.landing.top), ...st.steps.map((s) => polar(ri, (s.a0 + s.a1) / 2, s.top))]);
    }
    sh.finish = look.finish;
  }
  if (!near) return sh;
  // Benches at the wall's foot.
  for (const a of l.benches) {
    const t: Vec3 = [-Math.sin(a), Math.cos(a), 0], n: Vec3 = [-Math.cos(a), -Math.sin(a), 0], d = PART.deep * hr, z = PART.seat * hr;
    sh.block(polar(l.face - d / 2, a, l.pave + z / 2), t, n, [0, 0, 1], [(PART.bench * hr) / 2, d / 2, z / 2], stone, true);
  }
  return sh;
}

/** A colour darkened (or lightened) by a factor. */

/** Whether angle a lies within `margin` (rad) of any of the angles given. */
const nearAny = (a: number, at: readonly number[], margin: number): boolean => at.some((b) => within(a, b - margin, b + margin));

/**
 * The floor: the light well in the middle (glass over the city below, crossed by bronze ribs, a stone seat round it),
 * then rings of slabs out to the wall, every other ring a shade darker. Where the land was let go, slabs are missing.
 */
function paving(sh: CourtShape, l: CourtLayout, detail: CourtDetail, stone: RGB): void {
  const hr = l.handrail, round = ROUND[detail], far = detail === 'far', o = l.well, k = far ? o : o + l.kerb, glass = l.pave - PART.sink * hr;
  const seat = l.pave + PART.seat * hr, was = sh.finish;
  sh.finish = FINISH.ceramic;
  sh.arc(glass, o, glass, 0, 1, 0, 0, TAU, round, LANTERN);
  sh.finish = was;
  if (far) { sh.arc(l.pave, l.face, l.pave, o, 1, 0, 0, TAU, round, stone); return; }
  for (const [a, b] of pairs(arc(0, TAU, round))) {
    sh.wall(o, a, b, glass, seat, glass, seat, true, stone);
    sh.wall(k, a, b, l.pave, seat, l.pave, seat, false, stone);
  }
  sh.arc(seat, k, seat, o, 1, 0, 0, TAU, round, stone);
  if (detail !== 'solid') {
    sh.finish = FINISH.bronze;
    for (const a of [0, Math.PI / 2]) sh.block([0, 0, glass + 0.03 * hr], [Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0], [0, 0, 1], [o, 0.05 * hr, 0.03 * hr], BRONZE, true);
    sh.finish = was;
  }
  if (detail === 'solid') { sh.arc(l.pave, l.face, l.pave, k, 1, 0, 0, TAU, round, stone); return; }
  const rings = Math.max(1, Math.round((l.face - k) / (PART.ring * hr))), rng = new Rng(l.seed), gaps = l.style === 'let-go' && detail === 'near';
  for (let i = 0; i < rings; i++) {
    const r0 = k + ((l.face - k) * i) / rings, r1 = k + ((l.face - k) * (i + 1)) / rings, col = i % 2 ? shade(stone, 0.9) : stone;
    const n = Math.max(6, Math.round((TAU * r1) / (PART.slab * hr))), step = Math.max(1, Math.ceil(round / n));
    for (let j = 0; j < n; j++) {
      if (gaps && rng.chance(PART.gone)) continue;
      sh.arc(l.pave, r1, l.pave, r0, 1, 0, (j / n) * TAU, ((j + 1) / n) * TAU, step, col);
    }
  }
}

/** Consecutive pairs of a list. */
const pairs = <T>(xs: readonly T[]): [T, T][] => xs.slice(1).map((x, i) => [xs[i], x]);

/** Pilasters up the wall's face, under the coping: clear of the stairs, the portal and the benches. */
function pilasters(sh: Shape, l: CourtLayout, stone: RGB): void {
  const hr = l.handrail, n = Math.max(8, Math.round((TAU * l.face) / (PART.spacing * hr))), half = (PART.pier * hr) / 2, d = PART.proud * hr;
  const clear = (PART.door / 2 + PART.pilaster + PART.pier) * hr / l.face, bench = (PART.bench / 2 + PART.pier) * hr / l.face;
  for (let k = 0; k < n; k++) {
    const a = l.portal.angle + ((k + 0.5) / n) * TAU;
    if (within(a, l.used[0] - clear, l.used[1] + clear) || nearAny(a, [l.portal.angle], clear) || nearAny(a, l.benches, bench)) continue;
    const top = Math.min(walkAt(l, a - half / l.face), walkAt(l, a + half / l.face)) - PART.thick * hr, z0 = l.pave + PART.plinth * hr;
    sh.block(polar(l.face - d / 2 + 0.01 * hr, a, (z0 + top) / 2), [-Math.sin(a), Math.cos(a), 0], [-Math.cos(a), -Math.sin(a), 0], [0, 0, 1], [half, d / 2 + 0.01 * hr, (top - z0) / 2], stone, true);
  }
}

/** A stair from afar: a flight at a time, one block from its first top to its last. */
function coarse(steps: readonly CourtStep[]): CourtStep[] {
  const out: CourtStep[] = [];
  for (let i = 0; i < steps.length; i += FLIGHT) {
    const run = steps.slice(i, i + FLIGHT);
    out.push({ a0: run[0].a0, a1: run[run.length - 1].a1, top: run[0].top });
  }
  return out;
}

/** The portal on the wall's face: pilasters and lintel in the court's stone, bronze doors, a threshold, lamps beside it. */
function portal(sh: Shape, l: CourtLayout, detail: CourtDetail, stone: RGB): void {
  const hr = l.handrail, p = l.portal, a = p.angle, z0 = l.pave;
  const ex: Vec3 = [-Math.sin(a), Math.cos(a), 0], ey: Vec3 = [-Math.cos(a), -Math.sin(a), 0], foot = polar(l.face, a, 0);
  /** A box in the portal's frame: x along the wall, y out from its face into the court, z up from the paving. */
  const box = (x0: number, x1: number, y0: number, y1: number, za: number, zb: number, col: RGB): void => {
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
    sh.block([foot[0] + ex[0] * x + ey[0] * y, foot[1] + ex[1] * x + ey[1] * y, z0 + (za + zb) / 2], ex, ey, [0, 0, 1], [(x1 - x0) / 2, (y1 - y0) / 2, (zb - za) / 2], col);
  };
  // The frame rises through the walk above it, so the way down shows from the land around.
  const w = p.width / 2, pw = PART.pilaster * hr, pr = PART.project * hr, was = sh.finish;
  const crown = Math.max(p.high + PART.lintel * hr, walkAt(l, a) - z0 + 1.2 * hr), cap = 0.25 * hr;
  for (const s of [-1, 1]) box(s < 0 ? -w - pw : w, s < 0 ? -w : w + pw, -pr, pr, 0, crown, stone);
  box(-w, w, -pr * 0.8, pr * 0.8, p.high, crown, stone);
  box(-w - pw * 1.3, w + pw * 1.3, -pr * 1.25, pr * 1.25, crown, crown + cap, stone);
  sh.finish = FINISH.bronze;
  if (detail === 'far') {
    box(-w, w, -pr / 2, 0.02 * hr, 0, p.high, BRONZE);
    sh.finish = was;
    return;
  }
  // The doors: two bronze leaves, set a little back in the frame, on a stone threshold.
  for (const s of [-1, 1]) box(s < 0 ? -w : 0.01 * hr, s < 0 ? -0.01 * hr : w, -0.05 * hr, 0.06 * hr, 0, p.high, BRONZE);
  sh.finish = was;
  box(-w - pw, w + pw, -pr, pr + 0.4 * hr, -0.1 * hr, 0.05 * hr, stone);
  if (detail !== 'near') return;
  // The leaves' ribs, and lamps on brackets either side.
  sh.finish = FINISH.bronze;
  for (const s of [-1, 1]) {
    for (const k of [0.25, 0.55, 0.85]) box(s * w * k - 0.04 * hr, s * w * k + 0.04 * hr, 0.06 * hr, 0.09 * hr, 0.15 * hr, p.high - 0.15 * hr, BRONZE);
    const x = s * (w + pw + 0.35 * hr), z = p.high * 0.85;
    box(x - 0.05 * hr, x + 0.05 * hr, 0, 0.35 * hr, z, z + 0.08 * hr, BRONZE);
  }
  sh.finish = FINISH.ceramic;
  for (const s of [-1, 1]) {
    const x = s * (w + pw + 0.35 * hr), z = p.high * 0.85;
    box(x - 0.1 * hr, x + 0.1 * hr, 0.22 * hr, 0.42 * hr, z - 0.3 * hr, z, LANTERN);
  }
  sh.finish = was;
}

/**
 * How high the walkable top of a court is over its dug floor at a point of its frame (x, y), or null outside it: the
 * walk round the rim, the landing and stairs, the paving.
 */
export function courtTop(l: CourtLayout, x: number, y: number): number | null {
  const r = Math.hypot(x, y), a = Math.atan2(y, x);
  if (r > l.outer) return null;
  if (r >= l.face) return walkAt(l, a);
  if (r >= l.inner) {
    if (within(a, l.landing.a0, l.landing.a1)) return l.landing.top;
    for (const st of l.stairs) for (const s of st.steps) if (within(a, Math.min(s.a0, s.a1), Math.max(s.a0, s.a1))) return s.top;
  }
  if (r < l.well) return l.pave - PART.sink * l.handrail;
  if (r < l.well + l.kerb) return l.pave + PART.seat * l.handrail;
  return l.pave;
}

/** A court's floor frame: x along the axis, y around (at the floor's radius), z up from its dug floor. */
const frameOf = (c: PlacedCourt): FloorFrame => ({ theta: c.theta, s: c.s, height: c.floor, heading: 0 });

/** A point of a court's frame in the world. */
export function courtWorld(h: Habitat, c: PlacedCourt, p: Vec3): Vec3 {
  return floorPoint(h, frameOf(c), p);
}

/** Each court as a site on the floor (its walk reaches a little past its radius). */
const sitesOf = kept((t: Terrain): Site[] => t.courts.map((c) => ({ theta: c.theta, s: c.s, reach: c.radius * 1.2 })));

/**
 * The courts as things at sites (gen/siteTiles.ts): their grid, tiles, solids for the physics and the top one stands
 * on (`courtSites.topAt`: on the floor true up is the profile's normal, so this is a drop onto it). A court too small
 * to stair has nothing built.
 */
export const courtSites = siteParts({
  sites: sitesOf,
  frame: (t, i) => { const l = courtLayoutOf(t, i); return l && frameOf(l.court); },
  build: (t, i, detail) => buildCourt(courtLayoutOf(t, i)!, detail),
  at: (t, theta, s) => { const near = t.courtAt(theta, s); return (near && indexOf(t).get(near.court)) ?? null; },
  top: (t, i, x, y) => courtTop(courtLayoutOf(t, i)!, x, y),
});
