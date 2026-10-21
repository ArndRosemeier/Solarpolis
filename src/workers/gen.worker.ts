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
import { makeSkin, type Skin } from '../gen/skin';
import { buildHullTile, type HullTile, type HullTileKey } from '../gen/hullDetail';

export type GenRequest =
  | { kind: 'tile'; params: HabitatParams; key: TileKey }
  | { kind: 'patch'; params: HabitatParams; theta: number; s: number; size: number; cell: number }
  | { kind: 'plants'; params: HabitatParams; key: CellKey }
  | { kind: 'hull'; params: HabitatParams; key: HullTileKey };
export type GenAnswer =
  | { kind: 'tile'; tile: TileMesh }
  | { kind: 'patch'; patch: GroundPatch }
  | { kind: 'plants'; cell: PlantCell }
  | { kind: 'hull'; hullTile: HullTile }
  | { error: string };

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
    const post = (answer: GenAnswer, transfer: Transferable[]): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
    if (req.kind === 'hull') {
      const tile = buildHullTile(skinFor(req.params), req.key), g = tile.glass, p = tile.parts;
      post({ kind: 'hull', hullTile: tile }, [g.positions, g.normals, g.grid, g.index, p.positions, p.normals, p.colors, p.index].map((a) => a.buffer));
      return;
    }
    const { terrain, ecology, layout, plants } = terrainFor(req.params);
    if (req.kind === 'patch') {
      const patch = buildPatch(terrain, req.theta, req.s, req.size, req.cell);
      post({ kind: 'patch', patch }, [patch.positions.buffer, patch.index.buffer]);
      return;
    }
    if (req.kind === 'plants') {
      const cell = plantCell(ecology, plants, req.key);
      post({ kind: 'plants', cell }, cell.instances.map((a) => a.buffer));
      return;
    }
    const tile = buildTile(ecology, layout, req.key);
    const transfer: Transferable[] = [tile.positions.buffer, tile.normals.buffer, tile.colors.buffer, tile.morph.buffer, tile.horizon.buffer, tile.index.buffer];
    if (tile.water) transfer.push(tile.water.positions.buffer, tile.water.normals.buffer, tile.water.index.buffer);
    post({ kind: 'tile', tile }, transfer);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies GenAnswer);
  }
};
