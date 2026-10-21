/**
 * The ground for the physics: a square of terrain around a point, as a triangle mesh at a fixed cell size, kept
 * relative to its own origin (the point on the ground at its centre) so the physics engine's 32-bit floats stay
 * precise (docs/ARCHITECTURE.md, "Where does the camera sit?"). The same heights as the tiles (`terrain.heightAt`),
 * on a grid of (θ, s), so it wraps around the axis and climbs the endcaps like everything else. Pure.
 */
import { toWorld, type Vec3 } from '../blueprint';
import type { Terrain } from './terrain';
import { frameOf, landmarksOf, reachOf, type Landmark } from './landmarks';
import { buildPavilion } from './pavilion';
import { outOfPlace } from './shapes';

export interface GroundPatch {
  /** Where it was asked for (θ, s), and its world origin (float64). */
  theta: number;
  s: number;
  origin: Vec3;
  /** Side length (m) along s and around. */
  size: number;
  positions: Float32Array;
  index: Uint32Array;
}

/** A patch `size` metres across centred on (θ, s), with cells of about `cell` metres. */
export function buildPatch(terrain: Terrain, theta: number, s: number, size: number, cell: number): GroundPatch {
  const { profile } = terrain.habitat;
  const n = Math.max(2, Math.round(size / cell)), row = n + 1;
  const origin = toWorld(profile, { theta, s, h: terrain.heightAt(theta, s) });
  const positions = new Float32Array(row * row * 3);
  for (let j = 0; j <= n; j++) {
    const sj = Math.min(profile.length, Math.max(0, s + (j / n - 0.5) * size));
    // Around the axis the cells keep their width in metres: fewer radians where the circle is wider.
    const r = Math.max(profile.at(sj).r, cell);
    for (let i = 0; i <= n; i++) {
      const ti = theta + ((i / n - 0.5) * size) / r;
      const p = toWorld(profile, { theta: ti, s: sj, h: terrain.heightAt(ti, sj) });
      const v = (j * row + i) * 3;
      positions[v] = p[0] - origin[0]; positions[v + 1] = p[1] - origin[1]; positions[v + 2] = p[2] - origin[2];
    }
  }
  const index = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
    index[k++] = a; index[k++] = d; index[k++] = b; index[k++] = b; index[k++] = d; index[k++] = e;
  }
  const solids = landmarkSolids(terrain, origin, size);
  if (!solids.index.length) return { theta, s, origin, size, positions, index };
  // The landmarks' solid parts follow the ground's triangles, in the same frame.
  const all = new Float32Array(positions.length + solids.positions.length), base = positions.length / 3;
  all.set(positions); all.set(solids.positions, positions.length);
  const idx = new Uint32Array(index.length + solids.index.length);
  idx.set(index); idx.set(solids.index.map((i) => i + base), index.length);
  return { theta, s, origin, size, positions: all, index: idx };
}

/**
 * The parts of the landmarks near a patch that one stands on or bumps into (`buildPavilion(…, 'solid')`), relative
 * to the patch's origin: the triangles with a corner within the patch.
 */
function landmarkSolids(terrain: Terrain, origin: Vec3, size: number): { positions: Float32Array; index: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  for (const l of landmarksOf(terrain)) {
    const f = frameOf(terrain.habitat, l);
    if (Math.hypot(f.at[0] - origin[0], f.at[1] - origin[1], f.at[2] - origin[2]) > reachOf(l) + size) continue;
    const a = solidOf(l), map = new Map<number, number>(), half = size * 0.75;
    const toPatch = (v: number): Vec3 => {
      const w = outOfPlace(f, [a.positions[v * 3], a.positions[v * 3 + 1], a.positions[v * 3 + 2]]);
      return [w[0] - origin[0], w[1] - origin[1], w[2] - origin[2]];
    };
    const inPatch = (p: Vec3) => Math.hypot(p[0], p[1], p[2]) < half;
    for (let t = 0; t < a.index.length; t += 3) {
      const corners = [a.index[t], a.index[t + 1], a.index[t + 2]];
      if (!corners.some((v) => inPatch(toPatch(v)))) continue;
      for (const v of corners) {
        let k = map.get(v);
        if (k === undefined) { k = pos.length / 3; pos.push(...toPatch(v)); map.set(v, k); }
        idx.push(k);
      }
    }
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

/** A landmark's solid parts, built once. */
const solid = new WeakMap<Landmark, ReturnType<ReturnType<typeof buildPavilion>['arrays']>>();
function solidOf(l: Landmark): ReturnType<ReturnType<typeof buildPavilion>['arrays']> {
  let a = solid.get(l);
  if (!a) { a = buildPavilion(l, 'solid').arrays(); solid.set(l, a); }
  return a;
}
