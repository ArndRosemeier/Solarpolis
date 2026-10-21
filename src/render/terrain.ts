/**
 * The terrain on screen: each frame it picks the tiles for the view (`select`), asks the worker pool for the ones it
 * lacks, and draws the chosen ones relative to the eye. Built tiles stay cached until memory runs short or the cache
 * is full, least recently drawn first.
 */
import { Group, Mesh, type BufferGeometry } from 'three/webgpu';
import { arraysGeometry, dropUploaded, freeMesh, meshGeometry } from './geometry';
import type { Stage } from '@futuremagic/stage';
import { toView, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { CELL_PIXELS, cellSize, keyId, makeLayout, parent, roots, select, spheres, tileBytes, type TileFit, type TileKey, type TileLayout, type TileMesh } from '../gen/tiles';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer, GenRequest } from '../workers/gen.worker';
import { StreamCache, type Streamed } from './streamed';
import { GROUND, WATER } from './materials';
import { FLOOR_BYTES, loadFloor } from './groundShaders';

/** A tile's error may cover at most this many pixels before the tile splits. */
const MAX_PIXELS = 2;
/** Built tiles kept, drawn or not: a few times what one view needs, so turning around costs nothing. */
const CACHE = 3000;
/**
 * ...but never more than this (bytes; a tile is about 0.4 MB, and the GPU holds a second copy). Tiles in use (drawn,
 * or split to reach them) are never evicted, so a view that needs more than this holds more rather than flicker.
 */
const CACHE_BYTES = 384 * 1024 * 1024;
/** Tile jobs in flight at once: enough to keep every worker busy, few enough to drop stale ones quickly. */
const IN_FLIGHT = 16;

interface Entry extends Streamed {
  /** What the view reads of the tile; its arrays are on the GPU only (`dropUploaded`). */
  tile: Pick<TileMesh, 'key' | 'origin' | 'error' | 'relief'>;
  mesh: Mesh;
  water: Mesh | null;
}

export class TerrainView {
  readonly group = new Group();
  private readonly layout: TileLayout;
  private readonly sphereOf;
  private readonly cache: StreamCache<Entry>;
  private drawn: Entry[] = [];
  /** For the debug menu: tiles that came on screen in the last frame, and tiles built since the start. Standing still,
   * both stop: tiles that keep swapping or being built again are LOD flicker. */
  private swapped = 0;
  private made = 0;

  constructor(private readonly terrain: Terrain, private readonly stage: Stage, private readonly pool: WorkerPool) {
    this.layout = makeLayout(terrain);
    this.sphereOf = spheres(terrain, this.layout);
    this.group.name = 'terrain';
    this.cache = new StreamCache<Entry>(pool, {
      limit: CACHE, maxBytes: CACHE_BYTES, inFlight: IN_FLIGHT,
      id: (r) => (r.kind === 'tile' ? keyId(r.key) : ''),
      make: (answer, id) => this.make(answer, id),
      free: (e) => {
        freeMesh(e.mesh);
        if (e.water) freeMesh(e.water);
      },
      // The roots always stay: they are the fallback for everything.
      pinned: (e) => e.tile.key.level === 0,
    });
  }

  /** Build the root tiles: the whole interior, coarse. Resolves when they are on screen. */
  async load(): Promise<void> {
    await Promise.all(roots(this.layout).map((k) => this.cache.ask(keyId(k), this.job(k))));
    // Then the floor's textures, for up close (after the roots: nothing waits for them).
    loadFloor(this.pool, this.terrain.habitat.params);
  }

  /** Bytes the cached tiles and the floor's textures hold (memory watchdog). */
  bytes(): number { return this.cache.bytes + FLOOR_BYTES; }

  /** Give memory back: drop every cached tile not drawn now. */
  shed(): void { this.cache.shed(); }

  info(): string {
    return `terrain ${this.drawn.length} tiles drawn (${this.swapped} new last frame, ${this.made} built so far), ${this.cache.built.size} cached (${(this.cache.bytes / 1048576).toFixed(0)} MB), ${this.cache.building} building`;
  }

  /** Choose, request and place the tiles for an eye; `pixelsPerRadian` is the screen height over the vertical FOV. */
  follow(eye: Vec3, pixelsPerRadian: number): void {
    this.cache.frame();
    const fitOf = (k: TileKey): TileFit | undefined => this.cache.get(keyId(k))?.tile;
    // A parent's error as `select` judges it: its shape's error, or its cells.
    const parentError = (k: TileKey): number | undefined => {
      const e = k.level === 0 ? undefined : fitOf(parent(this.layout, k))?.error;
      return e === undefined ? undefined : Math.max(e, (cellSize(this.layout, parent(this.layout, k)) * MAX_PIXELS) / CELL_PIXELS);
    };
    const sel = select(this.terrain, this.layout, eye, pixelsPerRadian, MAX_PIXELS, fitOf, this.sphereOf);
    const before = new Set(this.drawn);
    for (const e of this.drawn) { e.mesh.visible = false; if (e.water) e.water.visible = false; }
    this.drawn = [];
    this.swapped = 0;
    for (const k of sel.draw) {
      const e = this.cache.get(keyId(k))!;
      const [x, y, z] = toView(eye, e.tile.origin);
      e.mesh.position.set(x, y, z);
      e.mesh.visible = true;
      // Where the parent would be chosen instead (select: its error over the distance reaches MAX_PIXELS).
      const pe = parentError(k);
      e.mesh.userData.morphFar = pe === undefined ? 1e30 : (pe * pixelsPerRadian) / MAX_PIXELS;
      if (e.water) { e.water.position.set(x, y, z); e.water.visible = true; }
      this.cache.mark(e);
      this.drawn.push(e);
      if (!before.has(e)) this.swapped++;
    }
    // The tiles split to reach these, and children waiting for their siblings, are in use too: evicting one would drop
    // a branch back to a coarse tile, or keep a tile from ever splitting, while the full cache builds it again and
    // again (the flicker where the sunline meets an endcap).
    for (const k of sel.keep) this.cache.mark(this.cache.get(keyId(k))!);
    // Ask for what is missing, most needed first; jobs no longer wanted are dropped from the queue.
    this.cache.want(sel.want.map((k) => ({ id: keyId(k), request: this.job(k) })));
  }

  private job(key: TileKey): GenRequest {
    return { kind: 'tile', params: this.terrain.habitat.params, key };
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('tile' in answer)) return null;
    const tile = answer.tile;
    const mesh = new Mesh(geometry(tile.positions, tile.normals, tile.index, tile.colors, tile.morph, tile.horizon, tile.canopy, tile.floorA, tile.floorB), GROUND.material);
    mesh.name = `tile ${id}`;
    const w = tile.water;
    const water = w ? new Mesh(arraysGeometry(w, { flow: [w.flow, 4], dir: [w.dir, 4] }), WATER.material) : null;
    if (water) water.name = `water ${id}`;
    // Prepared while visible (three's compile skips hidden objects), so its arrays go to the GPU now and the CPU's
    // copies can go: only the GPU reads them (most of the JS heap was tile copies, 2026-10-21).
    for (const m of water ? [mesh, water] : [mesh]) {
      await this.stage.prepare(m);
      m.visible = false;
      dropUploaded(m, this.stage.renderer);
      this.group.add(m);
    }
    this.made++;
    return { tile: { key: tile.key, origin: tile.origin, error: tile.error, relief: tile.relief }, mesh, water, bytes: tileBytes(tile), lastDrawn: 0 };
  }

  dispose(): void {
    this.cache.clear();
    this.group.clear();
  }
}

function geometry(positions: Float32Array, normals: Float32Array, index: Uint32Array, colors?: Float32Array, morph?: Float32Array, horizon?: Float32Array, canopy?: Float32Array, floorA?: Uint8Array, floorB?: Uint8Array): BufferGeometry {
  return meshGeometry(index, {
    position: [positions, 3], normal: [normals, 3],
    color: colors && [colors, 3], morph: morph && [morph, 4], horizon: horizon && [horizon, 4], canopy: canopy && [canopy, 4], floorA: floorA && [floorA, 4], floorB: floorB && [floorB, 4],
  });
}

/** The interior's tile layout, for the debug menu. */
export function describeLayout(terrain: Terrain): string {
  const l = makeLayout(terrain);
  return `${l.bands.length} bands, ${roots(l).length} roots of ${(l.rootSize / 1000).toFixed(1)} km, ${l.maxLevel} levels`;
}
