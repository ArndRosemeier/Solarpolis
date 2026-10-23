/**
 * A ship from its shape (space/ship.ts, fitted out by space/shipDetail.ts) as meshes in the ship frame (+x to the nose,
 * the exhaust along −x): the body (HARDWARE, an albedo per part), its lit windows and lights (LAMP) and, for a torch,
 * the exhaust plume (FLAME, its glow set per mesh by `userData.flame`). `ShipMeshes` is the one way a ship enters the scene: the title's and every ship of the traffic.
 */
import { Mesh, Vector4, type BufferGeometry, type Material } from 'three/webgpu';
import { v3add, v3cross, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { ROLE_ALBEDO, shipAxesOf, type Mat3, type ShipShape } from '../space';
import { PosedMeshes, ShapeBuilder } from './geometry';
import { FLAME, HARDWARE, LAMP } from './materials';
import { FLAME_GLOW, type FlameUniforms } from './hullShaders';

/** The builder works around z; the ship's axis is x. (x, y, z) of the ship is (z, x, y) of the builder. */
export function shipAxisShape(b: Pick<ShapeBuilder, 'pos' | 'nrm'>): void {
  for (const a of [b.pos, b.nrm]) {
    for (let k = 0; k < a.length; k += 3) {
      const x = a[k], y = a[k + 1], z = a[k + 2];
      a[k] = z; a[k + 1] = x; a[k + 2] = y;
    }
  }
}

/** Ship (x, y, z) as the builder's (y, z, x): the builder works around its z, the ship around its x. */
const toBuilder = (v: readonly number[]): Vec3 => [v[1], v[2], v[0]];

/** Segments round the ship's widest section; a narrower one has fewer (by the root of its share), at least ROUND_LEAST. */
const AROUND = 32;
const ROUND_LEAST = 8;
/** A round part's steps over the angles a0 … a1, for its radius r on a ship `beam` wide. */
function stepsOf(r: number, beam: number, a0 = 0, a1 = 2 * Math.PI): number {
  const around = Math.min(AROUND, Math.max(ROUND_LEAST, Math.ceil(AROUND * Math.sqrt((2 * r) / beam))));
  return Math.max(1, Math.ceil((around * (a1 - a0)) / (2 * Math.PI) - 1e-9));
}

/**
 * A ship's geometry: its body (HARDWARE, an albedo per part), what of it gives off its own light (LAMP: windows and the
 * collar's target lights, the colour its luminance), and a torch's plume.
 */
export function shipGeometry(s: ShipShape): { body: BufferGeometry; lamps: BufferGeometry | null; plume: BufferGeometry | null } {
  const body = new ShapeBuilder(AROUND, true), lamps = new ShapeBuilder(AROUND, true);
  for (const p of s.parts) {
    const b = p.role === 'window' ? lamps : body, c = p.colour ?? s.colours?.[p.role] ?? ROLE_ALBEDO[p.role];
    const base = b.pos.length;
    if (p.shape === 'box') {
      // Turned about the ship's axis: its own y from +y toward +z.
      const t = p.turn ?? 0, ct = Math.cos(t), st = Math.sin(t);
      b.block(toBuilder(p.center), toBuilder([1, 0, 0]), toBuilder([0, ct, st]), toBuilder([0, -st, ct]), p.half, c);
      continue;
    }
    if (p.shape === 'strut') {
      const ex = v3norm(v3sub(p.b, p.a)), ref: Vec3 = Math.abs(ex[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const ey = v3norm(v3cross(ref, ex)), ez = v3cross(ex, ey), mid = v3scale(v3add(p.a, p.b), 0.5);
      b.block(toBuilder(mid), toBuilder(ex), toBuilder(ey), toBuilder(ez), [v3len(v3sub(p.b, p.a)) / 2, p.width / 2, p.width / 2], c);
      continue;
    }
    const B = s.params.beam, all = 2 * Math.PI;
    if (p.shape === 'cone') {
      const nz = p.r0 - p.r1, nr = p.to - p.from, l = Math.hypot(nz, nr), n = stepsOf(Math.max(p.r0, p.r1), B);
      b.arc(p.from, p.r0, p.to, p.r1, nz / l, nr / l, 0, all, n, c);
      b.arc(p.from, 0, p.from, p.r0, -1, 0, 0, all, n, c);
    } else if (p.shape === 'shell') {
      // Its front faces (x, r) along (r0 − r1, to − from).
      const nz = p.r0 - p.r1, nr = p.to - p.from, l = Math.hypot(nz, nr), [a0, a1] = p.arc ?? [0, all];
      b.arc(p.from, p.r0, p.to, p.r1, nz / l, nr / l, a0, a1, stepsOf(Math.max(p.r0, p.r1), B, a0, a1), c);
    } else {
      const n = stepsOf(p.radius, B);
      b.arc(p.from, p.radius, p.to, p.radius, 0, 1, 0, all, n, c);
      b.arc(p.to, p.radius, p.to, 0, 1, 0, 0, all, n, c);
      b.arc(p.from, 0, p.from, p.radius, -1, 0, 0, all, n, c);
    }
    if (p.offset) for (let k = base; k < b.pos.length; k += 3) { b.pos[k] += p.offset[0]; b.pos[k + 1] += p.offset[1]; }
  }
  // The round parts were built around the builder's z: turn them (and the boxes, built in its axes) onto the ship's.
  shipAxisShape(body);
  shipAxisShape(lamps);
  const lit = lamps.pos.length > 0 ? lamps.build() : null;
  if (s.plumeLength <= 0) return { body: body.build(), lamps: lit, plume: null };
  const plume = new ShapeBuilder(AROUND, false);
  plume.band(0, s.nozzle, -s.plumeLength, s.plumeRadius, 0, 1);
  shipAxisShape(plume);
  return { body: body.build(), lamps: lit, plume: plume.build() };
}

/** The body's albedo as the exposure meter sees it: the pale crew section and tanks outweigh the dark radiators. */
export const SHIP_ALBEDO = 0.5;

/** The plume's colour near the nozzle, where most of its light comes from (flameColor). */
const PLUME_TINT: Vec3 = [0.88, 0.84, 1];
/** The mean of the plume's `facing` over its side-on outline. */
const PLUME_FACING = 0.6;

/**
 * A ship as a point of light `dist` m away (flux relative to full sunlight, per channel): its body lit by the Sun
 * (`sunToEye`: the cosine between the directions to the Sun and to the eye, seen from the ship; `sunlight` its unhidden
 * share), and its torch's plume, the light the FLAME kind draws over the plume's outline (the glow falls off over a
 * quarter of the plume per unit of throttle), so far and near show the same light.
 */
export function shipFlux(s: ShipShape, throttle: number, dist: number, sunToEye: number, sunlight: number): Vec3 {
  const p = s.params, d2 = Math.PI * dist * dist;
  const body = (SHIP_ALBEDO * p.length * p.beam * Math.max(0, (1 + sunToEye) / 2) * sunlight) / d2;
  const glowLength = s.plumeLength * 0.25 * throttle, width = 2 * (s.nozzle + (s.plumeRadius - s.nozzle) * 0.125 * throttle);
  const plume = (FLAME_GLOW * throttle * glowLength * width * PLUME_FACING) / d2;
  return [body + plume * PLUME_TINT[0], body + plume * PLUME_TINT[1], body + plume * PLUME_TINT[2]];
}

/** A ship's axes in its frame's: x to the nose, z the radiator wings' side, y completing them. */
export function shipAxes(forward: Vec3, up: Vec3): Mat3 {
  const { x, y, z } = shipAxesOf({ forward, up });
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** A ship's meshes: its body, its lit windows (if it has any) and, for a torch, its plume. */
export class ShipMeshes extends PosedMeshes {
  readonly body: Mesh;
  readonly lamps: Mesh | null;
  readonly plume: Mesh | null;
  private readonly flame: FlameUniforms;

  constructor(readonly shape: ShipShape, name: string, bodyMaterial: Material = HARDWARE.material) {
    const g = shipGeometry(shape), body: Mesh = new Mesh(g.body, bodyMaterial);
    const lamps: Mesh | null = g.lamps ? new Mesh(g.lamps, LAMP.material) : null, plume: Mesh | null = g.plume ? new Mesh(g.plume, FLAME.material) : null;
    super([body, lamps, plume].filter((m): m is Mesh => m !== null));
    this.body = body;
    this.lamps = lamps;
    this.plume = plume;
    body.name = name;
    if (lamps) lamps.name = `${name} windows`;
    this.flame = { flame: new Vector4(shape.plumeLength, 0, shape.nozzle, 0) };
    if (plume) { plume.name = `${name} plume`; plume.userData.flame = this.flame; }
  }

  /** Where it is (its axes in the scene, its stern relative to the eye) and how hard its torch thrusts (0–1). */
  pose(axes: Mat3, at: Vec3, throttle: number): void {
    this.poseAll(axes, at);
    this.flame.flame.y = throttle;
    if (this.plume) this.plume.visible = throttle > 0;
  }
}
