/// <reference lib="webworker" />
/**
 * The generation worker: builds what the pool asks for from the habitat's parameters. Everything it makes is a pure
 * function of those parameters, so any worker gives the same answer.
 */
import { derive, type HabitatParams } from '../blueprint';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { makeEcology, type Ecology } from '../gen/ecology';
import { buildPatch, type GroundPatch } from '../gen/patch';
import { buildTile, makeLayout, type TileKey, type TileLayout, type TileMesh } from '../gen/tiles';
import { plantCell, plantsOf, type CellKey, type PlantCell, type Species } from '../gen/scatter';
import { buildTree, LITE_DETAIL, type TreeModel } from '../gen/trees';
import { barkAtlas, type BarkAtlas } from '../gen/foliage';
import type { PlantForm } from '../blueprint';
import { leafAtlas } from './leaves';
import { groundLayer } from '../gen/groundTex';
import { makeSkin, type Skin } from '../gen/skin';
import { buildHullTile, type HullTile, type HullTileKey } from '../gen/hullDetail';

export type GenRequest =
  | { kind: 'tile'; params: HabitatParams; key: TileKey }
  | { kind: 'patch'; params: HabitatParams; theta: number; s: number; size: number; cell: number }
  | { kind: 'plants'; params: HabitatParams; key: CellKey }
  | { kind: 'tree'; params: HabitatParams; form: PlantForm; variant: number }
  | { kind: 'foliage'; params: HabitatParams }
  | { kind: 'floor'; params: HabitatParams; layer: number }
  | { kind: 'hull'; params: HabitatParams; key: HullTileKey };
export type GenAnswer =
  | { kind: 'tile'; tile: TileMesh }
  | { kind: 'patch'; patch: GroundPatch }
  | { kind: 'plants'; cell: PlantCell }
  | { kind: 'tree'; full: TreeModel; lite: TreeModel }
  | { kind: 'foliage'; bark: BarkAtlas; leaves: Uint8Array }
  | { kind: 'floor'; layer: number; albedo: Uint8Array; relief: Uint8Array; mean: [number, number, number] }
  | { kind: 'hull'; hullTile: HullTile }
  | { error: string };

/** Every typed array's buffer in an answer, to transfer rather than copy. */
function buffers(o: unknown, out: Transferable[] = []): Transferable[] {
  if (ArrayBuffer.isView(o)) { if (!out.includes(o.buffer as ArrayBuffer)) out.push(o.buffer as ArrayBuffer); } else if (o && typeof o === 'object') for (const v of Object.values(o)) buffers(v, out);
  return out;
}

/** The skin needs only the blueprint, not the terrain: hull tiles never wait for the interior to be made. */
let skinCached: { json: string; skin: Skin } | null = null;
function skinFor(params: HabitatParams): Skin {
  const json = JSON.stringify(params);
  if (skinCached?.json !== json) skinCached = { json, skin: makeSkin(derive(params)) };
  return skinCached.skin;
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
      post({ kind: 'foliage', bark: barkAtlas(), leaves: leafAtlas() });
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
    if (req.kind === 'hull') {
      post({ kind: 'hull', hullTile: buildHullTile(skinFor(req.params), req.key) });
      return;
    }
    const { terrain, ecology, layout, plants } = terrainFor(req.params);
    if (req.kind === 'patch') {
      post({ kind: 'patch', patch: buildPatch(terrain, req.theta, req.s, req.size, req.cell) });
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
