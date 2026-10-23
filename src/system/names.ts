/**
 * Habitat and Mind names (world bible, Part VII): names reflect culture and should feel diverse, not uniform.
 * - `grave`: bureaucratic, no-nonsense habitats take grave names ending in "-polis" (the convention began with
 *   Selenipolis): a Greek root and "polis", sometimes with a qualifier.
 * - `punk`: chaotic punk and no-future habitats take absurd, provocative names (Grixmaw).
 * - `mind`: habitats ruled by a Mind take whimsical, playful names in the Banks tradition, which are the Mind's own
 *   (A Little More Room Than Strictly Necessary; The Long Afternoon of Threnody).
 * - `plain`: everyone else: place names of the kind people give a home.
 *
 * Every habitat also has a steward Mind (decisions: everything technical has a mind; the habitat has one), named the
 * whimsical way whatever its people call their home. Pure: a name is a function of a seed.
 */
import { Rng } from '@futuremagic/core';

/** How a habitat names itself. */
export const NAME_STYLES = ['grave', 'punk', 'mind', 'plain'] as const;
export type NameStyle = (typeof NAME_STYLES)[number];

// Greek roots that read well before "-polis": order, law, light, gold, sea, flower, wind, evening, dawn, stone…
const GRAVE_ROOTS = ['Taxi', 'Nomo', 'Dikaio', 'Helio', 'Chryso', 'Argyro', 'Thalasso', 'Antho', 'Anemo', 'Hespero', 'Eo', 'Petro',
  'Kosmo', 'Astero', 'Phylo', 'Kalli', 'Eirene', 'Sophro', 'Megalo', 'Neo', 'Hydro', 'Dendro', 'Lyko', 'Kyano', 'Leuko', 'Melano',
  'Orthi', 'Pharo', 'Pyrgo', 'Krysto', 'Theo', 'Elaio', 'Ampelo', 'Mnemo', 'Logo', 'Ergo', 'Polemo', 'Kymo', 'Nesio', 'Aithero'];
const GRAVE_QUALIFIERS = ['Nea', 'Ano', 'Kato', 'Mikra', 'Megali', 'Exo', 'Eso'];
// Bureaucrats count: the third Taxipolis is Taxipolis Three.
const NUMBERS = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Fourteen', 'Twenty', 'Thirty-One', 'Forty'];

const PUNK_HEADS = ['Grix', 'Skab', 'Vlek', 'Kreb', 'Snarl', 'Rot', 'Spite', 'Mangle', 'Gristle', 'Slag', 'Knuckle', 'Glitch', 'Scrap',
  'Bile', 'Krank', 'Splint', 'Rust', 'Grudge', 'Smut', 'Jank'];
const PUNK_TAILS = ['maw', 'gut', 'pit', 'heap', 'den', 'scab', 'yard', 'hole', 'mouth', 'nest', 'tooth', 'drift', 'wreck', 'rat'];
const PUNK_PHRASES = ['No Future Here', 'Kick Me Station', 'Last Orders', 'Bad Idea Collective', 'Nobody Asked', 'Do Not Resuscitate',
  'Unlicensed', 'Your Mother Was Right', 'Sorry Not Sorry', 'Free Air Ends Here', 'Burn After Reading', 'Void Where Prohibited',
  'Out of Warranty', 'Mind the Gap', 'Absolutely Not', 'Small Print', 'Wet Paint', 'Teeth'];
const PUNK_ADJECTIVES = ['Rusted', 'Feral', 'Ugly', 'Broken', 'Filthy', 'Loud', 'Last', 'Wrong', 'Crooked', 'Spare', 'Stolen', 'Cheap', 'Bent',
  'Dead', 'Static', 'Rabid', 'Hollow', 'Sour', 'Second-Hand', 'Unpaid', 'Tired', 'Sharp', 'Septic', 'Lost'];
const PUNK_NOUNS = ['Grin', 'Mercy', 'Static', 'Teeth', 'Choir', 'Engine', 'Saint', 'Rats', 'Weather', 'Lung', 'Promise', 'Wiring', 'Orbit',
  'Hymn', 'Gods', 'Bones', 'Dogs', 'Signal', 'Junk', 'Heaven', 'Kings', 'Sleep', 'Party', 'Riot'];

// The Mind names: a few shapes, each a sequence of word lists (one word from each, joined), chosen in proportion to
// how many names each can make, so they come out playful and seldom twice.
const MIND_SHAPES: readonly (readonly (readonly string[])[])[] = [
  [['The'], ['Long', 'Slow', 'Quiet', 'Gentle', 'Patient', 'Brief', 'Unhurried', 'Mild', 'Second', 'Last', 'Small', 'Warm', 'Late'],
    ['Afternoon', 'Verdict', 'Argument', 'Insistence', 'Interlude', 'Answer', 'Weather', 'Silence', 'Rehearsal', 'Apology'], ['of'],
    ['Small Hours', 'Distant Gardens', 'Reasonable People', 'Borrowed Light', 'Several Moons', 'Good Intentions', 'Patient Water', 'Unfinished Maps', 'Minor Planets', 'Kind Strangers', 'Quiet Machines', 'Late Summer', 'Lost Umbrellas']],
  [['A Little', 'Somewhat', 'Considerably', 'Not Quite', 'Rather', 'Slightly', 'Almost', 'Entirely'],
    ['More Room', 'Less Rain', 'More Sky', 'Less Hurry', 'More Garden', 'Fewer Rules', 'More Time', 'Less Noise', 'More Weather', 'Fewer Meetings'],
    ['Than'], ['Promised', 'Anyone Asked For', 'Last Time', 'Advertised', 'Was Wise', 'Seemed Possible', 'Planned']],
  [['This Will Only Take', 'It Took', 'Give It', 'Allow For', 'It Could Take', 'Expect'],
    ['Another Century', 'Most Of The Afternoon', 'A Moment Or Two', 'Several Lifetimes', 'A Quiet Year', 'Longer Than Anyone Hoped', 'Two More Winters', 'All The Patience There Is']],
  [['A Perfectly Reasonable', 'An Entirely Sensible', 'A Mostly Harmless', 'A Thoroughly Considered', 'A Somewhat Overdue', 'An Agreeable', 'A Generous', 'An Unexpected'],
    ['Amount Of Sky', 'Compromise', 'Excuse', 'Arrangement', 'Change Of Plan', 'Digression', 'Surplus', 'Silence', 'Misunderstanding', 'Afterthought']],
  [['Nothing Here Is', 'Everything Is', 'Hardly Anything Is', 'Some Of This Is', 'Not All Of It Is', 'Most Of It Is'],
    ['Urgent', 'Finished', 'Quite As It Seems', 'Anyone\u2019s Fault', 'For Sale', 'Strictly Speaking Necessary', 'Lost', 'On Fire', 'Optional']],
  [['Ask Me', 'Remind Me', 'Wake Me', 'Tell Me', 'Forgive Me', 'Find Me'],
    ['Again Tomorrow', 'When It Rains', 'After The Harvest', 'In A Hundred Years', 'Once You Are Sure', 'Before Supper', 'If It Matters']],
  [['Of Course', 'Probably', 'Possibly', 'Certainly', 'Apparently', 'Regrettably'], ['Not,', 'Yes,', 'Later,', 'Both,', 'Neither,', 'Somebody Else,'],
    ['But Thank You', 'If You Insist', 'For Now', 'On Balance', 'All Things Considered', 'Since You Ask']],
  [['Seven', 'Several', 'Too Many', 'Not Enough', 'Exactly Twelve', 'Some'], ['Reasons', 'Clouds', 'Small Kindnesses', 'Open Windows', 'Second Chances', 'Spare Rooms'],
    ['To Stay', 'For Later', 'And Counting', 'In The Garden', 'Nobody Mentions']],
];
const MIND_WAYS = MIND_SHAPES.map((parts) => parts.reduce((n, words) => n * words.length, 1));

const PLAIN_FIRST = ['Halden', 'Kestrel', 'Lantern', 'Bluewater', 'Amber', 'Saltmarsh', 'Cedar', 'Juniper', 'Seven Orchards', 'Tamsel',
  'Okoro', 'Lindqvist', 'Maribel', 'Hokulani', 'Sundari', 'Tierra', 'Ashgrove', 'Nightjar', 'Copperbeech', 'Wren', 'Miyabi', 'Tavola',
  'Oyelaran', 'Kilimani', 'Brightwater', 'Hollin', 'Esperanza', 'Valdemar', 'Quillon', 'Seren', 'Anansi', 'Mbali', 'Ilse', 'Teodora'];
const PLAIN_SECOND = ['Ring', 'Reach', 'Haven', 'Wheel', 'Hollow', 'Commons', 'Drum', 'Garden', 'Station', 'Rest', 'Turn', 'Landing',
  'Green', 'Harbour', 'Fold', 'Crossing', 'Meadows', 'Spindle', 'Terraces', 'Orchard', 'Hearth', 'Vale', 'Lanterns', 'Quay'];
// Coined place names, as people coin them, from sounds of many languages: two or three syllables.
const ONSETS = ['', 'b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'dr', 'tr', 'sh', 'w', 'y', 'ch', 'j'];
const VOWELS = ['a', 'a', 'e', 'e', 'i', 'o', 'o', 'u', 'ai', 'ei'];
const CODAS = ['n', 'l', 'r', 's', 'm', 'nd', 'th'];

function coined(r: Rng): string {
  let w = '';
  for (let k = 0, n = r.chance(0.3) ? 3 : 2; k < n; k++) w += (k > 0 && w.length && !/[aeiou]$/.test(w) ? r.pick(ONSETS.filter((o) => o.length === 1 && o)) : r.pick(ONSETS)) + r.pick(VOWELS) + ((k === n - 1 ? r.chance(0.6) : r.chance(0.25)) ? r.pick(CODAS) : '');
  return w[0].toUpperCase() + w.slice(1);
}

/** A habitat name in a style, from a seed. */
export function habitatName(style: NameStyle, seed: number): string {
  const r = new Rng(seed);
  switch (style) {
    case 'grave': {
      const name = `${r.pick(GRAVE_ROOTS)}polis`, roll = r.float();
      return roll < 0.15 ? `${r.pick(GRAVE_QUALIFIERS)} ${name}` : roll < 0.6 ? `${name} ${r.pick(NUMBERS)}` : name;
    }
    case 'punk': {
      const roll = r.float();
      return roll < 0.4 ? `${r.pick(PUNK_HEADS)}${r.pick(PUNK_TAILS)}` : roll < 0.85 ? `${r.pick(PUNK_ADJECTIVES)} ${r.pick(PUNK_NOUNS)}` : r.pick(PUNK_PHRASES);
    }
    case 'mind': return mindName(seed);
    case 'plain': {
      const roll = r.float();
      return roll < 0.3 ? `${r.pick(PLAIN_FIRST)} ${r.pick(PLAIN_SECOND)}` : roll < 0.7 ? `${coined(r)} ${r.pick(PLAIN_SECOND)}` : coined(r);
    }
  }
}

/** A Mind's name (Banks-style, whimsical), from a seed. */
export function mindName(seed: number): string {
  const r = new Rng(seed ^ 0x6d1d);
  const parts = r.weighted(MIND_SHAPES, (_, i) => MIND_WAYS[i]);
  return parts.map((words) => r.pick(words)).join(' ');
}

/**
 * Names that differ from every name in `taken`: the style's name, or with a numeral after it when even a few tries
 * cannot avoid a clash (a numeral is how people tell two Kallipoleis apart).
 */
export function uniqueName(make: (k: number) => string, taken: Set<string>): string {
  for (let k = 0; k < 8; k++) {
    const name = make(k);
    if (!taken.has(name)) { taken.add(name); return name; }
  }
  const base = make(0);
  for (let n = 2; ; n++) {
    const name = `${base} ${roman(n)}`;
    if (!taken.has(name)) { taken.add(name); return name; }
  }
}

function roman(n: number): string {
  const parts: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of parts) while (n >= v) { out += s; n -= v; }
  return out;
}
