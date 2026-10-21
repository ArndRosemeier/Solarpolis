/**
 * The habitat plan drawn as maps from above (the Blueprint tab's "Land plan"): the floor unrolled (the wild end left,
 * the port end right, once round the axis top to bottom) and each endcap face-on, as seen from the floor. Colours say
 * what the plan made of the land: the reserve, each district's style, the Gate's faces, the Mountain's gravity bands
 * and its snow; lines are the planned rivers, the Sunwalk, the ways and the trail; dots the entrances and landmarks.
 *
 * Plain arrays, no DOM: the Lab puts them on a canvas, and a script can write them out as pictures.
 */
import { wrapAngle, type DistrictStyle } from '../blueprint';
import type { FaceKind, Plan, PlanPath, PlannedRiver } from '../gen/plan';

export interface PlanImage {
  width: number;
  height: number;
  /** RGBA, row by row from the top. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

type Rgb = readonly [number, number, number];

/** The map's colours (sRGB, 0 … 1). */
export const STYLE_COLORS: Readonly<Record<DistrictStyle, Rgb>> = {
  orchard: [0.66, 0.74, 0.36],
  water: [0.46, 0.7, 0.72],
  stone: [0.74, 0.71, 0.62],
  grove: [0.33, 0.55, 0.3],
  herd: [0.78, 0.76, 0.48],
  play: [0.86, 0.82, 0.52],
  makers: [0.82, 0.62, 0.46],
  'let-go': [0.45, 0.52, 0.34],
};
export const FACE_COLORS: Readonly<Record<FaceKind, Rgb>> = {
  stair: [0.86, 0.78, 0.64],
  vine: [0.6, 0.56, 0.3],
  water: [0.5, 0.7, 0.76],
};
const RESERVE: Rgb = [0.22, 0.36, 0.2];
const LAKE: Rgb = [0.24, 0.45, 0.66];
const RIVER: Rgb = [0.3, 0.55, 0.8];
const CANAL: Rgb = [0.38, 0.62, 0.86];
const SUNWALK: Rgb = [1, 0.86, 0.35];
const WAY: Rgb = [0.97, 0.95, 0.88];
const TRAIL: Rgb = [0.92, 0.82, 0.62];
const ENTRANCE: Rgb = [0.18, 0.14, 0.1];
const LANDMARK: Rgb = [0.75, 0.12, 0.1];
const SNOW: Rgb = [0.95, 0.96, 0.98];
/** The Mountain by band, from its foot to its top (the top is snow). */
const MOUNTAIN: readonly Rgb[] = [[0.24, 0.38, 0.22], [0.4, 0.46, 0.3], [0.6, 0.6, 0.5], SNOW];
const BANDS = ['foot', 'middle', 'high', 'top'] as const;

/** The colour of the plan at a point, and an id for the region it is in (borders are drawn where ids change). */
function colorAt(plan: Plan, theta: number, s: number, out: number[]): number {
  const { profile } = plan.habitat;
  const band = BANDS.indexOf(plan.bandAt(s));
  const { across, valley } = plan.acrossAt(theta, s);
  // Valleys darker, ridges lighter: the relief the plan asks for, read like a shaded map.
  const relief = 0.86 + 0.2 * Math.abs(across);
  let c: Rgb, id: number;
  if (s < profile.floorStart) {
    c = MOUNTAIN[band];
    id = 1000 + band;
    if (band < 3) {
      // The cirque's hollow reads darker, the summit's flank lighter.
      const toSummit = Math.cos(theta - plan.mountain.summit);
      c = c.map((v) => v * (0.92 + 0.12 * toSummit)) as unknown as Rgb;
    }
  } else if (s > profile.floorEnd) {
    const face = plan.faceAt(theta);
    c = FACE_COLORS[face.kind].map((v) => v * (0.82 + 0.06 * band)) as unknown as Rgb;
    id = 2000 + face.index * 10 + band;
  } else if (plan.lake && Math.abs(s - plan.lake.s) < plan.lake.halfWidth) {
    c = LAKE;
    id = 3000;
  } else if (s < plan.reserveEnd) {
    c = RESERVE;
    id = 4000;
  } else {
    const d = plan.districtAt(theta, s);
    c = d ? STYLE_COLORS[d.style] : RESERVE;
    id = d ? d.id : 4001;
  }
  const k = c === LAKE || c === SNOW ? 1 : relief;
  out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  return id * 8 + (valley & 7);
}

function emptyImage(width: number, height: number): PlanImage {
  return { width, height, data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)) };
}

/** Fills the image from a function giving (θ, s) per pixel (null: outside the map), then darkens region borders. */
function paint(plan: Plan, img: PlanImage, where: (x: number, y: number) => [number, number] | null): void {
  const { width, height, data } = img, ids = new Int32Array(width * height).fill(-1), c = [0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = where(x + 0.5, y + 0.5), i = y * width + x;
    if (!p) continue;
    ids[i] = colorAt(plan, p[0], p[1], c) >> 3;
    data[i * 4] = c[0] * 255; data[i * 4 + 1] = c[1] * 255; data[i * 4 + 2] = c[2] * 255; data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const i = y * width + x;
    if (ids[i] < 0 || ids[i + 1] < 0 || ids[i + width] < 0) continue;
    if (ids[i] !== ids[i + 1] || ids[i] !== ids[i + width]) for (let k = 0; k < 3; k++) data[i * 4 + k] *= 0.6;
  }
}

/** A round dot of radius r at (x, y). */
function dot(img: PlanImage, x: number, y: number, r: number, c: Rgb): void {
  const { width, height, data } = img;
  for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
    if (i < 0 || j < 0 || i >= width || j >= height) continue;
    const d = Math.hypot(i + 0.5 - x, j + 0.5 - y), a = Math.min(1, Math.max(0, r + 0.5 - d));
    if (a <= 0) continue;
    const k = (j * width + i) * 4;
    for (let n = 0; n < 3; n++) data[k + n] += (c[n] * 255 - data[k + n]) * a;
  }
}

/** A line through (θ, s) points, mapped to pixels by `to`; a step that jumps more than `jump` pixels is not drawn. */
function line(img: PlanImage, pts: readonly [number, number][], to: (theta: number, s: number) => [number, number] | null, width: number, c: Rgb, jump: number): void {
  let prev: [number, number] | null = null;
  for (const [theta, s] of pts) {
    const p = to(theta, s);
    if (p && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < jump) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) * 2));
      for (let k = 0; k <= n; k++) dot(img, prev[0] + ((p[0] - prev[0]) * k) / n, prev[1] + ((p[1] - prev[1]) * k) / n, width / 2, c);
    }
    prev = p;
  }
}

/** A path's points as (θ, s) pairs. */
function pointsOf(path: PlanPath): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.points.length; i += 2) out.push([path.points[i], path.points[i + 1]]);
  return out;
}

/** A planned river's line, from its spring to the lake's middle. */
function riverPoints(plan: Plan, r: PlannedRiver): [number, number][] {
  const mouth = plan.lake?.s ?? (plan.habitat.profile.floorStart + plan.habitat.profile.floorEnd) / 2;
  const out: [number, number][] = [];
  for (let k = 0; k <= 200; k++) {
    const s = r.spring + ((mouth - r.spring) * k) / 200;
    out.push([plan.routeOf(r, s), s]);
  }
  return out;
}

/** Draws the rivers, paths and sites over a painted map. */
function overlay(plan: Plan, img: PlanImage, to: (theta: number, s: number) => [number, number] | null, scale: number): void {
  const jump = img.width / 3;
  for (const r of plan.rivers) line(img, riverPoints(plan, r), to, r.role === 'great' ? 2.5 : r.role === 'canal' ? 2 : 1.5, r.role === 'canal' ? CANAL : RIVER, jump);
  for (const p of plan.paths) if (p.kind === 'way') line(img, pointsOf(p), to, 1, WAY, jump);
  for (const p of plan.paths) if (p.kind !== 'way') line(img, pointsOf(p), to, p.kind === 'sunwalk' ? 2.5 : 1.5, p.kind === 'sunwalk' ? SUNWALK : TRAIL, jump);
  for (const site of plan.sites) {
    const p = to(site.theta, site.s);
    if (!p) continue;
    if (site.kind === 'entrance') dot(img, p[0], p[1], Math.max(1.2, site.size * scale), ENTRANCE);
    else { dot(img, p[0], p[1], 5, [1, 1, 1]); dot(img, p[0], p[1], 3.5, LANDMARK); }
  }
}

/**
 * The floor unrolled: s from the Mountain's foot (left) to the Gate's foot (right), θ from 0 (top) once round. As
 * tall as the floor's circumference at the width's scale.
 */
export function floorMap(plan: Plan, width: number): PlanImage {
  const { profile } = plan.habitat, R = plan.habitat.radius;
  const s0 = profile.floorStart, s1 = profile.floorEnd, scale = width / (s1 - s0);
  const height = Math.max(1, Math.round(2 * Math.PI * R * scale));
  const img = emptyImage(width, height);
  paint(plan, img, (x, y) => [(y / height) * 2 * Math.PI, s0 + x / scale]);
  const to = (theta: number, s: number): [number, number] | null => {
    if (s < s0 || s > s1) return null;
    return [(s - s0) * scale, (wrapAngle(theta) / (2 * Math.PI)) * height];
  };
  overlay(plan, img, to, scale);
  return img;
}

/** Where a pixel of the map is: (θ, s) from the map's position, for labels. Inverse of the floor map's mapping. */
export function floorPixel(plan: Plan, width: number, theta: number, s: number): [number, number] {
  const { profile } = plan.habitat, R = plan.habitat.radius;
  const scale = width / (profile.floorEnd - profile.floorStart), height = Math.round(2 * Math.PI * R * scale);
  return [(s - profile.floorStart) * scale, (wrapAngle(theta) / (2 * Math.PI)) * height];
}

/**
 * One endcap face-on, as seen from the floor looking at it: the axis in the middle, the endcap's foot at the rim. The
 * port end's hub is the hole in the middle.
 */
export function endcapMap(plan: Plan, end: 'wild' | 'port', size: number): PlanImage {
  const { profile } = plan.habitat, R = plan.habitat.radius;
  const img = emptyImage(size, size), half = size / 2;
  // r → s on this endcap: the profile sampled from the axis out to the foot.
  const n = 512, a = end === 'wild' ? 0 : profile.length, b = end === 'wild' ? profile.floorStart : profile.floorEnd;
  const rs = new Float64Array(n + 1), ss = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { ss[i] = a + ((b - a) * i) / n; rs[i] = profile.at(ss[i]).r; }
  const sOf = (r: number): number | null => {
    if (r < rs[0] || r > rs[n]) return null;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rs[m] < r) lo = m; else hi = m; }
    const t = (r - rs[lo]) / Math.max(rs[hi] - rs[lo], 1e-9);
    return ss[lo] + (ss[hi] - ss[lo]) * t;
  };
  // Seen from the floor: looking toward +z at the port end the world's x runs to the left, toward −z at the wild end to the right.
  const flip = end === 'port' ? -1 : 1;
  paint(plan, img, (x, y) => {
    const u = (x - half) / half, v = (half - y) / half, r = Math.hypot(u, v) * R;
    const s = sOf(r);
    return s === null ? null : [Math.atan2(v, u * flip), s];
  });
  const to = (theta: number, s: number): [number, number] | null => {
    if (end === 'wild' ? s > profile.floorStart : s < profile.floorEnd) return null;
    const r = profile.at(s).r / R;
    return [half + flip * Math.cos(theta) * r * half, half - Math.sin(theta) * r * half];
  };
  overlay(plan, img, to, half / R);
  return img;
}
