/**
 * The plants on screen. Each plant of the climate is drawn at three levels (`LEVELS` in gen/scatter.ts): the full tree
 * (BARK wood, LEAF cards), a lighter tree (fewer, larger cards; no finest twigs), and its crown hull (HULL); ground
 * cover at two (GRASS: full tufts, light tufts that sink into the floor at the end of their band); debris at three
 * (STONE, or BARK for fallen wood: full, light, far), sheared along the slope it lies on. Each level
 * has its own cells around the eye (`cellsNear`), planted by the worker pool (`plantCell`) and drawn as instanced
 * meshes. A plant hands over from one level to the next in a dithered band (`userData.band`, read by the kinds), so it
 * is always drawn by exactly one level; past the hulls the ground's canopy layer stands in for woods. Cells stay cached,
 * least recently drawn first out, until memory runs short.
 *
 * The shapes (`buildTree` and `buildTuft`, three per form) and the bark and leaf atlases are built once by the workers and shared by
 * every cell: a cell's geometry holds only its own instances.
 */
import { BufferAttribute, Group, InstancedBufferGeometry, InstancedInterleavedBuffer, Mesh, Sphere, Vector2, Vector3, Vector4, type Material } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type CoverSpec, type DebrisSpec, type PlantSpec, type Vec3 } from '../blueprint';
import type { Ecology } from '../gen/ecology';
import type { FallenWood, TreeModel } from '../gen/trees';
import type { StoneMesh, StoneModel } from '../gen/stones';
import type { TuftModel } from '../gen/grass';
import { canopyBand, cellBytes, cellId, cellsNear, LEVELS, plantsOf, PLANT_STRIDE, PLANT_VARIANTS, type CellKey, type Level, type PlantCell, type Species } from '../gen/scatter';
import type { WorkerPool } from '../workers/pool';
import type { GenAnswer, GenRequest } from '../workers/gen.worker';
import { StreamCache, type Streamed } from './streamed';
import { freeMesh } from './geometry';
import { BARK, GRASS, HULL, LEAF, STONE, isPlantInstance, plantInstances, setCanopyBand, setFoliage } from './materials';

/** Cells kept, drawn or not, and the bytes they may hold (the GPU holds a second copy). */
const CACHE = 6000;
const CACHE_BYTES = 192 * 1024 * 1024;
/** Cell jobs in flight at once. */
const IN_FLIGHT = 12;
/** The eye moves this share of the smallest cell before the cells in view are chosen again. */
const RECHOOSE = 0.25;

/** One mesh's shared attributes (a tree's wood, its leaves, or its hull; a tuft), and whether it casts shadows. */
interface Part {
  attributes: [string, BufferAttribute][];
  index: BufferAttribute;
  material: Material;
  cast: boolean;
}

/** A form's shapes: per level it is drawn at, the parts of each variant (the hull level has one variant). */
type Shapes = Part[][][];

/** One shape's plants in a cell: all of them, the buffer the meshes draw (the ones in their band), the meshes. */
interface Shaped {
  all: Float32Array;
  buffer: InstancedInterleavedBuffer;
  meshes: Mesh[];
}

interface Entry extends Streamed {
  cell: PlantCell;
  meshes: Mesh[];
  shaped: Shaped[];
  /** The choice (`PlantView.generation`) its buffers were last trimmed for. */
  trimmed: number;
}

export class PlantView {
  readonly group = new Group();
  readonly species: Species[];
  /** Shapes by `shapeKey`. */
  private readonly shapes = new Map<string, Shapes>();
  private readonly cache: StreamCache<Entry>;
  private drawn: Entry[] = [];
  private chosenAt: Vec3 | null = null;
  private chosen: CellKey[] = [];
  private chosenForms = 0;
  /** Counts the choices of cells (each time the eye has moved far enough). */
  private generation = 0;
  /** Bytes of the shared shapes and the two atlases. */
  private shared = 0;

  constructor(private readonly ecology: Ecology, private readonly stage: Stage, pool: WorkerPool) {
    this.group.name = 'plants';
    this.species = plantsOf(ecology);
    setCanopyBand(canopyBand(ecology));
    const params = ecology.terrain.habitat.params;
    void pool.job({ kind: 'foliage', params }).then((a) => {
      if (!('bark' in a)) return;
      setFoliage(a.bark, a.leaves);
      // With their mips, a third more.
      this.shared += ((a.bark.color.byteLength + a.bark.normal.byteLength + a.leaves.byteLength) * 4) / 3;
    });
    const shaped = (key: string, shapes: Shapes) => {
      this.shapes.set(key, shapes);
      for (const level of shapes) for (const v of level) for (const part of v) this.shared += part.index.array.byteLength + part.attributes.reduce((n, [, a]) => n + a.array.byteLength, 0);
    };
    /** Ask for every variant of a shape; keep them once all have come. */
    const variants = <A>(key: string, ask: (variant: number) => Promise<GenAnswer>, take: (a: GenAnswer) => A | null, shapes: (all: A[]) => Shapes) =>
      void Promise.all(Array.from({ length: PLANT_VARIANTS }, (_, variant) => ask(variant))).then((answers) => {
        const all = answers.map(take);
        if (all.every((a) => a !== null)) shaped(key, shapes(all as A[]));
      });
    const rock = ecology.climate.rock;
    for (const sp of new Map(this.species.map((s) => [shapeKey(s), s])).values()) {
      const key = shapeKey(sp), spec = sp.spec;
      if (sp.what === 'cover') {
        const { form, color } = spec as CoverSpec;
        variants(key, (variant) => pool.job({ kind: 'tuft', params, form, color, variant }), (a) => ('tuft' in a ? a.tuft : null), tuftShapes);
      } else if (sp.what === 'debris') {
        const d = spec as DebrisSpec;
        if (d.form === 'stone') variants(key, (variant) => pool.job({ kind: 'stone', params, color: rock, moss: d.moss ?? 0, variant }), (a) => ('stone' in a ? a.stone : null), stoneShapes);
        else variants(key, (variant) => pool.job({ kind: 'fallen', params, form: d.wood ?? 'oak', piece: d.form as 'log' | 'branch', variant }), (a) => ('fallen' in a ? a.fallen : null), fallenShapes);
      } else {
        variants(key, (variant) => pool.job({ kind: 'tree', params, form: (spec as PlantSpec).form, variant }), (a) => ('full' in a ? a : null), shapesOf);
      }
    }
    this.cache = new StreamCache<Entry>(pool, {
      limit: CACHE, maxBytes: CACHE_BYTES, inFlight: IN_FLIGHT,
      id: (r) => (r.kind === 'plants' ? cellId(r.key) : ''),
      make: (answer, id) => this.make(answer, id),
      free: (e) => { for (const m of e.meshes) freeMesh(m, isPlantInstance); },
    });
  }

  /** Bytes the cached cells, the shapes and the atlases hold (memory watchdog). */
  bytes(): number { return this.cache.bytes + this.shared; }

  /** Give memory back: drop every cached cell not drawn now. */
  shed(): void { this.cache.shed(); }

  info(): string {
    const plants = [0, 0, 0], cells = [0, 0, 0];
    let tufts = 0, debris = 0, draws = 0;
    for (const e of this.drawn) {
      const what = this.species[e.cell.key.species].what;
      if (what === 'cover') tufts += e.cell.count;
      else if (what === 'debris') debris += e.cell.count;
      else { plants[e.cell.key.level] += e.cell.count; cells[e.cell.key.level]++; }
      draws += e.meshes.length;
    }
    const levels = LEVELS.map((l, k) => `${l.name} ${plants[k]}/${cells[k]}`).join(', ');
    return `plants (plants/cells) ${levels}; ${tufts} tufts; ${debris} stones and fallen wood; ${draws} draws, ${this.cache.built.size} cached (${(this.cache.bytes / 1048576).toFixed(1)} MB; shapes and atlases ${(this.shared / 1048576).toFixed(1)} MB), ${this.cache.building} planting, ${this.shapes.size} forms`;
  }

  /** Choose, request and place the plant cells for an eye. */
  follow(eye: Vec3): void {
    this.cache.frame();
    const smallest = Math.min(...this.species.map((s) => s.cell[0]));
    if (!this.chosenAt || this.chosenForms !== this.shapes.size || Math.hypot(eye[0] - this.chosenAt[0], eye[1] - this.chosenAt[1], eye[2] - this.chosenAt[2]) > smallest * RECHOOSE) {
      this.chosenAt = [...eye];
      this.chosenForms = this.shapes.size;
      this.generation++;
      // Every plant's cells at every level, nearest first: the near ones are where a gap would show.
      this.chosen = this.species.flatMap((sp) => (this.shapes.has(shapeKey(sp)) ? sp.band.flatMap((_, level) => cellsNear(this.ecology, sp, level as Level, eye)) : []))
        .sort((a, b) => a.near - b.near).map((c) => c.key);
    }
    for (const e of this.drawn) for (const m of e.meshes) m.visible = false;
    this.drawn = [];
    const wanted: { id: string; request: GenRequest }[] = [];
    const params = this.ecology.terrain.habitat.params;
    for (const key of this.chosen) {
      const id = cellId(key), e = this.cache.get(id);
      if (!e) { wanted.push({ id, request: { kind: 'plants', params, key } }); continue; }
      const [x, y, z] = toView(eye, e.cell.origin);
      if (e.trimmed !== this.generation) this.trim(e, [x, y, z], smallest * RECHOOSE);
      for (const m of e.meshes) { m.position.set(x, y, z); m.visible = (m.geometry as InstancedBufferGeometry).instanceCount > 0; }
      this.cache.mark(e);
      this.drawn.push(e);
    }
    this.cache.want(wanted);
  }

  /**
   * Keep in a cell's buffers only the plants its level may draw from here: those within its band, give or take how far
   * the eye moves before the next choice. The shader still hands each plant over by its exact distance; this only
   * spares the GPU the plants it would fold away anyway.
   */
  private trim(e: Entry, at: [number, number, number], slack: number): void {
    e.trimmed = this.generation;
    const sp = this.species[e.cell.key.species], [lo, , , hi] = sp.band[e.cell.key.level];
    const near = Math.max(0, lo - slack), far = hi + slack;
    for (const s of e.shaped) {
      const out = s.buffer.array as Float32Array;
      let n = 0;
      for (let i = 0; i < s.all.length; i += PLANT_STRIDE) {
        const d = Math.hypot(at[0] + s.all[i], at[1] + s.all[i + 1], at[2] + s.all[i + 2]);
        if (d < near - s.all[i + 3] || d > far + s.all[i + 3]) continue;
        out.set(s.all.subarray(i, i + PLANT_STRIDE), n * PLANT_STRIDE);
        n++;
      }
      s.buffer.needsUpdate = true;
      for (const m of s.meshes) (m.geometry as InstancedBufferGeometry).instanceCount = n;
    }
  }

  private async make(answer: GenAnswer, id: string): Promise<Entry | null> {
    if (!('cell' in answer)) return null;
    const cell = answer.cell, sp = this.species[cell.key.species], shapes = this.shapes.get(shapeKey(sp));
    if (!shapes) return null;
    const band = new Vector4(...sp.band[cell.key.level]);
    const horizon = new Vector2(cell.horizon[0], cell.horizon[1]);
    const meshes: Mesh[] = [], shaped: Shaped[] = [];
    cell.instances.forEach((data, v) => {
      if (!data.length) return;
      const buffer = new InstancedInterleavedBuffer(data.slice(), PLANT_STRIDE);
      const s: Shaped = { all: data, buffer, meshes: [] };
      shaped.push(s);
      for (const part of shapes[cell.key.level][v]) {
        const g = new InstancedBufferGeometry();
        for (const [name, a] of part.attributes) g.setAttribute(name, a);
        g.setIndex(part.index);
        plantInstances(g, buffer);
        g.instanceCount = data.length / PLANT_STRIDE;
        // Everything in the cell: its plants stand within half its diagonal of the origin, as tall as the tallest.
        g.boundingSphere = new Sphere(new Vector3(), sp.cell[cell.key.level] * Math.SQRT1_2 + sp.spec.height[1] * 1.2);
        const m = new Mesh(g, part.material);
        m.name = `plants ${sp.spec.name} ${id}`;
        m.castShadow = part.cast;
        m.visible = false;
        m.userData.band = band;
        // The last level of what it draws, for cover: past its band the tufts sink into the floor.
        m.userData.sink = sp.what === 'cover' && cell.key.level === sp.band.length - 1 ? 1 : 0;
        m.userData.horizon = horizon;
        meshes.push(m);
        s.meshes.push(m);
      }
    });
    for (const m of meshes) await this.stage.prepare(m);
    for (const m of meshes) this.group.add(m);
    return { cell, meshes, shaped, trimmed: -1, bytes: cellBytes(cell) * 2, lastDrawn: 0 };
  }

  dispose(): void {
    this.cache.clear();
    this.group.clear();
  }
}

/** What every plant mesh has: points, normals, sway weights, triangles. */
interface PlantMesh {
  positions: Float32Array;
  normals: Float32Array;
  wind: Float32Array;
  index: Uint32Array;
}

/** A mesh as a part: its points, normals and sway weights, its own further attributes (name, array, size), its material. */
function partOf(m: PlantMesh, more: [string, Float32Array, number][], material: Material, cast: boolean): Part {
  const all: [string, Float32Array, number][] = [['position', m.positions, 3], ['normal', m.normals, 3], ['wind', m.wind, 1], ...more];
  return { attributes: all.map(([name, a, size]) => [name, new BufferAttribute(a, size)]), index: new BufferAttribute(m.index, 1), material, cast };
}

/** A form's shapes from its built variants: the full and the light tree of each, and one hull. */
function shapesOf(models: { full: TreeModel; lite: TreeModel }[]): Shapes {
  const tree = ({ wood: w, leaves: l }: TreeModel): Part[] => [
    partOf(w, [['uv', w.uvs, 2], ['occ', w.occ, 1]], BARK.material, true),
    partOf(l, [['uv', l.uvs, 2], ['tint', l.tint, 1], ['occ', l.occ, 1]], LEAF.material, true),
  ];
  const h = models[0].full.hull;
  const hull = partOf(h, [['color', h.colors, 3], ['kind', h.kinds, 1]], HULL.material, true);
  return [models.map((m) => tree(m.full)), models.map((m) => tree(m.lite)), [[hull]]];
}

/** A cover form's shapes from its built variants: the full and the light tuft of each (they cast no shadows). */
function tuftShapes(tufts: TuftModel[]): Shapes {
  return [0, 1].map((level) => tufts.map((t) => [partOf(level ? t.lite : t.full, [['color', (level ? t.lite : t.full).colors, 3]], GRASS.material, false)]));
}

/** Stones of a debris spec: the full and the light stone of each variant, and one far stone. */
function stoneShapes(stones: StoneModel[]): Shapes {
  const stone = (m: StoneMesh): Part => ({ attributes: [['position', new BufferAttribute(m.positions, 3)], ['normal', new BufferAttribute(m.normals, 3)], ['color', new BufferAttribute(m.colors, 3)]], index: new BufferAttribute(m.index, 1), material: STONE.material, cast: true });
  return [stones.map((s) => [stone(s.full)]), stones.map((s) => [stone(s.lite)]), [[stone(stones[0].hull)]]];
}

/** Fallen trunks or branches: the full and the light piece of each variant, and one far piece, all in bark. */
function fallenShapes(pieces: FallenWood[]): Shapes {
  const wood = (w: FallenWood['full']): Part[] => [partOf(w, [['uv', w.uvs, 2], ['occ', w.occ, 1]], BARK.material, true)];
  return [pieces.map((p) => wood(p.full)), pieces.map((p) => wood(p.lite)), [wood(pieces[0].hull)]];
}

/** Which shapes a species draws: a plant's or a cover's form; a debris spec's own (its stones are its own colour). */
const shapeKey = (sp: Species): string => (sp.what === 'debris' ? `debris:${sp.spec.name}` : sp.spec.form);
