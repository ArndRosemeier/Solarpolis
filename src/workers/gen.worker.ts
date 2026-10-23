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
import { SITE_PARTS, buildLandmark, landmarksOf } from '../gen/landmarks';
import type { LandmarkLevel } from '../gen/pavilion';
import type { MappedArrays } from '../gen/shapes';
import { buildStairTile, type StairTile } from '../gen/liftStairMesh';
import type { SiteTile } from '../gen/siteTiles';
import { buildUnderTile, type UnderTile } from '../gen/underMesh';
import { specksAt, type Specks } from '../sim/specks';
import type { Role } from '../sim/air';
import { droneDesign, type DroneDesign } from '../gen/drone';
import { densNear, type Den } from '../sim/fauna';
import { herdsNear, type Herd } from '../sim/herds';
import { coatsOf, type CoatAsk, type Coats } from '../gen/coat';
import { birdBody, type BirdBody, type BirdKind } from '../gen/birds';
import { boatDesign, type BoatDesign, type BoatKind } from '../gen/boat';
import { planDay, type Outing } from '../sim/sailing';
import { nestsNear, type Nest } from '../sim/birds';
import { flocksNear, type Flock } from '../sim/flocks';
import type { VoyageRequest } from './voyage';
import type { VoyagePlan } from '../space/voyage';

/** The built things that stream in tiles. */
export type TiledPart = 'stair' | 'under' | keyof typeof SITE_PARTS;

export type GenRequest =
  | VoyageRequest
  | { kind: 'tile'; params: HabitatParams; key: TileKey }
  /** The ground for the physics around (θ, s); `below`: the Understorey's floor and pillars there as well. */
  | { kind: 'patch'; params: HabitatParams; theta: number; s: number; size: number; cell: number; below?: boolean }
  | { kind: 'plants'; params: HabitatParams; key: CellKey }
  | { kind: 'tree'; params: HabitatParams; form: PlantForm; variant: number }
  | { kind: 'tuft'; params: HabitatParams; form: CoverForm; color: Rgb; variant: number }
  | { kind: 'stone'; params: HabitatParams; color: Rgb; moss: number; variant: number }
  | { kind: 'fallen'; params: HabitatParams; form: PlantForm; piece: 'log' | 'branch'; variant: number }
  | { kind: 'foliage'; params: HabitatParams }
  | { kind: 'floor'; params: HabitatParams; layer: number }
  | { kind: 'hull'; params: HabitatParams; part: string; key: DetailKey }
  | { kind: 'landmark'; params: HabitatParams; index: number; level: LandmarkLevel }
  /** A tile of a built thing that streams in tiles (render/tiled.ts): the Lift Stair, the entrance courts, the river crossings, the grown halls, the Understorey. */
  | { kind: 'tiled'; part: TiledPart; params: HabitatParams; key: DetailKey }
  /** Everyone up on the land at clock time t, for the far view (render/specks.ts). */
  | { kind: 'specks'; params: HabitatParams; t: number }
  /** One of a role's drone designs (gen/drone.ts), both levels. */
  | { kind: 'drone'; params: HabitatParams; role: Role; index: number }
  /** The squirrels whose trees stand within `radius` m of (θ, s) (sim/fauna.ts). */
  | { kind: 'squirrels'; params: HabitatParams; theta: number; s: number; radius: number }
  /** The deer herds whose homes lie within `radius` m of (θ, s), with their places (sim/herds.ts). */
  | { kind: 'herds'; params: HabitatParams; theta: number; s: number; radius: number }
  /** An Actors animal pack's coats, one per look, baked per vertex (gen/coat.ts). */
  | { kind: 'coats'; ask: CoatAsk }
  /** The birds whose homes lie within `radius` m of (θ, s) (sim/birds.ts). */
  | { kind: 'birds'; params: HabitatParams; theta: number; s: number; radius: number }
  /** The flocks whose birds may come within `radius` m of (θ, s) (sim/flocks.ts). */
  | { kind: 'flocks'; params: HabitatParams; theta: number; s: number; radius: number }
  /** A bird species' body at both levels (gen/birds.ts). */
  | { kind: 'bird'; bird: BirdKind }
  /** A boat design, both levels and its wake (gen/boat.ts). */
  | { kind: 'boat'; boat: BoatKind }
  /** Every boat's sailing on a day, planned ahead (sim/sailing.ts `planDay`). */
  | { kind: 'sailing'; params: HabitatParams; day: number };
export type GenAnswer =
  | { kind: 'voyage'; plan: VoyagePlan }
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
  | { kind: 'tiled'; part: TiledPart; built: StairTile | SiteTile | UnderTile }
  | { kind: 'specks'; specks: Specks }
  | { kind: 'drone'; design: DroneDesign }
  /** The homes animals live from round a point: squirrels' trees, deer herds' ranges. */
  | { kind: 'squirrels'; homes: Den[] }
  | { kind: 'herds'; homes: Herd[] }
  | { kind: 'coats'; coats: Coats }
  | { kind: 'birds'; nests: Nest[] }
  | { kind: 'flocks'; flocks: Flock[] }
  | { kind: 'bird'; body: BirdBody }
  | { kind: 'boat'; design: BoatDesign }
  | { kind: 'sailing'; day: number; outings: (Outing | null)[] }
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

/** The habitat alone, for jobs that need no terrain (the sailing: its plan and wind are kept per habitat). */
let derived: { json: string; habitat: Habitat } | null = null;
function habitatFor(params: HabitatParams): Habitat {
  const json = JSON.stringify(params);
  if (derived?.json !== json) derived = { json, habitat: derive(params) };
  return derived.habitat;
}

self.onmessage = async (e: MessageEvent<GenRequest>) => {
  try {
    const req = e.data;
    const post = (answer: GenAnswer, transfer: Transferable[] = buffers(answer)): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
    if (req.kind === 'voyage') {
      const { buildVoyage } = await import('./voyage');
      post({ kind: 'voyage', plan: await buildVoyage(req) });
      return;
    }
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
    if (req.kind === 'drone') {
      post({ kind: 'drone', design: droneDesign(derive(req.params), req.role, req.index) });
      return;
    }
    if (req.kind === 'bird') {
      post({ kind: 'bird', body: birdBody(req.bird) });
      return;
    }
    if (req.kind === 'boat') {
      post({ kind: 'boat', design: boatDesign(req.boat) });
      return;
    }
    if (req.kind === 'sailing') {
      post({ kind: 'sailing', day: req.day, outings: planDay(habitatFor(req.params), req.day) });
      return;
    }
    if (req.kind === 'coats') {
      // The pack's files come over the network (from the browser's cache once the figures have loaded them).
      void coatsOf(req.ask, async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); })
        .then((coats) => post({ kind: 'coats', coats }), (err: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies GenAnswer));
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
      post({ kind: 'patch', patch: buildPatch(terrain, req.theta, req.s, req.size, req.cell, req.below, { ecology, plants }) });
      return;
    }
    if (req.kind === 'landmark') {
      const l = landmarksOf(terrain)[req.index];
      if (!l) throw new Error(`no landmark ${req.index}`);
      post({ kind: 'landmark', index: req.index, level: req.level, mesh: buildLandmark(l, req.level).mappedArrays() });
      return;
    }
    if (req.kind === 'tiled') {
      const p = req.part;
      post({ kind: 'tiled', part: p, built: p === 'stair' ? buildStairTile(terrain.habitat, req.key) : p === 'under' ? buildUnderTile(terrain, req.key) : SITE_PARTS[p].buildTile(terrain, req.key) });
      return;
    }
    if (req.kind === 'squirrels') {
      post({ kind: 'squirrels', homes: densNear(ecology, plants, req.theta, req.s, req.radius) });
      return;
    }
    if (req.kind === 'birds') {
      post({ kind: 'birds', nests: nestsNear(ecology, plants, req.theta, req.s, req.radius) });
      return;
    }
    if (req.kind === 'flocks') {
      // Copies of the swallows' ground grids go: the flocks are kept here for the next ask.
      post({ kind: 'flocks', flocks: flocksNear(ecology, plants, req.theta, req.s, req.radius).map((f) => ({ ...f, floor: f.floor && f.floor.slice() })) });
      return;
    }
    if (req.kind === 'herds') {
      post({ kind: 'herds', homes: herdsNear(ecology, req.theta, req.s, req.radius) });
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
