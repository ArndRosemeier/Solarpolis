/**
 * Who the people are. For now the player: a seeded adult human (the same seed, the same person) in plain, light
 * clothes. The setting's own fashion (and the common augmentations) come later as wardrobe and colour rules on top.
 * Adapted from Dunfinity src/render/actors/looks.ts (`personOfToday`).
 */
import { outfitGarments, randomConfig, seededRandom, type CharacterPatch } from '@actors/generator';
import { humanCatalog } from './pack';

/** Plain outfits (Actors' presets) that would not look odd in a park a thousand years on. */
const PLAIN = ['casual', 'sport', 'layers', 'shift-dress', 'polo'] as const;
/** Light, quiet colours (sRGB). */
const QUIET = ['#e6e1d6', '#d2bd98', '#8b8e93', '#5b6470', '#3566a8', '#2f6b45', '#a8b8c0', '#c9a27e'];

/** The player's look from a seed: body, face and hair, dressed plainly. */
export async function playerLook(seed: number): Promise<CharacterPatch> {
  const { catalog, base } = await humanCatalog();
  const random = seededRandom(seed);
  const look = randomConfig(catalog, base, { random, outfit: false });
  const presets = catalog.outfits.filter((p) => (PLAIN as readonly string[]).includes(p.id));
  const preset = presets.length ? presets[Math.floor(random() * presets.length)] : catalog.outfits[0];
  const outfit = outfitGarments(preset, look.body);
  const garmentColors: Record<string, string> = { ...preset.colors };
  for (const g of outfit) if (random() < 0.6) garmentColors[g] = QUIET[Math.floor(random() * QUIET.length)];
  return { ...look, outfit, garmentColors, anatomy: false, detail: 'high', animation: null };
}
