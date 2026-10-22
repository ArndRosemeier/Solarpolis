/**
 * What was built of a grown hall besides its trees (the trees: gen/planted.ts, `Hall`): two centuries of training. From
 * each trunk, at a third of its height, limbs were led across the nave and grafted to the opposite tree's (the
 * transverse arches, pointed), crosswise to the next bay's (the diagonal ribs, meeting at the bay's middle), along the
 * row to the next tree (the arcade) and along the crown line from arch to arch (the ridge); where two limbs met they
 * fused in a knot. Low down, young stems woven between the trunks make a lattice screen, left open where a path comes
 * in. Inside, people cook and gather: a long table with benches down the nave, a stone hearth at one end, a low stone
 * dais at the other for whoever plays or speaks.
 *
 * Built in the hall's frame (`Hall.frame`: x along the nave, y across, z up from the ground at its middle), its parts
 * as shares of the trees' height (`LIMB`) or in metres for what people use (`FURNITURE`). Halls are things at sites
 * (`hallSites`, gen/siteTiles.ts: tiles over the floor, far, mid and near, `solids` for the physics, `topAt` the dais
 * one stands on); `hallKeepsClear` is where plants keep off. Pure.
 */
import { Rng, type Vec3 } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { hallGroundAt, inHall, plantingsOf, type Hall } from './planted';
import { STYLE_STONE } from './courts';
import { FINISH } from './pavilion';
import { kept } from './kept';
import { Shape, shade, type RGB } from './shapes';
import { siteParts, type Site, type SiteDetail } from './siteTiles';

/** The trained limbs, as shares of the trees' height (and rises as shares of half the span they cross). */
export const LIMB = {
  /** Where the arches and ribs spring from the trunks; the arcade a little lower. */
  spring: 0.34, arcade: 0.26,
  /** How high a transverse arch rises over half the span (over 1: pointed), an arcade arch over half a bay. */
  rise: 1.25, arcadeRise: 1.1,
  /** A limb's radius where it springs, and where it meets the other at the crown (shares of the springing radius). */
  radius: 0.011, tip: 0.6, diagonal: 0.8, arcadeLimb: 0.7, ridge: 0.5, knot: 1.6,
};

/** What people use, in metres: the lattice screen, the table, benches, hearth and dais. */
export const FURNITURE = {
  lattice: { low: 0.25, high: 2.1, gap: 0.55, stem: 0.03, clear: 0.7 },
  table: { top: 0.76, half: 0.5, slab: 0.07, piece: 4.8 },
  bench: { top: 0.46, out: 0.95, half: 0.17 },
  hearth: { long: 2.6, wide: 1.5, high: 0.9 },
  dais: { high: 0.45, along: 0.55, across: 0.3 },
};

/** Linden bark, a grey brown; oiled oak for what was made; the fire bed's soot. */
const BARK: RGB = [0.15, 0.13, 0.11];
const OAK: RGB = [0.3, 0.22, 0.14];
const SOOT: RGB = [0.05, 0.045, 0.04];

/** Where column (line, side) springs at a share of the trees' height over its own ground. */
const springOf = (hall: Hall, line: number, side: -1 | 1, share: number): Vec3 => {
  const c = hall.columns[line * 2 + (side > 0 ? 1 : 0)];
  return [c.x, c.y, c.ground + share * hall.height];
};

/** The crown of transverse arch `line`: over the middle of the nave, `rise` of half the span over its higher springing. */
const crownOf = (hall: Hall, line: number): Vec3 => {
  const a = springOf(hall, line, -1, LIMB.spring), b = springOf(hall, line, 1, LIMB.spring);
  return [a[0], 0, Math.max(a[2], b[2]) + (LIMB.rise * hall.span) / 2];
};

/**
 * Half an arch from a springing to its crown: an arc of a circle whose centre lies level with the springing (so the
 * limb leaves the trunk upright), through the crown. Pointed where it rises more than it spans.
 */
export function halfArch(from: Vec3, crown: Vec3, segs: number): Vec3[] {
  const dx = crown[0] - from[0], dy = crown[1] - from[1], D = Math.hypot(dx, dy), rise = crown[2] - from[2];
  const ux = dx / D, uy = dy / D, rho = (D * D + rise * rise) / (2 * D), end = Math.atan2(rise, D - rho), out: Vec3[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = Math.PI + ((end - Math.PI) * k) / segs, u = rho + rho * Math.cos(a);
    out.push([from[0] + ux * u, from[1] + uy * u, from[2] + rho * Math.sin(a)]);
  }
  return out;
}

/** A limb from a springing up to a crown, tapering. */
function limb(sh: Shape, from: Vec3, crown: Vec3, r0: number, sides: number, segs: number): void {
  const pts = halfArch(from, crown, segs);
  sh.curvedTube(pts, pts.map((_, k) => r0 * (1 - (1 - LIMB.tip) * Math.pow(k / segs, 0.7))), sides, BARK);
}

/** A graft knot: a swelling round a point, along an axis. */
function knot(sh: Shape, at: Vec3, axis: Vec3, r: number, sides: number): void {
  const pts: Vec3[] = [-1, -0.5, 0, 0.5, 1].map((u) => [at[0] + axis[0] * u * r * 2, at[1] + axis[1] * u * r * 2, at[2] + axis[2] * u * r * 2]);
  sh.curvedTube(pts, [0.55, 0.95, 1.15, 0.95, 0.55].map((k) => k * r), sides, shade(BARK, 0.9));
}

/** A grown hall's built parts at one detail, in its frame. */
export function buildHall(hall: Hall, detail: SiteDetail): Shape {
  const sh = new Shape(8, true, true);
  if (detail === 'solid') { solidParts(sh, hall); return sh; }
  const far = detail === 'far', near = detail === 'near', H = hall.height, r0 = LIMB.radius * H;
  const sides = far ? 4 : near ? 9 : 6, segs = far ? 5 : near ? 14 : 8;
  sh.finish = FINISH.timber;
  // The transverse arches: from each pair of trunks across the nave to a pointed crown.
  for (let line = 0; line <= hall.bays; line++) {
    const crown = crownOf(hall, line);
    for (const side of [-1, 1] as const) limb(sh, springOf(hall, line, side, LIMB.spring), crown, r0, sides, segs);
    if (near) knot(sh, crown, [1, 0, 0], r0 * LIMB.tip * LIMB.knot, sides);
  }
  if (!far) {
    for (let line = 0; line < hall.bays; line++) {
      const a = crownOf(hall, line), b = crownOf(hall, line + 1), mid: Vec3 = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
      // The diagonal ribs, crossing at the bay's middle, and the ridge along the crowns through it.
      for (const side of [-1, 1] as const) {
        limb(sh, springOf(hall, line, side, LIMB.spring), mid, r0 * LIMB.diagonal, sides, segs);
        limb(sh, springOf(hall, line + 1, side, LIMB.spring), mid, r0 * LIMB.diagonal, sides, segs);
      }
      const rr = r0 * LIMB.tip * LIMB.ridge;
      sh.curvedTube([a, mid, b], [rr, rr * 1.1, rr], sides, BARK);
      if (near) knot(sh, mid, [0, 1, 0], r0 * LIMB.tip * LIMB.knot, sides);
      // The arcade: each row's neighbours joined by a lower arch.
      for (const side of [-1, 1] as const) {
        const p = springOf(hall, line, side, LIMB.arcade), q = springOf(hall, line + 1, side, LIMB.arcade);
        const top: Vec3 = [(p[0] + q[0]) / 2, p[1], Math.max(p[2], q[2]) + (LIMB.arcadeRise * hall.bay) / 2];
        limb(sh, p, top, r0 * LIMB.arcadeLimb, sides, segs);
        limb(sh, q, top, r0 * LIMB.arcadeLimb, sides, segs);
      }
    }
    furniture(sh, hall, near);
  }
  if (near) {
    roots(sh, hall);
    lattice(sh, hall, true);
  } else if (!far) lattice(sh, hall, false);
  return sh;
}

/** Root buttresses round each trunk's foot, spreading into the ground. */
function roots(sh: Shape, hall: Hall): void {
  const H = hall.height, rng = new Rng(hall.seed + 3);
  for (const c of hall.columns) {
    const n = 5, turn = c.tree.turn;
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * 2 * Math.PI + rng.range(-0.25, 0.25), out = H * rng.range(0.06, 0.08), cx = Math.cos(a), sy = Math.sin(a);
      const rootAt = (u: number, z: number): Vec3 => [c.x + cx * u, c.y + sy * u, hallGroundAt(hall, c.x + cx * u, c.y + sy * u) + z];
      const pts = [rootAt(H * 0.012, H * 0.04), rootAt(out * 0.35, H * 0.016), rootAt(out * 0.7, 0.05), rootAt(out, -0.15)];
      sh.curvedTube(pts, [H * 0.012, H * 0.008, H * 0.005, H * 0.003], 6, BARK);
    }
  }
}

/** Whether a side's bay is left open: where a path comes in, and the middle bay each side (the doors). */
const isOpen = (hall: Hall, side: number, i: number): boolean => hall.open.has(`${side},${i}`) || i === Math.floor(hall.bays / 2);

/** The woven screen between the trunks of each side, low enough to see over: rails, and (near) the woven stems. */
function lattice(sh: Shape, hall: Hall, stems: boolean): void {
  const L = FURNITURE.lattice;
  for (const side of [-1, 1] as const) {
    const y = (side * hall.span) / 2;
    for (let i = 0; i < hall.bays; i++) {
      if (isOpen(hall, side, i)) continue;
      const xa = -hall.half + i * hall.bay + L.clear, xb = xa + hall.bay - 2 * L.clear, g = (x: number): number => hallGroundAt(hall, x, y);
      // The rails: trained along, following the ground.
      for (const z of [L.low, L.high]) {
        const pts: Vec3[] = [0, 0.25, 0.5, 0.75, 1].map((u) => [xa + (xb - xa) * u, y, g(xa + (xb - xa) * u) + z]);
        sh.curvedTube(pts, pts.map(() => L.stem * 1.6), stems ? 6 : 4, BARK);
      }
      if (!stems) continue;
      // The stems: rising both ways at 45°, crossing in diamonds, each from rail to rail (or a trunk's side).
      const tall = L.high - L.low;
      for (let x0 = xa - tall; x0 < xb; x0 += L.gap) {
        for (const dir of [1, -1]) {
          // From its foot on the low rail at `foot`, rising `dir` along x.
          const foot = dir > 0 ? x0 : x0 + tall, lo = Math.max(xa, Math.min(foot, foot + dir * tall)), hi = Math.min(xb, Math.max(foot, foot + dir * tall));
          if (hi - lo < 0.05) continue;
          const z = (x: number): number => g(x) + L.low + dir * (x - foot);
          sh.curvedTube([[lo, y, z(lo)], [hi, y, z(hi)]], [L.stem, L.stem], 4, shade(BARK, 1.1));
        }
      }
    }
  }
}

/** The stone of the grove commons. */
const STONE = STYLE_STONE.grove.stone;

/** Where the table, the hearth and the dais stand along the nave. */
function layout(hall: Hall): { table: [number, number]; hearth: number; dais: number } {
  return { table: [-hall.half + hall.bay * 1.4, hall.half - hall.bay * 1.6], hearth: hall.half - hall.bay * 0.75, dais: -hall.half + hall.bay * 0.7 };
}

/** The lowest and highest ground under a rectangle of the frame. */
function groundUnder(hall: Hall, x0: number, x1: number, y0: number, y1: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
    const g = hallGroundAt(hall, x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * j) / 2);
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  return [lo, hi];
}

/** The long table in pieces (each level on its own ground), the benches, the hearth and the dais. */
function furniture(sh: Shape, hall: Hall, near: boolean): void {
  const F = FURNITURE, at = layout(hall), [t0, t1] = at.table, n = Math.max(1, Math.round((t1 - t0) / F.table.piece)), len = (t1 - t0) / n;
  sh.finish = FINISH.timber;
  for (let k = 0; k < n; k++) {
    const x0 = t0 + k * len + 0.05, x1 = x0 + len - 0.1, xm = (x0 + x1) / 2, [lo, hi] = groundUnder(hall, x0, x1, -F.bench.out - F.bench.half, F.bench.out + F.bench.half);
    const top = hi + F.table.top;
    sh.block([xm, 0, top - F.table.slab / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2, F.table.half, F.table.slab / 2], OAK);
    // Trestles, and the benches' legs, down to the lowest ground under them.
    for (const xl of [x0 + 0.5, x1 - 0.5]) {
      const legH = top - F.table.slab - (lo - 0.05);
      sh.block([xl, 0, lo - 0.05 + legH / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.05, F.table.half * 0.8, legH / 2], shade(OAK, 0.85), true);
      for (const side of [-1, 1]) {
        const bh = hi + F.bench.top - 0.04 - (lo - 0.05);
        sh.block([xl, side * F.bench.out, lo - 0.05 + bh / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.04, F.bench.half * 0.8, bh / 2], shade(OAK, 0.85), true);
      }
    }
    for (const side of [-1, 1]) sh.block([xm, side * F.bench.out, hi + F.bench.top - 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2 - 0.1, F.bench.half, 0.02], OAK);
    if (near) sh.block([xm, 0, top - F.table.slab - 0.06], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2 - 0.55, 0.03, 0.05], shade(OAK, 0.8));
  }
  sh.finish = STYLE_STONE.grove.finish;
  // The hearth: a stone block, its fire bed sunk in its top, a low back wall against the wind.
  const hx = at.hearth, hw = F.hearth, [hlo, hhi] = groundUnder(hall, hx - hw.wide / 2, hx + hw.wide / 2, -hw.long / 2, hw.long / 2), top = hhi + hw.high;
  sh.block([hx, 0, (top + hlo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hw.wide / 2, hw.long / 2, (top - hlo + 0.2) / 2], STONE, true);
  sh.block([hx + hw.wide / 2 - 0.15, 0, top + 0.35], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.15, hw.long / 2, 0.35], shade(STONE, 0.9));
  if (near) sh.block([hx - 0.1, 0, top + 0.012], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hw.wide / 2 - 0.35, hw.long / 2 - 0.25, 0.012], SOOT);
  // The dais: a low stone floor across the nave's end, a step before it.
  const d = daisOf(hall), [dlo] = groundUnder(hall, d.x0, d.x1, -d.half, d.half);
  sh.block([(d.x0 + d.x1) / 2, 0, (d.top + dlo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(d.x1 - d.x0) / 2, d.half, (d.top - dlo + 0.2) / 2], STONE, true);
  if (near) sh.block([d.x1 + 0.18, 0, (d.top - FURNITURE.dais.high / 2 + dlo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.18, d.half * 0.9, (d.top - FURNITURE.dais.high / 2 - dlo + 0.2) / 2], shade(STONE, 1.05), true);
  sh.finish = FINISH.timber;
}

/** The dais: from x0 to x1, half as wide across, its top over the frame. */
export function daisOf(hall: Hall): { x0: number; x1: number; half: number; top: number } {
  const D = FURNITURE.dais, x = layout(hall).dais, along = (D.along * hall.bay) / 2, half = D.across * hall.span;
  const [, hi] = groundUnder(hall, x - along, x + along, -half, half);
  return { x0: x - along, x1: x + along, half, top: hi + D.high };
}

/** What the physics touches: the table and benches as blocks, the hearth, the dais, the lattice as walls. */
function solidParts(sh: Shape, hall: Hall): void {
  const F = FURNITURE, at = layout(hall), [t0, t1] = at.table, [lo, hi] = groundUnder(hall, t0, t1, -F.bench.out - F.bench.half, F.bench.out + F.bench.half);
  sh.block([(t0 + t1) / 2, 0, (hi + F.table.top + lo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(t1 - t0) / 2, F.table.half, (hi + F.table.top - lo + 0.2) / 2], OAK);
  for (const side of [-1, 1]) sh.block([(t0 + t1) / 2, side * F.bench.out, (hi + F.bench.top + lo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(t1 - t0) / 2, F.bench.half, (hi + F.bench.top - lo + 0.2) / 2], OAK);
  const hx = at.hearth, hw = F.hearth, [hlo, hhi] = groundUnder(hall, hx - hw.wide / 2, hx + hw.wide / 2, -hw.long / 2, hw.long / 2);
  sh.block([hx, 0, (hhi + hw.high + hlo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hw.wide / 2, hw.long / 2, (hhi + hw.high - hlo + 0.2) / 2], STONE);
  const d = daisOf(hall), [dlo] = groundUnder(hall, d.x0, d.x1, -d.half, d.half);
  sh.block([(d.x0 + d.x1) / 2, 0, (d.top + dlo - 0.2) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(d.x1 - d.x0) / 2, d.half, (d.top - dlo + 0.2) / 2], STONE);
  const L = F.lattice;
  for (const side of [-1, 1] as const) {
    const y = (side * hall.span) / 2;
    for (let i = 0; i < hall.bays; i++) {
      if (isOpen(hall, side, i)) continue;
      const xa = -hall.half + i * hall.bay + L.clear, xb = xa + hall.bay - 2 * L.clear, ga = hallGroundAt(hall, xa, y), gb = hallGroundAt(hall, xb, y);
      sh.faceToward([xa, y, ga - 0.1], [xb, y, gb - 0.1], [xb, y, gb + L.high], [xa, y, ga + L.high], [0, side, 0], BARK);
      sh.faceToward([xa, y, ga - 0.1], [xb, y, gb - 0.1], [xb, y, gb + L.high], [xa, y, ga + L.high], [0, -side, 0], BARK);
    }
  }
}

/** The walkable top of a hall at a point of its frame: the dais, or null. */
export function hallTop(hall: Hall, x: number, y: number): number | null {
  const d = daisOf(hall);
  return x >= d.x0 && x <= d.x1 && Math.abs(y) <= d.half ? d.top : null;
}

/** Each hall as a site on the floor. */
const sitesOf = kept((t: Terrain): Site[] => plantingsOf(t).halls.map((hall) => ({ theta: hall.frame.theta, s: hall.frame.s, reach: Math.hypot(hall.half + hall.bay, hall.span / 2 + 2) })));

/** The index of the hall over (θ, s) (within `margin` of its trunks), or null. */
function hallNear(t: Terrain, theta: number, s: number, margin: number): number | null {
  const all = plantingsOf(t).halls;
  for (let i = 0; i < all.length; i++) if (inHall(t, all[i], theta, s, margin)) return i;
  return null;
}

/** The grown halls as things at sites (gen/siteTiles.ts): their grid, tiles, solids and the dais one stands on. */
export const hallSites = siteParts({
  sites: sitesOf,
  frame: (t, i) => plantingsOf(t).halls[i].frame,
  build: (t, i, detail) => buildHall(plantingsOf(t).halls[i], detail),
  at: (t, theta, s) => hallNear(t, theta, s, 0),
  top: (t, i, x, y) => hallTop(plantingsOf(t).halls[i], x, y),
});

/** Whether plants keep off a point: under the table and benches, the hearth or the dais (grass grows elsewhere in it). */
export function hallKeepsClear(t: Terrain, theta: number, s: number): boolean {
  const i = hallNear(t, theta, s, 1), hall = i === null ? null : plantingsOf(t).halls[i];
  if (!hall) return false;
  const [x, y] = inHall(t, hall, theta, s, 1)!, at = layout(hall), F = FURNITURE, m = 0.3;
  if (x >= at.table[0] - m && x <= at.table[1] + m && Math.abs(y) <= F.bench.out + F.bench.half + m) return true;
  if (Math.abs(x - at.hearth) <= F.hearth.wide / 2 + m && Math.abs(y) <= F.hearth.long / 2 + m) return true;
  const d = daisOf(hall);
  return x >= d.x0 - m && x <= d.x1 + 0.4 + m && Math.abs(y) <= d.half + m;
}

