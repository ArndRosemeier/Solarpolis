/**
 * The birds of the land around the player (thread "Birds in the interior"; who lives where and what each does:
 * sim/birds.ts; their bodies: gen/birds.ts). Their homes round the eye are asked for in a worker every few seconds or
 * after a move; where each bird is and how it flies, every frame (`birdAt`). Every bird is drawn, at one of three
 * levels by how big it is on screen:
 *
 *   near     its whole body (the BIRD kind): single flight feathers beating, the hand lagging the arm, folding as it
 *            lands; the tail fanning, the beak opening as it sings, the head turning as it looks about;
 *   coarse   the same bird in a few dozen triangles, posed the same way, where it is under `NEAR_PX` across;
 *   speck    under `SPECK_PX`, the patch of screen it covers in its plumage's colours (the SPECK kind).
 *
 * All levels are written here in the same frame from the same place, and every species' body is on the GPU before any
 * bird is shown, so a bird changes level from one frame to the next and is never drawn by neither (CLAUDE.md, rule
 * 16; the debug line counts any that were: `holes`). At the edge of the homes asked for, where a bird is about a pixel,
 * its speck thins out over `FADE` before it leaves. The view also keeps the birds for the ears: their songs are the
 * calls heard (sim/sounds.ts `callsIn`).
 */
import { Group, InstancedInterleavedBuffer, Vector2, type Camera, type InstancedBufferGeometry, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hashToFloat, smoothstep } from '@futuremagic/core';
import { fromWorld, toView, type Habitat, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, writeSpeck } from '../gen/standIn';
import { BIRD_KINDS, BIRDS, bodyBytes, packedLooks, type BirdBody, type BirdKind, type BirdMesh, type PackedLook } from '../gen/birds';
import { birdAt, nestsBytes, type BirdDoing, type BirdNow, type Nest } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { BIRD, BIRD_LAYOUT, layInstances, roomForInstances } from './materials';
import { drawSpecks, ownSpecks, pxPerMetre, roomForSpecks, type OwnSpecks } from './specks';
import { BIRD_STRIDE, writeBird } from './birdShaders';
import { drawnAnywhere, dropUploaded, freeMesh, instancedOf, meshGeometry, sendInstances } from './geometry';

/** A bird is drawn whole from this many pixels across, coarse down to `SPECK_PX`, a speck below. Back up at `BACK` × each. */
const NEAR_PX = 40;
const SPECK_PX = 3;
const BACK = 1.2;
/** Homes are asked for out to here (m); again this often (s, real time) or after this move (m). */
const RANGE = 400;
const SCAN_EVERY = 4;
const SCAN_MOVE = 60;
/** Specks thin out from this distance to this one (m): beyond the second, a bird may leave with the next scan. */
const FADE: [number, number] = [250, RANGE - SCAN_MOVE - 20];
/** Higher than this over the ground (m) the open sky lights a bird; lower, the land's horizons, looked up again after `LIGHT_MOVE` m. */
const LOW = 40;
const LIGHT_MOVE = 10;
/** Room for this many birds of a species and level at first (doubled when more are near). */
const ROOM = 16;
/** What a bird does in the air. */
const AIRBORNE: ReadonlySet<BirdDoing> = new Set(['fly', 'climb', 'hover', 'drop']);

type Level = 0 | 1 | 2;
const LEVELS = ['near', 'coarse'] as const;

/** A species' two levels on the GPU, sharing nothing but the material. */
interface Drawn {
  body: BirdBody;
  looks: PackedLook[];
  levels: { mesh: Mesh; data: Float32Array; buffer: InstancedInterleavedBuffer; count: number }[];
  gpuBytes: number;
}

/** A bird around the eye, as last placed. */
interface One {
  nest: Nest;
  /** When the last scan saw its home. */
  seen: number;
  now: BirdNow | null;
  /** Its wingbeat's phase (rad), carried on frame to frame at its rate then. */
  phase: number;
  level: Level;
  horizon: [number, number];
  litAt: Vec3;
}

export class BirdView {
  readonly group = new Group();
  private drawn: Map<BirdKind, Drawn> | null = null;
  private specks: OwnSpecks | null = null;
  private readonly ones = new Map<number, One>();
  private readonly screen = new Vector2();
  private clock = 0;
  private lastScan = -Infinity;
  private scannedAt: Vec3 | null = null;
  private scanning = false;
  private scan = 0;
  private counts = [0, 0, 0];
  private singing = 0;
  private holes = 0;
  private holeFrames = 0;
  private slowest = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly pool: WorkerPool) {
    this.group.name = 'birds';
    void this.start();
  }

  /** Every species' body built in the workers, put on the GPU and compiled; then the birds are shown. */
  private async start(): Promise<void> {
    const b = this.habitat.params.life.birds;
    if (!(b.woods > 0 || b.larks > 0 || b.owls > 0)) return;
    const t0 = performance.now();
    const answers = await Promise.all(BIRD_KINDS.map((bird) => this.pool.job({ kind: 'bird', bird })));
    const bodies = answers.map((a) => ('kind' in a && a.kind === 'bird' ? a.body : null));
    this.slowest = performance.now() - t0;
    if (this.disposed || bodies.some((x) => !x)) return;
    const drawn = await Promise.all(bodies.map((body) => this.onGpu(body!)));
    const specks = ownSpecks('bird specks', 64);
    await this.stage.prepare(specks.mesh);
    if (this.disposed) { for (const d of drawn) for (const l of d.levels) freeMesh(l.mesh); freeMesh(specks.mesh); return; }
    this.specks = specks;
    for (const d of drawn) for (const l of d.levels) this.group.add(l.mesh);
    this.group.add(specks.mesh);
    this.drawn = new Map(drawn.map((d) => [d.body.kind, d]));
  }

  /** A species' two levels on the GPU, room for `ROOM` birds in each; the shapes' CPU copies let go. */
  private async onGpu(body: BirdBody): Promise<Drawn> {
    const levels = [body.near, body.coarse].map((m: BirdMesh, k) => {
      const g = instancedOf(meshGeometry(m.index, { position: [m.positions, 3], normal: [m.normals, 3], birdFolded: [m.folded, 3], birdPart: [m.part, 4], birdFiber: [m.fiber, 4] }));
      const data = new Float32Array(ROOM * BIRD_STRIDE), buffer = layInstances(g, data, BIRD_LAYOUT);
      g.instanceCount = 0;
      const mesh = drawnAnywhere(g, BIRD.material, `${body.kind} ${LEVELS[k]}`);
      mesh.castShadow = true;
      return { mesh, data, buffer, count: 0 };
    });
    await Promise.all(levels.map((l) => this.stage.prepare(l.mesh)));
    for (const l of levels) dropUploaded(l.mesh, this.stage.renderer, [...BIRD_LAYOUT.attributes]);
    return { body, looks: packedLooks(body.kind), levels, gpuBytes: bodyBytes(body) };
  }

  /** The birds round the eye now (their songs are the calls heard), as of the last scan. */
  nests: readonly Nest[] = [];

  /** Bring the birds up to clock time t (s) around the eye (world), drawn relative to it. `dt`: the frame's (s). */
  follow(eye: Vec3, t: number, dt: number, below = false): void {
    const drawn = this.drawn, specks = this.specks;
    if (!drawn || !specks) return;
    this.clock += dt;
    if (!this.scanning && (this.clock - this.lastScan > SCAN_EVERY || !this.scannedAt || away(eye, this.scannedAt) > SCAN_MOVE)) this.rescan(eye);
    for (const d of drawn.values()) for (const l of d.levels) l.count = 0;
    this.counts = [0, 0, 0];
    this.singing = 0;
    let written = 0, nSpecks = 0;
    if (!below) {
      // Room for everyone at any level.
      const per = new Map<BirdKind, number>();
      for (const one of this.ones.values()) per.set(one.nest.kind, (per.get(one.nest.kind) ?? 0) + 1);
      for (const [kind, n] of per) this.room(drawn.get(kind)!, n);
      roomForSpecks(specks, this.ones.size);
      const perMetre = pxPerMetre(this.stage, this.camera, this.screen);
      for (const one of this.ones.values()) {
        const b = birdAt(this.terrain, one.nest, t), d = drawn.get(one.nest.kind)!, spec = BIRDS[one.nest.kind];
        one.phase = (one.phase + 2 * Math.PI * b.beat * dt) % (2 * Math.PI * 1000);
        one.now = b;
        this.light(one, b);
        if (b.doing === 'sing') this.singing++;
        const distance = Math.max(1e-3, away(b.at, eye)), flying = b.fold < 0.5;
        const size = flying ? spec.span * one.nest.size : b.length, px = (size * perMetre) / distance;
        const level = levelFor(one.level, px);
        one.level = level;
        this.counts[level]++;
        written++;
        if (level === 2) {
          // The patch it covers: spread wings or a sitting body; thinning out toward the edge of what is asked for.
          const tall = b.length * (flying ? 0.3 : 0.55), across = flying ? size * 0.75 : b.length * 0.45;
          const fade = 1 - smoothstep(FADE[0], FADE[1], distance);
          const feet: Vec3 = [b.at[0] - b.up[0] * tall * 0.5, b.at[1] - b.up[1] * tall * 0.5, b.at[2] - b.up[2] * tall * 0.5];
          writeSpeck(specks.data, nSpecks++ * SPECK_STRIDE, feet, tall, [0, 0, 0], POSE.upright, d.looks[one.nest.look].bands, one.horizon, (fade * across) / (tall * BODY_WIDTH));
          continue;
        }
        const l = d.levels[level];
        writeBird(l.data, l.count++ * BIRD_STRIDE, {
          at: toView(eye, b.at), length: b.length, fwd: b.fwd, up: b.up, fold: b.fold, phase: one.phase, amp: b.amp, bias: b.bias, spread: b.spread,
          gape: b.gape, yaw: b.yaw, nod: b.nod, tuck: b.fold < 0.5 ? smoothstep(1, 3, b.speed) : 0, horizon: one.horizon, look: d.looks[one.nest.look],
        });
      }
      if (written !== this.ones.size) { this.holes += this.ones.size - written; this.holeFrames++; }
    }
    for (const d of drawn.values()) for (const l of d.levels) {
      (l.mesh.geometry as InstancedBufferGeometry).instanceCount = l.count;
      sendInstances(l.buffer, l.count, BIRD_STRIDE);
    }
    drawSpecks(specks, nSpecks);
  }

  /** Ask a worker for the birds around the eye; newcomers in (as they are now), those out of range out. */
  private rescan(eye: Vec3): void {
    const h = this.habitat, at = fromWorld(h.profile, ...eye);
    this.scanning = true;
    this.lastScan = this.clock;
    this.scannedAt = eye;
    void this.pool.job({ kind: 'birds', params: h.params, theta: at.theta, s: at.s, radius: RANGE }).then((a) => {
      this.scanning = false;
      if (this.disposed || !('kind' in a) || a.kind !== 'birds') return;
      this.scan++;
      for (const nest of a.nests) {
        const known = this.ones.get(nest.id);
        if (known) known.seen = this.scan;
        else this.ones.set(nest.id, { nest, seen: this.scan, now: null, phase: 2 * Math.PI * hashToFloat(nest.seed), level: 2, horizon: [OPEN_SKY, OPEN_SKY], litAt: [Infinity, 0, 0] });
      }
      for (const [id, one] of this.ones) if (one.seen !== this.scan) this.ones.delete(id);
      this.nests = [...this.ones.values()].map((o) => o.nest);
    }, () => { this.scanning = false; });
  }

  /** The light where a bird is: high up the open sky's, lower the land's horizons there (looked up again as it moves on). */
  private light(one: One, b: BirdNow): void {
    if (away(b.at, one.litAt) < LIGHT_MOVE) return;
    const p = fromWorld(this.habitat.profile, ...b.at);
    one.horizon = p.h - this.terrain.standAt(p.theta, p.s) > LOW ? [OPEN_SKY, OPEN_SKY] : horizonAt(this.terrain, p.theta, p.s);
    one.litAt = b.at;
  }

  /** Room in both of a species' levels for `need` birds: new instances on the same meshes, so nothing is compiled again. */
  private room(d: Drawn, need: number): void {
    for (const l of d.levels) roomForInstances(l, need, BIRD_LAYOUT, [l.mesh.geometry]);
  }

  /**
   * The nearest bird to the eye (debug menu: fly to it): where it is, its up and forward, its length. Birds out come
   * before birds at roost; with `still`, birds sitting, singing or feeding on the ground before birds in the air (one
   * stays in sight a while).
   */
  nearest(eye: Vec3, kind?: BirdKind, still = false): { at: Vec3; up: Vec3; fwd: Vec3; length: number } | null {
    const rank = (b: BirdNow): number => (b.doing === 'roost' ? 2 : still && AIRBORNE.has(b.doing) ? 1 : 0);
    let best: BirdNow | null = null;
    for (const one of this.ones.values()) {
      const b = one.now;
      if (!b || (kind && b.kind !== kind)) continue;
      if (!best || rank(b) < rank(best) || (rank(b) === rank(best) && away(b.at, eye) < away(best.at, eye))) best = b;
    }
    return best && { at: best.at, up: best.up, fwd: best.fwd, length: best.length };
  }

  /** Bytes held: the bodies on the GPU, the instances, the birds' homes (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + nestsBytes(this.nests) + this.ones.size * 120;
    for (const d of this.drawn?.values() ?? []) { n += d.gpuBytes; for (const l of d.levels) n += l.data.byteLength; }
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.drawn) return `birds: ${this.disposed ? 'gone' : 'bodies being built'}`;
    const [near, coarse, specks] = this.counts, by = new Map<string, number>();
    for (const one of this.ones.values()) by.set(one.nest.kind, (by.get(one.nest.kind) ?? 0) + 1);
    const kinds = [...by].map(([k, n]) => `${n} ${k}`).join(', ');
    return `birds: ${this.ones.size} round the eye (${kinds || 'none'}; bodies built in ${this.slowest.toFixed(0)} ms) · ${this.singing} singing · ${near} near · ${coarse} coarse · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.drawn?.values() ?? []) for (const l of d.levels) freeMesh(l.mesh);
    if (this.specks) freeMesh(this.specks.mesh);
    this.drawn = null;
    this.specks = null;
    this.ones.clear();
    this.nests = [];
    this.group.removeFromParent();
  }
}

/** The level for a bird `px` across on screen, from the level it had (a margin each way, so it does not flicker at the line). */
function levelFor(was: Level, px: number): Level {
  if (was === 0) return px >= NEAR_PX / BACK ? 0 : px >= SPECK_PX ? 1 : 2;
  if (was === 1) return px >= NEAR_PX ? 0 : px >= SPECK_PX / BACK ? 1 : 2;
  return px >= NEAR_PX ? 0 : px >= SPECK_PX ? 1 : 2;
}
