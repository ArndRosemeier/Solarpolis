/**
 * The view outside (design "Solarpolis: the outside", O3): the home habitat in the geostationary ring, with Earth
 * below, the Moon, the Sun and the stars where the space model (src/space) puts them at this hour. The camera orbits
 * the habitat: hold the right mouse button to swing around it, the wheel to come closer or go farther; 1 looks at the
 * habitat, 2 at Earth, 3 at the Moon (the wheel then zooms).
 *
 * The scene's axes are the habitat's orbit frame (ecliptic of date); the camera sits at the origin and everything is
 * placed relative to the eye in float64 first, so 32-bit floats only ever hold small offsets or unit directions.
 * Exposure follows what is in sight (render/exposure.ts), so the stars show only when nothing bright is in view, as
 * for eyes; the "night eyes" augmentation (debug menu) lets the eyes open much further.
 */
import { Matrix4, Mesh, PerspectiveCamera, Scene, SphereGeometry, Texture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer } from '@futuremagic/stage';
import { Rng, deriveSeed, v3add, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { DAY, REFERENCE_SPACE, calendarOf, decodeStars, julianDay, makeSpace, mul, rotZ, skyFrom, type Mat3, type Space, type SkyView } from '../space';
import { HULL, SKY, STARS, outsideKinds, standInAttribute } from './materials';
import { outside, skyMaps } from './skyShaders';
import { DARKEST, PERIPHERY, adapt, exposureFor, type Meterable } from './exposure';
import { hullGeometry } from './hull';
import { meshGeometry } from './geometry';
import { dragToLook, draw, fitCanvas, runFrames } from './surface';

/** Clock seconds per real second by default: Earth turns visibly, a day in 24 minutes. */
const SPACE_SPEED = 60;
/** The dome and the stars sit this far out; nothing in the scene is drawn beyond it. */
const DOME = 5e7;
const base = import.meta.env.BASE_URL;

type Look = 'habitat' | 'earth' | 'moon';

export class OutsideView {
  readonly canvas = document.createElement('canvas');
  private renderer!: WebGPURenderer;
  private stage!: Stage;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 10, DOME * 2);
  private space: Space;
  private dome: Mesh | null = null;
  private stars: Mesh | null = null;
  private body: Mesh | null = null;
  private spindle: Mesh | null = null;
  private running = false;
  private sky: SkyView | null = null;
  /** Clock seconds since the space's epoch, and how many pass per real second. */
  time: number;
  timeScale = SPACE_SPEED;
  nightEyes = false;
  exposure = 1;
  private look: Look = 'habitat';
  /** Orbit around the habitat: yaw and pitch in the orbit frame, distance from the centre (m). */
  private yaw = 0;
  private pitch = 0.12;
  private distance = 1;
  /** Field of view when looking at Earth or the Moon. */
  private zoom = 30;
  private textureBytes = 0;
  private starBytes = 0;
  private dayDetail: 'full' | 'reduced' = 'full';
  private nightMap: Texture | null = null;
  private moonMap: Texture | null = null;

  private constructor(private habitat: Habitat) {
    this.space = makeSpace({ ...REFERENCE_SPACE, home: habitat.params });
    // An afternoon over Europe in March: Earth three-quarters lit behind the habitat.
    this.time = (julianDay(3026, 3, 1 + 14.5 / 24) - this.space.params.epochJd) * DAY;
    this.canvas.className = 'view-canvas';
    const rng = new Rng(deriveSeed(this.space.params.seed, 'clouds'));
    outside.clouds.value.set(rng.range(0, 100), rng.range(0, 100), rng.range(0, 100));
    this.frameHabitat();
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat): Promise<OutsideView> {
    const v = new OutsideView(habitat);
    v.renderer = (await createRenderer(v.canvas, { backends: 'webgpu', depth: 'reversed' })).renderer;
    v.stage = new Stage(v.renderer, v.scene, v.camera, { kinds: outsideKinds, attribute: standInAttribute });
    await v.stage.warmUp();
    const dome = new SphereGeometry(DOME, 64, 32);
    dome.deleteAttribute('normal');
    dome.deleteAttribute('uv');
    v.dome = new Mesh(dome, SKY.material);
    v.dome.name = 'sky';
    v.dome.renderOrder = -1;
    v.dome.frustumCulled = false;
    await Promise.all([v.stage.add(v.dome), v.buildHull(), v.loadMaps('full'), v.loadStars()]);
    v.bindControls();
    return v;
  }

  /** Bytes this view holds (memory watchdog): the surface maps with their mipmaps, and the star field. */
  bytes(): number {
    return this.textureBytes + this.starBytes;
  }

  /** Give memory back (memory watchdog): Earth's day map drops to half resolution. */
  shed(): void {
    if (this.dayDetail === 'full') void this.loadMaps('reduced');
  }

  private async loadMaps(detail: 'full' | 'reduced'): Promise<void> {
    this.dayDetail = detail;
    const load = (file: string): Promise<Texture> => mipmapped(`${base}sky/${file}`);
    const [day, night, moon] = await Promise.all([
      load(detail === 'full' ? 'earth-day.jpg' : 'earth-day-2k.jpg'),
      this.nightMap ?? load('earth-night.jpg'),
      this.moonMap ?? load('moon.jpg'),
    ]);
    const old = skyMaps.earthDay.value;
    skyMaps.earthDay.value = day;
    skyMaps.earthNight.value = this.nightMap = night;
    skyMaps.moon.value = this.moonMap = moon;
    if (old !== day) old.dispose();
    // RGBA8 with a full mip chain is 4/3 of the base level.
    const size = (t: Texture): number => (t.image as { width: number }).width * (t.image as { height: number }).height * 4 * 4 / 3;
    this.textureBytes = size(day) + size(night) + size(moon);
  }

  private async loadStars(): Promise<void> {
    const res = await fetch(`${base}sky/stars.bin`);
    const field = decodeStars(await res.arrayBuffer());
    const n = field.count;
    const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), corner = new Float32Array(n * 8);
    const index = new Uint32Array(n * 6);
    const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        for (let a = 0; a < 3; a++) {
          pos[v * 3 + a] = field.dir[i * 3 + a] * DOME * 0.9;
          col[v * 3 + a] = field.color[i * 3 + a] * field.flux[i];
        }
        corner[v * 2] = corners[k * 2];
        corner[v * 2 + 1] = corners[k * 2 + 1];
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = meshGeometry(index, { position: [pos, 3], color: [col, 3], corner: [corner, 2] });
    this.starBytes = pos.byteLength + col.byteLength + corner.byteLength + index.byteLength;
    this.stars = new Mesh(g, STARS.material);
    this.stars.name = 'stars';
    this.stars.frustumCulled = false;
    this.stars.matrixAutoUpdate = false;
    await this.stage.add(this.stars);
  }

  private async buildHull(): Promise<void> {
    for (const m of [this.body, this.spindle]) if (m) { this.stage.remove(m); m.geometry.dispose(); }
    const g = hullGeometry(this.habitat);
    this.body = new Mesh(g.body, HULL.material);
    this.spindle = new Mesh(g.spindle, HULL.material);
    for (const m of [this.body, this.spindle]) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
    this.body.name = 'hull';
    this.spindle.name = 'spindle';
    this.place();
    await Promise.all([this.stage.add(this.body), this.stage.add(this.spindle)]);
  }

  /** Show another habitat (the Lab changed it): same sky, new body. */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.habitat = h;
    this.space = makeSpace({ ...REFERENCE_SPACE, home: h.params });
    this.frameHabitat();
    await this.buildHull();
  }

  /** Back to the start view: the habitat in front of Earth, a little from the side. */
  private frameHabitat(): void {
    const x = this.habitat.exterior;
    const tip = Math.max(x.radius, ...x.brims.map((b) => b.tip));
    this.distance = 0.9 * Math.max(this.habitat.length + 2 * x.radius, 2 * tip) / Math.tan((45 * Math.PI) / 360);
    const e = this.space.frames.position([0, 0, 0], 'earth', this.space.home.orbitFrame, this.time);
    this.yaw = Math.atan2(-e[1], -e[0]) + 0.2;
    this.pitch = 0.12;
    this.look = 'habitat';
  }

  /** Lines for the debug menu. */
  info(): string {
    const jd = this.space.jd(this.time);
    const s = this.sky;
    return [
      this.stage.hudLine(),
      `${dateOf(jd)} UT · clock ×${this.timeScale} · exposure ${this.exposure.toExponential(1)}${this.nightEyes ? ' (night eyes)' : ''}`,
      s ? `sunlight ${(s.sunlight * 100).toFixed(0)}% · Earth ${(2 * Math.asin(s.earth.radius / Math.hypot(...s.earth.center)) * 180 / Math.PI).toFixed(1)}° across · looking at ${this.look}` : '',
    ].join('\n');
  }

  /** Move the clock on by `seconds` (debug menu). */
  skip(seconds: number): void {
    this.time += seconds;
  }

  /** Jump to the next time Earth's shadow falls on the habitat, within a year; false if there is none. */
  nextShadow(): boolean {
    const f = this.space.home.orbitFrame;
    for (let k = 1; k < 365 * 24 * 12; k++) {
      const t = this.time + k * 300;
      if (skyFrom(this.space, f, [0, 0, 0], t).sunlight < 0.5) { this.time = t - 1800; return true; }
    }
    return false;
  }

  /** Where the eye is in the orbit frame, and what it looks at. */
  private eyeAndTarget(): { eye: Vec3; target: Vec3 } {
    const cp = Math.cos(this.pitch);
    const eye: Vec3 = v3scale([cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch)], this.distance);
    if (this.look === 'habitat' || !this.sky) return { eye, target: [0, 0, 0] };
    const c = this.look === 'earth' ? this.sky.earth.center : this.sky.moon.center;
    return { eye, target: v3add(eye, c) };
  }

  /** Everything relative to the eye at the clock's time: uniforms, the hull's pose, the stars' turn. */
  private place(): void {
    const t = this.time, sp = this.space, f = sp.home.orbitFrame;
    const { eye, target } = this.eyeAndTarget();
    const sky = skyFrom(sp, f, eye, t);
    this.sky = sky;
    const eD = Math.hypot(...sky.earth.center), mD = Math.hypot(...sky.moon.center);
    outside.sunDir.value.set(...sky.sunDir);
    outside.sunRadius.value = sky.sunRadius;
    outside.sunlight.value = sky.sunlight;
    outside.earthDir.value.set(...v3scale(sky.earth.center, 1 / eD));
    outside.earthSin.value = sky.earth.radius / eD;
    toBody(outside.earthAxes.value, sky.earth.axes);
    outside.moonDir.value.set(...v3scale(sky.moon.center, 1 / mD));
    outside.moonSin.value = sky.moon.radius / mD;
    toBody(outside.moonAxes.value, sky.moon.axes);
    // Earthshine: Earth's albedo times the solid angle it fills, times how much of its face is lit.
    const omega = 2 * Math.PI * (1 - Math.sqrt(1 - (sky.earth.radius / eD) ** 2));
    const phase = (1 - v3dot(sky.sunDir, v3scale(sky.earth.center, 1 / eD))) / 2;
    outside.earthshine.value = 0.3 * (omega / Math.PI) * phase;
    const pose = sp.frames.relative(sp.home.bodyFrame, f, t);
    if (this.body) setPose(this.body, pose.axes, v3sub(pose.origin, eye));
    if (this.spindle) setPose(this.spindle, mul(pose.axes, rotZ(-sp.home.spinAt(t))), v3sub(pose.origin, eye));
    if (this.stars) setPose(this.stars, sp.frames.relative('sun', f, t).axes, [0, 0, 0]);
    this.camera.position.set(0, 0, 0);
    this.camera.up.set(0, 0, 1);
    const look = v3sub(target, eye);
    this.camera.lookAt(look[0], look[1], look[2]);
    this.camera.fov = this.look === 'habitat' ? 45 : this.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private bindControls(): void {
    // The pointer stays free (Arnd, 2026-10-21): the right button held swings the camera around the habitat.
    dragToLook(this.canvas, (dx, dy) => {
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.005));
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.001);
      if (this.look === 'habitat') this.distance = Math.max(this.habitat.exterior.radius * 1.5, Math.min(2e7, this.distance * k));
      else this.zoom = Math.max(0.2, Math.min(60, this.zoom * k));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      const keys: Record<string, Look> = { Digit1: 'habitat', Digit2: 'earth', Digit3: 'moon' };
      const next = keys[e.code];
      if (!next) return;
      this.look = next;
      if (next === 'earth') this.zoom = 30;
      if (next === 'moon') this.zoom = 2;
    });
  }

  /** Start or stop drawing (the page shows one view at a time). */
  setRunning(on: boolean): void {
    this.running = on;
    if (!on) return;
    runFrames(() => this.running, (dt) => this.frame(dt));
  }

  private frame(dt: number): void {
    fitCanvas(this.canvas, this.renderer, this.camera);
    this.time += dt * this.timeScale;
    outside.clouds.value.z = outside.clouds.value.z - (dt * this.timeScale / DAY) * 0.05;
    this.place();
    this.meterAndAdapt(dt);
    const ratio = this.renderer.getPixelRatio(), px = (this.canvas.clientHeight || 720) * ratio;
    outside.pixelSolidAngle.value = ((this.camera.fov * Math.PI) / 180 / px) ** 2;
    outside.viewport.value.set((this.canvas.clientWidth || 1280) * ratio, px);
    draw(this.stage);
  }

  /** Meter the view (and a margin around it) on a grid of rays and let the exposure follow. */
  private meterAndAdapt(dt: number): void {
    if (!this.sky) return;
    const m = this.camera.matrixWorld.elements;
    const right: Vec3 = [m[0], m[1], m[2]], up: Vec3 = [m[4], m[5], m[6]], fwd: Vec3 = [-m[8], -m[9], -m[10]];
    const th = Math.tan((PERIPHERY * this.camera.fov * Math.PI) / 360), aspect = this.camera.aspect;
    const rays: Vec3[] = [];
    for (let j = 0; j < 9; j++) for (let i = 0; i < 16; i++) {
      const x = ((i + 0.5) / 16 * 2 - 1) * th * aspect, y = ((j + 0.5) / 9 * 2 - 1) * th;
      rays.push(v3norm(v3add(fwd, v3add(v3scale(right, x), v3scale(up, y)))));
    }
    const { eye } = this.eyeAndTarget();
    const sp = this.space, pose = sp.frames.relative(sp.home.bodyFrame, sp.home.orbitFrame, this.time);
    const axis: Vec3 = [pose.axes[2], pose.axes[5], pose.axes[8]];
    const metered: Meterable = {
      sky: this.sky,
      hull: { center: v3sub(v3add(pose.origin, v3scale(axis, this.habitat.length / 2)), eye), axis, radius: this.habitat.exterior.radius, halfLength: this.habitat.length / 2 },
      earthshine: outside.earthshine.value,
    };
    this.exposure = adapt(this.exposure, exposureFor(metered, rays, this.nightEyes ? DARKEST.nightEyes : DARKEST.plain), dt);
    outside.exposure.value = this.exposure;
  }
}

/** A mesh's matrix from axes (columns: its own axes in the scene) and an origin relative to the eye. */
function setPose(mesh: Mesh, a: Mat3, o: Vec3): void {
  mesh.matrix.copy(new Matrix4().set(a[0], a[1], a[2], o[0], a[3], a[4], a[5], o[1], a[6], a[7], a[8], o[2], 0, 0, 0, 1));
  mesh.matrixWorldNeedsUpdate = true;
}

/** Scene → body: the transpose of the body's axes (its columns), as a three.js Matrix3. */
function toBody(out: { set(...v: number[]): unknown }, a: Mat3): void {
  out.set(a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]);
}

/** A Julian date as "3026-03-01 14:30". */
function dateOf(jd: number): string {
  const c = calendarOf(jd), hours = (c.day % 1) * 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${c.year}-${p(c.month)}-${p(Math.floor(c.day))} ${p(hh)}:${p(mm)}`;
}

/**
 * An sRGB map with its whole mip chain made here, halving with the browser's high-quality resize: three.js's own GPU
 * mipmap pass needs a texture-view option not every WebGPU browser accepts yet. Not flipped: v runs from the top.
 */
async function mipmapped(url: string): Promise<Texture> {
  const blob = await (await fetch(url)).blob();
  const top = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const levels: ImageBitmap[] = [top];
  for (let w = top.width >> 1, h = top.height >> 1; w >= 1 || h >= 1; w >>= 1, h >>= 1) {
    levels.push(await createImageBitmap(top, { resizeWidth: Math.max(1, w), resizeHeight: Math.max(1, h), resizeQuality: 'high' }));
  }
  const t = new Texture(top);
  t.mipmaps = levels as unknown as HTMLCanvasElement[]; // three takes any image source per level
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
