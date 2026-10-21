/**
 * Ported from Scale src/render/texgen/core.ts and paint.ts: texture synthesis for tileable surfaces.
 *
 * Periodic (tileable) noise, periodic Worley cells, wrapped blurs, z-buffered stamping (strokes, splats, pebbles),
 * and the packing of albedo, roughness, height, normal and occlusion into RGBA8 layers. Every layer tiles seamlessly
 * and is fully deterministic. Pure: runs in a worker and in Node.
 *
 * Convention: pixel (i, j) is at u = (i + 0.5) / size, v = (j + 0.5) / size, metres x = u * W, y = v * W; row 0 is
 * v = 0. Layers: albedo RGBA8 = sRGB albedo, roughness; normal RGBA8 = tangent normal xy, height (0 deepest), AO.
 */
import { Rng, hash2i, hash32, hashToFloat, lerp as mix, saturate as clamp01, smoothstep as smooth } from '@futuremagic/core';
export { clamp01, mix, smooth };

/** Hash of (seed, a, b) to [0,1). */
export const rnd = (seed: number, a: number, b = 0): number => hashToFloat(hash2i(seed, a, b));
/** Wrapped signed difference a-b on a period p (result in [-p/2, p/2)). */
export function wrapd(d: number, p: number): number {
  d -= Math.floor(d / p + 0.5) * p;
  return d;
}
export function wrap(x: number, p: number): number {
  x %= p;
  return x < 0 ? x + p : x;
}

// ---------------------------------------------------------------------------------------------
// Periodic gradient noise
// ---------------------------------------------------------------------------------------------
const GX = new Float64Array(32), GY = new Float64Array(32);
for (let k = 0; k < 32; k++) {
  const a = (k / 32) * Math.PI * 2 + 0.21;
  GX[k] = Math.cos(a);
  GY[k] = Math.sin(a);
}

/** Permutation-table gradient noise (fast path for TNoise), periodic in px, py. */
function tgrad(P: Uint16Array, x: number, y: number, px: number, py: number): number {
  const xf = Math.floor(x), yf = Math.floor(y);
  const fx = x - xf, fy = y - yf;
  let x0 = xf % px; if (x0 < 0) x0 += px;
  let y0 = yf % py; if (y0 < 0) y0 += py;
  const x1 = x0 + 1 === px ? 0 : x0 + 1;
  const y1 = y0 + 1 === py ? 0 : y0 + 1;
  const a0 = P[x0 & 1023], a1 = P[x1 & 1023];
  const h00 = P[(a0 + y0) & 1023] & 31, h10 = P[(a1 + y0) & 1023] & 31;
  const h01 = P[(a0 + y1) & 1023] & 31, h11 = P[(a1 + y1) & 1023] & 31;
  const n00 = GX[h00] * fx + GY[h00] * fy;
  const n10 = GX[h10] * (fx - 1) + GY[h10] * fy;
  const n01 = GX[h01] * fx + GY[h01] * (fy - 1);
  const n11 = GX[h11] * (fx - 1) + GY[h11] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.45;
}

/**
 * Tileable noise source bound to a tile. All sampling functions take tile coordinates
 * u, v (one tile = [0,1)) and a wavelength in meters; frequencies are rounded to integer
 * cycles per tile so everything wraps seamlessly.
 */
export class TNoise {
  private tabs: Uint16Array[] = [];
  constructor(readonly seed: number, readonly W: number) {}
  private tab(k: number): Uint16Array {
    let t = this.tabs[k];
    if (!t) {
      t = new Uint16Array(1024);
      for (let i = 0; i < 1024; i++) t[i] = i;
      for (let i = 1023; i > 0; i--) {
        const j = hash2i(this.seed, k, i) % (i + 1);
        const tmp = t[i]; t[i] = t[j]; t[j] = tmp;
      }
      this.tabs[k] = t;
    }
    return t;
  }
  /** cycles per tile for a wavelength in meters */
  cycles(lambda: number): number {
    return Math.max(1, Math.round(this.W / lambda));
  }
  /** single octave, wavelengths may differ per axis (anisotropic) */
  n(u: number, v: number, lx: number, ly = lx): number {
    const fx = this.cycles(lx), fy = this.cycles(ly);
    return tgrad(this.tab(0), u * fx, v * fy, fx, fy);
  }
  /** fBm, ~[-1,1] */
  fbm(u: number, v: number, lx: number, oct: number, gain = 0.5, ly = lx): number {
    let fx = this.cycles(lx), fy = this.cycles(ly);
    let sum = 0, amp = 1, norm = 0;
    for (let k = 0; k < oct; k++) {
      sum += amp * tgrad(this.tab(k), u * fx + k * 0.31, v * fy + k * 0.17, fx, fy);
      norm += amp;
      amp *= gain;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  }
}

// ---------------------------------------------------------------------------------------------
// Periodic Worley / Voronoi
// ---------------------------------------------------------------------------------------------
export interface Cell {
  f1: number;
  f2: number;
  /** distance to the Voronoi border of the nearest cell (exact bisector distance), lattice units */
  edge: number;
  /** stable hash of the nearest cell (wrapped coordinates) */
  id: number;
  /** nearest feature point (unwrapped lattice coords, near x,y) */
  px: number;
  py: number;
}
export const newCell = (): Cell => ({ f1: 0, f2: 0, edge: 0, id: 0, px: 0, py: 0 });

/**
 * Periodic Worley noise on a px x py lattice (x,y in lattice units). With `edge`, also computes
 * the true distance to the cell border (IQ's two-pass method).
 */
export function worley(seed: number, x: number, y: number, px: number, py: number, jitter: number, out: Cell, edge = false): Cell {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, bx = 0, by = 0, bid = 0, bcx = 0, bcy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const cy = yi + dy;
    let wy = cy % py; if (wy < 0) wy += py;
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      let wx = cx % px; if (wx < 0) wx += px;
      const h = hash2i(seed, wx, wy);
      const fx = cx + 0.5 + (hashToFloat(h) - 0.5) * jitter;
      const fy = cy + 0.5 + (hashToFloat(hash32(h)) - 0.5) * jitter;
      const ddx = fx - x, ddy = fy - y;
      const d = ddx * ddx + ddy * ddy;
      if (d < f1) { f2 = f1; f1 = d; bx = fx; by = fy; bid = h; bcx = cx; bcy = cy; } else if (d < f2) f2 = d;
    }
  }
  out.f1 = Math.sqrt(f1);
  out.f2 = Math.sqrt(f2);
  out.id = bid;
  out.px = bx;
  out.py = by;
  if (edge) {
    let md = 1e9;
    for (let dy = -2; dy <= 2; dy++) {
      const cy = bcy + dy;
      let wy = cy % py; if (wy < 0) wy += py;
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cx = bcx + dx;
        let wx = cx % px; if (wx < 0) wx += px;
        const h = hash2i(seed, wx, wy);
        const fx = cx + 0.5 + (hashToFloat(h) - 0.5) * jitter;
        const fy = cy + 0.5 + (hashToFloat(hash32(h)) - 0.5) * jitter;
        const nx = fx - bx, ny = fy - by;
        const nl = Math.sqrt(nx * nx + ny * ny);
        if (nl < 1e-6) continue;
        const d = ((bx + fx) * 0.5 - x) * (nx / nl) + ((by + fy) * 0.5 - y) * (ny / nl);
        if (d < md) md = d;
      }
    }
    out.edge = md;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Texture working buffers
// ---------------------------------------------------------------------------------------------
export interface TexLayer {
  albedo: Uint8Array;
  normal: Uint8Array;
}

export class Tex {
  readonly n: number;
  /** meters per pixel */
  readonly ps: number;
  /** albedo in sRGB 0..1 */
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly rough: Float32Array;
  /** height in meters (relief) */
  readonly h: Float32Array;
  constructor(readonly size: number, readonly W: number) {
    this.n = size * size;
    this.ps = W / size;
    this.r = new Float32Array(this.n);
    this.g = new Float32Array(this.n);
    this.b = new Float32Array(this.n);
    this.rough = new Float32Array(this.n);
    this.h = new Float32Array(this.n);
  }
  /** Calls fn for every pixel with tile coords u,v in [0,1) and meters x,y. */
  each(fn: (u: number, v: number, x: number, y: number, idx: number, i: number, j: number) => void): void {
    const s = this.size, W = this.W;
    for (let j = 0; j < s; j++) {
      const v = (j + 0.5) / s;
      for (let i = 0; i < s; i++) {
        const u = (i + 0.5) / s;
        fn(u, v, u * W, v * W, j * s + i, i, j);
      }
    }
  }
  set(idx: number, r: number, g: number, b: number, rough: number, h: number): void {
    this.r[idx] = r; this.g[idx] = g; this.b[idx] = b; this.rough[idx] = rough; this.h[idx] = h;
  }
}

/** Separable wrapped box blur (radius in pixels, integer >= 1). */
function boxBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, s: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let j = 0; j < s; j++) {
    const row = j * s;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + ((k % s) + s) % s];
    for (let i = 0; i < s; i++) {
      tmp[row + i] = acc * inv;
      acc += src[row + (i + r + 1) % s] - src[row + ((i - r) % s + s) % s];
    }
  }
  for (let i = 0; i < s; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[(((k % s) + s) % s) * s + i];
    for (let j = 0; j < s; j++) {
      dst[j * s + i] = acc * inv;
      acc += tmp[((j + r + 1) % s) * s + i] - tmp[(((j - r) % s + s) % s) * s + i];
    }
  }
}

/** Approximate gaussian blur (3 box passes), wrapped; sigma in pixels. */
export function blur(src: Float32Array, s: number, sigma: number): Float32Array {
  const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
  const r = Math.max(1, Math.round(sigma * 0.95));
  boxBlur(src, out, tmp, s, r);
  boxBlur(out, out, tmp, s, r);
  boxBlur(out, out, tmp, s, r);
  return out;
}

export interface FinishOpts {
  /** normal exaggeration over the physical slope of the height field (1 = physical) */
  normal?: number;
  /** AO cavity radii in meters (small, large) */
  aoR?: [number, number];
  /** AO strength per meter of cavity depth (ao = exp(-k * cavity)) */
  aoK?: number;
}

/** Packs the working buffers into the final RGBA8 layer pair. */
export function finish(t: Tex, o: FinishOpts = {}): TexLayer {
  const s = t.size, n = t.n, h = t.h;
  const albedo = new Uint8Array(n * 4), normal = new Uint8Array(n * 4);
  const ns = (o.normal ?? 1) / (8 * t.ps);
  const [r1, r2] = o.aoR ?? [0.01, 0.04];
  const k = o.aoK ?? 40;
  const b1 = blur(h, s, Math.max(1, r1 / t.ps));
  const b2 = blur(h, s, Math.max(1.5, r2 / t.ps));
  let hmin = 1e9, hmax = -1e9;
  for (let i = 0; i < n; i++) { if (h[i] < hmin) hmin = h[i]; if (h[i] > hmax) hmax = h[i]; }
  const hs = hmax > hmin ? 255 / (hmax - hmin) : 0;
  for (let j = 0; j < s; j++) {
    const jm = ((j - 1 + s) % s) * s, j0 = j * s, jp = ((j + 1) % s) * s;
    for (let i = 0; i < s; i++) {
      const im = (i - 1 + s) % s, ip = (i + 1) % s;
      // Sobel; +x = increasing i, +y = increasing j (= +v, up)
      const gx = (h[jm + ip] + 2 * h[j0 + ip] + h[jp + ip]) - (h[jm + im] + 2 * h[j0 + im] + h[jp + im]);
      const gy = (h[jp + im] + 2 * h[jp + i] + h[jp + ip]) - (h[jm + im] + 2 * h[jm + i] + h[jm + ip]);
      let nx = -gx * ns, ny = -gy * ns;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= l; ny *= l;
      const idx = j0 + i, o4 = idx * 4;
      const cav = Math.max(0, b1[idx] - h[idx]) * 0.55 + Math.max(0, b2[idx] - h[idx]) * 0.45;
      const ao = Math.exp(-k * cav);
      normal[o4] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o4 + 2] = Math.round((h[idx] - hmin) * hs);
      normal[o4 + 3] = Math.round(clamp01(ao) * 255);
      albedo[o4] = Math.round(Math.min(0.95, Math.max(0.025, t.r[idx])) * 255);
      albedo[o4 + 1] = Math.round(Math.min(0.95, Math.max(0.025, t.g[idx])) * 255);
      albedo[o4 + 2] = Math.round(Math.min(0.95, Math.max(0.025, t.b[idx])) * 255);
      albedo[o4 + 3] = Math.round(Math.min(1, Math.max(0.02, t.rough[idx])) * 255);
    }
  }
  return { albedo, normal };
}

/** sRGB 0..255 triple to 0..1 */
export type RGB = [number, number, number];
export const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];

// ---------------------------------------------------------------------------------------------
// Stamping (paint.ts)
// ---------------------------------------------------------------------------------------------

/** Calls fn for every pixel whose center lies within radius r (m) of (cx, cy) (m), wrapping. */
export function splat(t: Tex, cx: number, cy: number, r: number, fn: (dx: number, dy: number, idx: number) => void): void {
  const s = t.size, ps = t.ps;
  const ci = cx / ps - 0.5, cj = cy / ps - 0.5, rp = r / ps, r2 = r * r;
  const j0 = Math.floor(cj - rp), j1 = Math.ceil(cj + rp), i0 = Math.floor(ci - rp), i1 = Math.ceil(ci + rp);
  for (let j = j0; j <= j1; j++) {
    const dy = (j - cj) * ps;
    if (dy * dy > r2) continue;
    const row = (((j % s) + s) % s) * s;
    for (let i = i0; i <= i1; i++) {
      const dx = (i - ci) * ps;
      if (dx * dx + dy * dy > r2) continue;
      fn(dx, dy, row + (((i % s) + s) % s));
    }
  }
}

/** Walks a thin segment from (x, y) in direction a for length len (m); fn(s 0..1, idx). */
export function stroke(t: Tex, x: number, y: number, a: number, len: number, fn: (s: number, idx: number) => void): void {
  const s = t.size, ps = t.ps;
  const n = Math.max(1, Math.ceil(len / (ps * 0.7)));
  const ca = Math.cos(a), sa = Math.sin(a);
  let last = -1;
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const i = Math.floor((x + ca * len * f) / ps), j = Math.floor((y + sa * len * f) / ps);
    const idx = (((j % s) + s) % s) * s + (((i % s) + s) % s);
    if (idx === last) continue;
    last = idx;
    fn(f, idx);
  }
}

export interface PebbleOpts {
  /** coverage multiplier (pebbles per own area) */
  count: number;
  rMin: number;
  rMax: number;
  /** dome height relative to radius */
  height: number;
  palette: RGB[];
  fines: RGB;
  finesH: number;
  /** optional mask (u,v) -> 0..1 of where pebbles may lie */
  mask?: (u: number, v: number) => number;
  dust?: number;
  /** false: keep the existing contents of t as the bed */
  bed?: boolean;
}

/** Scatter of overlapping, z-buffered ellipsoidal pebbles over a fines bed. */
export function pebbles(t: Tex, seed: number, o: PebbleOpts): void {
  const W = t.W;
  const nf = new TNoise(seed + 1, W), nd = new TNoise(seed + 2, W);
  // bed of fines
  if (o.bed !== false) t.each((u, v, _x, _y, idx) => {
    const k = 1 + nf.fbm(u, v, 0.02, 3) * 0.15 + (rnd(seed + 3, idx) - 0.5) * 0.25;
    t.set(idx, o.fines[0] * k, o.fines[1] * k, o.fines[2] * k, 0.95, o.finesH + nf.fbm(u, v, 0.05, 3) * 0.002);
  });
  const rng = new Rng(seed + 4);
  const rm = (o.rMin + o.rMax) / 2;
  const n = Math.round((W * W) / (Math.PI * rm * rm * 0.7) * o.count);
  for (let k = 0; k < n; k++) {
    const cx = rng.float() * W, cy = rng.float() * W;
    if (o.mask && rng.float() > o.mask(cx / W, cy / W)) continue;
    const a = rng.range(o.rMin, o.rMax), b = a * rng.range(0.55, 0.95), th = rng.float() * Math.PI;
    const ct = Math.cos(th), st = Math.sin(th);
    const base = -a * rng.range(0, 0.35) * o.height;
    const hk = a * o.height * rng.range(0.75, 1.1);
    const col = o.palette[Math.floor(rng.float() * o.palette.length)];
    const vk = rng.range(0.82, 1.15);
    const sk = rng.int(0, 1000000);
    splat(t, cx, cy, a, (dx, dy, idx) => {
      const px = dx * ct + dy * st, py = -dx * st + dy * ct;
      const q = (px / a) ** 2 + (py / b) ** 2;
      if (q >= 1) return;
      const z = base + Math.sqrt(1 - q) * hk;
      if (z <= t.h[idx]) return;
      const speck = 1 + (rnd(sk, idx) - 0.5) * 0.12;
      const rim = 0.8 + 0.2 * Math.sqrt(1 - q);
      const k = vk * speck * rim;
      t.set(idx, col[0] * k, col[1] * k, col[2] * k, 0.75 - 0.15 * (1 - q), z);
    });
  }
  if (o.dust) {
    t.each((u, v, _x, _y, idx) => {
      const d = smooth(-0.2, 0.6, nd.fbm(u, v, 0.4, 4)) * o.dust!;
      t.r[idx] = mix(t.r[idx], o.fines[0] * 1.1, d);
      t.g[idx] = mix(t.g[idx], o.fines[1] * 1.1, d);
      t.b[idx] = mix(t.b[idx], o.fines[2] * 1.1, d);
    });
  }
}
