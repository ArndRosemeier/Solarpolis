/** Checks on built meshes shared by the tests of the hull's detail (hullDetail, hullParts) and the Lift Stair's. */
import type { Habitat } from '../src/blueprint';
import { rampOf, stairTopAt, type LiftStair } from '../src/gen/liftStair';
import type { StairTile } from '../src/gen/liftStairMesh';
import { FINISH } from '../src/gen/pavilion';
import { outOfPlace } from '../src/gen/shapes';

/** Every triangle's winding agrees with its normal (front faces outward), and the share of them that are not slivers. */
export function windingOk(pos: Float32Array, nrm: Float32Array, idx: Uint32Array): { bad: number; total: number } {
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) continue;
    const k = idx[t] * 3;
    if ((n[0] * nrm[k] + n[1] * nrm[k + 1] + n[2] * nrm[k + 2]) / len < 0.5) bad++;
  }
  return { bad, total: idx.length / 3 };
}

/**
 * Whether a tile of the Lift Stair's faces look out of it: a little way along a face's normal is outside the stair (by
 * `stairTopAt`), a little way against it inside. Bronze is left out (thin parts poke into the stone). How many faces
 * the test could judge, and how many look in.
 */
export function stairFacesOut(h: Habitat, st: LiftStair, t: StairTile): { judged: number; wrong: number } {
  const ramp = rampOf(h), m = t.mesh;
  const inside = (p: number[]): boolean => {
    const q = ramp.plan(outOfPlace(t.origin, p as [number, number, number])), top = stairTopAt(st, [q.z, q.w]);
    return top !== null && q.e < top - 1e-4 && q.e > ramp.groundAt(q.z) - 2 * st.handrail + 1e-3;
  };
  let judged = 0, wrong = 0;
  for (let i = 0; i < m.index.length; i += 3) {
    const v = [m.index[i], m.index[i + 1], m.index[i + 2]];
    if (m.finishes[v[0]] === FINISH.bronze) continue;
    const c = [0, 1, 2].map((a) => (m.positions[v[0] * 3 + a] + m.positions[v[1] * 3 + a] + m.positions[v[2] * 3 + a]) / 3);
    const n = [0, 1, 2].map((a) => m.normals[v[0] * 3 + a]);
    const out = inside(c.map((x, a) => x + n[a] * 0.01)), inn = inside(c.map((x, a) => x - n[a] * 0.01));
    if (out !== inn) { judged++; if (out) wrong++; }
  }
  return { judged, wrong };
}
