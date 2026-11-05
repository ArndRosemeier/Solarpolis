/**
 * Ported from Dunfinity src/render/actors/pack.ts.
 *
 * Where the Actors asset pack is served (vite.config.ts serves and builds it under /actors/,
 * tools/actors/pack.mjs fetches it), and the one place its files are fetched.
 */
import type { Fetcher } from '@actors/core';
import { Character, allowCatalog, buildCatalog, defaultConfig, filterCatalog, type AllowOptions, type CharacterCatalog, type CharacterConfig, type ThemeFilter } from '@actors/generator';
import { Human } from '@actors/human';
import { IRIS_PRESETS, type ActorMaterialKit } from '@actors/three';
import { nodeMaterials } from '@actors/three/webgpu';
import { loadGate } from '../loadGate';
import { logged } from '../loadLog';

/** The human pack's manifest. */
export const HUMAN_PACK = `${import.meta.env?.BASE_URL ?? "/"}actors/human/manifest.json`;

/** A pack's base file (its body and rig), the one costly to read. */
const PACK_BASE = /\/base\.bin(\?|$)/;

/** Files on their way: asked for twice at once, a file is fetched once. */
const coming = new Map<string, Promise<ArrayBuffer>>();

/**
 * Fetches a pack file; every caller gets its own copy (a runtime may hand buffers on). Nothing is kept once it has
 * arrived: a file asked for again comes from the browser's cache, not from a copy on the heap (CLAUDE.md, rule 12).
 * While a cinematic plays a pack's base (its body, 4 to 5 MB, read at once: about 250 ms on the render PC) is handed
 * over at the next cut (`loadGate`); the smaller files (garments, hair, clips) come as they arrive, so a figure is
 * never kept waiting for cuts file by file.
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
  const bytes = await job;
  if (PACK_BASE.test(url)) await loadGate.wait();
  return bytes.slice(0);
};

let catalog: Promise<{ catalog: CharacterCatalog; base: CharacterConfig; human: Human }> | undefined;

/**
 * What people of 3026 are, by Actors' `allow` (Arnd, 2026-11-05: "restrict it to humans and robots"): humans, and robots
 * (the shells some live in); no elves or other races of fantasy, no skeletons. Residents and the player alike.
 */
export const PEOPLE_3026: AllowOptions = { races: ['human', 'robot'] };

/**
 * What residents of 3026 wear and look like, by Actors' theme tags: today's clothes and older cuts, the Commonwear of
 * the future, the kimono; nothing medieval, antique or fantastic (no leaf hair), and no real-world faith's signs. Only
 * for residents: the player may wear anything (Arnd, 2026-11-05: "the full clothing palette is only for the main
 * character").
 */
export const THEMES_3026: ThemeFilter = { themes: ['modern', 'vintage', 'future', 'eastern'], without: ['real-faith'] };

/** Only what is free to ship without a credit line: garments and hair under CC-BY are left out. */
export function freeToShip(catalog: CharacterCatalog): CharacterCatalog {
  return { ...catalog, garments: catalog.garments.filter((g) => !g.credit), hair: catalog.hair.filter((h) => !h.credit) };
}

/** The pack's catalog as residents draw from it: humans and robots (`PEOPLE_3026`) in what fits `THEMES_3026`, free to ship. */
export function residentsCatalog(human: Human): CharacterCatalog {
  return freeToShip(allowCatalog(filterCatalog(buildCatalog(human, Object.keys(IRIS_PRESETS)), THEMES_3026), PEOPLE_3026));
}

/**
 * What the player may make of themselves in the creator (app/creator.ts), as `Figure.load` options: humans and robots
 * (`PEOPLE_3026`) in every clothing category Actors has, medieval and fantastic too, free to ship.
 */
export const PLAYER_OFFER = { allow: PEOPLE_3026, catalog: freeToShip } as const;

/**
 * What the pack offers residents (`residentsCatalog`) and the default look, loaded once, with the loaded human
 * (residents' figures share it: `Figure.load`'s `share`).
 */
export function humanCatalog(): Promise<{ catalog: CharacterCatalog; base: CharacterConfig; human: Human }> {
  catalog ??= logged('human pack', () => Human.load(HUMAN_PACK, packFetch)).then((human) => {
    const c = residentsCatalog(human);
    return { catalog: c, base: defaultConfig(c), human };
  });
  return catalog;
}

/** Actors' shared WebGPU graphs (its screen garments share `screenTextures`, screens.ts, through each figure). */
export const actorKit: ActorMaterialKit = nodeMaterials;

export { Character };
