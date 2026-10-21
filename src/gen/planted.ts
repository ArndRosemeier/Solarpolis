/**
 * Plants set by hand, not scattered: each stands exactly where someone planted it, of a species of the climate, at its
 * own height. For now the founders' grove (Solarpolis design, "A land people make": quiet and memory): on the habitat
 * plan's `founders-grove` site, a ring of the climate's founders' tree (`Climate.grove`) around a clearing, planted
 * when the habitat was new and so the oldest and tallest trees in it. Where the site is too small for a ring, one such
 * tree stands alone. Later, places (orchards, avenues, vineyards) plant here too.
 *
 * The scatter stage draws them as species of their own (`plantsOf`, kind `planted`), cell by cell at every level, and
 * keeps scattered trees and debris out of a grove's clearing (`scatterKeepsOff`); the ecology lays their crowns into
 * the woods' canopy from afar (`plantedCanopy`), so a grove is still there when its trees are too far to draw. Pure.
 */
import { deriveSeed, hash3f, smoothstep } from '@futuremagic/core';
import { climateOf, type Climate, type PlantSpec } from '../blueprint';
import type { Terrain } from './terrain';
import { planOf, siteOf } from './plan';
import { canopyColor } from './trees';
import { kept } from './kept';

/** One planted plant: its species (a plant of the climate, by name), where it stands, its height (m) and turn. */
export interface Planted {
  species: string;
  theta: number;
  s: number;
  height: number;
  turn: number;
}

/** A grove: a ring of trees around a clearing (or one tree, `ring` 0), and how far scattered trees keep off it. */
export interface Grove {
  kind: 'founders-grove';
  theta: number;
  s: number;
  /** The ring's radius (m; 0 for a lone tree), the trees' crown diameter and the clearing's radius. */
  ring: number;
  crown: number;
  clear: number;
  spec: PlantSpec;
  trees: Planted[];
}

export interface Plantings {
  groves: Grove[];
  /** Every planted plant, by species name. */
  bySpecies: ReadonlyMap<string, readonly Planted[]>;
}

/** How much taller the founders' trees grew than their species' tallest scattered ones: two centuries, and room. */
export const FOUNDERS_GROWTH = 1.35;
/** A tree's crown diameter as a share of its height (as `canopyOf` reckons crowns). */
const CROWN = 0.55;
/** The ring stands this share of the way out to the site's edge. */
const RING_SHARE = 0.6;
/** Trees in the ring stand this many crown diameters apart (their crowns all but touch). */
const RING_GAP = 1.15;
/** Fewer trees than this would not read as a ring: one tree stands alone instead. */
const RING_MIN = 6;

/** The plantings of a terrain (made once per terrain, then kept). */
export const plantingsOf: (t: Terrain) => Plantings = kept(makePlantings);

/** The climate's plant of that name, if one of its biomes grows it. */
export function plantSpec(climate: Climate, name: string): PlantSpec | null {
  for (const b of climate.biomes) for (const p of b.plants) if (p.name === name) return p;
  return null;
}

function makePlantings(t: Terrain): Plantings {
  const groves: Grove[] = [];
  const site = siteOf(planOf(t.habitat), 'founders-grove');
  const climate = climateOf(t.habitat.params.climate), spec = climate && plantSpec(climate, climate.grove);
  if (site && spec) groves.push(foundersGrove(t, site.theta, site.s, site.size, spec));
  const bySpecies = new Map<string, Planted[]>();
  for (const g of groves) for (const tree of g.trees) {
    const list = bySpecies.get(tree.species) ?? [];
    list.push(tree);
    bySpecies.set(tree.species, list);
  }
  return { groves, bySpecies };
}

/** The founders' grove on its site: as many trees as fit round the ring with their crowns all but touching. */
function foundersGrove(t: Terrain, theta: number, s: number, size: number, spec: PlantSpec): Grove {
  const h = t.habitat, seed = deriveSeed(h.seed, 'planted', 'founders-grove');
  const height = spec.height[1] * FOUNDERS_GROWTH, crown = height * CROWN;
  const r = h.profile.at(s).r, ringR = size * RING_SHARE;
  const count = Math.floor((2 * Math.PI * ringR) / (crown * RING_GAP));
  const lone = count < RING_MIN;
  const trees: Planted[] = [];
  const plantAt = (a: number, k: number): void => {
    // Each its own: a little taller or shorter, turned its own way.
    const pt = theta + (Math.sin(a) * ringR) / r, ps = s + Math.cos(a) * ringR;
    if (t.standAt(pt, ps) > t.heightAt(pt, ps) + 0.05) return; // a ring is never planted in the water
    trees.push({ species: spec.name, theta: pt, s: ps, height: height * (0.92 + 0.08 * hash3f(seed, k, 0, 1)), turn: hash3f(seed, k, 0, 2) * 2 * Math.PI });
  };
  if (lone) {
    trees.push({ species: spec.name, theta, s, height, turn: hash3f(seed, 0, 0, 2) * 2 * Math.PI });
    return { kind: 'founders-grove', theta, s, ring: 0, crown, clear: crown, spec, trees };
  }
  for (let k = 0; k < count; k++) plantAt((2 * Math.PI * k) / count, k);
  return { kind: 'founders-grove', theta, s, ring: ringR, crown, clear: ringR + crown, spec, trees };
}

/** The planted plants of a species within a (θ, s) rectangle of the profile. */
export function plantedIn(t: Terrain, species: string, b: { theta0: number; theta1: number; s0: number; s1: number }): Planted[] {
  const list = plantingsOf(t).bySpecies.get(species) ?? [];
  const turn = 2 * Math.PI;
  return list.filter((p) => {
    const th = ((p.theta % turn) + turn) % turn;
    return p.s >= b.s0 && p.s < b.s1 && th >= b.theta0 && th < b.theta1;
  });
}

/** Where a point lies from a grove's middle across the ground (m: along s, around), and how far. */
function fromMiddle(t: Terrain, g: Grove, theta: number, s: number): number {
  const r = t.habitat.profile.at(g.s).r;
  const d = Math.atan2(Math.sin(theta - g.theta), Math.cos(theta - g.theta)) * r;
  return Math.hypot(s - g.s, d);
}

/**
 * Whether scattered trees, shrubs and debris keep off a point: inside a grove's clearing and under its ring (grass
 * still grows there: the clearing is a lawn, `plantedLawn`).
 */
export function scatterKeepsOff(t: Terrain, theta: number, s: number): boolean {
  for (const g of plantingsOf(t).groves) if (Math.abs(s - g.s) < g.clear && fromMiddle(t, g, theta, s) < g.clear) return true;
  return false;
}

/**
 * How much a point is a grove's lawn (0 … 1): its clearing and the ground under its ring, mown, soft at the edge. The
 * ecology gives it to its open, grassy biome there (`biomesAt`), so the ground, its floor and its grass agree.
 */
export function plantedLawn(t: Terrain, theta: number, s: number): number {
  let lawn = 0;
  for (const g of plantingsOf(t).groves) {
    const edge = g.crown / 2;
    if (Math.abs(s - g.s) > g.clear + edge) continue;
    lawn = Math.max(lawn, 1 - smoothstep(g.clear - edge, g.clear + edge, fromMiddle(t, g, theta, s)));
  }
  return lawn;
}

/**
 * The planted crowns over a point, for the woods' canopy from afar: how much of it they cover (0 … 1), their height
 * and colour (linear RGB); null where none are. A ring is smoothed along its circle (the share of it the crowns fill),
 * so far tiles see it however coarsely they sample.
 */
export function plantedCanopy(t: Terrain, theta: number, s: number): { cover: number; height: number; color: [number, number, number] } | null {
  for (const g of plantingsOf(t).groves) {
    const reach = g.ring + g.crown;
    if (Math.abs(s - g.s) > reach || !g.trees.length) continue;
    const d = fromMiddle(t, g, theta, s), half = g.crown / 2;
    const off = g.ring ? Math.abs(d - g.ring) : d;
    if (off > half) continue;
    const fill = g.ring ? Math.min(1, (g.trees.length * g.crown) / (2 * Math.PI * g.ring)) : 1;
    const cover = fill * smoothstep(half, half * 0.6, off);
    if (cover <= 0) continue;
    return { cover, height: g.trees.reduce((n, p) => n + p.height, 0) / g.trees.length, color: canopyColor(g.spec.form) };
  }
  return null;
}
