/**
 * Every habitat in the ring as the view outside draws it (design "Solarpolis: the outside", O4): the home habitat
 * always as meshes, its neighbours as glints, points of light whose brightness is the drum's own reflected sunlight
 * (`skinFlux`, gen/skin.ts), until they come close enough to show a shape, when they switch to the same meshes. The
 * patchwork of each skin makes its glint flicker as it turns.
 *
 * Poses come from the space model once per frame (float64, relative to the eye), so the clearance the fly camera
 * needs and the exposure meter read the same numbers the meshes are drawn at.
 */
import { Mesh, type BufferGeometry } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { smoothstep, v3add, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { exteriorDistance, type Habitat } from '../blueprint';
import { columnsOf, makeSkin, skinFlux, type Columns, type Skin } from '../gen/skin';
import { apply, mul, rotZ, sunlightFrom, transpose, type Mat3, type PlacedHabitat, type SkyView, type Space } from '../space';
import { HARDWARE, RADIATOR, SKIN, STARS } from './materials';
import { skinUniforms, type SkinUniforms } from './hullShaders';
import { hullGeometry } from './hull';
import { arraysGeometry, meshGeometry, setPose } from './geometry';
import { HullDetailView, type Frames } from './hullDetail';
import { sharedPool } from '../workers/pool';
import { DISH, detailParts, partDistance, wholeTile, type DetailPart, type PartFrame } from '../gen/hullParts';
import { reachOf } from '../gen/detailTree';
import { DRONES_WITHIN, DroneMesh } from './drones';

/**
 * The free camera holds station with a drum within HOLD_NEAR outer radii of it, and lets go beyond HOLD_FAR; and lets
 * go as it comes nearer the despun spindle and its arms than the drum (its share of the two distances from
 * SPINDLE_NEAR to SPINDLE_FAR).
 */
const HOLD_NEAR = 0.05;
const HOLD_FAR = 0.5;
const SPINDLE_NEAR = 0.35;
const SPINDLE_FAR = 0.65;

/** The hardware's albedo as the meter sees it, and the share of a truss's outline its members fill. */
const HARDWARE_ALBEDO = 0.5;
const TRUSS_FILL = 0.3;

/** A neighbour this many pixels across switches from a glint to its meshes, and back below the lower number. */
const MESH_ABOVE = 10;
const GLINT_BELOW = 7;

interface Drawn {
  placed: PlacedHabitat;
  habitat: Habitat;
  skin: Skin;
  cols: Columns;
  uniforms: SkinUniforms;
  /** Size across, for the switch to meshes (m). */
  span: number;
  meshes: { skin: Mesh; radiators: Mesh; mast: Mesh; spindle: Mesh; drones: DroneMesh; pieces: { id: string; frame: PartFrame; origin: Vec3; mesh: Mesh }[] } | null;
  building: boolean;
  /** The detailed parts (gen/hullParts.ts), and their tiles while the eye is near any of them. */
  parts: DetailPart[];
  detail: HullDetailView | null;
  /** This frame: the spindle's axes in the scene (the body's without the spin). */
  spindleAxes: Mat3;
  /** This frame: the body's axes in the scene and its origin relative to the eye; the drum's centre relative to the eye. */
  axes: Mat3;
  origin: Vec3;
  center: Vec3;
}

/** A habitat's drum, spindle, truss or dish as the exposure meter sees it: a cylinder. */
export interface Hull {
  center: Vec3;
  axis: Vec3;
  radius: number;
  halfLength: number;
  albedo: number;
}

export class NecklaceView {
  private drawn: Drawn[];
  private glints: Mesh;
  private glintPos: Float32Array;
  private glintCol: Float32Array;

  constructor(private readonly stage: Stage, private readonly space: Space, private readonly far: number) {
    this.drawn = space.habitats.map((placed) => {
      const habitat = placed.habitat, skin = makeSkin(habitat), cols = columnsOf(skin), x = habitat.exterior;
      const span = Math.max(x.spindle.to - x.mast.from, 2 * Math.max(x.radius, ...x.brims.map((b) => b.tip)));
      return { placed, habitat, skin, cols, uniforms: skinUniforms(skin, cols), span, meshes: null, building: false, parts: detailParts(habitat, skin), detail: null, axes: [1, 0, 0, 0, 1, 0, 0, 0, 1], spindleAxes: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: [0, 0, 0], center: [0, 0, 0] };
    });
    // One quad per neighbour, drawn as stars are (STARS): their light spread over a few pixels, hidden behind Earth.
    const n = this.drawn.length - 1;
    this.glintPos = new Float32Array(n * 12);
    this.glintCol = new Float32Array(n * 12);
    const corner = new Float32Array(n * 8), index = new Uint32Array(n * 6), corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      corner.set(corners, i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = meshGeometry(index, { position: [this.glintPos, 3], color: [this.glintCol, 3], corner: [corner, 2] });
    this.glints = new Mesh(g, STARS.material);
    this.glints.name = 'glints';
    this.glints.frustumCulled = false;
  }

  /** Put the home habitat's meshes and the glints into the scene. */
  async start(): Promise<void> {
    await Promise.all([this.stage.add(this.glints), this.buildMeshes(this.drawn[0])]);
  }

  /** Remove everything from the scene. */
  dispose(): void {
    for (const d of this.drawn) this.dropMeshes(d);
    this.stage.remove(this.glints);
    this.glints.geometry.dispose();
  }

  get home(): Drawn {
    return this.drawn[0];
  }

  private async buildMeshes(d: Drawn): Promise<void> {
    if (d.meshes || d.building) return;
    d.building = true;
    const g = hullGeometry(d.habitat);
    const mesh = (geo: BufferGeometry, kind: typeof SKIN, name: string): Mesh => {
      const m = new Mesh(geo, kind.material);
      m.name = `${d.placed.id} ${name}`;
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.userData.skin = d.uniforms;
      return m;
    };
    const drones = new DroneMesh(d.skin, HARDWARE.material, STARS.material);
    drones.mesh.name = `${d.placed.id} drones`;
    // The berth arms, the mast and the dishes from afar: each its detail part's root tile, built in the pool.
    const whole = d.parts.filter((p) => p.kind === 'truss' || p.kind === 'dish');
    const answers = await Promise.all(whole.map((p) => sharedPool().job({ kind: 'hull', params: d.habitat.params, part: p.id, key: wholeTile(p) })));
    const pieces = answers.flatMap((a, k) => {
      if (!('partTile' in a)) return [];
      const q = a.partTile.parts, p = whole[k];
      return [{ id: p.id, frame: p.frame, origin: a.partTile.origin, mesh: mesh(arraysGeometry(q), HARDWARE, p.id) }];
    });
    const meshes = { skin: mesh(g.skin, SKIN, 'skin'), radiators: mesh(g.radiators, RADIATOR, 'radiators'), mast: mesh(g.mast, HARDWARE, 'mast'), spindle: mesh(g.spindle, HARDWARE, 'spindle'), drones, pieces };
    this.poseMeshes(d, meshes);
    await Promise.all([meshes.skin, meshes.radiators, meshes.mast, meshes.spindle, drones.mesh, drones.points, ...pieces.map((x) => x.mesh)].map((m) => this.stage.add(m)));
    d.building = false;
    d.meshes = meshes;
  }

  private dropMeshes(d: Drawn): void {
    d.detail?.dispose();
    d.detail = null;
    if (!d.meshes) return;
    const m = d.meshes;
    for (const x of [m.skin, m.radiators, m.mast, m.spindle, m.drones.mesh, m.drones.points, ...m.pieces.map((p) => p.mesh)]) { this.stage.remove(x); x.geometry.dispose(); }
    d.meshes = null;
  }

  private poseMeshes(d: Drawn, m: NonNullable<Drawn['meshes']>): void {
    for (const k of ['skin', 'radiators', 'mast'] as const) setPose(m[k], d.axes, d.origin);
    d.spindleAxes = mul(d.axes, rotZ(-d.placed.spinAt(this.time)));
    setPose(m.spindle, d.spindleAxes, d.origin);
    // Each whole part from afar, until its near tiles cover it.
    for (const p of m.pieces) {
      const axes = p.frame === 'body' ? d.axes : d.spindleAxes;
      p.mesh.visible = !d.detail?.covers(p.id);
      setPose(p.mesh, axes, v3add(d.origin, apply(axes, p.origin)));
    }
    // The drones only near the skin: the eye's distance to the body, in its own frame.
    const eye = apply(transpose(d.axes), v3scale(d.origin, -1));
    const near = exteriorDistance(d.habitat.exterior, eye) < DRONES_WITHIN * d.skin.droneSize;
    m.drones.mesh.visible = near;
    m.drones.points.visible = !near;
    if (near) {
      m.drones.moveTo(this.time);
      setPose(m.drones.mesh, d.axes, d.origin);
    } else {
      m.drones.glow(this.time, d.axes, d.origin, apply(transpose(d.axes), this.sunDir), this.sunlight, this.far);
    }
  }

  private time = 0;
  /** This frame's Sun as the home habitat sees it (scene axes), and its unhidden share. */
  private sunDir: Vec3 = [1, 0, 0];
  private sunlight = 1;

  /**
   * Everything relative to the eye (home orbit frame) at clock time t: each body's pose, the near ones' meshes, the
   * far ones' glints. `pixelsPerRadian` sizes a neighbour on screen.
   */
  follow(eye: Vec3, t: number, sky: SkyView, pixelsPerRadian: number): void {
    this.time = t;
    this.sunDir = sky.sunDir;
    this.sunlight = sky.sunlight;
    const sp = this.space, frame = sp.home.orbitFrame;
    const sunC = v3scale(sky.sunDir, sky.sunDistance);
    for (const d of this.drawn) {
      const pose = sp.frames.relative(d.placed.bodyFrame, frame, t);
      d.axes = pose.axes;
      d.origin = v3sub(pose.origin, eye);
      d.center = v3add(d.origin, apply(pose.axes, [0, 0, d.habitat.length / 2]));
    }
    for (let k = 1; k < this.drawn.length; k++) {
      const d = this.drawn[k], dist = v3len(d.center), px = (d.span / dist) * pixelsPerRadian;
      if (px > MESH_ABOVE) void this.buildMeshes(d);
      else if (px < GLINT_BELOW) this.dropMeshes(d);
      const o = (k - 1) * 12;
      const dir = v3scale(d.center, 1 / dist);
      let flux: Vec3 = [0, 0, 0];
      if (!d.meshes) {
        // The habitat's own view of the Sun, Earth and Moon: its share of sunlight (Earth's shadow, eclipses).
        const lit = sunlightFrom(v3sub(sunC, d.center), v3sub(sky.earth.center, d.center), v3sub(sky.moon.center, d.center));
        const toBody = transpose(d.axes);
        flux = skinFlux(d.skin, d.cols, apply(toBody, sky.sunDir), apply(toBody, v3scale(dir, -1)), dist, lit);
      }
      for (let v = 0; v < 4; v++) {
        for (let a = 0; a < 3; a++) {
          this.glintPos[o + v * 3 + a] = dir[a] * this.far;
          this.glintCol[o + v * 3 + a] = flux[a];
        }
      }
    }
    const g = this.glints.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    for (const d of this.drawn) if (d.meshes) { this.poseMeshes(d, d.meshes); this.followDetail(d); }
  }

  /**
   * The hull's detail tiles around the eye (render/hullDetail.ts) while it is within their reach of any detailed part
   * of this habitat; made when the eye comes near, given back when it has gone twice as far.
   */
  private followDetail(d: Drawn): void {
    const frames = this.framesOf(d), away = Math.min(...d.parts.map((p) => partDistance(p, d.skin, frames[p.frame].eye) / reachOf(p.grid)));
    if (away > 2) { d.detail?.dispose(); d.detail = null; return; }
    if (away > 1 && !d.detail) return;
    d.detail ??= new HullDetailView(this.stage, sharedPool(), d.habitat, d.skin, d.uniforms, d.placed.id);
    d.detail.follow(frames, d.origin);
  }

  /** The eye in the body's and the spindle's frames, and their axes in the scene, this frame. */
  private framesOf(d: Drawn): Frames {
    const eye = v3scale(d.origin, -1);
    return { body: { eye: apply(transpose(d.axes), eye), axes: d.axes }, spindle: { eye: apply(transpose(d.spindleAxes), eye), axes: d.spindleAxes } };
  }

  /** Bytes the skins' detail tiles hold (memory watchdog). */
  detailBytes(): number {
    return this.drawn.reduce((n, d) => n + (d.detail?.bytes() ?? 0), 0);
  }

  /** Give memory back: detail tiles not drawn this frame go. */
  shed(): void {
    for (const d of this.drawn) d.detail?.shed();
  }

  /** The detail tiles' state, for the debug menu. */
  detailInfo(): string {
    return this.drawn.filter((d) => d.detail).map((d) => `${d.placed.id} ${d.detail!.info()}`).join(' · ') || 'skin detail: none near';
  }

  /**
   * Near a drum the free camera holds station with its skin (Arnd, 2026-10-21: go anywhere and look at the details):
   * from clock time t0 to t1 the eye (and its look) turn with the nearest habitat, fully within HOLD_NEAR outer radii
   * of its drum, not at all beyond HOLD_FAR, so the skin stays put under the eye instead of racing past at the spin's
   * speed. `eye` relative to the home orbit frame's origin, as the flyer holds it; `look` a direction.
   */
  holdStation(eye: Vec3, look: Vec3, t0: number, t1: number): { eye: Vec3; look: Vec3 } {
    const sp = this.space, frame = sp.home.orbitFrame;
    let best: { d: Drawn; share: number } | null = null;
    for (const d of this.drawn) {
      const body = sp.frames.position(eye, frame, d.placed.bodyFrame, t0), s = d.skin;
      const away = Math.hypot(Math.max(0, Math.hypot(body[0], body[1]) - s.radius), Math.max(0, s.z0 - body[2], body[2] - s.z1));
      // The spindle turns against the body: near it, hold still in the orbit's frame instead.
      const despun = apply(rotZ(d.placed.spinAt(t0)), body);
      const spindle = Math.min(...d.parts.filter((p) => p.frame === 'spindle').map((p) => partDistance(p, s, despun)));
      const smooth = (1 - smoothstep(HOLD_NEAR, HOLD_FAR, away / s.radius)) * (1 - smoothstep(SPINDLE_NEAR, SPINDLE_FAR, away / (away + spindle + 1e-9)));
      if (smooth > 0 && (!best || smooth > best.share)) best = { d, share: smooth };
    }
    if (!best) return { eye, look };
    const id = best.d.placed.bodyFrame;
    const moved = sp.frames.position(sp.frames.position(eye, frame, id, t0), id, frame, t1);
    const turned = sp.frames.direction(sp.frames.direction(look, frame, id, t0), id, frame, t1);
    const k = best.share;
    return { eye: v3add(eye, v3scale(v3sub(moved, eye), k)), look: v3add(v3scale(look, 1 - k), v3scale(turned, k)) };
  }

  /**
   * The habitats drawn as meshes as the exposure meter sees them: each drum, its spindle, and its trusses and dishes
   * (bowl to feed) as the cylinders around them (a truss's albedo thinned by how much of it is open), so the eyes adapt to sunlit
   * hardware in view as they do to the skin.
   */
  hulls(): Hull[] {
    return this.drawn.filter((d) => d.meshes).flatMap((d) => {
      const a = d.cols.mean.albedo, s = d.habitat.exterior.spindle, axis: Vec3 = [d.axes[2], d.axes[5], d.axes[8]];
      const out: Hull[] = [
        { center: d.center, axis, radius: d.habitat.exterior.radius, halfLength: (d.skin.z1 - d.skin.z0) / 2, albedo: 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] },
        { center: v3add(d.origin, apply(d.axes, [0, 0, (s.from + s.to) / 2])), axis, radius: s.radius, halfLength: (s.to - s.from) / 2, albedo: HARDWARE_ALBEDO },
      ];
      for (const p of d.parts) {
        if (p.kind !== 'truss' && p.kind !== 'dish') continue;
        const axes = p.frame === 'body' ? d.axes : d.spindleAxes, along = apply(axes, p.place.ez), foot = v3add(d.origin, apply(axes, p.place.at));
        if (p.kind === 'truss') out.push({ center: v3add(foot, v3scale(along, p.length / 2)), axis: along, radius: p.width / 2, halfLength: p.length / 2, albedo: HARDWARE_ALBEDO * TRUSS_FILL });
        else out.push({ center: v3add(foot, v3scale(along, p.boom + p.diameter * DISH.focal * 0.5)), axis: along, radius: p.diameter / 2, halfLength: p.diameter * DISH.focal * 0.5, albedo: HARDWARE_ALBEDO });
      }
      return out;
    });
  }

  /** Distance from a point (relative to the eye, scene axes) to the nearest habitat's outside (m). */
  distanceToHabitats(p: Vec3): number {
    let best = Infinity;
    for (const d of this.drawn) {
      // Far habitats bound the distance from their centre without the exact shape.
      const rough = v3len(v3sub(p, d.center)) - d.span;
      if (rough > best) continue;
      const rel = v3sub(p, d.origin), local = apply(transpose(d.axes), rel);
      best = Math.min(best, exteriorDistance(d.habitat.exterior, local));
      // The trusses and dishes are not in the exterior's pieces: near them, their own distance.
      if (best > d.span) continue;
      const despun = apply(transpose(d.spindleAxes), rel);
      for (const q of d.parts) if (q.kind === 'truss' || q.kind === 'dish') best = Math.min(best, partDistance(q, d.skin, q.frame === 'body' ? local : despun));
    }
    return best;
  }

  /** The neighbour nearest the eye: its centre relative to the eye. */
  nearestNeighbour(): Vec3 {
    let best: Vec3 = this.drawn[1]?.center ?? [1, 0, 0];
    for (const d of this.drawn.slice(1)) if (v3len(d.center) < v3len(best)) best = d.center;
    return best;
  }
}
