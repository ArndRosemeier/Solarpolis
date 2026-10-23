/**
 * The habitat keeping the player from being hurt by a fall (design "Nobody falls far"; the plan: world/catch.ts). Each
 * frame on foot it watches the body: while it is off the ground it asks a worker, a few times a second, whether the
 * fall would hurt and how it is caught (`catchFor`: the fall foreseen, the guardians posted near, else the ground's
 * bag). Once a catch is planned the body is the plan's: falling as foreseen, held, carried or let down from the bag,
 * set on its feet; the view stands it up there. The guardians are drawn by the drones' view as drones of the fleet
 * (`fliers`), the bag here: one pale pillow of fabric (the PROP kind), up out of the ground, squashed under the body,
 * folded back in. The habitat's Mind says one line through the link, and the catch shows on the link's card.
 */
import { Float32BufferAttribute, Group, InstancedMesh, Matrix4, SphereGeometry, Vector3 } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3dot, v3norm } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { designsOf } from '../gen/drone';
import type { Flier } from '../sim';
import { bagAt, catchAt, type CatchOptions, type CatchPhase, type CatchPlan, type SetDown } from '../world/catch';
import { spinwardAt, upAt } from '../world/motion';
import { HUMAN_DRAG } from '../physics/character';
import type { LinkLine, LinkStatus } from '../link';
import type { WorkerPool } from '../workers/pool';
import { dropUploaded, freeMesh } from './geometry';
import { PROP } from './materials';

/** While off the ground the worker is asked this often (s); the edge left is set down on this far back from it (m). */
const ASK_EVERY = 0.25;
const BACK_FROM_EDGE = 1.2;
/** The guardians stay on their posts, drawn, until the player is this far from them (m). */
const PERCHED_WITHIN = 250;
/** Faster than this (m/s) a guardian faces its way; slower, it keeps its heading. */
const TURNS_AT = 0.3;
/** The bag's fabric: pale, with darker seams every so many degrees round it. */
const FABRIC: Vec3 = [0.82, 0.8, 0.74];
const SEAM: Vec3 = [0.55, 0.53, 0.49];
const SEAMS = 12;

/** What the body does this frame while the plan has it, and where it is set down once it is. */
export interface Held {
  feet: Vec3;
  phase: CatchPhase;
  /** Set once, the frame the bands let go: where the player now stands. */
  released: SetDown | null;
}

export class Guardians {
  readonly group = new Group();
  private plan: CatchPlan | null = null;
  private t = 0;
  /** Whether the plan's catch has let the body go (the guardians fly home, the bag folds away). */
  private freed = false;
  private asking = false;
  private clock = 0;
  private sinceAsk = Infinity;
  private lastGround: Vec3 | null = null;
  private airborne = false;
  private catches = 0;
  private headings: number[] = [];
  private bag: InstancedMesh | null = null;
  /** What the bag's mesh holds on the GPU (B). */
  private bagBytes = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly stage: Stage, private readonly pool: WorkerPool, private readonly say: (line: LinkLine) => void) {
    this.group.name = 'guardians';
    void this.makeBag();
  }

  /** Whether a catch has the body now (from the moment it is planned until the bands let go). */
  get holding(): boolean {
    return !!this.plan && !this.freed;
  }

  /**
   * Watch the player's body on foot (null: not on foot, flying, riding, below): while it is off the ground ask
   * whether its fall would hurt. Returns true the frame a catch takes the body over (the view then lets go of it).
   */
  watch(dt: number, body: { feet: Vec3; v: Vec3; grounded: boolean; swimming: boolean } | null): boolean {
    this.clock += dt;
    this.sinceAsk += dt;
    if (this.holding) return false;
    if (!body || body.swimming) { this.airborne = false; return false; }
    if (body.grounded) { this.lastGround = [...body.feet]; this.airborne = false; return false; }
    if (!this.airborne) { this.airborne = true; this.sinceAsk = Infinity; }
    if (this.asking || this.sinceAsk < ASK_EVERY) return false;
    this.sinceAsk = 0;
    void this.foresee(body.feet, body.v, { late: this.late, home: this.late > 0 ? null : this.homeFor(body.v) });
    return false;
  }

  /** How far over the ground (m) the next fall is caught, the guardians going along from its start (the Long Drop); 0: at once. */
  late = 0;

  /** What the catch does with the body now, while it has it. */
  get phase(): CatchPhase | null {
    return this.holding ? catchAt(this.plan!, this.t).phase : null;
  }

  /** Forget any catch under way (the player was taken elsewhere). */
  cancel(): void {
    this.plan = null;
    this.freed = false;
    this.asking = false;
    this.airborne = false;
  }

  /** Where the body would go back to: the ground it last stood on, a little back from the edge it left by. */
  private homeFor(v: Vec3): { theta: number; s: number } | null {
    const g = this.lastGround;
    if (!g) return null;
    const up = upAt(g) ?? [1, 0, 0], flat: Vec3 = [v[0] - up[0] * v3dot(v, up), v[1] - up[1] * v3dot(v, up), v[2] - up[2] * v3dot(v, up)];
    const back = Math.hypot(...flat) > 0.2 ? v3norm(flat) : [0, 0, 0] as Vec3;
    const at = fromWorld(this.habitat.profile, g[0] - back[0] * BACK_FROM_EDGE, g[1] - back[1] * BACK_FROM_EDGE, g[2] - back[2] * BACK_FROM_EDGE);
    return { theta: at.theta, s: at.s };
  }

  private async foresee(p: Vec3, v: Vec3, options: CatchOptions): Promise<void> {
    this.asking = true;
    const sent = this.clock;
    const a = await this.pool.job({ kind: 'catch', params: this.habitat.params, p, v, drag: HUMAN_DRAG, options });
    if (!this.asking || this.disposed) return;
    this.asking = false;
    const plan = 'kind' in a && a.kind === 'catch' ? a.plan : null;
    // Landed meanwhile (or not a fall that hurts): nothing to do.
    if (!plan || !this.airborne) return;
    this.begin(plan, this.clock - sent);
  }

  /** A catch takes the body over, `t` s into its plan (the worker's answer took that long). */
  private begin(plan: CatchPlan, t: number): void {
    this.plan = plan;
    this.t = t;
    this.freed = false;
    this.started = true;
    this.headings = plan.guardians.map(() => 0);
    this.late = 0;
    const mind = this.habitat.params.mind;
    if (plan.late) this.say({ from: mind, text: `The Long Drop. Enjoy the view: they will take you ${Math.round(this.habitat.params.life.guard.late * this.habitat.radius / 10) * 10} m over the ground.` });
    else if (!plan.bag && plan.meet > 4) this.say({ from: mind, text: 'I have you. Two guardians are on their way.' });
  }
  private started = false;

  /** Whether a catch began since the last ask (the view lets go of the body). */
  takeStarted(): boolean {
    const s = this.started;
    this.started = false;
    return s;
  }

  /** Step the catch on by dt: where the body is, and where it stands once let go (once). */
  step(dt: number): Held | null {
    const plan = this.plan;
    if (!plan) return null;
    this.t += dt;
    // Let go: the guardians fly home and stay drawn on their posts until the player has gone (`fliers`).
    if (this.freed) return null;
    const state = catchAt(plan, this.t);
    if (this.t < plan.end) return { feet: state.feet, phase: state.phase, released: null };
    this.freed = true;
    this.catches++;
    this.say({ from: this.habitat.params.mind, text: this.lineAfter(plan) });
    return { feet: plan.setDown.feet, phase: 'released', released: plan.setDown };
  }

  /** The Mind's one line once the body stands again. */
  private lineAfter(plan: CatchPlan): string {
    if (plan.bag) return 'Sorry about the bag. No guardian was close enough.';
    if (plan.late) {
      const fell = plan.meet, km = plan.depth / 1000;
      return `Welcome down. ${km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(plan.depth)} m`} in ${fell >= 90 ? `${(fell / 60).toFixed(1)} minutes` : `${Math.round(fell)} seconds`}.`;
    }
    return this.catches === 1 ? `Caught. ${Math.round(plan.depth)} m would have hurt.` : `Caught again. That makes ${this.catches}.`;
  }

  /** Where the body is set down, once the carry nears its end (`soon` s), for the physics' ground; else null. */
  groundSoon(soon: number): Vec3 | null {
    const p = this.plan;
    return p && !this.freed && this.t >= p.end - soon ? p.setDown.feet : null;
  }

  /** What the body feels now (m/s²): nothing falling, the bands' pull braking, the spin's weight held or carried. */
  feel(): number | null {
    const p = this.plan;
    if (!p || this.freed) return null;
    const g0 = this.habitat.gravityAt(this.habitat.radius), feet = catchAt(p, this.t).feet;
    if (this.t < p.meet) return 0;
    if (this.t < p.stop) return p.felt * g0;
    return this.habitat.gravityAt(Math.hypot(feet[0], feet[1]));
  }

  /** The guardians of the catch now, as drones the drones' view draws (resting on their posts until the player is far). */
  fliers(eye: Vec3): Flier[] {
    const p = this.plan;
    if (!p) return [];
    const state = catchAt(p, this.t), designs = designsOf(this.habitat, 'guardian'), home = this.freed && this.t >= p.home;
    // Home and the player gone from them all (the bag folded away): the catch is over.
    if (home && state.guardians.every((g) => Math.hypot(g.at[0] - eye[0], g.at[1] - eye[1], g.at[2] - eye[2]) > PERCHED_WITHIN)) {
      this.plan = null;
      return [];
    }
    return state.guardians.map((g, k) => this.flierOf(k, k % designs, g.at, g.v, this.t <= p.launch || home));
  }

  /** A guardian as a drone of the fleet: its lowest point (the bands' top) at `at`, facing its way. */
  private flierOf(k: number, design: number, at: Vec3, v: Vec3, resting: boolean): Flier {
    const profile = this.habitat.profile, loc = fromWorld(profile, ...at);
    const ahead = toWorld(profile, { ...loc, s: Math.min(profile.length, loc.s + 0.5) }), behind = toWorld(profile, { ...loc, s: Math.max(0, loc.s - 0.5) });
    const along = v3norm([ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]]), spin = spinwardAt(at) ?? [0, 1, 0], up = upAt(at) ?? [1, 0, 0];
    const a = v3dot(v, along), b = v3dot(v, spin), flat = Math.hypot(a, b);
    if (flat > TURNS_AT) this.headings[k] = Math.atan2(b, a);
    return { id: -100 - k, role: 'guardian', design, theta: loc.theta, s: loc.s, h: loc.h, heading: this.headings[k] ?? 0, speed: flat, climb: v3dot(v, up), doing: resting ? 'rest' : 'fly' };
  }

  /** Pose the bag for the frame (relative to the eye), or hide it. */
  poseBag(eye: Vec3): void {
    const mesh = this.bag, p = this.plan, b = p?.bag, size = p ? bagAt(p, this.t) : null;
    if (!mesh) return;
    if (!b || !size) { mesh.count = 0; return; }
    const up = new Vector3(...b.up), front = new Vector3(...(spinwardAt(b.site) ?? [0, 1, 0])), right = new Vector3().crossVectors(up, front);
    const m = new Matrix4().makeBasis(right.multiplyScalar(size.radius), up.multiplyScalar(size.height), front.multiplyScalar(size.radius));
    m.setPosition(b.site[0] - eye[0], b.site[1] - eye[1], b.site[2] - eye[2]);
    mesh.setMatrixAt(0, m);
    mesh.count = 1;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** The link's card while a catch has the body. */
  status(): LinkStatus | null {
    const p = this.plan;
    if (!p || this.freed) return null;
    const from = this.habitat.params.mind, state = catchAt(p, this.t), g = state.guardians[0];
    if (state.phase === 'falling') {
      if (p.bag) return { from, title: 'Falling', detail: 'No guardian near enough. Hold on.' };
      const left = Math.max(0, p.meet - this.t);
      return p.late
        ? { from, title: 'The Long Drop', detail: `${Math.ceil(left)} s to the catch`, progress: Math.min(1, this.t / p.meet) }
        : { from, title: 'Falling', detail: 'Guardians coming', at: g?.at, mark: 'guardian' };
    }
    const title = state.phase === 'closing' ? 'Guardians beside you' : state.phase === 'holding' ? (p.bag ? 'On the bag' : 'Caught')
      : state.phase === 'carrying' ? 'Carrying you back' : 'Setting you down';
    return { from, title, progress: Math.min(1, this.t / p.end) };
  }

  /** The debug menu's line. */
  info(): string {
    const p = this.plan;
    if (!p) return `catches: ${this.catches}${this.asking ? ', asking' : ''}`;
    const state = catchAt(p, this.t);
    return `catch: ${p.bag ? `bag ${p.bag.height.toFixed(1)} m` : `${p.guardians.length} guardians`}${p.late ? ', late' : ''}, ${state.phase} at ${this.t.toFixed(1)} of ${p.end.toFixed(1)} s, brake ${p.felt.toFixed(1)} g, fall ${Math.round(p.depth)} m · catches ${this.catches}`;
  }

  /** The bag's one mesh: a pillow of fabric with seams, on the GPU before any fall needs it. */
  private async makeBag(): Promise<void> {
    const g = new SphereGeometry(1, 48, 16, 0, 2 * Math.PI, 0, Math.PI / 2).deleteAttribute('uv');
    const pos = g.getAttribute('position'), colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      // Fuller at the shoulders, flatter on top: a pillow, not a ball.
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), bulge = 1 + 0.12 * Math.sin(Math.PI * y);
      pos.setXYZ(k, x * bulge, Math.pow(y, 0.7), z * bulge);
      const turn = (Math.atan2(z, x) / (2 * Math.PI)) * SEAMS, seam = Math.abs(turn - Math.round(turn)) < 0.04 && y < 0.97;
      colors.set(seam ? SEAM : FABRIC, k * 3);
    }
    g.computeVertexNormals();
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const mesh = new InstancedMesh(g, PROP.material, 1);
    mesh.name = 'airbag';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 0;
    let bytes = mesh.instanceMatrix.array.byteLength + (g.index?.array.byteLength ?? 0);
    for (const name of ['position', 'normal', 'color']) bytes += g.getAttribute(name).array.byteLength;
    await this.stage.prepare(mesh, { everyCaster: true });
    if (this.disposed) { freeMesh(mesh); return; }
    // Never changed again on the CPU: the GPU's copy is the one kept.
    dropUploaded(mesh, this.stage.renderer);
    this.bag = mesh;
    this.bagBytes = bytes;
    this.group.add(mesh);
  }

  /** Bytes held (memory watchdog): the bag's mesh. */
  bytes(): number {
    return this.bag ? this.bagBytes : 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.bag) freeMesh(this.bag);
    this.bag = null;
    this.group.removeFromParent();
  }
}
