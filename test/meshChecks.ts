/** Checks on built meshes shared by the tests of the hull's detail (hullDetail, hullParts). */

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
