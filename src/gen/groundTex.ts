/**
 * The ground's own surfaces up close: tileable layers (grass, dry grass, leaf litter, needle litter, dirt, gravel,
 * sand, rock), each an albedo and a normal/height/occlusion texture of `GROUND_TEX` texels over `W` metres. The GROUND
 * kind blends the two strongest at each point (`floor` weights from `ecology.ts`) and fades them in as the eye comes
 * close enough to see them, keeping the colour the ground has from afar.
 *
 * Grass, dirt and gravel are ported from Scale src/render/texgen/ground.ts (grass with a new `dryness`); litter,
 * needles, sand and rock are new, built from the same stamping tools (`texgen.ts`). Pure: built in a worker.
 */
import { Rng, srgbToLinear } from '@futuremagic/core';
import type { FloorLayer } from '../blueprint';
import { TNoise, Tex, finish, mix, newCell, pebbles, rgb, rnd, smooth, splat, stroke, worley, type RGB, type TexLayer } from './texgen';

type Gen = (t: Tex) => void;

/** Texels across one layer. */
export const GROUND_TEX = 512;

const gravelPath: Gen = (t) => {
  const W = t.W;
  const n1 = new TNoise(3601, W);
  t.each((u, v, _x, _y, idx) => {
    const k = 1 + n1.fbm(u, v, 0.3, 4) * 0.08 + (rnd(3602, idx) - 0.5) * 0.3;
    t.set(idx, 0.6 * k, 0.55 * k, 0.46 * k, 0.95, n1.fbm(u, v, 0.15, 3) * 0.003 - 0.003);
  });
  pebbles(t, 3603, {
    count: 1.1, rMin: 0.004, rMax: 0.011, height: 0.45, bed: false,
    palette: [rgb(170, 160, 140), rgb(150, 140, 125), rgb(120, 112, 104), rgb(190, 182, 166), rgb(140, 120, 100)],
    fines: rgb(152, 140, 118), finesH: 0, dust: 0.35,
    mask: (u, v) => 0.55 + 0.45 * n1.fbm(u, v, 0.4, 3),
  });
};


const dirt: Gen = (t) => {
  const W = t.W;
  const n1 = new TNoise(3801, W), n2 = new TNoise(3802, W), n3 = new TNoise(3803, W);
  const cell = newCell();
  const fc = Math.round(W / 0.12);
  t.each((u, v, _x, _y, idx) => {
    const lump = n1.fbm(u, v, 0.06, 4, 0.55);
    let h = n1.fbm(u, v, 0.8, 3) * 0.012 + lump * 0.003 + n2.fbm(u, v, 0.008, 2) * 0.0006;
    const damp = smooth(-0.2, 0.6, n2.fbm(u, v, 0.9, 4)) * 0.6;
    // dry cracks where not damp
    worley(3804, u * fc + n3.fbm(u, v, 0.05, 2) * 0.3, v * fc, fc, fc, 1, cell, true);
    const cr = (1 - smooth(0.0, 0.04, cell.edge)) * (1 - damp) * smooth(0.0, 0.3, n3.fbm(u, v, 0.7, 3));
    h -= cr * 0.003;
    const k = (1 + lump * 0.1 + (rnd(3805, idx) - 0.5) * 0.12) * (1 - damp * 0.28) * (1 - cr * 0.3);
    t.set(idx, 0.49 * k, 0.4 * k * (1 - damp * 0.05), 0.3 * k, 0.95 - damp * 0.15, h);
  });
  pebbles(t, 3806, {
    count: 0.12, rMin: 0.003, rMax: 0.012, height: 0.4, bed: false,
    palette: [rgb(140, 128, 112), rgb(110, 100, 90), rgb(160, 150, 132)],
    fines: rgb(125, 102, 76), finesH: 0, dust: 0.4,
  });
};


/**
 * Lawn: z-buffered blade strokes over thatch, clumps, dry patches and clover (Scale's `grass`). `dryness` (0 … 1, new)
 * turns more of it to straw: the dry grass of a hot climate.
 */
function lawn(t: Tex, seed: number, dryness: number): void {
  const W = t.W;
  const nD = new TNoise(seed + 1, W), nC = new TNoise(seed + 2, W), nT = new TNoise(seed + 3, W);
  t.each((u, v, _x, _y, idx) => {
    const k = 0.8 + nT.fbm(u, v, 0.05, 3) * 0.3 + (rnd(seed + 4, idx) - 0.5) * 0.3;
    t.set(idx, 0.2 * k, 0.19 * k, 0.09 * k, 0.95, 0);
  });
  const rng = new Rng(seed + 5);
  const ps = t.ps;
  const n = Math.round(((W * W) / (0.03 * ps)) * 1.6);
  for (let k = 0; k < n; k++) {
    const x = rng.float() * W, y = rng.float() * W;
    const u = x / W, v = y / W;
    const dens = 0.65 + 0.35 * nC.fbm(u, v, 0.12, 3);
    if (rng.float() > dens) continue;
    const dry = smooth(0.15 - dryness * 0.8, 0.55 - dryness * 0.5, nD.fbm(u, v, 1.2, 4) + nD.fbm(u, v, 0.15, 2) * 0.3);
    const len = rng.range(0.015, 0.045);
    const a = rng.float() * Math.PI * 2;
    const z0 = rng.float() * 0.012;
    const hue = rng.float();
    const vk = rng.range(0.7, 1.25);
    // fresh green -> yellow-green; dry -> straw
    let cr = mix(0.2, 0.3, hue), cg = mix(0.33, 0.4, hue), cb = mix(0.09, 0.12, hue);
    const dk = dry * rng.range(0.5, 1);
    cr = mix(cr, 0.55, dk); cg = mix(cg, 0.48, dk); cb = mix(cb, 0.26, dk);
    stroke(t, x, y, a, len, (s, idx) => {
      const z = z0 + s * len * 0.9;
      if (z <= t.h[idx]) return;
      const sh = vk * (0.5 + 0.5 * s);
      t.set(idx, cr * sh, cg * sh, cb * sh, 0.7 + dk * 0.2, z);
    });
  }
  // clover patches
  const nClover = Math.round(24 * (1 - dryness));
  for (let c = 0; c < nClover; c++) {
    const px = rng.float() * W, py = rng.float() * W, pr = rng.range(0.05, 0.15);
    const leaves = Math.round(pr * pr * 4000);
    for (let l = 0; l < leaves; l++) {
      const a = rng.float() * 6.283, d = Math.sqrt(rng.float()) * pr;
      const cx = px + Math.cos(a) * d, cy = py + Math.sin(a) * d;
      const z0 = rng.range(0.01, 0.035), rot = rng.float() * 6.283, R = rng.range(0.006, 0.01);
      const vk = rng.range(0.8, 1.1);
      splat(t, cx, cy, R, (dx, dy, idx) => {
        const an = Math.atan2(dy, dx) * 3 + rot;
        const rr = Math.hypot(dx, dy) / R;
        if (rr > 0.6 + 0.4 * Math.abs(Math.cos(an * 0.5))) return;
        const z = z0 + (1 - rr) * 0.003;
        if (z <= t.h[idx]) return;
        t.set(idx, 0.16 * vk, 0.3 * vk, 0.12 * vk, 0.6, z);
      });
    }
  }
}

const grass: Gen = (t) => lawn(t, 3900, 0);
const dryGrass: Gen = (t) => lawn(t, 4300, 0.85);

/** Leaves of a broadleaf wood's floor: z-buffered leaves (oval, lobed), twigs and moss over dark humus. */
const litter: Gen = (t) => {
  const W = t.W;
  const nH = new TNoise(4401, W), nM = new TNoise(4402, W);
  t.each((u, v, _x, _y, idx) => {
    const k = 0.85 + nH.fbm(u, v, 0.1, 3) * 0.2 + (rnd(4403, idx) - 0.5) * 0.15;
    t.set(idx, 0.16 * k, 0.11 * k, 0.07 * k, 0.95, nH.fbm(u, v, 0.4, 3) * 0.01);
  });
  const rng = new Rng(4404);
  const palette: RGB[] = [rgb(120, 78, 40), rgb(140, 96, 48), rgb(98, 62, 34), rgb(156, 112, 58), rgb(110, 92, 50), rgb(80, 54, 30)];
  const n = Math.round((W * W) / (0.045 * 0.03) * 1.3);
  for (let k = 0; k < n; k++) {
    const cx = rng.float() * W, cy = rng.float() * W;
    const len = rng.range(0.03, 0.075), wid = len * rng.range(0.35, 0.6), a = rng.float() * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a), z0 = rng.float() * 0.02, curl = rng.range(0, 0.4);
    const lobes = rng.chance(0.4) ? rng.int(3, 5) : 0;
    const col = palette[rng.int(0, palette.length - 1)], vk = rng.range(0.75, 1.2);
    splat(t, cx, cy, len / 2, (dx, dy, idx) => {
      const px = (dx * ca + dy * sa) / (len / 2), py = (-dx * sa + dy * ca) / (wid / 2);
      let edge = 1 - px * px;
      if (lobes) edge *= 0.75 + 0.25 * Math.cos(px * Math.PI * lobes);
      if (py * py >= edge) return;
      const z = z0 + (1 - py * py) * curl * wid * 0.3;
      if (z <= t.h[idx]) return;
      const vein = Math.abs(py) < 0.08 ? 0.82 : 1;
      t.set(idx, col[0] * vk * vein, col[1] * vk * vein, col[2] * vk * vein, 0.8, z);
    });
  }
  // twigs
  for (let k = 0; k < Math.round(W * W * 3); k++) {
    const x = rng.float() * W, y = rng.float() * W, a = rng.float() * Math.PI * 2, len = rng.range(0.08, 0.35), z0 = rng.range(0.015, 0.03);
    const r = rng.range(0.003, 0.007), shade = rng.range(0.7, 1);
    stroke(t, x, y, a, len, (s, idx) => {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const j = idx + ox + oy * t.size;
        if (j >= t.n || z0 + r <= t.h[j]) continue;
        t.set(j, 0.2 * shade, 0.15 * shade, 0.1 * shade, 0.85, z0 + r * (1 - s * 0.3));
      }
    });
  }
  // moss in the hollows
  t.each((u, v, _x, _y, idx) => {
    const m = smooth(0.25, 0.6, nM.fbm(u, v, 0.5, 4)) * smooth(0.02, -0.01, t.h[idx]);
    t.r[idx] = mix(t.r[idx], 0.14, m); t.g[idx] = mix(t.g[idx], 0.22, m); t.b[idx] = mix(t.b[idx], 0.06, m);
  });
};

/** A pine wood's floor: a mat of fallen needles, rust to grey, over dark duff, with bits of bark and cone scales. */
const needles: Gen = (t) => {
  const W = t.W;
  const nH = new TNoise(4501, W);
  t.each((u, v, _x, _y, idx) => {
    const k = 0.8 + nH.fbm(u, v, 0.15, 3) * 0.25;
    t.set(idx, 0.13 * k, 0.09 * k, 0.06 * k, 0.95, nH.fbm(u, v, 0.5, 3) * 0.008);
  });
  const rng = new Rng(4502);
  const n = Math.round((W * W) / (0.05 * 0.0015) * 0.9);
  for (let k = 0; k < n; k++) {
    const x = rng.float() * W, y = rng.float() * W, a = rng.float() * Math.PI * 2, len = rng.range(0.035, 0.07);
    const z0 = rng.float() * 0.012, age = rng.float();
    const r = mix(0.52, 0.36, age), g = mix(0.3, 0.27, age), b = mix(0.14, 0.2, age), vk = rng.range(0.7, 1.15);
    stroke(t, x, y, a, len, (s, idx) => {
      const z = z0 + Math.sin(s * Math.PI) * 0.002;
      if (z <= t.h[idx]) return;
      t.set(idx, r * vk, g * vk, b * vk, 0.7, z);
    });
  }
  pebbles(t, 4503, { count: 0.02, rMin: 0.006, rMax: 0.02, height: 0.25, bed: false, palette: [rgb(92, 60, 40), rgb(70, 46, 32), rgb(110, 76, 50)], fines: rgb(60, 42, 28), finesH: 0 });
};

/** Sand at the waterline: fine grains, wind and wave ripples, a few pebbles and shell bits. */
const sand: Gen = (t) => {
  const W = t.W;
  const nR = new TNoise(4601, W), nG = new TNoise(4602, W), nW = new TNoise(4603, W);
  const ripples = Math.round(W / 0.09);
  t.each((u, v, _x, _y, idx) => {
    const warp = nW.fbm(u, v, 0.6, 3) * 0.9;
    const phase = (u * ripples + warp * 3 + nR.n(u, v, 0.4) * 0.6) * Math.PI * 2;
    const rip = Math.pow(0.5 + 0.5 * Math.sin(phase), 1.6) * smooth(-0.3, 0.4, nR.fbm(u, v, 0.8, 3));
    const grain = (rnd(4604, idx) - 0.5) * 0.18 + nG.fbm(u, v, 0.02, 2) * 0.08;
    const k = 1 + grain + rip * 0.05;
    t.set(idx, 0.58 * k, 0.51 * k, 0.37 * k, 0.9, rip * 0.004 + nG.fbm(u, v, 0.3, 3) * 0.002);
  });
  pebbles(t, 4605, {
    count: 0.03, rMin: 0.004, rMax: 0.014, height: 0.4, bed: false,
    palette: [rgb(200, 190, 170), rgb(150, 140, 130), rgb(220, 214, 200), rgb(120, 110, 100)], fines: rgb(150, 132, 96), finesH: 0,
  });
};

/** Bare rock: weathered stone broken by joints and cracks, darker in them, with lichen. */
const rock: Gen = (t) => {
  const W = t.W;
  const nS = new TNoise(4701, W), nL = new TNoise(4702, W), nC = new TNoise(4703, W);
  const cell = newCell(), fine = newCell();
  const fj = Math.round(W / 0.9), fc = Math.round(W / 0.25);
  t.each((u, v, _x, _y, idx) => {
    worley(4704, u * fj + nC.fbm(u, v, 0.4, 2) * 0.4, v * fj, fj, fj, 1, cell, true);
    worley(4705, u * fc, v * fc + nC.fbm(u, v, 0.2, 2) * 0.3, fc, fc, 1, fine, true);
    const joint = 1 - smooth(0, 0.05, cell.edge), crack = (1 - smooth(0, 0.03, fine.edge)) * smooth(0.1, 0.5, nC.fbm(u, v, 0.6, 3));
    const block = ((cell.id >>> 8) & 255) / 255;
    const h = nS.fbm(u, v, 0.5, 5, 0.55) * 0.03 + (1 - joint) * 0.02 - crack * 0.006 + block * 0.01;
    const k = (0.85 + block * 0.25 + nS.fbm(u, v, 0.08, 3) * 0.12 + (rnd(4706, idx) - 0.5) * 0.08) * (1 - joint * 0.45) * (1 - crack * 0.3);
    t.set(idx, 0.42 * k, 0.4 * k, 0.37 * k, 0.85, h);
  });
  // lichen rosettes on the tops
  const rng = new Rng(4707);
  for (let k = 0; k < Math.round(W * W * 40); k++) {
    const cx = rng.float() * W, cy = rng.float() * W, r = rng.range(0.01, 0.05);
    if (rng.float() > 0.5 + 0.5 * nL.fbm(cx / W, cy / W, 0.6, 3)) continue;
    const col = rng.chance(0.6) ? rgb(150, 150, 110) : rgb(170, 140, 70);
    splat(t, cx, cy, r, (dx, dy, idx) => {
      const q = Math.hypot(dx, dy) / r;
      const a = (1 - q) * 0.85;
      t.r[idx] = mix(t.r[idx], col[0], a); t.g[idx] = mix(t.g[idx], col[1], a); t.b[idx] = mix(t.b[idx], col[2], a);
    });
  }
};

/** The ground's layers, in the order of `FLOOR_LAYERS` (blueprint/climates.ts; a test holds them together). */
export const GROUND_LAYERS = [
  { name: 'grass', W: 3, gen: grass, normal: 0.35, aoK: 25, aoR: [0.01, 0.04] },
  { name: 'dry grass', W: 3, gen: dryGrass, normal: 0.35, aoK: 25, aoR: [0.01, 0.04] },
  { name: 'litter', W: 3, gen: litter, normal: 0.7, aoK: 40, aoR: [0.01, 0.04] },
  { name: 'needles', W: 2, gen: needles, normal: 0.6, aoK: 40, aoR: [0.008, 0.03] },
  { name: 'dirt', W: 3, gen: dirt, normal: 0.8, aoK: 50, aoR: [0.01, 0.04] },
  { name: 'gravel', W: 2, gen: gravelPath, normal: 0.8, aoK: 70, aoR: [0.005, 0.02] },
  { name: 'sand', W: 2, gen: sand, normal: 0.6, aoK: 30, aoR: [0.01, 0.04] },
  { name: 'rock', W: 4, gen: rock, normal: 1, aoK: 40, aoR: [0.01, 0.06] },
] as const satisfies readonly { name: FloorLayer; W: number; gen: Gen; normal: number; aoK: number; aoR: readonly [number, number] }[];

/** One ground layer, and its mean albedo (linear RGB): the colour it averages to from afar. */
export function groundLayer(index: number, size = GROUND_TEX): TexLayer & { mean: [number, number, number] } {
  const def = GROUND_LAYERS[index];
  const t = new Tex(size, def.W);
  def.gen(t);
  const layer = finish(t, { normal: def.normal, aoK: def.aoK, aoR: [def.aoR[0], def.aoR[1]] });
  const mean: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < t.n; i++) {
    const ao = layer.normal[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) mean[c] += srgbToLinear(layer.albedo[i * 4 + c] / 255) * ao;
  }
  for (let c = 0; c < 3; c++) mean[c] /= t.n;
  return { ...layer, mean };
}
