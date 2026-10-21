/**
 * The one way to turn arrays into an indexed mesh geometry. Every kind's meshes are indexed (the index is part of the
 * shader's cache key, @futuremagic/stage), and each attribute is named as its kind lists it (materials.ts).
 */
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

/** An indexed geometry from named attributes: each one its data and its item size. Absent ones are left out. */
export function meshGeometry(index: Uint32Array, attributes: Record<string, readonly [Float32Array, number] | undefined>): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(attributes)) if (a) g.setAttribute(name, new BufferAttribute(a[0], a[1]));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Linear RGB, 0–1. */
export type RGB = [number, number, number];

/**
 * Meshes made of surfaces of revolution around the z axis and boxes: the habitats from outside (hull.ts) and ships
 * (ship.ts). With `colored`, every vertex carries an albedo (the HARDWARE kind).
 */
export class ShapeBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  constructor(private readonly segments: number, private readonly colored: boolean) {}

  /**
   * A surface of revolution between two rings (z0, r0) and (z1, r1), with the given outward normal in (z, r).
   * Straight pieces only, so flat shading across the band is exact. Its front faces (z, r) = (r0 − r1, z1 − z0): order
   * the rings so that is the given normal.
   */
  band(z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, c?: RGB): void {
    const n = this.segments, base = this.pos.length / 3;
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
  box(c: [number, number, number], h: [number, number, number], col: RGB): void {
    for (let axis = 0; axis < 3; axis++) {
      for (const side of [-1, 1]) {
        const base = this.pos.length / 3, u = (axis + 1) % 3, v = (axis + 2) % 3;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = [0, 0, 0], n = [0, 0, 0];
          p[axis] = c[axis] + side * h[axis];
          p[u] = c[u] + su * h[u];
          p[v] = c[v] + sv * h[v];
          n[axis] = side;
          this.pos.push(...p);
          this.nrm.push(...n);
          this.col.push(...col);
        }
        // Counter-clockwise seen from outside: the corners run around +axis, so the far side turns them round.
        if (side > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }

  build(): BufferGeometry {
    const attrs: Record<string, [Float32Array, number]> = { position: [new Float32Array(this.pos), 3], normal: [new Float32Array(this.nrm), 3] };
    if (this.colored) attrs.color = [new Float32Array(this.col), 3];
    return meshGeometry(new Uint32Array(this.idx), attrs);
  }
}
