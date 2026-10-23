/**
 * The boats on the habitat's water (Arnd 2026-10-23; who sails where and when: sim/sailing.ts; their designs:
 * gen/boat.ts). Every boat of the fleet is drawn, under sail or at its mooring, at one of three levels by how big it
 * is on screen:
 *
 *   near     the whole build of its design (the BOAT kind) with its wake (BOAT_WAKE): the wing turned to the wind
 *            over the boat, heeled and rocking, a foiler up on its foils once flying;
 *   coarse   the same boat with a tenth of the triangles (gen/simplify.ts), and its wake, under `NEAR_PX` across;
 *   speck    under `SPECK_PX`, the patch of screen it covers: its wing's colour over its hull's (the SPECK kind).
 *
 * All levels are written here in the same frame from the same place, and every design's meshes are on the GPU before
 * any boat is shown, so a boat changes level from one frame to the next and is never drawn by neither (CLAUDE.md,
 * rule 16; the debug line counts any that were: `holes`). Nobody is simulated: each boat is asked where it is
 * (`boatAt`), near ones every frame, far ones a share each frame and carried on along their way in between. Its heel,
 * wing and lift ease toward what it is asked to show, as a hull and a wing take time to answer a gust.
 */
import { Group, Vector2, type Camera, type InstancedBufferGeometry, type InstancedInterleavedBuffer, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { angleDiff, hash3i, hashToFloat } from '@futuremagic/core';
import { toView, toWorld, type Habitat, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, packColor, writeSpeck } from '../gen/standIn';
import { BOAT_KINDS, BOAT_KIND_LIST, boatBytes, liveryOf, type BoatDesign, type BoatKind, type BoatMesh } from '../gen/boat';
import { boatAt, dayKnown, keepDay, sailingBytes, sailingOf, type Boat, type BoatState } from '../sim/sailing';
import { dayNumber } from '../world/sunline';
import type { WorkerPool } from '../workers/pool';
import { BOAT, BOAT_LAYOUT, BOAT_WAKE, instancedLevel, roomForInstances } from './materials';
import { drawSpecks, ownSpecks, pxPerMetre, roomForSpecks, type OwnSpecks } from './specks';
import { turnFor } from './people';
import { BOAT_STRIDE, writeBoat } from './boatShaders';
import { dropUploaded, freeMesh, sendInstances } from './geometry';

/** A boat is drawn whole from this many pixels across, coarse down to `SPECK_PX`, a speck below. Back up at `BACK` × each. */
const NEAR_PX = 48;
const SPECK_PX = 4;
const BACK = 1.2;
/** Closer than this (m), boats are asked where they are every frame; further, one in `FAR_SHARE` each frame. */
const EVERY_FRAME = 400;
const FAR_SHARE = 6;
/** How fast a boat's bow comes round to its way (rad/s); its heel and wing ease at these rates (per s); its foils lift it at this (m/s). */
const TURN_RATE = 0.8;
const HEEL_EASE = 1.5;
const WING_EASE = 2;
const LIFT_RATE = 0.6;
/** The wing sets this far off the wind over the boat (rad), and swings out at most this far (rad). */
const ATTACK = 12 * Math.PI / 180;
const SHEETED_OUT = 85 * Math.PI / 180;
/** Its trim: bow up by this (rad) at its top speed. */
const SQUAT = 0.02;
/** Its light is looked up again once it is this far on (m). A boat's state on the CPU (bytes, about). */
const LIGHT_MOVE = 10;
const ONE_BYTES = 260;

type Level = 0 | 1 | 2;
const LEVELS = ['near', 'coarse'] as const;

/** One design's meshes on the GPU: per level (near, coarse) its body and wake sharing one instance buffer. */
interface Drawn {
  design: BoatDesign;
  levels: { body: Mesh; wake: Mesh; data: Float32Array; buffer: InstancedInterleavedBuffer; count: number }[];
  /** Its height (water to masthead), its length, its wing's colour packed. */
  height: number;
  length: number;
  wing: number;
  gpuBytes: number;
}

/** A boat as last asked and placed. */
interface One {
  boat: Boat;
  state: BoatState | null;
  /** When it was last asked (clock, s). */
  asked: number;
  /** Its waterline point (world) and what it shows now. */
  at: Vec3;
  turn: number;
  roll: number;
  wing: number;
  lift: number;
  horizon: [number, number];
  litAt: Vec3;
  level: Level;
  phase: number;
  livery: Vec3;
  hull: number;
}

/** What a frame's drawing carries from boat to boat. */
interface Frame {
  eye: Vec3;
  perMetre: number;
  specks: number;
  written: number;
}

export class BoatView {
  readonly group = new Group();
  private drawn: Map<BoatKind, Drawn> | null = null;
  private specks: OwnSpecks | null = null;
  private readonly ones: One[] = [];
  private readonly screen = new Vector2();
  private frameNo = 0;
  private holes = 0;
  private holeFrames = 0;
  private counts = [0, 0, 0];
  private sailing = 0;
  private slowest = 0;
  /** Whether the boats have been shown yet, and the days being planned in a worker. */
  private shown = false;
  private readonly planning = new Set<number>();
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly pool: WorkerPool) {
    this.group.name = 'boats';
    void this.start();
  }

  /** Every design the fleet sails built in the workers, put on the GPU and compiled; then the boats are shown. */
  private async start(): Promise<void> {
    const fleet = sailingOf(this.habitat).boats;
    if (!fleet.length) return;
    const kinds = BOAT_KIND_LIST.filter((k) => fleet.some((b) => b.kind === k)), t0 = performance.now();
    const answers = await Promise.all(kinds.map((boat) => this.pool.job({ kind: 'boat', boat })));
    const designs = answers.map((a) => ('kind' in a && a.kind === 'boat' ? a.design : null));
    this.slowest = performance.now() - t0;
    if (this.disposed || designs.some((d) => !d)) return;
    const drawn = await Promise.all(designs.map((d) => this.toGpu(d!, fleet.filter((b) => b.kind === d!.kind).length)));
    const specks = ownSpecks('boat specks', fleet.length);
    await this.stage.prepare(specks.mesh);
    if (this.disposed) { for (const d of drawn) this.freeDesign(d); freeMesh(specks.mesh); return; }
    this.specks = specks;
    for (const d of drawn) for (const l of d.levels) this.group.add(l.body, l.wake);
    this.group.add(specks.mesh);
    for (const boat of fleet) {
      const livery = liveryOf(hash3i(boat.seed, 7, 0, 0));
      this.ones.push({
        boat, state: null, asked: -Infinity, at: [0, 0, 0], turn: 0, roll: 0, wing: 0, lift: 0, horizon: [0, 0], litAt: [Infinity, 0, 0], level: 2,
        phase: 100 * hashToFloat(hash3i(boat.seed, 11, 0, 0)), livery, hull: packColor(livery.map((v) => Math.pow(v, 1 / 2.2)) as [number, number, number]),
      });
    }
    this.drawn = new Map(drawn.map((d) => [d.design.kind, d]));
  }

  /** A design's two levels on the GPU, room in each for every boat of it; the shapes' CPU copies let go. */
  private async toGpu(design: BoatDesign, fleet: number): Promise<Drawn> {
    const attributesOf = (m: BoatMesh) => ({ position: [m.positions, 3], normal: [m.normals, 3], paint: [m.paint, 4], rig: [m.rig, 4] }) as const;
    const levels = [design.body, design.coarse].map((m, k) => {
      const data = new Float32Array(Math.max(1, fleet) * BOAT_STRIDE);
      const body = instancedLevel(m.index, attributesOf(m), BOAT, `${design.name} ${LEVELS[k]}`, BOAT_LAYOUT, data);
      const wake = instancedLevel(design.wake.index, attributesOf(design.wake), BOAT_WAKE, `${design.name} ${LEVELS[k]} wake`, BOAT_LAYOUT, body.buffer);
      body.mesh.castShadow = true;
      wake.mesh.renderOrder = 1;
      return { body: body.mesh, wake: wake.mesh, data, buffer: body.buffer, count: 0 };
    });
    await Promise.all(levels.flatMap((l) => [this.stage.prepare(l.body), this.stage.prepare(l.wake)]));
    for (const l of levels) for (const m of [l.body, l.wake]) dropUploaded(m, this.stage.renderer, [...BOAT_LAYOUT.attributes]);
    return {
      design, levels, gpuBytes: boatBytes(design), height: design.max[1], length: design.max[2] - design.min[2],
      wing: packColor(design.wing.map((v) => Math.pow(v, 1 / 2.2)) as [number, number, number]),
    };
  }

  /** Bring every boat up to clock time t (s), drawn relative to the eye (world). `dt`: the frame's (s). Below the land, none. */
  follow(eye: Vec3, t: number, dt: number, below = false): void {
    const drawn = this.drawn, specks = this.specks;
    if (!drawn || !specks || !this.planned(t)) return;
    this.frameNo++;
    roomForSpecks(specks, this.ones.length);
    for (const d of drawn.values()) for (const l of d.levels) { roomForInstances(l, this.ones.length, BOAT_LAYOUT, [l.body.geometry, l.wake.geometry]); l.count = 0; }
    const frame: Frame = { eye, perMetre: pxPerMetre(this.stage, this.camera, this.screen), specks: 0, written: 0 };
    this.counts = [0, 0, 0];
    this.sailing = 0;
    if (!below) this.ones.forEach((one, id) => {
      const d = drawn.get(one.boat.kind)!;
      if (!one.state || away(one.at, eye) < EVERY_FRAME || (id + this.frameNo) % FAR_SHARE === 0) { one.state = boatAt(this.habitat, one.boat, t); one.asked = t; }
      this.carry(one, t, one.level === 2 ? 0 : dt);
      if (one.state.sailing) this.sailing++;
      this.drawAt(one, d, frame);
    });
    const all = below ? 0 : this.ones.length;
    if (frame.written !== all) { this.holes += all - frame.written; this.holeFrames++; }
    for (const d of drawn.values()) for (const l of d.levels) {
      for (const m of [l.body, l.wake]) (m.geometry as InstancedBufferGeometry).instanceCount = l.count;
      sendInstances(l.buffer, l.count, BOAT_STRIDE);
    }
    drawSpecks(specks, frame.specks);
  }

  /**
   * Whether today's sailing is known, so the frame never waits for a day to be sailed: today's (before the boats are
   * first shown) and then tomorrow's are planned in a worker ahead of time. After a jump of the clock to a day not
   * planned, the boats sail it here as they are asked.
   */
  private planned(t: number): boolean {
    const h = this.habitat, today = dayNumber(h, t);
    if (!this.shown && !dayKnown(h, today)) { this.askDay(today); return false; }
    this.shown = true;
    if (!dayKnown(h, today + 1)) this.askDay(today + 1);
    return true;
  }

  /** Ask a worker for a day's sailing, once. */
  private askDay(day: number): void {
    if (this.planning.has(day)) return;
    this.planning.add(day);
    void this.pool.job({ kind: 'sailing', params: this.habitat.params, day }).then((a) => {
      this.planning.delete(day);
      if (!this.disposed && 'kind' in a && a.kind === 'sailing') keepDay(this.habitat, a.day, a.outings);
    });
  }

  /**
   * Put a boat where it was last asked to be, carried on along its way since: its waterline point, its bow eased round
   * to its heading, its heel to leeward, its wing set to the wind over it, its foils lifting it. `dt` 0: at once.
   */
  private carry(one: One, t: number, dt: number): void {
    const h = this.habitat, s = one.state!, spec = BOAT_KINDS[s.boat.kind], since = t - one.asked, way = (s.astern ? -s.speed : s.speed) * since;
    const theta = s.theta + (Math.sin(s.heading) * way) / h.radius, along = s.s + Math.cos(s.heading) * way;
    one.at = toWorld(h.profile, { theta, s: along, h: s.level });
    if (away(one.at, one.litAt) > LIGHT_MOVE) { one.horizon = horizonAt(this.terrain, theta, along); one.litAt = one.at; }
    // The wind over the boat (true less its own way), from where; the wing sets a little off it, to leeward, or
    // feathered into it at its berth and on its drive (free to turn all the way round its mast).
    const own = s.astern ? -s.speed : s.speed, au = s.wind.around - Math.sin(s.heading) * own, av = s.wind.along - Math.cos(s.heading) * own;
    const from = Math.atan2(-au, -av), off = Math.abs(angleDiff(s.heading, from)), feathered = !s.sailing || s.motoring;
    const wing = -s.tack * (feathered ? off : Math.max(0, Math.min(SHEETED_OUT, off - ATTACK))), roll = -s.tack * s.heel, lift = s.foiling && spec.foil ? spec.foil.lift : 0;
    const turn = turnFor(h.profile, along, s.heading);
    if (dt <= 0) { one.turn = turn; one.roll = roll; one.wing = wing; one.lift = lift; return; }
    one.turn = angleDiff(0, one.turn + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, angleDiff(one.turn, turn))));
    one.roll += (roll - one.roll) * Math.min(1, dt * HEEL_EASE);
    one.wing += angleDiff(one.wing, wing) * Math.min(1, dt * WING_EASE);
    one.lift += Math.max(-LIFT_RATE * dt, Math.min(LIFT_RATE * dt, lift - one.lift));
  }

  /** Write a placed boat at its level by its size on screen (a margin each way, so it does not flicker at the line). */
  private drawAt(one: One, d: Drawn, frame: Frame): void {
    const s = one.state!, size = Math.max(d.height, d.length), px = (size * frame.perMetre) / Math.max(1e-3, away(one.at, frame.eye));
    const level: Level = one.level === 0 ? (px >= NEAR_PX / BACK ? 0 : px >= SPECK_PX ? 1 : 2)
      : one.level === 1 ? (px >= NEAR_PX ? 0 : px >= SPECK_PX / BACK ? 1 : 2)
      : px >= NEAR_PX ? 0 : px >= SPECK_PX ? 1 : 2;
    one.level = level;
    this.counts[level]++;
    frame.written++;
    if (level === 2) {
      // Its wing over its hull, the patch as wide as the boat seen side on and as tall as its wing.
      writeSpeck(this.specks!.data, frame.specks++ * SPECK_STRIDE, one.at, d.height + one.lift, [0, 0, 0], POSE.upright, [d.wing, d.wing, one.hull], one.horizon, (d.length * 0.6) / (d.height * BODY_WIDTH));
      return;
    }
    const l = d.levels[level], top = BOAT_KINDS[s.boat.kind].top, share = Math.min(1, s.speed / top);
    writeBoat(l.data, l.count++ * BOAT_STRIDE, {
      at: toView(frame.eye, one.at), turn: one.turn, pitch: -SQUAT * share, roll: one.roll, wing: one.wing, lift: one.lift,
      livery: one.livery, foam: s.sailing && !s.astern ? Math.min(1, share * 1.6) * (one.lift > 0.3 ? 0.35 : 1) : 0, horizon: one.horizon, phase: one.phase, speed: share,
    });
  }

  /** A design's meshes given back. */
  private freeDesign(d: Drawn): void {
    for (const l of d.levels) for (const m of [l.body, l.wake]) freeMesh(m);
  }

  /** The boats as last placed, for the ears and the Go menu: where each is and what it is doing. */
  placed(): readonly BoatState[] {
    return this.ones.flatMap((o) => (o.state ? [o.state] : []));
  }

  /** Bytes held: the designs on the GPU and their instances, the far specks, the boats' state, the days' sailing kept (memory watchdog). */
  bytes(): number {
    const designs = [...(this.drawn?.values() ?? [])].reduce((n, d) => n + d.gpuBytes + d.levels.reduce((m, l) => m + l.data.byteLength, 0), 0);
    return designs + (this.specks ? this.specks.data.byteLength : 0) + this.ones.length * ONE_BYTES + sailingBytes(this.habitat);
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.drawn) return `boats: ${this.disposed ? 'gone' : sailingOf(this.habitat).boats.length ? 'designs being built' : 'none on this water'}`;
    const [near, coarse, specks] = this.counts;
    return `boats: ${this.ones.length}, ${this.sailing} under sail (${this.drawn.size} designs, built in ${this.slowest.toFixed(0)} ms) · ${near} near · ${coarse} coarse · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    const drawn = this.drawn, specks = this.specks;
    this.drawn = this.specks = null;
    for (const d of drawn?.values() ?? []) this.freeDesign(d);
    if (specks) freeMesh(specks.mesh);
    this.group.removeFromParent();
  }
}

