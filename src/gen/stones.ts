/**
 * Stones: pebbles, field stones, rocks and boulders, built once per variant and drawn as instances wherever the scatter
 * stage lays the climate's debris (`gen/scatter.ts`).
 *
 * A stone is a sphere pushed into a rough, flattened lump: an ellipsoid of its own proportions, a few flat breaks where
 * it split (planes it is cut back to), and a lumpy surface on top (noise at two scales). The three levels sample that one
 * surface ever more finely (icospheres of 0, 1 and 3 subdivisions), so a stone keeps its outline as it comes near and
 * gains its finer bumps. Each vertex carries its colour: the climate's rock, varied, darker toward the ground, mossy on
 * top where it is damp.
 *
 * One unit high above the ground (base sunk below it, so it sits in the ground rather than on it): an instance scales it
 * to the stone's height. Pure.
 */
import { Noise, Rng, deriveSeed, mixRgb, smoothstep } from '@futuremagic/core';
import type { Rgb } from '../blueprint';
import { icosphere } from './shapes';

/** A stone at one level: positions, normals, linear colours, triangles. */
export interface StoneMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  index: Uint32Array;
}

export interface StoneModel {
  full: StoneMesh;
  lite: StoneMesh;
  hull: StoneMesh;
}

/** Subdivisions of the icosphere per level (full, lite, hull): 1280, 80 and 20 triangles. */
export const STONE_DETAIL = [3, 1, 0] as const;
/** How much of the lump is sunk below the ground (share of its height). */
const SINK = 0.3;
/** The moss's colour (linear). */
const MOSS: Rgb = [0.07, 0.11, 0.03];

/** A stone of a variant, in the climate's rock colour, with `moss` (0 … 1) on its top. */
export function buildStone(color: Rgb, moss: number, seed: number, variant: number): StoneModel {
  const rng = new Rng(deriveSeed(seed, 'stone', variant));
  const lump = new Noise(deriveSeed(seed, 'stone', variant, 'lump')), fine = new Noise(deriveSeed(seed, 'stone', variant, 'fine'));
  const tint = new Noise(deriveSeed(seed, 'stone', variant, 'tint'));
  // Its own proportions: wider than high, some longer than wide.
  const rx = 1, ry = rng.range(0.45, 0.8), rz = rng.range(0.65, 1);
  // Where it split: planes it is cut back to (a normal, and how far out along it).
  const breaks = Array.from({ length: rng.int(3, 6) }, () => {
    const n = rng.onSphere();
    return { n, d: rng.range(0.55, 0.85) };
  });
  const shade = rng.range(0.85, 1.12);
  const body: Rgb = [color[0] * shade, color[1] * shade * rng.range(0.97, 1.03), color[2] * shade * rng.range(0.95, 1.05)];

  /**
   * A point of the surface, from a direction on the unit sphere, and how far its bumps stand out of the lump (its
   * pits negative: darker, as dirt and shade gather there); `detail` adds the finest bumps.
   */
  const surface = (d: readonly number[], detail: boolean): { p: [number, number, number]; bump: number } => {
    const r0 = 1 + 0.12 * lump.fbm3(d[0] * 1.4, d[1] * 1.4, d[2] * 1.4, 2);
    let x = d[0] * rx * r0, y = d[1] * ry * r0, z = d[2] * rz * r0;
    for (const b of breaks) {
      const out = x * b.n[0] + y * b.n[1] + z * b.n[2] - b.d;
      // Cut back to the plane where it split, leaving a hint of the old surface (a worn edge).
      if (out > 0) { const k = out * 0.97; x -= b.n[0] * k; y -= b.n[1] * k; z -= b.n[2] * k; }
    }
    let bump = 0.05 * lump.fbm3(d[0] * 3.5 + 7, d[1] * 3.5, d[2] * 3.5, 2);
    if (detail) bump += 0.025 * fine.fbm3(d[0] * 9, d[1] * 9, d[2] * 9, 3);
    const r = 1 + bump;
    return { p: [x * r, y * r, z * r], bump };
  };

  const levels = STONE_DETAIL.map((n) => {
    const { verts, faces } = icosphere(n);
    const at = verts.map((d) => surface(d, n === STONE_DETAIL[0]));
    return { pos: at.map((a) => a.p), bumps: at.map((a) => a.bump), faces, dirs: verts };
  });
  // One unit high above the ground: the full stone's top, its base sunk by SINK.
  let lo = Infinity, hi = -Infinity;
  for (const p of levels[0].pos) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  const ground = lo + (hi - lo) * SINK, k = 1 / (hi - ground);

  const [full, lite, hull] = levels.map(({ pos, bumps, faces, dirs }) => {
    const normals = smoothNormals(pos, faces);
    const positions = new Float32Array(pos.length * 3), colors = new Float32Array(pos.length * 3), nrm = new Float32Array(pos.length * 3);
    pos.forEach((p, i) => {
      const y = (p[1] - ground) * k;
      positions.set([p[0] * k, y, p[2] * k], i * 3);
      nrm.set(normals[i], i * 3);
      // The rock varied over the stone, darker where it meets the ground, moss where its top faces up and holds damp.
      const d = dirs[i], v = 1 + 0.16 * tint.fbm3(d[0] * 2.5, d[1] * 2.5, d[2] * 2.5, 2);
      const low = 0.55 + 0.45 * smoothstep(-0.1, 0.35, y), pit = 0.8 + 0.2 * Math.max(-1, Math.min(1, bumps[i] / 0.04));
      const f = v * low * pit;
      let c = [body[0] * f, body[1] * f, body[2] * f] as [number, number, number];
      const mossy = moss * smoothstep(0.35, 0.85, normals[i][1] + 0.35 * tint.fbm3(d[0] * 4 + 9, d[1] * 4, d[2] * 4, 2));
      c = mixRgb(c, [MOSS[0], MOSS[1], MOSS[2]], Math.min(1, mossy));
      colors.set(c, i * 3);
    });
    return { positions, normals: nrm, colors, index: new Uint32Array(faces.flat()) };
  });
  return { full, lite, hull };
}

/** Per-point normals: the area-weighted normals of the faces around each point. */
function smoothNormals(pos: readonly (readonly number[])[], faces: readonly (readonly number[])[]): [number, number, number][] {
  const n = pos.map(() => [0, 0, 0] as [number, number, number]);
  for (const [a, b, c] of faces) {
    const [ax, ay, az] = pos[a], [bx, by, bz] = pos[b], [cx, cy, cz] = pos[c];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i][0] += fx; n[i][1] += fy; n[i][2] += fz; }
  }
  return n.map(([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; });
}
