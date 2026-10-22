/**
 * The landmarks in the interior view (gen/landmarks.ts places them; gen/pavilion.ts and gen/summitHut.ts build them): each drawn
 * at one of its levels by its distance, the far level always there (nothing vanishes with distance), the finer ones
 * built in the workers when the eye comes near enough to need them and freed again when it leaves. A level takes over
 * where the finest parts of the one coarser are about a pixel wide, so the step is hard to see.
 */
import { Group, Vector4, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Habitat, type Vec3 } from '../blueprint';
import type { Mat3 } from '../space';
import { frameOf, sightOf, type Landmark, type Sight } from '../gen/landmarks';
import { intoPlace, type Place } from '../gen/shapes';
import { LANDMARK_LEVELS } from '../gen/pavilion';
import type { WorkerPool } from '../workers/pool';
import { BUILT } from './materials';
import { axesOf, builtGeometry, freeMesh, posedMesh, setPose, uploadStatic } from './geometry';

type Level = (typeof LANDMARK_LEVELS)[number];

/** A level is wanted from this many times its switching distance (built ahead), and freed past `FREE` times it. */
const AHEAD = 1.5;
const FREE = 3;
/** How much farther than its switching distance a level stays once it is drawn (so it does not flip back and forth). */
const HOLD = 1.15;
/** A level's finest parts are about this many pixels wide where the next coarser one takes over. */
const PIXELS = 0.5;

interface Shown {
  landmark: Landmark;
  frame: Place;
  sight: Sight;
  axes: Mat3;
  /** How far the eye may be from its nearest part for each finer level (m, at one pixel per radian). */
  within: Record<Exclude<Level, 'far'>, number>;
  /** The roof's shelter, for the BUILT kind (`userData.roof`). */
  roof: Vector4;
  meshes: Partial<Record<Level, Mesh>>;
  asked: Set<Level>;
  drawn: Level;
  /** Bytes each built level holds, and all of them. */
  sizes: Partial<Record<Level, number>>;
  bytes: number;
}

export class LandmarkView {
  readonly group = new Group();
  private readonly shown: Shown[];
  private disposed = false;

  constructor(private readonly habitat: Habitat, landmarks: readonly Landmark[], private readonly stage: Stage, private readonly pool: WorkerPool) {
    this.group.name = 'landmarks';
    this.shown = landmarks.map((landmark) => {
      const f = frameOf(habitat, landmark), sight = sightOf(landmark);
      return {
        landmark, frame: f, sight,
        axes: axesOf(f),
        within: { near: sight.near / PIXELS, mid: sight.mid / PIXELS },
        roof: new Vector4(...sight.roof),
        meshes: {}, asked: new Set(), drawn: 'far', sizes: {}, bytes: 0,
      };
    });
    for (let i = 0; i < this.shown.length; i++) this.ask(i, 'far');
  }

  /** Bytes the landmarks' meshes hold on the GPU (memory watchdog). */
  bytes(): number { return this.shown.reduce((n, s) => n + s.bytes, 0); }

  /** Give memory back: free every level not drawn now (the far ones stay). */
  shed(): void {
    for (const s of this.shown) for (const l of ['mid', 'near'] as const) if (l !== s.drawn) this.free(s, l);
  }

  info(): string {
    return `landmarks: ${this.shown.map((s) => `${s.landmark.kind} (${s.drawn}; ${(s.bytes / 1048576).toFixed(1)} MB)`).join(', ') || 'none'}`;
  }

  /** Each frame: pick each landmark's level by the eye's distance, ask for what is missing, and place the meshes. */
  follow(eye: Vec3, pixelsPerRadian: number): void {
    this.shown.forEach((s, i) => {
      const o = s.frame.at, edge = s.sight.away(intoPlace(s.frame, eye));
      const near = s.within.near * pixelsPerRadian, mid = s.within.mid * pixelsPerRadian;
      const want: Level = edge < near * (s.drawn === 'near' ? HOLD : 1) ? 'near' : edge < mid * (s.drawn !== 'far' ? HOLD : 1) ? 'mid' : 'far';
      if (edge < near * AHEAD) this.ask(i, 'near');
      if (edge < mid * AHEAD) this.ask(i, 'mid');
      if (edge > near * FREE) this.free(s, 'near');
      if (edge > mid * FREE) this.free(s, 'mid');
      // Draw the wanted level if it is built, else the finest built one coarser than it (the far one always is, once made).
      const order: Level[] = want === 'near' ? ['near', 'mid', 'far'] : want === 'mid' ? ['mid', 'far'] : ['far'];
      const drawn = order.find((l) => s.meshes[l]);
      if (drawn) s.drawn = drawn;
      const at = toView(eye, o);
      for (const l of LANDMARK_LEVELS) {
        const m = s.meshes[l];
        if (!m) continue;
        m.visible = l === drawn;
        if (m.visible) setPose(m, s.axes, at);
      }
    });
  }

  private ask(i: number, level: Level): void {
    const s = this.shown[i];
    if (s.asked.has(level)) return;
    s.asked.add(level);
    void this.pool.job({ kind: 'landmark', params: this.habitat.params, index: i, level }).then(async (answer) => {
      if (this.disposed || !s.asked.has(level) || !('mesh' in answer)) return;
      const a = answer.mesh;
      const g = builtGeometry(a);
      const m = posedMesh(g, BUILT.material, `landmark ${i} ${level}`);
      m.castShadow = true;
      m.userData.roof = s.roof;
      const bytes = [a.positions, a.normals, a.colors, a.uvs, a.finishes, a.index].reduce((n, x) => n + (x?.byteLength ?? 0), 0);
      setPose(m, s.axes, [0, 0, 0]);
      await uploadStatic(this.stage, m);
      if (this.disposed || !s.asked.has(level)) { freeMesh(m); return; }
      this.group.add(m);
      s.meshes[level] = m;
      s.bytes += bytes;
      s.sizes[level] = bytes;
    });
  }

  private free(s: Shown, level: Level): void {
    s.asked.delete(level);
    const m = s.meshes[level];
    if (!m) return;
    freeMesh(m);
    delete s.meshes[level];
    s.bytes -= s.sizes[level] ?? 0;
    delete s.sizes[level];
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.shown) for (const l of LANDMARK_LEVELS) { const m = s.meshes[l]; if (m) freeMesh(m); }
    this.group.clear();
  }
}

