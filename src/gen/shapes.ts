/**
 * The one way to build a mesh as plain arrays: positions, normals, optional colours (linear albedo) and an index.
 * Pure (no three.js), so the generation workers build with it (the skin's detail tiles, gen/hullDetail.ts) and the
 * renderer's `ShapeBuilder` (render/geometry.ts) turns the same arrays into a geometry.
 *
 * Every face is flat-shaded and counter-clockwise seen from the side its normal points to.
 */
import type { Vec3 } from '@futuremagic/core';

/** Bytes some typed arrays hold (a built tile's, for the memory watchdog). */
export const bytesOf = (arrays: readonly ArrayBufferView[]): number => arrays.reduce((n, a) => n + a.byteLength, 0);

/** Linear RGB, 0–1. */
export type RGB = [number, number, number];

const along = (c: Vec3, a: Vec3, x: number, b: Vec3, y: number, n: Vec3, z: number): Vec3 =>
  [c[0] + a[0] * x + b[0] * y + n[0] * z, c[1] + a[1] * x + b[1] * y + n[1] * z, c[2] + a[2] * x + b[2] * y + n[2] * z];

export class Shape {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  constructor(protected readonly segments: number, readonly colored: boolean) {}

  /** Vertices so far. */
  get vertices(): number { return this.pos.length / 3; }

  /**
   * A surface of revolution between two rings (z0, r0) and (z1, r1), with the given outward normal in (z, r).
   * Straight pieces only, so flat shading across the band is exact. Its front faces (z, r) = (r0 − r1, z1 − z0): order
   * the rings so that is the given normal.
   */
  band(z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, c?: RGB): void {
    const n = this.segments, base = this.vertices;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      for (const [z, r] of [[z0, r0], [z1, r1]]) {
        this.pos.push(r * ca, r * sa, z);
        this.nrm.push(nr * ca, nr * sa, nz);
        if (c) this.col.push(...c);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  /** A box from its centre and half sizes, along the axes. */
  box(c: Vec3, h: Vec3, col: RGB): void {
    this.block(c, [1, 0, 0], [0, 1, 0], [0, 0, 1], h, col);
  }

  /** A flat quad from its four corners, counter-clockwise seen from the side `n` points to. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col?: RGB): void {
    const base = this.vertices;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      if (this.colored) this.col.push(...(col ?? [1, 1, 1]));
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * A box from its centre, three unit axes (right-handed) and half sizes along them. `open` leaves out the face
   * against −ez (a part standing on a surface needs no bottom).
   */
  block(c: Vec3, ex: Vec3, ey: Vec3, ez: Vec3, h: Vec3, col: RGB, open = false): void {
    const ax = [ex, ey, ez];
    for (let k = 0; k < 3; k++) {
      const n = ax[k], u = ax[(k + 1) % 3], v = ax[(k + 2) % 3], hn = h[k], hu = h[(k + 1) % 3], hv = h[(k + 2) % 3];
      for (const s of [1, -1]) {
        if (open && k === 2 && s < 0) continue;
        const corner = (su: number, sv: number): Vec3 => along(c, u, su * hu, v, sv * hv, n, s * hn);
        const nn: Vec3 = [n[0] * s, n[1] * s, n[2] * s];
        if (s > 0) this.quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), nn, col);
        else this.quad(corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1), nn, col);
      }
    }
  }

  /**
   * A prism standing on `c` along `up` (ex, ey, up right-handed): `sides` corners at `radius`, the first along `ex`,
   * `height` tall, with its top cap. Bolt heads, washers, posts, conduits.
   */
  prism(c: Vec3, ex: Vec3, ey: Vec3, up: Vec3, radius: number, height: number, sides: number, col: RGB): void {
    const ring = (k: number, z: number): Vec3 => {
      const a = (k / sides) * 2 * Math.PI;
      return along(c, ex, Math.cos(a) * radius, ey, Math.sin(a) * radius, up, z);
    };
    for (let k = 0; k < sides; k++) {
      const am = ((k + 0.5) / sides) * 2 * Math.PI;
      const n = along([0, 0, 0], ex, Math.cos(am), ey, Math.sin(am), up, 0);
      this.quad(ring(k, 0), ring(k + 1, 0), ring(k + 1, height), ring(k, height), n, col);
    }
    // The cap: a fan around its middle.
    const base = this.vertices, top = along(c, ex, 0, ey, 0, up, height);
    for (const p of [top, ...Array.from({ length: sides }, (_, k) => ring(k, height))]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(up[0], up[1], up[2]);
      if (this.colored) this.col.push(...col);
    }
    for (let k = 0; k < sides; k++) this.idx.push(base, base + 1 + k, base + 1 + ((k + 1) % sides));
  }

  /**
   * A profile swept straight from `a` to `b`: its points (x along `across`, y along `up`) counter-clockwise in that
   * plane, with across × up pointing from a to b. Open ends (a bar between two others).
   */
  sweep(profile: readonly (readonly [number, number])[], a: Vec3, b: Vec3, across: Vec3, up: Vec3, col: RGB): void {
    const n = profile.length;
    for (let k = 0; k < n; k++) {
      const q0 = profile[k], q1 = profile[(k + 1) % n];
      const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy);
      // Outward: to the right of the edge q0 → q1 in the (across, up) plane.
      const nn = along([0, 0, 0], across, dy / l, up, -dx / l, across, 0);
      this.quad(along(a, across, q0[0], up, q0[1], up, 0), along(a, across, q1[0], up, q1[1], up, 0), along(b, across, q1[0], up, q1[1], up, 0), along(b, across, q0[0], up, q0[1], up, 0), nn, col);
    }
  }

  /**
   * Another shape put into this one: its x, y and z axes become `ex`, `ey`, `ez` (unit, right-handed, so front faces
   * stay front) and its origin `at`. With `colored`, its colours come along.
   */
  append(b: Shape, ex: readonly number[], ey: readonly number[], ez: readonly number[], at: readonly number[]): void {
    const base = this.vertices;
    for (let k = 0; k < b.pos.length; k += 3) {
      const x = b.pos[k], y = b.pos[k + 1], z = b.pos[k + 2];
      const nx = b.nrm[k], ny = b.nrm[k + 1], nz = b.nrm[k + 2];
      for (let a = 0; a < 3; a++) {
        this.pos.push(at[a] + ex[a] * x + ey[a] * y + ez[a] * z);
        this.nrm.push(ex[a] * nx + ey[a] * ny + ez[a] * nz);
      }
    }
    if (this.colored) this.col.push(...b.col);
    for (const i of b.idx) this.idx.push(base + i);
  }

  /** The arrays, typed for a worker to hand over. */
  arrays(): { positions: Float32Array; normals: Float32Array; colors: Float32Array | null; index: Uint32Array } {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: this.colored ? new Float32Array(this.col) : null,
      index: new Uint32Array(this.idx),
    };
  }
}

/**
 * An icosphere: the icosahedron's 20 faces split `subdivisions` times (20 · 4ⁿ triangles), its points on the unit
 * sphere, faces counter-clockwise seen from outside. Neighbouring faces share their points.
 */
export function icosphere(subdivisions: number): { verts: Vec3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const unit = (x: number, y: number, z: number): Vec3 => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const verts: Vec3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(([x, y, z]) => unit(x, y, z));
  let faces: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let n = 0; n < subdivisions; n++) {
    const mid = new Map<number, number>();
    const half = (a: number, b: number): number => {
      const k = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(k);
      if (i === undefined) {
        i = verts.length;
        verts.push(unit(verts[a][0] + verts[b][0], verts[a][1] + verts[b][1], verts[a][2] + verts[b][2]));
        mid.set(k, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = half(a, b), bc = half(b, c), ca = half(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][]; });
  }
  return { verts, faces };
}
