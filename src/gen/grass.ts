/**
 * Ground cover's shapes: tufts of grass blades, built once per (form, variant) and drawn as instances wherever the
 * scatter stage plants the climate's cover (`gen/scatter.ts`).
 *
 * A blade is a thin strip from a point near the tuft's middle, leaning out and drooping more toward its tip, tapering
 * to a point; its normal leans toward up, so a tuft takes the light about as the ground under it does. Each vertex
 * carries a colour (the cover's own, varied per blade: some paler, some dead; dark at the base, where the tuft shades
 * itself) and a sway weight (0 at the base … 1 at the longest tip).
 *
 * Two of each: the full tuft, and a light one for the middle distance (fewer, wider blades of the same tuft in fewer
 * segments). One unit high (base at the origin, +y up, a little below the ground so no gap shows on a slope): an
 * instance scales it to the tuft's height. Pure.
 */
import { Rng, deriveSeed, mixRgb } from '@futuremagic/core';
import type { CoverForm, Rgb } from '../blueprint';

/** A tuft: positions, normals, linear colours, sway weights, triangles. */
export interface TuftMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  wind: Float32Array;
  index: Uint32Array;
}

export interface TuftModel {
  form: CoverForm;
  full: TuftMesh;
  lite: TuftMesh;
}

interface FormCfg {
  /** Blades in the full and the light tuft. */
  blades: number;
  lite: number;
  /** Lean from upright at the base (radians), and the droop toward the tip (share of the blade's length). */
  lean: [number, number];
  droop: [number, number];
  /** Blade lengths relative to the longest, and the width at the base (share of the longest blade). */
  length: [number, number];
  width: number;
  /** The tuft's footprint radius (share of its height). */
  spread: number;
  /** Shares of blades that are paler (sun-bleached tips) and dead (straw), and the colours they turn toward. */
  pale: number;
  dead: number;
  deadColor: Rgb;
  /** How green the youngest blades of a dry tuft still are (0 none). */
  green: number;
}

const FORMS: Record<CoverForm, FormCfg> = {
  grass: { blades: 18, lite: 6, lean: [0.05, 0.42], droop: [0.05, 0.25], length: [0.55, 1], width: 0.04, spread: 0.32, pale: 0.25, dead: 0.08, deadColor: [0.36, 0.3, 0.15], green: 0 },
  'dry-grass': { blades: 22, lite: 7, lean: [0.1, 0.55], droop: [0.1, 0.35], length: [0.5, 1], width: 0.028, spread: 0.36, pale: 0.35, dead: 0.25, deadColor: [0.42, 0.38, 0.27], green: 0.12 },
};

/** Where along a blade its rows of points sit, full and light; the tip is one point. */
const ROWS_FULL = [0, 0.3, 0.55, 0.8, 1];
const ROWS_LITE = [0, 0.55, 1];
/** How far the base sinks below the ground (share of the height). */
const SINK = 0.06;
/** How far a blade's normal leans toward up (1 the ground's light, 0 the blade's own face). */
const TOWARD_UP = 0.6;

interface Blade {
  x: number; z: number;
  /** Direction it leans toward (radians about up), lean, droop, length, base width, its colour. */
  phi: number; lean: number; droop: number; length: number; width: number;
  color: [number, number, number];
}

/** A tuft of a form, in the cover's colour: its full and its light shape. */
export function buildTuft(form: CoverForm, color: Rgb, seed: number, variant: number): TuftModel {
  const cfg = FORMS[form], rng = new Rng(deriveSeed(seed, 'tuft', form, variant));
  const blades: Blade[] = [];
  for (let b = 0; b < cfg.blades; b++) {
    const r = cfg.spread * Math.sqrt(rng.float()), a = rng.range(0, 2 * Math.PI);
    // Blades lean outward from the middle, give or take.
    const phi = a + rng.range(-0.7, 0.7);
    const lean = rng.range(cfg.lean[0], cfg.lean[1]) * (0.5 + r / cfg.spread);
    const length = rng.range(cfg.length[0], cfg.length[1]);
    let c: [number, number, number] = [color[0], color[1], color[2]];
    const v = rng.range(0.85, 1.15);
    c = [c[0] * v, c[1] * v * rng.range(0.95, 1.05), c[2] * v];
    if (rng.chance(cfg.dead)) c = mixRgb(c, [...cfg.deadColor], rng.range(0.6, 1));
    else if (rng.chance(cfg.pale)) c = mixRgb(c, [c[0] * 1.35 + 0.03, c[1] * 1.25 + 0.02, c[2] * 1.1], rng.range(0.3, 0.8));
    if (cfg.green && rng.chance(cfg.green)) c = mixRgb(c, [0.12, 0.2, 0.06], rng.range(0.4, 0.8));
    blades.push({ x: r * Math.cos(a), z: r * Math.sin(a), phi, lean, droop: rng.range(cfg.droop[0], cfg.droop[1]), length, width: cfg.width * rng.range(0.75, 1.25), color: c });
  }
  // The light tuft: the longest blades, wider, so it covers about as much.
  const longest = [...blades].sort((p, q) => q.length - p.length).slice(0, cfg.lite);
  const widen = Math.sqrt(cfg.blades / cfg.lite);
  const full = mesh(blades, ROWS_FULL, 1), lite = mesh(longest, ROWS_LITE, widen);
  // One unit high: the full tuft's highest point; the light one at the same scale; then the base sunk a little.
  let top = 0;
  for (let i = 1; i < full.positions.length; i += 3) top = Math.max(top, full.positions[i]);
  for (const m of [full, lite]) for (let i = 0; i < m.positions.length; i++) m.positions[i] = m.positions[i] / top - (i % 3 === 1 ? SINK * (1 - m.positions[i] / top) : 0);
  return { form, full, lite };
}

/** The blades as strips: two points per row, one at the tip. */
function mesh(blades: readonly Blade[], rows: readonly number[], widen: number): TuftMesh {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], wind: number[] = [], idx: number[] = [];
  for (const b of blades) {
    const lx = Math.cos(b.phi), lz = Math.sin(b.phi), sl = Math.sin(b.lean), cl = Math.cos(b.lean);
    // Across the blade: horizontal, square to where it leans.
    const sx = -lz, sz = lx;
    const first = pos.length / 3;
    rows.forEach((t, k) => {
      const tip = k === rows.length - 1;
      // Up and out along the lean, drooping outward and down with the square of the way along.
      const along = b.length * t, d = b.droop * b.length * t * t;
      // A drooping tip still stands clear of the ground.
      const px = b.x + lx * (sl * along + d), py = Math.max(cl * along - d * 0.8, along * 0.15), pz = b.z + lz * (sl * along + d);
      // The tangent there, and the face normal: across × tangent, turned to face up.
      const tx = lx * (sl + 2 * b.droop * t), ty = cl - 1.6 * b.droop * t, tz = lz * (sl + 2 * b.droop * t);
      let nx = sz * ty, ny = sx * tz - sz * tx, nz = -sx * ty;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / nl) * (1 - TOWARD_UP); ny = (ny / nl) * (1 - TOWARD_UP) + TOWARD_UP; nz = (nz / nl) * (1 - TOWARD_UP);
      const n2 = Math.hypot(nx, ny, nz);
      // Darker at the base, where the tuft shades itself; the tip a little lighter.
      const shade = 0.4 + 0.75 * Math.pow(t, 0.7);
      const c = [b.color[0] * shade, b.color[1] * shade, b.color[2] * shade];
      const w = t * b.length;
      const half = tip ? 0 : (b.width * widen * (1 - Math.pow(t, 1.6) * 0.8)) / 2;
      for (const side of tip ? [0] : [-1, 1]) {
        pos.push(px + sx * half * side, py, pz + sz * half * side);
        nrm.push(nx / n2, ny / n2, nz / n2);
        col.push(c[0], c[1], c[2]);
        wind.push(w);
      }
    });
    // Quads between rows, a triangle at the tip.
    for (let k = 0; k < rows.length - 2; k++) {
      const a = first + 2 * k;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const last = first + 2 * (rows.length - 2);
    idx.push(last, last + 1, last + 2);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), wind: new Float32Array(wind), index: new Uint32Array(idx) };
}
