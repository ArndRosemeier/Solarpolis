/**
 * The skies the Understorey's hamlets paint on their ceilings (design "The Understorey: life below the land",
 * 2026-10-22; Arnd chose "skies each hamlet chooses", 17:39). Between the ribs the deck's underside is screen, and
 * each hamlet shows its own sky there the way each district shapes its land: a work with authors, picked here per
 * hamlet from the catalogue by its district's style, seeded. A sky is drawn as one seen infinitely far off (by the
 * direction one looks, render/skyShaders.ts), so it reads as sky and not as a lid 20 m up.
 *
 * Skies are authored, walls are honest: the wellhead keeps its stone round the light well, the one real sky in a
 * hamlet, and the bays outside the hamlets (galleries, cisterns, the Dim) have no sky. The glass deck (the real sky
 * of the land above, Arnd 17:40: "still true in some places") joins the catalogue with its own capture of the land.
 * Pure.
 */
import { deriveSeed, Rng } from '@futuremagic/core';
import type { DistrictStyle, Habitat } from '../blueprint';
import { kept } from './kept';
import { planOf } from './plan';
import { underOf, type Hamlet } from './under';

/**
 * The catalogue, in the order the shader draws them (render/skyShaders.ts `SKY_DRAWN`), with whether a sky keeps its
 * day in step with the land's (most do; a night that never ends is the others' choice).
 */
export const SKIES = [
  { name: 'open', about: 'an old Earth summer sky, blue with drifting cumulus, stars by night', followsDay: true },
  { name: 'aurora', about: 'a polar night, slow curtains of aurora over the stars', followsDay: false },
  { name: 'moon', about: 'the sky from the Moon: black, dense with stars, Earth hanging in it', followsDay: false },
  { name: 'mars', about: 'a Martian day, butterscotch dust, a small pale sun in a blue halo', followsDay: true },
  { name: 'canopy', about: 'up through a forest canopy, leaves in layers, the bright sky in their gaps', followsDay: true },
  { name: 'deep', about: 'up from under the sea, its surface moving and the light in it', followsDay: true },
] as const;
export type SkyName = (typeof SKIES)[number]['name'];

/** How much each district style favours each sky (its hamlets' picks, weighted). */
const FAVOURED: Readonly<Record<DistrictStyle, Partial<Record<SkyName, number>>>> = {
  orchard: { open: 3, canopy: 2, mars: 0.5 },
  water: { deep: 3, aurora: 1.5, open: 1 },
  stone: { moon: 2, aurora: 2, open: 1 },
  grove: { canopy: 3, open: 1 },
  herd: { open: 3, canopy: 1 },
  play: { open: 2, mars: 2, aurora: 1 },
  makers: { moon: 2, mars: 2, aurora: 1 },
  'let-go': { canopy: 2, open: 1, aurora: 1 },
};

/** Each hamlet's sky (an index into `SKIES`), by its court (the hamlets' order): made once and kept. */
export const hamletSkiesOf: (h: Habitat) => readonly number[] = kept((h: Habitat): number[] => {
  const plan = planOf(h);
  return underOf(h).hamlets.map((m: Hamlet) => {
    const style = plan.districts[m.district]?.style ?? 'orchard', liked = FAVOURED[style];
    const rng = new Rng(deriveSeed(h.seed, 'under', 'sky', m.court));
    const pick = rng.weighted(SKIES, (s) => liked[s.name] ?? 0);
    return SKIES.indexOf(pick);
  });
});

/**
 * The sky shown over a bay (an index into `SKIES`), or −1 for none: a hamlet's bays show its sky, but for its
 * wellhead (the real light well's stone) and anything outside a hamlet.
 */
export function skyOverBay(h: Habitat, i: number, j: number): number {
  const u = underOf(h), m = u.hamletOf(i, j);
  if (!m || u.useAt(i, j) === 'well') return -1;
  return hamletSkiesOf(h)[m.court] ?? -1;
}
