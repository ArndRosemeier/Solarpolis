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

export type GenRequest =
  | { kind: 'tile'; params: HabitatParams; key: TileKey }
  | { kind: 'patch'; params: HabitatParams; theta: number; s: number; size: number; cell: number };
export type GenAnswer = { kind: 'tile'; tile: TileMesh } | { kind: 'patch'; patch: GroundPatch } | { error: string };

let cached: { json: string; terrain: Terrain; ecology: Ecology; layout: TileLayout } | null = null;

function terrainFor(params: HabitatParams): { terrain: Terrain; ecology: Ecology; layout: TileLayout } {
  const json = JSON.stringify(params);
  if (cached?.json !== json) {
    const terrain = makeTerrain(derive(params));
    cached = { json, terrain, ecology: makeEcology(terrain), layout: makeLayout(terrain) };
  }
  return cached;
}

self.onmessage = (e: MessageEvent<GenRequest>) => {
  try {
    const req = e.data;
    const { terrain, ecology, layout } = terrainFor(req.params);
    const post = (answer: GenAnswer, transfer: Transferable[]): void => (self as unknown as DedicatedWorkerGlobalScope).postMessage(answer, transfer);
    if (req.kind === 'patch') {
      const patch = buildPatch(terrain, req.theta, req.s, req.size, req.cell);
      post({ kind: 'patch', patch }, [patch.positions.buffer, patch.index.buffer]);
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
