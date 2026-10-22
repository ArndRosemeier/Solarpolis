/**
 * The hamlets' homes (design "The Understorey: life below the land", step 4): walled houses of tall rooms under the
 * vaults, one household each, `1 / under.household.bays` to a home bay. Each stands on its own plot, with a walled
 * yard in front toward the wellhead, its storeys as many as fit under the vaults' springing (one to four), its roof a
 * terrace.
 *
 * Every house has an author and an age. The hamlet has been rebuilt a seeded number of times in its two centuries, so
 * its houses are of three eras (the design's "the city has an age"): the founders' plain cast stone, the screen era's
 * smooth panels (stripped back since), and today's return to the real, built in the district's own way (fired brick
 * for the makers, pale stone by the water, plaster in the orchards, rammed earth with the herds, timber in the groves).
 * A district that let its land go has let some of its houses empty too.
 *
 * Sizes are human (`landmarks.handrail`) or structural (the bay, the pillars, the levels): nothing grows with the
 * habitat but the number of houses (a bay too short for its households' plots holds fewer). Pure; worked out on
 * demand per bay.
 */
import { deriveSeed, Rng } from '@futuremagic/core';
import type { DistrictStyle, Habitat } from '../blueprint';
import { planOf } from './plan';
import { underOf, type Hamlet } from './under';
import type { Levels } from './underLevels';

export const ERAS = ['founders', 'screen', 'return'] as const;
export type Era = (typeof ERAS)[number];
/** What a house is built of. */
export type Build = 'cast' | 'panel' | 'brick' | 'stone' | 'plaster' | 'earth' | 'timber';

/** A rectangle in a bay's frame (m): x along the axis, y around, from the bay's first corner. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface House {
  /** Its plot (walled), and the house itself in it; the rest is its yard. */
  plot: Rect;
  body: Rect;
  /** Its storeys, and the height of each (m). */
  storeys: number;
  storey: number;
  /** Its ground floor's level (m over the profile): the floor's highest in its plot, so it stands level on a plinth. */
  base: number;
  /** The way its door and its yard's gate face: along y, toward −y (−1) or +y (+1). */
  door: -1 | 1;
  era: Era;
  build: Build;
  /** Whether anyone lives in it (a let-go district leaves some empty). */
  lived: boolean;
  /** Its own seed, for the details drawn on it. */
  seed: number;
}

/** A storey's height, in handrails: tall rooms. */
const STOREY = 4;
/** Head room left under the vaults' springing over the roof's parapet, in handrails. */
const HEADROOM = 2;
/** The parapet round a roof terrace and the yard wall (chest high: the house shows over it), in handrails. */
export const PARAPET = 1;
export const YARD_WALL = 1.2;
/** The walk left round each plot (beside the pillars' plinths), in handrails. */
const WALK = 2;
/** A plot's least width and depth, in handrails. */
const NARROWEST = 8;
const DEPTH = 10;
/** The yard's share of a plot's depth (toward the door), from … to. */
const YARD: [number, number] = [0.2, 0.4];
/** The gap beside a house in its plot, in handrails, from … to. */
const SIDE: [number, number] = [0.3, 1.2];

/**
 * How each style builds today, and how many of its houses are still of each era (founders, screen, return): its weights.
 * Makers rebuild often; a let-go district keeps what the founders left, and empties some.
 */
const STYLED: Readonly<Record<DistrictStyle, { build: Build; eras: [number, number, number]; storeys: [number, number, number, number]; empty: number }>> = {
  orchard: { build: 'plaster', eras: [1, 0.6, 3], storeys: [1, 3, 2, 0.3], empty: 0.02 },
  water: { build: 'stone', eras: [1, 0.5, 3], storeys: [1, 2, 2, 0.5], empty: 0.02 },
  stone: { build: 'stone', eras: [2, 0.5, 2], storeys: [0.5, 2, 3, 1], empty: 0.03 },
  grove: { build: 'timber', eras: [1, 0.4, 3], storeys: [2, 3, 1, 0], empty: 0.03 },
  herd: { build: 'earth', eras: [1, 0.4, 2.5], storeys: [3, 2, 0.5, 0], empty: 0.03 },
  play: { build: 'plaster', eras: [0.5, 1, 3], storeys: [1, 2, 2, 1], empty: 0.02 },
  makers: { build: 'brick', eras: [0.5, 0.5, 4], storeys: [0.5, 2, 3, 2], empty: 0.01 },
  'let-go': { build: 'plaster', eras: [3, 1.5, 1], storeys: [2, 2, 1, 0], empty: 0.3 },
};
const ERA_BUILD: Readonly<Record<Exclude<Era, 'return'>, Build>> = { founders: 'cast', screen: 'panel' };

/**
 * The houses in bay (i, j), none but in a hamlet's home bays: `along` × `around` (m), the pillars' plinths reaching
 * `plinth` into it from each corner, `levels` its levels anywhere (the bay's frame).
 */
export function housesIn(h: Habitat, i: number, j: number, along: number, around: number, plinth: number, levels: (x: number, y: number) => Levels): House[] {
  const u = underOf(h);
  if (u.useAt(i, j) !== 'home') return [];
  const m = u.hamletOf(i, j);
  if (!m) return [];
  const hr = h.params.landmarks?.handrail ?? 1, style = STYLED[planOf(h).districts[m.district]?.style ?? 'orchard'];
  // As many plots as households to the bay, fewer where a bay is too short for them.
  const clear = plinth + WALK * hr, x0 = clear, x1 = along - clear, y0 = clear, y1 = around - clear;
  const n = Math.min(Math.max(1, Math.round(1 / h.params.under.household.bays)), Math.floor((x1 - x0) / (NARROWEST * hr))), width = (x1 - x0) / n;
  if (n < 1 || y1 - y0 < DEPTH * hr) return [];
  const door = doorToward(u, m, i);
  const out: House[] = [];
  for (let k = 0; k < n; k++) {
    const rng = new Rng(deriveSeed(h.seed, 'under', 'house', i, j, k));
    const plot: Rect = { x0: x0 + k * width, x1: x0 + (k + 1) * width, y0, y1 };
    // The yard toward the door, a gap each side.
    const yard = rng.range(...YARD) * (y1 - y0), side = rng.range(...SIDE) * hr;
    const body: Rect = door > 0
      ? { x0: plot.x0 + side, x1: plot.x1 - side, y0: plot.y0 + side, y1: plot.y1 - yard }
      : { x0: plot.x0 + side, x1: plot.x1 - side, y0: plot.y0 + yard, y1: plot.y1 - side };
    // Level on the floor's highest point in its plot (its door is never below its yard); as many storeys as fit under
    // the lowest springing over it.
    let base = -Infinity, roof = Infinity;
    for (const [x, y] of [[plot.x0, plot.y0], [plot.x1, plot.y0], [plot.x0, plot.y1], [plot.x1, plot.y1]]) base = Math.max(base, levels(x, y).floor);
    for (const [x, y] of [[body.x0, body.y0], [body.x1, body.y0], [body.x0, body.y1], [body.x1, body.y1]]) roof = Math.min(roof, levels(x, y).springing);
    const storey = STOREY * hr, fit = Math.floor((roof - base - (HEADROOM + PARAPET) * hr) / storey);
    if (fit < 1) continue;
    const storeys = 1 + rng.weighted([0, 1, 2, 3].filter((s) => s < fit), (s) => style.storeys[s]);
    const era = rng.weighted(ERAS, (e) => style.eras[ERAS.indexOf(e)]);
    out.push({ plot, body, storeys, storey, base, door, era, build: era === 'return' ? style.build : ERA_BUILD[era], lived: !rng.chance(style.empty), seed: rng.int(0, 0x7fffffff) });
  }
  return out;
}

/** Which way a home bay's doors face: around toward its hamlet's wellhead (the shorter way round), or +y beside it. */
function doorToward(u: ReturnType<typeof underOf>, m: Hamlet, i: number): -1 | 1 {
  const d = ((m.i - i) % u.around + u.around + u.around / 2) % u.around - u.around / 2;
  return d < 0 ? -1 : 1;
}
