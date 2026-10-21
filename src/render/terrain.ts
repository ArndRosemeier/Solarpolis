/**
 * The terrain on screen: each frame it picks the tiles for the view (`select`), asks the worker pool for the ones it
 * lacks, and draws the chosen ones relative to the eye. Built tiles stay cached until memory runs short or the cache
 * is full, least recently drawn first.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { keyId, makeLayout, roots, select, spheres, tileBytes, type TileKey, type TileLayout, type TileMesh } from '../gen/tiles';
import type { WorkerPool } from '../workers/pool';
import { GROUND, WATER } from './materials';

/** A tile's error may cover at most this many pixels before the tile splits. */
const MAX_PIXELS = 2;
/** Built tiles kept, drawn or not: a few times what one view needs, so turning around costs nothing. */
const CACHE = 3000;
/** Tile jobs in flight at once: enough to keep every worker busy, few enough to drop stale ones quickly. */
const IN_FLIGHT = 16;

interface Entry {
  tile: TileMesh;
  mesh: Mesh;
  water: Mesh | null;
  bytes: number;
  lastDrawn: number;
}

export class TerrainView {
  readonly group = new Group();
  private readonly layout: TileLayout;
  private readonly sphereOf;
  private readonly built = new Map<string, Entry>();
  private readonly asked = new Set<string>();
  private drawn: Entry[] = [];
  private frameNo = 0;
  private bytesHeld = 0;

  constructor(private readonly terrain: Terrain, private readonly stage: Stage, private readonly pool: WorkerPool) {
    this.layout = makeLayout(terrain);
    this.sphereOf = spheres(terrain, this.layout);
    this.group.name = 'terrain';
  }

  /** Build the root tiles: the whole interior, coarse. Resolves when they are on screen. */
  async load(): Promise<void> {
    await Promise.all(roots(this.layout).map((k) => this.request(k)));
  }

  /** Bytes the cached tiles hold (memory watchdog). */
  bytes(): number { return this.bytesHeld; }

  /** Give memory back: drop every cached tile not drawn now. */
  shed(): void {
    const keep = new Set(this.drawn);
    for (const [id, e] of this.built) if (!keep.has(e)) this.forget(id, e);
  }

  info(): string {
    return `terrain ${this.drawn.length} tiles drawn, ${this.built.size} cached (${(this.bytesHeld / 1048576).toFixed(0)} MB), ${this.asked.size} building, ${this.pool.queued} queued`;
  }

  /** Choose, request and place the tiles for an eye; `pixelsPerRadian` is the screen height over the vertical FOV. */
  follow(eye: Vec3, pixelsPerRadian: number): void {
    this.frameNo++;
    const errorOf = (k: TileKey): number | undefined => this.built.get(keyId(k))?.tile.error;
    const sel = select(this.terrain, this.layout, eye, pixelsPerRadian, MAX_PIXELS, errorOf, this.sphereOf);
    for (const e of this.drawn) { e.mesh.visible = false; if (e.water) e.water.visible = false; }
    this.drawn = [];
    for (const k of sel.draw) {
      const e = this.built.get(keyId(k))!;
      const [x, y, z] = toView(eye, e.tile.origin);
      e.mesh.position.set(x, y, z);
      e.mesh.visible = true;
      if (e.water) { e.water.position.set(x, y, z); e.water.visible = true; }
      e.lastDrawn = this.frameNo;
      this.drawn.push(e);
    }
    // Ask for what is missing, most needed first; jobs no longer wanted are dropped from the queue.
    const wanted = new Set(sel.want.map(keyId));
    this.pool.drop((r) => r.kind !== 'tile' || wanted.has(keyId(r.key)));
    for (const id of [...this.asked]) if (!wanted.has(id)) this.asked.delete(id);
    for (const k of sel.want) {
      if (this.asked.size >= IN_FLIGHT) break;
      if (!this.asked.has(keyId(k))) void this.request(k);
    }
    this.evict();
  }

  private async request(k: TileKey): Promise<void> {
    const id = keyId(k);
    this.asked.add(id);
    const answer = await this.pool.job({ kind: 'tile', params: this.terrain.habitat.params, key: k });
    if (!('tile' in answer) || this.built.has(id)) return;
    const tile = answer.tile;
    const mesh = new Mesh(geometry(tile.positions, tile.normals, tile.index, tile.colors), GROUND.material);
    mesh.name = `tile ${id}`;
    mesh.visible = false;
    const water = tile.water ? new Mesh(geometry(tile.water.positions, tile.water.normals, tile.water.index), WATER.material) : null;
    if (water) { water.name = `water ${id}`; water.visible = false; }
    await this.stage.prepare(mesh);
    if (water) await this.stage.prepare(water);
    this.group.add(mesh);
    if (water) this.group.add(water);
    const bytes = tileBytes(tile);
    this.built.set(id, { tile, mesh, water, bytes, lastDrawn: 0 });
    this.bytesHeld += bytes;
    this.asked.delete(id);
  }

  private evict(): void {
    if (this.built.size <= CACHE) return;
    const old = [...this.built].filter(([, e]) => e.lastDrawn < this.frameNo && e.tile.key.level > 0).sort((a, b) => a[1].lastDrawn - b[1].lastDrawn);
    for (const [id, e] of old.slice(0, this.built.size - CACHE)) this.forget(id, e);
  }

  private forget(id: string, e: Entry): void {
    if (e.tile.key.level === 0) return; // the roots always stay: they are the fallback for everything
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    if (e.water) { this.group.remove(e.water); e.water.geometry.dispose(); }
    this.built.delete(id);
    this.bytesHeld -= e.bytes;
  }

  dispose(): void {
    for (const [, e] of this.built) { e.mesh.geometry.dispose(); e.water?.geometry.dispose(); }
    this.built.clear();
    this.group.clear();
    this.bytesHeld = 0;
  }
}

function geometry(positions: Float32Array, normals: Float32Array, index: Uint32Array, colors?: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  if (colors) g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** The interior's tile layout, for the debug menu. */
export function describeLayout(terrain: Terrain): string {
  const l = makeLayout(terrain);
  return `${l.bands.length} bands, ${roots(l).length} roots of ${(l.rootSize / 1000).toFixed(1)} km, ${l.maxLevel} levels`;
}
