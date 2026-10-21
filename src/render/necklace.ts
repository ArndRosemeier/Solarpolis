/**
 * Every habitat in the ring as the view outside draws it (design "Solarpolis: the outside", O4): the home habitat
 * always as meshes, its neighbours as glints, points of light whose brightness is the drum's own reflected sunlight
 * (`skinFlux`, gen/skin.ts), until they come close enough to show a shape, when they switch to the same meshes. The
 * patchwork of each skin makes its glint flicker as it turns.
 *
 * Poses come from the space model once per frame (float64, relative to the eye), so the clearance the fly camera
 * needs and the exposure meter read the same numbers the meshes are drawn at.
 */
import { Mesh, Matrix4, type BufferGeometry } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { exteriorDistance, type Habitat } from '../blueprint';
import { columnsOf, makeSkin, skinFlux, type Columns, type Skin } from '../gen/skin';
import { apply, mul, rotZ, sunlightFrom, transpose, type Mat3, type PlacedHabitat, type SkyView, type Space } from '../space';
import { HARDWARE, RADIATOR, SKIN, STARS } from './materials';
import { skinUniforms, type SkinUniforms } from './hullShaders';
import { hullGeometry } from './hull';
import { meshGeometry } from './geometry';

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
  meshes: { skin: Mesh; radiators: Mesh; mast: Mesh; spindle: Mesh } | null;
  building: boolean;
  /** This frame: the body's axes in the scene and its origin relative to the eye; the drum's centre relative to the eye. */
  axes: Mat3;
  origin: Vec3;
  center: Vec3;
}

/** A habitat's drum as the exposure meter and the fly camera see it. */
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
      return { placed, habitat, skin, cols, uniforms: skinUniforms(skin, cols), span, meshes: null, building: false, axes: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: [0, 0, 0], center: [0, 0, 0] };
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
    for (const d of this.drawn) this.drop(d);
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
    const meshes = { skin: mesh(g.skin, SKIN, 'skin'), radiators: mesh(g.radiators, RADIATOR, 'radiators'), mast: mesh(g.mast, HARDWARE, 'mast'), spindle: mesh(g.spindle, HARDWARE, 'spindle') };
    this.poseMeshes(d, meshes);
    await Promise.all(Object.values(meshes).map((m) => this.stage.add(m)));
    d.building = false;
    d.meshes = meshes;
  }

  private drop(d: Drawn): void {
    if (!d.meshes) return;
    for (const m of Object.values(d.meshes)) { this.stage.remove(m); m.geometry.dispose(); }
    d.meshes = null;
  }

  private poseMeshes(d: Drawn, m: NonNullable<Drawn['meshes']>): void {
    for (const k of ['skin', 'radiators', 'mast'] as const) setPose(m[k], d.axes, d.origin);
    setPose(m.spindle, mul(d.axes, rotZ(-d.placed.spinAt(this.time))), d.origin);
  }

  private time = 0;

  /**
   * Everything relative to the eye (home orbit frame) at clock time t: each body's pose, the near ones' meshes, the
   * far ones' glints. `pixelsPerRadian` sizes a neighbour on screen.
   */
  follow(eye: Vec3, t: number, sky: SkyView, pixelsPerRadian: number): void {
    this.time = t;
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
      else if (px < GLINT_BELOW) this.drop(d);
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
    for (const d of this.drawn) if (d.meshes) this.poseMeshes(d, d.meshes);
  }

  /** The drums of the habitats drawn as meshes (the exposure meter's view of them). */
  hulls(): Hull[] {
    return this.drawn.filter((d) => d.meshes).map((d) => {
      const a = d.cols.mean.albedo;
      return { center: d.center, axis: [d.axes[2], d.axes[5], d.axes[8]], radius: d.habitat.exterior.radius, halfLength: (d.skin.z1 - d.skin.z0) / 2, albedo: 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] };
    });
  }

  /** Distance from a point (relative to the eye, scene axes) to the nearest habitat's outside (m). */
  distanceToHabitats(p: Vec3): number {
    let best = Infinity;
    for (const d of this.drawn) {
      // Far habitats bound the distance from their centre without the exact shape.
      const rough = v3len(v3sub(p, d.center)) - d.span;
      if (rough > best) continue;
      const local = apply(transpose(d.axes), v3sub(p, d.origin));
      best = Math.min(best, exteriorDistance(d.habitat.exterior, local));
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

/** A mesh's matrix from axes (columns: its own axes in the scene) and an origin relative to the eye. */
export function setPose(mesh: Mesh, a: Mat3, o: Vec3): void {
  mesh.matrix.copy(new Matrix4().set(a[0], a[1], a[2], o[0], a[3], a[4], a[5], o[1], a[6], a[7], a[8], o[2], 0, 0, 0, 1));
  mesh.matrixWorldNeedsUpdate = true;
}
