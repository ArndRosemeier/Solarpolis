/**
 * The Lift Stair on screen (gen/liftStairMesh.ts builds its tiles): the root tiles are its far form, built once and
 * always kept; around the eye the quadtree's finer tiles stream in through a `StreamCache`. A tile is drawn once it is
 * built, and until all four of its children are, it stands in for them itself (`coverOf`): no level is taken away
 * before the one replacing it is there (Arnd, 2026-10-21), so nothing ever shows a hole or vanishes.
 */
import { Group, Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Habitat, type Vec3 } from '../blueprint';
import { coverOf, tileId, type TileKey } from '../gen/detailTree';
import { stairGridOf, stairRoots, stairTileBytes, stairTilesFor } from '../gen/liftStairMesh';
import type { Place } from '../gen/shapes';
import type { Mat3 } from '../space';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer, GenRequest } from '../workers/gen.worker';
import { arraysGeometry, freeMesh, posedMesh, setPose, uploadStatic } from './geometry';
import { BUILT } from './materials';
import { StreamCache, type Streamed } from './streamed';

interface Entry extends Streamed {
  key: TileKey;
  at: Vec3;
  axes: Mat3;
  /** Null for a tile with nothing in it (between the legs): built all the same, so the cover counts it. */
  mesh: Mesh | null;
}

/** Tiles kept, drawn or not, the bytes they may hold (the GPU holds a second copy), and jobs in flight. */
const KEEP = 600;
const KEEP_BYTES = 96 * 1024 * 1024;
const IN_FLIGHT = 8;

const axesOf = (p: Place): Mat3 => [p.ex[0], p.ey[0], p.ez[0], p.ex[1], p.ey[1], p.ez[1], p.ex[2], p.ey[2], p.ez[2]];

export class StairView {
  readonly group = new Group();
  private readonly cache: StreamCache<Entry>;
  private readonly roots: TileKey[];
  private readonly rootLevel: number;
  private drawn: Entry[] = [];

  constructor(private readonly habitat: Habitat, private readonly stage: Stage, pool: WorkerPool) {
    this.group.name = 'lift stair';
    const g = stairGridOf(habitat);
    this.roots = g ? stairRoots(g) : [];
    this.rootLevel = g?.root ?? 0;
    this.cache = new StreamCache<Entry>(pool, {
      id: (r) => (r.kind === 'stair' ? tileId(r.key) : ''),
      limit: KEEP,
      maxBytes: KEEP_BYTES,
      inFlight: IN_FLIGHT,
      make: (answer, id) => this.make(answer, id),
      free: (e) => { if (e.mesh) freeMesh(e.mesh); },
      // The root tiles are the far form: always there.
      pinned: (e) => e.key.level === this.rootLevel,
    });
    // The far form, all of it, as soon as the workers have it.
    for (const k of this.roots) void this.cache.ask(tileId(k), this.job(k));
  }

  /** Bytes the built tiles hold (memory watchdog). */
  bytes(): number { return this.cache.bytes; }

  /** Give memory back: tiles not drawn now go (the roots stay). */
  shed(): void { this.cache.shed(); }

  info(): string {
    return this.roots.length ? `lift stair: ${this.drawn.length} tiles drawn, ${this.cache.built.size} kept (${(this.cache.bytes / 1048576).toFixed(1)} MB), ${this.cache.building} building` : 'lift stair: none';
  }

  /** Each frame: ask for the tiles the eye wants, and draw the finest built cover, the roots where nothing finer is. */
  follow(eye: Vec3): void {
    if (!this.roots.length) return;
    this.cache.frame();
    const wanted = stairTilesFor(this.habitat, eye);
    const cover = coverOf(wanted, (id) => !!this.cache.get(id));
    for (const e of this.drawn) if (e.mesh) e.mesh.visible = false;
    this.drawn = [];
    const drawTile = (id: string): void => {
      const e = this.cache.get(id);
      if (!e) return;
      this.cache.mark(e);
      this.drawn.push(e);
      if (!e.mesh) return;
      e.mesh.visible = true;
      setPose(e.mesh, e.axes, toView(eye, e.at));
    };
    for (const w of cover.drawn) drawTile(tileId(w.key));
    // Roots the quadtree did not reach, or whose cover is not built yet: the far form.
    const covered = new Set(cover.covered.map(tileId));
    for (const k of this.roots) if (!covered.has(tileId(k))) drawTile(tileId(k));
    // Built tiles on the way to the drawn ones stay too: dropping one would only have it built again.
    for (const w of wanted) { const e = this.cache.get(tileId(w.key)); if (e) this.cache.mark(e); }
    this.cache.want(wanted.map((w) => ({ id: tileId(w.key), request: this.job(w.key) })));
  }

  dispose(): void {
    this.cache.clear();
    this.drawn = [];
    this.group.clear();
  }

  private job(key: TileKey): GenRequest {
    return { kind: 'stair', params: this.habitat.params, key };
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('stairTile' in answer)) return null;
    const t = answer.stairTile, a = t.mesh;
    if (!a.index.length) return { key: t.key, at: t.origin.at, axes: axesOf(t.origin), mesh: null, bytes: 0, lastDrawn: 0 };
    const g = arraysGeometry(a, { uv: [a.uvs, 2], finish: [a.finishes, 1] });
    const mesh = posedMesh(g, BUILT.material, `lift stair ${id}`);
    mesh.castShadow = true;
    await uploadStatic(this.stage, mesh);
    this.group.add(mesh);
    return { key: t.key, at: t.origin.at, axes: axesOf(t.origin), mesh, bytes: stairTileBytes(t), lastDrawn: 0 };
  }
}
