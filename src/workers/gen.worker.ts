/// <reference lib="webworker" />
/**
 * The generation worker: builds what the pool asks for from the habitat's parameters. Everything it makes is a pure
 * function of those parameters, so any worker gives the same answer.
 */
import { derive, type Habitat, type HabitatParams } from '../blueprint';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { makeEcology, type Ecology } from '../gen/ecology';
import { buildPatch, type GroundPatch } from '../gen/patch';
import { buildTile, makeLayout, type TileKey, type TileLayout, type TileMesh } from '../gen/tiles';
import { plantCell, plantsOf, type CellKey, type PlantCell, type Species } from '../gen/scatter';
import { buildFallenWood, buildTree, LITE_DETAIL, type FallenWood, type TreeModel } from '../gen/trees';
import { buildStone, type StoneModel } from '../gen/stones';
import { barkAtlas, type BarkAtlas } from '../gen/foliage';
import type { CoverForm, PlantForm, Rgb } from '../blueprint';
import { buildTuft, type TuftModel } from '../gen/grass';
import { leafAtlas, leafMeans } from './leaves';
import { groundLayer } from '../gen/groundTex';
import { makeSkin, type Skin } from '../gen/skin';
import { buildPartTile, detailParts, type DetailPart, type PartTile } from '../gen/hullParts';
import type { TileKey as DetailKey } from '../gen/detailTree';
import { buildLandmark, landmarksOf } from '../gen/landmarks';
import type { LandmarkLevel } from '../gen/pavilion';
import type { MappedArrays } from '../gen/shapes';
import { buildStairTile, type StairTile } from '../gen/liftStairMesh';
import { courtSites } from '../gen/courts';
import { crossingSites } from '../gen/crossings';
import { hallSites } from '../gen/grownHall';
import type { SiteTile } from '../gen/siteTiles';
import { specksAt, type Specks } from '../sim/specks';

/** The built things that stream in tiles. */
export type TiledPart = 'stair' | 'courts' | 'crossings' | 'halls';

export type GenRequest =
  | { kind: 'tile'; params: HabitatParams; key: TileKey }
  | { kind: 'patch'; params: HabitatParams; theta: number; s: number; size: number; cell: number }
  | { kind: 'plants'; params: HabitatParams; key: CellKey }
  | { kind: 'tree'; params: HabitatParams; form: PlantForm; variant: number }
  | { kind: 'tuft'; params: HabitatParams; form: CoverForm; color: Rgb; variant: number }
  | { kind: 'stone'; params: HabitatParams; color: Rgb; moss: number; variant: number }
  | { kind: 'fallen'; params: HabitatParams; form: PlantForm; piece: 'log' | 'branch'; variant: number }
  | { kind: 'foliage'; params: HabitatParams }
  | { kind: 'floor'; params: HabitatParams; layer: number }
  | { kind: 'hull'; params: HabitatParams; part: string; key: DetailKey }
  | { kind: 'landmark'; params: HabitatParams; index: number; level: LandmarkLevel }
  /** A tile of a built thing that streams in tiles (render/tiled.ts): the Lift Stair, the entrance courts, the river crossings, the grown halls. */
  | { kind: 'tiled'; part: TiledPart; params: HabitatParams; key: DetailKey }
  /** Everyone up on the land at clock time t, for the far view (render/specks.ts). */
  | { kind: 'specks'; params: HabitatParams; t: number };
export type GenAnswer =
  | { kind: 'tile'; tile: TileMesh }
  | { kind: 'patch'; patch: GroundPatch }
  | { kind: 'plants'; cell: PlantCell }
  | { kind: 'tree'; full: TreeModel; lite: TreeModel }
  | { kind: 'tuft'; tuft: TuftModel }
  | { kind: 'stone'; stone: StoneModel }
  | { kind: 'fallen'; fallen: FallenWood }
  | { kind: 'foliage'; bark: BarkAtlas; leaves: Uint8Array; leafMeans: Float32Array }
  | { kind: 'floor'; layer: number; albedo: Uint8Array; relief: Uint8Array; mean: [number, number, number] }
  | { kind: 'hull'; partTile: PartTile }
  | { kind: 'landmark'; index: number; level: LandmarkLevel; mesh: MappedArrays }
  | { kind: 'tiled'; part: TiledPart; built: StairTile | SiteTile }
  | { kind: 'specks'; specks: Specks }
  | { error: string };

/** Every typed array's buffer in an answer, to transfer rather than copy. */
function buffers(o: unknown, out: Transferable[] = []): Transferable[] {
  if (ArrayBuffer.isView(o)) { if (!out.includes(o.buffer as ArrayBuffer)) out.push(o.buffer as ArrayBuffer); } else if (o && typeof o === 'object') for (const v of Object.values(o)) buffers(v, out);
  return out;
}

/** The hull's parts need only the blueprint, not the terrain: hull tiles never wait for the interior to be made. */
let hullCached: { json: string; habitat: Habitat; skin: Skin; parts: Map<string, DetailPart> } | null = null;
function hullFor(params: HabitatParams): NonNullable<typeof hullCached> {
  const json = JSON.stringify(params);
  if (hullCached?.json !== json) {
    const habitat = derive(params), skin = makeSkin(habitat);
    hullCached = { json, habitat, skin, parts: new Map(detailParts(habitat, skin).map((p) => [p.id, p])) };
  }
  return hullCached;
}

let cached: { json: string; terrain: Terrain; ecology: Ecology; layout: TileLayout; plants: Species[] } | null = null;

function terrainFor(params: HabitatParams): { terrain: Terrain; ecology: Ecology; layout: TileLayout; plants: Species[] } {
  const json = JSON.stringify(params);
  if (cached?.json !== json) {
    const terrain = makeTerrain(derive(params));
    const ecology = makeEcology(terrain);
    cached = { json, terrain, ecology, layout: makeLayout(terrain), plants: plantsOf(ecology) };
  }
  return cached;
}

self.onmessage = (e: MessageEvent<GenRequest>) => {
  try {
    const req = e.data;
    const post = (answer: GenAnswer, transfer: Transferable[] = buffers(answer)): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
    if (req.kind === 'foliage') {
      const leaves = leafAtlas();
      post({ kind: 'foliage', bark: barkAtlas(), leaves, leafMeans: leafMeans(leaves) });
      return;
    }
    if (req.kind === 'floor') {
      const l = groundLayer(req.layer);
      post({ kind: 'floor', layer: req.layer, albedo: l.albedo, relief: l.normal, mean: l.mean });
      return;
    }
    if (req.kind === 'tree') {
      const seed = derive(req.params).seed;
      post({ kind: 'tree', full: buildTree(req.form, seed, req.variant), lite: buildTree(req.form, seed, req.variant, LITE_DETAIL) });
      return;
    }
    if (req.kind === 'tuft') {
      post({ kind: 'tuft', tuft: buildTuft(req.form, req.color, derive(req.params).seed, req.variant) });
      return;
    }
    if (req.kind === 'stone') {
      post({ kind: 'stone', stone: buildStone(req.color, req.moss, derive(req.params).seed, req.variant) });
      return;
    }
    if (req.kind === 'fallen') {
      post({ kind: 'fallen', fallen: buildFallenWood(req.form, req.piece, derive(req.params).seed, req.variant) });
      return;
    }
    if (req.kind === 'hull') {
      const { habitat, skin, parts } = hullFor(req.params), part = parts.get(req.part);
      if (!part) throw new Error(`no hull part ${req.part}`);
      post({ kind: 'hull', partTile: buildPartTile(habitat, skin, part, req.key) });
      return;
    }
    const { terrain, ecology, layout, plants } = terrainFor(req.params);
    if (req.kind === 'patch') {
      post({ kind: 'patch', patch: buildPatch(terrain, req.theta, req.s, req.size, req.cell) });
      return;
    }
    if (req.kind === 'landmark') {
      const l = landmarksOf(terrain)[req.index];
      if (!l) throw new Error(`no landmark ${req.index}`);
      post({ kind: 'landmark', index: req.index, level: req.level, mesh: buildLandmark(l, req.level).mappedArrays() });
      return;
    }
    if (req.kind === 'tiled') {
      post({ kind: 'tiled', part: req.part, built: req.part === 'stair' ? buildStairTile(terrain.habitat, req.key) : { courts: courtSites, crossings: crossingSites, halls: hallSites }[req.part].buildTile(terrain, req.key) });
      return;
    }
    if (req.kind === 'specks') {
      post({ kind: 'specks', specks: specksAt(terrain, req.t) });
      return;
    }
    if (req.kind === 'plants') {
      post({ kind: 'plants', cell: plantCell(ecology, plants, req.key) });
      return;
    }
    post({ kind: 'tile', tile: buildTile(ecology, layout, req.key) });
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies GenAnswer);
  }
};
