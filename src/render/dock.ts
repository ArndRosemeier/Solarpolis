/**
 * The berths' moving parts (space/dock.ts) in the scene: each collar's clamps, posed every frame from the dock's state
 * (open, swinging shut on a ship's nose one after another, opening before it leaves); its signal ring as lit panels on
 * the collar's face (LAMP, their colours written each frame) and, with the floodlights, as lamps (render/lamps.ts).
 * A bright lamp's point burns white at its heart; the panels are what show the ring amber or green. The collars and the clamps' housings are the spindle's (render/hull.ts). Every
 * clamp draws one shared geometry (HARDWARE), posed in the spindle's frame.
 */
import { Mesh, type BufferGeometry } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, v3cross, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { CLAMPS, DOCK, SIGNALS, apply, berthDockOf, clampPose, closedSwing, dockAt, dockLightsAt, dockShows, mul, shineAt, signalBlink, signalColour, transpose, umbilicalPath, UMBILICAL, type Berth, type DockNow, type Mat3, type ShipNow, type ShipShape, type Visit } from '../space';
import { ShapeBuilder, axesOf, freeMesh, geometryBytes, meshGeometry, posedMesh, setPose, type RGB } from './geometry';
import { HARDWARE, LAMP } from './materials';
import { LampPoints } from './lamps';

/** The clamps' paint, their jaws' pads, their knuckles. */
const PAINT: RGB = [0.46, 0.34, 0.08];
const PAD: RGB = [0.05, 0.05, 0.055];
const KNUCKLE: RGB = [0.3, 0.3, 0.31];
/** The umbilical's hose and its connector head; points along it and sides round it. */
const HOSE: RGB = [0.07, 0.07, 0.08];
const HOSE_POINTS = 28;
const HOSE_SIDES = 8;

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

/** Each signal's panel on a collar's face, relative to its middle (spindle axes): a quad each, facing out along the arm. */
function signalGeometry(b: Berth): BufferGeometry {
  const n = SIGNALS.lights, p = SIGNALS.panel, rc = DOCK.ring * b.width, half = (Math.PI / n) * p.arc, proud = 0.004 * b.width;
  const pos = new Float32Array(n * 12), idx = new Uint32Array(n * 6);
  const panelCorner = (j: number, da: number, r: number): Vec3 => {
    const a = (j / n) * 2 * Math.PI + da, R = b.radial, around: Vec3 = [-R[1], R[0], 0];
    return v3add(v3scale(R, proud), v3add(v3scale(around, Math.cos(a) * r), [0, 0, Math.sin(a) * r]));
  };
  for (let j = 0; j < n; j++) {
    // Counter-clockwise seen from out along the arm (around × axial is the arm's way out).
    const corners = [panelCorner(j, -half, p.inner * rc), panelCorner(j, -half, p.outer * rc), panelCorner(j, half, p.outer * rc), panelCorner(j, half, p.inner * rc)];
    corners.forEach((c, k) => pos.set(c, j * 12 + k * 3));
    idx.set([0, 1, 2, 0, 2, 3].map((k) => j * 4 + k), j * 6);
  }
  return meshGeometry(idx, { position: [pos, 3], color: [new Float32Array(n * 12), 3] });
}

/** The umbilical as far as it is out (`points` along it, relative to the collar): a ribbed hose and the connector at its head. */
function hoseShape(points: readonly Vec3[], w: number): ShapeBuilder {
  const b = new ShapeBuilder(HOSE_SIDES, true), r = UMBILICAL.radius * w;
  b.curvedTube(points, points.map((_, k) => r * (k % 2 ? 1.12 : 1)), HOSE_SIDES, HOSE);
  const n = points.length, end = points[n - 1], t = v3norm(v3sub(end, points[n - 2]));
  const side = v3norm(v3cross(Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t)), up = v3cross(t, side);
  b.block(v3sub(end, v3scale(t, r * 1.2)), side, up, t, [r * 1.7, r * 1.7, r * 1.2], PAINT);
  return b;
}

export class DockView {
  private readonly berths: Berth[];
  private readonly geometry: BufferGeometry;
  private readonly clamps: Mesh[] = [];
  /** Each berth's signal panels. */
  private readonly signals: Mesh[];
  /** Each berth's umbilical, and how far out it was last drawn (for which visit). */
  private readonly hoses: { mesh: Mesh; out: number; visit: string }[];
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
    this.signals = this.berths.map((b, i) => {
      const m = posedMesh(signalGeometry(b), LAMP.material, `${name} berth ${i} signals`);
      m.frustumCulled = false;
      return m;
    });
    // Each hose's arrays keep one size however far it is out: rewritten in place as it reels.
    this.hoses = this.berths.map((b, i) => {
      const m = posedMesh(hoseShape(umbilicalPath(b, null, HOSE_POINTS), b.width).build(), HARDWARE.material, `${name} berth ${i} umbilical`);
      m.frustumCulled = false;
      m.visible = false;
      return { mesh: m, out: 0, visit: '' };
    });
    this.lamps = new LampPoints(arms * (SIGNALS.lights + CLAMPS), `${name} dock lights`);
  }

  async enter(stage: Stage): Promise<void> {
    await Promise.all([...this.clamps.map((m) => stage.add(m)), ...this.signals.map((m) => stage.add(m)), ...this.hoses.map((x) => stage.add(x.mesh)), this.lamps.enter(stage)]);
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
      this.lightSignals(this.signals[i], now, t, shows);
      this.reel(i, b, visit, visit ? shapeOf(visit) : null, now.umbilical, shows);
      if (this.hoses[i].mesh.visible) setPose(this.hoses[i].mesh, spindleAxes, v3add(origin, apply(spindleAxes, b.collar)));
      if (shows) setPose(this.signals[i], spindleAxes, v3add(origin, apply(spindleAxes, b.collar)));
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

  /** A berth's umbilical as far out as it is, its arrays rewritten only when that changes. */
  private reel(i: number, b: Berth, visit: Visit | null, shape: ShipShape | null, out: number, shows: boolean): void {
    const hose = this.hoses[i], id = visit?.id ?? '';
    hose.mesh.visible = shows && out > 0.01;
    if (!hose.mesh.visible || (Math.abs(out - hose.out) < 1e-4 && id === hose.visit)) return;
    hose.out = out;
    hose.visit = id;
    const a = hoseShape(umbilicalPath(b, shape, HOSE_POINTS, out), b.width).arrays(), g = hose.mesh.geometry;
    for (const [name, data] of [['position', a.positions], ['normal', a.normals], ['color', a.colors!]] as const) {
      const attr = g.getAttribute(name);
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    }
  }

  /** Colour a berth's signal panels for its state at clock time t (written only when they change). */
  private lightSignals(m: Mesh, now: DockNow, t: number, shows: boolean): void {
    m.visible = shows && now.signal !== 'idle';
    if (!m.visible) return;
    const colour = signalColour(now)!, a = m.geometry.getAttribute('color'), c = a.array as Float32Array, g = SIGNALS.panel.glow;
    let changed = false;
    for (let j = 0; j < SIGNALS.lights; j++) {
      const lit = shineAt(signalBlink(now, j), t) * g;
      for (let k = 0; k < 4; k++) for (let ch = 0; ch < 3; ch++) {
        const v = colour[ch] * lit, at = j * 12 + k * 3 + ch;
        if (c[at] !== v) { c[at] = v; changed = true; }
      }
    }
    if (changed) a.needsUpdate = true;
  }

  /** The bytes the clamps' one geometry and the signal panels hold. */
  bytes(): number {
    return [this.geometry, ...this.signals.map((m) => m.geometry), ...this.hoses.map((x) => x.mesh.geometry)].reduce((n, g) => n + geometryBytes(g), 0);
  }

  leave(stage: Stage): void {
    // They share one geometry: the last one gives it up.
    this.clamps.forEach((m, k) => { stage.remove(m); freeMesh(m, k === this.clamps.length - 1 ? 'all' : 'none'); });
    for (const m of [...this.signals, ...this.hoses.map((x) => x.mesh)]) { stage.remove(m); freeMesh(m); }
    this.lamps.leave(stage);
  }
}
