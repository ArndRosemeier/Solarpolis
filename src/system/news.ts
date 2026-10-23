/**
 * What happens in the system on its own clock, and when it is known where (plan "The Whole System", S1). Each piece
 * of news has a place and a time; anywhere else learns of it when its light arrives (`heardAt`: the ledger's light
 * time, the receiver moving meanwhile), so Saturn hears of a launch at Mercury over an hour after the Necklace does,
 * and nothing anyone does can make it sooner.
 *
 * The news is a pure function of the world seed and the clock, like the population: `newsIn` lists what happened in
 * any span of time without keeping anything, and the same span always gives the same news. What happens:
 * - notable flares on the Sun (heard everywhere at the light time from the Sun);
 * - Aurelipolis's twenty arks leaving Mercury orbit (world bible, Part VIII), on a schedule of `NewsParams.arks`;
 * - the Assembly's sessions, each deciding one motion of the bible's recurring questions (Enceladus, uplift rights,
 *   the arks, array fees, Krillix), most of them put off, as befits a forum without power;
 * - Velloran Reach's elections (a human, an AI, a cyborg, and once in a while a starship).
 * Later steps add the arrays' windows, sail traffic and the standing situations (S4, S7).
 */
import { Rng, deriveSeed, v3len } from '@futuremagic/core';
import { DAY } from '../space/constants';
import type { Ledger } from './ledger';
import { C } from './light';

export const NEWS_KINDS = ['flare', 'ark', 'assembly', 'election'] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

/** The Assembly's recurring questions (world bible, Parts III, VI, VIII). */
export const MOTIONS = ['enceladus', 'uplift', 'arks', 'array-fees', 'krillix'] as const;
export type Motion = (typeof MOTIONS)[number];
/** How a session ends, and how often. */
export const OUTCOMES = { adopted: 0.25, rejected: 0.3, deferred: 0.45 } as const;
/** Whom Velloran Reach elects (Part VIII: human presidents, AI presidents, cyborgs, and once, famously, a starship). */
export const WINNERS = { human: 0.4, ai: 0.34, cyborg: 0.23, starship: 0.03 } as const;
/** How big a flare is. */
export const FLARES = ['big', 'great'] as const;

export interface News {
  /** Stable: the same piece of news has the same id whenever it is listed. */
  id: string;
  kind: NewsKind;
  /** Where it happened: a habitat or body id of the ledger. */
  from: string;
  /** When it happened (clock s). */
  t: number;
  /** What it is about: `sun`, `ark-3`, a motion, `velloran`. */
  about: string;
  /** How it went: a flare's size, the ark's number, a session's outcome, the winner. */
  detail: string;
}

/** A piece of news and when its light reached a place. */
export interface Heard {
  news: News;
  heard: number;
}

const weighted = <K extends string>(rng: Rng, w: Readonly<Record<K, number>>): K => {
  const keys = Object.keys(w) as K[];
  return rng.weighted(keys, (k) => w[k]);
};

/** Every piece of news that happened in [t0, t1), in order. */
export function newsIn(ledger: Ledger, t0: number, t1: number): News[] {
  const p = ledger.params.news, seed = deriveSeed(ledger.space.seed, 'news'), epoch = ledger.space.epochJd;
  const out: News[] = [];
  const slots = (every: number, f: (k: number) => void): void => {
    for (let k = Math.floor(t0 / every) - 1; k <= Math.floor(t1 / every); k++) f(k);
  };
  const keep = (n: News): void => { if (n.t >= t0 && n.t < t1) out.push(n); };

  slots(p.flare.every, (k) => {
    const rng = new Rng(deriveSeed(seed, 'flare', k));
    if (!rng.chance(p.flare.chance)) return;
    keep({ id: `flare-${k}`, kind: 'flare', from: 'sun', t: (k + rng.float()) * p.flare.every, about: 'sun', detail: rng.chance(p.flare.great) ? 'great' : 'big' });
  });

  if (ledger.habitat('aurelipolis')) {
    const first = (p.arks.firstJd - epoch) * DAY;
    for (let k = 0; k < p.arks.count; k++) {
      const rng = new Rng(deriveSeed(seed, 'ark', k));
      keep({ id: `ark-${k + 1}`, kind: 'ark', from: 'aurelipolis', t: first + (k + rng.range(-1, 1) * p.arks.jitter) * p.arks.every, about: `ark-${k + 1}`, detail: String(k + 1) });
    }
  }

  if (ledger.habitat(p.assembly.seat)) slots(p.assembly.every, (k) => {
    const rng = new Rng(deriveSeed(seed, 'assembly', k));
    const t = (k + rng.range(0.1, 0.3)) * p.assembly.every, motion = rng.pick(MOTIONS);
    keep({ id: `assembly-${k}`, kind: 'assembly', from: p.assembly.seat, t, about: motion, detail: weighted(rng, OUTCOMES) });
  });

  if (ledger.habitat('velloran')) {
    const first = (p.election.firstJd - epoch) * DAY;
    for (let k = Math.floor((t0 - first) / p.election.every); k <= Math.floor((t1 - first) / p.election.every); k++) {
      const rng = new Rng(deriveSeed(seed, 'election', k));
      keep({ id: `election-${k}`, kind: 'election', from: 'velloran', t: first + k * p.election.every, about: 'velloran', detail: weighted(rng, WINNERS) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** When a piece of news's light reaches a place (clock s). */
export function heardAt(ledger: Ledger, news: News, at: string): number {
  return ledger.arrival(news.from, news.t, at);
}

/** The places news comes from: the Sun and the habitats where it happens. */
function sourcesOf(ledger: Ledger): string[] {
  return ['sun', 'aurelipolis', ledger.params.news.assembly.seat, 'velloran'].filter((id) => id === 'sun' || ledger.habitat(id));
}

/** The news whose light reached a place in (t − within, t], the latest first. */
export function newsHeard(ledger: Ledger, at: string, t: number, within: number): Heard[] {
  // No light takes longer than going by way of the Sun (the triangle inequality), plus an hour for anything moving.
  const far = Math.max(...sourcesOf(ledger).map((id) => v3len(ledger.where(id, t))));
  const lag = (v3len(ledger.where(at, t)) + far) / C + 3600;
  const out: Heard[] = [];
  for (const news of newsIn(ledger, t - within - lag, t)) {
    const heard = heardAt(ledger, news, at);
    if (heard > t - within && heard <= t) out.push({ news, heard });
  }
  return out.sort((a, b) => b.heard - a.heard);
}
