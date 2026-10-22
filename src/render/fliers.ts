/**
 * The drones that work the land (design "Who is out on the land"; who flies where: sim/air.ts; their designs: Actors'
 * drone kit, gen/drone.ts). Every drone of the habitat is drawn, at one of three levels by how big it is on screen:
 *
 *   near     the whole build of its design (DRONE and DRONE_VEIL kinds): rotors spinning, strobes flashing, the
 *            body bobbing, pitched into its way and banked into its turns as its gravity there asks;
 *   coarse   the same drone with a tenth of the triangles (gen/simplify.ts), where it is under `NEAR_PX` across;
 *   speck    under `SPECK_PX`, the patch of screen it covers in its mean colour (the SPECK kind, as people far off).
 *
 * All levels are written here in the same frame from the same place, and every design's meshes are on the GPU before
 * any drone is shown, so a drone changes level from one frame to the next and is never drawn by neither (CLAUDE.md,
 * rule 16; the debug line counts any that were: `holes`). Each design and level is one instanced mesh; its instances
 * are written again every frame for the drones in it. Nobody is simulated: each drone is asked where it is
 * (`flierAt`), near ones every frame, far ones a share each frame.
 */
import { Group, InstancedBufferAttribute, InstancedInterleavedBuffer, MathUtils, Vector2, type Camera, type InstancedBufferGeometry, type Mesh, type PerspectiveCamera } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat } from '@futuremagic/core';
import { toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_SHOWN, SPECK_STRIDE, packColor, writeSpeck } from '../gen/standIn';
import { designBytes, type DesignMesh, type DroneDesign } from '../gen/drone';
import { ROLES, airBytes, fleetOf, flierAt, type Flier } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { DRONE, DRONE_VEIL, FLIER_LAYOUT, SPECK, SPECK_LAYOUT, layInstances } from './materials';
import { turnFor } from './people';
import { FLIER_STRIDE, writeFlier } from './droneShaders';
import { drawnAnywhere, dropUploaded, freeMesh, instancedOf, meshGeometry, quadInstances } from './geometry';

/** A drone is drawn whole from this many pixels across, coarse down to `SPECK_PX`, a speck below. Back up at `BACK` × each. */
const NEAR_PX = 48;
const SPECK_PX = 4;
const BACK = 1.2;
/** Closer than this (m), drones are asked where they are every frame; further, one in `FAR_SHARE` each frame. */
const EVERY_FRAME = 300;
const FAR_SHARE = 6;
/** How fast a drone turns to its way (rad/s), how far it pitches into it at cruise (rad), how far it banks at most. */
const TURN_RATE = 1.5;
const PITCH = 0.18;
const BANK = 0.35;
/** Below this height over the ground (m) the land's horizons light a drone; above, the open sky does. */
const LOW = 40;
/** Its light is looked up again once it is this far on (m). */
const LIGHT_MOVE = 10;

type Level = 0 | 1 | 2;
const LEVELS = ['near', 'coarse', 'speck'] as const;

/** One design's meshes on the GPU: per level (near, coarse) its body and veil sharing one instance buffer. */
interface Drawn {
  design: DroneDesign;
  levels: { body: Mesh; veil: Mesh; data: Float32Array; buffer: InstancedInterleavedBuffer; count: number }[];
  /** Its largest size (m), its height and its width across (for its speck), its colour packed. */
  size: number;
  height: number;
  across: number;
  color: number;
  gpuBytes: number;
}

/** A drone as last placed. */
interface One {
  flier: Flier | null;
  /** Its ground point (world) and turn shown, its lowest point (world). */
  at: Vec3;
  low: Vec3;
  turn: number;
  roll: number;
  horizon: [number, number];
  litAt: Vec3;
  level: Level;
  phase: number;
}

export class FlierView {
  readonly group = new Group();
  private drawn: Drawn[] | null = null;
  private specks: { mesh: Mesh; data: Float32Array; buffer: InstancedInterleavedBuffer } | null = null;
  private readonly ones: One[] = [];
  private readonly screen = new Vector2();
  private frameNo = 0;
  private holes = 0;
  private holeFrames = 0;
  private counts = [0, 0, 0];
  private slowest = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly pool: WorkerPool) {
    this.group.name = 'drones';
    void this.start();
  }

  /** Every design built in the workers, put on the GPU and compiled; then the drones are shown. */
  private async start(): Promise<void> {
    const h = this.habitat, n = h.params.life.drones.designs, t0 = performance.now();
    const asks = ROLES.flatMap((role) => Array.from({ length: n }, (_, index) => this.pool.job({ kind: 'drone', params: h.params, role, index })));
    const designs = (await Promise.all(asks)).map((a) => ('kind' in a && a.kind === 'drone' ? a.design : null));
    this.slowest = performance.now() - t0;
    if (this.disposed || designs.some((d) => !d)) return;
    const fleet = fleetOf(this.terrain);
    const drawn = await Promise.all(designs.map((d) => this.upload(d!, Math.max(1, fleet.filter((j) => j.role === d!.role && j.design === d!.index).length))));
    const specks = drawnAnywhere(quadInstances(), SPECK.material, 'drone specks');
    const data = new Float32Array(Math.max(1, fleet.length) * SPECK_STRIDE), buffer = layInstances(specks.geometry, data, SPECK_LAYOUT);
    specks.geometry.setAttribute(SPECK_SHOWN, new InstancedBufferAttribute(new Float32Array(Math.max(1, fleet.length)).fill(1), 1));
    (specks.geometry as InstancedBufferGeometry).instanceCount = 0;
    await this.stage.prepare(specks);
    if (this.disposed) { for (const d of drawn) this.free(d); freeMesh(specks); return; }
    this.specks = { mesh: specks, data, buffer };
    for (const d of drawn) for (const l of d.levels) this.group.add(l.body, l.veil);
    this.group.add(specks);
    fleet.forEach((_, id) => this.ones.push({ flier: null, at: [0, 0, 0], low: [0, 0, 0], turn: 0, roll: 0, horizon: [OPEN_SKY, OPEN_SKY], litAt: [Infinity, 0, 0], level: 2, phase: 1000 * hashToFloat(hash3i(h.seed, id, 41, 0)) }));
    this.drawn = drawn;
  }

  /** A design's two levels on the GPU, room for `most` drones of it in each; the shapes' CPU copies let go. */
  private async upload(design: DroneDesign, most: number): Promise<Drawn> {
    const make = (m: DesignMesh, name: string, body: boolean, buffer: Float32Array | InstancedInterleavedBuffer): { mesh: Mesh; buffer: InstancedInterleavedBuffer } => {
      const g = instancedOf(meshGeometry(m.index, { position: [m.positions, 3], normal: [m.normals, 3], paint: [m.paint, 4], spin: body ? [m.spin, 4] : undefined }));
      const shared = layInstances(g, buffer, FLIER_LAYOUT);
      g.instanceCount = 0;
      const mesh = drawnAnywhere(g, (body ? DRONE : DRONE_VEIL).material, `${design.name} ${name}`);
      mesh.castShadow = body;
      mesh.renderOrder = body ? 0 : 1;
      return { mesh, buffer: shared };
    };
    const levels = [];
    for (const [k, level] of [design.body, design.coarse.body].entries()) {
      const data = new Float32Array(most * FLIER_STRIDE);
      const body = make(level, LEVELS[k], true, data), veil = make(k === 0 ? design.veil : design.coarse.veil, `${LEVELS[k]} veil`, false, body.buffer);
      levels.push({ body: body.mesh, veil: veil.mesh, data, buffer: body.buffer, count: 0 });
    }
    const gpuBytes = designBytes(design);
    await Promise.all(levels.flatMap((l) => [this.stage.prepare(l.body), this.stage.prepare(l.veil)]));
    for (const l of levels) for (const m of [l.body, l.veil]) dropUploaded(m, this.stage.renderer, [...FLIER_LAYOUT.attributes]);
    const ext = design.max.map((v, k) => v - design.min[k]);
    return {
      design, levels, gpuBytes, size: Math.max(...ext), height: ext[1], across: Math.hypot(ext[0], ext[2]) / Math.SQRT2,
      color: packColor(design.albedo.map((v) => Math.pow(v, 1 / 2.2)) as [number, number, number]),
    };
  }

  /** Bring every drone up to clock time t (s), drawn relative to the eye (world). `dt`: the frame's (s). */
  follow(eye: Vec3, t: number, dt: number): void {
    const drawn = this.drawn, specks = this.specks;
    if (!drawn || !specks) return;
    this.frameNo++;
    const cruise = this.habitat.params.life.drones.cruise;
    const byDesign = new Map<string, Drawn>(drawn.map((d) => [`${d.design.role}/${d.design.index}`, d]));
    const fov = (this.camera as PerspectiveCamera).isPerspectiveCamera ? (this.camera as PerspectiveCamera).getEffectiveFOV() : 50;
    const pxPerMetre = this.stage.renderer.getDrawingBufferSize(this.screen).y / 2 / Math.tan(MathUtils.degToRad(fov / 2));
    for (const d of drawn) for (const l of d.levels) l.count = 0;
    let speckCount = 0, written = 0;
    this.counts = [0, 0, 0];
    this.ones.forEach((one, id) => {
      const due = !one.flier || dist(one.at, eye) < EVERY_FRAME || (id + this.frameNo) % FAR_SHARE === 0;
      if (due) this.place(one, flierAt(this.terrain, id, t), one.flier ? dt : 0);
      const f = one.flier!, d = byDesign.get(`${f.role}/${f.design}`)!;
      // Its level by its size on screen, with a margin each way so it does not flicker at the line.
      const px = (d.size * pxPerMetre) / Math.max(1e-3, dist(one.at, eye));
      const level: Level = one.level === 0 ? (px >= NEAR_PX / BACK ? 0 : px >= SPECK_PX ? 1 : 2)
        : one.level === 1 ? (px >= NEAR_PX ? 0 : px >= SPECK_PX / BACK ? 1 : 2)
        : px >= NEAR_PX ? 0 : px >= SPECK_PX ? 1 : 2;
      one.level = level;
      this.counts[level]++;
      if (level === 2) {
        writeSpeck(specks.data, speckCount++ * SPECK_STRIDE, one.low, d.height, [0, 0, 0], POSE.upright, [d.color, d.color, d.color], one.horizon, d.across / (d.height * BODY_WIDTH));
        written++;
        return;
      }
      const l = d.levels[level], design = d.design, running = f.doing === 'rest' ? 0 : 1;
      const pitch = f.doing === 'fly' ? PITCH * Math.min(1.2, f.speed / cruise) : 0;
      writeFlier(l.data, l.count++ * FLIER_STRIDE, {
        at: toView(eye, one.at), turn: one.turn, pitch, roll: one.roll, running, phase: one.phase,
        bob: design.bob, body: design.hover, horizon: one.horizon,
      });
      written++;
    });
    if (written !== this.ones.length) { this.holes += this.ones.length - written; this.holeFrames++; }
    for (const d of drawn) for (const l of d.levels) {
      for (const m of [l.body, l.veil]) (m.geometry as InstancedBufferGeometry).instanceCount = l.count;
      upload(l.buffer, l.count, FLIER_STRIDE);
    }
    (specks.mesh.geometry as InstancedBufferGeometry).instanceCount = speckCount;
    upload(specks.buffer, speckCount, SPECK_STRIDE);
  }

  /** Put a drone where the fleet says it is now: its ground point, its turn eased toward its way, its bank, its light. */
  private place(one: One, f: Flier, dt: number): void {
    const h = this.habitat, { profile } = h, drawn = this.drawn!.find((d) => d.design.role === f.role && d.design.index === f.design)!;
    const low = toWorld(profile, { theta: f.theta, s: f.s, h: f.h });
    one.low = low;
    one.at = toWorld(profile, { theta: f.theta, s: f.s, h: f.h - drawn.design.min[1] });
    // Its turn, as a stand-in's (render/people.ts), eased toward its heading; banked as a turn at its speed needs in
    // the gravity where it is (tan bank = speed × turn rate / g).
    const r = Math.hypot(low[0], low[1]), target = turnFor(profile, f.s, f.heading);
    if (!one.flier || dt <= 0) one.turn = target;
    else {
      const gap = wrap(target - one.turn), step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, gap));
      one.turn = wrap(one.turn + (f.doing === 'rest' ? 0 : step));
      const g = Math.max(0.05, h.gravityAt(r));
      const rate = f.speed > 0.5 ? step / dt : 0, bank = Math.max(-BANK, Math.min(BANK, Math.atan((f.speed * rate) / g)));
      one.roll += (bank - one.roll) * Math.min(1, dt * 3);
    }
    // Low, the land's horizons light it; high, the open sky.
    const agl = f.h - this.terrain.standAt(f.theta, f.s);
    if (agl > LOW) one.horizon = [OPEN_SKY, OPEN_SKY];
    else if (dist(low, one.litAt) > LIGHT_MOVE) { one.horizon = horizonAt(this.terrain, f.theta, f.s); one.litAt = low; }
    one.flier = f;
  }

  private free(d: Drawn): void {
    for (const l of d.levels) { freeMesh(l.body); freeMesh(l.veil); }
  }

  /** Bytes held: the designs on the GPU, the instances and the drones' state on the CPU, the fleet (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + this.ones.length * 200 + airBytes(this.terrain);
    for (const d of this.drawn ?? []) { n += d.gpuBytes; for (const l of d.levels) n += l.data.byteLength; }
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.drawn) return `drones: ${this.disposed ? 'gone' : 'designs being built'}`;
    const [near, coarse, specks] = this.counts;
    return `drones: ${this.ones.length} (${this.drawn.length} designs, built in ${this.slowest.toFixed(0)} ms) · ${near} near · ${coarse} coarse · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.drawn ?? []) this.free(d);
    if (this.specks) freeMesh(this.specks.mesh);
    this.drawn = null;
    this.specks = null;
    this.group.removeFromParent();
  }
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

function upload(buffer: InstancedInterleavedBuffer, n: number, stride: number): void {
  buffer.needsUpdate = true;
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, Math.max(1, n) * stride);
}
