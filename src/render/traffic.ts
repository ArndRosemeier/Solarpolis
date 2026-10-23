/**
 * The ships at a habitat's spindle (space/traffic.ts) and the port's craft (space/portCraft.ts: tugs, inspectors) in
 * the scene: each one its meshes (`ShipMeshes`) while it is at
 * least MESH_PX pixels long on screen, else a point of its own light (`shipFlux`: sunlight off its hull and its
 * torch's glow), drawn as stars are, so a torch braking thousands of kilometres out still shows as a bright point
 * instead of vanishing (Arnd, 2026-10-21: nothing vanishes with distance). Posed in the spindle's frame, which does
 * not turn.
 */
import { Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, v3dot, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { INSPECTORS, INSPECTOR_SIZE, apply, craftAt, craftShape, mul, shipLightsOf, shipShape, trafficAt, transpose, tugCradle, type CraftNow, type HullLight, type Mat3, type PlacedHabitat, type ShipNow, type ShipShape, type Space, type Visit } from '../space';
import { freeMesh, pointsChanged, pointsGeometry, setPoint } from './geometry';
import { STARS } from './materials';
import { SHIP_ALBEDO, ShipMeshes, shipAxes, shipFlux } from './ship';
import type { Hull } from './necklace';
import { LampPoints } from './lamps';

/** A ship this many pixels long (with its glowing plume) is drawn as meshes; shorter, as a point. */
const MESH_PX = 3;

interface Drawn {
  shape: ShipShape;
  /** Its navigation lights (space/lights.ts). */
  lights: HullLight[];
  meshes: ShipMeshes | null;
  adding: boolean;
}

export class TrafficView {
  private readonly ships = new Map<string, Drawn>();
  private readonly points: Mesh;
  private readonly pointPos: Float32Array;
  private readonly pointCol: Float32Array;
  /** The ships' navigation lights. */
  private readonly lamps: LampPoints;
  /** This frame's ships and craft and where they are (scene axes, relative to the eye). */
  private now: { shape: ShipShape; axes: Mat3; stern: Vec3 }[] = [];
  /** This frame's ships, and the port's craft. */
  private moving: ShipNow[] = [];
  private craft: CraftNow[] = [];

  constructor(private readonly stage: Stage, private readonly space: Space, private readonly placed: PlacedHabitat, private readonly far: number) {
    const arms = placed.habitat.exterior.spindle.berthArms;
    // Every ship at a berth or coming in, every arm's tug, the inspectors at the berthed ships.
    const pts = pointsGeometry(arms * (2 + INSPECTORS));
    this.pointPos = pts.position;
    this.pointCol = pts.color;
    this.points = new Mesh(pts.geometry, STARS.material);
    this.points.name = `${placed.id} ships far`;
    this.points.userData.plainExposure = true;
    this.points.frustumCulled = false;
    // Every ship at a berth or coming in, the passenger's, and every tug: three lights each.
    this.lamps = new LampPoints((arms * 2 + 1) * 3, `${placed.id} ships' lights`);
  }

  async start(): Promise<void> {
    await this.stage.add(this.points);
    await this.lamps.enter(this.stage);
  }

  /**
   * At clock time t, with the spindle's axes in the scene and the body's origin relative to the eye, the Sun's
   * direction (scene) and unhidden share, and the passenger's ship if it is coming: each ship, and each of the port's
   * craft (space/portCraft.ts), as meshes or a point.
   */
  follow(t: number, spindleAxes: Mat3, origin: Vec3, sunDir: Vec3, sunlight: number, pixelsPerRadian: number, guest: Visit | null = null): void {
    const ships = trafficAt(this.space, this.placed, t, guest), seen = new Set<string>();
    this.pointCol.fill(0);
    this.now = [];
    this.lamps.restart();
    let k = 0;
    const placeOne = (id: string, made: () => ShipShape, forward: Vec3, up: Vec3, at: Vec3, throttle: number): Drawn => {
      seen.add(id);
      let d = this.ships.get(id);
      if (!d) { const shape = made(); d = { shape, lights: shape.params.length > INSPECTOR_SIZE ? shipLightsOf(shape) : [], meshes: null, adding: false }; this.ships.set(id, d); }
      const axes = mul(spindleAxes, shipAxes(forward, up)), stern = v3add(origin, apply(spindleAxes, at));
      for (const l of d.lights) this.lamps.shine(l, v3add(stern, apply(axes, l.at)), t);
      const L = d.shape.params.length, mid = v3add(stern, v3scale(apply(axes, [1, 0, 0]), L / 2)), dist = v3len(mid);
      const px = ((L + d.shape.plumeLength * throttle) / dist) * pixelsPerRadian, point = k++;
      this.now.push({ shape: d.shape, axes, stern });
      if (px >= MESH_PX) {
        if (d.meshes) { d.meshes.pose(axes, stern, throttle); return d; }
        if (!d.adding) this.addMeshes(id, d);
      } else d.meshes?.hide();
      // A point until its meshes show: the light of its hull and its torch.
      const dir = v3scale(mid, 1 / dist);
      setPoint(this.pointPos, this.pointCol, point, dir, this.far, shipFlux(d.shape, throttle, dist, v3dot(sunDir, v3scale(dir, -1)), sunlight));
      return d;
    };
    for (const ship of ships) placeOne(ship.visit.id, () => shipShape(ship.visit.ship), ship.forward, ship.up, ship.position, ship.throttle);
    this.moving = ships;
    const h = this.placed.habitat, shapes = (v: Visit): ShipShape => this.ships.get(v.id)!.shape;
    this.craft = craftAt(h, this.placed.id, this.space.params.seed, ships, t, shapes);
    for (const c of this.craft) placeOne(c.id, () => craftShape(c), c.forward, c.up, v3sub(c.position, v3scale(c.forward, c.length / 2)), 0);
    for (const [id, d] of this.ships) if (!seen.has(id)) { d.meshes?.removeFrom(this.stage); this.ships.delete(id); }
    pointsChanged(this.points);
    this.lamps.send();
  }

  private addMeshes(id: string, d: Drawn): void {
    d.adding = true;
    const m = new ShipMeshes(d.shape, `${this.placed.id} ship ${id}`);
    void m.addTo(this.stage, true).then(() => {
      // Gone while its shaders were being built: give it straight back.
      if (this.ships.get(id) !== d) { m.removeFrom(this.stage); return; }
      d.meshes = m;
      d.adding = false;
    });
  }

  /** The ships as the exposure meter sees them: each a cylinder of its beam. */
  hulls(): Hull[] {
    return this.now.map(({ shape, axes, stern }) => {
      const L = shape.params.length, axis = apply(axes, [1, 0, 0]);
      return { center: v3add(stern, v3scale(axis, L / 2)), axis, radius: shape.params.beam / 2, halfLength: L / 2, albedo: SHIP_ALBEDO };
    });
  }

  /** Distance from a point (relative to the eye, scene axes) to the nearest ship's hull, as a cylinder of its beam (m). */
  distance(p: Vec3): number {
    let best = Infinity;
    for (const { shape, axes, stern } of this.now) {
      const q = apply(transpose(axes), v3sub(p, stern)), L = shape.params.length;
      const along = Math.max(0, -q[0], q[0] - L), across = Math.max(0, Math.hypot(q[1], q[2]) - shape.params.beam / 2);
      best = Math.min(best, Math.hypot(along, across));
    }
    return best;
  }

  /** The bytes its ships' meshes hold on the GPU. */
  shipBytes(): number {
    let n = 0;
    for (const d of this.ships.values()) n += d.meshes?.bytes ?? 0;
    return n;
  }

  info(): string {
    const by = (phase: string): number => this.moving.filter((s) => s.phase === phase).length;
    const out = this.craft.filter((c) => c.kind === 'tug' && !this.parked(c)).length, inspectors = this.craft.filter((c) => c.kind === 'inspector').length;
    return `${this.placed.id} ships: ${by('berthed')} berthed, ${by('final') + by('turn') + by('coast')} on thrusters, ${by('torch')} braking or leaving on the torch; ${out} tugs out, ${inspectors} inspectors`;
  }

  /** Whether a tug is in its cradle. */
  private parked(c: CraftNow): boolean {
    const arm = Number(c.id.split('/').pop()), home = tugCradle(this.placed.habitat, arm).at;
    return v3len(v3sub(c.position, home)) < c.length * 0.01;
  }

  dispose(): void {
    for (const d of this.ships.values()) d.meshes?.removeFrom(this.stage);
    this.ships.clear();
    this.stage.remove(this.points);
    freeMesh(this.points);
    this.lamps.leave(this.stage);
  }
}
