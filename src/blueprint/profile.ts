/**
 * The interior is a surface of revolution. Its profile is one meridian curve in the (z, r) plane, from the axis at
 * the wild end, down the wild endcap's slope, along the floor, and up the port endcap to the dock hub. Every interior
 * point is (θ, s, h): the angle around the axis, the distance s along this curve, and the height h above it along the
 * curve's normal. Terrain, chunks, seeds and queries all use these coordinates (docs/ARCHITECTURE.md), so floor and
 * endcaps are the same code.
 *
 * z runs along the axis from the wild endcap wall (z = 0) to the port endcap wall (z = L); r is the distance from
 * the axis. The curve is sampled once into an arc-length table.
 */
import type { EndcapShape } from './params';

/** A point on the profile, with the unit normal that points into the air (away from the ground). */
export interface ProfilePoint {
  s: number;
  z: number;
  r: number;
  nz: number;
  nr: number;
}

export interface Profile {
  /** Total length of the curve, axis to hub (m). */
  readonly length: number;
  /** Where the floor begins and ends along the curve (the feet of the two endcap slopes). */
  readonly floorStart: number;
  readonly floorEnd: number;
  /** The point at distance s along the curve (clamped to the ends). */
  at(s: number): ProfilePoint;
  /** The circumference of the circle the profile sweeps at s (m): how long a ring of tiles is there. */
  circumference(s: number): number;
  /** The nearest point of the curve to (z, r), and the signed height above it along its normal. */
  nearest(z: number, r: number): { s: number; h: number };
}

/** Samples along each endcap slope. The floor is straight and needs only its two ends. */
const SLOPE_SAMPLES = 512;

export function makeProfile(R: number, L: number, hubRadius: number, endcaps: { wild: EndcapShape; port: EndcapShape }): Profile {
  const reachW = endcaps.wild.reach * R, reachP = endcaps.port.reach * R;
  if (reachW + reachP >= L) throw new Error(`profile: the endcap slopes (${reachW.toFixed(0)} m + ${reachP.toFixed(0)} m) leave no floor in ${L} m`);
  if (!(hubRadius >= 0 && hubRadius < R)) throw new Error(`profile: hub radius ${hubRadius} must lie between 0 and the radius ${R}`);

  // (z, r) points: wild slope from the axis to its foot, then the port slope from its foot to the hub.
  const zs: number[] = [], rs: number[] = [];
  for (let i = 0; i <= SLOPE_SAMPLES; i++) {
    const u = 1 - i / SLOPE_SAMPLES; // 1 at the wall, 0 at the foot
    zs.push(reachW * (1 - u));
    rs.push(R - R * Math.pow(u, endcaps.wild.rise));
  }
  for (let i = 0; i <= SLOPE_SAMPLES; i++) {
    const u = i / SLOPE_SAMPLES; // 0 at the foot, 1 at the wall
    zs.push(L - reachP * (1 - u));
    rs.push(R - (R - hubRadius) * Math.pow(u, endcaps.port.rise));
  }
  const n = zs.length;
  const ss = new Float64Array(n);
  for (let i = 1; i < n; i++) ss[i] = ss[i - 1] + Math.hypot(zs[i] - zs[i - 1], rs[i] - rs[i - 1]);
  const length = ss[n - 1];
  const floorStart = ss[SLOPE_SAMPLES], floorEnd = ss[SLOPE_SAMPLES + 1];

  /** The segment holding s: index i with ss[i] <= s <= ss[i + 1]. */
  const segment = (s: number): number => {
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ss[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  // Normals at the samples, pointing into the air: each segment's tangent (dz, dr) turned to (dr, −dz), averaged
  // over the two segments that meet there, so "up" along the curve turns smoothly.
  const nzs = new Float64Array(n), nrs = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    const dz = zs[i + 1] - zs[i], dr = rs[i + 1] - rs[i], len = Math.hypot(dz, dr) || 1;
    nzs[i] += dr / len; nrs[i] += -dz / len;
    nzs[i + 1] += dr / len; nrs[i + 1] += -dz / len;
  }
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(nzs[i], nrs[i]) || 1;
    nzs[i] /= len; nrs[i] /= len;
  }
  // The slopes meet the floor level (their rise curves start flat), so the feet take the floor's own normal exactly.
  for (const foot of [SLOPE_SAMPLES, SLOPE_SAMPLES + 1]) { nzs[foot] = 0; nrs[foot] = -1; }

  const at = (s: number): ProfilePoint => {
    const c = Math.min(Math.max(s, 0), length);
    const i = segment(c);
    const span = ss[i + 1] - ss[i];
    const t = span > 0 ? (c - ss[i]) / span : 0;
    let nz = nzs[i] + (nzs[i + 1] - nzs[i]) * t, nr = nrs[i] + (nrs[i + 1] - nrs[i]) * t;
    const len = Math.hypot(nz, nr) || 1;
    nz /= len; nr /= len;
    return { s: c, z: zs[i] + (zs[i + 1] - zs[i]) * t, r: rs[i] + (rs[i + 1] - rs[i]) * t, nz, nr };
  };

  const nearest = (z: number, r: number): { s: number; h: number } => {
    let best = Infinity, bestS = 0;
    for (let i = 0; i < n - 1; i++) {
      const dz = zs[i + 1] - zs[i], dr = rs[i + 1] - rs[i];
      const len2 = dz * dz + dr * dr;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((z - zs[i]) * dz + (r - rs[i]) * dr) / len2)) : 0;
      const pz = zs[i] + dz * t, pr = rs[i] + dr * t;
      const d2 = (z - pz) * (z - pz) + (r - pr) * (r - pr);
      if (d2 < best) { best = d2; bestS = ss[i] + Math.sqrt(len2) * t; }
    }
    // `toWorld` lifts a point along the smoothed normal, which leans off its segment's perpendicular: walk s until the
    // point lies on the normal at s (secant steps), so this undoes `toWorld` exactly, also far above or below the curve.
    let s = bestS;
    const offNormal = (at_: ProfilePoint): number => (z - at_.z) * at_.nr - (r - at_.r) * at_.nz;
    for (let k = 0; k < 6; k++) {
      const ds = s + 0.01 <= length ? 0.01 : -0.01;
      const f0 = offNormal(at(s)), f1 = offNormal(at(s + ds)), slope = (f1 - f0) / ds;
      if (Math.abs(f0) < 1e-9 || Math.abs(slope) < 1e-12) break;
      const next = Math.min(length, Math.max(0, s - f0 / slope));
      if (Math.abs(next - s) < 1e-9) break;
      s = next;
    }
    const p = at(s);
    return { s, h: (z - p.z) * p.nz + (r - p.r) * p.nr };
  };

  return {
    length,
    floorStart,
    floorEnd,
    at,
    circumference: (s) => 2 * Math.PI * at(s).r,
    nearest,
  };
}
