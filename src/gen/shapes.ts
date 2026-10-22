/**
 * The one way to build a mesh as plain arrays: positions, normals, optional colours (linear albedo) and an index.
 * Pure (no three.js), so the generation workers build with it (the skin's detail tiles, gen/hullDetail.ts) and the
 * renderer's `ShapeBuilder` (render/geometry.ts) turns the same arrays into a geometry.
 *
 * Every face is flat-shaded and counter-clockwise seen from the side its normal points to.
 */
import { v3cross, v3dot, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { toWorld, type Habitat } from '../blueprint';

/** Bytes some typed arrays hold (a built tile's, for the memory watchdog). */
export const bytesOf = (arrays: readonly ArrayBufferView[]): number => arrays.reduce((n, a) => n + a.byteLength, 0);

/** The bytes a mapped mesh holds. */
export const mappedBytes = (m: MappedArrays): number => bytesOf([m.positions, m.normals, m.uvs, m.finishes, m.index, ...(m.colors ? [m.colors] : [])]);

/** Linear RGB, 0–1. */
export type RGB = [number, number, number];

const along = (c: Vec3, a: Vec3, x: number, b: Vec3, y: number, n: Vec3, z: number): Vec3 =>
  [c[0] + a[0] * x + b[0] * y + n[0] * z, c[1] + a[1] * x + b[1] * y + n[1] * z, c[2] + a[2] * x + b[2] * y + n[2] * z];

/** A mapped shape's arrays: its mesh, with each vertex's place on its surface (m) and its finish. */
export interface MappedArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array | null;
  index: Uint32Array;
  uvs: Float32Array;
  finishes: Float32Array;
}

export class Shape {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  /**
   * With `mapped`: each vertex's place on its surface (m), for patterns drawn in the shader, and its `finish` (what the
   * surface is made of, a small whole number its kind reads). A band is mapped by arc length around and by height up a
   * wall (or radius across a floor); every flat face by its plane: x and y across a floor, the height and the
   * horizontal along a wall, so neighbouring faces of one plane continue each other's pattern.
   */
  readonly uv: number[] = [];
  readonly fin: number[] = [];
  /** The finish given to the vertices that follow. */
  finish = 0;
  constructor(protected readonly segments: number, readonly colored: boolean, readonly mapped = false) {}

  /** Vertices so far. */
  get vertices(): number { return this.pos.length / 3; }

  /** One vertex: its place, normal, colour (if coloured) and surface coordinates (if mapped: given, or from its plane). */
  protected put(p: readonly number[], n: readonly number[], c?: readonly number[], uv?: readonly [number, number]): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    if (this.colored) this.col.push(...(c ?? [1, 1, 1]));
    if (!this.mapped) return;
    this.uv.push(...(uv ?? planeMap(p, n)));
    this.fin.push(this.finish);
  }

  /**
   * A surface of revolution between two rings (z0, r0) and (z1, r1), with the given outward normal in (z, r).
   * Straight pieces only, so flat shading across the band is exact. Its front faces (z, r) = (r0 − r1, z1 − z0): order
   * the rings so that is the given normal.
   */
  band(z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, c?: RGB): void {
    this.arc(z0, r0, z1, r1, nz, nr, 0, 2 * Math.PI, this.segments, c);
  }

  /**
   * A piece of a band: the angles a0 … a1 (counter-clockwise from +x), in `n` steps. Mapped: a wall by arc length
   * around (at the mean radius) and height, a floor or roof by its plane.
   */
  arc(z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, a0: number, a1: number, n: number, c?: RGB): void {
    const base = this.vertices, wall = Math.abs(nr) >= Math.abs(nz), rm = (r0 + r1) / 2;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, ca = Math.cos(a), sa = Math.sin(a);
      for (const [z, r] of [[z0, r0], [z1, r1]]) {
        const p = [r * ca, r * sa, z], nn = [nr * ca, nr * sa, nz];
        this.put(p, nn, c, wall ? [a * rm, z] : planeMap(p, nn));
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
    for (const p of [a, b, c, d]) this.put(p, n, col);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A flat quad from its four corners, counter-clockwise seen from its front: its normal from them (the diagonals' cross). */
  face(a: Vec3, b: Vec3, c: Vec3, d: Vec3, col?: RGB): void {
    this.quad(a, b, c, d, v3norm(v3cross(v3sub(c, a), v3sub(d, b))), col);
  }

  /** A flat quad turned to face `out`: its corners in either order around it. */
  faceToward(a: Vec3, b: Vec3, c: Vec3, d: Vec3, out: Vec3, col?: RGB): void {
    if (v3dot(v3cross(v3sub(c, a), v3sub(d, b)), out) >= 0) this.face(a, b, c, d, col);
    else this.face(d, c, b, a, col);
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
    for (const p of [top, ...Array.from({ length: sides }, (_, k) => ring(k, height))]) this.put(p, up, col);
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
   * A round tube along a polyline (a limb, a rope, a pipe that bends): a ring of `sides` corners at each point, its radius
   * there, turned with the line (parallel transport, so it never twists), normals smooth round it. Open ends: it runs
   * into something at both. Mapped along its length and round its girth.
   */
  curvedTube(points: readonly Vec3[], radii: readonly number[], sides: number, col: RGB): void {
    const n = points.length;
    if (n < 2) return;
    const tan = (i: number): Vec3 => v3norm(v3sub(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]));
    let t = tan(0);
    let nx = v3norm(v3cross(Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t));
    const base = this.vertices;
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
        const t1 = tan(i);
        // Carry the frame along: take out of nx what now lies along the line.
        const d = v3dot(nx, t1);
        nx = v3norm([nx[0] - t1[0] * d, nx[1] - t1[1] * d, nx[2] - t1[2] * d]);
        t = t1;
      }
      const ny = v3cross(t, nx), r = radii[i];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
        const nn: Vec3 = [nx[0] * c + ny[0] * sn, nx[1] * c + ny[1] * sn, nx[2] * c + ny[2] * sn];
        this.put([points[i][0] + nn[0] * r, points[i][1] + nn[1] * r, points[i][2] + nn[2] * r], nn, col, [run, (k / sides) * 2 * Math.PI * r]);
      }
    }
    const row = sides + 1;
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * row + k, b = a + 1, c = a + row, d = c + 1;
      this.idx.push(a, b, d, a, d, c);
    }
  }

  /**
   * A smooth surface (a vault, a shell, a sloping floor): a grid of `rows` + 1 by `columns` + 1 points, each with its
   * own normal and surface coordinates (`at(a, b)`), the normals carried smoothly across it. Each quad faces the way
   * its points' normals do (its winding is chosen per quad), so `at` may run either way round.
   */
  smoothGrid(rows: number, columns: number, at: (a: number, b: number) => { p: Vec3; n: Vec3; uv: [number, number] }, c?: RGB): void {
    const base = this.vertices, row = columns + 1, pts: Vec3[] = [], nrm: Vec3[] = [];
    for (let a = 0; a <= rows; a++) for (let b = 0; b <= columns; b++) {
      const q = at(a, b);
      pts.push(q.p);
      nrm.push(q.n);
      this.put(q.p, q.n, c, q.uv);
    }
    for (let a = 0; a < rows; a++) for (let b = 0; b < columns; b++) {
      const i0 = a * row + b, i1 = i0 + 1, i2 = i0 + row + 1, i3 = i0 + row;
      const n = v3cross(v3sub(pts[i2], pts[i0]), v3sub(pts[i3], pts[i1]));
      const m = [0, 1, 2].map((k) => nrm[i0][k] + nrm[i1][k] + nrm[i2][k] + nrm[i3][k]) as Vec3;
      if (v3dot(n, m) >= 0) this.idx.push(base + i0, base + i1, base + i2, base + i0, base + i2, base + i3);
      else this.idx.push(base + i0, base + i2, base + i1, base + i0, base + i3, base + i2);
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
    if (this.mapped) {
      // Its own surface coordinates if it has them, else from the planes where it now lies.
      if (b.mapped) { this.uv.push(...b.uv); this.fin.push(...b.fin); } else for (let v = base; v < this.vertices; v++) {
        this.uv.push(...planeMap(this.pos.slice(v * 3, v * 3 + 3), this.nrm.slice(v * 3, v * 3 + 3)));
        this.fin.push(this.finish);
      }
    }
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

  /** What the physics needs of it: positions and the index. */
  solid(): { positions: Float32Array; index: Uint32Array } {
    return { positions: new Float32Array(this.pos), index: new Uint32Array(this.idx) };
  }

  /** The arrays with the surface coordinates and finishes (a `mapped` shape). */
  mappedArrays(): MappedArrays {
    return { ...this.arrays(), uvs: new Float32Array(this.uv), finishes: new Float32Array(this.fin) };
  }
}

/**
 * Where a point lies on the plane of its face (m): across a floor or roof (normal mostly along z) its x and y; on a
 * wall its run along the horizontal in the wall (z × n) and its height.
 */
export function planeMap(p: readonly number[], n: readonly number[]): [number, number] {
  if (Math.abs(n[2]) > 0.7) return [p[0], p[1]];
  const l = Math.hypot(n[0], n[1]) || 1;
  return [(p[1] * n[0] - p[0] * n[1]) / l, p[2]];
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

/** A local frame: its axes and its origin, in the frame it sits in (a part on the hull, a landmark on the land). */
export interface Place {
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
  at: Vec3;
}

/** A point given in a place, in the frame the place sits in. */
export const outOfPlace = (p: Place, q: Vec3): Vec3 => [0, 1, 2].map((a) => p.at[a] + p.ex[a] * q[0] + p.ey[a] * q[1] + p.ez[a] * q[2]) as Vec3;

/** A point of the frame a place sits in, in the place. */
export const intoPlace = (p: Place, v: Vec3): Vec3 => { const d = v3sub(v, p.at); return [v3dot(d, p.ex), v3dot(d, p.ey), v3dot(d, p.ez)]; };

/** A frame standing on the profile at (θ, s), `height` above it: x along the axis, y around, z toward the axis (up). */
export function placeAt(h: Habitat, theta: number, s: number, height: number): Place {
  const at = toWorld(h.profile, { theta, s, h: height });
  const c = Math.cos(theta), sn = Math.sin(theta);
  return { at, ex: [0, 0, 1], ey: [-sn, c, 0], ez: [-c, -sn, 0] };
}

/**
 * A frame lying on the floor at (θ, s), `height` above the profile, turned `heading` (rad) from the axis (+s) toward
 * +θ: x along the heading, y to its left, z up (toward the axis). Things built on the land in their own frame (an
 * entrance court, a river crossing) are bent onto the floor through it: x and y are metres along the floor (at the
 * radius at s), so a long thing follows the floor's curve around the axis.
 */
export interface FloorFrame {
  theta: number;
  s: number;
  height: number;
  heading: number;
}

/** Where a point (x, y) of a floor frame lies on the floor (θ, s). */
export function floorAt(h: Habitat, f: FloorFrame, x: number, y: number): { theta: number; s: number } {
  const c = Math.cos(f.heading), sn = Math.sin(f.heading), r = h.profile.at(f.s).r;
  return { theta: f.theta + (x * sn + y * c) / r, s: f.s + x * c - y * sn };
}

/** Where a point of the floor (θ, s) lies in a floor frame (x, y): the inverse of `floorAt`, the shorter way around. */
export function inFloorFrame(h: Habitat, f: FloorFrame, theta: number, s: number): [number, number] {
  const c = Math.cos(f.heading), sn = Math.sin(f.heading), d = theta - f.theta;
  const along = s - f.s, around = Math.atan2(Math.sin(d), Math.cos(d)) * h.profile.at(f.s).r;
  return [along * c + around * sn, around * c - along * sn];
}

/** A point of a floor frame in the world. */
export function floorPoint(h: Habitat, f: FloorFrame, p: Vec3): Vec3 {
  const at = floorAt(h, f, p[0], p[1]);
  return toWorld(h.profile, { theta: at.theta, s: at.s, h: f.height + p[2] });
}

/** A shape built in a floor frame, bent onto the floor and put into a place's frame (normals turned with it). */
export function bendInto(target: Shape, h: Habitat, f: FloorFrame, sh: Shape, place: Place): void {
  const base = target.vertices, r = h.profile.at(f.s).r, c = Math.cos(f.heading), sn = Math.sin(f.heading);
  for (let v = 0; v < sh.vertices; v++) {
    const p: Vec3 = [sh.pos[v * 3], sh.pos[v * 3 + 1], sh.pos[v * 3 + 2]], q = intoPlace(place, floorPoint(h, f, p));
    const th = f.theta + (p[0] * sn + p[1] * c) / r, n = [sh.nrm[v * 3], sh.nrm[v * 3 + 1], sh.nrm[v * 3 + 2]];
    // The normal along the axis, around it, and up (toward the axis), then in the world there.
    const ns = n[0] * c - n[1] * sn, nu = n[0] * sn + n[1] * c, nz = n[2];
    const w: Vec3 = [-Math.sin(th) * nu - Math.cos(th) * nz, Math.cos(th) * nu - Math.sin(th) * nz, ns];
    target.pos.push(q[0], q[1], q[2]);
    target.nrm.push(v3dot(w, place.ex), v3dot(w, place.ey), v3dot(w, place.ez));
    if (target.colored) target.col.push(sh.col[v * 3], sh.col[v * 3 + 1], sh.col[v * 3 + 2]);
    if (target.mapped) { target.uv.push(sh.uv[v * 2], sh.uv[v * 2 + 1]); target.fin.push(sh.fin[v]); }
  }
  for (const i of sh.idx) target.idx.push(base + i);
}

/** A floor frame's solid shape (what the physics touches) bent onto the floor, in the world (m). */
export function solidOnFloor(h: Habitat, f: FloorFrame, sh: Shape): { positions: Float32Array; index: Uint32Array } {
  const out = new Shape(8, false);
  bendInto(out, h, f, sh, { at: [0, 0, 0], ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] });
  return out.solid();
}

/**
 * The height over the profile of a walkable top at (θ, s): `top`, in the floor frame of the thing found there, of the
 * point there; null where nothing was found or it has no top there.
 */
export function topOnFloor<T>(h: Habitat, theta: number, s: number, found: { thing: T; frame: FloorFrame } | null, top: (thing: T, x: number, y: number) => number | null): number | null {
  if (!found) return null;
  const [x, y] = inFloorFrame(h, found.frame, theta, s), z = top(found.thing, x, y);
  return z === null ? null : found.frame.height + z;
}

/** A colour darker or lighter by k. */
export const shade = (col: RGB, k: number): RGB => [col[0] * k, col[1] * k, col[2] * k];
