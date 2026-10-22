/**
 * A coarser copy of a shape for where it is seen small (vertex clustering): the vertices in each cube of a grid `cell`
 * m wide become one at their mean, kept apart by which way they face (six ways), by their colour and by the part they
 * move with, so a coarse level keeps its parent's size, outline, colours and moving parts while thin details melt into
 * the larger shapes. Triangles left with fewer than three corners, and repeated ones, are dropped. Pure.
 */

/** A triangle mesh with four floats of colour and four of part per vertex (gen/drone.ts `DesignMesh`). */
export interface Shape {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  parts: Float32Array;
  index: Uint32Array;
}

/** The shape with its vertices clustered in cubes `cell` m wide. */
export function simplify(shape: Shape, cell: number): Shape {
  const { positions: p, normals: n, colors: c, parts: q, index } = shape, count = p.length / 3;
  const cluster = new Int32Array(count), keys = new Map<string, number>();
  const sumP: number[] = [], sumN: number[] = [], first: number[] = [], weight: number[] = [];
  for (let i = 0; i < count; i++) {
    const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2], ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const facing = ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
    const key = `${Math.floor(p[i * 3] / cell)},${Math.floor(p[i * 3 + 1] / cell)},${Math.floor(p[i * 3 + 2] / cell)},${facing},${c[i * 4].toFixed(3)},${c[i * 4 + 1].toFixed(3)},${c[i * 4 + 2].toFixed(3)},${c[i * 4 + 3]},${q[i * 4]},${q[i * 4 + 1]},${q[i * 4 + 2]},${q[i * 4 + 3]}`;
    let k = keys.get(key);
    if (k === undefined) { k = first.length; keys.set(key, k); first.push(i); weight.push(0); sumP.push(0, 0, 0); sumN.push(0, 0, 0); }
    cluster[i] = k;
    weight[k]++;
    for (let j = 0; j < 3; j++) { sumP[k * 3 + j] += p[i * 3 + j]; sumN[k * 3 + j] += n[i * 3 + j]; }
  }
  const triangles: number[] = [], seen = new Set<string>();
  for (let t = 0; t < index.length; t += 3) {
    const a = cluster[index[t]], b = cluster[index[t + 1]], d = cluster[index[t + 2]];
    if (a === b || b === d || a === d) continue;
    const key = [a, b, d].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    triangles.push(a, b, d);
  }
  // Only the clusters some triangle still uses.
  const used = new Int32Array(first.length).fill(-1);
  let m = 0;
  for (const k of triangles) if (used[k] < 0) used[k] = m++;
  const out: Shape = { positions: new Float32Array(m * 3), normals: new Float32Array(m * 3), colors: new Float32Array(m * 4), parts: new Float32Array(m * 4), index: Uint32Array.from(triangles, (k) => used[k]) };
  for (let k = 0; k < first.length; k++) {
    const v = used[k];
    if (v < 0) continue;
    const l = Math.hypot(sumN[k * 3], sumN[k * 3 + 1], sumN[k * 3 + 2]) || 1;
    for (let j = 0; j < 3; j++) { out.positions[v * 3 + j] = sumP[k * 3 + j] / weight[k]; out.normals[v * 3 + j] = sumN[k * 3 + j] / l; }
    out.colors.set(c.subarray(first[k] * 4, first[k] * 4 + 4), v * 4);
    out.parts.set(q.subarray(first[k] * 4, first[k] * 4 + 4), v * 4);
  }
  return out;
}
