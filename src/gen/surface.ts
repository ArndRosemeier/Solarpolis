/**
 * The interior surface as one triangle grid: the profile swept around the axis (θ by s), with a ground colour per
 * vertex. This is the first, coarse look at a whole habitat, the backdrop the detailed chunks will later replace
 * near the viewer. Pure data (no three.js): it runs in workers and tests.
 *
 * The grid is sized by a vertex budget, not by the habitat: cells come out about square, so a small cylinder gets
 * fine cells and a large one coarse cells, from the same code.
 */
import { Noise, deriveSeed, lerp, smoothstep } from '@futuremagic/core';
import type { Habitat } from '../blueprint';

export interface SurfaceGrid {
  /** Columns around the axis (the seam column repeats the first, so each row has `columns + 1` vertices). */
  columns: number;
  /** Rows along the profile (`rows + 1` vertex rings). */
  rows: number;
  /** Edge length of a cell, about (m). */
  cell: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  index: Uint32Array;
}

/** Cells in the grid, about: what a desktop GPU draws without noticing and a tablet still holds in memory. */
export const SURFACE_CELLS = 300_000;

/** Ground colours (linear RGB). The ecology stage will replace this with real biomes. */
const MEADOW: readonly [number, number, number] = [0.16, 0.32, 0.08];
const FOREST: readonly [number, number, number] = [0.05, 0.14, 0.04];
const ROCK: readonly [number, number, number] = [0.28, 0.26, 0.22];

/** The grid's columns and rows for a habitat, from the cell budget. */
export function gridSize(h: Habitat, cells = SURFACE_CELLS): { columns: number; rows: number; cell: number } {
  const around = 2 * Math.PI * h.radius;
  const cell = Math.sqrt((around * h.profile.length) / cells);
  return { columns: Math.max(16, Math.round(around / cell)), rows: Math.max(8, Math.round(h.profile.length / cell)), cell };
}

export function buildSurface(h: Habitat, cells = SURFACE_CELLS): SurfaceGrid {
  const { columns, rows, cell } = gridSize(h, cells);
  const profile = h.profile;
  const noise = new Noise(deriveSeed(h.seed, 'surface'));
  // Patches of forest and meadow at the scale of a few hundred metres to kilometres: a size of the land, not the habitat.
  const PATCH = 1500;
  const ring = columns + 1, count = ring * (rows + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const cos = new Float64Array(ring), sin = new Float64Array(ring);
  for (let c = 0; c <= columns; c++) {
    const theta = (c / columns) * Math.PI * 2;
    cos[c] = Math.cos(theta);
    sin[c] = Math.sin(theta);
  }
  for (let row = 0; row <= rows; row++) {
    const p = profile.at((row / rows) * profile.length);
    // Steepness: 0 on the floor, 1 on a vertical wall (an endcap's upper face).
    const steep = Math.abs(p.nz);
    for (let c = 0; c <= columns; c++) {
      const i = (row * ring + c) * 3;
      const x = p.r * cos[c], y = p.r * sin[c];
      positions[i] = x; positions[i + 1] = y; positions[i + 2] = p.z;
      normals[i] = p.nr * cos[c]; normals[i + 1] = p.nr * sin[c]; normals[i + 2] = p.nz;
      const n = noise.fbm3(x / PATCH, y / PATCH, p.z / PATCH, 4);
      const forest = smoothstep(0.05, 0.25, n);
      const rock = smoothstep(0.55, 0.85, steep + 0.15 * n);
      for (let k = 0; k < 3; k++) colors[i + k] = lerp(lerp(MEADOW[k], FOREST[k], forest), ROCK[k], rock) * (0.9 + 0.2 * noise.fbm3(x / 90, y / 90, p.z / 90, 2));
    }
  }
  const index = new Uint32Array(rows * columns * 6);
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < columns; c++) {
      const a = row * ring + c, b = a + 1, d = a + ring, e = d + 1;
      // Wound so the face looks into the air (towards the normal).
      index[k++] = a; index[k++] = d; index[k++] = b;
      index[k++] = b; index[k++] = d; index[k++] = e;
    }
  }
  return { columns, rows, cell, positions, normals, colors, index };
}

/** Bytes the grid's arrays hold, for the memory watchdog. */
export function surfaceBytes(g: SurfaceGrid): number {
  return g.positions.byteLength + g.normals.byteLength + g.colors.byteLength + g.index.byteLength;
}
