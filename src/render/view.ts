/**
 * The view from inside: the one renderer (WebGPU only), the Stage, the terrain tiles and the sunline, seen by a walker
 * on the ground. Everything is drawn relative to the eye (`toView`): the camera sits at the origin and the world moves. Hold the right mouse button to look around (the pointer stays free for clicking
 * things); W A S D or the arrow keys to walk, Shift to run.
 */
import { Color, CylinderGeometry, Mesh, PerspectiveCamera, Scene, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer } from '@futuremagic/stage';
import { toView, type Habitat } from '../blueprint';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { Walker } from '../world/walker';
import { WorkerPool } from '../workers/pool';
import { SUNLINE, air, allKinds, setSunline, standInAttribute, view } from './materials';
import { nearestLit, sunlineEmission, sunlineNorm } from '../world/sunline';
import { TerrainView, describeLayout } from './terrain';

/** Running is this many times the walking speed. */
const RUN = 8;

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
  private keys = new Set<string>();
  private running = false;
  private last = 0;
  /** Travel speed multiplier from the debug menu. */
  boost = 1;

  private constructor(private habitat: Habitat) {
    this.terrain = makeTerrain(habitat);
    this.walker = new Walker(habitat.profile, undefined, this.terrain.standAt);
    this.canvas.className = 'view-canvas';
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat): Promise<InteriorView> {
    const v = new InteriorView(habitat);
    // Reversed depth: from a blade of grass at the feet to the far endcap tens of kilometres away, in one view.
    v.renderer = (await createRenderer(v.canvas, { backends: 'webgpu', depth: 'reversed' })).renderer;
    v.scene.background = new Color(...(air.haze.value as Color).toArray());
    v.stage = new Stage(v.renderer, v.scene, v.camera, { kinds: allKinds, attribute: standInAttribute });
    v.place();
    await v.stage.warmUp();
    await v.build();
    v.listen();
    return v;
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
    const a = this.walker.at;
    return [
      this.stage.hudLine(),
      `${this.tiles?.info() ?? 'terrain: none'} · ${describeLayout(this.terrain)} · ${this.pool.workers} workers`,
      `θ ${(a.theta * 180 / Math.PI).toFixed(1)}°, s ${(a.s / 1000).toFixed(2)} of ${(this.habitat.profile.length / 1000).toFixed(2)} km, ground ${this.terrain.standAt(a.theta, a.s).toFixed(1)} m`,
    ].join('\n');
  }

  /** Show another habitat (the Lab changed it). */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.habitat = h;
    this.terrain = makeTerrain(h);
    this.walker.setProfile(h.profile, this.terrain.standAt);
    await this.build();
  }

  private async build(): Promise<void> {
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose(); }
    if (this.sunline) { this.stage.remove(this.sunline); this.sunline.geometry.dispose(); }
    const h = this.habitat;
    setSunline(sunlineEmission(h), h.length, sunlineNorm(h), nearestLit(h));
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
    await Promise.all([this.stage.add(this.sunline), this.tiles.load()]);
  }

  /** Put the camera at the origin looking the walker's way, and the world around it relative to the eye. */
  private place(): void {
    const v = this.walker.view();
    view.eye.value.set(...v.eye);
    this.camera.position.set(0, 0, 0);
    this.camera.up.set(...v.up);
    this.camera.lookAt(v.look[0], v.look[1], v.look[2]);
    if (this.sunline) this.sunline.position.set(...toView(v.eye, [0, 0, 0]));
    const pixelsPerRadian = (this.canvas.clientHeight || 720) / (this.camera.fov * Math.PI / 180);
    this.tiles?.follow(v.eye, pixelsPerRadian);
  }

  private listen(): void {
    // The pointer stays visible and free (Arnd, 2026-10-21): the left button is for clicking things in the world,
    // the right button held down looks around. On touch screens a one-finger drag looks around.
    let looking: number | null = null;
    const looks = (e: PointerEvent): boolean => (e.pointerType === 'touch' ? e.isPrimary : e.button === 2);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!looks(e) || looking !== null) return;
      looking = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('looking');
    });
    const stop = (e: PointerEvent): void => {
      if (e.pointerId !== looking) return;
      looking = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.classList.remove('looking');
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== looking) return;
      const k = 0.004;
      this.walker.turn(e.movementX * k, -e.movementY * k);
    });
    window.addEventListener('keydown', (e) => { if (this.running) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Start or stop drawing (the page shows one view at a time). */
  setRunning(on: boolean): void {
    this.running = on;
    if (!on) { this.keys.clear(); return; }
    this.last = performance.now();
    const tick = (t: number): void => {
      if (!this.running) return;
      this.frame(Math.min(0.1, (t - this.last) / 1000));
      this.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private frame(dt: number): void {
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const base = this.walker.speed;
    this.walker.speed = base * this.boost * (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : 1);
    this.walker.step({ forward, right }, dt);
    this.walker.speed = base;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.camera.aspect !== w / h)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.place();
    this.stage.frame();
    this.renderer.render(this.scene, this.camera);
  }
}
