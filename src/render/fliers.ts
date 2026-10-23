/**
 * The drones that work the land (design "Who is out on the land"; who flies where: sim/air.ts; their designs: Actors'
 * drone kit, gen/drone.ts), and the people whose body is a drone: the people's view finds and follows them as anyone
 * (`Aloft`, render/people.ts) and hands them here each frame, placed by their footing (sim/footing.ts: hovering at
 * the eyes of those they are with), facing as they face, nodding while it is their turn to talk; `near` lists them for
 * the far specks, which draw them beyond (`measured` gives those their built size and colour). Every drone of the
 * habitat is drawn, at one of three levels by how big it is on screen:
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
import { Group, InstancedInterleavedBuffer, Vector2, type Camera, type InstancedBufferGeometry, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat } from '@futuremagic/core';
import { toView, toWorld, type Habitat, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, packColor, writeSpeck } from '../gen/standIn';
import { designBytes, designsOf, type DesignMesh, type DroneDesign } from '../gen/drone';
import { HEARD_WITHIN, type Source } from '../sim/sources';
import { ROLES, airBytes, fleetOf, flierAt, footingOf, talkerAt, type Flier } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { DRONE, DRONE_VEIL, FLIER_LAYOUT, layInstances } from './materials';
import { drawSpecks, ownSpecks, pxPerMetre, roomForSpecks, type OwnSpecks } from './specks';
import { turnFor, type Aloft } from './people';
import { FLIER_STRIDE, writeFlier } from './droneShaders';
import { drawnAnywhere, dropUploaded, freeMesh, instancedOf, meshGeometry, sendInstances } from './geometry';

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
/** Room for this many people in drone bodies per design at first (doubled when more are near). */
const PERSONS_ROOM = 8;
/** A person in a drone body nods while it is their turn to talk: this far (rad), once in this long (s). */
const NOD = 0.07;
const NOD_EVERY = 1.3;

type Level = 0 | 1 | 2;

/** What a frame's drawing carries from drone to drone: the eye, pixels per metre at a metre, specks and drones written. */
interface Frame {
  eye: Vec3;
  perMetre: number;
  specks: number;
  written: number;
}
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
  /** How many of the fleet are of this design. */
  fleet: number;
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
  private specks: OwnSpecks | null = null;
  private readonly ones: One[] = [];
  /** The people in drone bodies drawn here, by `personKey`. */
  private readonly persons = new Map<number, One>();
  /** Whom of them this frame drew (`personKey`): the far specks leave them out. */
  readonly near: number[] = [];
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
    const h = this.habitat, t0 = performance.now();
    const asks = ROLES.flatMap((role) => Array.from({ length: designsOf(h, role) }, (_, index) => this.pool.job({ kind: 'drone', params: h.params, role, index })));
    const designs = (await Promise.all(asks)).map((a) => ('kind' in a && a.kind === 'drone' ? a.design : null));
    this.slowest = performance.now() - t0;
    if (this.disposed || designs.some((d) => !d)) return;
    const fleet = fleetOf(this.terrain);
    const drawn = await Promise.all(designs.map((d) => this.onGpu(d!, fleet.filter((j) => j.role === d!.role && j.design === d!.index).length)));
    const specks = ownSpecks('drone specks', fleet.length + PERSONS_ROOM);
    await this.stage.prepare(specks.mesh);
    if (this.disposed) { for (const d of drawn) this.letGo(d); freeMesh(specks.mesh); return; }
    this.specks = specks;
    for (const d of drawn) for (const l of d.levels) this.group.add(l.body, l.veil);
    this.group.add(specks.mesh);
    fleet.forEach((_, id) => this.ones.push(this.unplaced(hash3i(h.seed, id, 41, 0))));
    this.drawn = drawn;
  }

  /**
   * A design's two levels on the GPU, room in each for the `fleet` drones of it and a few people wearing it (more is
   * made when needed: `room`); the shapes' CPU copies let go.
   */
  private async onGpu(design: DroneDesign, fleet: number): Promise<Drawn> {
    const most = fleet + (design.role === 'person' ? PERSONS_ROOM : 0) || 1;
    const meshFor = (m: DesignMesh, name: string, body: boolean, buffer: Float32Array | InstancedInterleavedBuffer): { mesh: Mesh; buffer: InstancedInterleavedBuffer } => {
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
      const body = meshFor(level, LEVELS[k], true, data), veil = meshFor(k === 0 ? design.veil : design.coarse.veil, `${LEVELS[k]} veil`, false, body.buffer);
      levels.push({ body: body.mesh, veil: veil.mesh, data, buffer: body.buffer, count: 0 });
    }
    const gpuBytes = designBytes(design);
    await Promise.all(levels.flatMap((l) => [this.stage.prepare(l.body), this.stage.prepare(l.veil)]));
    for (const l of levels) for (const m of [l.body, l.veil]) dropUploaded(m, this.stage.renderer, [...FLIER_LAYOUT.attributes]);
    const ext = design.max.map((v, k) => v - design.min[k]);
    return {
      design, levels, gpuBytes, fleet, size: Math.max(...ext), height: ext[1], across: Math.hypot(ext[0], ext[2]) / Math.SQRT2,
      color: packColor(design.albedo.map((v) => Math.pow(v, 1 / 2.2)) as [number, number, number]),
    };
  }

  /**
   * Bring every drone up to clock time t (s), drawn relative to the eye (world), and the people in drone bodies the
   * people's view placed (`aloft`). `dt`: the frame's (s).
   */
  follow(eye: Vec3, t: number, dt: number, aloft: readonly Aloft[] = [], below = false): void {
    const drawn = this.drawn, specks = this.specks;
    this.near.length = 0;
    if (!drawn || !specks) return;
    this.frameNo++;
    const byDesign = new Map<string, Drawn>(drawn.map((d) => [`${d.design.role}/${d.design.index}`, d]));
    const bodyOf = (a: Aloft): Drawn => byDesign.get(`person/${a.resident.design}`)!;
    // Room for everyone of each design here now (more people in one body than ever before: its buffers grow).
    const wearing = new Map<Drawn, number>();
    for (const a of aloft) wearing.set(bodyOf(a), (wearing.get(bodyOf(a)) ?? 0) + 1);
    for (const [d, n] of wearing) this.room(d, d.fleet + n);
    roomForSpecks(specks, this.ones.length + aloft.length);
    const frame: Frame = { eye, perMetre: pxPerMetre(this.stage, this.camera, this.screen), specks: 0, written: 0 };
    for (const d of drawn) for (const l of d.levels) l.count = 0;
    this.counts = [0, 0, 0];
    if (!below) this.ones.forEach((one, id) => {
      const due = !one.flier || away(one.at, eye) < EVERY_FRAME || (id + this.frameNo) % FAR_SHARE === 0;
      if (due) this.putDrone(one, flierAt(this.terrain, id, t), one.flier ? dt : 0);
      this.write(one, byDesign.get(`${one.flier!.role}/${one.flier!.design}`)!, frame, 0);
    });
    // The people in drone bodies: every frame, from the people's view's latest word on where they are.
    const here = new Set<number>();
    for (const a of aloft) {
      const d = bodyOf(a), p = a.person, foot = footingOf(this.terrain, p, a.deck, d.height);
      let one = this.persons.get(a.key);
      if (!one) this.persons.set(a.key, (one = this.unplaced(hash3i(this.habitat.seed, p.resident, 43, 0))));
      this.putDrone(one, {
        id: -1, role: 'person', design: a.resident.design, theta: p.theta, s: p.s, h: foot.h, heading: p.heading,
        speed: p.moving ? p.speed : 0, climb: 0, doing: p.moving ? 'fly' : 'work',
      }, one.flier ? dt : 0);
      const talking = !p.moving && p.act === 'talk' && talkerAt(p, t) === p.member;
      this.write(one, d, frame, talking ? NOD * Math.sin((2 * Math.PI * (t + one.phase)) / NOD_EVERY) : 0);
      this.near.push(a.key);
      here.add(a.key);
    }
    for (const key of this.persons.keys()) if (!here.has(key)) this.persons.delete(key);
    const all = (below ? 0 : this.ones.length) + aloft.length;
    if (frame.written !== all) { this.holes += all - frame.written; this.holeFrames++; }
    for (const d of drawn) for (const l of d.levels) {
      for (const m of [l.body, l.veil]) (m.geometry as InstancedBufferGeometry).instanceCount = l.count;
      sendInstances(l.buffer, l.count, FLIER_STRIDE);
    }
    drawSpecks(specks, frame.specks);
  }

  /** A drone not yet placed. */
  private unplaced(seed: number): One {
    return { flier: null, at: [0, 0, 0], low: [0, 0, 0], turn: 0, roll: 0, horizon: [OPEN_SKY, OPEN_SKY], litAt: [Infinity, 0, 0], level: 2, phase: 1000 * hashToFloat(seed) };
  }

  /** Write a placed drone at its level by its size on screen (a margin each way, so it does not flicker at the line); `nod` tips it forward (rad). */
  private write(one: One, d: Drawn, frame: Frame, nod: number): void {
    const f = one.flier!, px = (d.size * frame.perMetre) / Math.max(1e-3, away(one.at, frame.eye));
    const level: Level = one.level === 0 ? (px >= NEAR_PX / BACK ? 0 : px >= SPECK_PX ? 1 : 2)
      : one.level === 1 ? (px >= NEAR_PX ? 0 : px >= SPECK_PX / BACK ? 1 : 2)
      : px >= NEAR_PX ? 0 : px >= SPECK_PX ? 1 : 2;
    one.level = level;
    this.counts[level]++;
    frame.written++;
    if (level === 2) {
      writeSpeck(this.specks!.data, frame.specks++ * SPECK_STRIDE, one.low, d.height, [0, 0, 0], POSE.upright, [d.color, d.color, d.color], one.horizon, d.across / (d.height * BODY_WIDTH));
      return;
    }
    const l = d.levels[level], design = d.design, running = f.doing === 'rest' ? 0 : 1, cruise = this.habitat.params.life.drones.cruise;
    const pitch = (f.doing === 'fly' ? PITCH * Math.min(1.2, f.speed / cruise) : 0) + nod;
    writeFlier(l.data, l.count++ * FLIER_STRIDE, {
      at: toView(frame.eye, one.at), turn: one.turn, pitch, roll: one.roll, running, phase: one.phase,
      bob: design.bob, body: design.hover, horizon: one.horizon,
    });
  }

  /** Room in both of a design's levels for `need` drones: new instances on the same meshes, so nothing is compiled again. */
  private room(d: Drawn, need: number): void {
    for (const l of d.levels) {
      if (l.data.length >= need * FLIER_STRIDE) continue;
      l.data = new Float32Array(Math.max(need, (2 * l.data.length) / FLIER_STRIDE) * FLIER_STRIDE);
      l.buffer = layInstances(l.body.geometry, l.data, FLIER_LAYOUT);
      layInstances(l.veil.geometry, l.buffer, FLIER_LAYOUT);
    }
  }

  /** A drone body's size and colour as the far specks draw it (`design`: which of the bodies people wear), once built. */
  measured(design: number): { height: number; width: number; bands: [number, number, number] } | null {
    const d = this.drawn?.find((x) => x.design.role === 'person' && x.design.index === design);
    return d ? { height: d.height, width: d.across / (d.height * BODY_WIDTH), bands: [d.color, d.color, d.color] } : null;
  }

  /** Put a drone where the fleet says it is now: its ground point, its turn eased toward its way, its bank, its light. */
  private putDrone(one: One, f: Flier, dt: number): void {
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
    else if (away(low, one.litAt) > LIGHT_MOVE) { one.horizon = horizonAt(this.terrain, f.theta, f.s); one.litAt = low; }
    one.flier = f;
  }

  private letGo(d: Drawn): void {
    for (const l of d.levels) { freeMesh(l.body); freeMesh(l.veil); }
  }

  /** The drones near the eye that can be heard (sim/sources.ts): where each is, how it flies, its role. */
  heard(eye: Vec3, out: Source[]): void {
    for (const one of this.ones) {
      const f = one.flier;
      if (!f || away(one.low, eye) > HEARD_WITHIN.drone) continue;
      out.push({ key: f.id, kind: 'drone', theta: f.theta, s: f.s, h: f.h, at: one.low, speed: f.speed, doing: f.doing, began: 0, role: f.role });
    }
  }

  /** Bytes held: the designs on the GPU, the instances and the drones' state on the CPU, the fleet (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + (this.ones.length + this.persons.size) * 200 + airBytes(this.terrain);
    for (const d of this.drawn ?? []) { n += d.gpuBytes; for (const l of d.levels) n += l.data.byteLength; }
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.drawn) return `drones: ${this.disposed ? 'gone' : 'designs being built'}`;
    const [near, coarse, specks] = this.counts;
    return `drones: ${this.ones.length} and ${this.persons.size} people in drone bodies (${this.drawn.length} designs, built in ${this.slowest.toFixed(0)} ms) · ${near} near · ${coarse} coarse · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.drawn ?? []) this.letGo(d);
    if (this.specks) freeMesh(this.specks.mesh);
    this.drawn = null;
    this.specks = null;
    this.group.removeFromParent();
  }
}

const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
