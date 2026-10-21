/**
 * The view from inside: the one renderer (WebGPU only), the Stage, the whole interior surface and the sunline,
 * seen by a walker on the ground. Drag to look around; W A S D or the arrow keys to walk, Shift to run.
 */
import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Mesh, PerspectiveCamera, Scene, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer } from '@futuremagic/stage';
import type { Habitat } from '../blueprint';
import { buildSurface, surfaceBytes, type SurfaceGrid } from '../gen/surface';
import { Walker } from '../world/walker';
import { GROUND, SUNLINE, air, allKinds } from './materials';

/** Running is this many times the walking speed. */
const RUN = 8;

export class InteriorView {
  readonly canvas = document.createElement('canvas');
  readonly walker: Walker;
  private renderer!: WebGPURenderer;
  private stage!: Stage;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.3, 1e6);
  private ground: Mesh | null = null;
  private sunline: Mesh | null = null;
  private grid: SurfaceGrid | null = null;
  private keys = new Set<string>();
  private running = false;
  private last = 0;
  /** Travel speed multiplier from the debug menu. */
  boost = 1;

  private constructor(private habitat: Habitat) {
    this.walker = new Walker(habitat.profile);
    this.canvas.className = 'view-canvas';
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat): Promise<InteriorView> {
    const v = new InteriorView(habitat);
    // Reversed depth: from a blade of grass at the feet to the far endcap tens of kilometres away, in one view.
    v.renderer = (await createRenderer(v.canvas, { backends: 'webgpu', depth: 'reversed' })).renderer;
    v.scene.background = new Color(...(air.haze.value as Color).toArray());
    v.stage = new Stage(v.renderer, v.scene, v.camera, { kinds: allKinds });
    v.place();
    await v.stage.warmUp();
    await v.build();
    v.listen();
    return v;
  }

  /** Bytes of geometry this view holds (memory watchdog). */
  bytes(): number {
    return this.grid ? surfaceBytes(this.grid) : 0;
  }

  /** One line for the debug menu. */
  info(): string {
    const g = this.grid;
    const a = this.walker.at;
    return `${this.stage.hudLine()}\nsurface ${g ? `${g.columns} × ${g.rows} cells of ~${g.cell.toFixed(0)} m` : 'none'} · θ ${(a.theta * 180 / Math.PI).toFixed(1)}°, s ${(a.s / 1000).toFixed(2)} of ${(this.habitat.profile.length / 1000).toFixed(2)} km`;
  }

  /** Show another habitat (the Lab changed it). */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.habitat = h;
    this.walker.setProfile(h.profile);
    await this.build();
  }

  private async build(): Promise<void> {
    for (const m of [this.ground, this.sunline]) if (m) { this.stage.remove(m); m.geometry.dispose(); }
    const h = this.habitat;
    const g = buildSurface(h);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(g.normals, 3));
    geo.setAttribute('color', new BufferAttribute(g.colors, 3));
    geo.setIndex(new BufferAttribute(g.index, 1));
    this.grid = g;
    this.ground = new Mesh(geo, GROUND.material);
    this.ground.frustumCulled = false; // it surrounds the eye
    this.ground.name = 'ground';
    // The sunline: from the wild wall to the port wall along the axis.
    const tube = new CylinderGeometry(h.params.sunlineRadius, h.params.sunlineRadius, h.length, 24, 1, true);
    tube.deleteAttribute('uv'); // the kind's attributes are position and normal (docs/SHADERS.md)
    tube.rotateX(Math.PI / 2);
    tube.translate(0, 0, h.length / 2);
    this.sunline = new Mesh(tube, SUNLINE.material);
    this.sunline.name = 'sunline';
    this.camera.far = 4 * (h.radius + h.length);
    this.camera.updateProjectionMatrix();
    await Promise.all([this.stage.add(this.ground), this.stage.add(this.sunline)]);
  }

  private place(): void {
    const v = this.walker.view();
    this.camera.position.set(...v.eye);
    this.camera.up.set(...v.up);
    this.camera.lookAt(v.eye[0] + v.look[0], v.eye[1] + v.look[1], v.eye[2] + v.look[2]);
  }

  private listen(): void {
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointerup', (e) => { dragging = false; this.canvas.releasePointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
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
