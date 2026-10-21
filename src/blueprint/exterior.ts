/**
 * The habitat from outside: the drum, the endcap faces, the radiator brims, the despun dock spindle and the wild
 * end's mast, all in the blueprint frame (frame.ts: +z from the wild wall at z = 0 to the port wall at z = L, r from
 * the axis). Pure numbers; the exterior renderer and the title flight read them (design "Solarpolis: the outside").
 *
 * Brims: the endcap faces radiate on their own; each brim adds two faces of a flat ring from the outer radius to its
 * tip. Stacked brims face each other across their gap, and the share of each facing side that still sees space comes
 * from the view factor between two parallel strips: F = √(1 + (gap / width)²) − gap / width.
 */
import type { ExteriorShape } from './params';

export interface Brim {
  /** Axial position of the brim's mid-plane (m). */
  z: number;
  /** Inner (the outer radius) and tip radius (m). */
  inner: number;
  tip: number;
  thickness: number;
  end: 'wild' | 'port';
}

export interface Exterior {
  /** Outer radius of the drum (m). */
  radius: number;
  /** Axial positions of the wild and port endcap faces (m); the faces sit a full layer stack beyond the walls. */
  wildFace: number;
  portFace: number;
  /** Brims per end, and every brim (wild end first, each end from its face inward). */
  brimsPerEnd: number;
  brims: Brim[];
  /** The radiating area the brims and faces provide, counted as fully open faces (m²); at least `radiatorArea` when they fit. */
  radiatingArea: number;
  /** Whether `maxBrims` per end within `brimReach` can shed the heat. */
  fits: boolean;
  /** Tip speed of the brims relative to the stars (m/s), and the hoop stress it puts in a thin ring (Pa). */
  brimTipSpeed: number;
  brimStress: number;
  /**
   * The despun spindle: from the port face out along the axis. Its berth arms reach out from it at `arms.z`, each
   * `arms.length` long and `arms.width` square, where ships tie up.
   */
  spindle: { from: number; to: number; radius: number; berthArms: number; arms: { z: number; length: number; width: number } };
  /** The wild end's mast, a lattice seen from afar as a rod. */
  mast: { from: number; to: number; radius: number };
  /** The body as solid round pieces along the axis (drum, brims, spindle, mast), for distances and hit tests. */
  pieces: Piece[];
  /** The outline of the whole body as (z, r) points, wild tip to port tip: mast, wild face, drum, port face, spindle. */
  outline: [number, number][];
}

/** A solid cylinder around the axis from z0 to z1 (m). */
export interface Piece {
  z0: number;
  z1: number;
  radius: number;
}

export interface ExteriorInputs {
  length: number;
  /** Outer radius of the drum, and the depth of the layer stack under the floor (outer − surface), which the endcaps share (m). */
  outer: number;
  stack: number;
  hubRadius: number;
  spin: number;
  /** Radiating area needed, one face counted per square metre (m²). */
  radiatorArea: number;
  shape: ExteriorShape;
}

/** Share of one side of a stacked brim that sees space past its neighbour. */
function openShare(gap: number, width: number): number {
  const q = gap / width;
  return 1 - (Math.sqrt(1 + q * q) - q);
}

/** Effective radiating area of one end: its face plus k brims out to `tip`. */
function endArea(outer: number, tip: number, k: number, gap: number): number {
  const ring = Math.PI * (tip * tip - outer * outer);
  if (ring <= 0) return Math.PI * outer * outer;
  return Math.PI * outer * outer + ring * (2 + 2 * (k - 1) * openShare(gap, tip - outer));
}

export function makeExterior(x: ExteriorInputs): Exterior {
  const s = x.shape, Ro = x.outer;
  const wildFace = -x.stack, portFace = x.length + x.stack;
  const need = x.radiatorArea / 2;
  const gap = s.brimSpacing * Ro, maxTip = s.brimReach * Ro;
  let k = 1, tip = Ro, fits = false;
  for (; k <= s.maxBrims; k++) {
    if (endArea(Ro, maxTip, k, gap) < need) continue;
    // Smallest tip that sheds the heat with k brims: the area grows with the tip, so bisect.
    let lo = Ro, hi = maxTip;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (endArea(Ro, mid, k, gap) >= need) hi = mid; else lo = mid;
    }
    tip = hi;
    fits = true;
    break;
  }
  if (!fits) { k = s.maxBrims; tip = maxTip; }
  // An end whose face alone is enough still gets one brim as its rim, the width of its thickness.
  if (tip - Ro < s.brimThickness) tip = Ro + s.brimThickness;
  const brims: Brim[] = [];
  for (const end of ['wild', 'port'] as const) {
    for (let i = 0; i < k; i++) {
      const z = end === 'wild' ? wildFace + s.brimThickness / 2 + i * gap : portFace - s.brimThickness / 2 - i * gap;
      brims.push({ z, inner: Ro, tip, thickness: s.brimThickness, end });
    }
  }
  const tipSpeed = x.spin * tip;
  const spindleTo = portFace + s.spindleLength * Ro;
  const arms = { z: portFace + (spindleTo - portFace) * 0.7, length: x.hubRadius * 2, width: x.hubRadius * 0.12 };
  const spindle = { from: portFace, to: spindleTo, radius: x.hubRadius, berthArms: s.berthArms, arms };
  const mast = { from: wildFace - s.mastLength * Ro, to: wildFace, radius: x.hubRadius * 0.1 };
  const pieces: Piece[] = [
    { z0: wildFace, z1: portFace, radius: Ro },
    ...brims.map((b) => ({ z0: b.z - b.thickness / 2, z1: b.z + b.thickness / 2, radius: b.tip })),
    { z0: portFace, z1: spindleTo, radius: x.hubRadius },
    { z0: mast.from, z1: wildFace, radius: mast.radius },
  ];
  return {
    radius: Ro,
    wildFace,
    portFace,
    brimsPerEnd: k,
    brims,
    radiatingArea: 2 * endArea(Ro, tip, k, gap),
    fits,
    brimTipSpeed: tipSpeed,
    brimStress: s.brimMaterial.density * tipSpeed * tipSpeed,
    spindle,
    mast,
    pieces,
    outline: [
      [mast.from, 0], [wildFace, 0], [wildFace, Ro], [portFace, Ro],
      [portFace, x.hubRadius], [spindle.to, x.hubRadius], [spindle.to, 0],
    ],
  };
}

/**
 * How far a point (blueprint frame) is from the habitat's outside: the nearest of its pieces, negative inside one.
 * Berth arms and other hardware are left out; they are smaller than any approach a camera keeps.
 */
export function exteriorDistance(e: Exterior, p: readonly [number, number, number]): number {
  const rho = Math.hypot(p[0], p[1]);
  let best = Infinity;
  for (const c of e.pieces) {
    const dr = rho - c.radius, dz = Math.abs(p[2] - (c.z0 + c.z1) / 2) - (c.z1 - c.z0) / 2;
    const d = Math.hypot(Math.max(dr, 0), Math.max(dz, 0)) + Math.min(Math.max(dr, dz), 0);
    if (d < best) best = d;
  }
  return best;
}
