/**
 * The skin up close (gen/hullDetail.ts): the quadtree of detail tiles around the eye, built in the worker pool and
 * streamed through `StreamCache`, each tile two meshes (its glass, SKIN_DETAIL; its parts, HARDWARE) posed with the
 * habitat's body. A tile is drawn once it is built; until all of a tile's children are, the tile itself stands in
 * for them, so the skin never shows a hole while the eye moves in.
 */
import { Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, type Vec3 } from '@futuremagic/core';
import type { HabitatParams } from '../blueprint';
import { hullTileBytes, tileId, wantedTiles, type HullTile, type HullTileKey, type WantedTile } from '../gen/hullDetail';
import type { Skin } from '../gen/skin';
import { apply, type Mat3 } from '../space';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer } from '../workers/gen.worker';
import { meshGeometry, setPose } from './geometry';
import { HARDWARE, SKIN_DETAIL } from './materials';
import type { SkinUniforms } from './hullShaders';
import { StreamCache, type Streamed } from './streamed';

interface Entry extends Streamed {
  key: HullTileKey;
  origin: Vec3;
  glass: Mesh;
  parts: Mesh;
}

/** Tiles kept, drawn or not, and jobs in flight. */
const KEEP = 700;
const IN_FLIGHT = 12;

export class HullDetailView {
  private readonly cache: StreamCache<Entry>;
  private drawn: Entry[] = [];

  constructor(private readonly stage: Stage, pool: WorkerPool, private readonly params: HabitatParams, private readonly skin: Skin, private readonly uniforms: SkinUniforms, private readonly name: string) {
    this.cache = new StreamCache<Entry>(pool, {
      kind: 'hull',
      id: (r) => (r.kind === 'hull' ? tileId(r.key) : ''),
      limit: KEEP,
      inFlight: IN_FLIGHT,
      make: (answer, id) => this.make(answer, id),
      free: (e) => this.free(e),
    });
  }

  /** Bytes the built tiles hold. */
  bytes(): number { return this.cache.bytes; }

  /** Tiles drawn this frame, and built tiles kept. */
  info(): string { return `skin detail: ${this.drawn.length} tiles drawn, ${this.cache.built.size} kept, ${this.cache.building} building`; }

  /** Give memory back: tiles not drawn this frame go. */
  shed(): void { this.cache.shed(); }

  /**
   * Each frame: the eye in the body frame (m), the body's axes in the scene and its origin relative to the eye. Asks
   * for the tiles wanted, coarsest first, and draws the finest built cover of the skin.
   */
  follow(eye: Vec3, axes: Mat3, origin: Vec3): void {
    this.cache.frame();
    const wanted = wantedTiles(this.skin, eye);
    this.cache.want(wanted.map((w) => ({ id: tileId(w.key), request: { kind: 'hull' as const, params: this.params, key: w.key } })));
    for (const e of this.drawn) { e.glass.visible = false; e.parts.visible = false; }
    this.drawn = this.cover(wanted);
    for (const e of this.drawn) {
      this.cache.mark(e);
      e.glass.visible = e.parts.visible = true;
      const at = v3add(origin, apply(axes, e.origin));
      setPose(e.glass, axes, at);
      setPose(e.parts, axes, at);
    }
  }

  /** Remove every tile from the scene. */
  dispose(): void {
    this.cache.clear();
    this.drawn = [];
  }

  /** The built tiles to draw: each leaf, or where a tile's children are not all built yet, the tile itself. */
  private cover(wanted: readonly WantedTile[]): Entry[] {
    const byId = new Map(wanted.map((w) => [tileId(w.key), w]));
    const kids = (k: HullTileKey): WantedTile[] => {
      const h = Math.pow(2, k.level - 1);
      return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => byId.get(tileId({ level: k.level - 1, i: k.i + a * h, j: k.j + b * h }))).filter((w): w is WantedTile => !!w);
    };
    // Whether a tile's whole area can be drawn from built tiles at it or below it.
    const ready = new Map<string, boolean>();
    const isReady = (w: WantedTile): boolean => {
      const id = tileId(w.key);
      let r = ready.get(id);
      if (r === undefined) {
        r = !!this.cache.get(id) || (!w.leaf && kids(w.key).every(isReady));
        ready.set(id, r);
      }
      return r;
    };
    const out: Entry[] = [];
    const draw = (w: WantedTile): void => {
      const e = this.cache.get(tileId(w.key));
      if (!w.leaf && kids(w.key).every(isReady)) { for (const c of kids(w.key)) draw(c); return; }
      if (e) { out.push(e); return; }
      if (!w.leaf) for (const c of kids(w.key)) draw(c);
    };
    for (const w of wanted) if (w.key.level === wanted[0].key.level) draw(w);
    return out;
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('hullTile' in answer)) return null;
    const t: HullTile = answer.hullTile, g = t.glass, p = t.parts;
    const glass = new Mesh(meshGeometry(g.index, { position: [g.positions, 3], normal: [g.normals, 3], grid: [g.grid, 4] }), SKIN_DETAIL.material);
    const parts = new Mesh(meshGeometry(p.index, { position: [p.positions, 3], normal: [p.normals, 3], color: [p.colors, 3] }), HARDWARE.material);
    for (const [m, what] of [[glass, 'glass'], [parts, 'parts']] as const) {
      m.name = `${this.name} skin ${what} ${id}`;
      m.matrixAutoUpdate = false;
      m.visible = false;
      m.userData.skin = this.uniforms;
    }
    await Promise.all([this.stage.add(glass), this.stage.add(parts)]);
    return { key: t.key, origin: t.origin, glass, parts, bytes: hullTileBytes(t), lastDrawn: 0 };
  }

  private free(e: Entry): void {
    for (const m of [e.glass, e.parts]) { this.stage.remove(m); m.geometry.dispose(); }
  }
}
