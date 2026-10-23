/**
 * The animals on the land around the player (design "Who is out on the land"): one view per kind of animal (`Kind`:
 * squirrels round their trees, sim/fauna.ts; deer in herds, sim/herds.ts), each at two levels by its size on screen:
 *
 *   figures   the nearest few, Actors animals (render/actors/animal.ts) in their looks, their coats baked in a worker
 *             (gen/coat.ts), compiled at both of Actors' levels that draw parts separately before they are shown, and
 *             posed every frame from the simulation: going at the pace they go, grazing, foraging, looking up;
 *   specks    everyone else out to where one is under a pixel: the patch of screen its body covers (the SPECK kind), in
 *             its coat's colours (top, middle and bottom thirds).
 *
 * A figure takes over from its speck only in the frame it is first drawn, and gives it back the same way (CLAUDE.md,
 * rule 16): every animal out on the land is drawn by one level each frame (the debug line counts `holes`). The homes
 * around the eye (a squirrel's tree, a herd's range) are asked for in a worker every so often or after a move; where
 * each animal is, every frame. An animal the simulation has away (a squirrel up in its tree) is not drawn.
 */
import { Group, Vector2, type Camera } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type HabitatParams, type Vec3, apart as away } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt, OPEN_SKY } from '../gen/horizon';
import { BODY_WIDTH, POSE, SPECK_STRIDE, writeSpeck } from '../gen/standIn';
import type { Coats } from '../gen/coat';
import { HEARD_WITHIN, type Source } from '../sim/sources';
import { deerAt, densBytes, herdReady, herdsBytes, prepareHerd, squirrelAt, type Den, type Herd } from '../sim';
import type { WorkerPool } from '../workers/pool';
import { freeMesh } from './geometry';
import { drawSpecks, ownSpecks, pxPerMetre, roomForSpecks, type OwnSpecks } from './specks';
import { turnFor } from './people';
import { AnimalFigure, AnimalPack, animalPack } from './actors/animal';
import { FigureLoads, type FigureSlot } from './actors/slots';

/** Where an animal is and what it does, as the simulation says. */
interface Moment {
  theta: number;
  s: number;
  heading: number;
  speed: number;
  doing: string;
  since: number;
}

/** A home animals live from (a squirrel's tree, a herd's range): what the worker gives. */
interface Home {
  id: number;
  seed: number;
  theta: number;
  s: number;
}

/** One kind of animal: its pack and looks, how it is drawn, and where the simulation has it. */
export interface Kind<H extends Home> {
  /** What the debug line calls them. */
  name: string;
  /** Actors' pack, and its looks (presets) with how common each is; a home's animals share a look if `oneLook`. */
  pack: string;
  looks: readonly [string, number][];
  oneLook: boolean;
  /** How much one animal's size differs from its look's (± share). */
  sizes: number;
  /** Homes are asked for out to here (m): where an animal is under a pixel; again this often (s, real time) or after this move (m). */
  range: number;
  scanEvery: number;
  scanMove: number;
  /** Figures: how many at most, given to animals at least this tall on screen (px). */
  figures: number;
  figurePx: number;
  /** How far one goes in a cycle of a moving clip, in body lengths, so the clip plays as fast as it goes. */
  stride: Readonly<Record<string, number>>;
  /** How much of a speck's width its length counts for, seen from any side. */
  seenLength: number;
  /** How fast it turns to a new way (radians/s). */
  turning: number;
  /** Whether the habitat has any. */
  any(p: HabitatParams): boolean;
  /** The worker's job for the homes round a point. */
  job: 'squirrels' | 'herds';
  /** How many animals live from a home. */
  count(home: H): number;
  /** Whether a home's animals can be placed quickly at clock time t; if not, `prepare` it (milliseconds). */
  ready(t: Terrain, home: H, time: number): boolean;
  prepare(t: Terrain, home: H, time: number): void;
  /** Animal i of a home at clock time t, or null while it is away. */
  at(t: Terrain, home: H, i: number, time: number): Moment | null;
  /** Bytes the homes hold. */
  bytes(homes: H[]): number;
}

/** Squirrels: one to a tree, down on the ground by day (sim/fauna.ts). */
export const SQUIRRELS: Kind<Den> = {
  name: 'squirrels', pack: 'squirrel', looks: [['grey', 0.45], ['red', 0.3], ['fox', 0.15], ['black', 0.1]], oneLook: false, sizes: 0.08,
  range: 250, scanEvery: 3, scanMove: 60, figures: 6, figurePx: 14,
  // A squirrel bounds about two body lengths a hop and leaps four and a half running.
  stride: { hop: 2.2, run: 4.5 }, seenLength: 0.7, turning: 12,
  any: (p) => p.life.animals.squirrels > 0,
  job: 'squirrels',
  count: () => 1,
  ready: () => true,
  prepare: () => {},
  at: (t, den, _i, time) => squirrelAt(t, den, time),
  bytes: densBytes,
};

/** Deer: herds on the reserve and the herd and let-go districts (sim/herds.ts). */
export const DEER: Kind<Herd> = {
  name: 'deer', pack: 'deer', looks: [['fallow', 0.3], ['red', 0.25], ['roe', 0.15], ['sika', 0.12], ['whitetail', 0.1], ['chital', 0.08]], oneLook: true, sizes: 0.06,
  range: 2000, scanEvery: 20, scanMove: 300, figures: 10, figurePx: 16,
  // A deer's walk covers a little under a body length a cycle.
  stride: { walk: 0.9 }, seenLength: 0.8, turning: 1.5,
  any: (p) => p.life.animals.deer > 0,
  job: 'herds',
  count: (herd) => herd.size,
  ready: herdReady,
  prepare: prepareHerd,
  at: deerAt,
  bytes: herdsBytes,
};

/** Figures are given back below this share of `figurePx`. */
const FIGURE_BACK = 0.75;
/** An animal's light (the terrain's horizons where it is) is looked up again once it is this far on (m). */
const LIGHT_MOVE = 10;
/** How long a frame may spend getting homes ready (ms), and how far ahead of the clock they are got ready (s). */
const READY_MS = 2;
const AHEAD = 600;

/** An animal around the eye, as last placed. */
interface One<H> {
  home: H;
  i: number;
  /** Its look (index into the kind's looks) and its size (× the look's). */
  look: number;
  size: number;
  now: Moment | null;
  /** The way it faces, turning toward the simulation's at the kind's pace (radians; NaN until first placed). */
  heading: number;
  feet: Vec3;
  up: Vec3;
  front: Vec3;
  horizon: [number, number];
  litAt: Vec3;
  /** Its figure: loading, or drawn in place of its speck. */
  figure: FigureSlot<AnimalFigure> | null;
}

export class AnimalView<H extends Home = Home> {
  readonly group = new Group();
  private pack: AnimalPack | null = null;
  private coats: Coats | null = null;
  private specks: OwnSpecks | null = null;
  /** The homes around the eye, the ones ready to place (their animals in `ones`), and when each was last seen in a scan. */
  private readonly homes = new Map<number, { home: H; seen: number; ready: boolean }>();
  private readonly ones = new Map<string, One<H>>();
  private readonly screen = new Vector2();
  private clock = 0;
  private lastScan = -Infinity;
  private scannedAt: Vec3 | null = null;
  private scanning = false;
  private scan = 0;
  private readonly loads = new FigureLoads<AnimalFigure>(() => this.disposed);
  private counts = { figures: 0, specks: 0, away: 0 };
  private holes = 0;
  private holeFrames = 0;
  private disposed = false;

  constructor(readonly kind: Kind<H>, private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly pool: WorkerPool) {
    this.group.name = kind.name;
    void this.start();
  }

  /** The pack (its shape worker), the looks' coats baked in a worker, and the specks' mesh. */
  private async start(): Promise<void> {
    if (!this.kind.any(this.habitat.params)) return;
    const k = this.kind, manifest = new URL(animalPack(k.pack), location.href).href;
    const specks = ownSpecks(`${k.name} specks`, 64);
    const [pack, answer] = await Promise.all([
      AnimalPack.load(k.pack),
      this.pool.job({ kind: 'coats', ask: { manifest, animal: k.pack, presets: k.looks.map(([p]) => p) } }),
      this.stage.prepare(specks.mesh),
    ]);
    if (this.disposed || !('kind' in answer) || answer.kind !== 'coats') { freeMesh(specks.mesh); pack.dispose(); return; }
    this.pack = pack;
    this.coats = answer.coats;
    this.specks = specks;
    this.group.add(specks.mesh);
  }

  /** Bring the animals up to clock time t (s) around the eye (world), drawn relative to it. `dt`: the frame's (s). */
  follow(eye: Vec3, t: number, dt: number): void {
    if (!this.coats || !this.specks) return;
    this.clock += dt;
    if (!this.scanning && (this.clock - this.lastScan > this.kind.scanEvery || !this.scannedAt || away(eye, this.scannedAt) > this.kind.scanMove)) this.rescan(eye);
    this.ready(eye, t);
    for (const one of this.ones.values()) this.place(one, t, dt);
    this.figures(eye);
    this.show(eye);
  }

  /** Ask a worker for the homes around the eye; newcomers in, those out of range out. */
  private rescan(eye: Vec3): void {
    const h = this.habitat, at = fromWorld(h.profile, ...eye);
    this.scanning = true;
    this.lastScan = this.clock;
    this.scannedAt = eye;
    void this.pool.job({ kind: this.kind.job, params: h.params, theta: at.theta, s: at.s, radius: this.kind.range }).then((a) => {
      this.scanning = false;
      if (this.disposed || !('kind' in a) || a.kind !== this.kind.job) return;
      const homes = a.homes as unknown as H[];
      this.scan++;
      for (const home of homes) {
        const known = this.homes.get(home.id);
        if (known) known.seen = this.scan;
        else this.homes.set(home.id, { home, seen: this.scan, ready: false });
      }
      for (const [id, x] of this.homes) {
        if (x.seen === this.scan) continue;
        for (let i = 0; i < this.kind.count(x.home); i++) {
          const key = `${id}:${i}`;
          this.loads.drop(this.ones.get(key)?.figure ?? null);
          this.ones.delete(key);
        }
        this.homes.delete(id);
      }
    }, () => { this.scanning = false; });
  }

  /**
   * Get homes ready to place, nearest first, a few milliseconds a frame: newcomers (their animals join), and the ones
   * already placed for a while ahead of the clock (a herd's next day), so placing them never stalls a frame.
   */
  private ready(eye: Vec3, t: number): void {
    const k = this.kind, { profile } = this.habitat, start = performance.now();
    const by = (x: { home: H }): number => away(eye, toWorld(profile, { theta: x.home.theta, s: x.home.s, h: 0 }));
    const waiting = [...this.homes.values()].filter((x) => !x.ready || !k.ready(this.terrain, x.home, t + AHEAD)).sort((a, b) => by(a) - by(b));
    for (const x of waiting) {
      if (performance.now() - start > READY_MS) break;
      if (!k.ready(this.terrain, x.home, t)) k.prepare(this.terrain, x.home, t);
      if (!x.ready) { x.ready = true; this.join(x.home); continue; }
      k.prepare(this.terrain, x.home, t + AHEAD);
    }
  }

  /** A home's animals join those placed, each with its look and size. */
  private join(home: H): void {
    const k = this.kind;
    for (let i = 0; i < k.count(home); i++) {
      const pick = hashToFloat(hash3i(home.seed, 31, k.oneLook ? 0 : i, 0));
      let look = 0;
      for (let acc = k.looks[0][1]; look < k.looks.length - 1 && pick >= acc; acc += k.looks[++look][1]);
      this.ones.set(`${home.id}:${i}`, {
        home, i, look, size: 1 + k.sizes * (2 * hashToFloat(hash3i(home.seed, 32, i, 0)) - 1), now: null, heading: NaN,
        feet: [0, 0, 0], up: [0, 0, 1], front: [1, 0, 0], horizon: [OPEN_SKY, OPEN_SKY], litAt: [Infinity, 0, 0], figure: null,
      });
    }
  }

  /** Where an animal is now: on the ground, facing its way (turning toward it), lit by the horizons there. */
  private place(one: One<H>, t: number, dt: number): void {
    const q = this.kind.at(this.terrain, one.home, one.i, t);
    one.now = q;
    if (!q) { one.heading = NaN; return; }
    if (Number.isNaN(one.heading)) one.heading = q.heading;
    else {
      const turn = Math.atan2(Math.sin(q.heading - one.heading), Math.cos(q.heading - one.heading)), most = this.kind.turning * Math.max(0, dt);
      one.heading += Math.max(-most, Math.min(most, turn));
    }
    const { profile } = this.habitat, feet = toWorld(profile, { theta: q.theta, s: q.s, h: this.terrain.standAt(q.theta, q.s) });
    const r = Math.hypot(feet[0], feet[1]) || 1, up: Vec3 = [-feet[0] / r, -feet[1] / r, 0];
    const turn = turnFor(profile, q.s, one.heading), side: Vec3 = [up[1], -up[0], 0], c = Math.cos(turn), sn = Math.sin(turn);
    one.front = [-side[0] * sn, -side[1] * sn, c];
    one.feet = feet;
    one.up = up;
    if (away(feet, one.litAt) > LIGHT_MOVE) { one.horizon = horizonAt(this.terrain, q.theta, q.s); one.litAt = feet; }
  }

  /** An animal's height on its body (m): its look's size, its own, the pack's body. */
  private heightOf(one: One<H>): number {
    const c = this.coats!;
    return c.height * c.looks[one.look].size * one.size;
  }

  /** Give the nearest animals big enough on screen figures, one loading at a time; take them from those gone small or away. */
  private figures(eye: Vec3): void {
    const perMetre = pxPerMetre(this.stage, this.camera, this.screen), pack = this.pack!, coats = this.coats!, k = this.kind;
    const pxOf = (one: One<H>): number => (this.heightOf(one) * perMetre) / Math.max(1e-3, away(one.feet, eye));
    const wanted = [...this.ones.values()].filter((one) => one.now && pxOf(one) >= k.figurePx).sort((a, b) => away(a.feet, eye) - away(b.feet, eye));
    const keep = new Set(wanted.slice(0, k.figures));
    let count = 0;
    for (const one of this.ones.values()) {
      if (!one.figure) continue;
      if (!one.now || (!keep.has(one) && pxOf(one) < k.figurePx * FIGURE_BACK) || (!keep.has(one) && count >= k.figures)) { this.loads.drop(one.figure); one.figure = null; }
      else count++;
    }
    if (this.loads.loading > 0 || count >= k.figures) return;
    const next = wanted.find((one) => !one.figure);
    if (next) next.figure = this.loads.load(() => this.loadFigure(pack, coats, next));
  }

  /** An animal's figure, compiled at both its levels, not yet in the scene. */
  private async loadFigure(pack: AnimalPack, coats: Coats, one: One<H>): Promise<AnimalFigure | null> {
    const f = await AnimalFigure.load(pack, coats.looks[one.look], coats.fur, one.size);
    if (this.disposed) { f.dispose(); return null; }
    for (const level of [...f.levels].reverse()) {
      f.actor.setLod(level);
      await this.stage.prepare(f.object, { everyCaster: true });
    }
    return f;
  }

  /** Its clip and where in it, from what it does: moving clips as fast as it goes. */
  private clipOf(one: One<H>, q: Moment): { clip: string; time: number } {
    const stride = this.kind.stride[q.doing];
    if (stride === undefined) return { clip: q.doing, time: q.since };
    const length = this.coats!.length * this.coats!.looks[one.look].size * one.size;
    const cycles = (q.speed * q.since) / (stride * length);
    return { clip: q.doing, time: cycles * this.pack!.duration(q.doing) };
  }

  /** Pose the figures, write every other animal out on the land as a speck; count any drawn by neither. */
  private show(eye: Vec3): void {
    const sp = this.specks!, c = this.coats!;
    roomForSpecks(sp, this.ones.size);
    const d = sp.data;
    let m = 0, figures = 0, out = 0, gone = 0;
    for (const one of this.ones.values()) {
      const q = one.now;
      if (!q) { gone++; continue; }
      out++;
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
      writeSpeck(d, m++ * SPECK_STRIDE, one.feet, H, [0, 0, 0], POSE.upright, look.bands, one.horizon, (length * this.kind.seenLength) / (H * BODY_WIDTH));
    }
    this.counts = { figures, specks: m, away: gone };
    const holes = out - figures - m;
    if (holes > 0) { this.holes += holes; this.holeFrames++; }
    drawSpecks(sp, m);
  }

  /** Where a figure goes from Actors' full level to its medium one (m): as Actors' pack says, for its size. */
  private lodNear(one: One<H>): number {
    const lods = this.pack!.base.runtime.manifest.lods ?? [];
    return (lods[1]?.distance ?? 5) * Math.max(0.2, this.heightOf(one) / this.coats!.height);
  }

  /** The nearest animal out on the land now (world, its feet, and its height), for the debug menu's "Go" entries. */
  nearest(eye: Vec3): { feet: Vec3; up: Vec3; front: Vec3; height: number } | null {
    let best: One<H> | null = null;
    for (const one of this.ones.values()) if (one.now && (!best || away(one.feet, eye) < away(best.feet, eye))) best = one;
    return best && { feet: best.feet, up: best.up, front: best.front, height: this.heightOf(best) };
  }

  /** The animals near the eye that can be heard (sim/sources.ts): where each is, how fast it goes, what it is doing. */
  heard(eye: Vec3, t: number, out: Source[]): void {
    const kind = this.kind.name === 'deer' ? 'deer' : 'squirrel', reach = HEARD_WITHIN[kind];
    for (const [id, one] of this.ones) {
      const now = one.now;
      if (!now || away(one.feet, eye) > reach) continue;
      const at = fromWorld(this.habitat.profile, ...one.feet);
      out.push({ key: hashKey(id), kind, theta: at.theta, s: at.s, h: at.h, at: one.feet, speed: now.speed, doing: now.doing, began: t - now.since });
    }
  }

  /** Bytes held: the figures, the coats, the specks' instances, the animals' state (memory watchdog). */
  bytes(): number {
    let n = (this.specks?.data.byteLength ?? 0) + this.ones.size * 300 + this.kind.bytes([...this.homes.values()].map((x) => x.home));
    for (const look of this.coats?.looks ?? []) n += look.coat.byteLength + (look.dapple?.byteLength ?? 0);
    for (const one of this.ones.values()) n += one.figure?.figure?.bytes() ?? 0;
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    const k = this.kind;
    if (!this.coats) return `${k.name}: ${this.disposed ? 'gone' : k.any(this.habitat.params) ? 'loading' : 'none'}`;
    const { figures, specks, away: gone } = this.counts, waiting = [...this.homes.values()].filter((x) => !x.ready).length;
    return `${k.name}: ${this.ones.size} within ${k.range} m from ${this.homes.size} homes (${waiting} getting ready, ${gone} away) · ${figures} figures (${this.loads.loading} loading) · ${specks} specks · handover holes ${this.holes}, frames with holes ${this.holeFrames}`;
  }

  dispose(): void {
    this.disposed = true;
    for (const one of this.ones.values()) this.loads.drop(one.figure);
    this.ones.clear();
    this.homes.clear();
    if (this.specks) freeMesh(this.specks.mesh);
    this.specks = null;
    this.pack?.dispose();
    this.pack = null;
    this.group.removeFromParent();
  }
}

/** A number for an animal's `home:index` key, the same every time (a source's key seeds its sounds). */
function hashKey(id: string): number {
  let k = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) k = Math.imul(k ^ id.charCodeAt(i), 0x01000193);
  return k >>> 0;
}
