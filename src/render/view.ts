import { HomesView, type RoomState } from './homes';
import type { HomeMode } from '../gen/homeInterior';
/**
 * The view from inside: the one renderer (WebGPU only), the Stage, the terrain tiles and the sunline, seen by a walker
 * on the ground or a flyer in the air. Everything is drawn relative to the eye (`toView`): the camera sits at the origin
 * and the world moves. Hold the right mouse button to look around (the pointer stays free for clicking things);
 * W A S D or the arrow keys to move, Shift to run, Space to jump; F takes off or lands, and in the air E or Space climbs,
 * Q or C sinks. On foot the physics carries the player (`physics/character.ts`): up is toward the axis, and gravity
 * is the spin's. The player is an Actors human (`render/actors`); V looks at them from behind, V again from their eyes.
 */
import { Color, CylinderGeometry, Group, Mesh, PerspectiveCamera, Scene, SphereGeometry, Vector3, type WebGPURenderer } from 'three/webgpu';
import { Stage, createRenderer, type ShaderMonitor } from '@futuremagic/stage';
import { deriveSeed, smoothstep, v3cross, v3dot, v3madd, v3norm, v3scale } from '@futuremagic/core';
import { fromWorld, toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import type { LinkLine, LinkService, Sighting } from '../link';
import { toScreenOrEdge } from './screen';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { EYE_HEIGHT, VIEW_FOV, Walker, type View } from '../world/walker';
import { Flyer } from '../world/flyer';
import { PhysicsWorld } from '../physics/world';
import { gravityReading, upAt, type GravityReading } from '../world/motion';
import { arrivalTerraceOf, revealAt, REVEAL_SECONDS, type ArrivalReveal } from '../world/arrival';
import { berthsOf } from '../gen/capsules';
import type { ArrivalTerrace } from '../gen/arrivalTerrace';
import { HUMAN, type Character } from '../physics/character';
import { Figure, castAsWorn, type AnimState, type MoveState } from './actors/figure';
import { playerLook } from './actors/looks';
import { addLights, dayOverhead, key, shineBelow, shineOn, sky } from './lights';
import { BELOW_MAKES_UP, adapt, glareOf, insideExposure, insideRayLuminance, landAlbedo, meterRays, underCrowns, type InsideMeterable } from './exposure';
import { sharedPool } from '../workers/pool';
import { BALL, CLOUDS_FAR, CLOUDS_NEAR, MIST_GLOW, SUNLINE, air, allKinds, below, setAir, setBelow, setEmission, setSunline, standInAttribute, view } from './materials';
import { dayPhase, emissionMean, nearestLit, sunlineEmission, sunlineNorm, EMISSION_SAMPLES } from '../world/sunline';
import { densityFalloff, seenMid } from '../world/air';
import { TerrainView, describeLayout } from './terrain';
import { PlantView } from './plants';
import type { Level } from '../gen/scatter';
import { slopeAt } from '../gen/scatter';
import { setFloorEye, setRockBeds, setSnow } from './groundShaders';
import { UNDER_CROWNS, crownsClosed, makeEcology, type Ecology } from '../gen/ecology';
import { FrameLoop, clickToUse, dragToLook, draw, fitCanvas, moveKeys, wheelOver } from './surface';
import { freeMesh } from './geometry';
import { cloudClearings, cloudSpan, cloudsAt } from '../world/clouds';
import { setCloudClearings, setCloudSpan, setCloudState } from './cloudShaders';
import { LandmarkView } from './landmarks';
import { TiledView, courtSource, crossingSource, hallSource, harbourSource, stairSource, underSource } from './tiled';
import { underStandAt, underHousesIn } from '../gen/underMesh';
import { hallAt } from '../gen/halls';
import { landmarkTopAt, landmarksOf } from '../gen/landmarks';
import { speckBands } from '../gen/standIn';
import { snowFieldOf } from '../gen/snow';
import { screenTextureBytes, screenTextures } from './actors/screens';
import { PeopleView } from './people';
import { SpeckView, type Measured } from './specks';
import { FlierView } from './fliers';
import { BoatView } from './boats';
import { TalkView, type Bubble } from './talk';
import type { Whereabouts } from '../system';
import { AnimalView, DEER, SQUIRRELS } from './animals';
import { BirdView } from './birds';
import { CabinView } from './lift';
import { NoticeView } from './notice';
import { CapsuleLink, CapsuleView, type Passenger } from './capsules';
import { Guardians } from './guardians';
import { GLASS, SKIES, skyOverBay } from '../gen/skies';
import { GlassDeck, type GlassStage, type GlassWant } from './glassDeck';
import { nearestExitCourt, type ExitCourt } from '../gen/exitCourt';
import { underOf } from '../gen/under';
import type { Hearing } from '../sim/sounds';
import { liftsNear, stagesNear } from '../sim/sources';
import { lightAt } from '../sim/birds';
import { calledFrom, doorsAbove, doorsBelow, doorsHit, eyeInCabin, liftDoorsNear, outside, type LiftDoors } from '../gen/lifts';

/** Running is this many times the walking speed. */
const RUN = 8;
/** How far inside the screen's edge the link pins a mark that is off screen (px). */
const OVERLAY_INSET = 34;
/** How long (s) the gravity meter takes to follow a change in the felt gravity, so a stride's jitter does not show. */
const GRAVITY_SMOOTHING = 0.25;
/** Faster than this (m/s) between two frames, the eye was put somewhere (Go), not moved: no wind for it. */
const TELEPORT = 300;
/** In a capsule, the ground where it sets down is asked for this long (s) before it lands. */
const LANDING_GROUND = 20;
/** A waiting capsule can be clicked from this far (m); walking in or out, the look eases round to the body's way at this rate (1/s). */
const CAPSULE_SEEN = 40;
const RIDE_LOOK_EASE = 1.5;
/** The physics' ground patch: side (m) and cell (m). */
const PATCH_SIZE = 192;
const PATCH_CELL = 1;
/** The player stops walking this share of the patch's size from its centre until the next patch arrives. */
const PATCH_EDGE = 0.4;
/** One sphere shared by every test ball (the kind's attributes: position and normal). */
const BALL_GEOMETRY = new SphereGeometry(0.25, 20, 14).deleteAttribute('uv');
/** Clock seconds per real second by default: real time (Arnd: a sped-up clock should not be the norm). Faster in the debug menu. */
const DAY_SPEED = 1;
/**
 * The camera on foot, set with the mouse wheel: from the player's eyes (0) out to `CHASE_FAR` metres behind the head,
 * rising to `CHASE_UP` above it by `CHASE_RISE` metres back. The nearest view from behind is `CHASE_NEAR`; one notch
 * further in goes back to the eyes. A notch moves it by a share (`CHASE_STEP` per unit of `deltaY`), and it glides
 * there (`CHASE_GLIDE`, 1/s). The body is always drawn on foot; its head (hair, eyes, hats: `HEAD_LAYER`) shows once the
 * camera is `HEAD_CLEAR` behind the eyes.
 */
const CHASE_NEAR = 1.2;
const HEAD_CLEAR = 0.3;
const CHASE_FAR = 12;
const CHASE_UP = 0.4;
const CHASE_RISE = 3.5;
const CHASE_STEP = 0.003;
const CHASE_GLIDE = 10;
/** The eyes' meter inside: a grid of rays over the frame, a few of them metered each frame (`glare`). */
const GLARE_COLUMNS = 5, GLARE_ROWS = 4, GLARE_PER_FRAME = 3;
/**
 * The layers of the player's body: the body on `BODY_LAYER`, which the camera and the shadow map always see, and the
 * head's own parts (`HEAD_PARTS`) on `HEAD_LAYER`, which the camera sees only from behind, so that from the eyes one
 * looks down at one's own chest, legs and feet without hair or lashes over the view.
 */
const BODY_LAYER = 1;
const HEAD_LAYER = 2;
const HEAD_PARTS = /^(teeth|tongue|eyes|eyelashes|brows-.*|hair-.*|.*-hat|.*glasses)$/;
/**
 * From the eyes, the body stands this far back (m, for a person of `HUMAN.height`), so the eyes are just in front of
 * the face and chest: looking down one sees their front, not the inside of the neck.
 */
const FIRST_PERSON_BACK = 0.3;
/** How far (in handrails) one steps out of a lift's doors on arriving (`outside`). */
const STEP_OUT = 1.5;
/** The glass deck's views: how far over the tallest trees' height (×). */
const OVER_CROWNS = 1.3;

export class InteriorView {
  readonly canvas = document.createElement('canvas');
  readonly walker: Walker;
  private renderer!: WebGPURenderer;
  private stage!: Stage;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(VIEW_FOV, 1, 0.3, 1e6);
  private readonly pool = sharedPool();
  private terrain: Terrain;
  /** The land's biomes (built with the terrain). */
  ecology: Ecology | null = null;
  /** The land's albedo for the eyes' meter (`landAlbedo`: the snow where it lies). */
  private albedoAt?: (p: Vec3) => number;
  private tiles: TerrainView | null = null;
  private plants: PlantView | null = null;
  private sunline: Mesh | null = null;
  /** The cloud layer's two crossings (far drawn first, near over it), on one cylinder; null without a layer. */
  private clouds: Group | null = null;
  private landmarks: LandmarkView | null = null;
  private stair: TiledView | null = null;
  private courts: TiledView | null = null;
  private crossings: TiledView | null = null;
  private halls: TiledView | null = null;
  private harbours: TiledView | null = null;
  /** The Understorey's pillar forest, drawn around the eye while it is below the land. */
  private under: TiledView | null = null;
  /**
   * Whether the player is below the land, in the Understorey (gen/under.ts): then they stand on its floor, the land's
   * things are not drawn (the vaults hide them), and the lamps light them.
   */
  private below = false;
  /** The cabin of the lift last used (gen/lifts.ts), and whether one is being made (a click then waits). */
  private cabin: CabinView | null = null;
  /** The notice to newcomers at the port door (gen/welcomeSign.ts). */
  private notice: NoticeView | null = null;
  /** The glass deck's views of the land above, while a hamlet with it is near (render/glassDeck.ts). */
  private glass: GlassDeck | null = null;
  private cabinMaking = false;
  /** The transport capsule the player calls through their link (render/capsules.ts), and their look round from its seat. */
  private caps: CapsuleView | null = null;
  private rideLook = { yaw: 0, pitch: 0 };
  /** The capsules' part of the player's link (main.ts serves it), and the lines their Minds say through it. */
  readonly capsules: LinkService = new CapsuleLink(() => this.caps, () => (this.loop.running ? { feet: this.walker.feetAt(), below: this.below } : null));
  onLine: ((line: LinkLine) => void) | null = null;
  /** The guardians who catch the player falling, and the ground's bag when none is near (render/guardians.ts). */
  private guards: Guardians | null = null;
  /** Their part of the link (main.ts serves it): nothing offered, a card while a catch has the player. */
  readonly guarding: LinkService = { id: 'guardians', title: 'Guardians', offers: () => [], status: () => this.guards?.status() ?? null };
  /** How far over the ground the next body stands up (m; the debug menu's falls), then 0 again. */
  private standAbove = 0;
  /** The people up on the land around the player. */
  private people: PeopleView | null = null;
  /** Everyone up on the land beyond them, as specks. */
  private specks: SpeckView | null = null;
  /** The drones that work the land. */
  private drones: FlierView | null = null;
  /** Who says what in the parties near the eye: the speech bubbles (render/talk.ts). */
  private talk: TalkView | null = null;
  /** Where the player is in the system (a visit, docs/system.md); null at home. Set before `setHabitat`. */
  whereabouts: Whereabouts | null = null;
  /** A resident's measured size and colours for the far specks (their look's, or their drone body's), once known. */
  private readonly measured: Measured = (id, design) => {
    if (design >= 0) return this.drones?.measured(design) ?? null;
    const dress = this.people?.residentsLoaded()?.measured(id);
    return dress ? { height: dress.height, width: dress.width, bands: speckBands(dress.colors) } : null;
  };
  /** The animals that live on it, a view for each kind: squirrels, deer. */
  animals: AnimalView[] = [];
  /** Its birds (their songs are the calls heard). */
  birds: BirdView | null = null;
  /** The boats on its water. */
  boats: BoatView | null = null;
  /** In the air, or null on foot. */
  private flyer: Flyer | null = null;
  private arrivalReveal: { terrace: ArrivalTerrace; elapsed: number; ready: (() => void) | null; done: (() => void) | null } | null = null;
  private arrivalGuide: ArrivalTerrace | null = null;
  onArrival: ((progress: number, nearby: boolean) => void) | null = null;
  private readonly loop = new FrameLoop((dt) => this.frame(dt), (e) => {
    if (this.arrivalReveal && !e.ctrlKey && !e.altKey && !e.metaKey) { this.finishArrivalReveal(); return; }
    if (e.code === 'KeyF' && !e.repeat && !this.cabin?.aboard && !this.caps?.carrying && !this.guards?.holding) this.toggleFlying();
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jump = true; }
  });
  /** Travel speed multiplier from the debug menu. */
  boost = 1;
  /** Below the land, the nearest lift up (null on the land or riding), for the link's Ways (app/link/ways.ts). */
  onExit: ((exit: ExitCourt | null) => void) | null = null;
  /** The speech bubbles this frame, for the page to draw over the view (app/bubbles.ts). */
  onTalk: ((bubbles: readonly Bubble[]) => void) | null = null;
  /**
   * Each frame, for the neural link's overlay (app/link): the frame's dt and where a point of the habitat's world frame
   * shows on screen this frame (on it, or pinned to its edge toward the point).
   */
  onOverlay: ((dt: number, project: (p: Vec3) => Sighting) => void) | null = null;
  private readonly sight = (p: Vec3): Sighting => toScreenOrEdge(this.camera, toView(this.posedAt, p), this.canvas.clientWidth, this.canvas.clientHeight, OVERLAY_INSET);
  private exitClock = 0;
  /** Called each frame with the gravity the player feels (the page's gravity meter), smoothed over a fraction of a second. */
  onGravity: ((r: GravityReading) => void) | null = null;
  /** Walking and running speed on foot (m/s), for the gravity meter's explanation. */
  get paces(): { walk: number; run: number } { return { walk: this.walker.speed, run: this.walker.speed * RUN }; }
  private gravity: GravityReading | null = null;
  private lastAt: Vec3 | null = null;
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

  /**
   * Where something standing at (θ, s) rests: the ground or the water, or a landmark's deck or bridge over them (its
   * height above the profile). The walker, the flyer and the camera keep to it.
   */
  private readonly standOn = (theta: number, s: number): number => {
    if (this.below) return underStandAt(this.terrain, theta, s);
    const g = this.terrain.standAt(theta, s), top = landmarkTopAt(this.terrain, theta, s);
    return top !== null && top > g ? top : g;
  };

  private homes: HomesView | null = null;
  onRoom: ((state: RoomState | null) => void) | null = null;
  arrangeHome(mode: HomeMode | null): void { this.homes?.choose(mode); }

  private constructor(private habitat: Habitat) {
    // Start in the morning: a quarter of the way through the daylight hours.
    this.time = habitat.params.day.length * habitat.params.day.daylight * 0.25;
    this.terrain = makeTerrain(habitat);
    this.walker = new Walker(habitat.profile, undefined, this.standOn);
    this.canvas.className = 'view-canvas';
    // Before the warm-up: the lights are part of every lit shader's key.
    addLights(this.scene);
  }

  /** Make the view: throws `GraphicsUnavailable` where the browser has no WebGPU (the caller shows why). */
  static async create(habitat: Habitat, whereabouts: Whereabouts | null = null): Promise<InteriorView> {
    const v = new InteriorView(habitat);
    v.whereabouts = whereabouts;
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
    v.bodyLoaded = v.loadPlayer();
    return v;
  }

  /** Resolves once the player's body is loaded and its shaders warmed (the arrival's timing line). */
  bodyLoaded: Promise<void> = Promise.resolve();

  /** The shaders this view built and when (its Stage's monitor): the arrival's timing line watches them. */
  get shaderLog(): ShaderMonitor {
    return this.stage.monitor;
  }

  /** Load the player's body (the same person for the same world seed) and put it in, hidden until seen. */
  private async loadPlayer(): Promise<void> {
    const figure = await Figure.load(await playerLook(deriveSeed(this.habitat.params.seed, 'player')));
    figure.object.visible = false;
    figure.object.traverse((o) => o.layers.set(HEAD_PARTS.test(o.name) ? HEAD_LAYER : BODY_LAYER));
    castAsWorn(figure.object);
    key.shadow.camera.layers.enable(BODY_LAYER);
    key.shadow.camera.layers.enable(HEAD_LAYER);
    this.camera.layers.enable(BODY_LAYER);
    // Every part's shadow is warmed, not one per kind of part: a figure's shadow shaders are its own (Stage.prepare).
    // The head's parts are compiled too (the camera sees them only from behind).
    const head = this.camera.layers.isEnabled(HEAD_LAYER);
    this.camera.layers.enable(HEAD_LAYER);
    await this.stage.prepare(figure.object, { everyCaster: true }).finally(() => { if (!head) this.camera.layers.disable(HEAD_LAYER); });
    this.scene.add(figure.object);
    this.figure = figure;
  }

  /** Bytes the player's body holds (memory watchdog). */
  bodyBytes(): number {
    return this.figure?.bytes() ?? 0;
  }

  /** Bytes the people around the player hold: figures, stand-ins, measures, the population's caches (memory watchdog). */
  peopleBytes(): number {
    return (this.people?.bytes() ?? 0) + (this.specks?.bytes() ?? 0) + screenTextureBytes();
  }

  /** Bytes the conversations near the player hold: their lines and the residents met (memory watchdog). */
  talkBytes(): number {
    return this.talk?.bytes() ?? 0;
  }

  /** Bytes the drones hold: their designs on the GPU, their instances (memory watchdog). */
  droneBytes(): number {
    return this.drones?.bytes() ?? 0;
  }

  /** Bytes the birds hold: their bodies on the GPU, their instances and homes (memory watchdog). */
  birdBytes(): number {
    return this.birds?.bytes() ?? 0;
  }

  /** Bytes the boats hold: their designs on the GPU, their instances (memory watchdog). */
  boatBytes(): number {
    return this.boats?.bytes() ?? 0;
  }

  /** Bytes the animals hold: their figures, coats and specks (memory watchdog). */
  animalBytes(): number {
    return this.animals.reduce((n, a) => n + a.bytes(), 0);
  }

  /** Bytes of geometry this view holds (memory watchdog). */
  bytes(): number {
    return (this.tiles?.bytes() ?? 0) + (this.plants?.bytes() ?? 0) + (this.landmarks?.bytes() ?? 0) + (this.stair?.bytes() ?? 0) + (this.courts?.bytes() ?? 0) + (this.crossings?.bytes() ?? 0) + (this.halls?.bytes() ?? 0) + (this.harbours?.bytes() ?? 0) + (this.under?.bytes() ?? 0) + (this.cabin?.bytes() ?? 0) + (this.notice?.bytes() ?? 0) + (this.caps?.bytes() ?? 0) + (this.guards?.bytes() ?? 0) + (this.glass?.bytes() ?? 0) + (this.homes?.bytes() ?? 0);
  }

  /** Give memory back (memory watchdog): drop every cached tile and plant cell not on screen. */
  shed(): void {
    this.tiles?.shed();
    this.plants?.shed();
    this.landmarks?.shed();
    this.stair?.shed();
    this.courts?.shed();
    this.crossings?.shed();
    this.halls?.shed();
    this.harbours?.shed();
    this.under?.shed();
    this.people?.shed();
    this.talk?.shed();
    this.homes?.shed();
    this.glass?.dropAtlas();
  }

  /**
   * What the player hears from (audio/sound.ts, sim/sounds.ts): the land and the clock, the eye and how fast it moves, and
   * the feet while they walk on the ground. Null until the land's ecology is made or while the view is not running.
   */
  hearing(): Hearing | null {
    const e = this.ecology;
    if (!e || !this.loop.running) return null;
    const view = this.current(), h = this.habitat, at = fromWorld(h.profile, ...view.eye), c = this.character;
    const onFoot = !!c && !this.flyer && !this.cabin?.aboard && !this.caps?.carrying && !this.arrivalReveal;
    const v = onFoot ? c.velocity : [0, 0, 0] as Vec3;
    const along = v3madd(v, view.up, -v3dot(v, view.up)), speed = Math.hypot(...along);
    let feet: Hearing['feet'] = null;
    if (onFoot && (c.grounded || c.swimming)) {
      const f = fromWorld(h.profile, ...c.feet());
      feet = { theta: f.theta, s: f.s, h: f.h, speed };
    }
    const sources = liftsNear(this.terrain, at.theta, at.s, this.below);
    if (this.below) sources.push(...stagesNear(this.terrain, at.theta, at.s));
    const ride = this.cabin?.ride;
    this.people?.heard(view.eye, this.time, this.below, sources);
    if (!this.below) {
      for (const a of this.animals) a.heard(view.eye, this.time, sources);
      this.drones?.heard(view.eye, sources);
      this.birds?.heard(view.eye, this.time, sources);
    }
    return {
      ecology: e,
      time: this.time,
      listener: { theta: at.theta, s: at.s, h: at.h, ground: this.standOn(at.theta, at.s), below: this.below, speed: this.eyeSpeed },
      eye: view.eye, look: view.look, up: view.up,
      feet,
      gravity: h.gravityAt(Math.hypot(view.eye[0], view.eye[1])),
      climb: onFoot ? v3dot(v, view.up) : 0,
      flight: this.flyer ? this.eyeSpeed : 0,
      sources,
      lift: ride?.aboard ? { court: this.cabin!.court, share: ride.elapsed / Math.max(ride.seconds, 1e-3), moving: !ride.waits } : null,
      birds: this.below ? [] : this.birds?.nests ?? [],
      flocks: this.below ? [] : this.birds?.flockList ?? [],
    };
  }

  /** Lines for the debug menu. */
  info(): string {
    const a = this.flyer ? fromWorld(this.habitat.profile, ...this.flyer.eye) : this.walker.at;
    const c = this.character, g = this.habitat.gravityAt(Math.hypot(...this.current().eye.slice(0, 2) as [number, number]));
    const where = this.below ? `below the land${this.skyLine(a.theta, a.s)}, ` : '', ride = this.cabin?.ride;
    const mode = ride?.aboard ? `in a lift, ${ride.waits ? 'waiting for the floor below' : ride.to > ride.from ? 'going up' : 'going down'}` : this.caps?.carrying ? `in a capsule (${this.caps.phase})` : this.guards?.holding ? `caught falling (${this.guards.phase})` : where + (this.flyer ? `flying ${this.flyer.clearance().toFixed(0)} m up`
      : !c ? 'on foot (waiting for the physics)' : `on foot, ${c.swimming ? 'swimming' : c.grounded ? 'standing' : 'in the air'}, gravity ${(g / 9.81).toFixed(2)} g`);
    return [
      this.stage.hudLine(),
      `${this.tiles?.info() ?? 'terrain: none'} · ${describeLayout(this.terrain)} · ${this.pool.workers} workers`,
      this.plants?.info() ?? 'plants: none',
      this.plants?.lodLine() ?? '',
      this.landmarks?.info() ?? 'landmarks: none',
      this.stair?.info() ?? 'lift stair: none',
      this.courts?.info() ?? 'entrance courts: none',
      this.crossings?.info() ?? 'river crossings: none',
      this.halls?.info() ?? 'grown halls: none',
      this.harbours?.info() ?? 'harbours: none',
      this.under?.info() ?? 'understorey: none',
      this.homes?.info() ?? 'home furniture: none',
      this.glass?.info() ?? 'glass deck: none',
      this.people?.info() ?? 'people: none',
      this.specks?.info() ?? 'specks: none',
      this.drones?.info() ?? 'drones: none',
      this.talk?.info() ?? 'talk: none',
      ...(this.animals.length ? this.animals.map((a) => a.info()) : ['animals: none']),
      this.birds?.info() ?? 'birds: none',
      this.boats?.info() ?? 'boats: none',
      this.caps?.info() ?? 'capsule: none',
      this.guards?.info() ?? 'guardians: none',
      `θ ${(a.theta * 180 / Math.PI).toFixed(1)}°, s ${(a.s / 1000).toFixed(2)} of ${(this.habitat.profile.length / 1000).toFixed(2)} km, ground ${this.standOn(a.theta, a.s).toFixed(1)} m, ${mode}, eyes ×${this.exposure.toFixed(2)}`,
    ].join('\n');
  }

  /** Below the land, the bay at (θ, s): its use, its hall (gen/halls.ts) or houses (gen/homes.ts) and which hamlet's sky is over it (gen/skies.ts), for the debug menu. */
  private skyLine(theta: number, s: number): string {
    const u = underOf(this.habitat), bay = u.bayAt(theta, s), sky = bay ? skyOverBay(this.habitat, bay.i, bay.j) : -1;
    const houses = bay ? underHousesIn(this.terrain, bay.i, bay.j).houses : [];
    const built = houses.map((x) => `${x.era} ${x.build}, ${x.storeys} storeys${x.lived ? '' : ', empty'}`).join('; ');
    const hall = bay ? hallAt(this.habitat, bay.i, bay.j) : null;
    const use = bay ? `${u.useAt(bay.i, bay.j)} bay${hall ? `: ${hall}` : ''}${built ? `: ${built}` : ''}; ` : '';
    return sky < 0 ? ` (${use}no sky over this bay)` : ` (${use}under a hamlet's ${SKIES[sky].name} sky)`;
  }

  /** The sunline's light and the clouds at the clock's hour. */
  private shine(): void {
    sunlineEmission(this.habitat, this.time, this.emission);
    setEmission(this.emission, emissionMean(this.emission));
    const c = cloudsAt(this.habitat, this.time);
    setCloudState(c && this.cloudCover !== null ? { ...c, cover: this.cloudCover } : c);
  }

  /** The cloud cover set in the debug menu in place of the schedule's, or null for the schedule. */
  cloudCover: number | null = null;
  /** Draw only one level of every plant (debug: compare the levels' size and colour), or null for all of them. */
  get plantLevel(): Level | null { return this.plants?.only ?? null; }
  set plantLevel(l: Level | null) { if (this.plants) this.plants.only = l; }

  /** Take off (if on foot) and rise to `height` metres over the ground below (debug menu). */
  flyUp(height: number): void {
    if (!this.flyer) this.toggleFlying();
    const f = this.flyer!, at = fromWorld(this.habitat.profile, ...f.eye);
    f.eye = toWorld(this.habitat.profile, { theta: at.theta, s: at.s, h: this.standOn(at.theta, at.s) + height });
  }

  /** The hour, for the debug menu: day number, clock time on a 24-hour face, and how far the sun has travelled. */
  clockLine(): string {
    const d = this.habitat.params.day, phase = dayPhase(this.habitat, this.time);
    const hours = (phase * 24 + 6) % 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    const sun = phase < d.daylight ? `sun ${(100 * phase / d.daylight).toFixed(0)}% of the way to the port end` : 'night';
    const c = cloudsAt(this.habitat, this.time), cover = this.cloudCover ?? c?.cover;
    const sky = cover === undefined ? 'no cloud layer' : `clouds ${(100 * cover).toFixed(0)}%${this.cloudCover === null ? '' : ' (set)'}`;
    return `day ${Math.floor(this.time / d.length) + 1}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (dawn at 06:00), ${sun}, ${sky}, clock ×${this.timeScale}`;
  }

  /** Move the clock on by `seconds` (debug menu). */
  skip(seconds: number): void {
    this.time += seconds;
  }

  /**
   * Move the clock on to when the light over the eye next reaches `level` of the day's (sim/birds.ts `lightAt`), rising
   * (the dawn chorus) or falling, then on by `shift` s (back, when negative); within a day, by the minute (debug menu).
   */
  skipToLight(level: number, rising: boolean, shift = 0): void {
    const h = this.habitat, s = fromWorld(h.profile, ...this.current().eye).s;
    for (let t = this.time + 60 - shift; t < this.time + h.params.day.length - shift; t += 60) {
      const now = lightAt(h, s, t), before = lightAt(h, s, t - 60);
      if (rising ? before < level && now >= level : before > level && now <= level) { this.time = t + shift; return; }
    }
  }

  /** Let a ball fall from `height` metres, a few steps ahead: it lands behind the spot below it (Coriolis). */
  async dropBall(height: number): Promise<void> {
    const physics = await this.physicsReady();
    const v = this.current();
    const ahead = fromWorld(this.habitat.profile, v.eye[0] + v.look[0] * 4, v.eye[1] + v.look[1] * 4, v.eye[2] + v.look[2] * 4);
    const radius = 0.25;
    const ground = this.standOn(ahead.theta, ahead.s);
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
    for (const [id, mesh] of this.balls) { this.physics?.remove(id); this.stage.remove(mesh); freeMesh(mesh, 'none'); }
    this.balls.clear();
    this.drop = null;
  }

  /** The physics line for the debug menu. */
  physicsLine(): string {
    if (!this.physics) return 'physics: not started (drop a ball)';
    const d = this.drop;
    const last = !d ? '' : d.landed === null ? `, ball falling from ${d.height} m`
      : `, last ball from ${d.height} m landed ${d.landed.toFixed(2)} m antispinward (blueprint: ${this.habitat.dropOffset(d.height).toFixed(2)} m)`;
    return `physics: ${this.physics.count} bodies, ${this.physics.trunkCount} trunk pieces${last}`;
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
    const answer = await this.pool.job({ kind: 'patch', params: this.habitat.params, theta: at.theta, s: at.s, size: PATCH_SIZE, cell: PATCH_CELL, below: this.below });
    if ('patch' in answer && this.physics) this.physics.setGround(answer.patch);
    this.patchAsked = false;
    this.standUp();
  }

  /** Give the walker a body once the physics has ground under it (at the start, and after landing). */
  private standUp(): void {
    const p = this.physics;
    if (!p || this.flyer || this.character || this.cabin?.aboard || this.caps?.carrying || this.guards?.holding) return;
    const { theta, s } = this.walker.at;
    const feet = toWorld(this.habitat.profile, { theta, s, h: this.standOn(theta, s) + 0.05 + this.standAbove });
    // Not on a patch of the other level (the land's, when below): ask for one of this one, which stands the body up.
    if (p.groundPatch && p.groundPatch.below !== this.below) { void this.groundFor(feet); return; }
    if (p.offPatch(feet, PATCH_EDGE)) return;
    this.character = p.addCharacter(feet, this.terrain.waterDepth);
    this.standAbove = 0;
  }

  /** Step the physics and put the balls where it says. */
  private simulate(dt: number, eye: Vec3): void {
    const p = this.physics;
    if (!p) return;
    // In a capsule the ground under the eye is not wanted on the way, only where it sets down (asked as it nears).
    // Caught falling, likewise: the ground where the guardians set the body down, as they near it.
    const held = !!this.guards?.holding, carried = !!this.caps?.carrying || held;
    const landing = this.caps?.carrying ? this.caps.landingSoon(LANDING_GROUND) : held ? this.guards!.groundSoon(LANDING_GROUND) : null, wanted = landing ?? (carried ? null : eye);
    if (wanted && (p.needsGround(wanted) || (p.groundPatch && p.groundPatch.below !== this.below))) void this.groundFor(wanted);
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
    for (const [id, mesh] of this.balls) if (!alive.has(id)) { this.stage.remove(mesh); freeMesh(mesh, 'none'); this.balls.delete(id); }
  }

  /** Show another habitat (the Lab changed it). */
  async setHabitat(h: Habitat): Promise<void> {
    if (h === this.habitat) return;
    this.finishArrivalReveal();
    this.arrivalGuide = null;
    this.onArrival?.(1, false);
    this.habitat = h;
    this.terrain = makeTerrain(h);
    this.flyer = null;
    this.character = null;
    this.clearBalls();
    this.physics?.dispose();
    this.physics = null;
    this.physicsLoading = null;
    this.walker.setProfile(h.profile, this.standOn);
    await this.build();
  }

  private async build(): Promise<void> {
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose(); }
    if (this.plants) { this.scene.remove(this.plants.group); this.plants.dispose(); }
    if (this.landmarks) { this.scene.remove(this.landmarks.group); this.landmarks.dispose(); }
    if (this.stair) { this.scene.remove(this.stair.group); this.stair.dispose(); }
    if (this.courts) { this.scene.remove(this.courts.group); this.courts.dispose(); }
    if (this.crossings) { this.scene.remove(this.crossings.group); this.crossings.dispose(); }
    if (this.halls) { this.scene.remove(this.halls.group); this.halls.dispose(); }
    if (this.harbours) { this.scene.remove(this.harbours.group); this.harbours.dispose(); }
    if (this.under) { this.scene.remove(this.under.group); this.under.dispose(); }
    if (this.cabin) { this.scene.remove(this.cabin.group); this.cabin.dispose(); }
    if (this.notice) { this.scene.remove(this.notice.group); this.notice.dispose(); }
    this.caps?.dispose();
    this.guards?.dispose();
    this.glass?.dispose();
    this.homes?.dispose();
    this.people?.dispose();
    this.specks?.dispose();
    this.drones?.dispose();
    for (const a of this.animals) a.dispose();
    this.animals = [];
    this.birds?.dispose();
    this.birds = null;
    this.boats?.dispose();
    this.boats = null;
    if (this.sunline) { this.stage.remove(this.sunline); freeMesh(this.sunline); }
    if (this.clouds) { this.stage.remove(this.clouds); [...this.clouds.children].forEach((m, i) => freeMesh(m as Mesh, i === 0 ? 'all' : 'none')); }
    const h = this.habitat;
    this.norm = sunlineNorm(h);
    setSunline(h.length, this.norm, nearestLit(h));
    this.shine();
    setAir(densityFalloff(h), h.radius, seenMid(h), h.params.air.hazeDistance);
    setRockBeds(h.params.relief.terraceStep, h.radius);
    setSnow(snowFieldOf(h));
    setBelow(h.params.under);
    // The sunline: from the wild wall to the port wall along the axis.
    const tube = new CylinderGeometry(h.params.sunlineRadius, h.params.sunlineRadius, h.length, 24, 1, true);
    tube.deleteAttribute('uv'); // the kind's attributes are position and normal (docs/SHADERS.md)
    tube.rotateX(Math.PI / 2);
    tube.translate(0, 0, h.length / 2);
    this.sunline = new Mesh(tube, SUNLINE.material);
    this.sunline.name = 'sunline';
    this.sunline.frustumCulled = false;
    this.clouds = this.cloudLayer();
    this.camera.far = 4 * (h.radius + h.length);
    this.camera.updateProjectionMatrix();
    this.tiles = new TerrainView(this.terrain, this.stage, this.pool);
    this.scene.add(this.tiles.group);
    this.ecology = makeEcology(this.terrain);
    this.albedoAt = landAlbedo(this.ecology);
    this.plants = new PlantView(this.ecology, this.stage, this.pool);
    this.scene.add(this.plants.group);
    this.landmarks = new LandmarkView(h, landmarksOf(this.terrain), this.stage, this.pool);
    this.scene.add(this.landmarks.group);
    this.stair = new TiledView(stairSource(h), h, this.stage, this.pool);
    this.scene.add(this.stair.group);
    this.courts = new TiledView(courtSource(this.terrain), h, this.stage, this.pool);
    this.scene.add(this.courts.group);
    this.crossings = new TiledView(crossingSource(this.terrain), h, this.stage, this.pool);
    this.scene.add(this.crossings.group);
    this.halls = new TiledView(hallSource(this.terrain), h, this.stage, this.pool);
    this.scene.add(this.halls.group);
    this.harbours = new TiledView(harbourSource(this.terrain), h, this.stage, this.pool);
    this.scene.add(this.harbours.group);
    this.under = new TiledView(underSource(this.terrain), h, this.stage, this.pool);
    this.scene.add(this.under.group);
    this.homes = new HomesView(this.terrain, this.stage);
    this.scene.add(this.homes.group);
    this.cabin = new CabinView(this.terrain, this.stage);
    this.notice = new NoticeView(h, this.stage);
    this.scene.add(this.notice.group);
    this.scene.add(this.cabin.group);
    this.caps = new CapsuleView(h, this.terrain, this.stage, this.pool, (line) => this.onLine?.(line));
    this.scene.add(this.caps.group);
    this.guards = new Guardians(h, this.stage, this.pool, (line) => this.onLine?.(line));
    this.scene.add(this.guards.group);
    this.glass = new GlassDeck(this.renderer, this.scene, this.camera);
    this.people = new PeopleView(h, this.terrain, this.stage, this.camera, (theta, s) => landmarkTopAt(this.terrain, theta, s));
    this.scene.add(this.people.group);
    this.specks = new SpeckView(h, this.stage, this.pool);
    this.scene.add(this.specks.group);
    this.drones = new FlierView(h, this.terrain, this.stage, this.camera, this.pool);
    this.scene.add(this.drones.group);
    this.talk = new TalkView(h, this.terrain, this.whereabouts ?? undefined);
    this.people.speaker = this.drones.speaker = this.talk.speaker;
    this.animals = [new AnimalView(SQUIRRELS, h, this.terrain, this.stage, this.camera, this.pool), new AnimalView(DEER, h, this.terrain, this.stage, this.camera, this.pool)];
    for (const a of this.animals) this.scene.add(a.group);
    this.birds = new BirdView(h, this.terrain, this.stage, this.camera, this.pool);
    this.scene.add(this.birds.group);
    this.boats = new BoatView(h, this.terrain, this.stage, this.camera, this.pool);
    this.scene.add(this.boats.group);
    this.place();
    // While loading, nothing draws, but the compile cap still counts frames (one new shader per frame): keep its
    // frames ticking, or a second build here (a shadow pass's own shader) would wait for a frame that never comes.
    let loading = true;
    const tick = (): void => { if (!loading) return; this.stage.frame(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      await Promise.all([this.stage.add(this.sunline), this.clouds && this.stage.add(this.clouds), this.tiles.load(), this.notice.load()]);
    } finally {
      loading = false;
    }
  }

  /** The cloud layer's meshes (world/clouds.ts): one closed cylinder at its base radius, drawn from both sides. */
  private cloudLayer(): Group | null {
    const h = this.habitat, span = cloudSpan(h);
    setCloudSpan(span, h.params.clouds?.size ?? 1);
    setCloudClearings(cloudClearings(h));
    setCloudState(cloudsAt(h, this.time));
    if (!span) return null;
    // Fine enough around that its faces lie within a metre of the true cylinder (the march itself is exact).
    const around = Math.min(1024, Math.max(64, Math.ceil(Math.PI / Math.acos(1 - 1 / span.base))));
    // Closed: a line of sight from inside the layer may leave it through an end.
    const g = new CylinderGeometry(span.base, span.base, span.z1 - span.z0, around, 1, false);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal'); // the kinds' attribute is position only (docs/SHADERS.md)
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, (span.z0 + span.z1) / 2);
    const layer = new Group();
    layer.name = 'clouds';
    [CLOUDS_FAR, CLOUDS_NEAR].forEach((k, i) => {
      const m = new Mesh(g, k.material);
      m.name = k.name;
      m.frustumCulled = false;
      m.renderOrder = 1 + i;
      layer.add(m);
    });
    return layer;
  }

  /** Put the camera at the origin looking the walker's way, and the world around it relative to the eye. */
  private place(): void {
    const v = this.current();
    this.posedAt = v.eye;
    view.eye.value.set(...v.eye);
    setFloorEye(v.eye);
    this.camera.position.set(0, 0, 0);
    this.camera.up.set(...v.up);
    this.camera.lookAt(v.look[0], v.look[1], v.look[2]);
    if (this.sunline) this.sunline.position.set(...toView(v.eye, [0, 0, 0]));
    this.clouds?.position.set(...toView(v.eye, [0, 0, 0]));
    this.pose(v.eye);
    const pixelsPerRadian = (this.canvas.clientHeight || 720) / (this.camera.fov * Math.PI / 180);
    this.tiles?.follow(v.eye, pixelsPerRadian);
    this.plants?.follow(v.eye, this.frameDt);
    this.landmarks?.follow(v.eye, pixelsPerRadian);
    this.stair?.follow(v.eye);
    this.courts?.follow(v.eye);
    this.crossings?.follow(v.eye);
    this.halls?.follow(v.eye);
    this.harbours?.follow(v.eye);
    // In a lift the floor below is wanted all the way (from the shaft the eye is above the vaults, and wants none).
    const rideFrom = this.cabin?.aboard ? this.cabin.place(0) : null;
    this.under?.follow(v.eye, rideFrom ? eyeInCabin(this.habitat, rideFrom, EYE_HEIGHT) : v.eye);
    this.cabin?.poseAt(v.eye);
    this.notice?.poseAt(v.eye);
    this.caps?.poseAt(v.eye);
    this.guards?.poseBag(v.eye);
    this.exitClock += this.frameDt;
    if (this.onExit && (!this.below || this.exitClock >= 0.1)) {
      this.exitClock = 0;
      const at = fromWorld(this.habitat.profile, ...v.eye);
      this.onExit(this.below && !this.cabin?.aboard ? nearestExitCourt(this.terrain, at.theta, at.s) : null);
    }
    this.showLand(!this.below);
    below.people.value = this.below ? 1 : 0;
    const room = this.homes?.update(v.eye, this.time, this.frameDt, this.below, this.under?.drawnKeys() ?? []) ?? null;
    this.onRoom?.(room);
    this.physics?.setFurniture(this.homes?.bodies ?? []);
    // Screen fabrics' shared clock, once a frame before any figure is posed.
    screenTextures.update(this.frameDt);
    this.people?.follow(v.eye, this.time, this.frameDt, this.below, this.homes?.intent);
    this.drones?.follow(v.eye, this.time, this.frameDt, this.people?.aloft, this.below, this.below ? [] : this.guards?.fliers(v.eye));
    if (this.talk && this.people) this.talk.bubblesAt(this.people, v.eye, this.time, this.camera, this.canvas.clientWidth, this.canvas.clientHeight);
    this.onTalk?.(this.talk?.bubbles ?? []);
    this.onOverlay?.(this.frameDt, this.sight);
    this.specks?.follow(this.time, this.frameDt, [...(this.people?.near ?? []), ...(this.drones?.near ?? [])], this.measured);
    for (const a of this.animals) a.follow(v.eye, this.time, this.frameDt);
    this.birds?.follow(v.eye, this.time, this.frameDt, this.below);
    this.boats?.follow(v.eye, this.time, this.frameDt, this.below);
  }

  /**
   * Draw the land's things or not: below the land the Understorey's vaults hide all of them, so they are left out of
   * the frame (and the shadow map), and the background is the mist's.
   */
  private showLand(on: boolean): void {
    for (const g of [this.tiles?.group, this.plants?.group, this.landmarks?.group, this.stair?.group, this.courts?.group, this.crossings?.group, this.halls?.group, this.harbours?.group, this.specks?.group, this.sunline, this.clouds, this.birds?.group, this.boats?.group, ...this.animals.map((a) => a.group)]) if (g) g.visible = on;
  }

  /** Where the eye is now (world). */
  eye(): Vec3 {
    return this.current().eye;
  }

  private current(): View {
    const reveal = this.reveal();
    // The arrival's walk: the camera follows the newcomer out of the door (world/arrival.ts).
    if (reveal) return this.behind(reveal, reveal.chase);
    if (this.flyer) return this.flyer.view();
    const v = this.walker.view(), cabin = this.cabin?.aboard ? this.cabin.place() : null;
    // In a lift: standing in the cabin, looking round as on foot.
    if (cabin) return { eye: eyeInCabin(this.habitat, cabin, EYE_HEIGHT), look: v.look, up: cabin.ez };
    // In a capsule: from the passenger's eyes (seated lower and further back), looking round from the way they face.
    const rider = this.caps?.passenger();
    if (rider) return this.behind(this.riderView(rider), this.chase);
    // From the eyes, at the body's own eye height (it differs from person to person), so one looks down at its front.
    const f = this.figure, own = f && this.character ? (f.eyeHeight - EYE_HEIGHT) * Math.max(0, 1 - this.chase / HEAD_CLEAR) : 0;
    return this.behind(own ? { ...v, eye: v3madd(v.eye, v.up, own) } : v, this.chase);
  }

  /** The view from a capsule passenger's eyes: over their feet at their eye height (seated, back over the hips), looking as turned from their facing. */
  private riderView(r: Passenger): View {
    const scale = this.figure ? this.figure.eyeHeight / EYE_HEIGHT : 1, right = v3cross(r.front, r.up);
    const cy = Math.cos(this.rideLook.yaw), sy = Math.sin(this.rideLook.yaw), cp = Math.cos(this.rideLook.pitch), sp = Math.sin(this.rideLook.pitch);
    const flat = v3madd(v3scale(r.front, cy), right, sy), look = v3norm(v3madd(v3scale(flat, cp), r.up, sp));
    return { eye: v3madd(v3madd(r.feet, r.front, -r.pose.back), r.up, r.pose.eye * scale), look, up: r.up };
  }

  /** The arrival's walk at this moment, while it runs. */
  private reveal(): ArrivalReveal | null {
    const r = this.arrivalReveal;
    return r ? revealAt(this.habitat, r.terrace, Math.max(0, r.elapsed)) : null;
  }

  /** The camera `d` m behind the eyes of `v` and a little above the head, looking the same way; never under the ground. */
  private behind(v: View, d: number): View {
    if (d < 0.01) return { eye: v.eye, look: v.look, up: v.up };
    let eye = v3madd(v3madd(v.eye, v.look, -d), v.up, CHASE_UP * Math.min(1, d / CHASE_RISE));
    const at = fromWorld(this.habitat.profile, ...eye), floor = this.standOn(at.theta, at.s) + 0.3;
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

  /** The eyes' exposure, adapting over time (`adapt`). */
  private exposure = 1;
  private readonly meterColor = new Float32Array(3);
  private readonly meterCanopy = new Float32Array(4);

  /**
   * The eyes open up in a wood's shade (`insideExposure`): the crowns over the eye, unless it is above them. Applied to
   * every inside kind (`view.exposure`) and to three's lights, which light the player's body.
   */
  private adaptEyes(eye: Vec3): void {
    let closed = 0;
    if (this.ecology) {
      const at = fromWorld(this.habitat.profile, ...eye), ground = this.terrain.heightAt(at.theta, at.s);
      // With the ground's own slope: on steep rock no wood closes over the eyes.
      this.ecology.colorAt(at.theta, at.s, ground, slopeAt(this.ecology, at.theta, at.s, ground, 4), this.meterColor, 0, this.meterCanopy);
      const raise = this.meterCanopy[3];
      closed = crownsClosed(raise) * (1 - smoothstep(raise * 0.8, raise * 1.2, at.h - ground));
    }
    // Below the land the lamps' light is all there is: the eyes open up to it, and the background is the lit mist.
    const target = this.below ? insideExposure(this.habitat.params.under.lamp, BELOW_MAKES_UP) : insideExposure(underCrowns(closed, air.skyLight.value, UNDER_CROWNS)) * this.glare(eye);
    this.exposure = adapt(this.exposure, target, Math.min(this.frameDt, 0.25));
    view.exposure.value = this.exposure;
    const back = this.scene.background as Color;
    if (this.below) back.copy(below.tint.value as Color).multiplyScalar((below.lamp.value as number) * MIST_GLOW * this.exposure);
    else back.copy(air.haze.value as Color);
    key.intensity *= this.exposure;
    sky.intensity *= this.exposure;
  }

  /** The meter's rays' luminances (`insideRayLuminance`), a few refreshed each frame, and the next ray to refresh. */
  private readonly seen = new Float32Array(GLARE_COLUMNS * GLARE_ROWS);
  private nextSeen = 0;

  /**
   * The eyes' stop-down in the air's glow and the light near the axis (`glareOf`), metered over the frame on a coarse
   * grid against the land itself: a few rays each frame (each walks the terrain, about a quarter of a millisecond), the whole
   * grid several times a second, which the eyes, taking most of a second to follow, do not outpace.
   */
  private glare(eye: Vec3): number {
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorld.elements, c = air.haze.value as Color;
    const rays = meterRays([-m[8], -m[9], -m[10]], [m[0], m[1], m[2]], [m[4], m[5], m[6]], Math.tan((this.camera.fov * Math.PI) / 360), this.camera.aspect, GLARE_COLUMNS, GLARE_ROWS);
    const meter: InsideMeterable = {
      habitat: this.habitat, emission: this.emission, norm: this.norm, extinction: air.extinction.value as number, sky: air.skyLight.value as number,
      hazeLuminance: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, heightAt: this.terrain.heightAt, albedoAt: this.albedoAt,
    };
    for (let k = 0; k < GLARE_PER_FRAME; k++, this.nextSeen = (this.nextSeen + 1) % rays.length) {
      this.seen[this.nextSeen] = insideRayLuminance(meter, eye, rays[this.nextSeen]);
    }
    return glareOf(this.seen);
  }

  /** Light the player's body where it stands and pose it for the frame (relative to the camera's eye). */
  private pose(eye: Vec3): void {
    const f = this.figure, c = this.character, reveal = this.reveal();
    // Light and shade around the player (or under the flyer).
    const rider = this.caps?.passenger() ?? null;
    const caught = this.guards?.holding ? this.guards.phase : null, feetUp = upAt(this.walker.feetAt()) ?? this.walker.view().up;
    const centre = reveal ? v3madd(reveal.feet, reveal.up, HUMAN.height / 2) : rider ? v3madd(rider.feet, rider.up, HUMAN.height / 2) : caught ? v3madd(this.walker.feetAt(), feetUp, HUMAN.height / 2) : this.flyer || !c ? eye : v3madd(this.walker.feetAt(), c.up, HUMAN.height / 2);
    if (this.below) {
      shineBelow(centre, eye, this.habitat.params.under.lamp);
      below.clock.value = this.time;
      below.day.value = dayOverhead(this.habitat, this.terrain, this.emission, emissionMean(this.emission), air.skyLight.value, this.norm, centre);
    }
    else shineOn(this.habitat, this.terrain, this.emission, emissionMean(this.emission), air.skyLight.value, this.norm, centre, eye);
    this.adaptEyes(eye);
    if (!f) return;
    // The one rule for the body (the capsules' seat follows it too): on foot, or walking out on arrival, the body is
    // there and casts its shadow; the camera sees its head's parts only from behind (HEAD_LAYER).
    f.object.visible = !!reveal || !!rider || !!caught || (!this.flyer && !!c);
    const chase = reveal ? reveal.chase : this.chase;
    if (chase >= HEAD_CLEAR) this.camera.layers.enable(HEAD_LAYER); else this.camera.layers.disable(HEAD_LAYER);
    if (!f.object.visible) return;
    let feet: Vec3, up: Vec3, front: Vec3, speed: number, move: MoveState, anim: AnimState | null = null;
    if (reveal) {
      ({ feet, up, front, speed } = reveal);
      move = speed < 0.3 ? 'idle' : 'walk';
    } else if (rider) {
      // Getting in, seated, getting out (world/mount.ts): the clips the courts' sitters play, scrubbed on the steps' time.
      ({ feet, up, front } = rider);
      const p = rider.pose;
      speed = p.speed;
      move = p.posture === 'walk' && speed > 0.3 ? 'walk' : p.posture === 'sit' ? 'sit' : 'idle';
      if (p.posture === 'sitDown' || p.posture === 'standUp') anim = { move: 'idle', pose: { clip: p.posture === 'sitDown' ? 'sit down' : 'stand up', hold: Math.min(0.999, p.share) } };
    } else if (caught) {
      // Caught: falling until the bands (or the bag) have the body, hanging in them on the way, feet first to the ground.
      const look = this.walker.view().look, ahead = v3madd(look, feetUp, -v3dot(look, feetUp));
      feet = this.walker.feetAt(); up = feetUp; speed = 0; front = v3norm(ahead);
      move = caught === 'lowering' || caught === 'released' ? 'idle' : 'fall';
    } else {
      const ch = c!, v = ch.velocity, flat = v3madd(v, ch.up, -v3dot(v, ch.up));
      feet = this.walker.feetAt(); up = ch.up; speed = Math.hypot(...flat);
      const look = this.walker.view().look, ahead = v3madd(look, up, -v3dot(look, up));
      // From the eyes the body faces where they look (it stands back from them along that line); from behind, the way it goes.
      front = v3norm(speed > 0.5 && chase >= HEAD_CLEAR ? flat : ahead);
      move = ch.swimming ? 'swim' : !ch.grounded ? (v3dot(v, up) > 0.5 ? 'jump' : 'fall') : speed < 0.3 ? 'idle' : speed < 2.5 ? 'walk' : speed < 5.5 ? 'run' : 'sprint';
    }
    // From the eyes the body sits as far back as it stands, seated too: its head leans forward of the hips, and the
    // first renders on real WebGPU showed it from behind, inside the hair.
    const back = FIRST_PERSON_BACK * (f.height / HUMAN.height) * Math.max(0, 1 - chase / HEAD_CLEAR);
    f.update({ feet: toView(eye, v3madd(feet, front, -back)), up, front, speed, anim: anim ?? { move } }, this.frameDt, this.time);
  }

  /**
   * Jump on foot to (θ, s), facing `heading` (the debug menu's Go entries): the body is taken away and stands up again
   * there once the physics has the ground under it, or it would carry the walker straight back.
   */
  goTo(theta: number, s: number, heading?: number): void {
    this.below = false;
    this.stand(theta, s, heading);
  }

  /** Stream the actual arrival landing behind the curtain before showing the first reveal frame. */
  async prepareArrival(): Promise<boolean> {
    this.finishArrivalReveal();
    const terrace = arrivalTerraceOf(this.habitat);
    if (!terrace) return false;
    const first = revealAt(this.habitat, terrace, 0);
    this.below = false;
    this.chase = 0;
    this.floatAt(first.eye, first.look);
    this.arrivalGuide = terrace;
    // A capsule already waits on the arrival's berth (Arnd, 2026-10-23), built before the curtain lifts.
    const berth = berthsOf(this.habitat)[0];
    const parked = berth && this.caps ? this.caps.parkAt(berth) : Promise.resolve(false);
    await new Promise<void>((ready) => {
      this.arrivalReveal = { terrace, elapsed: -1, ready, done: null };
      this.place();
    });
    await parked;
    return true;
  }

  /** A short walk from shelter to overlook; any movement key or right-drag hands over early. */
  revealArrival(): Promise<void> {
    const reveal = this.arrivalReveal;
    if (!reveal) return Promise.resolve();
    reveal.elapsed = 0;
    return new Promise((done) => { reveal.done = done; });
  }

  finishArrivalReveal(): void {
    const reveal = this.arrivalReveal;
    if (!reveal) return;
    const last = revealAt(this.habitat, reveal.terrace, REVEAL_SECONDS);
    this.arrivalReveal = null;
    // The walk ends behind the newcomer; the walking view takes over from the same place (the wheel goes into the eyes).
    this.chase = this.chaseGoal = last.chase;
    const at = fromWorld(this.habitat.profile, ...reveal.terrace.feet);
    this.goTo(at.theta, at.s, last.heading);
    this.walker.follow(reveal.terrace.feet);
    this.walker.pitch = last.pitch;
    this.camera.fov = last.fov;
    this.camera.updateProjectionMatrix();
    reveal.ready?.(); reveal.done?.();
  }

  /** Jump on foot to (θ, s) below the land, onto the Understorey's floor there (debug menu, until the lifts are built). */
  goBelow(theta: number, s: number, heading?: number): void {
    this.below = true;
    this.stand(theta, s, heading);
  }

  /** Whether the player is below the land. */
  get isBelow(): boolean {
    return this.below;
  }

  private stand(theta: number, s: number, heading?: number): void {
    if (this.cabin) this.cabin.ride = null;
    // Taken out of a capsule one is in, it leaves empty; one waiting or on its way stays for the player to come back to.
    if (this.caps?.carrying) this.caps.letGo();
    this.guards?.cancel();
    this.flyer = null;
    this.physics?.removeCharacter();
    this.character = null;
    this.walker.place(theta, s, heading);
    this.standUp();
  }

  /**
   * Float at a point (world, m) looking along `look`, as the flyer (the crossing into the Hub hands over here). Up is
   * the flyer's: toward the axis, so the point should be off the axis itself.
   */
  floatAt(eye: Vec3, look: Vec3): void {
    this.guards?.cancel();
    this.physics?.removeCharacter();
    this.character = null;
    const r = Math.hypot(eye[0], eye[1]), up: Vec3 = r > 0 ? [-eye[0] / r, -eye[1] / r, 0] : [1, 0, 0];
    this.flyer = new Flyer(this.habitat.profile, { eye, look, up }, this.standOn);
  }

  /** Take off from where the walker stands, or land under the flyer. */
  toggleFlying(): void {
    if (this.flyer) {
      const at = fromWorld(this.habitat.profile, ...this.flyer.eye);
      this.walker.land(at.theta, at.s, this.flyer.look);
      this.flyer = null;
      this.standUp();
    } else {
      this.guards?.cancel();
      this.physics?.removeCharacter();
      this.character = null;
      this.flyer = new Flyer(this.habitat.profile, this.walker.view(), this.standOn);
    }
  }

  /**
   * The lift doors (gen/lifts.ts) under a point of the canvas (pixels), near enough to the player to use: on foot, with
   * no ride under way.
   */
  private doorsUnder(x: number, y: number): LiftDoors | null {
    if (this.flyer || this.cabin?.ride || this.cabinMaking) return null;
    const doors = liftDoorsNear(this.terrain, this.walker.view().eye, this.below);
    if (!doors) return null;
    // The camera sits at the origin: the point unprojected is the ray's direction.
    this.camera.updateMatrixWorld();
    const d = new Vector3((2 * x) / (this.canvas.clientWidth || 1) - 1, 1 - (2 * y) / (this.canvas.clientHeight || 1), 0.5).unproject(this.camera).normalize();
    return doorsHit(doors, this.current().eye, [d.x, d.y, d.z]) ? doors : null;
  }

  /**
   * Use a lift's doors: above, step into its cabin and ride down; below, call the cabin down if it is not there (and
   * board it when it comes, if still at the doors), else step in and ride up.
   */
  private async useDoors(doors: LiftDoors): Promise<void> {
    const cabin = this.cabin;
    if (!cabin) return;
    if (cabin.court !== doors.court) {
      // Another lift's cabin: it waits at the top of its shaft (called from below, it comes down from over the vaults).
      this.cabinMaking = true;
      try {
        await cabin.ofLift(doors.court, doors.below ? calledFrom(this.terrain, doors.court) : 1);
      } finally {
        this.cabinMaking = false;
      }
      if (this.cabin !== cabin || cabin.court !== doors.court) return;
    }
    if (!doors.below) {
      // Out of sight in its shaft, the cabin is already up at the court for one stepping in.
      cabin.k = 1;
      this.board(0);
    } else if (cabin.k > 1e-3) cabin.setOff(0, false);
    else this.board(1);
  }

  /** Step into the lift's cabin, facing its doors, and ride to share `to` of its way (0 below, 1 up at the court). */
  private board(to: number): void {
    const cabin = this.cabin, p = cabin?.place();
    if (!cabin || !p) return;
    this.flyer = null;
    this.physics?.removeCharacter();
    this.character = null;
    // The lift is below the land from its doors on: the vaults' tiles are wanted, the land's hidden.
    this.below = true;
    const at = fromWorld(this.habitat.profile, ...p.at);
    this.walker.land(at.theta, at.s, p.ex);
    cabin.setOff(to, true);
  }

  /** Move the lift's ride on, and at its end step out of the cabin (or, a called cabin come down, board it if still at its doors). */
  private rideOn(dt: number): void {
    const cabin = this.cabin, done = cabin?.step(dt, !!this.under?.complete);
    if (!cabin || !done) return;
    if (!done.aboard) {
      if (liftDoorsNear(this.terrain, this.walker.view().eye, true)?.court === cabin.court) this.board(1);
      return;
    }
    const doors = done.to > 0.5 ? doorsAbove(this.terrain, cabin.court) : doorsBelow(this.terrain, cabin.court);
    if (doors) this.stepOut(doors, true);
  }

  /** Stand on foot a step out of a lift's doors (on their level), facing away from them or toward them. */
  private stepOut(doors: LiftDoors, away: boolean): void {
    if (this.cabin) this.cabin.ride = null;
    this.flyer = null;
    this.physics?.removeCharacter();
    this.character = null;
    const o = outside(this.habitat, doors, STEP_OUT);
    this.below = doors.below;
    this.walker.land(o.theta, o.s, away ? doors.out : v3scale(doors.out, -1));
    this.standUp();
  }

  /**
   * Whether the capsule waiting for the player is under a point of the canvas (pixels): on foot, on the land, with no
   * lift ride under way.
   */
  private capsuleUnder(x: number, y: number): boolean {
    const caps = this.caps;
    if (!caps || this.flyer || this.below || this.cabin?.ride || (caps.phase !== 'waiting' && caps.phase !== 'parked')) return false;
    this.camera.updateMatrixWorld();
    const d = new Vector3((2 * x) / (this.canvas.clientWidth || 1) - 1, 1 - (2 * y) / (this.canvas.clientHeight || 1), 0.5).unproject(this.camera).normalize();
    return caps.hit(this.current().eye, [d.x, d.y, d.z], CAPSULE_SEEN);
  }

  /** A spot `steps` handrails out from the waiting capsule's door step (world), or null: the debug menu stands the player there. */
  besideCapsule(steps = 3): Vec3 | null {
    return this.caps?.besideDoor(steps) ?? null;
  }

  /** Get into the waiting capsule: the body walks round to its door from where it stands (too far, the capsule says so). */
  boardCapsule(): void {
    const caps = this.caps;
    if (!caps) return;
    const feet = this.walker.feetAt(), look = this.walker.view();
    if (!caps.board(feet)) { this.onLine?.({ from: 'Capsule', text: 'Come a little closer and click me again.' }); return; }
    this.physics?.removeCharacter();
    this.character = null;
    // The look turned from where the body first walks, then easing round to it.
    const r = caps.passenger();
    if (r) {
      const right = v3cross(r.front, r.up);
      this.rideLook = { yaw: Math.atan2(v3dot(look.look, right), v3dot(look.look, r.front)), pitch: this.walker.pitch };
    }
  }

  /** Move the capsule on; once the player is out, they stand on foot where they stepped down, looking as they did. */
  private capsuleOn(dt: number): void {
    const caps = this.caps;
    if (!caps) return;
    const walking = caps.phase === 'boarding' || caps.phase === 'alighting', rider = caps.passenger();
    // Walking in or out, the look eases round to the way the body goes.
    if (walking) this.rideLook.yaw *= Math.exp(-RIDE_LOOK_EASE * dt);
    const look = rider ? this.riderView(rider).look : null;
    const out = caps.step(dt);
    if (rider) this.walker.follow(rider.feet);
    if (!out) return;
    const at = fromWorld(this.habitat.profile, ...out.feet);
    this.below = false;
    this.walker.land(at.theta, at.s, look ?? out.front);
    this.walker.pitch = this.rideLook.pitch;
    this.standUp();
  }

  /**
   * Let the guardians watch the body on foot: a fall that would hurt is theirs from the moment it is foreseen (the
   * body leaves the physics and goes as the catch plans it) until they set it down, where it stands up again.
   */
  private guardOn(dt: number): void {
    const g = this.guards, c = this.character;
    if (!g) return;
    const onFoot = !!c && !this.flyer && !this.below && !this.cabin?.aboard && !this.caps?.carrying && !this.arrivalReveal;
    g.watch(dt, onFoot ? { feet: c.feet(), v: c.velocity, grounded: c.grounded, swimming: c.swimming } : null);
    if (g.takeStarted()) {
      this.physics?.removeCharacter();
      this.character = null;
    }
    const held = g.step(dt);
    if (!held) return;
    this.walker.follow(held.feet);
    if (!held.released) return;
    const look = this.walker.view().look, sd = held.released;
    this.walker.land(sd.theta, sd.s, v3dot(look, sd.front) > -0.5 ? sd.front : look);
    this.standUp();
  }

  /**
   * Stand at (θ, s) `h` m over the profile, facing `heading`, and let go (the debug menu's falls): the guardians see the
   * fall as any other. `late` m over the ground they catch it, going along from the start (the Long Drop); 0: at once.
   */
  dropFrom(at: { theta: number; s: number; h: number }, heading?: number, late = 0): void {
    this.below = false;
    this.stand(at.theta, at.s, heading);
    this.physics?.removeCharacter();
    this.character = null;
    this.standAbove = Math.max(0, at.h - this.standOn(at.theta, at.s) - 0.05);
    if (this.guards) this.guards.late = late;
    this.standUp();
  }

  /** Stand in front of a court's lift doors, facing them (debug menu): above at its portal, below at its cage. */
  toLiftDoors(court: number, below: boolean): void {
    const doors = below ? doorsBelow(this.terrain, court) : doorsAbove(this.terrain, court);
    if (doors) this.stepOut(doors, false);
  }

  private listen(): void {
    // The left button (a tap) uses what it is on: for now, lifts' doors.
    clickToUse(this.canvas, (x, y) => {
      const doors = this.doorsUnder(x, y);
      if (doors) void this.useDoors(doors);
      else if (this.capsuleUnder(x, y)) this.boardCapsule();
    }, (x, y) => !!this.doorsUnder(x, y) || this.capsuleUnder(x, y));
    // The pointer stays visible and free (Arnd, 2026-10-21): the right button held down looks around.
    dragToLook(this.canvas, (dx, dy) => {
      if (this.arrivalReveal) this.finishArrivalReveal();
      const k = 0.004;
      if (this.flyer) this.flyer.turn(dx * k, -dy * k);
      else if (this.caps?.carrying) this.rideLook = { yaw: this.rideLook.yaw + dx * k, pitch: Math.max(-1.4, Math.min(1.4, this.rideLook.pitch - dy * k)) };
      else this.walker.turn(dx * k, -dy * k);
    });
    // The wheel moves the camera on foot between the player's eyes and behind them (flying has no body): over the
    // view and whatever lies over it (the arrival's card, the gravity meter), unless that scrolls itself.
    wheelOver(this.canvas, (deltaY) => {
      if (!this.loop.running) return;
      // During the arrival's walk the wheel hands over to walking, like a key or a look.
      if (this.arrivalReveal) this.finishArrivalReveal();
      if (!this.flyer) this.zoom(deltaY);
    });
  }

  /** Start or stop drawing (the page shows one view at a time). */
  setRunning(on: boolean): void {
    if (!on) this.finishArrivalReveal();
    this.loop.set(on);
  }

  /** How fast the eye went over the last frame (m/s; the wind it hears), and where it was. A jump (Go) is no speed. */
  private eyeSpeed = 0;
  private lastEye: Vec3 | null = null;
  /** The last frame's time step (s), for posing the body. */
  private frameDt = 0;

  private frame(dt: number): void {
    this.frameDt = dt;
    const arrival = this.arrivalReveal;
    if (arrival) {
      if (arrival.elapsed < 0) {
        if (this.stair?.complete) { arrival.ready?.(); arrival.ready = null; }
      } else {
        arrival.elapsed += dt;
        if (arrival.elapsed >= REVEAL_SECONDS) this.finishArrivalReveal();
      }
      const f = revealAt(this.habitat, arrival.terrace, Math.max(0, arrival.elapsed));
      this.camera.fov = f.fov;
      this.camera.updateProjectionMatrix();
    }
    this.glide(dt);
    const { forward, right, up, fast } = moveKeys(this.loop.keys);
    const run = this.boost * (fast ? RUN : 1);
    if (this.arrivalReveal || this.cabin?.aboard || this.caps?.carrying || this.guards?.holding) {
      // In a lift the keys wait for its doors; in a capsule, for its Mind to set one down; caught, for the ground.
    } else if (this.flyer) {
      this.flyer.boost = run;
      this.flyer.step({ forward, right, up }, dt);
    } else {
      const base = this.walker.speed;
      this.walker.speed = base * run;
      if (this.character) {
        this.character.stride.walk = this.walker.stride({ forward, right });
        this.character.legs = this.boost;
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
    this.rideOn(dt);
    this.capsuleOn(dt);
    this.simulate(dt, this.current().eye);
    this.guardOn(dt);
    this.place();
    const guide = this.arrivalGuide, eye = this.current().eye;
    const went = this.lastEye && dt > 0 ? Math.hypot(eye[0] - this.lastEye[0], eye[1] - this.lastEye[1], eye[2] - this.lastEye[2]) / dt : 0;
    this.eyeSpeed = went > TELEPORT ? 0 : went;
    this.lastEye = eye;
    if (guide) {
      const near = !this.below && Math.hypot(...eye.map((v, k) => v - guide.feet[k])) < guide.handrail * 35;
      this.onArrival?.(this.arrivalReveal ? Math.max(0, this.arrivalReveal.elapsed) / REVEAL_SECONDS : 1, near);
      if (!near && !this.arrivalReveal) this.arrivalGuide = null;
    }
    this.weigh(dt);
    draw(this.stage);
    this.glass?.takeViews(dt, this.posedAt, this.glassWanted(), this.glassStage);
  }

  /** The gravity the player feels now (`feltGravity`), smoothed so a stride's jitter does not show, for `onGravity`. */
  private weigh(dt: number): void {
    if (!this.onGravity || dt <= 0) return;
    const c = this.character, view = this.current(), aboard = !!this.cabin?.aboard, inCapsule = this.caps?.feel() ?? null, caught = this.guards?.feel() ?? null;
    const onFoot = !!c && !this.flyer && !aboard && !inCapsule;
    const at = onFoot ? c.feet() : view.eye;
    // On foot the body's own velocity; flying or in a lift, how far the eye went this frame (a jump elsewhere is no speed).
    const last = this.lastAt;
    let v: Vec3 = onFoot ? c.velocity : last ? v3scale([at[0] - last[0], at[1] - last[1], at[2] - last[2]], 1 / dt) : [0, 0, 0];
    if (Math.hypot(...v) > 2000) v = [0, 0, 0];
    this.lastAt = [...at];
    const moving = inCapsule ? 'capsule' : aboard ? 'lift' : this.flyer ? 'fly' : caught !== null ? 'air' : !c ? 'foot' : c.swimming ? 'swim' : c.grounded ? 'foot' : 'air';
    const read = gravityReading(this.habitat, at, v, view.look, view.up, moving), was = this.gravity;
    // In a capsule what one feels is the pod's own speeding up, slowing and turning as well as the spin's (world/capFlight.ts).
    // Caught, what the guardians' bands or the bag do to the body (nothing while it falls free).
    const now = inCapsule ? { ...read, felt: inCapsule.weight } : caught !== null ? { ...read, felt: caught } : read;
    const k = was ? 1 - Math.exp(-dt / GRAVITY_SMOOTHING) : 1;
    this.gravity = !was ? now : { ...now, felt: was.felt + (now.felt - was.felt) * k, spinward: was.spinward + (now.spinward - was.spinward) * k };
    this.onGravity(this.gravity);
  }

  /** Where the scene is posed about this frame (world): the eye `place` put it round. */
  private posedAt: Vec3 = [0, 0, 0];

  /**
   * The glass deck wanted below: a hamlet's with it over the eye's bay or one beside it, its views taken over the land
   * straight above the eye, clear of the tallest crowns, so it shows the sky and not a tree (gen/skies.ts).
   */
  private glassWanted(): GlassWant | null {
    if (!this.below) return null;
    const h = this.habitat, at = fromWorld(h.profile, ...this.posedAt), u = underOf(h), bay = u.bayAt(at.theta, at.s);
    if (!bay) return null;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const sky = skyOverBay(h, bay.i + di, bay.j + dj), m = sky === GLASS ? u.hamletOf(bay.i + di, bay.j + dj) : null;
      if (m) return { court: m.court, at: toWorld(h.profile, { theta: at.theta, s: at.s, h: this.terrain.heightAt(at.theta, at.s) + this.overCrowns() }) };
    }
    return null;
  }

  /** How high over the ground the glass deck's views are taken (m): a little over the climate's tallest trees. */
  private overCrowns(): number {
    const tallest = Math.max(0, ...(this.ecology?.climate.biomes.flatMap((b) => b.plants.map((p) => p.height[1])) ?? []));
    return Math.max(EYE_HEIGHT, tallest * OVER_CROWNS);
  }

  /** The land shown, lit and seen as from a point on it, for the glass deck's views, and put back after. */
  private readonly glassStage: GlassStage = {
    onLand: (at) => {
      this.showLand(!!at || !this.below);
      below.people.value = !at && this.below ? 1 : 0;
      for (const g of [this.people?.group, this.drones?.group]) if (g) g.visible = !at;
      if (at) {
        // The land and its specks, not the figures: their shadow shaders are built only as they come near on the land.
        for (const g of [this.people?.group, this.drones?.group, this.birds?.group, this.boats?.group, ...this.animals.map((a) => a.group)]) if (g) g.visible = false;
        shineOn(this.habitat, this.terrain, this.emission, emissionMean(this.emission), air.skyLight.value, this.norm, at, this.posedAt);
        this.landExposure = view.exposure.value as number;
        view.exposure.value = 1;
        this.landBack.copy(this.scene.background as Color);
        (this.scene.background as Color).copy(air.haze.value as Color);
      } else {
        view.exposure.value = this.landExposure;
        (this.scene.background as Color).copy(this.landBack);
      }
    },
  };
  private landExposure = 1;
  private readonly landBack = new Color();
}
