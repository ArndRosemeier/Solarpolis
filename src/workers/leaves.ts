/**
 * Ported from Scale src/props/vegetation.ts (getLeafAtlas and its drawing helpers; the trees are in gen/trees.ts, the
 * bark in gen/foliage.ts).
 *
 * The leaf atlas: a 4 × 4 grid of cells, each a whole twig with its leaves (sRGB colour, alpha the leaf shape), drawn
 * once on an OffscreenCanvas in a generation worker. Cells 0–11 are Scale's; 12–15 (willow, olive, heather, holm
 * oak) are new, where Scale had palm fronds. Colours are dilated into the transparent texels so the mips do not
 * bleed dark fringes. Cell numbers: `LEAF_CELLS` (gen/trees.ts). Deterministic: one fixed seed.
 */
import { Rng, clamp, srgbToLinear } from '@futuremagic/core';

type Ctx = OffscreenCanvasRenderingContext2D;
const deg = Math.PI / 180;

/** Side of the atlas in texels (`LEAF_ATLAS` in render/materials.ts must match). */
export const LEAF_ATLAS_SIZE = 1024;

type Pt = [number, number];
type HSL = [number, number, number];

function hslStr(c: HSL, a = 1, dl = 0) { return `hsla(${c[0]},${c[1]}%,${clamp(c[2] + dl, 0, 100)}%,${a})`; }

/** Polygon for an elongated leaf: base (0,0), tip (0,-len); hw(t) half width as fraction of width. */
function leafPoly(len: number, width: number, hw: (t: number) => number, teeth = 0, toothAmp = 0): Pt[] {
  const N = 36;
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let w = hw(t) * width * 0.5;
    if (teeth > 0) w *= 1 + toothAmp * (((t * teeth) % 1) - 0.5);
    right.push([w, -t * len]);
  }
  const left = right.slice(0, -1).reverse().map(([x, y]) => [-x, y] as Pt);
  return [...right, ...left];
}

/** Palmate polygon centred on the petiole attachment, lobes pointing up (angle 0 = up). */
function palmPoly(R: number, lobes: { a: number; l: number }[], lobeW: number, base: number, sharp: number, teeth: number): Pt[] {
  const pts: Pt[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const phi = -Math.PI + (i / N) * Math.PI * 2;
    let r = base;
    for (const lb of lobes) {
      let dd = Math.abs(phi - lb.a);
      dd = Math.min(dd, Math.PI * 2 - dd);
      const k = Math.max(0, 1 - dd / lobeW);
      r = Math.max(r, base + (lb.l - base) * Math.pow(k, sharp));
    }
    const bottom = Math.abs(Math.abs(phi) - Math.PI);
    if (bottom < 0.5) r *= 0.35 + 0.65 * (bottom / 0.5);
    r *= 1 + 0.035 * Math.sin(phi * teeth);
    pts.push([Math.sin(phi) * r * R, -Math.cos(phi) * r * R]);
  }
  return pts;
}

function fillLeaf(g: Ctx, poly: Pt[], col: HSL, len: number, veins: { from: Pt; to: Pt }[], rng: Rng) {
  g.beginPath();
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
  const lgt = rng.range(-5, 6);
  g.fillStyle = hslStr(col, 1, lgt);
  g.fill();
  g.save();
  g.clip();
  // fold shading across the midrib + base-to-tip gradient (pseudo normals)
  let maxX = 1;
  for (const p of poly) maxX = Math.max(maxX, Math.abs(p[0]));
  const gr = g.createLinearGradient(-maxX, 0, maxX, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.22)');
  gr.addColorStop(0.48, 'rgba(0,0,0,0.0)');
  gr.addColorStop(0.52, 'rgba(255,255,230,0.06)');
  gr.addColorStop(1, 'rgba(255,255,220,0.0)');
  g.fillStyle = gr;
  g.fillRect(-maxX, -len * 1.5, maxX * 2, len * 2);
  const gv = g.createLinearGradient(0, 0, 0, -len);
  gv.addColorStop(0, 'rgba(0,0,0,0.12)');
  gv.addColorStop(0.5, 'rgba(255,255,200,0.04)');
  gv.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = gv;
  g.fillRect(-maxX, -len * 1.5, maxX * 2, len * 2);
  // veins
  g.strokeStyle = hslStr(col, 0.5, 9);
  g.lineCap = 'round';
  for (const v of veins) {
    g.lineWidth = Math.max(0.6, len * 0.012);
    g.beginPath();
    g.moveTo(v.from[0], v.from[1]);
    g.lineTo(v.to[0], v.to[1]);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = hslStr(col, 0.55, -10);
  g.lineWidth = 0.9;
  g.stroke();
}

function midribVeins(len: number, width: number, n: number, hw: (t: number) => number): { from: Pt; to: Pt }[] {
  const out: { from: Pt; to: Pt }[] = [{ from: [0, 0], to: [0, -len * 0.96] }];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const w = hw(Math.min(1, t + 0.1)) * width * 0.45;
    out.push({ from: [0, -t * len], to: [w, -(t + 0.12) * len] });
    out.push({ from: [0, -t * len], to: [-w, -(t + 0.12) * len] });
  }
  return out;
}

type LeafFn = (g: Ctx, s: number, rng: Rng) => void;

function ovalLeaf(col: HSL, len: number, width: number, hw: (t: number) => number, teeth = 0, toothAmp = 0, veins = 5): LeafFn {
  return (g, s, rng) => {
    const l = len * s, w = width * s;
    fillLeaf(g, leafPoly(l, w, hw, teeth, toothAmp), col, l, midribVeins(l, w, veins, hw), rng);
  };
}

function palmateLeaf(col: HSL, R: number, lobes: { a: number; l: number }[], lobeW: number, base: number, sharp: number, teeth: number): LeafFn {
  return (g, s, rng) => {
    const r = R * s;
    const poly = palmPoly(r, lobes, lobeW, base, sharp, teeth);
    const veins = lobes.map((lb) => ({ from: [0, 0] as Pt, to: [Math.sin(lb.a) * lb.l * r * 0.9, -Math.cos(lb.a) * lb.l * r * 0.9] as Pt }));
    fillLeaf(g, poly, col, r * 1.6, veins, rng);
  };
}

function withJitter(c: HSL, rng: Rng, dh = 6, ds = 6, dl = 4): HSL {
  return [c[0] + rng.range(-dh, dh), clamp(c[1] + rng.range(-ds, ds), 0, 100), c[2] + rng.range(-dl, dl)];
}

/** Draws a twig with leaves inside a cell. Origin = bottom centre of the cell. */
function drawTwigCell(
  g: Ctx, rng: Rng,
  o: { nodes: number; twigLen: number; bend: number; spread: [number, number]; opposite?: boolean; petiole: number; size: [number, number]; leaf: (rng: Rng) => LeafFn; twigW: number; tip?: boolean; startT?: number; twigCol?: HSL },
) {
  const C = 256;
  const twig: Pt[] = [];
  const N = 20;
  const bend = o.bend;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    twig.push([bend * Math.sin(t * Math.PI * 0.9) * C + Math.sin(t * 9) * 3, -t * o.twigLen * C]);
  }
  const twigCol: HSL = o.twigCol ?? [28, 22, 26];
  g.strokeStyle = hslStr(twigCol);
  g.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    g.lineWidth = o.twigW * (1 - (i / N) * 0.6);
    g.beginPath();
    g.moveTo(twig[i][0], twig[i][1]);
    g.lineTo(twig[i + 1][0], twig[i + 1][1]);
    g.stroke();
  }
  const along = (t: number): [Pt, number] => {
    const f = t * N;
    const i = Math.min(N - 1, Math.floor(f));
    const k = f - i;
    const p: Pt = [twig[i][0] + (twig[i + 1][0] - twig[i][0]) * k, twig[i][1] + (twig[i + 1][1] - twig[i][1]) * k];
    const ang = Math.atan2(twig[i + 1][0] - twig[i][0], -(twig[i + 1][1] - twig[i][1]));
    return [p, ang];
  };
  const leavesToDraw: { p: Pt; a: number; s: number }[] = [];
  const st = o.startT ?? 0.15;
  for (let k = 0; k < o.nodes; k++) {
    const t = st + (1 - st) * (k / Math.max(1, o.nodes - (o.tip ? 0 : 1))) * (o.tip ? 0.92 : 1);
    const [p, ta] = along(Math.min(1, t));
    const sides = o.opposite ? [-1, 1] : [k % 2 === 0 ? -1 : 1];
    for (const sd of sides) {
      const a = ta + sd * rng.range(o.spread[0], o.spread[1]) * deg;
      const sz = rng.range(o.size[0], o.size[1]) * (0.75 + 0.35 * Math.sin(Math.PI * (0.25 + 0.6 * t)));
      leavesToDraw.push({ p, a, s: sz });
    }
  }
  if (o.tip) {
    const [p, ta] = along(1);
    leavesToDraw.push({ p, a: ta + rng.range(-8, 8) * deg, s: o.size[1] });
  }
  for (const lf of leavesToDraw) {
    g.save();
    g.translate(lf.p[0], lf.p[1]);
    g.rotate(lf.a);
    if (o.petiole > 0) {
      g.strokeStyle = hslStr([70, 30, 30]);
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -o.petiole * lf.s); g.stroke();
      g.translate(0, -o.petiole * lf.s);
    }
    o.leaf(rng)(g, lf.s, rng);
    g.restore();
  }
}

function drawNeedleTuft(g: Ctx, rng: Rng, col: HSL, len: number, nNeedle: number, twigLen: number) {
  g.lineCap = 'round';
  g.strokeStyle = hslStr([25, 30, 24]);
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -twigLen); g.stroke();
  const needles: { x: number; y: number; a: number; l: number; c: HSL }[] = [];
  for (let i = 0; i < nNeedle; i++) {
    const t = Math.pow(rng.float(), 0.7);
    const y = -twigLen * (0.15 + 0.85 * t);
    const a = rng.sign() * rng.range(12, 62) * deg * (1 - 0.5 * t);
    needles.push({ x: rng.range(-2, 2), y, a, l: len * rng.range(0.7, 1.05), c: withJitter(col, rng, 8, 8, 7) });
  }
  needles.sort((a, b) => a.l - b.l);
  for (const n of needles) {
    g.strokeStyle = hslStr(n.c);
    g.lineWidth = rng.range(1.6, 2.4);
    g.beginPath();
    g.moveTo(n.x, n.y);
    const ex = n.x + Math.sin(n.a) * n.l, ey = n.y - Math.cos(n.a) * n.l;
    g.quadraticCurveTo(n.x + Math.sin(n.a) * n.l * 0.5, n.y - Math.cos(n.a) * n.l * 0.55 - 3, ex, ey);
    g.stroke();
    g.strokeStyle = hslStr(n.c, 0.6, 12);
    g.lineWidth = 0.7;
    g.stroke();
  }
}

function drawCypressSpray(g: Ctx, rng: Rng, x: number, y: number, ang: number, len: number, depth: number, col: HSL) {
  const steps = Math.max(3, Math.round(len / 5));
  let px = x, py = y;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const nx = px + Math.sin(ang) * (len / steps), ny = py - Math.cos(ang) * (len / steps);
    const w = (2.2 + depth * 1.5) * (1 - t * 0.5);
    g.fillStyle = hslStr(withJitter(col, rng, 5, 5, 5), 1, t * 8);
    g.beginPath();
    g.ellipse(nx, ny, w, w * 1.6, ang, 0, Math.PI * 2);
    g.fill();
    if (depth > 0 && i > 0 && i % 2 === 0) {
      const sd = (i / 2) % 2 === 0 ? 1 : -1;
      drawCypressSpray(g, rng, nx, ny, ang + sd * rng.range(35, 55) * deg, len * rng.range(0.35, 0.55) * (1 - t * 0.6), depth - 1, col);
    }
    px = nx; py = ny;
  }
}


/** Draw the leaf atlas: RGBA, `LEAF_ATLAS_SIZE` square. Needs OffscreenCanvas (a worker or a page). */
export function leafAtlas(): Uint8Array {
  const S = LEAF_ATLAS_SIZE, C = S / 4;
  const g = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, S, S);
  const rng = Rng.from('leaf atlas');
  const cell = (i: number, w: number, draw: () => void) => {
    const cx = (i % 4) * C, cy = Math.floor(i / 4) * C;
    g.save();
    g.beginPath(); g.rect(cx + 3, cy + 3, C * w - 6, C - 6); g.clip();
    g.translate(cx + (C * w) / 2, cy + C - 4);
    draw();
    g.restore();
  };
  const ov = (t: number) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.8);
  // 0 plane: large palmate, shallow lobes
  cell(0, 1, () => drawTwigCell(g, rng.fork('plane'), {
    nodes: 4, twigLen: 0.42, bend: 0.03, spread: [40, 70], petiole: 26, size: [0.85, 1.0], twigW: 5, tip: true, startT: 0.35,
    leaf: (r) => palmateLeaf(withJitter([88, 42, 32], r), 46, [{ a: 0, l: 1.15 }, { a: -0.95, l: 1.0 }, { a: 0.95, l: 1.0 }, { a: -1.9, l: 0.62 }, { a: 1.9, l: 0.62 }], 0.62, 0.55, 1.3, 26),
  }));
  // 1 linden: heart leaves
  cell(1, 1, () => drawTwigCell(g, rng.fork('linden'), {
    nodes: 7, twigLen: 0.8, bend: 0.06, spread: [45, 80], petiole: 12, size: [0.75, 1.0], twigW: 3.5, tip: true,
    leaf: (r) => ovalLeaf(withJitter([88, 44, 28], r), 62, 60, (t) => Math.pow(Math.sin(Math.PI * Math.pow(0.08 + 0.92 * t, 0.7)), 0.75), 22, 0.07, 4),
  }));
  // 2 maple: sharp 5-lobed, opposite
  cell(2, 1, () => drawTwigCell(g, rng.fork('maple'), {
    nodes: 3, twigLen: 0.45, bend: 0.02, spread: [50, 75], opposite: true, petiole: 30, size: [0.8, 1.0], twigW: 4.5, tip: true, startT: 0.3,
    leaf: (r) => palmateLeaf(withJitter([96, 48, 28], r), 40, [{ a: 0, l: 1.15 }, { a: -0.85, l: 1.05 }, { a: 0.85, l: 1.05 }, { a: -1.75, l: 0.7 }, { a: 1.75, l: 0.7 }], 0.42, 0.38, 1.9, 14),
  }));
  // 3 oak: lobed leaves clustered near the tip
  cell(3, 1, () => drawTwigCell(g, rng.fork('oak'), {
    nodes: 7, twigLen: 0.5, bend: 0.04, spread: [15, 75], petiole: 4, size: [0.8, 1.0], twigW: 4.5, tip: true, startT: 0.55,
    leaf: (r) => ovalLeaf(withJitter([82, 38, 25], r), 92, 48, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.7) * (0.55 + 0.45 * Math.pow(Math.abs(Math.sin(t * Math.PI * 4.5)), 0.6)), 0, 0, 4),
  }));
  // 4 birch: small serrated deltoid leaves on a drooping twig
  cell(4, 1, () => {
    const r = rng.fork('birch');
    for (const [dx, bend, len] of [[-50, -0.12, 0.85], [45, 0.1, 0.8], [0, 0.02, 0.95]] as [number, number, number][]) {
      g.save();
      g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 7, twigLen: len, bend, spread: [40, 70], petiole: 8, size: [0.75, 1.0], twigW: 2, tip: true, twigCol: [20, 25, 22],
        leaf: (rr) => ovalLeaf(withJitter([84, 46, 31], rr), 36, 26, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.9), 14, 0.14, 3),
      });
      g.restore();
    }
  });
  // 5 chestnut: palmate compound leaves (7 leaflets)
  cell(5, 1, () => {
    const r = rng.fork('chestnut');
    const compound = (x: number, y: number, a: number, s: number) => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.strokeStyle = hslStr([60, 30, 32]); g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -38 * s); g.stroke();
      g.translate(0, -38 * s);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const la = (-1 + (2 * i) / (n - 1)) * 1.45;
        const ll = (1 - 0.45 * Math.abs(la) / 1.45) * 78 * s;
        g.save(); g.rotate(la);
        ovalLeaf(withJitter([90, 44, 27], r), ll, ll * 0.42, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 1.35)), 0.75), 24, 0.08, 6)(g, 1, r);
        g.restore();
      }
      g.restore();
    };
    g.strokeStyle = hslStr([28, 22, 26]); g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -70); g.stroke();
    compound(0, -60, -0.7, 0.9);
    compound(0, -70, 0.75, 0.88);
    compound(0, -70, 0.02, 1.0);
  });
  // 6 ginkgo: fan leaves on spur shoots
  cell(6, 1, () => {
    const r = rng.fork('ginkgo');
    const fan: LeafFn = (gg, s, rr) => {
      const R = 34 * s;
      const pts: Pt[] = [[0, 0]];
      for (let i = 0; i <= 30; i++) {
        const a = (-58 + (116 * i) / 30) * deg;
        let rad = R * (1 + 0.04 * Math.sin(i * 1.7));
        if (Math.abs(a) < 0.12) rad *= 0.78 + 0.22 * (Math.abs(a) / 0.12);
        pts.push([Math.sin(a) * rad, -Math.cos(a) * rad]);
      }
      const veins: { from: Pt; to: Pt }[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (-50 + (100 * i) / 8) * deg;
        veins.push({ from: [0, 0], to: [Math.sin(a) * R * 0.95, -Math.cos(a) * R * 0.95] });
      }
      fillLeaf(gg, pts, withJitter([70, 52, 40], rr), R, veins, rr);
    };
    g.strokeStyle = hslStr([28, 15, 32]); g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(6, -120); g.lineTo(2, -190); g.stroke();
    const spurs: [number, number, number][] = [[2, -60, -1], [5, -110, 1], [4, -160, -1], [2, -195, 0]];
    for (const [sx, sy, side] of spurs) {
      const n = r.int(4, 5);
      for (let k = 0; k < n; k++) {
        const a = side * 0.7 + (-0.9 + (1.8 * k) / (n - 1)) * (side === 0 ? 1 : 0.8);
        g.save(); g.translate(sx, sy); g.rotate(a);
        g.strokeStyle = hslStr([70, 30, 35]); g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26); g.stroke();
        g.translate(0, -26);
        fan(g, r.range(0.85, 1.1), r);
        g.restore();
      }
    }
  });
  // 7 shrub (deciduous): dense small leaves on 3 twigs
  cell(7, 1, () => {
    const r = rng.fork('shrub');
    for (const [dx, bend, len] of [[-40, -0.1, 0.8], [40, 0.1, 0.78], [0, 0.0, 0.92]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 10, twigLen: len, bend, spread: [35, 75], petiole: 3, size: [0.8, 1.0], twigW: 2.5, tip: true,
        leaf: (rr) => ovalLeaf(withJitter([92, 38, 29], rr), 30, 17, ov, 0, 0, 2),
      });
      g.restore();
    }
  });
  // 8 pine needle tufts (umbrella pine)
  cell(8, 1, () => {
    const r = rng.fork('pine');
    for (const [dx, a, s] of [[-45, -0.35, 0.85], [45, 0.35, 0.85], [0, 0, 1]] as [number, number, number][]) {
      g.save(); g.translate(dx * 0.6, 0); g.rotate(a);
      drawNeedleTuft(g, r, [118, 28, 25], 95 * s, 170, 150 * s);
      g.restore();
    }
  });
  // 9 cypress scale-leaf sprays
  cell(9, 1, () => {
    const r = rng.fork('cypress');
    for (const [dx, a] of [[-30, -0.35], [30, 0.35], [0, 0], [-10, -0.12], [12, 0.15]] as [number, number][]) {
      drawCypressSpray(g, r, dx, -4, a, r.range(170, 230), 2, [118, 30, 16]);
    }
  });
  // 10 spruce / conical pine branchlet (flat, comb needles)
  cell(10, 1, () => {
    const r = rng.fork('spruce');
    const col: HSL = [135, 26, 22];
    const axis = (x: number, y: number, a: number, len: number, depth: number) => {
      const steps = Math.round(len / 4);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const px = x + Math.sin(a) * len * t, py = y - Math.cos(a) * len * t;
        for (const sd of [-1, 1]) {
          const na = a + sd * r.range(50, 80) * deg;
          const nl = r.range(11, 16) * (1 - t * 0.3);
          g.strokeStyle = hslStr(withJitter(col, r, 6, 6, 6));
          g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(na) * nl, py - Math.cos(na) * nl); g.stroke();
        }
        if (depth > 0 && i > 2 && i % 4 === 0) {
          const sd = (i / 4) % 2 === 0 ? 1 : -1;
          axis(px, py, a + sd * 50 * deg, len * (1 - t) * 0.55, depth - 1);
        }
      }
      g.strokeStyle = hslStr([25, 30, 28]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len); g.stroke();
    };
    axis(0, 0, 0, 236, 1);
  });
  // 11 boxwood / evergreen shrub
  cell(11, 1, () => {
    const r = rng.fork('box');
    for (const [dx, bend, len] of [[-45, -0.12, 0.75], [45, 0.12, 0.75], [-15, -0.03, 0.9], [18, 0.04, 0.88]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 12, twigLen: len, bend, spread: [30, 70], opposite: true, petiole: 0, size: [0.8, 1.0], twigW: 2, tip: true,
        leaf: (rr) => ovalLeaf(withJitter([105, 42, 21], rr), 19, 11, (t) => Math.pow(Math.sin(Math.PI * t), 0.7), 0, 0, 0),
      });
      g.restore();
    }
  });
  // 12 willow (new): long narrow leaves on hanging twigs
  cell(12, 1, () => {
    const r = rng.fork('willow');
    for (const [dx, bend, len] of [[-55, -0.08, 0.9], [50, 0.07, 0.85], [-5, 0.01, 0.97]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 9, twigLen: len, bend, spread: [12, 30], petiole: 3, size: [0.8, 1.0], twigW: 2, tip: true, twigCol: [40, 30, 34], startT: 0.08,
        leaf: (rr) => ovalLeaf(withJitter([92, 30, 38], rr), 64, 10, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8), 30, 0.08, 0),
      });
      g.restore();
    }
  });
  // 13 olive (new): narrow grey-green leaves, opposite, silvery
  cell(13, 1, () => {
    const r = rng.fork('olive');
    for (const [dx, bend, len] of [[-45, -0.1, 0.8], [45, 0.1, 0.8], [0, 0.02, 0.95]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 6, twigLen: len, bend, spread: [25, 55], opposite: true, petiole: 2, size: [0.8, 1.0], twigW: 2.2, tip: true, twigCol: [35, 12, 38],
        leaf: (rr) => ovalLeaf(withJitter([82, 14, 40], rr, 6, 4, 5), 44, 9, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.7), 0, 0, 0),
      });
      g.restore();
    }
  });
  // 14 heather (new): dense sprays of tiny scale leaves, with flowers
  cell(14, 1, () => {
    const r = rng.fork('heather');
    for (const [dx, a] of [[-40, -0.3], [40, 0.3], [0, 0], [-18, -0.1], [20, 0.12]] as [number, number][]) {
      drawCypressSpray(g, r, dx, -4, a, r.range(150, 210), 1, [110, 28, 22]);
    }
    for (let i = 0; i < 260; i++) {
      const t = Math.pow(r.float(), 0.6), x = r.range(-95, 95) * (1 - t * 0.4), y = -40 - t * 170;
      g.fillStyle = hslStr(withJitter([312, 42, 58], r, 10, 10, 8));
      g.beginPath(); g.ellipse(x, y, r.range(2, 3.2), r.range(2.6, 4), r.range(-0.4, 0.4), 0, Math.PI * 2); g.fill();
    }
  });
  // 15 holm oak (new): small dark leathery leaves, faintly toothed, dense
  cell(15, 1, () => {
    const r = rng.fork('holm oak');
    for (const [dx, bend, len] of [[-48, -0.1, 0.78], [48, 0.1, 0.78], [-14, -0.03, 0.92], [16, 0.04, 0.9]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 9, twigLen: len, bend, spread: [35, 75], petiole: 5, size: [0.8, 1.0], twigW: 2.5, tip: true,
        leaf: (rr) => ovalLeaf(withJitter([105, 32, 21], rr), 32, 17, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.75), 10, 0.1, 3),
      });
      g.restore();
    }
  });

  // dilate colours into transparent texels so mip-mapping doesn't bleed dark fringes
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  const valid = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) valid[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  for (let pass = 0; pass < 10; pass++) {
    const next = valid.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (valid[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const j = yy * S + xx;
        if (!valid[j]) continue;
        r += d[j * 4]; gg += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) {
        d[i * 4] = r / n; d[i * 4 + 1] = gg / n; d[i * 4 + 2] = b / n;
        next[i] = 1;
      }
    }
    valid.set(next);
  }
  return new Uint8Array(d.buffer.slice(0));
}

/**
 * The mean colour (linear) of each of the atlas's 16 cells over the texels a leaf card shows (alpha past the LEAF
 * kind's cut-off, `LEAF_CUT`): what a crown of its cards looks like from a little way off, which the far hull matches.
 */
export function leafMeans(atlas: Uint8Array): Float32Array {
  const S = LEAF_ATLAS_SIZE, C = S / 4, out = new Float32Array(16 * 3), cut = LEAF_CUT * 255;
  const lin = new Float32Array(256).map((_, v) => srgbToLinear(v / 255));
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * C, cy = Math.floor(i / 4) * C;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy; y < cy + C; y++) for (let x = cx; x < cx + C; x++) {
      const o = (y * S + x) * 4;
      if (atlas[o + 3] <= cut) continue;
      r += lin[atlas[o]]; g += lin[atlas[o + 1]]; b += lin[atlas[o + 2]]; n++;
    }
    if (n) out.set([r / n, g / n, b / n], i * 3);
  }
  return out;
}

/** The alpha below which a leaf card's texel is cut away (the LEAF kind's mask). */
export const LEAF_CUT = 0.45;
