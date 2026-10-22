/**
 * The animals on the land around the player (design "Who is out on the land"; who and where: sim/fauna.ts). Squirrels,
 * at two levels by their size on screen:
 *
 *   figures   the nearest few, Actors animals (render/actors/animal.ts) in their looks, their coats baked in a worker
 *             (gen/coat.ts), compiled at both of Actors' levels that draw parts separately before they are shown, and
 *             posed every frame from the simulation: hopping and running at the speed they go, foraging, sitting up;
 *   specks    everyone else out to where a squirrel is under a pixel: the patch of screen its body covers (the SPECK
 *             kind), in its coat's colours (top, middle and bottom thirds).
 *
 * A figure takes over from its speck only in the frame it is first drawn, and gives it back the same way (CLAUDE.md,
 * rule 16): every squirrel down on the ground is drawn by one level each frame (the debug line counts `holes`). The
 * squirrels whose trees stand around the eye are asked for in a worker every few seconds or after a move; where each
 * is, every frame (`squirrelAt`). Up in its tree, a squirrel is not drawn.
 */
import { Group, Vector2, type Camera } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, writeSpeck } from '../gen/standIn';
import type { Coats } from '../gen/coat';
import { densBytes, squirrelAt, type Den, type Squirrel } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { freeMesh } from './geometry';
import { drawSpecks, ownSpecks, pxPerMetre, roomForSpecks, type OwnSpecks } from './specks';
import { turnFor } from './people';
import { AnimalFigure, AnimalPack, animalPack } from './actors/animal';
import { FigureLoads, type FigureSlot } from './actors/slots';

/** The squirrels' pack, and their looks (Actors' presets) with how common each is. */
const PACK = 'squirrel';
const LOOKS: readonly [string, number][] = [['grey', 0.45], ['red', 0.3], ['fox', 0.15], ['black', 0.1]];
/** How much one squirrel's size differs from its look's (± share). */
const SIZES = 0.08;
/** Squirrels are asked for out to here (m): where one is under a pixel; again this often (s, real time) or after this move (m). */
const RANGE = 250;
const SCAN_EVERY = 3;
const SCAN_MOVE = 60;
/** Figures: how many at most, given to squirrels at least this tall on screen (px), and given back below `FIGURE_BACK` times that. */
const FIGURES = 6;
const FIGURE_PX = 14;
const FIGURE_BACK = 0.75;
/** A squirrel's light (the terrain's horizons where it is) is looked up again once it is this far on (m). */
const LIGHT_MOVE = 10;
/**
 * How far a squirrel goes in one cycle of its hop and its run, in body lengths (its gait: bounds of about two body
 * lengths, leaps of four and a half), so its clip plays as fast as it goes.
 */
const STRIDE = { hop: 2.2, run: 4.5 } as const;
/** How much of a speck's width a squirrel's length counts for, seen from any side. */
const SEEN_LENGTH = 0.7;

/** A squirrel around the eye, as last placed. */
interface One {
  den: Den;
  /** Its look (index into `LOOKS`) and its size (× the look's). */
  look: number;
  size: number;
  now: Squirrel | null;
  feet: Vec3;
  up: Vec3;
  front: Vec3;
  horizon: [number, number];
  litAt: Vec3;
  /** Its figure: loading, or drawn in place of its speck. */
  figure: FigureSlot<AnimalFigure> | null;
  seen: number;
}

export class AnimalView {
  readonly group = new Group();
  private pack: AnimalPack | null = null;
  private coats: Coats | null = null;
  private specks: OwnSpecks | null = null;
  private readonly ones = new Map<number, One>();
  private readonly screen = new Vector2();
  private clock = 0;
  private lastScan = -Infinity;
  private scannedAt: Vec3 | null = null;
  private scanning = false;
  private scan = 0;
  private readonly loads = new FigureLoads<AnimalFigure>(() => this.disposed);
  private counts = { figures: 0, specks: 0, up: 0 };
  private holes = 0;
  private holeFrames = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly pool: WorkerPool) {
    this.group.name = 'animals';
    void this.start();
  }

  /** The pack (its shape worker), the looks' coats baked in a worker, and the specks' mesh. */
  private async start(): Promise<void> {
    if (!(this.habitat.params.life.animals.squirrels > 0)) return;
    const manifest = new URL(animalPack(PACK), location.href).href;
    const specks = ownSpecks('animal specks', 64);
    const [pack, answer] = await Promise.all([
      AnimalPack.load(PACK),
      this.pool.job({ kind: 'coats', ask: { manifest, animal: PACK, presets: LOOKS.map(([p]) => p) } }),
      this.stage.prepare(specks.mesh),
    ]);
    if (this.disposed || !('kind' in answer) || answer.kind !== 'coats') { freeMesh(specks.mesh); return; }
    this.pack = pack;
    this.coats = answer.coats;
    this.specks = specks;
    this.group.add(specks.mesh);
  }

  /** Bring the squirrels up to clock time t (s) around the eye (world), drawn relative to it. `dt`: the frame's (s). */
  follow(eye: Vec3, t: number, dt: number): void {
    if (!this.coats || !this.specks) return;
    this.clock += dt;
    if (!this.scanning && (this.clock - this.lastScan > SCAN_EVERY || !this.scannedAt || away(eye, this.scannedAt) > SCAN_MOVE)) this.rescan(eye);
    for (const one of this.ones.values()) this.place(one, t);
    this.figures(eye);
    this.show(eye);
  }

  /** Ask a worker for the squirrels around the eye; newcomers in, those whose trees are out of range out. */
  private rescan(eye: Vec3): void {
    const h = this.habitat, at = fromWorld(h.profile, ...eye);
    this.scanning = true;
    this.lastScan = this.clock;
    this.scannedAt = eye;
    void this.pool.job({ kind: 'squirrels', params: h.params, theta: at.theta, s: at.s, radius: RANGE }).then((a) => {
      this.scanning = false;
      if (this.disposed || !('kind' in a) || a.kind !== 'squirrels') return;
      this.scan++;
      for (const den of a.dens) {
        const known = this.ones.get(den.id);
        if (known) { known.seen = this.scan; continue; }
        const pick = hashToFloat(hash3i(den.seed, 31, 0, 0));
        let look = 0;
        for (let acc = LOOKS[0][1]; look < LOOKS.length - 1 && pick >= acc; acc += LOOKS[++look][1]);
        this.ones.set(den.id, {
          den, look, size: 1 + SIZES * (2 * hashToFloat(hash3i(den.seed, 32, 0, 0)) - 1), now: null,
          feet: [0, 0, 0], up: [0, 0, 1], front: [1, 0, 0], horizon: [OPEN_SKY, OPEN_SKY], litAt: [Infinity, 0, 0], figure: null, seen: this.scan,
        });
      }
      for (const [id, one] of this.ones) if (one.seen !== this.scan) { this.loads.drop(one.figure); this.ones.delete(id); }
    }, () => { this.scanning = false; });
  }

  /** Where a squirrel is now: on the ground, facing its way, lit by the horizons there. */
  private place(one: One, t: number): void {
    const q = squirrelAt(this.terrain, one.den, t);
    one.now = q;
    if (!q) return;
    const { profile } = this.habitat, feet = toWorld(profile, { theta: q.theta, s: q.s, h: this.terrain.standAt(q.theta, q.s) });
    const r = Math.hypot(feet[0], feet[1]) || 1, up: Vec3 = [-feet[0] / r, -feet[1] / r, 0];
    const turn = turnFor(profile, q.s, q.heading), side: Vec3 = [up[1], -up[0], 0], c = Math.cos(turn), sn = Math.sin(turn);
    one.front = [-side[0] * sn, -side[1] * sn, c];
    one.feet = feet;
    one.up = up;
    if (away(feet, one.litAt) > LIGHT_MOVE) { one.horizon = horizonAt(this.terrain, q.theta, q.s); one.litAt = feet; }
  }

  /** A squirrel's height on its body (m): its look's size, its own, the pack's body. */
  private heightOf(one: One): number {
    const c = this.coats!;
    return c.height * c.looks[one.look].size * one.size;
  }

  /** Give the nearest squirrels big enough on screen figures, one loading at a time; take them from those gone small or up. */
  private figures(eye: Vec3): void {
    const perMetre = pxPerMetre(this.stage, this.camera, this.screen), pack = this.pack!, coats = this.coats!;
    const pxOf = (one: One): number => (this.heightOf(one) * perMetre) / Math.max(1e-3, away(one.feet, eye));
    const wanted = [...this.ones.values()].filter((one) => one.now && pxOf(one) >= FIGURE_PX).sort((a, b) => away(a.feet, eye) - away(b.feet, eye));
    const keep = new Set(wanted.slice(0, FIGURES));
    let count = 0;
    for (const one of this.ones.values()) {
      if (!one.figure) continue;
      if (!one.now || (!keep.has(one) && pxOf(one) < FIGURE_PX * FIGURE_BACK) || (!keep.has(one) && count >= FIGURES)) { this.loads.drop(one.figure); one.figure = null; }
      else count++;
    }
    if (this.loads.loading > 0 || count >= FIGURES) return;
    const next = wanted.find((one) => !one.figure);
    if (next) next.figure = this.loads.load(() => this.loadFigure(pack, coats, next));
  }

  /** A squirrel's figure, compiled at both its levels, not yet in the scene. */
  private async loadFigure(pack: AnimalPack, coats: Coats, one: One): Promise<AnimalFigure | null> {
    const f = await AnimalFigure.load(pack, coats.looks[one.look], coats.fur, one.size);
    if (this.disposed) { f.dispose(); return null; }
    for (const level of [...f.levels].reverse()) {
      f.actor.setLod(level);
      await this.stage.prepare(f.object, { everyCaster: true });
    }
    return f;
  }

  /** Its clip and where in it, from what it does: hopping and running as fast as it goes. */
  private clipOf(one: One, q: Squirrel): { clip: string; time: number } {
    if (q.doing !== 'hop' && q.doing !== 'run') return { clip: q.doing, time: q.since };
    const length = this.coats!.length * this.coats!.looks[one.look].size * one.size;
    const cycles = (q.speed * q.since) / (STRIDE[q.doing] * length);
    return { clip: q.doing, time: cycles * this.pack!.duration(q.doing) };
  }

  /** Pose the figures, write every other squirrel down on the ground as a speck; count any drawn by neither. */
  private show(eye: Vec3): void {
    const sp = this.specks!, c = this.coats!;
    roomForSpecks(sp, this.ones.size);
    const d = sp.data;
    let m = 0, figures = 0, down = 0, up = 0;
    for (const one of this.ones.values()) {
      const q = one.now;
      if (!q) { up++; continue; }
      down++;
      const f = one.figure?.figure;
      if (f) {
        figures++;
        // Hand over in this frame: the figure is in and posed, its speck is not written.
        if (!one.figure!.shown) { this.group.add(f.object); one.figure!.shown = true; }
        f.actor.setLod(away(one.feet, eye) < this.lodNear(one) ? f.levels[0] : f.levels[f.levels.length - 1]);
        f.update({ feet: toView(eye, one.feet), up: one.up, front: one.front, ...this.clipOf(one, q) });
        continue;
      }
      const H = this.heightOf(one), look = c.looks[one.look], length = c.length * look.size * one.size;
      writeSpeck(d, m++ * SPECK_STRIDE, one.feet, H, [0, 0, 0], POSE.upright, look.bands, one.horizon, (length * SEEN_LENGTH) / (H * BODY_WIDTH));
    }
    this.counts = { figures, specks: m, up };
    const holes = down - figures - m;
    if (holes > 0) { this.holes += holes; this.holeFrames++; }
    drawSpecks(sp, m);
  }

  /** Where a figure goes from Actors' full level to its medium one (m): as Actors' pack says, for its size. */
  private lodNear(one: One): number {
    const lods = this.pack!.base.runtime.manifest.lods ?? [];
    return (lods[1]?.distance ?? 5) * Math.max(0.2, this.heightOf(one) / this.coats!.height);
  }

  /** The nearest squirrel down on the ground now (world, its feet), for the debug menu's "Go" entries. */
  nearest(eye: Vec3): { feet: Vec3; up: Vec3; front: Vec3 } | null {
    let best: One | null = null;
    for (const one of this.ones.values()) if (one.now && (!best || away(one.feet, eye) < away(best.feet, eye))) best = one;
    return best && { feet: best.feet, up: best.up, front: best.front };
  }

  /** Bytes held: the figures, the coats, the specks' instances, the squirrels' state (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + this.ones.size * 300 + densBytes([...this.ones.values()].map((o) => o.den));
    for (const look of this.coats?.looks ?? []) n += look.coat.byteLength;
    for (const one of this.ones.values()) n += one.figure?.figure?.bytes() ?? 0;
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    if (!this.coats) return `animals: ${this.disposed ? 'gone' : this.habitat.params.life.animals.squirrels > 0 ? 'loading' : 'none'}`;
    const { figures, specks, up } = this.counts;
    return `animals: ${this.ones.size} squirrels within ${RANGE} m (${up} up in their trees) · ${figures} figures (${this.loads.loading} loading) · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const one of this.ones.values()) this.loads.drop(one.figure);
    this.ones.clear();
    if (this.specks) freeMesh(this.specks.mesh);
    this.specks = null;
    this.group.removeFromParent();
  }
}

