/**
 * How high the Understorey lies under the land (design "The Understorey: life below the land", 2026-10-22). Hills and
 * lakes are built: the ceiling deck rises under a hill and dips under a lake, and the living layer follows it (Arnd's
 * decision card, 2026-10-21; `HabitatParams.relief`). So the layer is one height (`layers.living`) everywhere, and only
 * where it lies changes:
 *
 * - its ceiling, the deck's underside, lies under the land by at least the thinnest soil and the deck
 *   (`layers.soilMin`, `layers.ceilingDeck`) at every point of the bays round a pillar, a river bed or a court's dug
 *   floor included;
 * - from pillar to pillar it climbs no steeper than `under.grade`: where the land is steeper, the ceiling lies deeper
 *   and the soil over it is thicker, so the floor below stays gentle enough to walk;
 * - the vault ribs spring at `under.spring` of the height.
 *
 * Levels are set at the pillars (the bays' corners) and run straight between them (bilinear over a bay), so the
 * floors, vaults and ceilings of neighbouring bays meet exactly. Pure; worked out on demand (a bay's lowest ground from
 * a grid of samples), each kept in a bounded cache.
 */
import { wrapAngle } from '../blueprint';
import { kept } from './kept';
import type { Terrain } from './terrain';
import { underOf, type Under } from './under';

/** Heights over the profile (m): the ceiling (the deck's underside), where the vault ribs spring, and the floor. */
export interface Levels {
  ceiling: number;
  springing: number;
  floor: number;
}

export interface UnderLevels {
  readonly under: Under;
  readonly terrain: Terrain;
  /** The levels at pillar (i, j): round the axis at i·dTheta (any i: it wraps), along at s0 + j·bay (j from 0 to `along`). */
  at(i: number, j: number): Levels;
  /** The levels at a point of the floor: straight between the four pillars of its bay (beyond the floor's ends, its last row's). */
  levelAt(theta: number, s: number): Levels;
}

/** Samples a side of a bay for its lowest ground (one more along each edge, so neighbours share their edge's). */
const SAMPLES = 6;
/**
 * Pillars each way a ceiling looks for a lower one that its grade must come down to; beyond, blocks of BLOCK bays a
 * side (their lowest ground from BLOCK_SAMPLES a side), BLOCK_REACH blocks each way. A deep hollow pulls the ceiling
 * down gently from far off rather than in a step.
 */
const GRADE_REACH = 4;
const BLOCK = 8;
const BLOCK_SAMPLES = 16;
const BLOCK_REACH = 3;
/** Entries a cache holds before it starts again (a few MB at most). */
const CACHE = 1 << 17;

/** The Understorey's levels under a terrain, made once per terrain and kept. */
export const levelsOf: (t: Terrain) => UnderLevels = kept(makeLevels);

function makeLevels(terrain: Terrain): UnderLevels {
  const h = terrain.habitat, under = underOf(h), u = h.params.under, ly = h.params.layers;
  const { around, along, dTheta, bay, s0 } = under;
  const under0 = ly.soilMin + ly.ceilingDeck, rise = u.grade * bay;
  const wrap = (i: number): number => ((i % around) + around) % around;
  /** A cache by bay or pillar: rows from −GRADE_REACH − 1 on, so every key is a whole number ≥ 0. */
  const cached = (make: (i: number, j: number) => number): ((i: number, j: number) => number) => {
    const map = new Map<number, number>();
    return (i, j) => {
      const key = (j + GRADE_REACH + 2) * around + wrap(i);
      let v = map.get(key);
      if (v === undefined) {
        if (map.size >= CACHE) map.clear();
        v = make(wrap(i), j);
        map.set(key, v);
      }
      return v;
    };
  };
  // The ground the deck lies under. A landform the plan built (a Ring, a Height: `landformAt`) and a district's raised
  // work are hollow (`Terrain.hollowAt`): the deck keeps to the land under them, and their height is a great hall over
  // the layer. (Their designed surface: the rock and terraces the terrain cuts into a landform stay in the soil over the
  // hall.) A dug work the deck follows down.
  const deckLand = (theta: number, s: number): number => terrain.heightAt(theta, s) - terrain.hollowAt(theta, s);
  // A bay's lowest ground; past the floor's ends, the end row's.
  const lowest = cached((i, j) => {
    const jj = Math.min(along - 1, Math.max(0, j));
    let low = Infinity;
    for (let b = 0; b <= SAMPLES; b++) for (let a = 0; a <= SAMPLES; a++) {
      low = Math.min(low, deckLand((i + a / SAMPLES) * dTheta, s0 + (jj + b / SAMPLES) * bay));
    }
    return low;
  });
  // The deepest ceiling the four bays round a pillar allow, then no steeper than the grade toward any lower one near it.
  const allowed = cached((i, j) => Math.min(lowest(i - 1, j - 1), lowest(i, j - 1), lowest(i - 1, j), lowest(i, j)) - under0);
  // Each block's ground, sampled coarsely: where (in bays: round, along) and how deep a ceiling it allows.
  const blocksAround = Math.ceil(around / BLOCK), blocksAlong = Math.ceil(along / BLOCK);
  const blocks = new Map<number, Float32Array>();
  const blockOf = (bi: number, bj: number): Float32Array => {
    const key = bj * blocksAround + bi;
    let v = blocks.get(key);
    if (!v) {
      if (blocks.size >= CACHE / 64) blocks.clear();
      // (Its samples, then the lowest of them.)
      const n = BLOCK_SAMPLES + 1, out = new Float32Array(n * n * 3 + 1);
      const j0 = bj * BLOCK, j1 = Math.min(along, j0 + BLOCK);
      let low = Infinity;
      for (let b = 0, k = 0; b < n; b++) for (let a = 0; a < n; a++, k += 3) {
        const x = bi * BLOCK + (a / BLOCK_SAMPLES) * BLOCK, y = j0 + (b / BLOCK_SAMPLES) * (j1 - j0);
        out[k] = x; out[k + 1] = y; out[k + 2] = deckLand(x * dTheta, s0 + y * bay) - under0;
        low = Math.min(low, out[k + 2]);
      }
      out[n * n * 3] = low;
      v = out;
      blocks.set(key, v);
    }
    return v;
  };
  const ceilingAt = cached((i, j) => {
    let c = Infinity;
    for (let dj = -GRADE_REACH; dj <= GRADE_REACH; dj++) {
      const jj = Math.min(along, Math.max(0, j + dj));
      for (let di = -GRADE_REACH; di <= GRADE_REACH; di++) c = Math.min(c, allowed(i + di, jj) + rise * Math.hypot(di, dj));
    }
    // Further off (the samples the pillars near it do not cover), the cone from each sample of the blocks round it.
    const bi = Math.floor(i / BLOCK), bj = Math.floor(j / BLOCK);
    for (let dj = -BLOCK_REACH; dj <= BLOCK_REACH; dj++) {
      const J = bj + dj;
      if (J < 0 || J >= blocksAlong) continue;
      const j0 = J * BLOCK, j1 = Math.min(along, j0 + BLOCK), gy = Math.max(0, j0 - j, j - j1);
      for (let di = -BLOCK_REACH; di <= BLOCK_REACH; di++) {
        const I = (((bi + di) % blocksAround) + blocksAround) % blocksAround, pts = blockOf(I, J), end = pts.length - 1;
        // A block whose lowest sample, as near as the block comes, could not bring the ceiling lower is passed by.
        let mx = I * BLOCK + BLOCK / 2 - i;
        mx -= around * Math.round(mx / around);
        if (pts[end] + rise * Math.hypot(Math.max(0, Math.abs(mx) - BLOCK / 2), gy) - 1e-6 >= c) continue;
        for (let k = 0; k < end; k += 3) {
          let x = pts[k] - i;
          x -= around * Math.round(x / around);
          const y = pts[k + 1] - j;
          if (Math.abs(x) <= GRADE_REACH + 1 && Math.abs(y) <= GRADE_REACH + 1) continue;
          c = Math.min(c, pts[k + 2] + rise * Math.hypot(x, y));
        }
      }
    }
    return c;
  });
  const levels = (ceiling: number): Levels => {
    const floor = ceiling - ly.living;
    return { ceiling, springing: floor + u.spring * ly.living, floor };
  };
  const pillarLevels = (i: number, j: number): Levels => levels(ceilingAt(i, Math.min(along, Math.max(0, j))));
  const levelAt = (theta: number, s: number): Levels => {
    const x = wrapAngle(theta) / dTheta, y = Math.min(along, Math.max(0, (s - s0) / bay));
    const i = Math.floor(x), j = Math.min(along - 1, Math.floor(y)), fx = x - i, fy = y - j;
    const c = (1 - fy) * ((1 - fx) * ceilingAt(i, j) + fx * ceilingAt(i + 1, j)) + fy * ((1 - fx) * ceilingAt(i, j + 1) + fx * ceilingAt(i + 1, j + 1));
    return levels(c);
  };
  return { under, terrain, at: pillarLevels, levelAt };
}
