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
import { hashToFloat, smoothstep, v3madd } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, writeSpeck } from '../gen/standIn';
import { BIRD_KINDS, BIRDS, bodyBytes, packedLooks, type BirdBody, type BirdKind, type BirdMesh, type PackedLook } from '../gen/birds';
import { birdAt, flockNoise, flocksBytes, memberAt, memberOf, memberWhere, murmurAt, nestsBytes, roostAt, upOf, type BirdDoing, type BirdNow, type Flock, type FlockKind, type Nest } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { HEARD_WITHIN, type Source } from '../sim/sources';
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
/** Flocks are asked for out to here (m; a starling's roost a little farther, as its birds go far); again this often (s) or after this move (m). */
const FLOCK_RANGE = 7500;
const FLOCK_SCAN_EVERY = 10;
const FLOCK_SCAN_MOVE = 400;
/**
 * Each flock's specks thin out from this distance to this one (m): a swallow is a pixel at about 300 m, a swift a little
 * farther, and a murmuration of thousands still a smudge on the sky some kilometres off.
 */
const FLOCK_FADE: Readonly<Record<FlockKind, [number, number]>> = { swallow: [900, 1200], swift: [1500, 2000], starling: [FLOCK_RANGE - 1500, FLOCK_RANGE] };

/**
 * A flock's speck is placed again once it may have moved this many pixels (it covers less than one, so nothing shows
 * of the wait); a bird in the air is taken to fly at most `AIR_FAST`, one settled to move at most `STILL_FAST` (m/s), and
 * none waits longer than `SPECK_WAIT` (s). Thousands of far starlings need not all be placed every frame.
 */
const SPECK_STEP = 0.35;
const AIR_FAST = 25;
const STILL_FAST = 0.5;
const SPECK_WAIT = 1;
/** A coarse flock bird's pose is worked out again this often (s, about; each bird its own phase). */
const COARSE_POSE = 0.1;

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

/** A flock around the eye, as last placed: per bird its look, level, wingbeat, light and where it was this frame. */
interface FlockOne {
  flock: Flock;
  seen: number;
  size: Float32Array;
  look: Uint8Array;
  level: Uint8Array;
  phase: Float32Array;
  horizon: Float32Array;
  litAt: Float32Array;
  /** This frame: where each bird is (world; its feet when settled), whether it is in the air, whether it is shown at all. */
  at: Float32Array;
  air: Uint8Array;
  shown: Uint8Array;
  /** When a speck's place is next worked out (the view's clock, s): a far bird moves less than `SPECK_STEP` px in between. */
  due: Float64Array;
  /** The coarse birds' poses as last worked out, and when to work each out again (the view's clock, s). */
  poses: Map<number, { now: BirdNow; due: number }>;
  /** Its home in the world, and the land's horizons there (its birds on the ground or in the trees are lit by them). */
  home: Vec3;
  ground: [number, number];
}

/** A bird (or a murmuration's middle) found for the debug menu: where it is, its up and forward, and where it is now. */
export interface BirdSeen { at: Vec3; up: Vec3; fwd: Vec3; track: () => { at: Vec3; up: Vec3; fwd: Vec3 } }

export class BirdView {
  readonly group = new Group();
  private drawn: Map<BirdKind, Drawn> | null = null;
  private specks: OwnSpecks | null = null;
  private readonly ones = new Map<number, One>();
  private readonly flocks = new Map<number, FlockOne>();
  private lastFlockScan = -Infinity;
  private flocksAt: Vec3 | null = null;
  private flockScanning = false;
  private flockScan = 0;
  private lastTime = 0;
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
    if (!(b.woods > 0 || b.larks > 0 || b.owls > 0 || b.swallows > 0 || b.swifts > 0 || b.starlings > 0)) return;
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
    this.lastTime = t;
    if (!this.scanning && (this.clock - this.lastScan > SCAN_EVERY || !this.scannedAt || away(eye, this.scannedAt) > SCAN_MOVE)) this.rescan(eye);
    if (!this.flockScanning && (this.clock - this.lastFlockScan > FLOCK_SCAN_EVERY || !this.flocksAt || away(eye, this.flocksAt) > FLOCK_SCAN_MOVE)) this.rescanFlocks(eye);
    for (const d of drawn.values()) for (const l of d.levels) l.count = 0;
    this.counts = [0, 0, 0];
    this.singing = 0;
    let written = 0, shown = 0, nSpecks = 0;
    if (!below) {
      const perMetre = pxPerMetre(this.stage, this.camera, this.screen);
      // Room for everyone at any level; the flocks' birds as many as are near or coarse now (where each is, first).
      const per = new Map<BirdKind, number>();
      for (const one of this.ones.values()) per.set(one.nest.kind, (per.get(one.nest.kind) ?? 0) + 1);
      let flockSpecks = 0;
      for (const fo of this.flocks.values()) {
        const n = this.placeFlock(fo, eye, t, perMetre);
        per.set(fo.flock.kind, (per.get(fo.flock.kind) ?? 0) + n.posed);
        flockSpecks += n.specks;
      }
      for (const [kind, n] of per) this.room(drawn.get(kind)!, n);
      roomForSpecks(specks, this.ones.size + flockSpecks);
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
        shown++;
        if (level === 2) {
          // The patch it covers: spread wings or a sitting body; thinning out toward the edge of what is asked for.
          writeBirdSpeck(specks.data, nSpecks++, b.at, b.up, b.length, size, flying, 1 - smoothstep(FADE[0], FADE[1], distance), d.looks[one.nest.look], one.horizon);
          continue;
        }
        this.pose(d, level, eye, b, one.phase, one.horizon, d.looks[one.nest.look]);
      }
      for (const fo of this.flocks.values()) {
        const f = fo.flock, d = drawn.get(f.kind)!, fade = FLOCK_FADE[f.kind];
        for (let m = 0; m < f.count; m++) {
          if (!fo.shown[m]) continue;
          shown++;
          const level = fo.level[m] as Level;
          this.counts[level]++;
          written++;
          const look = d.looks[fo.look[m]], at: Vec3 = [fo.at[m * 3], fo.at[m * 3 + 1], fo.at[m * 3 + 2]];
          if (level === 2) {
            const spec = BIRDS[f.kind], length = spec.length * fo.size[m], air = !!fo.air[m];
            const horizon: [number, number] = air ? [OPEN_SKY, OPEN_SKY] : fo.ground;
            // A settled bird's place is its feet: its body is about half its length above them.
            const middle = air ? at : v3madd(at, upOf(at), length * 0.27);
            fo.poses.delete(m);
            writeBirdSpeck(specks.data, nSpecks++, middle, upOf(at), length, air ? spec.span * fo.size[m] : length, air, 1 - smoothstep(fade[0], fade[1], away(at, eye)), look, horizon);
            continue;
          }
          const b = this.posedNow(fo, m, at, level, t);
          fo.phase[m] = (fo.phase[m] + 2 * Math.PI * b.beat * dt) % (2 * Math.PI * 1000);
          this.pose(d, level, eye, b, fo.phase[m], this.flockLight(fo, m, b), look);
        }
      }
      if (written !== shown) { this.holes += shown - written; this.holeFrames++; }
    }
    for (const d of drawn.values()) for (const l of d.levels) {
      (l.mesh.geometry as InstancedBufferGeometry).instanceCount = l.count;
      sendInstances(l.buffer, l.count, BIRD_STRIDE);
    }
    drawSpecks(specks, nSpecks);
  }

  /** A posed bird written at its level (near or coarse), relative to the eye. */
  private pose(d: Drawn, level: 0 | 1, eye: Vec3, b: BirdNow, phase: number, horizon: readonly [number, number], look: PackedLook): void {
    const l = d.levels[level];
    writeBird(l.data, l.count++ * BIRD_STRIDE, {
      at: toView(eye, b.at), length: b.length, fwd: b.fwd, up: b.up, fold: b.fold, phase, amp: b.amp, bias: b.bias, spread: b.spread,
      gape: b.gape, yaw: b.yaw, nod: b.nod, tuck: b.fold < 0.5 ? smoothstep(1, 3, b.speed) : 0, horizon: [horizon[0], horizon[1]], look,
    });
  }

  /**
   * Where each of a flock's birds is this frame, which are shown (within its fade) and at what level each is drawn: how
   * many are posed (near or coarse) and how many are specks. A flock all of whose birds are too far is skipped whole.
   */
  private placeFlock(fo: FlockOne, eye: Vec3, t: number, perMetre: number): { posed: number; specks: number } {
    const f = fo.flock, spec = BIRDS[f.kind], fade = FLOCK_FADE[f.kind];
    let posed = 0, specks = 0;
    fo.shown.fill(0);
    if (away(fo.home, eye) > fade[1] + f.reach + 500) return { posed, specks };
    for (let m = 0; m < f.count; m++) {
      let distance: number;
      if (fo.level[m] === 2 && this.clock < fo.due[m]) distance = Math.max(1e-3, Math.hypot(fo.at[m * 3] - eye[0], fo.at[m * 3 + 1] - eye[1], fo.at[m * 3 + 2] - eye[2]));
      else {
        const w = memberWhere(this.terrain, f, m, t);
        distance = Math.max(1e-3, away(w.at, eye));
        fo.at[m * 3] = w.at[0]; fo.at[m * 3 + 1] = w.at[1]; fo.at[m * 3 + 2] = w.at[2];
        fo.air[m] = w.air ? 1 : 0;
        fo.due[m] = this.clock + Math.min(SPECK_WAIT, (SPECK_STEP * distance) / ((w.air ? AIR_FAST : STILL_FAST) * perMetre));
      }
      if (distance > fade[1]) { fo.level[m] = 2; continue; }
      fo.shown[m] = 1;
      const px = ((fo.air[m] ? spec.span : spec.length) * fo.size[m] * perMetre) / distance, level = levelFor(fo.level[m] as Level, px);
      fo.level[m] = level;
      if (level === 2) specks++; else posed++;
    }
    return { posed, specks };
  }

  /**
   * A flock's bird posed at clock time t: near, worked out every frame; coarse (a few pixels to `NEAR_PX` across), its
   * pose worked out every `COARSE_POSE` s and carried to where it is now in between (it banks and turns no faster than
   * that shows at its size), so a murmuration all round the eye stays cheap.
   */
  private posedNow(fo: FlockOne, m: number, at: Vec3, level: 0 | 1, t: number): BirdNow {
    const kept = fo.poses.get(m);
    if (level === 1 && kept && this.clock < kept.due) return fo.air[m] && kept.now.fold < 0.5 ? { ...kept.now, at } : kept.now;
    const now = memberAt(this.terrain, fo.flock, m, t);
    fo.poses.set(m, { now, due: this.clock + COARSE_POSE * (0.5 + hashToFloat(m)) });
    return now;
  }

  /** The light on a flock's bird as `light` gives it for a single bird, kept per bird. */
  private flockLight(fo: FlockOne, m: number, b: BirdNow): [number, number] {
    const was: Vec3 = [fo.litAt[m * 3], fo.litAt[m * 3 + 1], fo.litAt[m * 3 + 2]];
    if (!Number.isNaN(was[0]) && away(b.at, was) < LIGHT_MOVE) return [fo.horizon[m * 2], fo.horizon[m * 2 + 1]];
    const p = fromWorld(this.habitat.profile, ...b.at);
    const horizon = p.h - this.terrain.standAt(p.theta, p.s) > LOW ? [OPEN_SKY, OPEN_SKY] : horizonAt(this.terrain, p.theta, p.s);
    fo.horizon[m * 2] = horizon[0]; fo.horizon[m * 2 + 1] = horizon[1];
    fo.litAt.set(b.at, m * 3);
    return [horizon[0], horizon[1]];
  }

  /** Ask a worker for the flocks around the eye; newcomers in (their birds as specks till placed), those out of range out. */
  private rescanFlocks(eye: Vec3): void {
    const h = this.habitat, at = fromWorld(h.profile, ...eye);
    this.flockScanning = true;
    this.lastFlockScan = this.clock;
    this.flocksAt = eye;
    void this.pool.job({ kind: 'flocks', params: h.params, theta: at.theta, s: at.s, radius: FLOCK_RANGE }).then((a) => {
      this.flockScanning = false;
      if (this.disposed || !('kind' in a) || a.kind !== 'flocks') return;
      this.flockScan++;
      for (const flock of a.flocks) {
        const known = this.flocks.get(flock.id);
        if (known) { known.seen = this.flockScan; continue; }
        const n = flock.count, size = new Float32Array(n), look = new Uint8Array(n), phase = new Float32Array(n);
        for (let m = 0; m < n; m++) { const who = memberOf(flock, m); size[m] = who.size; look[m] = who.look; phase[m] = 2 * Math.PI * hashToFloat(who.seed); }
        const home = toWorld(h.profile, { theta: flock.theta, s: flock.s, h: 0 });
        this.flocks.set(flock.id, {
          flock, seen: this.flockScan, size, look, level: new Uint8Array(n).fill(2), phase, horizon: new Float32Array(2 * n).fill(OPEN_SKY), litAt: new Float32Array(3 * n).fill(NaN),
          at: new Float32Array(3 * n), air: new Uint8Array(n), shown: new Uint8Array(n), due: new Float64Array(n), poses: new Map(), home, ground: horizonAt(this.terrain, flock.theta, flock.s),
        });
      }
      for (const [id, fo] of this.flocks) if (fo.seen !== this.flockScan) this.flocks.delete(id);
      this.flockList = [...this.flocks.values()].map((o) => o.flock);
    }, () => { this.flockScanning = false; });
  }

  /** The flocks round the eye now (their calls are heard), as of the last scan. */
  flockList: readonly Flock[] = [];

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
   * stays in sight a while). The flocks' birds count too, as placed this frame.
   */
  nearest(eye: Vec3, kind?: BirdKind, still = false): BirdSeen | null {
    const rank = (doing: BirdDoing): number => (doing === 'roost' ? 2 : still && AIRBORNE.has(doing) ? 1 : 0);
    let best: { doing: BirdDoing; track: () => BirdNow } | null = null, bestRank = 3, bestAway = Infinity;
    const offer = (doing: BirdDoing, at: Vec3, track: () => BirdNow): void => {
      const r = rank(doing), d = away(at, eye);
      if (r < bestRank || (r === bestRank && d < bestAway)) { best = { doing, track }; bestRank = r; bestAway = d; }
    };
    for (const one of this.ones.values()) {
      const b = one.now;
      if (b && (!kind || b.kind === kind)) offer(b.doing, b.at, () => one.now ?? b);
    }
    for (const fo of this.flocks.values()) {
      if (kind && fo.flock.kind !== kind) continue;
      // Each bird where it is now (not where it was last drawn: a far one is placed only now and then).
      for (let m = 0; m < fo.flock.count; m++) {
        const w = memberWhere(this.terrain, fo.flock, m, this.lastTime);
        offer(w.doing, w.at, () => memberAt(this.terrain, fo.flock, m, this.lastTime));
      }
    }
    const found = best as { track: () => BirdNow } | null;
    if (!found) return null;
    const track = (): { at: Vec3; up: Vec3; fwd: Vec3 } => { const b = found.track(); return { at: b.at, up: b.up, fwd: b.fwd }; };
    return { ...track(), track };
  }

  /**
   * The nearest murmuration in the air (debug menu: fly to it): its middle, its up and a way along the axis, and how to
   * keep up with it; or none.
   */
  murmuration(eye: Vec3): BirdSeen | null {
    let best: Flock | null = null, bestAway = Infinity;
    for (const fo of this.flocks.values()) {
      const f = fo.flock;
      if (f.kind !== 'starling' || flockNoise(this.habitat, f, this.lastTime).wings <= 0) continue;
      const d = away(murmurAt(this.habitat, f, this.lastTime)!.at, eye);
      if (d < bestAway) { best = f; bestAway = d; }
    }
    const f = best as Flock | null;
    if (!f) return null;
    const track = (): { at: Vec3; up: Vec3; fwd: Vec3 } => { const at = murmurAt(this.habitat, f, this.lastTime)!.at; return { at, up: upOf(at), fwd: [0, 0, 1] }; };
    return { ...track(), track };
  }

  /**
   * What the flocks round the eye make heard now (sim/sources.ts): a starling flock's wings and chatter from its
   * murmuration, or its chatter from its roost; each from the point of the flock nearest the eye (thousands of birds
   * sound from all over it), within `HEARD_WITHIN.flock` of it.
   */
  heard(eye: Vec3, t: number, out: Source[]): void {
    const h = this.habitat;
    for (const fo of this.flocks.values()) {
      const f = fo.flock, noise = flockNoise(h, f, t);
      if (noise.wings <= 0 && noise.chatter <= 0) continue;
      const murmur = noise.wings > 0 ? murmurAt(h, f, t) : null, middle = murmur?.at ?? roostAt(h, f), reach = murmur?.reach ?? 40;
      const d = away(middle, eye), toward = d > reach * 0.8 ? v3madd(middle, [eye[0] - middle[0], eye[1] - middle[1], eye[2] - middle[2]], (reach * 0.8) / d) : eye;
      if (away(toward, eye) > HEARD_WITHIN.flock) continue;
      const p = fromWorld(h.profile, ...toward);
      const voice = (k: number, doing: string, loud: number): void => {
        if (loud > 0) out.push({ key: f.id * 2 + k, kind: 'flock', theta: p.theta, s: p.s, h: p.h, at: toward, speed: 0, doing, began: 0, birds: f.count, loud });
      };
      voice(0, 'wings', noise.wings);
      voice(1, 'chatter', noise.chatter);
    }
  }

  /** Bytes held: the bodies on the GPU, the instances, the birds' homes and the flocks with their birds' state (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + nestsBytes(this.nests) + this.ones.size * 120 + flocksBytes(this.flockList);
    for (const fo of this.flocks.values()) n += fo.size.byteLength + fo.look.byteLength + fo.level.byteLength + fo.phase.byteLength + fo.horizon.byteLength + fo.litAt.byteLength + fo.at.byteLength + fo.air.byteLength + fo.shown.byteLength + fo.due.byteLength;
    for (const d of this.drawn?.values() ?? []) { n += d.gpuBytes; for (const l of d.levels) n += l.data.byteLength; }
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.drawn) return `birds: ${this.disposed ? 'gone' : 'bodies being built'}`;
    const [near, coarse, specks] = this.counts, by = new Map<string, number>();
    for (const one of this.ones.values()) by.set(one.nest.kind, (by.get(one.nest.kind) ?? 0) + 1);
    const kinds = [...by].map(([k, n]) => `${n} ${k}`).join(', ');
    const flocks = [...this.flocks.values()].map((fo) => `${fo.flock.count} ${fo.flock.kind}s (${fo.shown.reduce((a, x) => a + x, 0)} in sight)`).join(', ');
    return `birds: ${this.ones.size} round the eye (${kinds || 'none'}; bodies built in ${this.slowest.toFixed(0)} ms) · flocks: ${flocks || 'none'} · ${this.singing} singing · ${near} near · ${coarse} coarse · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.drawn?.values() ?? []) for (const l of d.levels) freeMesh(l.mesh);
    if (this.specks) freeMesh(this.specks.mesh);
    this.drawn = null;
    this.specks = null;
    this.ones.clear();
    this.flocks.clear();
    this.nests = [];
    this.flockList = [];
    this.group.removeFromParent();
  }
}

/**
 * A bird as a speck (`index`-th): the patch of screen it covers, spread wings (`size` across) or a sitting body, round its
 * middle with up `up`; `fade` thins it out toward the edge of what is asked for.
 */
function writeBirdSpeck(data: Float32Array, index: number, middle: Vec3, up: Vec3, length: number, size: number, flying: boolean, fade: number, look: PackedLook, horizon: readonly [number, number]): void {
  const tall = length * (flying ? 0.3 : 0.55), across = flying ? size * 0.75 : length * 0.45;
  const feet = v3madd(middle, up, -tall * 0.5);
  writeSpeck(data, index * SPECK_STRIDE, feet, tall, [0, 0, 0], POSE.upright, look.bands, horizon, (fade * across) / (tall * BODY_WIDTH));
}

/** The level for a bird `px` across on screen, from the level it had (a margin each way, so it does not flicker at the line). */
function levelFor(was: Level, px: number): Level {
  if (was === 0) return px >= NEAR_PX / BACK ? 0 : px >= SPECK_PX ? 1 : 2;
  if (was === 1) return px >= NEAR_PX ? 0 : px >= SPECK_PX / BACK ? 1 : 2;
  return px >= NEAR_PX ? 0 : px >= SPECK_PX ? 1 : 2;
}
