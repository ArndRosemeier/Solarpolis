/**
 * How a resident talks (design "Speech bubbles: how people talk in Solarpolis", 2026-10-23): their name, their
 * temperament and what they care about. In a world where nobody works to live, "what do you do?" means "what do you
 * care about?", so a resident's pursuits come from the land round their home: the style of their district (orchards,
 * makers' benches, wood pasture …) and the places their court's people go (the lake, the hills, the commons), with a
 * few that anyone may care for (letters across the light-lag, the ships at the dock). A drone person likes to fly.
 *
 * The same resident every time, from the habitat's seed: pure. What they say is the conversation layer's (src/talk);
 * this is only who they are.
 */
import { deriveSeed, hash3i, hashToFloat } from '@futuremagic/core';
import type { DistrictStyle, Habitat } from '../blueprint';
import { kept } from '../gen/kept';
import { planOf } from '../gen/plan';
import { residentOf } from './population';
import { venuesOf, type Activity } from './venues';

export const TEMPERAMENTS = ['warm', 'reserved', 'curious', 'dry', 'lively'] as const;
export type Temperament = (typeof TEMPERAMENTS)[number];

/** What draws someone to a pursuit: the styles of district it grows in, the activities of the places that lead to it. */
interface PursuitTie {
  styles: readonly DistrictStyle[];
  acts: readonly Activity[];
  /** Anyone may care for it, wherever they live (a weight of its own). */
  anyone?: number;
}

/** The pursuits residents care about, by id (the conversation layer has their words). */
export const PURSUITS = {
  orchard_keeping: { styles: ['orchard'], acts: ['picnic'] },
  cooking: { styles: ['orchard'], acts: ['picnic'], anyone: 0.5 },
  hiking: { styles: ['let-go'], acts: ['hike', 'climb'] },
  music: { styles: ['play'], acts: ['gather'], anyone: 0.6 },
  dancing: { styles: ['play'], acts: ['gather'] },
  games: { styles: ['play'], acts: ['play'] },
  stargazing: { styles: [], acts: ['stargaze'] },
  swimming: { styles: ['water'], acts: ['swim', 'bathe'] },
  water_gardens: { styles: ['water'], acts: [] },
  woodwork: { styles: ['makers'], acts: ['make'] },
  pottery: { styles: ['makers', 'stone'], acts: ['make'] },
  stonework: { styles: ['stone'], acts: [] },
  meadow_tending: { styles: ['play', 'orchard'], acts: ['wander'] },
  grown_halls: { styles: ['grove'], acts: [] },
  wood_pasture: { styles: ['herd'], acts: ['herd'] },
  wild_things: { styles: ['let-go', 'grove', 'herd'], acts: ['wander', 'stroll'] },
  painting: { styles: ['stone', 'water'], acts: ['watch'], anyone: 0.4 },
  sunwalk: { styles: [], acts: ['sunwalk', 'stroll'] },
  letters: { styles: [], acts: [], anyone: 1 },
  ships: { styles: [], acts: [], anyone: 0.7 },
  history: { styles: [], acts: [], anyone: 0.5 },
  flying: { styles: [], acts: ['fly'] },
} as const satisfies Record<string, PursuitTie>;
export type Pursuit = keyof typeof PURSUITS;
const PURSUIT_IDS = Object.keys(PURSUITS) as Pursuit[];

/**
 * Given names, from many of Earth's traditions: a thousand years of moving between habitats mixed them all, and every
 * naming tradition still descends from Earth (world bible, part VIII). Short, so a bubble's name line stays short.
 */
const NAMES = [
  'Ada', 'Aiko', 'Amara', 'Anouk', 'Arjun', 'Asha', 'Astrid', 'Aurelio', 'Ayo', 'Bao', 'Beatriz', 'Bram', 'Calla', 'Cato',
  'Chiara', 'Dara', 'Dawit', 'Desta', 'Elif', 'Elio', 'Emeka', 'Esme', 'Ezra', 'Farah', 'Femi', 'Freya', 'Gael', 'Greta',
  'Hana', 'Haruto', 'Ines', 'Ilya', 'Imani', 'Iona', 'Isak', 'Ivo', 'Jalen', 'Jun', 'Kai', 'Kalani', 'Kavya', 'Kenji',
  'Kiri', 'Lale', 'Lars', 'Leilani', 'Lin', 'Lior', 'Luca', 'Lumi', 'Mae', 'Malik', 'Mara', 'Mateo', 'Mei', 'Mika', 'Mira',
  'Nadia', 'Nalu', 'Nia', 'Niko', 'Noor', 'Odile', 'Oren', 'Oskar', 'Paz', 'Priya', 'Quinn', 'Rafa', 'Rania', 'Ravi',
  'Rhea', 'Rio', 'Rosa', 'Rumi', 'Saba', 'Sami', 'Sana', 'Selin', 'Sena', 'Seo', 'Siddh', 'Sol', 'Suri', 'Taiwo', 'Tal',
  'Tamsin', 'Teo', 'Thandi', 'Tove', 'Uma', 'Una', 'Vale', 'Vida', 'Wen', 'Wren', 'Xin', 'Yara', 'Yuki', 'Zade', 'Zara',
  'Zeno', 'Zola', 'Abel', 'Adaeze', 'Alon', 'Anahí', 'Bea', 'Chidi', 'Dov', 'Eira', 'Fen', 'Halvard', 'Inti', 'Joon',
  'Kofi', 'Lev', 'Maku', 'Nell', 'Oda', 'Pilar', 'Ren', 'Sigrun', 'Tomas', 'Ulla', 'Vesna', 'Yohannes', 'Zhen', 'Amaru',
  'Briar', 'Cyrus', 'Darya', 'Eitan', 'Fumiko', 'Gita', 'Henrik', 'Ilse', 'Juno', 'Keoni', 'Lucía', 'Mattias', 'Nour',
] as const;

/** Who a resident is when they talk. */
export interface Voice {
  name: string;
  temperament: Temperament;
  /** One to three, the dearest first. */
  pursuits: Pursuit[];
}

/** How many pursuits someone has: the shares of one, two and three. */
const HOW_MANY = [0.3, 0.5, 0.2];
/** How strongly the home district's style, the court's places and the body (a drone's flying) pull a pursuit. */
const PULL = { style: 3, act: 2, body: 12 };

/** Each court's district style and the activities of the places its people go to (counted by their pull). */
const homesOf = kept((h: Habitat) => {
  const plan = planOf(h), v = venuesOf(h);
  return v.courts.map((site, c) => {
    const acts = new Map<Activity, number>();
    for (const k of v.byCourt[c]) { const x = v.venues[k]; acts.set(x.activity, (acts.get(x.activity) ?? 0) + Math.max(x.pull, 0.1)); }
    const most = Math.max(1e-9, ...acts.values());
    return { style: site.district >= 0 ? plan.districts[site.district]?.style ?? null : null, acts: new Map([...acts].map(([a, w]) => [a, w / most])) };
  });
});

const voiceSeed = kept((h: Habitat) => deriveSeed(h.seed, 'life', 'voice'));

/** Resident i's voice: the same every time. */
export function voiceOf(h: Habitat, i: number): Voice {
  const who = residentOf(h, i), seed = voiceSeed(h), voiceRoll = (k: number): number => hashToFloat(hash3i(seed, i, k, 0));
  const home = homesOf(h)[who.home] ?? { style: null, acts: new Map<Activity, number>() };
  const weights = PURSUIT_IDS.map((id) => {
    const tie: PursuitTie = PURSUITS[id];
    let w = tie.anyone ?? 0;
    if (home.style && tie.styles.includes(home.style)) w += PULL.style;
    for (const a of tie.acts) w += PULL.act * (home.acts.get(a) ?? 0);
    if (id === 'flying' && who.body === 'drone') w += PULL.body;
    return w;
  });
  let count = 1;
  for (let x = voiceRoll(1) - HOW_MANY[0]; count < HOW_MANY.length && x >= 0; count++) x -= HOW_MANY[count];
  const pursuits: Pursuit[] = [];
  for (let k = 0; k < count; k++) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let x = voiceRoll(10 + k) * total, j = 0;
    while (j < weights.length - 1 && x >= weights[j]) x -= weights[j++];
    pursuits.push(PURSUIT_IDS[j]);
    weights[j] = 0;
  }
  return { name: NAMES[Math.floor(voiceRoll(2) * NAMES.length)], temperament: TEMPERAMENTS[Math.floor(voiceRoll(3) * TEMPERAMENTS.length)], pursuits };
}
