/**
 * The berths' moving parts (space/dock.ts) in the scene: each collar's clamps, posed every frame from the dock's state
 * (open, swinging shut on a ship's nose one after another, opening before it leaves), and its signal ring and
 * floodlights as lamps (render/lamps.ts). The collars and the clamps' housings are the spindle's (render/hull.ts). Every
 * clamp draws one shared geometry (HARDWARE), posed in the spindle's frame.
 */
import { Mesh, type BufferGeometry } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, v3scale, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { CLAMPS, DOCK, SIGNALS, apply, berthDockOf, clampPose, closedSwing, dockAt, dockLightsAt, dockShows, mul, transpose, type Berth, type Mat3, type ShipNow, type ShipShape, type Visit } from '../space';
import { ShapeBuilder, axesOf, freeMesh, posedMesh, setPose, type RGB } from './geometry';
import { HARDWARE } from './materials';
import { LampPoints } from './lamps';

/** The clamps' paint, their jaws' pads, their knuckles. */
const PAINT: RGB = [0.46, 0.34, 0.08];
const PAD: RGB = [0.05, 0.05, 0.055];
const KNUCKLE: RGB = [0.3, 0.3, 0.31];

/** One clamp in its own frame (m): the hinge at the origin, its arm along +x, its jaw turned toward +z, its hinge pin along y. */
function clampGeometry(w: number): BufferGeometry {
  const b = new ShapeBuilder(8, true), a = DOCK.reach * w, t = DOCK.beam * w, wide = DOCK.wide * w, jaw = DOCK.jaw * w;
  b.box([a / 2, 0, 0], [a / 2, wide / 2, t / 2], PAINT);
  // The jaw at its end, its pad where it meets the ship.
  const reach = jaw * 0.85;
  b.box([a - t / 2, 0, (reach - t / 2) / 2], [t / 2, (wide / 2) * 0.9, (reach + t / 2) / 2], PAINT);
  b.box([a - t / 2, 0, (reach + jaw) / 2], [t / 2 * 1.15, (wide / 2) * 0.95, (jaw - reach) / 2], PAD);
  // The knuckle round the hinge pin, a little wider than the arm.
  b.prism([0, (-wide / 2) * 1.15, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], t * 0.8, wide * 1.15, 10, KNUCKLE);
  return b.build();
}

export class DockView {
  private readonly berths: Berth[];
  private readonly geometry: BufferGeometry;
  private readonly clamps: Mesh[] = [];
  private readonly lamps: LampPoints;
  /** Each visit's clamps' closed swing (its ship's nose), while it is at the port. */
  private readonly closed = new Map<string, number>();

  constructor(private readonly h: Habitat, name: string) {
    const arms = h.exterior.spindle.berthArms;
    this.berths = Array.from({ length: arms }, (_, i) => berthDockOf(h, i));
    this.geometry = clampGeometry(h.exterior.spindle.arms.width);
    for (let k = 0; k < arms * CLAMPS; k++) {
      const m = posedMesh(this.geometry, HARDWARE.material, `${name} clamp ${k}`);
      m.frustumCulled = false;
      this.clamps.push(m);
    }
    this.lamps = new LampPoints(arms * (SIGNALS.lights + CLAMPS), `${name} dock lights`);
  }

  async enter(stage: Stage): Promise<void> {
    await Promise.all([...this.clamps.map((m) => stage.add(m)), this.lamps.enter(stage)]);
  }

  /**
   * At clock time t, with the spindle's axes in the scene and its origin relative to the eye, and this frame's ships
   * (their shapes by visit): each berth's clamps and lamps.
   */
  follow(t: number, spindleAxes: Mat3, origin: Vec3, ships: readonly ShipNow[], shapeOf: (v: Visit) => ShipShape, pixelsPerRadian: number): void {
    const eye = apply(transpose(spindleAxes), v3scale(origin, -1)), here = new Set<string>();
    this.lamps.restart();
    for (const [i, b] of this.berths.entries()) {
      const visit = ships.find((s) => s.visit.arm === i)?.visit ?? null;
      let closed = DOCK.open as number;
      if (visit) {
        here.add(visit.id);
        closed = this.closed.get(visit.id) ?? closedSwing(this.h, shapeOf(visit));
        this.closed.set(visit.id, closed);
      }
      const now = dockAt(this.h, visit, closed, t), shows = dockShows(b, eye, pixelsPerRadian);
      for (let k = 0; k < CLAMPS; k++) {
        const m = this.clamps[i * CLAMPS + k];
        m.visible = shows;
        if (!shows) continue;
        const p = clampPose(b, k, now.swing[k]);
        setPose(m, mul(spindleAxes, axesOf(p)), v3add(origin, apply(spindleAxes, p.at)));
      }
      this.lamps.shineOn(dockLightsAt(b, now, eye), spindleAxes, origin, t);
    }
    for (const id of this.closed.keys()) if (!here.has(id)) this.closed.delete(id);
    this.lamps.send();
  }

  /** The bytes the clamps' one geometry holds. */
  bytes(): number {
    let n = this.geometry.index?.array.byteLength ?? 0;
    for (const a of Object.values(this.geometry.attributes)) n += a.array.byteLength;
    return n;
  }

  leave(stage: Stage): void {
    // They share one geometry: the last one gives it up.
    this.clamps.forEach((m, k) => { stage.remove(m); freeMesh(m, k === this.clamps.length - 1 ? 'all' : 'none'); });
    this.lamps.leave(stage);
  }
}
