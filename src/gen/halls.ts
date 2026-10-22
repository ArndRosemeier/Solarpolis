/**
 * The hamlets' halls (design "The Understorey: life below the land", step 4): the ring of bays round each wellhead
 * where neighbourhood life happens. Each hall bay holds one hall:
 *
 *   kitchen  the kitchen hall where people cook for each other: an open hall on posts, long tables, a hearth;
 *   bath     a raised pool under the vaults inside a low wall, a bath house beside it;
 *   shop     a makers' shop: a tall workshop with wide doors (a forge's chimney in a makers' district);
 *   stage    a stage with its back wall and tiers of benches before it;
 *   minds    the room where the hamlet's minds meet people in shells: a round pavilion, its walls lit;
 *   commons  open floor with tables, benches and stalls under canopies.
 *
 * Every hamlet has one minds' room and a stage (more stages in big hamlets), kitchens and baths by its size, shops
 * more in a makers' district and baths more in a water district; the rest are commons. The halls nearest the wellhead
 * come first in a seeded order, so the kitchen, the stage and the minds' room face the square. Pure; worked out per
 * hamlet when first asked.
 */
import { deriveSeed, Rng } from '@futuremagic/core';
import type { DistrictStyle, Habitat } from '../blueprint';
import { kept } from './kept';
import { styleOf } from './homes';
import { baysOfHamlet, underOf, type Hamlet } from './under';

export const HALL_KINDS = ['kitchen', 'bath', 'shop', 'stage', 'minds', 'commons'] as const;
export type HallKind = (typeof HALL_KINDS)[number];

/** Of a hamlet's hall bays: the kitchens', baths' and shops' shares, and how many hall bays to a stage. */
const SHARE = { kitchen: 0.12, bath: 0.08, shop: 0.15 };
const PER_STAGE = 40;
/** What a district's style does to the shares (×). */
const STYLED: Partial<Record<DistrictStyle, Partial<Record<'kitchen' | 'bath' | 'shop', number>>>> = {
  makers: { shop: 2.2 },
  water: { bath: 2.2 },
  orchard: { kitchen: 1.5 },
  'let-go': { shop: 0.5, kitchen: 0.7 },
};

/** Each hamlet's halls: the kind of each of its hall bays, by the bay's key. */
const hallsOf = kept((h: Habitat): ((m: Hamlet) => Map<number, HallKind>) => {
  const made = new Map<number, Map<number, HallKind>>();
  return (m: Hamlet) => {
    let halls = made.get(m.court);
    if (!halls) { halls = layHalls(h, m); made.set(m.court, halls); }
    return halls;
  };
});

function layHalls(h: Habitat, m: Hamlet): Map<number, HallKind> {
  const u = underOf(h), r = Math.ceil(m.hall) + 1, bays: { key: number; d: number; a: number }[] = [];
  for (const { i, j, di, dj } of baysOfHamlet(u, m, r)) if (u.useAt(i, j) === 'hall') bays.push({ key: u.key(i, j), d: Math.hypot(di, dj), a: Math.atan2(dj, di) });
  const rng = new Rng(deriveSeed(h.seed, 'under', 'halls', m.court));
  // Nearest the wellhead first; round each ring from a seeded start.
  const start = rng.range(-Math.PI, Math.PI);
  bays.sort((p, q) => Math.round(p.d) - Math.round(q.d) || ((p.a - start + 4 * Math.PI) % (2 * Math.PI)) - ((q.a - start + 4 * Math.PI) % (2 * Math.PI)));
  const style = STYLED[styleOf(h, m)] ?? {}, n = bays.length;
  const count = (k: 'kitchen' | 'bath' | 'shop'): number => Math.max(1, Math.round(n * SHARE[k] * (style[k] ?? 1)));
  // The first ones face the square: a kitchen, the stage, the minds' room; then the rest of each, mixed, then commons.
  const first: HallKind[] = rng.shuffle(['kitchen', 'stage', 'minds'] as HallKind[]);
  const rest: HallKind[] = [
    ...Array<HallKind>(count('kitchen') - 1).fill('kitchen'),
    ...Array<HallKind>(Math.max(0, Math.round(n / PER_STAGE) - 1)).fill('stage'),
    ...Array<HallKind>(count('bath')).fill('bath'),
    ...Array<HallKind>(count('shop')).fill('shop'),
  ];
  const order = [...first, ...rng.shuffle(rest)];
  const out = new Map<number, HallKind>();
  bays.forEach((b, k) => out.set(b.key, order[k] ?? 'commons'));
  return out;
}

/** The hall in bay (i, j): its kind, or null where the bay is not a hamlet's hall bay. */
export function hallAt(h: Habitat, i: number, j: number): HallKind | null {
  const u = underOf(h);
  if (u.useAt(i, j) !== 'hall') return null;
  const m = u.hamletOf(i, j);
  return m ? hallsOf(h)(m).get(u.key(i, j)) ?? null : null;
}

/** A hamlet's halls of each kind, counted (the debug menu, the tests). */
export function hallCountOf(h: Habitat, m: Hamlet): Record<HallKind, number> {
  const out = Object.fromEntries(HALL_KINDS.map((k) => [k, 0])) as Record<HallKind, number>;
  for (const k of hallsOf(h)(m).values()) out[k]++;
  return out;
}
