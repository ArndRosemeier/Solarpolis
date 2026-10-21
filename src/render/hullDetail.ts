/**
 * The habitat up close (gen/hullParts.ts): for every detailed part (the skin, the spindle's plating, the berth arms,
 * the mast, the dishes) the quadtree of detail tiles around the eye, built in the worker pool and streamed through one
 * `StreamCache`, each tile a HARDWARE mesh of its parts (and for the skin a SKIN_DETAIL mesh of its glass), posed in
 * its part's frame: the spinning body's or the despun spindle's. A tile is drawn once it is built; until all of a
 * tile's children are, the tile itself stands in for them (`coverOf`), so a part never shows a hole while the eye
 * moves in. A root tile is drawn only once it is covered whole; until then the part's far form shows there alone.
 */
import { Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { detailParts, partTileBytes, partTiles, type DetailPart, type PartFrame, type PartTile } from '../gen/hullParts';
import { coverOf, tileId, type TileKey } from '../gen/detailTree';
import type { Skin } from '../gen/skin';
import { apply, type Mat3 } from '../space';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer } from '../workers/gen.worker';
import { arraysGeometry, dropUploaded, freeMesh, setPose } from './geometry';
import { HARDWARE, SKIN_DETAIL } from './materials';
import type { SkinUniforms } from './hullShaders';
import { StreamCache, type Streamed } from './streamed';

interface Entry extends Streamed {
  origin: Vec3;
  meshes: Mesh[];
}

/** Tiles kept, drawn or not, the bytes they may hold (the GPU holds a second copy), and jobs in flight. */
const KEEP = 900;
const KEEP_BYTES = 192 * 1024 * 1024;
const IN_FLIGHT = 12;

/** Per frame, for each of the two frames: the eye in it (m) and its axes in the scene. */
export type Frames = Record<PartFrame, { eye: Vec3; axes: Mat3 }>;

const idOf = (part: string, key: TileKey): string => `${part}/${tileId(key)}`;

export class HullDetailView {
  readonly parts: DetailPart[];
  private readonly cache: StreamCache<Entry>;
  private drawn: Entry[] = [];
  private readonly complete = new Set<string>();
  private readonly roots = new Map<string, TileKey[]>();

  constructor(private readonly stage: Stage, pool: WorkerPool, private readonly habitat: Habitat, private readonly skin: Skin, private readonly uniforms: SkinUniforms, private readonly name: string) {
    this.parts = detailParts(habitat, skin);
    this.cache = new StreamCache<Entry>(pool, {
      id: (r) => (r.kind === 'hull' ? idOf(r.part, r.key) : ''),
      limit: KEEP,
      maxBytes: KEEP_BYTES,
      inFlight: IN_FLIGHT,
      make: (answer, id) => this.make(answer, id),
      free: (e) => this.free(e),
    });
  }

  /** Bytes the built tiles hold. */
  bytes(): number { return this.cache.bytes; }

  /** Tiles drawn this frame, and built tiles kept. */
  info(): string { return `hull detail: ${this.drawn.length} tiles drawn, ${this.cache.built.size} kept, ${this.cache.building} building`; }

  /** Give memory back: tiles not drawn this frame go. */
  shed(): void { this.cache.shed(); }

  /** Whether a part's near tiles stand in for all of it this frame (its far form can hide). */
  covers(part: string): boolean { return this.complete.has(part); }

  /** The root tiles of a part its near tiles cover this frame (its far form hides under them). */
  covered(part: string): readonly TileKey[] { return this.roots.get(part) ?? []; }

  /**
   * Each frame: the eye and axes of both frames, and their shared origin relative to the eye. Asks for the tiles
   * wanted, coarsest first, nearest first, and draws the finest built cover of each part.
   */
  follow(frames: Frames, origin: Vec3): void {
    this.cache.frame();
    const wanted = this.parts.map((p) => ({ p, tiles: partTiles(p, this.skin, frames[p.frame].eye) })).filter((w) => w.tiles.length);
    const jobs = wanted.flatMap(({ p, tiles }) => tiles.map((w) => ({ w, id: idOf(p.id, w.key), request: { kind: 'hull' as const, params: this.habitat.params, part: p.id, key: w.key } })));
    jobs.sort((a, b) => b.w.key.level - a.w.key.level || a.w.distance - b.w.distance);
    this.cache.want(jobs);
    for (const e of this.drawn) for (const m of e.meshes) m.visible = false;
    this.drawn = [];
    this.complete.clear();
    this.roots.clear();
    for (const { p, tiles } of wanted) {
      const cover = coverOf(tiles, (id) => !!this.cache.get(`${p.id}/${id}`));
      if (cover.complete) this.complete.add(p.id);
      this.roots.set(p.id, cover.covered);
      const axes = frames[p.frame].axes;
      for (const w of cover.drawn) {
        const e = this.cache.get(idOf(p.id, w.key))!;
        this.cache.mark(e);
        const at = v3add(origin, apply(axes, e.origin));
        for (const m of e.meshes) { m.visible = true; setPose(m, axes, at); }
        this.drawn.push(e);
      }
    }
  }

  /** Remove every tile from the scene. */
  dispose(): void {
    this.cache.clear();
    this.drawn = [];
    this.complete.clear();
    this.roots.clear();
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('partTile' in answer)) return null;
    const t: PartTile = answer.partTile, q = t.parts;
    const meshes = [new Mesh(arraysGeometry(q), HARDWARE.material)];
    if (t.glass) {
      const g = t.glass;
      meshes.unshift(new Mesh(arraysGeometry(g, { grid: [g.grid, 4] }), SKIN_DETAIL.material));
    }
    for (const m of meshes) {
      m.name = `${this.name} ${id}`;
      m.matrixAutoUpdate = false;
      m.userData.skin = this.uniforms;
      // Prepared while visible (three's compile skips hidden objects), so its arrays go to the GPU now and the CPU's
      // copies can go; then added hidden (nothing left to build) until `follow` draws it.
      await this.stage.prepare(m);
      m.visible = false;
      dropUploaded(m, this.stage.renderer);
      await this.stage.add(m);
    }
    return { origin: t.origin, meshes, bytes: partTileBytes(t), lastDrawn: 0 };
  }

  private free(e: Entry): void {
    for (const m of e.meshes) { this.stage.remove(m); freeMesh(m); }
  }
}
