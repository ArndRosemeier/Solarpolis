/**
 * Ported from Dunfinity src/render/actors/pack.ts.
 *
 * Where the Actors asset pack is served (vite.config.ts serves and builds it under /actors/,
 * tools/actors/pack.mjs fetches it), and the one place its files are fetched.
 */
import type { Fetcher } from '@actors/core';
import { Character, buildCatalog, defaultConfig, type CharacterCatalog, type CharacterConfig } from '@actors/generator';
import { Human } from '@actors/human';
import { IRIS_PRESETS } from '@actors/three';

/** The human pack's manifest. */
export const HUMAN_PACK = `${import.meta.env?.BASE_URL ?? "/"}actors/human/manifest.json`;

/** Files on their way: asked for twice at once, a file is fetched once. */
const coming = new Map<string, Promise<ArrayBuffer>>();

/**
 * Fetches a pack file; every caller gets its own copy (a runtime may hand buffers on). Nothing is kept once it has
 * arrived: a file asked for again comes from the browser's cache, not from a copy on the heap (CLAUDE.md, rule 12).
 */
export const packFetch: Fetcher = async (url) => {
  let job = coming.get(url);
  if (!job) {
    job = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    coming.set(url, job);
    void job.finally(() => coming.delete(url)).catch(() => undefined);
  }
  return (await job).slice(0);
};

let catalog: Promise<{ catalog: CharacterCatalog; base: CharacterConfig; human: Human }> | undefined;

/**
 * What the pack offers (races, garments, hair, clips...) and the default look, loaded once, with the loaded human
 * (residents' figures share it: `Figure.load`'s `share`). Only what is free to ship without a credit line: garments
 * and hair under CC-BY are left out.
 */
export function humanCatalog(): Promise<{ catalog: CharacterCatalog; base: CharacterConfig; human: Human }> {
  catalog ??= Human.load(HUMAN_PACK, packFetch).then((human) => {
    const all = buildCatalog(human, Object.keys(IRIS_PRESETS));
    const c: CharacterCatalog = { ...all, garments: all.garments.filter((g) => !g.credit), hair: all.hair.filter((h) => !h.credit) };
    return { catalog: c, base: defaultConfig(c), human };
  });
  return catalog;
}

export { Character };
