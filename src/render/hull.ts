/**
 * The habitat's body from outside, as meshes of the HULL kind, built from the blueprint's exterior (blueprint/exterior.ts)
 * in the blueprint frame: +z from the wild wall to the port wall, r from the axis. Every size comes from the habitat.
 *
 * Two pieces: the turning body (drum, endcap faces, brims, mast) and the despun spindle with its berth arms, which the
 * view poses without the spin.
 */
import type { BufferGeometry } from 'three/webgpu';
import { meshGeometry } from './geometry';
import type { Habitat } from '../blueprint';

type RGB = [number, number, number];
/** Albedos: the dark glass of the solar skin, the grey endcap faces, the near-black radiators, the pale spindle. */
const SKIN: RGB = [0.05, 0.06, 0.09];
const FACE: RGB = [0.32, 0.31, 0.3];
const BRIM: RGB = [0.04, 0.04, 0.045];
const SPINDLE: RGB = [0.55, 0.55, 0.56];

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  constructor(private readonly segments: number) {}

  /**
   * A surface of revolution between two rings (z0, r0) and (z1, r1), with the given outward normal in (z, r).
   * Straight pieces only, so flat shading across the band is exact.
   */
  band(z0: number, r0: number, z1: number, r1: number, nz: number, nr: number, c: RGB): void {
    const n = this.segments, base = this.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      for (const [z, r] of [[z0, r0], [z1, r1]]) {
        this.pos.push(r * ca, r * sa, z);
        this.nrm.push(nr * ca, nr * sa, nz);
        this.col.push(...c);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  /** A box (berth arm) from its centre and half sizes, axis-aligned in the blueprint frame. */
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
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  build(): BufferGeometry {
    return meshGeometry(new Uint32Array(this.idx), {
      position: [new Float32Array(this.pos), 3], normal: [new Float32Array(this.nrm), 3], color: [new Float32Array(this.col), 3],
    });
  }
}

/** The turning body and the despun spindle of a habitat. */
export function hullGeometry(h: Habitat): { body: BufferGeometry; spindle: BufferGeometry } {
  const x = h.exterior;
  const body = new Builder(256);
  const Ro = x.radius;
  body.band(x.wildFace, Ro, x.portFace, Ro, 0, 1, SKIN);
  // The faces: the wild one closed to the axis (the mast leaves from its centre), the port one open for the spindle.
  body.band(x.wildFace, 0, x.wildFace, Ro, -1, 0, FACE);
  body.band(x.portFace, Ro, x.portFace, h.params.hubRadius, 1, 0, FACE);
  for (const b of x.brims) {
    // A flat ring in the endcap's plane, both faces radiating, with its rim.
    const z0 = b.z - b.thickness / 2, z1 = b.z + b.thickness / 2;
    body.band(z0, b.tip, z0, b.inner, -1, 0, BRIM);
    body.band(z1, b.inner, z1, b.tip, 1, 0, BRIM);
    body.band(z0, b.tip, z1, b.tip, 0, 1, BRIM);
  }
  // The mast: a thin lattice seen from afar as a rod, as thick as a tenth of the hub.
  const mastR = h.params.hubRadius * 0.1;
  body.band(x.mast.from, mastR, x.wildFace, mastR, 0, 1, FACE);
  body.band(x.mast.from, 0, x.mast.from, mastR, -1, 0, FACE);

  const spindle = new Builder(64);
  const s = x.spindle;
  spindle.band(x.portFace, s.radius, s.to, s.radius, 0, 1, SPINDLE);
  spindle.band(s.to, s.radius, s.to, 0, 1, 0, SPINDLE);
  // Berth arms: spokes out from the spindle's outer half, where ships tie up.
  const armLen = s.radius * 2, armW = s.radius * 0.12, zArm = s.from + (s.to - s.from) * 0.7;
  for (let i = 0; i < s.berthArms; i++) {
    const a = (i / s.berthArms) * 2 * Math.PI, rMid = s.radius + armLen / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // One arm as a box along x, turned into place around the axis.
    const g = new Builder(4);
    g.box([0, 0, 0], [armLen / 2, armW / 2, armW / 2], SPINDLE);
    for (let k = 0; k < g.pos.length; k += 3) {
      const px = g.pos[k] + rMid, py = g.pos[k + 1], pz = g.pos[k + 2];
      const nx = g.nrm[k], ny = g.nrm[k + 1];
      spindle.pos.push(px * ca - py * sa, px * sa + py * ca, pz + zArm);
      spindle.nrm.push(nx * ca - ny * sa, nx * sa + ny * ca, g.nrm[k + 2]);
      spindle.col.push(...SPINDLE);
    }
    const base = spindle.pos.length / 3 - g.pos.length / 3;
    for (const j of g.idx) spindle.idx.push(base + j);
  }
  return { body: body.build(), spindle: spindle.build() };
}
