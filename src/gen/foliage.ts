/**
 * Ported from Scale src/props/vegetation.ts (procedural textures, the bark half; the leaf atlas needs a canvas and is
 * drawn in render/foliage.ts).
 *
 * The bark atlas: `BARK_STRIPS` strips side by side, each a tileable bark (furrowed, fissured oak, birch, plane
 * camouflage, pine plates, fibrous strips, cypress, fine grey), its colour (sRGB) and a normal map from its height.
 * Wood meshes address a strip with `uv.x = strip * 16 + u` (`gen/trees.ts`). Pure: runs in a worker.
 */
import { clamp, hash2i, hashToFloat, lerp as mix, smoothstep as smooth } from '@futuremagic/core';
import { BARK_STRIPS } from './trees';

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
const imod = (a: number, b: number) => ((a % b) + b) % b;

/** Periodic value noise in [0,1]; x period px, y period py (integers). */
function pnoise(seed: number, x: number, y: number, px: number, py: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const h = (i: number, j: number) => hashToFloat(hash2i(seed, imod(i, px), imod(j, py)));
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function pfbm(seed: number, x: number, y: number, px: number, py: number, oct: number): number {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * pnoise(seed + o * 101, x * f, y * f, px * f, py * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/** Periodic worley: returns [f1, f2, id]. */
function pworley(seed: number, x: number, y: number, px: number, py: number, jitter = 0.9): [number, number, number] {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const h = hash2i(seed, imod(cx, px), imod(cy, py));
    const fx = cx + 0.5 + (hashToFloat(h) - 0.5) * jitter;
    const fy = cy + 0.5 + (hashToFloat(Math.imul(h, 2654435761)) - 0.5) * jitter;
    const dd = Math.hypot(fx - x, fy - y);
    if (dd < f1) { f2 = f1; f1 = dd; id = h; } else if (dd < f2) f2 = dd;
  }
  return [f1, f2, id];
}

type RGBH = [number, number, number, number];

function barkPixel(strip: number, u: number, v: number): RGBH {
  // u in [0,1) around the branch, v in [0,1) along (one tile = 4 circumferences)
  switch (strip) {
    case 0: { // linden / maple: interlaced shallow furrows
      const n = pfbm(11, u * 9 + pfbm(12, u * 4, v * 3, 4, 3, 2) * 1.5, v * 5, 9, 5, 4);
      const ridge = 1 - Math.abs(2 * n - 1);
      const fine = pfbm(13, u * 40, v * 60, 40, 60, 2);
      const h = Math.pow(ridge, 1.6) * 0.8 + fine * 0.2;
      const lich = smooth(0.62, 0.75, pfbm(14, u * 3, v * 5, 3, 5, 3));
      const r = mix(0.16, 0.42, h), g = mix(0.14, 0.39, h), b = mix(0.12, 0.35, h);
      return [mix(r, 0.42, lich * 0.5), mix(g, 0.46, lich * 0.5), mix(b, 0.3, lich * 0.5), h];
    }
    case 1: { // oak / chestnut: deep blocky fissures
      const warpU = pfbm(21, u * 5, v * 4, 5, 4, 2) * 0.6;
      const [f1, f2] = pworley(22, u * 7 + warpU, v * 7, 7, 7, 0.85);
      const crack = smooth(0.0, 0.16, f2 - f1);
      const fine = pfbm(23, u * 30, v * 50, 30, 50, 3);
      const plate = pfbm(24, u * 14, v * 12, 14, 12, 2);
      const h = crack * (0.65 + 0.35 * plate) * 0.85 + fine * 0.15;
      return [mix(0.09, 0.36, h), mix(0.08, 0.33, h), mix(0.07, 0.29, h), h];
    }
    case 2: { // birch: white with dark lenticels and black patches
      const lent = smooth(0.66, 0.72, pfbm(31, u * 7, v * 140, 7, 140, 2));
      const patch = smooth(0.66, 0.7, pfbm(32, u * 3 + pfbm(35, u * 6, v * 20, 6, 20, 2) * 0.8, v * 9, 3, 9, 4));
      const fine = pfbm(33, u * 24, v * 90, 24, 90, 2);
      const warm = pfbm(34, u * 4, v * 10, 4, 10, 2);
      let r = 0.86 - fine * 0.1 + warm * 0.04, g = 0.85 - fine * 0.1, b = 0.8 - fine * 0.1 - warm * 0.04;
      const dark = Math.max(lent * 0.75, patch);
      r = mix(r, 0.12, dark); g = mix(g, 0.11, dark); b = mix(b, 0.11, dark);
      return [r, g, b, 0.7 - dark * 0.45 + fine * 0.15];
    }
    case 3: { // plane: camouflage patches
      const wu = u * 4 + (pfbm(41, u * 6, v * 12, 6, 12, 3) - 0.5) * 1.3;
      const wv = v * 9 + (pfbm(42, u * 6, v * 12, 6, 12, 3) - 0.5) * 2.6;
      const [f1, f2, id] = pworley(43, wu, wv, 4, 9, 0.95);
      const pal: [number, number, number][] = [[0.5, 0.5, 0.38], [0.8, 0.77, 0.62], [0.55, 0.5, 0.4], [0.66, 0.67, 0.53], [0.42, 0.44, 0.34], [0.74, 0.72, 0.6]];
      const c = pal[id % pal.length];
      const edge = smooth(0.0, 0.07, f2 - f1);
      const fine = pfbm(44, u * 30, v * 60, 30, 60, 2);
      const k = (0.85 + 0.15 * edge) * (0.92 + fine * 0.16);
      return [c[0] * k, c[1] * k, c[2] * k, 0.5 + (id % 3) * 0.08 + fine * 0.1 + edge * 0.1];
    }
    case 4: { // pine: reddish plates
      const [f1, f2, id] = pworley(51, u * 5 + pfbm(52, u * 5, v * 5, 5, 5, 2) * 0.5, v * 8, 5, 8, 0.9);
      const crack = smooth(0.0, 0.1, f2 - f1);
      const fine = pfbm(53, u * 30, v * 40, 30, 40, 2);
      const red = hashToFloat(id) * 0.5 + 0.5;
      const h = crack * (0.7 + fine * 0.3);
      return [mix(0.12, 0.5 * red + 0.12, h), mix(0.09, 0.3 * red + 0.07, h), mix(0.08, 0.2 * red + 0.06, h), h];
    }
    case 5: { // palm: horizontal leaf-scar rings, fibrous
      const ringV = v * 22 + (pfbm(61, u * 3, v * 22, 3, 22, 2) - 0.5) * 0.5;
      const fr = ringV - Math.floor(ringV);
      const ring = smooth(0.0, 0.18, fr) * smooth(1.0, 0.75, fr);
      const fib = pfbm(62, u * 60, v * 22, 60, 22, 2);
      const h = ring * 0.75 + fib * 0.25;
      return [mix(0.22, 0.52, h), mix(0.19, 0.47, h), mix(0.15, 0.39, h), h];
    }
    case 6: { // cypress: stringy fibrous strips
      const n = pfbm(71, u * 26 + pfbm(72, u * 4, v * 3, 4, 3, 2) * 3, v * 3, 26, 3, 3);
      const ridge = 1 - Math.abs(2 * n - 1);
      const g2 = pfbm(73, u * 5, v * 8, 5, 8, 2);
      const h = Math.pow(ridge, 1.3);
      return [mix(0.16, 0.46 - g2 * 0.1, h), mix(0.11, 0.33, h), mix(0.09, 0.27 + g2 * 0.05, h), h];
    }
    default: { // ginkgo / shrub: grey, fine furrows
      const n = pfbm(81, u * 14, v * 7, 14, 7, 4);
      const ridge = 1 - Math.abs(2 * n - 1);
      const fine = pfbm(82, u * 40, v * 60, 40, 60, 2);
      const h = Math.pow(ridge, 2) * 0.7 + fine * 0.3;
      return [mix(0.2, 0.43, h), mix(0.18, 0.4, h), mix(0.16, 0.36, h), h];
    }
  }
}

/** The bark atlas: colour (sRGB) and normal map, RGBA8, `width` × `height`. */
export interface BarkAtlas { width: number; height: number; color: Uint8Array; normal: Uint8Array }

/** Texels of one bark strip across, and of the atlas down. */
export const BARK_TEXELS = { strip: 128, height: 512 };

/** Build the bark atlas (strip width `SW`, height `SH` texels). */
export function barkAtlas(SW = BARK_TEXELS.strip, SH = BARK_TEXELS.height): BarkAtlas {
  const W = SW * BARK_STRIPS;
  const col = new Uint8Array(W * SH * 4);
  const nor = new Uint8Array(W * SH * 4);
  const hgt = new Float32Array(W * SH);
  for (let s = 0; s < BARK_STRIPS; s++) {
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const px = barkPixel(s, x / SW, y / SH);
      const i = y * W + s * SW + x;
      col[i * 4] = clamp(px[0] * 255, 0, 255);
      col[i * 4 + 1] = clamp(px[1] * 255, 0, 255);
      col[i * 4 + 2] = clamp(px[2] * 255, 0, 255);
      col[i * 4 + 3] = 255;
      hgt[i] = px[3];
    }
  }
  const strength = [3.5, 5, 1.2, 1.2, 4, 3, 3.5, 2.5];
  for (let s = 0; s < BARK_STRIPS; s++) {
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const at = (xx: number, yy: number) => hgt[imod(yy, SH) * W + s * SW + imod(xx, SW)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength[s];
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength[s];
      const len = Math.hypot(dx, dy, 1);
      const i = (y * W + s * SW + x) * 4;
      nor[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nor[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nor[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nor[i + 3] = 255;
    }
  }
  return { width: W, height: SH, color: col, normal: nor };
}
