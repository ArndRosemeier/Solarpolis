/**
 * The ground for the physics: a square of terrain around a point, as a triangle mesh at a fixed cell size, kept
 * relative to its own origin (the point on the ground at its centre) so the physics engine's 32-bit floats stay
 * precise (docs/ARCHITECTURE.md, "Where does the camera sit?"). The same heights as the tiles (`terrain.heightAt`),
 * on a grid of (θ, s), so it wraps around the axis and climbs the endcaps like everything else. Pure.
 */
import { toWorld, type Vec3 } from '../blueprint';
import type { Terrain } from './terrain';

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
  return { theta, s, origin, size, positions, index };
}
