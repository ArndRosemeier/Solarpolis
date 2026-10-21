/**
 * The view from inside: the one renderer (WebGPU only), the Stage, the terrain tiles and the sunline, seen by a walker
 * on the ground or a flyer in the air. Everything is drawn relative to the eye (`toView`): the camera sits at the origin
 * and the world moves. Hold the right mouse button to look around (the pointer stays free for clicking things);
 * W A S D or the arrow keys to move, Shift to run, Space to jump; F takes off or lands, and in the air E or Space climbs,
 * Q or C sinks. On foot the physics carries the player (`physics/character.ts`): up is toward the axis, and gravity
 * is the spin's. The player is an Actors human (`render/actors`); V looks at them from behind, V again from their eyes.
 */
import { Color, CylinderGeometry, Mesh, PerspectiveCamera, Scene, SphereGeometry, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer } from '@futuremagic/stage';
import { deriveSeed, v3dot, v3madd, v3norm } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { Walker, type View } from '../world/walker';
import { Flyer } from '../world/flyer';
import { PhysicsWorld } from '../physics/world';
import { HUMAN, type Character } from '../physics/character';
import { Figure, type MoveState } from './actors/figure';
import { playerLook } from './actors/looks';
import { addLights, key, shineOn } from './lights';
import { WorkerPool } from '../workers/pool';
import { BALL, SUNLINE, air, allKinds, setAir, setEmission, setSunline, standInAttribute, view } from './materials';
import { dayPhase, emissionMean, nearestLit, sunlineEmission, sunlineNorm, EMISSION_SAMPLES } from '../world/sunline';
import { densityFalloff, seenMid } from '../world/air';
import { TerrainView, describeLayout } from './terrain';
import { FrameLoop, dragToLook, draw, fitCanvas, moveKeys } from './surface';

/** Running is this many times the walking speed. */
const RUN = 8;
/** The physics' ground patch: side (m) and cell (m). */
const PATCH_SIZE = 192;
const PATCH_CELL = 1;
/** The player stops walking this share of the patch's size from its centre until the next patch arrives. */
const PATCH_EDGE = 0.4;
/** One sphere shared by every test ball (the kind's attributes: position and normal). */
const BALL_GEOMETRY = new SphereGeometry(0.25, 20, 14).deleteAttribute('uv');
/** Clock seconds per real second by default: a day in about 24 minutes, so the sun is seen to travel. */
const DAY_SPEED = 60;
/**
 * The camera on foot, set with the mouse wheel: from the player's eyes (0) out to `CHASE_FAR` metres behind the head,
 * rising to `CHASE_UP` above it by `CHASE_RISE` metres back. The nearest view from behind is `CHASE_NEAR`; one notch
 * further in goes back to the eyes. A notch moves it by a share (`CHASE_STEP` per unit of `deltaY`), and it glides
 * there (`CHASE_GLIDE`, 1/s). The body shows once the camera is `HEAD_CLEAR` behind the eyes.
 */
const CHASE_NEAR = 1.2;
const HEAD_CLEAR = 0.3;
const CHASE_FAR = 12;
const CHASE_UP = 0.4;
const CHASE_RISE = 3.5;
const CHASE_STEP = 0.003;
const CHASE_GLIDE = 10;
/** The layer the player's body is drawn on: the shadow map always sees it, the camera only from behind. */
const BODY_LAYER = 1;

export class InteriorView {
  readonly canvas = document.createElement('canvas');
  readonly walker: Walker;
  private renderer!: WebGPURenderer;
  private stage!: Stage;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.3, 1e6);
  private readonly pool = new WorkerPool();
  private terrain: Terrain;
  private tiles: TerrainView | null = null;
  private sunline: Mesh | null = null;
  /** In the air, or null on foot. */
  private flyer: Flyer | null = null;
  private readonly loop = new FrameLoop((dt) => this.frame(dt), (e) => {
    if (e.code === 'KeyF' && !e.repeat) this.toggleFlying();
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jump = true; }
  });
  /** Travel speed multiplier from the debug menu. */
  boost = 1;
  /**
   * The habitat's clock (s since its first dawn) and how many clock seconds pass per real second. The clock is the
   * game's, advanced by frame time here; nothing reads the wall clock (CLAUDE.md, rule 5).
   */
  time = 0;
  timeScale = DAY_SPEED;
  private readonly emission = new Float32Array(EMISSION_SAMPLES);
  /** The physics bubble around the player, made on first use (Rapier loads then), and its ground patch request. */
  private physics: PhysicsWorld | null = null;
  private physicsLoading: Promise<PhysicsWorld> | null = null;
  private patchAsked = false;
  /** The player's body on foot, once the physics has ground under it; null while flying. */
  private character: Character | null = null;
  private jump = false;
  /** The player's body (an Actors human), once loaded, and whether the camera looks at it from behind. */
  private figure: Figure | null = null;
  /** How far behind the head the camera wants to be, and where it is on its way (m). */
  private chaseGoal = 0;
  private chase = 0;
  private norm = 1;
  private readonly balls = new Map<number, Mesh>();
  /** The last dropped ball: where it was let go (θ) and from how high, and how far it landed behind, once it has. */
  private drop: { id: number; theta: number; height: number; landed: number | null } | null = null;

  private constructor(private habitat: Habitat) {
    // Start in the morning: a quarter of the way through the daylight hours.
    this.time = habitat.params.day.length * habitat.params.day.daylight * 0.25;
    this.terrain = makeTerrain(habitat);
    this.walker = new Walker(habitat.profile, undefined, this.terrain.standAt);
    this.canvas.className = 'view-canvas';
    // Before the warm-up: the lights are part of every lit shader's key.
    addLights(this.scene);
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat): Promise<InteriorView> {
    const v = new InteriorView(habitat);
    // Reversed depth: from a blade of grass at the feet to the far endcap tens of kilometres away, in one view.
    v.renderer = (await createRenderer(v.canvas, { backends: 'webgpu', depth: 'reversed' })).renderer;
    // The near shadow map (render/lights.ts): the key light's, cast by the body and balls.
    v.renderer.shadowMap.enabled = true;
    v.scene.background = new Color(...(air.haze.value as Color).toArray());
    v.stage = new Stage(v.renderer, v.scene, v.camera, { kinds: allKinds, attribute: standInAttribute });
    v.stage.shadowCamera = key.shadow.camera;
    v.place();
    await v.stage.warmUp();
    await v.build();
    v.listen();
    void v.physicsReady();
    void v.loadPlayer();
    return v;
  }

  /** Load the player's body (the same person for the same world seed) and put it in, hidden until seen. */
  private async loadPlayer(): Promise<void> {
    const figure = await Figure.load(await playerLook(deriveSeed(this.habitat.params.seed, 'player')));
    figure.object.visible = false;
    figure.object.traverse((o) => { o.layers.set(BODY_LAYER); o.castShadow = true; o.receiveShadow = true; });
    key.shadow.camera.layers.enable(BODY_LAYER);
    await this.stage.add(figure.object);
    this.figure = figure;
  }

  /** Bytes the player's body holds (memory watchdog). */
  bodyBytes(): number {
    return this.figure?.bytes() ?? 0;
  }

  /** Bytes of geometry this view holds (memory watchdog). */
  bytes(): number {
    return this.tiles?.bytes() ?? 0;
  }

  /** Give memory back (memory watchdog): drop every cached tile not on screen. */
  shed(): void {
    this.tiles?.shed();
  }

  /** Lines for the debug menu. */
  info(): string {
    const a = this.flyer ? fromWorld(this.habitat.profile, ...this.flyer.eye) : this.walker.at;
    const c = this.character, g = this.habitat.gravityAt(Math.hypot(...this.current().eye.slice(0, 2) as [number, number]));
    const mode = this.flyer ? `flying ${this.flyer.clearance().toFixed(0)} m up`
      : !c ? 'on foot (waiting for the physics)' : `on foot, ${c.swimming ? 'swimming' : c.grounded ? 'standing' : 'in the air'}, gravity ${(g / 9.81).toFixed(2)} g`;
    return [
      this.stage.hudLine(),
      `${this.tiles?.info() ?? 'terrain: none'} · ${describeLayout(this.terrain)} · ${this.pool.workers} workers`,
      `θ ${(a.theta * 180 / Math.PI).toFixed(1)}°, s ${(a.s / 1000).toFixed(2)} of ${(this.habitat.profile.length / 1000).toFixed(2)} km, ground ${this.terrain.standAt(a.theta, a.s).toFixed(1)} m, ${mode}`,
    ].join('\n');
  }

  /** The sunline's light at the clock's hour. */
  private shine(): void {
    sunlineEmission(this.habitat, this.time, this.emission);
    setEmission(this.emission, emissionMean(this.emission));
  }

  /** The hour, for the debug menu: day number, clock time on a 24-hour face, and how far the sun has travelled. */
  clockLine(): string {
    const d = this.habitat.params.day, phase = dayPhase(this.habitat, this.time);
    const hours = (phase * 24 + 6) % 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    const sun = phase < d.daylight ? `sun ${(100 * phase / d.daylight).toFixed(0)}% of the way to the port end` : 'night';
    return `day ${Math.floor(this.time / d.length) + 1}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (dawn at 06:00), ${sun}, clock ×${this.timeScale}`;
  }

  /** Move the clock on by `seconds` (debug menu). */
  skip(seconds: number): void {
    this.time += seconds;
  }

  /** Let a ball fall from `height` metres, a few steps ahead: it lands behind the spot below it (Coriolis). */
  async dropBall(height: number): Promise<void> {
    const physics = await this.physicsReady();
    const v = this.current();
    const ahead = fromWorld(this.habitat.profile, v.eye[0] + v.look[0] * 4, v.eye[1] + v.look[1] * 4, v.eye[2] + v.look[2] * 4);
    const radius = 0.25;
    const ground = this.terrain.standAt(ahead.theta, ahead.s);
    const id = physics.addBall(toWorld(this.habitat.profile, { theta: ahead.theta, s: ahead.s, h: ground + height + radius }), [0, 0, 0], radius);
    const mesh = new Mesh(BALL_GEOMETRY, BALL.material);
    mesh.name = `ball ${id}`;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    this.balls.set(id, mesh);
    await this.stage.add(mesh);
    this.drop = { id, theta: ahead.theta, height, landed: null };
  }

  /** Remove every ball. */
  clearBalls(): void {
    for (const [id, mesh] of this.balls) { this.physics?.remove(id); this.stage.remove(mesh); }
    this.balls.clear();
    this.drop = null;
  }

  /** The physics line for the debug menu. */
  physicsLine(): string {
    if (!this.physics) return 'physics: not started (drop a ball)';
    const d = this.drop;
    const last = !d ? '' : d.landed === null ? `, ball falling from ${d.height} m`
      : `, last ball from ${d.height} m landed ${d.landed.toFixed(2)} m antispinward (blueprint: ${this.habitat.dropOffset(d.height).toFixed(2)} m)`;
    return `physics: ${this.physics.count} bodies${last}`;
  }

  private physicsReady(): Promise<PhysicsWorld> {
    this.physicsLoading ??= PhysicsWorld.create(this.habitat).then(async (p) => {
      this.physics = p;
      await this.groundFor(this.current().eye);
      return p;
    });
    return this.physicsLoading;
  }

  /** Ask the workers for the ground patch under `eye` and stand the physics on it. */
  private async groundFor(eye: Vec3): Promise<void> {
    if (!this.physics || this.patchAsked) return;
    this.patchAsked = true;
    const at = fromWorld(this.habitat.profile, ...eye);
    const answer = await this.pool.job({ kind: 'patch', params: this.habitat.params, theta: at.theta, s: at.s, size: PATCH_SIZE, cell: PATCH_CELL });
    if ('patch' in answer && this.physics) this.physics.setGround(answer.patch);
    this.patchAsked = false;
    this.standUp();
  }

  /** Give the walker a body once the physics has ground under it (at the start, and after landing). */
  private standUp(): void {
    const p = this.physics;
    if (!p || this.flyer || this.character) return;
    const { theta, s } = this.walker.at;
    const feet = toWorld(this.habitat.profile, { theta, s, h: this.terrain.standAt(theta, s) + 0.05 });
    if (p.offPatch(feet, PATCH_EDGE)) return;
    this.character = p.addCharacter(feet, this.terrain.waterDepth);
  }

  /** Step the physics and put the balls where it says. */
  private simulate(dt: number, eye: Vec3): void {
    const p = this.physics;
    if (!p) return;
    if (p.needsGround(eye)) void this.groundFor(eye);
    const c = this.character;
    const o = p.groundPatch?.origin;
    if (c && o && p.offPatch(c.feet(), PATCH_EDGE)) {
      // At the patch's edge, walk only back toward its middle until the next patch arrives: no ground beyond it yet.
      const f = c.feet(), w = c.stride.walk;
      if (w[0] * (f[0] - o[0]) + w[1] * (f[1] - o[1]) + w[2] * (f[2] - o[2]) > 0) c.stride.walk = [0, 0, 0];
    }
    p.advance(dt);
    if (c) this.walker.follow(c.feet(p.blend));
    const alive = new Set<number>();
    for (const b of p.states()) {
      alive.add(b.id);
      const mesh = this.balls.get(b.id);
      if (!mesh) continue;
      mesh.position.set(...toView(eye, b.position));
      mesh.quaternion.set(...b.rotation);
      const d = this.drop;
      if (d && d.id === b.id && d.landed === null) {
        const at = fromWorld(this.habitat.profile, ...b.position);
        if (at.h - this.terrain.heightAt(at.theta, at.s) < b.radius + 0.05) {
          // Behind = against the spin (−θ), along the ground.
          let dTheta = at.theta - d.theta;
          dTheta -= 2 * Math.PI * Math.round(dTheta / (2 * Math.PI));
          d.landed = -dTheta * this.habitat.profile.at(at.s).r;
        }
      }
    }
    for (const [id, mesh] of this.balls) if (!alive.has(id)) { this.stage.remove(mesh); this.balls.delete(id); }
  }

  /** Show another habitat (the Lab changed it). */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.habitat = h;
    this.terrain = makeTerrain(h);
    this.flyer = null;
    this.character = null;
    this.clearBalls();
    this.physics?.dispose();
    this.physics = null;
    this.physicsLoading = null;
    this.walker.setProfile(h.profile, this.terrain.standAt);
    await this.build();
  }

  private async build(): Promise<void> {
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose(); }
    if (this.sunline) { this.stage.remove(this.sunline); this.sunline.geometry.dispose(); }
    const h = this.habitat;
    this.norm = sunlineNorm(h);
    setSunline(h.length, this.norm, nearestLit(h));
    this.shine();
    setAir(densityFalloff(h), h.radius, seenMid(h));
    // The sunline: from the wild wall to the port wall along the axis.
    const tube = new CylinderGeometry(h.params.sunlineRadius, h.params.sunlineRadius, h.length, 24, 1, true);
    tube.deleteAttribute('uv'); // the kind's attributes are position and normal (docs/SHADERS.md)
    tube.rotateX(Math.PI / 2);
    tube.translate(0, 0, h.length / 2);
    this.sunline = new Mesh(tube, SUNLINE.material);
    this.sunline.name = 'sunline';
    this.sunline.frustumCulled = false;
    this.camera.far = 4 * (h.radius + h.length);
    this.camera.updateProjectionMatrix();
    this.tiles = new TerrainView(this.terrain, this.stage, this.pool);
    this.scene.add(this.tiles.group);
    this.place();
    // While loading, nothing draws, but the compile cap still counts frames (one new shader per frame): keep its
    // frames ticking, or a second build here (a shadow pass's own shader) would wait for a frame that never comes.
    let loading = true;
    const tick = (): void => { if (!loading) return; this.stage.frame(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      await Promise.all([this.stage.add(this.sunline), this.tiles.load()]);
    } finally {
      loading = false;
    }
  }

  /** Put the camera at the origin looking the walker's way, and the world around it relative to the eye. */
  private place(): void {
    const v = this.current();
    view.eye.value.set(...v.eye);
    this.camera.position.set(0, 0, 0);
    this.camera.up.set(...v.up);
    this.camera.lookAt(v.look[0], v.look[1], v.look[2]);
    if (this.sunline) this.sunline.position.set(...toView(v.eye, [0, 0, 0]));
    this.pose(v.eye);
    const pixelsPerRadian = (this.canvas.clientHeight || 720) / (this.camera.fov * Math.PI / 180);
    this.tiles?.follow(v.eye, pixelsPerRadian);
  }

  private current(): View {
    if (this.flyer) return this.flyer.view();
    const v = this.walker.view();
    if (this.chase < 0.01) return v;
    // From behind and a little above the head, looking the same way; never under the ground.
    const d = this.chase;
    let eye = v3madd(v3madd(v.eye, v.look, -d), v.up, CHASE_UP * Math.min(1, d / CHASE_RISE));
    const at = fromWorld(this.habitat.profile, ...eye), floor = this.terrain.standAt(at.theta, at.s) + 0.3;
    if (at.h < floor) eye = toWorld(this.habitat.profile, { ...at, h: floor });
    return { eye, look: v.look, up: v.up };
  }

  /** Move the camera on foot out (positive) or in by wheel steps (`WheelEvent.deltaY`). */
  zoom(deltaY: number): void {
    if (deltaY === 0) return;
    if (this.chaseGoal === 0) { if (deltaY > 0) this.chaseGoal = CHASE_NEAR; return; }
    const to = this.chaseGoal * Math.exp(deltaY * CHASE_STEP);
    this.chaseGoal = to < CHASE_NEAR * 0.95 ? 0 : Math.min(CHASE_FAR, to);
  }

  /** Glide the camera toward where the wheel put it. */
  private glide(dt: number): void {
    this.chase += (this.chaseGoal - this.chase) * Math.min(1, CHASE_GLIDE * dt);
    if (Math.abs(this.chase - this.chaseGoal) < 1e-3) this.chase = this.chaseGoal;
  }

  /** Light the player's body where it stands and pose it for the frame (relative to the camera's eye). */
  private pose(eye: Vec3): void {
    const f = this.figure, c = this.character;
    // Light and shade around the player (or under the flyer).
    const centre = this.flyer || !c ? eye : v3madd(this.walker.feetAt(), c.up, HUMAN.height / 2);
    shineOn(this.habitat, this.terrain, this.emission, emissionMean(this.emission), air.skyLight.value, this.norm, centre, eye);
    if (!f) return;
    // On foot the body is always there and casts its shadow; the camera sees it once it is out of the head (BODY_LAYER).
    f.object.visible = !!c && !this.flyer;
    if (this.chase >= HEAD_CLEAR) this.camera.layers.enable(BODY_LAYER); else this.camera.layers.disable(BODY_LAYER);
    if (!c || !f.object.visible) return;
    const feet = this.walker.feetAt(), up = c.up;
    const v = c.velocity, flat = v3madd(v, up, -v3dot(v, up)), speed = Math.hypot(...flat);
    const look = this.walker.view().look, ahead = v3madd(look, up, -v3dot(look, up));
    const front = v3norm(speed > 0.5 ? flat : ahead);
    const move: MoveState = c.swimming ? 'swim' : !c.grounded ? 'jump' : speed < 0.3 ? 'idle' : speed < 2.5 ? 'walk' : speed < 5.5 ? 'run' : 'sprint';
    f.update({ feet: toView(eye, feet), up, front, speed, anim: { move } }, this.frameDt, this.time);
  }

  /** Take off from where the walker stands, or land under the flyer. */
  toggleFlying(): void {
    if (this.flyer) {
      const at = fromWorld(this.habitat.profile, ...this.flyer.eye);
      this.walker.land(at.theta, at.s, this.flyer.look);
      this.flyer = null;
      this.standUp();
    } else {
      this.physics?.removeCharacter();
      this.character = null;
      this.flyer = new Flyer(this.habitat.profile, this.walker.view(), this.terrain.standAt);
    }
  }

  private listen(): void {
    // The pointer stays visible and free (Arnd, 2026-10-21): the right button held down looks around.
    dragToLook(this.canvas, (dx, dy) => {
      const k = 0.004;
      if (this.flyer) this.flyer.turn(dx * k, -dy * k);
      else this.walker.turn(dx * k, -dy * k);
    });
    // The wheel moves the camera on foot between the player's eyes and behind them (flying has no body).
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.loop.running && !this.flyer) this.zoom(e.deltaY);
    }, { passive: false });
  }

  /** Start or stop drawing (the page shows one view at a time). */
  setRunning(on: boolean): void {
    this.loop.set(on);
  }

  /** The last frame's time step (s), for posing the body. */
  private frameDt = 0;

  private frame(dt: number): void {
    this.frameDt = dt;
    this.glide(dt);
    const { forward, right, up, fast } = moveKeys(this.loop.keys);
    const run = this.boost * (fast ? RUN : 1);
    if (this.flyer) {
      this.flyer.boost = run;
      this.flyer.step({ forward, right, up }, dt);
    } else {
      const base = this.walker.speed;
      this.walker.speed = base * run;
      if (this.character) {
        this.character.stride.walk = this.walker.stride({ forward, right });
        if (this.jump) this.character.stride.jump = true;
      } else {
        this.walker.step({ forward, right }, dt);
      }
      this.walker.speed = base;
    }
    this.jump = false;
    fitCanvas(this.canvas, this.renderer, this.camera);
    this.time += dt * this.timeScale;
    this.shine();
    this.simulate(dt, this.current().eye);
    this.place();
    draw(this.stage);
  }
}
