/**
 * The transport capsule the player calls through their link (Arnd 2026-10-23: "the player can call a cap easily ...
 * just let him choose some destinations"; the pod: gen/capsules.ts, its flight: world/capFlight.ts, getting in and out:
 * world/mount.ts). One capsule, the player's own while they use it:
 *
 *   called      a worker finds open ground near the player (`landingNear`) and plans the way in from where the pod
 *               hovers nearby (`awayFrom`); it flies in, sets down and opens its door;
 *   boarding    clicked, the player's body walks round to the door, steps up, goes to the back bench and sits down;
 *   seated      the door shuts; the link asks where to (`capDestinations`), a worker plans the way (`planFlight`);
 *   riding      the pod flies it, the passenger seated, banked into what they feel (`flightAt`);
 *   alighting   at the far pad the door opens, the body stands up, walks out and steps down; the player is on foot;
 *   leaving     the pod waits a moment, shuts its door and flies off empty, out of sight.
 *
 * Everything heavy runs in the workers (the pod's shapes, the landing search, the flight plans); the meshes are
 * uploaded once and their CPU copies let go. Nothing is random: where a pod comes from is seeded by the habitat and
 * how many calls came before.
 */
import { Group, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { deriveSeed, hash3i, hashToFloat, v3dot, v3norm, v3sub, type Vec3 } from '@futuremagic/core';
import { fromWorld, toView, type Habitat } from '../blueprint';
import { capDestinations, capLayout, capStopsOf, doorPlace, overFloor, type CapDestination, type CapLayout, type CapPad } from '../gen/capsules';
import { intoPlace, mappedBytes, outOfPlace, type MappedArrays, type Place } from '../gen/shapes';
import type { Terrain } from '../gen/terrain';
import { handrailOf } from '../gen/lifts';
import { awayFrom, cruiseClear, flightAt, type Flight, type FlightState } from '../world/capFlight';
import { alighting, boarding, mountPose, seatedPose, stepsSeconds, type MountPose, type MountStep } from '../world/mount';
import { apparentAcceleration } from '../world/motion';
import type { LinkChoice, LinkLine, LinkOffer, LinkService, LinkStatus } from '../link';
import type { WorkerPool } from '../workers/pool';
import { axesOf, builtGeometry, freeMesh, posedMesh, setPose, uploadStatic } from './geometry';
import { BUILT, CAP_GLASS } from './materials';

/** Where the capsule is in its work for the player. */
export type CapPhase = 'idle' | 'finding' | 'coming' | 'waiting' | 'boarding' | 'seated' | 'planning' | 'riding' | 'alighting' | 'parked' | 'leaving';

/** The passenger as the view poses them: feet and facing (world), the pod's up, and the body's pose in the pod. */
export interface Passenger {
  feet: Vec3;
  front: Vec3;
  up: Vec3;
  pose: MountPose;
}

/** The capsule's word to the view at the end of a step: the passenger is out and stands here, facing so. */
export interface Out {
  feet: Vec3;
  front: Vec3;
}

/** How long the door takes to open all the way (s); walking pace getting in and out (m/s). */
const DOOR_SECONDS = 1.6;
const WALK = 1.3;
/** One may get in from this many handrails from the door; after one gets out the pod waits this long before it goes (s). */
const BOARD_FROM = 14;
const LINGER = 4;
/** A called pod sets down at least this many handrails from the one who called it. */
const NOT_ON_TOP = 4;
/** Where no open ground is near, a called pod waits at a capsule stop up to this many times `reach` away. */
const STOP_WALK = 5;
/** Getting in, one walks round the pod this far clear of its widest (m). */
const CLEAR_WALK = 0.7;
/** The capsule's own small Mind, as it speaks in the link. */
const MIND = 'Capsule';
/** A capsule's state on the CPU: its flight plan's samples (bytes each), besides its meshes. */
const SAMPLE_BYTES = 8 * 3 * 2 + 8 * 2;

interface Drawn {
  body: Mesh;
  glass: Mesh;
  doorBody: Mesh;
  doorGlass: Mesh;
  bytes: number;
}

interface Asked { id: number }

export class CapsuleView {
  readonly group = new Group();
  phase: CapPhase = 'idle';
  /** Where it is going with the player, once chosen. */
  destination: CapDestination | null = null;
  private drawn: Drawn | null = null;
  private building: Promise<Drawn | null> | null = null;
  private readonly layout: CapLayout;
  /** Where it stands (or, flying, the pad it flies to), its flight and how far along it is (s). */
  private pad: CapPad | null = null;
  private flight: Flight | null = null;
  private elapsed = 0;
  /** The door's opening (0 shut, 1 open) and where it is going. */
  private door = 0;
  private doorWant = 0;
  /** Getting in or out: the steps and how far into them (s). */
  private steps: MountStep[] | null = null;
  private stepAt = 0;
  private wait = 0;
  /** Leaving, it holds in the air (turned back on its way) rather than on a pad while its way off is planned. */
  private aloft = false;
  /** Each call and plan is numbered: an answer to one given up is dropped. */
  private asked: Asked = { id: 0 };
  private calls = 0;
  private destinations: CapDestination[] | null = null;
  private disposed = false;

  constructor(readonly habitat: Habitat, private readonly terrain: Terrain, private readonly stage: Stage, private readonly pool: WorkerPool, private readonly say: (line: LinkLine) => void) {
    this.group.name = 'capsule';
    this.layout = capLayout(habitat);
  }

  /**
   * The places one can ride to (made once, when first asked): every court and harbour, and the landmarks that have a
   * stop (a summit's steep rock may have no ground level enough for one).
   */
  places(): readonly CapDestination[] {
    const stops = capStopsOf(this.terrain);
    return (this.destinations ??= capDestinations(this.terrain).filter((d) => d.group !== 'Landmarks' || stops.of(d)));
  }

  /** Whether the player is in the pod (getting in, seated, riding or getting out). */
  get carrying(): boolean {
    return this.phase === 'boarding' || this.phase === 'seated' || this.phase === 'planning' || this.phase === 'riding' || this.phase === 'alighting';
  }

  /** The pod's frame now (flying: where its flight has it), or null while it is nowhere. */
  podAt(): Place | null {
    if (this.flight && (this.phase === 'coming' || this.phase === 'riding' || this.phase === 'leaving')) return flightAt(this.habitat, this.flight, this.elapsed).place;
    return this.phase === 'idle' || this.phase === 'finding' ? null : this.pad;
  }

  /** What the passenger feels now (m/s², the way it pulls), or null when no one is aboard. */
  feel(): { felt: Vec3; weight: number } | null {
    if (!this.carrying) return null;
    if (this.phase === 'riding' && this.flight) { const f: FlightState = flightAt(this.habitat, this.flight, this.elapsed); return { felt: f.felt, weight: f.weight }; }
    const p = this.podAt();
    if (!p) return null;
    const felt = apparentAcceleration(this.habitat, p.at, [0, 0, 0]);
    return { felt, weight: Math.hypot(...felt) };
  }

  /** Where the pod will set the player down, while it is on its way there and the end is near (s), for the ground to be readied. */
  landingSoon(within: number): Vec3 | null {
    return this.phase === 'riding' && this.flight && this.flight.seconds - this.elapsed < within ? this.flight.to.at : null;
  }

  /** Call the pod to (θ, s), where the player stands. Says why when it cannot come. */
  async call(theta: number, s: number): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'leaving' && this.phase !== 'parked') return;
    // Still on its pad (or about to leave it): it stays and opens up again.
    if (this.phase === 'parked' || (this.phase === 'leaving' && !this.flight && !this.aloft)) {
      this.ask();
      this.phase = 'waiting';
      this.doorWant = 1;
      this.say({ from: MIND, text: 'Still here. Click me to get in.' });
      return;
    }
    const h = this.habitat, hr = handrailOf(h), caps = h.params.life.caps, ask = this.ask();
    const comingBack = this.phase === 'leaving' ? this.podAt() : null;
    this.phase = 'finding';
    void this.meshes();
    const a = await this.pool.job({ kind: 'capPad', params: h.params, theta, s, reach: caps.reach, least: NOT_ON_TOP * hr, orStop: STOP_WALK * caps.reach });
    if (!this.current(ask)) return;
    const pad = 'kind' in a && a.kind === 'capPad' ? a.pad : null;
    if (!pad) { this.phase = 'idle'; this.say({ from: MIND, text: 'There is no open ground near you to set down on. Walk on a little and call again.' }); return; }
    const at = fromWorld(h.profile, ...pad.at), walk = overFloor(h, theta, s, at.theta, at.s);
    if (walk > caps.reach) this.say({ from: MIND, text: `No open ground right here: I will wait at the stop ${Math.round(walk / 10) * 10} m away.` });
    const from = comingBack ?? awayFrom(this.terrain, pad, hashToFloat(hash3i(deriveSeed(h.seed, 'cap call'), this.calls++, 0, 0)));
    const f = await this.planWay(from, pad, true, false);
    if (!f || !this.current(ask) || !(await this.meshes()) || !this.current(ask)) return;
    this.pad = pad;
    this.flight = f;
    this.elapsed = 0;
    this.door = this.doorWant = 0;
    this.phase = 'coming';
    this.say({ from: MIND, text: `On my way. ${seconds(f.seconds)}.` });
  }

  /** Send the pod away (called and not wanted, or the player gets out before it goes anywhere). */
  sendAway(): void {
    if (this.phase === 'seated' || this.phase === 'planning') { this.getOut(); return; }
    if (this.phase === 'finding' || this.phase === 'coming') {
      this.ask();
      // Flying in, it turns back the way it came; still looking for ground, it never shows.
      const p = this.phase === 'coming' ? this.podAt() : null;
      if (p) void this.leave(p, true); else this.phase = 'idle';
      return;
    }
    if (this.phase === 'waiting' || this.phase === 'parked') { this.phase = 'parked'; this.wait = LINGER; }
  }

  /** Get in, from where the player's feet are (world): the body walks round to the door. False when too far or not here. */
  board(feet: Vec3): boolean {
    const p = this.podAt();
    if (this.phase !== 'waiting' && this.phase !== 'parked') return false;
    if (!p) return false;
    const lay = this.layout, hr = handrailOf(this.habitat), local = intoPlace(p, feet);
    if (Math.hypot(local[0] - lay.door.outside[0], local[1] - lay.door.outside[1]) > BOARD_FROM * hr) return false;
    this.steps = boarding(lay.seat, lay.door, [local[0], local[1], 0], WALK, this.around(local));
    this.stepAt = 0;
    this.doorWant = 1;
    this.phase = 'boarding';
    return true;
  }

  /** Points to walk by from `local` (the pod's frame) to its door without going through it: round its nose or tail. */
  private around(local: Vec3): Vec3[] {
    const lay = this.layout, x = lay.halfLength + CLEAR_WALK, y = lay.halfWidth + CLEAR_WALK, sx = local[0] >= 0 ? 1 : -1;
    if (local[1] < -lay.halfWidth) return [];
    const doorSide: Vec3 = [sx * x, -y, 0];
    return local[1] > lay.halfWidth ? [[sx * x, y, 0], doorSide] : [doorSide];
  }

  /** Ride to a destination (seated). */
  async go(dest: CapDestination): Promise<void> {
    if (this.phase !== 'seated' || !this.pad) return;
    const h = this.habitat, from = this.pad, ask = this.ask();
    this.destination = dest;
    this.phase = 'planning';
    const a = await this.pool.job({ kind: 'capPad', params: h.params, theta: dest.theta, s: dest.s, reach: dest.around + h.params.life.caps.reach, least: dest.around, orStop: STOP_WALK * h.params.life.caps.reach });
    if (!this.current(ask)) return;
    const pad = 'kind' in a && a.kind === 'capPad' ? a.pad : null;
    if (!pad) { this.phase = 'seated'; this.destination = null; this.say({ from: MIND, text: `I can find no open ground to set down on near ${dest.title}. Somewhere else?` }); return; }
    const f = await this.planWay(from, pad, false, false);
    if (!f || !this.current(ask)) return;
    this.flight = f;
    this.pad = pad;
    this.elapsed = 0;
    this.phase = 'riding';
    this.say({ from: MIND, text: `${dest.title}. ${minutes(f.seconds)}.` });
  }

  /** Get out where the pod stands (seated, before it goes anywhere). */
  getOut(): void {
    if (this.phase !== 'seated' && this.phase !== 'planning') return;
    this.ask();
    this.destination = null;
    this.alight();
  }

  /** The player was taken away (a jump elsewhere): the pod, empty, goes. */
  letGo(): void {
    if (this.phase === 'idle') return;
    this.ask();
    this.steps = null;
    const p = this.podAt(), flying = this.phase === 'coming' || this.phase === 'riding' || (this.phase === 'leaving' && !!this.flight);
    if (!p || this.phase === 'finding') { this.phase = 'idle'; return; }
    void this.leave(p, flying);
  }

  /** Move on by `dt` real seconds (the pod keeps its own pace whatever the clock's). Returns where the passenger stands once out. */
  step(dt: number): Out | null {
    this.door = this.doorWant > this.door ? Math.min(this.doorWant, this.door + dt / DOOR_SECONDS) : Math.max(this.doorWant, this.door - dt / DOOR_SECONDS);
    const f = this.flight;
    if ((this.phase === 'coming' || this.phase === 'riding' || this.phase === 'leaving') && f) {
      // A ride waits for its door to shut.
      if (this.phase !== 'riding' || this.door <= 0) this.elapsed += dt;
      if (this.elapsed >= f.seconds) {
        this.elapsed = f.seconds;
        if (this.phase === 'coming') { this.phase = 'waiting'; this.doorWant = 1; this.say({ from: MIND, text: 'Here. Click me to get in.' }); }
        else if (this.phase === 'riding') { this.say({ from: MIND, text: `${this.destination?.title ?? 'Here we are'}. Mind the step.` }); this.alight(); }
        else { this.phase = 'idle'; this.flight = null; this.pad = null; }
      }
      return null;
    }
    if (this.phase === 'boarding' && this.steps) {
      this.stepAt += dt;
      if (this.stepAt >= stepsSeconds(this.steps)) {
        this.steps = null;
        this.doorWant = 0;
        this.phase = 'seated';
        this.say({ from: MIND, text: 'Where would you like to go? Open your link (Tab) and choose.' });
      }
      return null;
    }
    if (this.phase === 'alighting' && this.steps) {
      // The door opens first; one stands up as it does.
      this.stepAt += dt;
      if (this.stepAt < stepsSeconds(this.steps)) return null;
      const p = this.podAt()!, last = mountPose(this.steps, this.stepAt);
      this.steps = null;
      this.phase = 'parked';
      this.wait = LINGER;
      this.destination = null;
      return { feet: outOfPlace(p, last.feet), front: wayOutOf(p, last.front) };
    }
    if (this.phase === 'parked') {
      this.wait -= dt;
      if (this.wait > 0) return null;
      this.doorWant = 0;
      if (this.door <= 0) void this.leave(this.pad!, false);
    }
    return null;
  }

  /** The passenger now, or null when no one is aboard. */
  passenger(): Passenger | null {
    const p = this.podAt();
    if (!this.carrying || !p) return null;
    const pose = this.steps ? mountPose(this.steps, this.stepAt) : seatedPose(this.layout.seat);
    return { feet: outOfPlace(p, pose.feet), front: wayOutOf(p, pose.front), up: p.ez, pose };
  }

  /** Whether a line of sight from `eye` along `ray` (unit, world) meets the pod (its box), within `most` m. */
  hit(eye: Vec3, ray: Vec3, most: number): boolean {
    const p = this.podAt();
    if (!p || this.phase === 'coming' || this.phase === 'leaving') return false;
    const lay = this.layout, o = intoPlace(p, eye), d: Vec3 = [v3dot(ray, p.ex), v3dot(ray, p.ey), v3dot(ray, p.ez)];
    const lo: Vec3 = [-lay.halfLength, -lay.halfWidth, 0], hi: Vec3 = [lay.halfLength, lay.halfWidth, lay.reach];
    let t0 = 0, t1 = most;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
      const a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return false;
    }
    return true;
  }

  /** Pose the pod and its door for the frame (relative to the eye); nowhere, it is hidden. */
  poseAt(eye: Vec3): void {
    const d = this.drawn, p = this.podAt();
    this.group.visible = !!d && !!p;
    if (!d || !p) return;
    const axes = axesOf(p), o = toView(eye, p.at);
    setPose(d.body, axes, o);
    setPose(d.glass, axes, o);
    const hinge = doorPlace(this.layout, this.door), door: Place = { at: outOfPlace(p, hinge.at), ex: wayOutOf(p, hinge.ex), ey: wayOutOf(p, hinge.ey), ez: wayOutOf(p, hinge.ez) };
    const doorAxes = axesOf(door), doorAt = toView(eye, door.at);
    setPose(d.doorBody, doorAxes, doorAt);
    setPose(d.doorGlass, doorAxes, doorAt);
  }

  /** What the link shows of it now: the pod coming, waiting, the ride under way. */
  status(): LinkStatus | null {
    const p = this.podAt(), f = this.flight, left = f ? Math.max(0, f.seconds - this.elapsed) : 0;
    const away = (): void => this.sendAway();
    switch (this.phase) {
      case 'finding': return { from: MIND, title: 'Finding open ground near you', cancel: away };
      case 'coming': return { from: MIND, title: 'Your capsule is on its way', detail: seconds(left), progress: f ? this.elapsed / f.seconds : 0, at: p?.at, mark: `your capsule · ${Math.ceil(left)} s`, cancel: away };
      case 'waiting': return { from: MIND, title: 'Your capsule is here', detail: 'Click it to get in.', at: p ? outOfPlace(p, this.layout.door.outside) : undefined, mark: 'your capsule · click to get in', cancel: away };
      case 'boarding': return { from: MIND, title: 'Getting in' };
      case 'seated': return { from: MIND, title: 'Where to?', detail: 'Open your link (Tab) and choose a place.', cancel: () => this.getOut() };
      case 'planning': return { from: MIND, title: `Planning the way to ${this.destination?.title ?? 'there'}` };
      case 'riding': return {
        from: MIND, title: `To ${this.destination?.title ?? 'your stop'}`, detail: f && this.door > 0 ? 'Closing the door' : `${clock(left)} to go`,
        progress: f ? this.elapsed / f.seconds : 0,
      };
      case 'alighting': return { from: MIND, title: this.destination?.title ?? 'Arrived', detail: 'Getting out' };
      default: return null;
    }
  }

  /** Bytes held: its meshes on the GPU, its flight plan (memory watchdog). */
  bytes(): number {
    return (this.drawn?.bytes ?? 0) + (this.flight ? this.flight.times.length * SAMPLE_BYTES : 0);
  }

  /** The debug menu's line. */
  info(): string {
    const f = this.flight, d = this.destination;
    const ride = f && (this.phase === 'coming' || this.phase === 'riding' || this.phase === 'leaving')
      ? `, ${(f.length / 1000).toFixed(2)} km in ${f.seconds.toFixed(0)} s, ${this.elapsed.toFixed(0)} s gone, nearest the axis ${(f.nearest).toFixed(0)} m, at most ${(f.heaviest / 9.81).toFixed(2)} g` : '';
    return `capsule: ${this.phase}${d ? ` to ${d.title}` : ''}${ride}${this.drawn ? '' : ' (not built yet)'}`;
  }

  dispose(): void {
    this.disposed = true;
    this.ask();
    const d = this.drawn;
    this.drawn = null;
    if (d) for (const m of [d.body, d.glass, d.doorBody, d.doorGlass]) freeMesh(m);
    this.group.removeFromParent();
  }

  /** Begin getting out where it stands: door open, stand up, out. */
  private alight(): void {
    this.flight = null;
    this.steps = alighting(this.layout.seat, this.layout.door, WALK);
    this.stepAt = 0;
    this.doorWant = 1;
    this.phase = 'alighting';
  }

  /**
   * Fly off empty from a place (on its pad, or `airborne`: turned back on its way), out of sight. It holds where it is
   * while the way is planned.
   */
  private async leave(from: Place, airborne: boolean): Promise<void> {
    const ask = this.ask(), h = this.habitat;
    const to = awayFrom(this.terrain, from, hashToFloat(hash3i(deriveSeed(h.seed, 'cap leave'), this.calls, 0, 0)));
    this.phase = 'leaving';
    this.flight = null;
    this.pad = from;
    this.aloft = airborne;
    this.doorWant = 0;
    const f = await this.planWay(from, to, airborne, true);
    if (!this.current(ask)) return;
    if (!f) { this.phase = 'idle'; this.flight = null; this.pad = null; return; }
    this.flight = f;
    this.elapsed = 0;
    this.door = this.doorWant = 0;
  }

  /** A flight planned in a worker, or null if the worker failed. */
  private async planWay(from: Place, to: Place, airborneStart: boolean, airborneEnd: boolean): Promise<Flight | null> {
    const a = await this.pool.job({ kind: 'capFlight', params: this.habitat.params, ends: { from, to, airborneStart, airborneEnd } });
    return 'kind' in a && a.kind === 'capFlight' ? a.flight : null;
  }

  /** A new ask (the ones before are given up). */
  private ask(): Asked {
    this.asked = { id: this.asked.id + 1 };
    return this.asked;
  }

  private current(a: Asked): boolean {
    return !this.disposed && a === this.asked;
  }

  /** The pod's meshes, built in a worker and uploaded once (the CPU copies let go). */
  private meshes(): Promise<Drawn | null> {
    this.building ??= (async () => {
      const a = await this.pool.job({ kind: 'capsule', params: this.habitat.params });
      if (this.disposed || !('kind' in a) || a.kind !== 'capsule') return null;
      const meshOf = (m: MappedArrays, glass: boolean, name: string): Mesh => {
        const x = posedMesh(builtGeometry(m), glass ? CAP_GLASS.material : BUILT.material, name);
        x.frustumCulled = false;
        x.castShadow = !glass;
        if (glass) x.renderOrder = 2;
        return x;
      };
      const all = [meshOf(a.body, false, 'capsule'), meshOf(a.glass, true, 'capsule glass'), meshOf(a.doorBody, false, 'capsule door'), meshOf(a.doorGlass, true, 'capsule door glass')];
      const bytes = [a.body, a.glass, a.doorBody, a.doorGlass].reduce((n, m) => n + mappedBytes(m), 0);
      await Promise.all(all.map((m) => uploadStatic(this.stage, m)));
      if (this.disposed) { for (const m of all) freeMesh(m); return null; }
      for (const m of all) { m.visible = true; this.group.add(m); }
      const [body, glass, doorBody, doorGlass] = all;
      this.drawn = { body, glass, doorBody, doorGlass, bytes };
      return this.drawn;
    })();
    return this.building;
  }
}

/**
 * The capsules' part of the player's link: call one, send it away, choose where to ride (the landmarks, every court,
 * the harbours, nearest first, with how far and about how long), get out. Below the land none can come.
 */
export class CapsuleLink implements LinkService {
  readonly id = 'capsules';
  readonly title = 'Capsules';

  /** `caps`: the view's capsule (a new one per habitat); `where`: the player's feet (world) and whether below the land. */
  constructor(private readonly caps: () => CapsuleView | null, private readonly where: () => { feet: Vec3; below: boolean } | null) {}

  offers(): readonly LinkOffer[] {
    const c = this.caps(), w = this.where();
    if (!c || !w) return [];
    const at = fromWorld(c.habitat.profile, ...w.feet);
    switch (c.phase) {
      case 'idle': case 'leaving': case 'parked':
        if (w.below) return [{ id: 'call', title: 'Call a capsule', detail: 'Capsules fly over the land: take a lift up first.', take: () => {} }];
        return [{ id: 'call', title: 'Call a capsule', detail: 'One comes to you from nearby and sets down on open ground.', take: () => void c.call(at.theta, at.s) }];
      case 'finding': case 'coming': case 'waiting':
        return [{ id: 'away', title: 'Send the capsule away', take: () => c.sendAway() }];
      case 'seated':
        return [{ id: 'go', title: 'Ride to…', detail: 'Landmarks, courts and harbours', choices: this.choices(c, at.theta, at.s), take: (id) => { const d = c.places().find((x) => x.id === id); if (d) void c.go(d); } },
          { id: 'out', title: 'Get out', take: () => c.getOut() }];
      default: return [];
    }
  }

  status(): LinkStatus | null {
    return this.caps()?.status() ?? null;
  }

  /** Every destination with how far it is over the floor and about how long the ride takes. */
  private choices(c: CapsuleView, theta: number, s: number): LinkChoice[] {
    const h = c.habitat, caps = h.params.life.caps, rise = cruiseClear(h);
    return c.places().map((d) => {
      const far = overFloor(h, theta, s, d.theta, d.s);
      // About: the climb and the descent, and the way across at most of the cruise.
      const about = (2 * rise) / caps.climb + far / (0.7 * caps.cruise);
      return { id: d.id, title: d.title, group: d.group, near: far, detail: `${far < 1000 ? `${Math.round(far / 10) * 10} m` : `${(far / 1000).toFixed(1)} km`} · ${minutes(about).replace('About ', 'about ')}` };
    });
  }
}


/** A direction given in a place, in the frame it sits in. */
const wayOutOf = (p: Place, v: Vec3): Vec3 => v3norm(v3sub(outOfPlace(p, v), p.at));

/** "About 40 seconds", "About a minute". */
function seconds(t: number): string {
  if (t < 50) return `About ${Math.max(5, Math.round(t / 5) * 5)} seconds`;
  return minutes(t);
}

/** "About 3 minutes". */
function minutes(t: number): string {
  const m = Math.round(t / 60);
  return m <= 1 ? 'About a minute' : `About ${m} minutes`;
}

/** "2:05". */
function clock(t: number): string {
  const s = Math.ceil(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
