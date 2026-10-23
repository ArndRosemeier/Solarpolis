/**
 * The view outside (design "Solarpolis: the outside", O3 and O4): the home habitat in the geostationary ring, its
 * neighbours along the ring (necklace.ts), Earth below, the Moon, the Sun and the stars where the space model
 * (src/space) puts them at this hour. The camera orbits the habitat: hold the right mouse button to swing around it,
 * the wheel to come closer or go farther; 1 looks at the habitat, 2 at Earth, 3 at the Moon, 4 at the nearest
 * neighbour (the wheel then zooms). F lets the camera fly free (W A S D, E up, Q down, Shift faster), from tens of
 * thousands of kilometres out down to a metre off the hull (space/flyer.ts).
 *
 * The scene's axes are the habitat's orbit frame (ecliptic of date); the camera sits at the origin and everything is
 * placed relative to the eye in float64 first, so 32-bit floats only ever hold small offsets or unit directions.
 * Exposure follows what is in sight (render/exposure.ts), so the stars show only when nothing bright is in view, as
 * for eyes; the "night eyes" augmentation (debug menu) lets the eyes open much further.
 */
import { Color, Mesh, PerspectiveCamera, Scene, SphereGeometry, Texture, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer } from '@futuremagic/stage';
import { Rng, deriveSeed, v3add, v3dot, v3len, v3scale, v3sub, v3norm, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { DAY, EARTH, MOON, REFERENCE_SPACE, SpaceFlyer, arrival, attractLoop, calendarOf, chooseStart, decodeStars, guestShip, julianDay, makeSpace, shipLightsOf, shipShape, skyFrom, type Arrival, type ArrivalFrame, type Cinema, type CinemaFrame, type HullLight, type Mat3, type ShipShape, type Space, type SkyView } from '../space';
import { SKY, STARS, outsideKinds, standInAttribute } from './materials';
import { filtered } from './textures';
import { outside, skyMaps } from './skyShaders';
import { DARKEST, PERIPHERY, adapt, exposureFor, meterRays, starExposure, sunInView, type Meterable } from './exposure';
import { NecklaceView } from './necklace';
import { meshGeometry, setPose } from './geometry';
import { SHIP_ALBEDO, ShipMeshes, shipAxes } from './ship';
import { LampPoints } from './lamps';
import { BORE_ALBEDO } from './bore';
import { BORE_LIGHT } from './hullShaders';
import { FrameLoop, dragToLook, draw, fitCanvas, moveKeys } from './surface';
import { SolarSystem, type EphemerisPack } from '../space/solarSystem';
import type { MoonRecord, SmallRecord } from '../space/solarData';
import { AU, SUN } from '../space/constants';
import { apply, transpose } from '../space/pose';
import { SolarView } from './solar';
import { SolarControls } from './solarControls';
import { HabitatLights } from './habitatLights';
import { HabitatCatalogue } from './habitatCatalogue';
import { REFERENCE_SYSTEM, makeLedger, type Ledger } from '../system';
import { polePlane } from '../space/orbits';
import { VesselVisit } from './vesselVisit';
import type { VoyagePanel, VoyagePanelFactory } from './voyagePanel';
import { TOUR_SHIP } from '../space/voyage';

/**
 * Clock seconds per real second by default: real time (Arnd, 2026-10-21). A faster clock spins the habitat fast
 * enough to make it look small; the debug menu speeds it up.
 */
const SPACE_SPEED = 1;
/** The dome and the stars sit this far out; nothing in the scene is drawn beyond it. */
const DOME = 5e7;
const base = import.meta.env.BASE_URL;

type Look = 'habitat' | 'earth' | 'moon' | 'neighbour';

export class OutsideView {
  readonly canvas = document.createElement('canvas');
  private renderer!: WebGPURenderer;
  private stage!: Stage;
  /** Black behind the dome, so a sky that fails to draw shows as space, never as the page behind the canvas. */
  private readonly scene = Object.assign(new Scene(), { background: new Color(0x000000) });
  private readonly camera = new PerspectiveCamera(45, 1, 10, DOME * 2);
  private space: Space;
  private dome: Mesh | null = null;
  private stars: Mesh | null = null;
  private necklace: NecklaceView | null = null;
  /** The free camera while flying (F), null while orbiting the habitat. */
  private flyer: SpaceFlyer | null = null;
  private readonly loop = new FrameLoop((dt) => this.frame(dt), (e) => this.key(e));
  private sky: SkyView | null = null;
  /** The title's attract loop while it plays (space/cinema.ts): the shots, seconds into them, this frame. */
  private attract: { cinema: Cinema; elapsed: number; frame: CinemaFrame } | null = null;
  /** After Start: the passenger's ship's arrival (shots 4 and 5), and what to call when it is over or stopped. */
  private arriving: { arrival: Arrival; elapsed: number; frame: ArrivalFrame; done: () => void } | null = null;
  /** The passenger's ship (space/traffic.ts, `guestShip`): the title's torch ship, the one that berths after Start. */
  private shipShape: ShipShape;
  private ship: ShipMeshes | null = null;
  /** The title ship's navigation lights (space/lights.ts). */
  private shipLamps: { lights: HullLight[]; points: LampPoints } | null = null;
  /** Called each frame of the attract loop with how far the title has faded in (0–1). */
  onTitle: ((fade: number) => void) | null = null;
  /** Each frame of the arrival after Start: how far in it is (s) and the arrival itself (its sounds and the Mind's lines). */
  onArrival: ((elapsed: number, arrival: Arrival) => void) | null = null;
  /** Clock seconds since the space's epoch, and how many pass per real second. */
  time: number;
  timeScale = SPACE_SPEED;
  nightEyes = false;
  /** Heroic stars (Arnd, 2026-10-21): without the Sun in view, the eyes open for the stars (`starExposure`). */
  heroicStars = true;
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
  private solar!: SolarView;
  private solarControls!: SolarControls;
  /** The system's habitats as points of light, and their part of the catalogue (plan "The Whole System"). */
  private habitatLights!: HabitatLights;
  private habitatCatalogue!: HabitatCatalogue;
  /** The system around the home habitat (system/ledger.ts). */
  private ledger!: Ledger;
  /** Visit chosen in the catalogue: a habitat id ('home' to go back) and the ledger it is in (docs/system.md). */
  onVisit: ((id: string, ledger: Ledger) => void) | null = null;
  private observer: { id: string; yaw: number; pitch: number; distance: number } | null = null;
  private controlClock = 0;
  private vessel!: VesselVisit;
  private voyage!: VoyagePanel;
  private voyageCameraKey = '';

  private constructor(private habitat: Habitat, private system: SolarSystem) {
    this.space = makeSpace({ ...REFERENCE_SPACE, home: habitat.params }, system);
    this.shipShape = shipShape(guestShip(this.space, this.space.home));
    // An afternoon over Europe in March: Earth three-quarters lit behind the habitat.
    this.time = (julianDay(3026, 3, 1 + 14.5 / 24) - this.space.params.epochJd) * DAY;
    this.canvas.className = 'view-canvas';
    const rng = new Rng(deriveSeed(this.space.params.seed, 'clouds'));
    outside.clouds.value.set(rng.range(0, 100), rng.range(0, 100), rng.range(0, 100));
    this.frameHabitat();
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat, makeVoyagePanel: VoyagePanelFactory): Promise<OutsideView> {
    const load = async <T>(name: string): Promise<T> => {
      const response = await fetch(`${base}space/${name}.json`);
      if (!response.ok) throw new Error(`Could not load the solar system (${name})`);
      return response.json() as Promise<T>;
    };
    const [ephemeris, moons, small] = await Promise.all([load<EphemerisPack>('ephemeris'), load<MoonRecord[]>('moons'), load<SmallRecord[]>('small-bodies')]);
    const v = new OutsideView(habitat, new SolarSystem(ephemeris, moons, small));
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
    v.solar = new SolarView(v.stage, v.system, DOME * .7, v.space.params.seed);
    const ledger = makeLedger(v.space.params, REFERENCE_SYSTEM);
    v.habitatLights = new HabitatLights(v.stage, v.system, ledger, DOME * .7);
    await Promise.all([v.stage.add(v.dome), v.buildNecklace(), v.loadMaps('full'), v.loadStars(), v.solar.start(), v.habitatLights.start()]);
    outside.bodiesInDome.value = 0;
    v.solarControls = new SolarControls(v.system, id => v.observe(id), () => { v.observer = null; v.flyer = null; v.frameHabitat(); }, n => { v.timeScale = n; });
    v.ledger = ledger;
    v.habitatCatalogue = new HabitatCatalogue(ledger, id => v.observe(id), on => { v.habitatLights.naming = on; }, id => v.onVisit?.(id, v.ledger));
    v.habitatLights.onPick = id => v.habitatCatalogue.showHabitat(id);
    v.solarControls.element.append(v.habitatCatalogue.element);
    v.vessel = new VesselVisit(v.stage, () => { v.stopAttract(); v.observer = null; v.flyer = null; v.timeScale = 1; v.exposure = 1; }, () => { v.frameHabitat(); v.voyage?.showCabin(false); }, TOUR_SHIP);
    v.voyage = makeVoyagePanel(v.system, () => v.space, () => v.time, () => { v.stopAttract(); v.vessel.close(); v.observer = null; v.flyer = null; v.exposure = 1; }, () => {
      v.vessel.inside = true;
      void v.vessel.open().then(() => v.voyage.showCabin(v.vessel.active));
    });
    v.bindControls();
    return v;
  }

  /** Bytes this view holds (memory watchdog): the surface maps with their mipmaps, the star field, the skin's detail tiles. */
  bytes(): number {
    return this.textureBytes + this.starBytes + (this.necklace?.detailBytes() ?? 0) + (this.solar?.bytes() ?? 0) + (this.habitatLights?.bytes() ?? 0) + (this.vessel?.meshes.bytes() ?? 0) + (this.voyage?.bytes() ?? 0);
  }

  /** Give memory back (memory watchdog): Earth's day map drops to half resolution, detail tiles out of sight go. */
  shed(): void {
    if (this.dayDetail === 'full') void this.loadMaps('reduced');
    this.necklace?.shed();
    this.solar?.shed();
    this.habitatLights?.shed();
    this.vessel?.releaseIdle();
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

  /** The ring's habitats for the current space: the home one's meshes and every neighbour's glint. */
  private async buildNecklace(): Promise<void> {
    this.necklace?.dispose();
    this.necklace = new NecklaceView(this.stage, this.space, DOME * 0.9);
    this.place();
    await this.necklace.start();
  }

  /** Show another habitat (the Lab changed it): same sky, new body. */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.habitat = h;
    this.space = makeSpace({ ...REFERENCE_SPACE, home: h.params }, this.system);
    if (this.habitatLights) {
      const ledger = makeLedger(this.space.params, REFERENCE_SYSTEM);
      this.ledger = ledger;
      this.habitatLights.reset(ledger);
      this.habitatCatalogue.reset(ledger);
    }
    this.voyage?.reset();
    this.shipShape = shipShape(guestShip(this.space, this.space.home));
    // The title's ship was made for the last habitat's berths: made again when the title next plays.
    this.ship?.removeFrom(this.stage);
    this.ship = null;
    this.shipLamps?.points.leave(this.stage);
    this.shipLamps = null;
    this.flyer = null;
    this.frameHabitat();
    await this.buildNecklace();
  }

  /** The player is now at habitat `id` ('home' when back): the catalogue tells trips from there. */
  setVisiting(id: string): void {
    this.habitatCatalogue?.setAt(id);
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
      s ? `sunlight ${(s.sunlight * 100).toFixed(0)}% · Earth ${(2 * Math.asin(s.earth.radius / Math.hypot(...s.earth.center)) * 180 / Math.PI).toFixed(1)}° across · ${this.flyer ? 'flying' : `looking at ${this.look}`}` : '',
      `${distanceOf(this.clearance([0, 0, 0]))} from the nearest surface · nearest neighbour ${distanceOf(v3len(this.necklace?.nearestNeighbour() ?? [0, 0, 0]))} away`,
      this.necklace?.detailInfo() ?? '',
      this.necklace?.trafficInfo() ?? '',
    ].join('\n');
  }

  /** Move the clock on by `seconds` (debug menu). */
  skip(seconds: number): void {
    this.time += seconds;
    this.limitClock();
  }

  private limitClock(): void {
    const p = this.system.ephemeris, before = this.time;
    this.time = Math.max((p.start - this.space.params.epochJd) * DAY, Math.min((p.stop - this.space.params.epochJd) * DAY - 1, this.time));
    if (before !== this.time) this.timeScale = 0;
  }

  /** Observer jump only; physical worlds stay at their actual positions and sizes. */
  observe(id: string): void {
    const body = this.system.byId.get(id);
    if (!body) return;
    this.stopAttract(); this.flyer = null;
    const jd = this.space.jd(this.time), sun = v3norm(v3scale(this.system.position(id, jd), -1));
    const local = apply(transpose(polePlane(...body.pole)), sun);
    this.observer = { id, yaw: Math.atan2(local[1], local[0]) + .35, pitch: .35, distance: Math.max(body.radius * 4.5, body.rings && body.rings.opacity > .1 ? body.rings.outer * 3 : 0) };
    this.exposure = 1;
  }

  /** Jump to the next time Earth's shadow falls on the habitat, within a year; false if there is none. */
  nextShadow(): boolean {
    const f = this.space.home.orbitFrame;
    for (let k = 1; k < 365 * 24 * 12; k++) {
      const t = this.time + k * 300;
      if (this.space.jd(t) >= this.system.ephemeris.stop) return false;
      if (skyFrom(this.space, f, [0, 0, 0], t).sunlight < 0.5) { this.time = t - 1800; return true; }
    }
    return false;
  }

  /** Where the eye is in the orbit frame, and what it looks at. */
  private eyeAndTarget(): { eye: Vec3; target: Vec3 } {
    const voyage = this.voyage?.active ? this.voyage.camera() : null;
    if (this.vessel?.active) return this.vessel.camera();
    if (voyage) return voyage;
    const shot = this.shot;
    if (shot) return { eye: shot.eye, target: shot.target };
    if (this.flyer) return { eye: this.flyer.eye, target: v3add(this.flyer.eye, this.flyer.look()) };
    if (this.observer) {
      const o = this.observer, frame = this.space.home.orbitFrame;
      const target = this.space.frames.position([0, 0, 0], o.id, frame, this.time), cp = Math.cos(o.pitch);
      const local: Vec3 = [cp * Math.cos(o.yaw) * o.distance, cp * Math.sin(o.yaw) * o.distance, Math.sin(o.pitch) * o.distance];
      const offset = this.space.frames.direction(apply(polePlane(...this.system.byId.get(o.id)!.pole), local), 'sun', frame, this.time);
      return { eye: v3add(target, offset), target };
    }
    const cp = Math.cos(this.pitch);
    const eye: Vec3 = v3scale([cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch)], this.distance);
    const c = this.lookOffset(this.look);
    return { eye, target: c ? v3add(eye, c) : [0, 0, 0] };
  }

  /** Where a thing to look at is, relative to the eye; null for the home habitat while orbiting it. */
  private lookOffset(look: Look): Vec3 | null {
    if (!this.sky) return null;
    if (look === 'earth') return this.sky.earth.center;
    if (look === 'moon') return this.sky.moon.center;
    if (look === 'neighbour') return this.necklace?.nearestNeighbour() ?? null;
    return this.flyer ? this.necklace?.home.center ?? null : null;
  }

  /** Distance from a point relative to the eye to the nearest surface: a habitat, Earth or the Moon (m). */
  private clearance(p: Vec3): number {
    const s = this.sky, ring = this.necklace?.distanceToHabitats(p) ?? Infinity;
    if (!s) return ring;
    let distance = Math.min(ring, v3len(v3sub(p, s.earth.center)) - EARTH.radius, v3len(v3sub(p, s.moon.center)) - MOON.radius, v3len(v3sub(p, v3scale(s.sunDir, s.sunDistance))) - SUN.radius);
    for (const body of this.solar?.seen ?? []) distance = Math.min(distance, v3len(v3sub(p, body.center)) - body.body.radius);
    return distance;
  }

  /** Start flying from where the orbit camera is, looking the same way; or go back to orbiting the habitat. */
  toggleFlying(): void {
    if (this.flyer) { this.flyer = null; this.look = 'habitat'; return; }
    const { eye, target } = this.eyeAndTarget();
    this.flyer = new SpaceFlyer(eye, v3sub(target, eye));
    this.observer = null;
  }

  /** Everything relative to the eye at the clock's time: uniforms, the hull's pose, the stars' turn. */
  private place(): void {
    const t = this.time, sp = this.space, f = sp.home.orbitFrame;
    const { eye, target } = this.eyeAndTarget();
    const voyageCamera = this.voyage?.active && !this.vessel?.active ? this.voyage.camera() : null;
    if (voyageCamera) this.camera.fov = voyageCamera.fov;
    const sky = skyFrom(sp, f, eye, t);
    this.sky = sky;
    const eD = Math.hypot(...sky.earth.center), mD = Math.hypot(...sky.moon.center);
    outside.sunDir.value.set(...sky.sunDir);
    outside.sunRadius.value = sky.sunRadius;
    outside.sunlight.value = sky.sunlight;
    outside.irradiance.value = (AU / sky.sunDistance) ** 2;
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
    const ratio = this.renderer?.getPixelRatio() ?? 1, px = (this.canvas.clientHeight || 720) * ratio;
    this.necklace?.follow(eye, t, sky, px / ((this.camera.fov * Math.PI) / 180));
    this.solar?.follow(sp, eye, t, px / ((this.camera.fov * Math.PI) / 180));
    this.habitatLights?.follow(sp, eye, t, [sky.earth, sky.moon, ...(this.solar?.seen ?? []).map(s => ({ center: s.center, radius: s.body.radius }))]);
    if (this.stars) setPose(this.stars, sp.frames.relative('sun', f, t).axes, [0, 0, 0]);
    this.camera.position.set(0, 0, 0);
    const shot = this.shot;
    const aboard = this.vessel?.active ? this.vessel.camera() : null;
    this.camera.up.set(...(voyageCamera?.up ?? aboard?.up ?? shot?.up ?? [0, 0, 1]));
    const look = v3sub(target, eye);
    this.camera.lookAt(look[0], look[1], look[2]);
    this.camera.fov = voyageCamera?.fov ?? aboard?.fov ?? (shot ? shot.fov : this.look === 'habitat' || this.flyer || this.observer ? 45 : this.zoom);
    this.placeShip(eye, shot?.ship ?? null);
    this.vessel?.place(eye);
    // Close to a surface the near plane comes in with it; reversed depth keeps the far side precise.
    this.camera.near = Math.max(0.05, Math.min(10, this.clearance([0, 0, 0]) * 0.25));
    if (this.vessel?.active) this.camera.near = .05;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** The torch ship of the title flight, where the shot puts it (hidden otherwise). */
  private placeShip(eye: Vec3, at: CinemaFrame['ship']): void {
    if (!this.ship) return;
    this.shipLamps?.points.restart();
    if (at) {
      const axes = shipAxes(at.forward, at.up), stern = v3sub(at.position, eye);
      this.ship.pose(axes, stern, at.throttle);
      for (const l of this.shipLamps?.lights ?? []) this.shipLamps!.points.shine(l, v3add(stern, apply(axes, l.at)), this.time);
    } else this.ship.hide();
    this.shipLamps?.points.send();
  }

  /**
   * Play the title's attract loop (shots 1 to 3) on the real clock from the moment the cinematographer picks in the
   * first two days of the game clock, until `stopAttract`.
   */
  async startAttract(): Promise<void> {
    if (!this.ship) {
      const ship = new ShipMeshes(this.shipShape, 'torch ship');
      const lights = shipLightsOf(this.shipShape), lamps = { lights, points: new LampPoints(lights.length, 'torch ship lights') };
      await Promise.all([ship.addTo(this.stage), lamps.points.enter(this.stage)]);
      this.ship = ship;
      this.shipLamps = lamps;
    }
    this.flyer = null;
    const start = chooseStart(this.space, 0);
    const cinema = attractLoop(this.space, start, this.habitat.params.exterior.keepOut, this.shipShape.params.length);
    this.attract = { cinema, elapsed: 0, frame: cinema.at(0) };
    this.time = start;
  }

  /**
   * Start: the passenger's ship carries on from the attract loop into its berth (shots 4 and 5, space/cinema.ts),
   * drawn with the spindle's traffic. Resolves when it has latched (the last frame holds until `stopAttract`), or
   * when the title is stopped.
   */
  arrive(): Promise<void> {
    if (!this.attract || this.arriving) return Promise.resolve();
    const a = arrival(this.space, this.time);
    this.attract = null;
    this.ship?.hide();
    if (this.necklace) this.necklace.guest = a.guest;
    return new Promise((done) => { this.arriving = { arrival: a, elapsed: 0, frame: a.at(0)!, done }; });
  }

  /** Back to the free view, from where the title left the clock. */
  stopAttract(): void {
    this.attract = null;
    this.endArrival();
    this.ship?.hide();
    this.frameHabitat();
  }

  private endArrival(): void {
    const a = this.arriving;
    if (!a) return;
    this.arriving = null;
    if (this.necklace) this.necklace.guest = null;
    a.done();
  }

  /** The title is playing: the attract loop, or the arrival after Start. */
  get attracting(): boolean {
    return this.attract !== null || this.arriving !== null;
  }

  /** This frame's shot while the title plays. */
  private get shot(): CinemaFrame | null {
    return this.arriving?.frame ?? this.attract?.frame ?? null;
  }

  private bindControls(): void {
    // The pointer stays free (Arnd, 2026-10-21): the right button held swings the camera around the habitat.
    dragToLook(this.canvas, (dx, dy) => {
      if (this.vessel?.active) { this.vessel.turn(dx, dy); return; }
      if (this.voyage?.active) { this.voyage.turn(dx, dy); return; }
      if (this.flyer) { this.flyer.turn(-dx * 0.004, -dy * 0.004); return; }
      if (this.observer) { this.observer.yaw -= dx * .005; this.observer.pitch = Math.max(-1.5, Math.min(1.5, this.observer.pitch + dy * .005)); return; }
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.005));
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.vessel?.active) { this.vessel.zoom(e.deltaY); return; }
      if (this.voyage?.active) { this.voyage.magnify(e.deltaY); return; }
      const k = Math.exp(e.deltaY * 0.001);
      if (this.flyer) return;
      if (this.observer) {
        const body = this.system.byId.get(this.observer.id)!;
        this.observer.distance = Math.max(body.radius * 2.5, Math.min(100 * AU, this.observer.distance * k));
        return;
      }
      if (this.look === 'habitat') this.distance = Math.max(this.habitat.exterior.radius * 1.5, Math.min(2e7, this.distance * k));
      else this.zoom = Math.max(0.2, Math.min(60, this.zoom * k));
    }, { passive: false });
  }

  /** F flies or lands; 1 to 4 pick what to look at (flying, they turn the camera toward it). */
  private key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.voyage?.active) return;
    if (this.vessel?.active) { if (e.code === 'Space') e.preventDefault(); return; }
    if (e.code === 'KeyF' && !e.repeat) this.toggleFlying();
    if (e.code === 'Space') e.preventDefault();
    const keys: Record<string, Look> = { Digit1: 'habitat', Digit2: 'earth', Digit3: 'moon', Digit4: 'neighbour' };
    const next = keys[e.code];
    if (!next) return;
    this.observer = null;
    if (this.flyer) {
      const c = this.lookOffset(next);
      if (c) this.flyer.lookAlong(c);
      return;
    }
    this.look = next;
    if (next === 'earth') this.zoom = 30;
    if (next === 'moon') this.zoom = 2;
    if (next === 'neighbour') this.zoom = 5;
  }

  /** Start or stop drawing (the page shows one view at a time). */
  setRunning(on: boolean): void {
    if (this.solarControls && this.canvas.parentElement && !this.solarControls.element.parentElement) this.canvas.parentElement.append(this.solarControls.element);
    if (this.habitatLights && this.canvas.parentElement && !this.habitatLights.element.parentElement) this.canvas.parentElement.append(this.habitatLights.element);
    if (this.vessel && this.canvas.parentElement && !this.vessel.launch.parentElement) this.canvas.parentElement.append(this.vessel.launch, this.vessel.element, this.vessel.help);
    if (this.voyage && this.canvas.parentElement && !this.voyage.element.parentElement) this.canvas.parentElement.append(this.voyage.element);
    this.vessel?.show(on && !this.attracting && !this.voyage?.active);
    this.loop.set(on);
  }

  /** The Ship Tour tab shares this renderer and astronomy pack with Outside. */
  setTourMode(on: boolean): void {
    if (on) { this.stopAttract(); this.vessel.close(); this.flyer = null; this.observer = null; }
    this.voyage.setActive(on);
    if (!on) { this.vessel.close(); this.vessel.setFlight(null); }
    if (on && this.voyage.plan) { this.voyage.tick(0); this.time = this.voyage.clock; }
    this.canvas.parentElement?.classList.toggle('tour-mode', on);
    this.vessel.show(!on && !this.attracting);
    this.solarControls.element.hidden = on || this.attracting;
  }

  private frame(dt: number): void {
    fitCanvas(this.canvas, this.renderer, this.camera);
    if (this.flyer) this.flyer.step(moveKeys(this.loop.keys), dt, (p) => this.clearance(v3sub(p, this.flyer!.eye)));
    // The title runs on the real clock: every shot plays at real speed.
    const speed = this.attracting ? 1 : this.timeScale;
    let cut = false;
    if (this.voyage?.active && this.voyage.cameraKey !== this.voyageCameraKey) { this.voyageCameraKey = this.voyage.cameraKey; cut = true; }
    if (this.attract) {
      const a = this.attract;
      a.elapsed += dt;
      const next = a.cinema.at(a.elapsed);
      cut = next.shot !== a.frame.shot;
      a.frame = next;
      this.onTitle?.(next.title);
    }
    const before = this.time;
    if (this.voyage?.active && this.voyage.plan) { this.voyage.tick(dt); this.time = this.voyage.clock; }
    else this.time += dt * speed;
    this.limitClock();
    if (this.voyage?.active && this.voyage.state) {
      const s = this.voyage.state, frame = this.space.home.orbitFrame;
      const flightDirection = (v: Vec3): Vec3 => this.space.frames.direction(v, 'sun', frame, this.time);
      this.vessel.setFlight({ origin: this.space.frames.position(s.p, 'sun', frame, this.time), axes: shipAxes(flightDirection(s.forward), flightDirection(s.up)), acceleration: v3len(s.thrust), fuel: s.fuel, speed: v3len(s.v) });
    }
    const input = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement ? new Set<string>() : this.loop.keys;
    this.vessel?.step(dt, moveKeys(input), this.loop.keys.has('KeyB'));
    if (this.arriving) {
      // The arrival sets the clock itself: it jumps forward at each cut (and at Start).
      const a = this.arriving, first = a.elapsed === 0;
      a.elapsed += dt;
      const next = a.arrival.at(a.elapsed);
      if (next) {
        cut = first || next.shot !== a.frame.shot;
        a.frame = next;
        this.time = next.clock;
        this.onArrival?.(a.elapsed, a.arrival);
      } else {
        // Latched: hold the last frame (and its clock) until the page moves on.
        this.time = a.frame.clock;
        a.done();
      }
    }
    if (this.flyer && this.necklace) {
      const held = this.necklace.holdStation(this.flyer.eye, this.flyer.look(), before, this.time);
      this.flyer.eye = held.eye;
      this.flyer.lookAlong(held.look);
    }
    outside.clouds.value.z = outside.clouds.value.z - (dt * speed / DAY) * 0.05;
    this.place();
    this.controlClock += dt;
    if (this.controlClock >= .25) {
      this.controlClock = 0;
      this.solarControls.element.hidden = this.attracting || this.vessel?.active || this.voyage?.active;
      this.vessel?.show(!this.attracting && (!this.voyage?.active || this.vessel.active));
      this.solarControls.update(dateOf(this.space.jd(this.time)), this.observer?.id ?? null, this.sky?.sunDistance ?? AU);
      this.habitatCatalogue.update(this.time, this.habitatLights.count);
    }
    // A cut is a new camera: it meters afresh instead of adapting from the last shot.
    this.meterAndAdapt(cut ? Infinity : dt);
    const ratio = this.renderer.getPixelRatio(), px = (this.canvas.clientHeight || 720) * ratio;
    outside.pixelSolidAngle.value = ((this.camera.fov * Math.PI) / 180 / px) ** 2;
    outside.starExposure.value = starExposure(this.exposure, outside.pixelSolidAngle.value, this.sunSeen(), this.heroicStars);
    // The overlay's names, as a citizen's link shows them; not in the title's flight, aboard or on the tour.
    this.habitatLights.writeNames(this.camera, this.canvas.clientWidth || 1280, this.canvas.clientHeight || 720, outside.starExposure.value, outside.pixelSolidAngle.value,
      !this.attracting && !this.vessel?.active && !this.voyage?.active && this.loop.running);
    outside.viewport.value.set((this.canvas.clientWidth || 1280) * ratio, px);
    draw(this.stage);
  }

  /** How much of the Sun is in view (0–1): the stars fade only then. */
  private sunSeen(): number {
    if (!this.sky) return 0;
    const m = this.camera.matrixWorld.elements, fwd: Vec3 = [-m[8], -m[9], -m[10]];
    const th = Math.tan((this.camera.fov * Math.PI) / 360), half = Math.atan(th * Math.hypot(1, this.camera.aspect));
    return sunInView(Math.acos(Math.min(1, Math.max(-1, v3dot(fwd, this.sky.sunDir)))), half, this.sky.sunlight);
  }

  /** Meter the view (and a margin around it) on a grid of rays and let the exposure follow. */
  private meterAndAdapt(dt: number): void {
    if (!this.sky) return;
    const m = this.camera.matrixWorld.elements;
    const right: Vec3 = [m[0], m[1], m[2]], up: Vec3 = [m[4], m[5], m[6]], fwd: Vec3 = [-m[8], -m[9], -m[10]];
    const rays = meterRays(fwd, right, up, Math.tan((PERIPHERY * this.camera.fov * Math.PI) / 360), this.camera.aspect, 16, 9);
    const hulls = this.necklace?.hulls() ?? [];
    if (this.vessel?.active) hulls.push(this.vessel.meterHull(this.eyeAndTarget().eye));
    const ship = this.attract?.frame.ship, eye = this.attract?.frame.eye;
    if (ship && eye) {
      // The title's ship fills much of shot 1: the meter sees it as the cylinder of its crew section's beam.
      const L = this.shipShape.params.length;
      hulls.push({ center: v3sub(v3add(ship.position, v3scale(ship.forward, L / 2)), eye), axis: ship.forward, radius: this.shipShape.params.beam / 2, halfLength: L / 2, albedo: SHIP_ALBEDO });
    }
    // Inside the spindle's bore every ray lands on its walls, in the light of its lamps.
    const room = this.vessel?.active && this.vessel.inside ? { luminance: .18, light: 1 } : this.necklace?.insideBore() ? { luminance: BORE_ALBEDO * BORE_LIGHT, light: BORE_LIGHT } : null;
    const celestial = this.solar.seen.filter(s => s.body.radius / s.distance > .0003).sort((a, b) => a.distance - b.distance).map(s => ({ center: s.center, radius: s.body.radius, albedo: s.body.albedo, light: s.light }));
    const metered: Meterable = { sky: this.sky, hulls, earthshine: outside.earthshine.value, room, celestial };
    this.exposure = adapt(this.exposure, exposureFor(metered, rays, this.nightEyes ? DARKEST.nightEyes : DARKEST.plain), dt);
    outside.exposure.value = this.exposure;
  }
}

/** A distance for people: metres, kilometres or thousands of kilometres. */
function distanceOf(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${m.toFixed(m < 10 ? 1 : 0)} m`;
  if (m < 1e6) return `${(m / 1000).toFixed(m < 1e4 ? 1 : 0)} km`;
  return `${Math.round(m / 1000).toLocaleString('en')} km`;
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
  t.flipY = false;
  return filtered(t, { srgb: true, mips: 'own', anisotropy: 8 });
}
