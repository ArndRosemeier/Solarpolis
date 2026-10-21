/// <reference lib="webworker" />
/**
 * The generation worker: builds what the pool asks for from the habitat's parameters. Everything it makes is a pure
 * function of those parameters, so any worker gives the same answer.
 */
import { derive, type HabitatParams } from '../blueprint';
import { makeTerrain, type Terrain } from '../gen/terrain';
import { buildTile, makeLayout, type TileKey, type TileLayout, type TileMesh } from '../gen/tiles';

export type GenRequest = { kind: 'tile'; params: HabitatParams; key: TileKey };
export type GenAnswer = { kind: 'tile'; tile: TileMesh } | { error: string };

let cached: { json: string; terrain: Terrain; layout: TileLayout } | null = null;

function terrainFor(params: HabitatParams): { terrain: Terrain; layout: TileLayout } {
  const json = JSON.stringify(params);
  if (cached?.json !== json) {
    const terrain = makeTerrain(derive(params));
    cached = { json, terrain, layout: makeLayout(terrain) };
  }
  return cached;
}

self.onmessage = (e: MessageEvent<GenRequest>) => {
  try {
    const { terrain, layout } = terrainFor(e.data.params);
    const tile = buildTile(terrain, layout, e.data.key);
    const transfer: Transferable[] = [tile.positions.buffer, tile.normals.buffer, tile.colors.buffer, tile.morph.buffer, tile.index.buffer];
    if (tile.water) transfer.push(tile.water.positions.buffer, tile.water.normals.buffer, tile.water.index.buffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ kind: 'tile', tile } satisfies GenAnswer, transfer);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies GenAnswer);
  }
};
