/**
 * The Mountain's snow (gen/plan.ts, `Mountain.snowLine`): where it lies, as one rule the ground's shader (GROUND, render/
 * groundShaders.ts `snowOn`) and the CPU (ecology's floor, scatter, the eyes' meter) both follow, so the snow seen
 * from across the habitat is the snow underfoot (docs/far-view.md, "Snow").
 *
 *   gravity   it lies where gravity is below the snow line's share of the floor's (r below `line`), on the wild end
 *             only, fading in over a band (`band`) whose edge the shader breaks up with noise;
 *   slope     it holds on slopes whose tangent is under its friction's plus its cohesion's share against its weight
 *             (`tanHolds`). The weight falls with gravity and the cohesion does not, so where gravity is a tenth of
 *             the floor's, settled snow clings to walls of 70° and more, as it clings to the steep flutes of high
 *             mountains on Earth only in its stickiest. Steeper rock shows through as dark ribs and headwalls.
 *
 * Pure: no three, no DOM.
 */
import { smoothstep } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { kept } from './kept';
import { landformOf } from './plan';

/** The band the snow fades in over, as a share of the snow line's radius (half of it either side of the line). */
export const SNOW_BAND = 0.25;
/**
 * Settled snow on a slope: its friction (tan 31°) and its cohesion against its own weight in the floor's gravity (a
 * metre of it): together it holds to 42° at full gravity, as on Earth, to 68° at the reference snow line.
 */
export const TAN_FRICTION = 0.6, COHESION = 0.3;
/** Steeper than this it holds nowhere, however weak gravity is: tan 80°. */
export const TAN_MAX = 5.7;
/** The snow's albedo (linear RGB): old, settled snow, a little blue. */
export const SNOW_ALBEDO: readonly [number, number, number] = [0.78, 0.8, 0.84];

export interface SnowField {
  /** The snow line's distance from the axis (m): gravity there is `snowLine` of the floor's. */
  readonly line: number;
  /** Half the band the snow fades in over (m, across the axis). */
  readonly band: number;
  /** The snow lies only where z is below this (the wild end's half). */
  readonly side: number;
  /** The habitat's radius (m): gravity at r from the axis is r / radius of the floor's. */
  readonly radius: number;
}

/** A habitat's snow, from its plan (made once per habitat). */
export const snowFieldOf: (h: Habitat) => SnowField = kept((h: Habitat): SnowField => {
  const line = landformOf(h).mountain.snowLine * h.radius, { profile } = h;
  return { line, band: line * SNOW_BAND * 0.5, side: (profile.at(profile.floorStart).z + profile.at(profile.floorEnd).z) / 2, radius: h.radius };
});

/** How much of the ground at (x, y, z) lies above the snow line (0 … 1), by gravity alone: the band without its noise. */
export function snowCover(f: SnowField, x: number, y: number, z: number): number {
  if (z >= f.side) return 0;
  return 1 - smoothstep(f.line - f.band, f.line + f.band, Math.hypot(x, y));
}

/** How steep snow holds (tan of the slope) at a distance `r` (m) from the axis: its cohesion counts more as gravity falls. */
export function tanHolds(f: SnowField, r: number): number {
  return Math.min(TAN_MAX, TAN_FRICTION + (COHESION * f.radius) / Math.max(r, 1e-6));
}

/**
 * Whether snow holds on ground whose normal makes `level` (cosine) with up, at `r` from the axis (0 … 1): fully up to
 * a little under `tanHolds`, none a little over.
 */
export function snowHolds(f: SnowField, r: number, level: number): number {
  const tan = Math.sqrt(Math.max(0, 1 - level * level)) / Math.max(level, 1e-3);
  return 1 - smoothstep(0.85, 1.15, tan / tanHolds(f, r));
}

/** How much of the ground snow covers at (x, y, z) with that `level` (0 … 1), as the shader has it without its noise. */
export function snowLies(f: SnowField, x: number, y: number, z: number, level: number): number {
  const cover = snowCover(f, x, y, z);
  return cover > 0 ? cover * snowHolds(f, Math.hypot(x, y), level) : 0;
}
