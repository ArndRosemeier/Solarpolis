/**
 * The plants on screen: for each plant of the climate, the cells around the eye within its sight (`cellsNear`) are
 * planted by the worker pool (`plantCell`) and drawn as instanced meshes of the PLANT kind, one per variant, the
 * near cells with the detailed shapes and the rest with the light ones. Cells stay cached, least recently drawn first
 * out, until memory runs short.
 *
 * The plants' shapes (`buildPlant`) are made once, here, and shared by every cell: a cell's geometry holds only its
 * own instances.
 */
import { Group, InstancedBufferGeometry, Mesh, Sphere, Vector2, Vector3, BufferAttribute } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Vec3 } from '../blueprint';
import type { Ecology } from '../gen/ecology';
import { buildPlant, PLANT_VARIANTS, type PlantDetail } from '../gen/plants';
import { cellBytes, cellId, cellsNear, plantsOf, PLANT_STRIDE, type CellKey, type PlantCell, type Species } from '../gen/scatter';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer, GenRequest } from '../workers/gen.worker';
import { StreamCache, type Streamed } from './streamed';
import { PLANT, plantInstances } from './materials';

/** Cells nearer than this share of the plant's sight distance get the detailed shapes. */
const NEAR_SHARE = 0.2;
/** Cells kept, drawn or not. */
const CACHE = 2500;
/** Cell jobs in flight at once. */
const IN_FLIGHT = 12;
/** The eye moves this share of the smallest cell before the cells in view are chosen again. */
const RECHOOSE = 0.25;

interface Shape {
  /** The shared attributes of one species × variant × detail. */
  position: BufferAttribute;
  normal: BufferAttribute;
  color: BufferAttribute;
  index: BufferAttribute;
  reach: number;
}

interface Entry extends Streamed {
  cell: PlantCell;
  /** Per variant: the detailed and the light mesh (null where the variant has no plants in this cell). */
  meshes: ({ near: Mesh; far: Mesh } | null)[];
}

export class PlantView {
  readonly group = new Group();
  readonly species: Species[];
  private readonly shapes: Shape[][][];
  private readonly cache: StreamCache<Entry>;
  private drawn: Entry[] = [];
  private chosenAt: Vec3 | null = null;
  private chosen: CellKey[][] = [];

  constructor(private readonly ecology: Ecology, private readonly stage: Stage, pool: WorkerPool) {
    this.group.name = 'plants';
    this.species = plantsOf(ecology);
    const seed = ecology.terrain.habitat.seed;
    this.shapes = this.species.map((sp) => Array.from({ length: PLANT_VARIANTS }, (_, v) => (['near', 'far'] as PlantDetail[]).map((d) => {
      const m = buildPlant(sp.spec, seed, v, d);
      return { position: new BufferAttribute(m.positions, 3), normal: new BufferAttribute(m.normals, 3), color: new BufferAttribute(m.colors, 3), index: new BufferAttribute(m.index, 1), reach: m.reach };
    })));
    this.cache = new StreamCache<Entry>(pool, {
      kind: 'plants', limit: CACHE, inFlight: IN_FLIGHT,
      id: (r) => (r.kind === 'plants' ? cellId(r.key) : ''),
      make: (answer, id) => this.make(answer, id),
      free: (e) => { for (const m of e.meshes) if (m) { this.group.remove(m.near, m.far); freeInstances(m.near); freeInstances(m.far); } },
    });
  }

  /** Bytes the cached cells hold (memory watchdog). */
  bytes(): number { return this.cache.bytes; }

  /** Give memory back: drop every cached cell not drawn now. */
  shed(): void { this.cache.shed(); }

  info(): string {
    let plants = 0;
    for (const e of this.drawn) plants += e.cell.count;
    return `plants ${plants} in ${this.drawn.length} cells, ${this.cache.built.size} cached (${(this.cache.bytes / 1048576).toFixed(1)} MB), ${this.cache.building} planting`;
  }

  /** Choose, request and place the plant cells for an eye. */
  follow(eye: Vec3): void {
    this.cache.frame();
    const smallest = Math.min(...this.species.map((s) => s.cell));
    if (!this.chosenAt || Math.hypot(eye[0] - this.chosenAt[0], eye[1] - this.chosenAt[1], eye[2] - this.chosenAt[2]) > smallest * RECHOOSE) {
      this.chosenAt = [...eye];
      this.chosen = this.species.map((sp) => cellsNear(this.ecology, sp, eye));
    }
    for (const e of this.drawn) for (const m of e.meshes) if (m) { m.near.visible = false; m.far.visible = false; }
    this.drawn = [];
    const wanted: { id: string; request: GenRequest }[] = [];
    const params = this.ecology.terrain.habitat.params;
    this.species.forEach((sp, k) => {
      for (const key of this.chosen[k]) {
        const id = cellId(key), e = this.cache.get(id);
        if (!e) { wanted.push({ id, request: { kind: 'plants', params, key } }); continue; }
        const [x, y, z] = toView(eye, e.cell.origin);
        const near = Math.hypot(x, y, z) - sp.cell * Math.SQRT1_2 < sp.seen * NEAR_SHARE;
        for (const m of e.meshes) {
          if (!m) continue;
          const show = near ? m.near : m.far;
          show.position.set(x, y, z);
          show.visible = true;
        }
        this.cache.mark(e);
        this.drawn.push(e);
      }
    });
    // Ask for what is missing, nearest first within each plant (cellsNear sorts them).
    this.cache.want(wanted);
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('cell' in answer)) return null;
    const cell = answer.cell, sp = this.species[cell.key.species];
    const meshes = cell.instances.map((data, v) => {
      if (!data.length) return null;
      const [near, far] = this.shapes[cell.key.species][v].map((shape) => this.mesh(shape, data, sp, cell, id));
      return { near, far };
    });
    for (const m of meshes) if (m) { await this.stage.prepare(m.near); await this.stage.prepare(m.far); }
    for (const m of meshes) if (m) this.group.add(m.near, m.far);
    return { cell, meshes, bytes: cellBytes(cell), lastDrawn: 0 };
  }

  private mesh(shape: Shape, data: Float32Array, sp: Species, cell: PlantCell, id: string): Mesh {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', shape.position);
    g.setAttribute('normal', shape.normal);
    g.setAttribute('color', shape.color);
    g.setIndex(shape.index);
    plantInstances(g, data);
    g.instanceCount = data.length / PLANT_STRIDE;
    // Everything in the cell: its plants stand within half its diagonal of the origin, as tall as the tallest.
    g.boundingSphere = new Sphere(new Vector3(), sp.cell * Math.SQRT1_2 + sp.spec.height[1] * (1 + shape.reach));
    const m = new Mesh(g, PLANT.material);
    m.name = `plants ${sp.spec.name} ${id}`;
    m.castShadow = true;
    m.visible = false;
    m.userData.seen = sp.seen;
    m.userData.horizon = new Vector2(cell.horizon[0], cell.horizon[1]);
    return m;
  }

  dispose(): void {
    this.cache.clear();
    this.group.clear();
  }
}

/**
 * Free a cell mesh's own buffers (its instances) but not the shapes it shares: three frees every attribute of a
 * disposed geometry, so the shared ones are taken off first.
 */
function freeInstances(m: Mesh): void {
  const g = m.geometry;
  for (const name of ['position', 'normal', 'color']) g.deleteAttribute(name);
  g.setIndex(null);
  g.dispose();
}
