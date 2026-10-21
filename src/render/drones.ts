/**
 * The maintenance drones on a habitat's skin (design "Solarpolis: the outside", O4): each one a small body on its
 * track's rails with a darker sensor head at the end it is heading for, placed every frame from the seed and the
 * clock (`dronesAt`, gen/skin.ts). One HARDWARE mesh holds them all, in the blueprint frame, posed with the body.
 * Near the skin they are meshes; further out than DRONES_WITHIN drone lengths, where one is below a pixel, each is a
 * point of its own reflected sunlight drawn as stars are (STARS), so they fade with distance as they would to the eye
 * instead of vanishing (Arnd, 2026-10-21).
 */
import { Mesh, type BufferAttribute } from 'three/webgpu';
import { v3len, v3scale, type Vec3 } from '@futuremagic/core';
import { apply, transpose, type Mat3 } from '../space';
import { meshGeometry } from './geometry';
import { dronesAt, tracksOf, type Skin } from '../gen/skin';
import { ShapeBuilder, type RGB } from './geometry';

/** The share of a drone's length² it shows from above (its body's top) and the mean albedo of what shows. */
const TOP_AREA = 0.5;
const TOP_ALBEDO = 0.5;

const BODY: RGB = [0.62, 0.6, 0.55];
const HEAD: RGB = [0.08, 0.08, 0.09];
const PANEL: RGB = [0.03, 0.04, 0.08];
const CARGO: RGB = [0.05, 0.07, 0.12];
/** Drawn only within this many drone lengths of the skin. */
export const DRONES_WITHIN = 2000;

/** One drone in its own frame (x along its track toward the port end, y across it, z out from the skin), unit length. */
function template(): ShapeBuilder {
  const b = new ShapeBuilder(4, true);
  b.box([0, 0, 0.14], [0.42, 0.3, 0.1], BODY);
  // Its own solar panel on top, and a glass panel it carries for a swap.
  b.box([-0.05, 0, 0.245], [0.3, 0.26, 0.006], PANEL);
  b.box([-0.12, 0, 0.27], [0.2, 0.18, 0.012], CARGO);
  b.box([0.44, 0, 0.16], [0.06, 0.22, 0.08], HEAD);
  // Wheels' trucks on the two rails.
  for (const y of [-0.24, 0.24]) b.box([0, y, 0.03], [0.32, 0.04, 0.03], HEAD);
  return b;
}

export class DroneMesh {
  readonly mesh: Mesh;
  /** The far view: one star-like quad per drone. */
  readonly points: Mesh;
  private readonly pointPos: Float32Array;
  private readonly pointCol: Float32Array;
  private readonly t = template();
  private readonly count: number;

  /** `material` draws the drones near (HARDWARE), `pointMaterial` their points far (STARS). */
  constructor(private readonly skin: Skin, material: Mesh['material'], pointMaterial: Mesh['material']) {
    this.count = tracksOf(skin) * skin.dronesPerTrack;
    const b = new ShapeBuilder(4, true), per = this.t.pos.length / 3;
    for (let k = 0; k < this.count; k++) {
      b.pos.push(...this.t.pos);
      b.nrm.push(...this.t.nrm);
      b.col.push(...this.t.col);
      for (const i of this.t.idx) b.idx.push(k * per + i);
    }
    this.mesh = new Mesh(b.build(), material);
    this.mesh.name = 'drones';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    const n = this.count, corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    this.pointPos = new Float32Array(n * 12);
    this.pointCol = new Float32Array(n * 12);
    const corner = new Float32Array(n * 8), index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      corner.set(corners, i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.points = new Mesh(meshGeometry(index, { position: [this.pointPos, 3], color: [this.pointCol, 3], corner: [corner, 2] }), pointMaterial);
    this.points.name = 'drones far';
    this.points.userData.plainExposure = true;
    this.points.frustumCulled = false;
  }

  /**
   * The far view at clock time t: each drone's direction from the eye (scene axes, put `far` out, so the drum in
   * front hides the ones behind it) and its reflected sunlight as flux relative to the Sun's: a Lambert top of
   * TOP_AREA × size², lit by the Sun at `sunBody` (body frame) less what is eclipsed (`sunlight`).
   */
  glow(t: number, axes: Mat3, origin: Vec3, sunBody: Vec3, sunlight: number, far: number): void {
    const s = this.skin, area = TOP_AREA * s.droneSize * s.droneSize, P = this.pointPos, C = this.pointCol;
    let o = 0;
    for (const d of dronesAt(s, t)) {
      const nx = Math.cos(d.theta), ny = Math.sin(d.theta);
      const w = apply(axes, [nx * s.radius, ny * s.radius, d.z]);
      const rel: Vec3 = [w[0] + origin[0], w[1] + origin[1], w[2] + origin[2]], dist = v3len(rel), dir = v3scale(rel, 1 / dist);
      // Its top faces out: μ0 to the Sun, μ to the eye (both in the body frame).
      const toEye = apply(transpose(axes), v3scale(dir, -1));
      const mu0 = Math.max(0, nx * sunBody[0] + ny * sunBody[1]), mu = Math.max(0, nx * toEye[0] + ny * toEye[1]);
      const flux = (TOP_ALBEDO * area * mu0 * mu * sunlight) / (Math.PI * dist * dist);
      for (let v = 0; v < 4; v++) {
        for (let a = 0; a < 3; a++) {
          P[o + v * 3 + a] = dir[a] * far;
          C[o + v * 3 + a] = flux;
        }
      }
      o += 12;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  /** Bytes of its buffers. */
  bufferBytes(): number {
    return (this.t.pos.length * 3 * 4 + this.t.idx.length * 4) * this.count;
  }

  /** Move every drone to where it is at clock time t. */
  moveTo(t: number): void {
    const s = this.skin, size = s.droneSize, tp = this.t.pos, tn = this.t.nrm, per = tp.length;
    const g = this.mesh.geometry, pos = g.attributes.position as BufferAttribute, nrm = g.attributes.normal as BufferAttribute;
    const P = pos.array as Float32Array, N = nrm.array as Float32Array;
    let o = 0;
    for (const d of dronesAt(s, t)) {
      const c = Math.cos(d.theta), sn = Math.sin(d.theta), h = d.heading;
      // Drone frame → blueprint: x along +z (turned round when heading back), y backward around θ (keeps it
      // right-handed: +z × −around = out), z out.
      for (let k = 0; k < per; k += 3) {
        const x = tp[k] * h, y = tp[k + 1] * h, z = tp[k + 2];
        const r = s.radius + z * size, a = -y * size;
        P[o + k] = r * c - a * sn;
        P[o + k + 1] = r * sn + a * c;
        P[o + k + 2] = d.z + x * size;
        const nx = tn[k] * h, ny = tn[k + 1] * h, nz = tn[k + 2];
        N[o + k] = nz * c + ny * sn;
        N[o + k + 1] = nz * sn - ny * c;
        N[o + k + 2] = nx;
      }
      o += per;
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }
}
