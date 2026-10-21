/**
 * Built things that stream in tiles over a quadtree (gen/detailTree.ts): the Lift Stair (gen/liftStairMesh.ts), the
 * entrance courts (gen/courts.ts), the river crossings (gen/crossings.ts). The root tiles are the far form, built once and always kept; around the eye the
 * quadtree's finer tiles stream in through a `StreamCache`. A tile is drawn once it is built, and until all four of its
 * children are, it stands in for them itself (`coverOf`): no level is taken away before the one replacing it is there
 * (Arnd, 2026-10-21), so nothing ever shows a hole or vanishes.
 */
import { Group, Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Habitat, type Vec3 } from '../blueprint';
import { coverOf, rootTiles, tileId, type Grid, type TileKey, type WantedTile } from '../gen/detailTree';
import { stairGridOf, stairTilesFor } from '../gen/liftStairMesh';
import { courtGridOf, courtTilesFor } from '../gen/courts';
import { crossingGridOf, crossingTilesFor } from '../gen/crossings';
import type { Terrain } from '../gen/terrain';
import { mappedBytes, type MappedArrays, type Place } from '../gen/shapes';
import type { Mat3 } from '../space';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer, GenRequest, TiledPart } from '../workers/gen.worker';
import { arraysGeometry, freeMesh, posedMesh, setPose, uploadStatic } from './geometry';
import { BUILT } from './materials';
import { StreamCache, type Streamed } from './streamed';

/** A built tile: its key, the frame its mesh is in, the mesh. */
export interface BuiltTile {
  key: TileKey;
  origin: Place;
  mesh: MappedArrays;
}

/** What streams in tiles: its worker part, its grid (null for none), the tiles the eye wants. */
export interface TiledSource {
  name: string;
  part: TiledPart;
  grid: Grid | null;
  tilesFor(eye: Vec3): WantedTile[];
}

interface Entry extends Streamed {
  key: TileKey;
  at: Vec3;
  axes: Mat3;
  /** Null for a tile with nothing in it: built all the same, so the cover counts it. */
  mesh: Mesh | null;
}

/** Tiles kept, drawn or not, the bytes they may hold (the GPU holds a second copy), and jobs in flight. */
const KEEP = 600;
const KEEP_BYTES = 96 * 1024 * 1024;
const IN_FLIGHT = 8;

const axesOf = (p: Place): Mat3 => [p.ex[0], p.ey[0], p.ez[0], p.ex[1], p.ey[1], p.ez[1], p.ex[2], p.ey[2], p.ez[2]];

export class TiledView {
  readonly group = new Group();
  private readonly cache: StreamCache<Entry>;
  private readonly roots: TileKey[];
  private drawn: Entry[] = [];

  constructor(private readonly source: TiledSource, private readonly habitat: Habitat, private readonly stage: Stage, pool: WorkerPool) {
    this.group.name = source.name;
    const g = source.grid, rootLevel = g?.root ?? 0;
    this.roots = g ? rootTiles(g) : [];
    this.cache = new StreamCache<Entry>(pool, {
      id: (r) => (r.kind === 'tiled' && r.part === source.part ? tileId(r.key) : ''),
      limit: KEEP,
      maxBytes: KEEP_BYTES,
      inFlight: IN_FLIGHT,
      make: (answer, id) => this.make(answer, id),
      free: (e) => { if (e.mesh) freeMesh(e.mesh); },
      // The root tiles are the far form: always there.
      pinned: (e) => e.key.level === rootLevel,
    });
    // The far form, all of it, as soon as the workers have it.
    for (const k of this.roots) void this.cache.ask(tileId(k), this.job(k));
  }

  /** Bytes the built tiles hold (memory watchdog). */
  bytes(): number { return this.cache.bytes; }

  /** Give memory back: tiles not drawn now go (the roots stay). */
  shed(): void { this.cache.shed(); }

  info(): string {
    const name = this.source.name;
    return this.roots.length ? `${name}: ${this.drawn.length} tiles drawn, ${this.cache.built.size} kept (${(this.cache.bytes / 1048576).toFixed(1)} MB), ${this.cache.building} building` : `${name}: none`;
  }

  /** Each frame: ask for the tiles the eye wants, and draw the finest built cover, the roots where nothing finer is. */
  follow(eye: Vec3): void {
    if (!this.roots.length) return;
    this.cache.frame();
    const wanted = this.source.tilesFor(eye);
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
    // The roots first, wherever the eye is (a job left out here is dropped from the queue), then the quadtree's tiles.
    const ids = new Set(wanted.map((w) => tileId(w.key)));
    const roots = this.roots.filter((k) => !ids.has(tileId(k))).map((k) => ({ id: tileId(k), request: this.job(k) }));
    this.cache.want([...roots, ...wanted.map((w) => ({ id: tileId(w.key), request: this.job(w.key) }))]);
  }

  dispose(): void {
    this.cache.clear();
    this.drawn = [];
    this.group.clear();
  }

  private job(key: TileKey): GenRequest {
    return { kind: 'tiled', part: this.source.part, params: this.habitat.params, key };
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('built' in answer) || answer.part !== this.source.part) return null;
    const t: BuiltTile = answer.built;
    const a = t.mesh;
    if (!a.index.length) return { key: t.key, at: t.origin.at, axes: axesOf(t.origin), mesh: null, bytes: 0, lastDrawn: 0 };
    const g = arraysGeometry(a, { uv: [a.uvs, 2], finish: [a.finishes, 1] });
    const mesh = posedMesh(g, BUILT.material, `${this.source.name} ${id}`);
    mesh.castShadow = true;
    await uploadStatic(this.stage, mesh);
    this.group.add(mesh);
    return { key: t.key, at: t.origin.at, axes: axesOf(t.origin), mesh, bytes: mappedBytes(a), lastDrawn: 0 };
  }
}

/** The Lift Stair's tiles. */
export const stairSource = (h: Habitat): TiledSource => ({ name: 'lift stair', part: 'stair', grid: stairGridOf(h), tilesFor: (eye) => stairTilesFor(h, eye) });

/** The entrance courts' tiles. */
export const courtSource = (t: Terrain): TiledSource => ({ name: 'entrance courts', part: 'courts', grid: courtGridOf(t), tilesFor: (eye) => courtTilesFor(t, eye) });

/** The river crossings' tiles. */
export const crossingSource = (t: Terrain): TiledSource => ({ name: 'river crossings', part: 'crossings', grid: crossingGridOf(t), tilesFor: (eye) => crossingTilesFor(t, eye) });
