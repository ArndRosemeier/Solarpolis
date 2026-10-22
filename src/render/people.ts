/**
 * The people up on the land around the player (design "Who is out on the land"; who and where: src/sim). Three levels:
 *
 *   figures     the nearest few, Actors humans and shells (render/actors), loaded one at a time in the background
 *               and posed every frame from the simulation, with Actors' levels of detail that draw their parts apart;
 *   stand-ins   everyone else out to where a body is `HANDOVER_PX` tall: one instanced mesh (the CROWD kind,
 *               gen/standIn.ts), each built from the same look as their figure (residents.ts: their exact height,
 *               their colours), walking, standing, kneeling or lying as their figure does;
 *   specks      from there out to `CROWD_RANGE`: the patch of screen their body covers (the SPECK kind), at their
 *               exact place, in their stand-in's colours. Beyond, the far specks (render/specks.ts) draw everyone.
 *
 * A figure takes over from its stand-in only once it is loaded, compiled and drawn, in the same frame its stand-in goes,
 * and gives it back the same way; a stand-in and its speck swap in one frame, both written here (CLAUDE.md, rule 16):
 * nobody is ever drawn by neither. `near` lists whom these levels drew, so the far specks leave them out. Nobody is simulated: every
 * frame asks the population where each person is now (`whereIs`); the whole area is asked again (`peopleAt`) every
 * second or after a long move, which brings new people in and lets go of those who went below.
 */
import { Group, InstancedBufferAttribute, MathUtils, Mesh, Vector2, type InstancedBufferGeometry, type Camera, type InstancedInterleavedBuffer, type PerspectiveCamera } from 'three/webgpu';
import { lodForDistance, type LodDef } from '@actors/core';
import type { Stage } from '@futuremagic/stage';
import { hash3i, hashToFloat, v3len, v3sub } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt } from '../gen/horizon';
import { MEAN_HEIGHT, SPECK_SHOWN, SPECK_STRIDE, STAND_IN_STRIDE, speckBands, standInArrays, writeSpeck } from '../gen/standIn';
import { floorGap, footingOf, personKey, lifeBytes, peopleAt, residentOf, whereIs, type Activity, type Footing, type Person, type Resident } from '../sim';
import { CROWD, SPECK, SPECK_LAYOUT, STAND_IN_LAYOUT, peopleInstances } from './materials';
import { arraysGeometry, drawnAnywhere, freeMesh, instancedOf, quadInstances } from './geometry';
import { Figure, castAsWorn, type AnimState } from './actors/figure';
import { humanCatalog } from './actors/pack';
import { Residents, type Dress } from './actors/residents';
import HumanWorker from '@actors/human/worker?worker';

/** People are placed out to here (m), each by their exact whereabouts; beyond, the far specks draw them. */
const CROWD_RANGE = 1500;
/**
 * A stand-in hands over to its speck where the body is this tall on screen (px), and comes back from it where the body is
 * `HANDOVER_BACK` times that (so nobody flickers between the two at the line).
 */
const HANDOVER_PX = 3;
const HANDOVER_BACK = 1.2;
/** The area is asked again this often (s, real time), or once the eye has moved this far (m). */
const SCAN_EVERY = 1;
const SCAN_MOVE = 100;
/** Closer than this (m), people are placed every frame; out to `HALF_FRAMES` every other frame, further a share each frame. */
const EVERY_FRAME = 60;
const HALF_FRAMES = 250;
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
/** What a walker stands on that is built (a landmark's deck, the Lift Stair's treads) is looked up again this far on (m). */
const DECK_MOVE = 0.2;
/** A walking stride: one cycle (two steps) covers this many body heights. */
const STRIDE_LENGTH = 0.85;
/** Where the slope of the floor along s is steeper than this, facing comes from the way along it (endcap walls). */
const LEAN = 0.3;

/** What a person does, for the two levels: the stand-in's pose and the figure's animation. */
interface Doing {
  pose: number;
  swim: boolean;
  anim: AnimState;
}

/** What people do at their places, as the figures' clips (a held share for a still pose; the pose is `postureOf`'s). */
const STILL: Partial<Record<Activity, { clip: string; hold?: number }[]>> = {
  meet: [{ clip: 'talk' }, { clip: 'nod' }, { clip: 'idle' }, { clip: 'arms folded' }],
  gather: [{ clip: 'talk' }, { clip: 'idle' }, { clip: 'nod' }],
  watch: [{ clip: 'idle' }, { clip: 'arms folded' }],
  play: [{ clip: 'dance' }, { clip: 'idle' }],
  make: [{ clip: 'repair (kneeling)' }],
  sit: [{ clip: 'repair (kneeling)', hold: 0.1 }],
  picnic: [{ clip: 'get up from lying', hold: 0 }],
  stargaze: [{ clip: 'get up from lying', hold: 0 }],
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
  /** What is built under them (height over the profile, or null) and where it was looked up (θ, s). */
  deck: number | null;
  deckAt: [number, number];
  doing: Doing;
  /** Drawn as a speck (too small for the stand-in), and the speck's colour bands (from their dress). */
  speck: boolean;
  bands: [number, number, number] | null;
  /** Their figure: loading, or drawn in place of the stand-in. */
  figure: { figure: Figure | null; shown: boolean; dropped: boolean } | null;
  /** The last scan that found them. */
  seen: number;
  /** Placed on the land at least once. */
  placed: boolean;
}


export class PeopleView {
  readonly group = new Group();
  private residents: Residents | null = null;
  private readonly people = new Map<number, Someone>();
  private mesh: Mesh | null = null;
  private buffer: InstancedInterleavedBuffer | null = null;
  private data = new Float32Array(0);
  /** The specks of those placed here but too small for a stand-in: their mesh, instances and shown flags (all on). */
  private speckMesh: Mesh | null = null;
  private speckData = new Float32Array(0);
  private speckBuffer: InstancedInterleavedBuffer | null = null;
  private specksDrawn = 0;
  /** Everyone these levels drew this frame (`personKey`): the far specks leave them out. */
  readonly near: number[] = [];
  private readonly screen = new Vector2();
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

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly camera: Camera, private readonly deckOf: (theta: number, s: number) => number | null) {
    this.group.name = 'people';
    void this.start();
  }

  /** Load the pack's human (shared with every resident's figure, its shapes made in a worker) and the stand-in mesh. */
  private async start(): Promise<void> {
    const { catalog, base, human } = await humanCatalog();
    if (!human.usesWorker) await human.useWorker(new HumanWorker());
    const a = standInArrays(), g = instancedOf(arraysGeometry(a, { part: [a.parts, 2] }));
    this.data = new Float32Array(64 * STAND_IN_STRIDE);
    this.buffer = peopleInstances(g, this.data, STAND_IN_LAYOUT);
    g.instanceCount = 0;
    const mesh = drawnAnywhere(g, CROWD.material, 'stand-ins');
    mesh.castShadow = true;
    const specks = drawnAnywhere(quadInstances(), SPECK.material, 'near specks');
    this.speckMesh = specks;
    this.growSpecks(64);
    (specks.geometry as InstancedBufferGeometry).instanceCount = 0;
    await Promise.all([this.stage.prepare(mesh), this.stage.prepare(specks)]);
    if (this.disposed) { freeMesh(mesh); freeMesh(specks); return; }
    this.group.add(mesh, specks);
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
    const gone: number[] = [];
    // Only the work on people new here counts against the budget: those already placed are kept up every frame.
    let spent = 0;
    const timed = (work: () => void): void => { const t0 = performance.now(); work(); spent += performance.now() - t0; };
    let k = 0;
    for (const [key, one] of this.people) {
      k++;
      const fresh = !one.placed;
      if (fresh && spent > NEW_BUDGET) continue;
      const d = fresh ? 0 : dist(one.feet, eye);
      const due = fresh || one.figure || d < EVERY_FRAME || (d < HALF_FRAMES ? (k + this.frameNo) % 2 === 0 : (k + this.frameNo) % FAR_SHARE === 0);
      if (due) {
        const p = whereIs(h, t, one.person);
        if (!p) { gone.push(key); continue; }
        const still = !fresh && !p.moving && !one.person.moving && p.theta === one.person.theta && p.s === one.person.s && p.activity === one.person.activity;
        one.person = p;
        if (fresh) timed(() => this.stand(one)); else if (!still) this.stand(one);
      }
      if (!one.dress && spent <= NEW_BUDGET) timed(() => { one.dress = r.dressOf(one.resident); if (one.dress) one.bands = speckBands(one.dress.colors); });
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
    for (const p of found.filter((q) => !this.people.has(personKey(q))).sort((a, b) => away(a) - away(b))) {
      const key = personKey(p);
      const resident = residentOf(this.habitat, p.resident);
      this.people.set(key, {
        person: p, resident, dress: null, feet: [0, 0, 0], up: [0, 0, 1], front: [1, 0, 0], turn: 0,
        phase: 2 * Math.PI * hashToFloat(hash3i(p.resident, 17, 3, 0)), horizon: [0, 0], litAt: [0, 0, 0], deck: null, deckAt: [0, 0], doing: { pose: 0, swim: false, anim: { move: 'idle' } },
        speck: false, bands: null, figure: null, seen: this.scan, placed: false,
      });
    }
    for (const p of found) { const known = this.people.get(personKey(p)); if (known) known.seen = this.scan; }
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
    if (!one.placed || floorGap(h.radius, p.theta, p.s, one.deckAt[0], one.deckAt[1]) > DECK_MOVE) {
      one.deck = this.deckOf(p.theta, p.s);
      one.deckAt = [p.theta, p.s];
    }
    const foot = footingOf(this.terrain, p, one.deck, one.dress?.height ?? MEAN_HEIGHT);
    const doing = doingOf(p, one.resident, foot);
    const feet = toWorld(profile, { theta: p.theta, s: p.s, h: foot.h });
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
    for (const level of figureLevels(c.lods).reverse()) {
      const t0 = performance.now();
      c.setLod(level);
      castAsWorn(figure.object);
      made += performance.now() - t0;
      await this.stage.prepare(figure.object, { everyCaster: true });
    }
    this.slowestLevels = Math.max(this.slowestLevels, made);
    return figure;
  }

  /**
   * A figure's level of detail by its distance, as Actors picks it (`lodForDistance`, scaled for the field of view),
   * among the levels it draws separately: Actors' merged crowd level is never used here, since the stand-in takes over
   * before it would (and its mesh, made again at each switch, would build its shaders while drawing).
   */
  private detailFor(f: Figure, d: number): void {
    const c = f.character, levels = figureLevels(c.lods);
    const fov = (this.camera as PerspectiveCamera).isPerspectiveCamera ? (this.camera as PerspectiveCamera).getEffectiveFOV() : 50;
    const zoom = Math.tan(MathUtils.degToRad(25)) / Math.tan(MathUtils.degToRad(fov / 2));
    const want = lodForDistance(c.lods, d, zoom);
    const level = levels.filter((l) => l <= want).pop() ?? levels[0];
    if (c.lodMode !== level) c.setLod(level);
  }

  /** Take someone's figure away (loading: it is let go when it arrives); their stand-in is written again this frame. */
  private dropFigure(one: Someone): void {
    if (one.figure) { one.figure.dropped = true; one.figure.figure?.dispose(); }
    one.figure = null;
  }

  /**
   * Pose the figures, write every stand-in not drawn by a figure and every speck of those too small for a stand-in;
   * count anyone drawn by none (must stay 0).
   */
  private show(eye: Vec3, t: number, dt: number): void {
    let n = 0, m = 0, waiting = 0, figures = 0, dressed = 0;
    const need = this.people.size;
    if (this.data.length < need * STAND_IN_STRIDE) this.grow(need * STAND_IN_STRIDE);
    if (this.speckData.length < need * SPECK_STRIDE) this.growSpecks(need);
    const d = this.data, sd = this.speckData, near = this.near;
    near.length = 0;
    // A body's height on screen at distance d is its height times this over d (px).
    const fov = (this.camera as PerspectiveCamera).isPerspectiveCamera ? (this.camera as PerspectiveCamera).getEffectiveFOV() : 50;
    const pxPerMetre = this.stage.renderer.getDrawingBufferSize(this.screen).y / 2 / Math.tan(MathUtils.degToRad(fov / 2));
    for (const one of this.people.values()) {
      if (!one.placed) continue;
      if (one.dress) dressed++;
      const slot = one.figure, f = slot?.figure;
      if (f) {
        figures++;
        near.push(personKey(one.person));
        // Hand over in this frame: the figure is in and posed, its stand-in is not written.
        if (!slot!.shown) { this.group.add(f.object); slot!.shown = true; }
        this.detailFor(f, dist(one.feet, eye));
        f.update({ feet: toView(eye, one.feet), up: one.up, front: one.front, speed: one.person.speed, anim: one.doing.anim }, dt, t);
        continue;
      }
      const dress = one.dress;
      if (!dress) { waiting++; continue; }
      near.push(personKey(one.person));
      // Stand-in or speck, by the body's height on screen; both are written from the same place, size and colours.
      const px = (dress.height * pxPerMetre) / Math.max(1e-3, dist(one.feet, eye));
      one.speck = one.speck ? px < HANDOVER_PX * HANDOVER_BACK : px < HANDOVER_PX;
      if (one.speck) {
        writeSpeck(sd, m * SPECK_STRIDE, one.feet, dress.height, [0, 0, 0], one.doing.pose, one.bands ?? speckBands(dress.colors), one.horizon, dress.width);
        m++;
        continue;
      }
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
    this.specksDrawn = m;
    this.figuresDrawn = figures;
    this.waiting = waiting;
    // Anyone whose look is known is drawn by one level or another. (People whose look is still being measured are
    // new to the area, nearest first, at the start or after a jump; the far specks still draw them.)
    this.holes = dressed - figures - n - m;
    if (this.holes > 0) this.holeFrames++;
    upload(this.mesh!, this.buffer!, n, STAND_IN_STRIDE);
    upload(this.speckMesh!, this.speckBuffer!, m, SPECK_STRIDE);
  }

  private grow(need: number): void {
    this.data = new Float32Array(Math.max(need, this.data.length * 2));
    // The instance attributes are set again on the new buffer (the old one is let go with them).
    this.buffer = peopleInstances(this.mesh!.geometry, this.data, STAND_IN_LAYOUT);
  }

  /** Room for `need` specks: their instances, and their shown flags (all on: these are drawn just as written). */
  private growSpecks(need: number): void {
    const count = Math.max(need, (this.speckData.length / SPECK_STRIDE) * 2);
    this.speckData = new Float32Array(count * SPECK_STRIDE);
    const g = this.speckMesh!.geometry;
    this.speckBuffer = peopleInstances(g, this.speckData, SPECK_LAYOUT);
    g.setAttribute(SPECK_SHOWN, new InstancedBufferAttribute(new Float32Array(count).fill(1), 1));
  }

  /** The measured looks, once loaded (the far specks take the colours of those already measured). */
  residentsLoaded(): Residents | null {
    return this.residents;
  }

  /** Bytes held: the stand-ins' instances, the residents' measures, the figures and the population's caches (memory watchdog). */
  bytes(): number {
    let n = this.data.byteLength + this.speckData.byteLength * 1.25 + (this.residents?.heldBytes() ?? 0) + this.people.size * 400 + lifeBytes(this.habitat);
    for (const one of this.people.values()) n += one.figure?.figure?.bytes() ?? 0;
    return n;
  }

  /** Give memory back: the measures of people not in the area are made again when needed. */
  shed(): void {
    this.residents?.forget();
  }

  /** The debug menu's line. */
  info(): string {
    return `people: ${this.people.size} up within ${(CROWD_RANGE / 1000).toFixed(1)} km · ${this.figuresDrawn} figures (${this.loading} loading) · ${this.drawn} stand-ins · ${this.specksDrawn} specks · ${this.waiting} waiting for their look · handover holes ${this.holes}, frames with holes ${this.holeFrames} · figure levels made in ${this.slowestLevels.toFixed(0)} ms at most`;
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.people.keys()]) this.letGo(key);
    if (this.mesh) freeMesh(this.mesh);
    if (this.speckMesh) freeMesh(this.speckMesh);
    this.mesh = this.speckMesh = null;
    this.group.removeFromParent();
  }
}

/** What someone is doing, as both levels show it. */
function doingOf(p: Person, who: Resident, foot: Footing): Doing {
  if (foot.swim) return { pose: foot.pose, swim: true, anim: { move: 'swim' } };
  if (p.moving) return { pose: foot.pose, swim: false, anim: { move: 'walk' } };
  const clips = STILL[p.activity];
  if (!clips) return { pose: foot.pose, swim: false, anim: { move: 'idle' } };
  const pick = clips[Math.floor(hashToFloat(hash3i(who.id, 29, p.outing, 0)) * clips.length)];
  return { pose: foot.pose, swim: false, anim: { move: 'idle', pose: pick } };
}

const dist = (a: Vec3, b: Vec3): number => v3len(v3sub(a, b));

/** Draw the first n instances of a mesh, uploading only those. */
function upload(mesh: Mesh, buffer: InstancedInterleavedBuffer, n: number, stride: number): void {
  (mesh.geometry as InstancedBufferGeometry).instanceCount = n;
  buffer.needsUpdate = true;
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, n * stride);
}

/** The levels of detail a figure is drawn at: Actors' levels that draw its parts separately (not merged), finest first. */
const figureLevels = (lods: readonly LodDef[]): number[] => lods.flatMap((l, i) => (l.merge ? [] : [i]));
