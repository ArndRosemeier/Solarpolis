/**
 * The people up on the land around the player (design "Who is out on the land"; who and where: src/sim). Two levels:
 *
 *   figures     the nearest few, Actors humans and shells (render/actors), loaded one at a time in the background
 *               and posed every frame from the simulation, with Actors' own levels of detail (full, medium, crowd);
 *   stand-ins   everyone else out to `CROWD_RANGE`, where a person is about a pixel: one instanced mesh (the CROWD
 *               kind, gen/standIn.ts), each built from the same look as their figure (residents.ts: their exact
 *               height, their colours), walking, standing, kneeling or lying as their figure does.
 *
 * A figure takes over from its stand-in only once it is loaded, compiled and drawn, in the same frame its stand-in goes,
 * and gives it back the same way (CLAUDE.md, rule 16): nobody is ever drawn by neither. Nobody is simulated: every
 * frame asks the population where each person is now (`whereIs`); the whole area is asked again (`peopleAt`) every
 * second or after a long move, which brings new people in and lets go of those who went below.
 */
import { Group, Mesh, type InstancedBufferGeometry, type Camera, type InstancedInterleavedBuffer } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat, v3len, v3sub } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt } from '../gen/horizon';
import { POSE, STAND_IN_STRIDE, standInArrays } from '../gen/standIn';
import { floorGap, lifeBytes, peopleAt, residentOf, whereIs, type Activity, type Person, type Resident } from '../sim';
import { CROWD, crowdInstances } from './materials';
import { arraysGeometry, freeMesh, instancedOf } from './geometry';
import { Figure, castAsWorn, type AnimState } from './actors/figure';
import { humanCatalog } from './actors/pack';
import { Residents, type Dress } from './actors/residents';
import HumanWorker from '@actors/human/worker?worker';

/** Stand-ins are drawn out to here (m): beyond it a person is under a pixel. */
const CROWD_RANGE = 1500;
/** The area is asked again this often (s, real time), or once the eye has moved this far (m). */
const SCAN_EVERY = 1;
const SCAN_MOVE = 100;
/** Closer than this (m), people are placed every frame; further out, a share of them each frame. */
const EVERY_FRAME = 250;
const FAR_SHARE = 6;
/** Figures: how many at most, loaded within `FIGURE_IN` m of the eye and given back beyond `FIGURE_OUT`. */
const FIGURES = 8;
const FIGURE_IN = 30;
const FIGURE_OUT = 40;
/**
 * Time per frame for people new in the area (ms): placing them on the land and measuring their looks, nearest first;
 * the rest wait for the next frame. After a jump into a crowd of thousands they come in over a few seconds, as the
 * ground does, and never in one long frame.
 */
const NEW_BUDGET = 3;
/** A walker's light (the terrain's horizons where they are) is looked up again once they are this far on (m). */
const HORIZON_MOVE = 10;
/** A walking stride: one cycle (two steps) covers this many body heights. */
const STRIDE_LENGTH = 0.85;
/** A swimmer treads water with the head out: the feet this share of the height under the surface. */
const SWIM_DEPTH = 0.85;
/** Deeper water than this (m) is swum in. */
const SWIM_WATER = 0.6;
/** Where the slope of the floor along s is steeper than this, facing comes from the way along it (endcap walls). */
const LEAN = 0.3;

/** What a person does, for the two levels: the stand-in's pose and the figure's animation. */
interface Doing {
  pose: number;
  swim: boolean;
  anim: AnimState;
}

/** What people do at their places, as poses (the pack's clips; a held share for a still pose). */
const STILL: Partial<Record<Activity, { pose: number; clips: { clip: string; hold?: number }[] }>> = {
  meet: { pose: POSE.upright, clips: [{ clip: 'talk' }, { clip: 'nod' }, { clip: 'idle' }, { clip: 'arms folded' }] },
  gather: { pose: POSE.upright, clips: [{ clip: 'talk' }, { clip: 'idle' }, { clip: 'nod' }] },
  watch: { pose: POSE.upright, clips: [{ clip: 'idle' }, { clip: 'arms folded' }] },
  play: { pose: POSE.upright, clips: [{ clip: 'dance' }, { clip: 'idle' }] },
  make: { pose: POSE.kneel, clips: [{ clip: 'repair (kneeling)' }] },
  sit: { pose: POSE.kneel, clips: [{ clip: 'repair (kneeling)', hold: 0.1 }] },
  picnic: { pose: POSE.lie, clips: [{ clip: 'get up from lying', hold: 0 }] },
  stargaze: { pose: POSE.lie, clips: [{ clip: 'get up from lying', hold: 0 }] },
};

interface Someone {
  person: Person;
  resident: Resident;
  dress: Dress | null;
  /** Where their feet are (world, m), their up and front (unit). */
  feet: Vec3;
  up: Vec3;
  front: Vec3;
  /** The stand-in's turn (as plants'), its stride's phase, and the terrain's horizons where they are. */
  turn: number;
  phase: number;
  horizon: [number, number];
  /** Where the horizons were looked up (world). */
  litAt: Vec3;
  doing: Doing;
  /** Their figure: loading, or drawn in place of the stand-in. */
  figure: { figure: Figure | null; shown: boolean; dropped: boolean } | null;
  /** The last scan that found them. */
  seen: number;
  /** Placed on the land at least once. */
  placed: boolean;
}

const keyOf = (p: Pick<Person, 'court' | 'outing'>): number => (p.court < 0 ? -1 - p.outing : p.court * 2 ** 22 + p.outing);

export class PeopleView {
  readonly group = new Group();
  private residents: Residents | null = null;
  private readonly people = new Map<number, Someone>();
  private mesh: Mesh | null = null;
  private buffer: InstancedInterleavedBuffer | null = null;
  private data = new Float32Array(0);
  private scan = 0;
  private lastScan = -Infinity;
  private scannedAt: Vec3 | null = null;
  private clock = 0;
  private frameNo = 0;
  private loading = 0;
  private drawn = 0;
  private figuresDrawn = 0;
  private waiting = 0;
  private holes = 0;
  private holeFrames = 0;
  /** The longest a figure's levels took to make on the main thread (ms; the debug line). */
  private slowestLevels = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly standOn: (theta: number, s: number) => number) {
    this.group.name = 'people';
    void this.start();
  }

  /** Load the pack's human (shared with every resident's figure, its shapes made in a worker) and the stand-in mesh. */
  private async start(): Promise<void> {
    const { catalog, base, human } = await humanCatalog();
    if (!human.usesWorker) await human.useWorker(new HumanWorker());
    const a = standInArrays(), g = instancedOf(arraysGeometry(a, { part: [a.parts, 2] }));
    this.data = new Float32Array(64 * STAND_IN_STRIDE);
    this.buffer = crowdInstances(g, this.data);
    g.instanceCount = 0;
    const mesh = new Mesh(g, CROWD.material);
    mesh.name = 'stand-ins';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    await this.stage.prepare(mesh);
    if (this.disposed) { freeMesh(mesh); return; }
    this.group.add(mesh);
    this.mesh = mesh;
    this.residents = new Residents(catalog, base, human);
  }

  /** Bring the people up to clock time t (s) around the eye (world), drawn relative to it. `dt`: the frame's (s). */
  follow(eye: Vec3, t: number, dt: number): void {
    const r = this.residents;
    if (!r || !this.mesh) return;
    this.clock += dt;
    this.frameNo++;
    const h = this.habitat;
    if (this.clock - this.lastScan > SCAN_EVERY || !this.scannedAt || dist(eye, this.scannedAt) > SCAN_MOVE) this.rescan(eye, t);
    const t0 = performance.now(), gone: number[] = [];
    const room = (): boolean => performance.now() - t0 < NEW_BUDGET;
    let k = 0;
    for (const [key, one] of this.people) {
      k++;
      if (!one.placed && !room()) continue;
      const near = !one.placed || one.figure || dist(one.feet, eye) < EVERY_FRAME;
      if (near || (k + this.frameNo) % FAR_SHARE === 0) {
        const p = whereIs(h, t, one.person);
        if (!p) { gone.push(key); continue; }
        one.person = p;
        this.stand(one);
      }
      if (!one.dress && room()) one.dress = r.dressOf(one.resident);
    }
    for (const key of gone) this.letGo(key);
    this.figures(eye);
    this.show(eye, t, dt);
  }

  /** Ask for everyone in the area again: newcomers in, those no longer there out. */
  private rescan(eye: Vec3, t: number): void {
    const at = fromWorld(this.habitat.profile, ...eye);
    this.scan++;
    this.lastScan = this.clock;
    this.scannedAt = eye;
    // Newcomers nearest first: their looks are measured in this order, a few each frame.
    const R = this.habitat.radius, found = peopleAt(this.habitat, t, { theta: at.theta, s: at.s, radius: CROWD_RANGE });
    const away = (p: Person): number => floorGap(R, at.theta, at.s, p.theta, p.s);
    for (const p of found.filter((q) => !this.people.has(keyOf(q))).sort((a, b) => away(a) - away(b))) {
      const key = keyOf(p);
      const resident = residentOf(this.habitat, p.resident);
      this.people.set(key, {
        person: p, resident, dress: null, feet: [0, 0, 0], up: [0, 0, 1], front: [1, 0, 0], turn: 0,
        phase: 2 * Math.PI * hashToFloat(hash3i(p.resident, 17, 3, 0)), horizon: [0, 0], litAt: [0, 0, 0], doing: { pose: 0, swim: false, anim: { move: 'idle' } },
        figure: null, seen: this.scan, placed: false,
      });
    }
    for (const p of found) { const known = this.people.get(keyOf(p)); if (known) known.seen = this.scan; }
    for (const [key, one] of this.people) if (one.seen !== this.scan) this.letGo(key);
  }

  /** Someone gone below or out of the area: their figure goes with them. */
  private letGo(key: number): void {
    const one = this.people.get(key);
    if (!one) return;
    this.dropFigure(one);
    this.people.delete(key);
  }

  /** Where someone stands now: on the ground (or a landmark's deck), or treading water; facing their way. */
  private stand(one: Someone): void {
    const h = this.habitat, p = one.person, { profile } = h;
    const ground = this.terrain.heightAt(p.theta, p.s), top = this.standOn(p.theta, p.s);
    const doing = doingOf(p, one.resident, top - ground > SWIM_WATER);
    const height = one.dress?.height ?? 1.7;
    const feet = toWorld(profile, { theta: p.theta, s: p.s, h: doing.swim ? top - SWIM_DEPTH * height : top });
    const r = Math.hypot(feet[0], feet[1]) || 1, up: Vec3 = [-feet[0] / r, -feet[1] / r, 0];
    // Facing: the heading is over the floor (0 toward +s, +π/2 toward +θ); where the profile is steep, along it.
    const ds = 0.5, a = profile.at(Math.max(0, p.s - ds)), b = profile.at(Math.min(profile.length, p.s + ds));
    const lean = Math.max(LEAN, Math.abs(b.z - a.z) / Math.max(1e-6, Math.min(profile.length, p.s + ds) - Math.max(0, p.s - ds)));
    one.turn = -Math.atan2(Math.sin(p.heading), Math.cos(p.heading) * lean);
    const side: Vec3 = [up[1], -up[0], 0], c = Math.cos(one.turn), sn = Math.sin(one.turn);
    one.front = [-side[0] * sn, -side[1] * sn, c];
    one.feet = feet;
    one.up = up;
    one.doing = doing;
    if (!one.placed || (p.moving && dist(feet, one.litAt) > HORIZON_MOVE)) { one.horizon = horizonAt(this.terrain, p.theta, p.s); one.litAt = feet; }
    one.placed = true;
  }

  /** Give the nearest people figures, one loading at a time; take them from those who walked off. */
  private figures(eye: Vec3): void {
    const r = this.residents!, wanted: Someone[] = [];
    for (const one of this.people.values()) if (one.dress && dist(one.feet, eye) < FIGURE_IN) wanted.push(one);
    wanted.sort((a, b) => dist(a.feet, eye) - dist(b.feet, eye));
    const keep = new Set(wanted.slice(0, FIGURES));
    for (const one of this.people.values()) {
      if (!one.figure) continue;
      const d = dist(one.feet, eye);
      if (d > FIGURE_OUT || (!keep.has(one) && d > FIGURE_IN)) this.dropFigure(one);
    }
    let count = 0;
    for (const one of this.people.values()) if (one.figure) count++;
    if (this.loading > 0 || count >= FIGURES) return;
    const next = wanted.find((one) => !one.figure);
    if (!next) return;
    const slot = { figure: null as Figure | null, shown: false, dropped: false };
    next.figure = slot;
    this.loading++;
    void this.loadFigure(r, next.resident).then((f) => {
      this.loading--;
      if (slot.dropped || this.disposed) { f?.dispose(); return; }
      slot.figure = f;
    }, () => { this.loading--; });
  }

  /** A resident's figure, compiled at every level of detail and its shadows warmed, not yet in the scene. */
  private async loadFigure(r: Residents, who: Resident): Promise<Figure | null> {
    const figure = await Figure.load(r.figureLook(who), r.human);
    if (this.disposed) { figure.dispose(); return null; }
    castAsWorn(figure.object);
    // Every level is compiled now (Actors makes the crowd level's merged mesh when first asked for it), so a switch
    // between them never builds a shader on the render path.
    const c = figure.character;
    let made = 0;
    for (let level = c.lods.length - 1; level >= 0; level--) {
      const t0 = performance.now();
      c.setLod(level);
      castAsWorn(figure.object);
      made += performance.now() - t0;
      await this.stage.prepare(figure.object, { everyCaster: true });
    }
    this.slowestLevels = Math.max(this.slowestLevels, made);
    c.lodCamera = this.camera;
    c.setLod('auto');
    return figure;
  }

  /** Take someone's figure away (loading: it is let go when it arrives); their stand-in is written again this frame. */
  private dropFigure(one: Someone): void {
    if (one.figure) { one.figure.dropped = true; one.figure.figure?.dispose(); }
    one.figure = null;
  }

  /** Pose the figures and write every stand-in not drawn by a figure; count anyone drawn by neither (must stay 0). */
  private show(eye: Vec3, t: number, dt: number): void {
    let n = 0, waiting = 0, figures = 0, dressed = 0;
    const need = this.people.size * STAND_IN_STRIDE;
    if (this.data.length < need) this.grow(need);
    const d = this.data;
    for (const one of this.people.values()) {
      if (!one.placed) continue;
      if (one.dress) dressed++;
      const slot = one.figure, f = slot?.figure;
      if (f) {
        figures++;
        // Hand over in this frame: the figure is in and posed, its stand-in is not written.
        if (!slot!.shown) { this.group.add(f.object); slot!.shown = true; }
        f.update({ feet: toView(eye, one.feet), up: one.up, front: one.front, speed: one.person.speed, anim: one.doing.anim }, dt, t);
        continue;
      }
      const dress = one.dress;
      if (!dress) { waiting++; continue; }
      const o = n * STAND_IN_STRIDE, v = toView(eye, one.feet), p = one.person;
      d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = dress.height;
      d[o + 4] = one.turn; d[o + 5] = one.phase;
      d[o + 6] = p.moving && !one.doing.swim ? (2 * Math.PI * p.speed) / (STRIDE_LENGTH * dress.height) : 0;
      d[o + 7] = one.doing.pose;
      d[o + 8] = dress.width; d[o + 9] = one.horizon[0]; d[o + 10] = one.horizon[1];
      const c = dress.colors;
      d[o + 11] = c[0]; d[o + 12] = c[1]; d[o + 13] = c[2]; d[o + 14] = c[3]; d[o + 15] = c[4]; d[o + 16] = c[5]; d[o + 17] = c[6];
      n++;
    }
    this.drawn = n;
    this.figuresDrawn = figures;
    this.waiting = waiting;
    // Anyone whose look is known is drawn by one level or the other. (People whose look is still being measured are
    // new to the area, nearest first, at the start or after a jump: not a hole in a handover.)
    this.holes = dressed - figures - n;
    if (this.holes > 0) this.holeFrames++;
    const g = this.mesh!.geometry as InstancedBufferGeometry;
    g.instanceCount = n;
    this.buffer!.needsUpdate = true;
    this.buffer!.clearUpdateRanges();
    this.buffer!.addUpdateRange(0, n * STAND_IN_STRIDE);
  }

  private grow(need: number): void {
    this.data = new Float32Array(Math.max(need, this.data.length * 2));
    // The instance attributes are set again on the new buffer (the old one is let go with them).
    this.buffer = crowdInstances(this.mesh!.geometry, this.data);
  }

  /** Bytes held: the stand-ins' instances, the residents' measures, the figures and the population's caches (memory watchdog). */
  bytes(): number {
    let n = this.data.byteLength + (this.residents?.heldBytes() ?? 0) + this.people.size * 400 + lifeBytes(this.habitat);
    for (const one of this.people.values()) n += one.figure?.figure?.bytes() ?? 0;
    return n;
  }

  /** Give memory back: the measures of people not in the area are made again when needed. */
  shed(): void {
    this.residents?.forget();
  }

  /** The debug menu's line. */
  info(): string {
    return `people: ${this.people.size} up within ${(CROWD_RANGE / 1000).toFixed(1)} km · ${this.figuresDrawn} figures (${this.loading} loading) · ${this.drawn} stand-ins · ${this.waiting} waiting for their look · handover holes ${this.holes}, frames with holes ${this.holeFrames} · figure levels made in ${this.slowestLevels.toFixed(0)} ms at most`;
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.people.keys()]) this.letGo(key);
    if (this.mesh) freeMesh(this.mesh);
    this.mesh = null;
    this.group.removeFromParent();
  }
}

/** What someone is doing, as both levels show it. */
function doingOf(p: Person, who: Resident, deep: boolean): Doing {
  if (deep) return { pose: POSE.upright, swim: true, anim: { move: 'swim' } };
  if (p.moving) return { pose: POSE.upright, swim: false, anim: { move: 'walk' } };
  const still = STILL[p.activity];
  if (!still) return { pose: POSE.upright, swim: false, anim: { move: 'idle' } };
  const pick = still.clips[Math.floor(hashToFloat(hash3i(who.id, 29, p.outing, 0)) * still.clips.length)];
  return { pose: still.pose, swim: false, anim: { move: 'idle', pose: pick } };
}

const dist = (a: Vec3, b: Vec3): number => v3len(v3sub(a, b));
