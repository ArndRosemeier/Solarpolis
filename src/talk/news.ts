/**
 * What residents can talk about from beyond their habitat (plan "The Whole System", S1): the news whose light has
 * reached it (system/news.ts), as facts and topics for the conversation engine. Each resident learns a piece of news
 * some while after its light arrives (most soon, a few only near the end of `NewsParams.spread`), so in one party one
 * may tell another about the third ark or the Assembly's latest motion, and both may know how long its light took.
 *
 * The facts say only what happened, in the bible's terms; the engine decides who says it and how. A pure function of
 * the ledger, the clock and the party, like everything people say.
 */
import { deriveSeed, hash3i, hashString, hashToFloat } from '@futuremagic/core';
import type { Act, Fact, Predicate } from 'solarpolis-dialogue';
import type { EnglishPredicate } from 'solarpolis-dialogue/english';
import { newsHeard, type Heard, type Ledger, type News } from '../system';

/** The relations news is told in. */
export const NEWS_PREDICATES: Readonly<Record<string, Predicate>> = {
  had: { roles: { subject: 'entity', event: 'entity' }, keyRoles: ['subject'] },
  launched_from: { roles: { subject: 'entity', place: 'entity' }, keyRoles: ['subject'] },
  decided: { roles: { subject: 'entity', outcome: 'entity' }, keyRoles: ['subject'] },
  elected: { roles: { subject: 'entity', winner: 'entity' }, keyRoles: ['subject'] },
  took_minutes: { roles: { subject: 'entity', minutes: 'number' }, keyRoles: ['subject'] },
};

/** How they read in English. */
export const NEWS_TEMPLATES: Readonly<Record<string, EnglishPredicate>> = {
  had: { positive: '{subject} had {event}', negative: '{subject} did not have {event}' },
  launched_from: { positive: '{subject} launched from {place}', negative: '{subject} has not launched from {place}' },
  decided: { positive: '{subject} was {outcome}', negative: '{subject} was not {outcome}' },
  elected: { positive: '{subject} elected {winner}', negative: '{subject} did not elect {winner}' },
  took_minutes: { positive: '{subject} took {minutes} minutes to reach us', negative: '{subject} did not take {minutes} minutes to reach us' },
};

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
  'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const MOTION_NAMES: Readonly<Record<string, string>> = {
  enceladus: 'the Assembly’s motion to open Enceladus to study',
  uplift: 'the Assembly’s motion on uplift personhood',
  arks: 'the Assembly’s motion condemning the twenty arks',
  'array-fees': 'the Assembly’s motion to cap array fees',
  krillix: 'the Assembly’s motion to give Krillix a full seat',
};
const OUTCOME_NAMES: Readonly<Record<string, string>> = { adopted: 'adopted', rejected: 'voted down', deferred: 'put off again' };
const WINNER_NAMES: Readonly<Record<string, string>> = { human: 'a human president', ai: 'an AI president', cyborg: 'a cyborg president', starship: 'a starship as president' };

/** A party's news: entities (with their English names), facts by who knows them, and the topics to bring up. */
export interface NewsTalk {
  names: Record<string, string>;
  facts: Fact[];
  topics: Act[];
}

/** One who talks: the engine's id and the resident (for when they heard). */
export interface Listener {
  id: string;
  resident: number;
}

/** When a resident learns a piece of news whose light arrived at `heard`: most soon after, a few late (s). */
export function learnedAt(ledger: Ledger, heard: Heard, resident: number): number {
  const u = hashToFloat(hash3i(deriveSeed(ledger.space.seed, 'news', 'learn'), resident, hashString(heard.news.id), 0));
  return heard.heard + ledger.params.news.spread * u * u;
}

/**
 * The news a party talks about at clock time t, at a place of the ledger (`at`, the habitat's id): up to `most` pieces
 * heard there within `NewsParams.recent` that at least one member knows, chosen by `salt`; each with the light time it
 * took, where that is a minute or more.
 */
export function newsTalk(ledger: Ledger, at: string, t: number, members: readonly Listener[], salt: number, most = 2): NewsTalk | null {
  const known = newsHeard(ledger, at, t, ledger.params.news.recent)
    .map((h) => ({ h, by: members.filter((m) => learnedAt(ledger, h, m.resident) <= t).map((m) => m.id) }))
    .filter((k) => k.by.length > 0);
  if (!known.length) return null;
  // A seeded few of them, the most recent likelier.
  const chosen = known.map((k, i) => ({ k, key: hashToFloat(hash3i(salt, i, hashString(k.h.news.id), 1)) * (1 + i * 0.5) }))
    .sort((a, b) => a.key - b.key).slice(0, most).map((c) => c.k);
  const out: NewsTalk = { names: {}, facts: [], topics: [] };
  for (const { h, by } of chosen) {
    tell(out, h.news, by, ledger);
    const minutes = Math.round((h.heard - h.news.t) / 60), story = `story_${slug(h.news.id)}`;
    if (minutes < 1) continue;
    out.names[story] = storyName(h.news, ledger);
    out.facts.push(fact(`${h.news.id}-light`, { predicate: 'took_minutes', args: { subject: story, minutes } }, by, 'common-knowledge'));
    if (hashToFloat(hash3i(salt, hashString(h.news.id), 2, 3)) < 0.5) out.topics.push(ask('took_minutes', story, 'minutes'));
  }
  return out;
}

/** The fact and topic of one piece of news. */
function tell(out: NewsTalk, n: News, by: string[], ledger: Ledger): void {
  const id = slug(n.id);
  switch (n.kind) {
    case 'flare': {
      const event = `${n.detail}_flare`;
      out.names.sun = 'the Sun';
      out.names[event] = `a ${n.detail} flare`;
      out.facts.push(fact(n.id, { predicate: 'had', args: { subject: 'sun', event } }, by));
      out.topics.push(ask('had', 'sun', 'event'));
      return;
    }
    case 'ark': {
      out.names[id] = `the ${ORDINALS[Number(n.detail) - 1] ?? `number ${n.detail}`} of Aurelipolis’s arks`;
      out.names.mercury_orbit = 'Mercury orbit';
      out.facts.push(fact(n.id, { predicate: 'launched_from', args: { subject: id, place: 'mercury_orbit' } }, by));
      out.topics.push(ask('launched_from', id, 'place'));
      return;
    }
    case 'assembly': {
      const outcome = `outcome_${n.detail}`;
      out.names[id] = MOTION_NAMES[n.about] ?? `the Assembly’s motion on ${n.about}`;
      out.names[outcome] = OUTCOME_NAMES[n.detail] ?? n.detail;
      out.facts.push(fact(n.id, { predicate: 'decided', args: { subject: id, outcome } }, by));
      out.topics.push(ask('decided', id, 'outcome'));
      return;
    }
    case 'election': {
      const winner = `winner_${n.detail}`;
      out.names.velloran = ledger.polity('velloran')?.name ?? 'Velloran Reach';
      out.names[winner] = WINNER_NAMES[n.detail] ?? n.detail;
      out.facts.push(fact(n.id, { predicate: 'elected', args: { subject: 'velloran', winner } }, by));
      out.topics.push(ask('elected', 'velloran', 'winner'));
      return;
    }
  }
}

/** What the news is called when people say how long it took. */
function storyName(n: News, ledger: Ledger): string {
  if (n.kind === 'flare') return 'the light of the flare';
  if (n.kind === 'assembly') return 'the news from the Assembly';
  const where = ledger.habitat(n.from)?.name ?? n.from;
  return `the news from ${where}`;
}

const slug = (id: string): string => id.replace(/[^a-z0-9]+/gi, '_');

function fact(id: string, atom: Fact['atom'], knownBy: string[], sourceKind = 'received-signal'): Fact {
  return { id, atom, validFrom: 0, validTo: null, knownBy, sourceKind, origin: { kind: 'host-event', source: 'system/news' } };
}

function ask(predicate: string, subject: string, unknown: string): Act {
  return { function: 'ask', query: { predicate, args: { subject, [unknown]: { $var: unknown } } } };
}
