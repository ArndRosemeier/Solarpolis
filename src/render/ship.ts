/**
 * A ship from its shape (space/ship.ts) as meshes in the ship frame (+x to the nose, the exhaust along −x): the body
 * (HARDWARE, an albedo per part) and, for a torch, the exhaust plume (FLAME, its glow set per mesh by
 * `userData.flame`). `ShipMeshes` is the one way a ship enters the scene: the title's and every ship of the traffic.
 */
import { Mesh, Vector4, type BufferGeometry } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3cross, v3norm, type Vec3 } from '@futuremagic/core';
import type { Mat3, ShipRole, ShipShape } from '../space';
import { ShapeBuilder, setPose, type RGB } from './geometry';
import { FLAME, HARDWARE } from './materials';
import { FLAME_GLOW, type FlameUniforms } from './hullShaders';

const ALBEDO: Record<ShipRole, RGB> = {
  hull: [0.6, 0.6, 0.62],
  crew: [0.72, 0.71, 0.68],
  tank: [0.5, 0.48, 0.44],
  radiator: [0.06, 0.06, 0.065],
  drive: [0.3, 0.29, 0.28],
  truss: [0.35, 0.35, 0.36],
  cargo: [0.62, 0.6, 0.55],
  sail: [0.78, 0.78, 0.8],
};

/** The builder works around z; the ship's axis is x. (x, y, z) of the ship is (z, x, y) of the builder. */
function toShip(b: ShapeBuilder): void {
  for (const a of [b.pos, b.nrm]) {
    for (let k = 0; k < a.length; k += 3) {
      const x = a[k], y = a[k + 1], z = a[k + 2];
      a[k] = z; a[k + 1] = x; a[k + 2] = y;
    }
  }
}

export function shipGeometry(s: ShipShape): { body: BufferGeometry; plume: BufferGeometry | null } {
  const b = new ShapeBuilder(32, true);
  for (const p of s.parts) {
    const c = ALBEDO[p.role];
    if (p.shape === 'box') {
      // Ship (x, y, z) to builder (y, z, x).
      b.box([p.center[1], p.center[2], p.center[0]], [p.half[1], p.half[2], p.half[0]], c);
    } else if (p.shape === 'cone') {
      const nz = p.r0 - p.r1, nr = p.to - p.from, l = Math.hypot(nz, nr);
      b.band(p.from, p.r0, p.to, p.r1, nz / l, nr / l, c);
      b.band(p.from, 0, p.from, p.r0, -1, 0, c);
    } else {
      const base = b.pos.length;
      b.band(p.from, p.radius, p.to, p.radius, 0, 1, c);
      b.band(p.to, p.radius, p.to, 0, 1, 0, c);
      b.band(p.from, 0, p.from, p.radius, -1, 0, c);
      if (p.offset) for (let k = base; k < b.pos.length; k += 3) { b.pos[k] += p.offset[0]; b.pos[k + 1] += p.offset[1]; }
    }
  }
  toShip(b);
  if (s.plumeLength <= 0) return { body: b.build(), plume: null };
  const plume = new ShapeBuilder(32, false);
  plume.band(0, s.nozzle, -s.plumeLength, s.plumeRadius, 0, 1);
  toShip(plume);
  return { body: b.build(), plume: plume.build() };
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
  const x = forward, z = v3norm(v3cross(x, up)), y = v3cross(z, x);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** A ship's meshes: its body and, for a torch, its plume. */
export class ShipMeshes {
  readonly body: Mesh;
  readonly plume: Mesh | null;
  private readonly flame: FlameUniforms;

  constructor(readonly shape: ShipShape, name: string) {
    const g = shipGeometry(shape);
    this.flame = { flame: new Vector4(shape.plumeLength, 0, shape.nozzle, 0) };
    this.body = new Mesh(g.body, HARDWARE.material);
    this.body.name = name;
    this.plume = g.plume ? new Mesh(g.plume, FLAME.material) : null;
    if (this.plume) { this.plume.name = `${name} plume`; this.plume.userData.flame = this.flame; }
    for (const m of this.meshes) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
  }

  get meshes(): Mesh[] { return this.plume ? [this.body, this.plume] : [this.body]; }

  /** Into the scene, hidden until posed (the Stage still builds their shaders under its cap). */
  async addTo(stage: Stage): Promise<void> {
    for (const m of this.meshes) m.visible = false;
    await Promise.all(this.meshes.map((m) => stage.add(m)));
  }

  removeFrom(stage: Stage): void {
    for (const m of this.meshes) { stage.remove(m); m.geometry.dispose(); }
  }

  /** Where it is (its axes in the scene, its stern relative to the eye) and how hard its torch thrusts (0–1). */
  pose(axes: Mat3, at: Vec3, throttle: number): void {
    for (const m of this.meshes) setPose(m, axes, at);
    this.flame.flame.y = throttle;
    this.body.visible = true;
    if (this.plume) this.plume.visible = throttle > 0;
  }

  hide(): void {
    for (const m of this.meshes) m.visible = false;
  }
}
