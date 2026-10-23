/**
 * What people say to each other (design "Speech bubbles: how people talk in Solarpolis", Arnd 2026-10-23: speech
 * bubbles, never voices or murmur). Every line comes from Arnd's conversation engine (`solarpolis-dialogue`,
 * github.com/ArndRosemeier/Conversations, pinned release): a resident says only what they know, in a voice made from
 * who they are (`voiceOf`: temperament, pursuits, body). This file only asks it and times the answers.
 *
 * A party that stops to talk (a `talk` beat, sim/beats.ts) holds conversations: the first a moment after the beat
 * begins, the next after a quiet (`life.talk.quiet`), and so on. Each is the engine's, seeded by the party, the beat
 * and its place in the chain; each piece (at most 90 characters) stays as long as it takes to read it
 * (`life.talk.read`). So a conversation is a pure function of the seed and the clock like everything else: whoever
 * arrives mid-sentence finds the same sentence.
 *
 * Only parties near the eye are asked (the caller says which and when; one new conversation at a time). The scripts
 * are kept under a count, report their bytes and go on memory pressure; each conversation's engine is let go once its
 * lines are timed. Pure: no three, no DOM, no clock of its own.
 */
import { hash3i, hashToFloat, deriveSeed } from '@futuremagic/core';
import { createConversationWorld, type Profile } from 'solarpolis-dialogue';
import { createEnglishResources, englishModule } from 'solarpolis-dialogue/english';
import type { Habitat } from '../blueprint';
import { residentOf, voiceOf, type Resident } from '../sim';
import { readFor, type Line } from './lines';
import { PURSUIT_WORDS } from './words';

/** A party that talks: its key (`partyKey`), its residents in member order, and when its talk beat began (clock, s). */
export interface Talkers {
  key: number;
  members: readonly number[];
  start: number;
}

/** How a conversation is paced (s): the first words after the beat begins, the gap between speakers and between pieces. */
const PACE = { open: 1.5, turn: 0.6, piece: 0.25 };
/** How long a conversation runs (turns): at least, and how many more at most. */
const TURNS = { least: 10, more: 14 };
/** How many parties' scripts are kept (the nearest few talk; the rest are made again if met again). */
const KEPT = 32;
/** Rough bytes of one line kept, beside its words. */
const BYTES = { line: 48 };

const BODY: Readonly<Record<Resident['body'], string>> = { grown: 'grown_human', shell: 'shell', drone: 'drone_person' };

interface Script {
  lines: Line[];
  /** The next conversation's place in the chain, and when it may begin (clock, s). */
  next: number;
  from: number;
  bytes: number;
}

export class Conversations {
  private readonly scripts = new Map<string, Script>();
  private readonly seed: number;
  /** Conversations made so far (the debug line). */
  made = 0;

  constructor(private readonly habitat: Habitat) {
    this.seed = deriveSeed(habitat.seed, 'talk', 'conversation');
  }

  /**
   * The lines of a party's talk up to clock time t (and a little past), or null while its first conversation is not
   * made yet. `make`: whether a conversation may be made now (the caller makes at most one each frame).
   */
  linesOf(party: Talkers, t: number, make: boolean): Line[] | null {
    if (party.members.length < 2) return null;
    const id = `${party.key}:${Math.round(party.start * 10)}`;
    let s = this.scripts.get(id);
    if (s) { this.scripts.delete(id); this.scripts.set(id, s); }
    if (!s) {
      if (!make) return null;
      s = { lines: [], next: 0, from: party.start + PACE.open, bytes: 0 };
      this.scripts.set(id, s);
      while (this.scripts.size > KEPT) this.scripts.delete(this.scripts.keys().next().value!);
      this.converse(party, s);
      return s.lines;
    }
    // Once the last conversation is over, the next one is made in time for its first words.
    if (make && t > s.from - PACE.open) this.converse(party, s);
    return s.lines;
  }

  /** The next conversation of a party's chain, its lines timed one after another; the quiet after it. */
  private converse(party: Talkers, s: Script): void {
    const h = this.habitat, talk = h.params.life.talk;
    // A catalogue of the party alone: the engine's English wants a name for everyone in it, and nobody else matters.
    const ids = party.members.map((i) => `r${i}`), names: Record<string, string> = {};
    const world = createConversationWorld({ profiles: party.members.map((i, k) => this.profileOf(i, ids[k])) });
    party.members.forEach((i, k) => { names[ids[k]] = voiceOf(h, i).name; });
    const session = world.createSession({ participants: ids, languageModule: englishModule, resources: createEnglishResources({ entities: names, pursuits: PURSUIT_WORDS }) });
    const salt = Math.round(party.start * 10) | 0, chainRoll = (k: number): number => hashToFloat(hash3i(this.seed, party.key, salt, s.next * 8 + k));
    const chat = session.conversation({ seed: hash3i(this.seed, party.key, salt, 0), occasion: s.next, maxTurns: TURNS.least + Math.floor(chainRoll(1) * (TURNS.more + 1)) });
    let at = s.from;
    for (let turn = chat.next(); turn; turn = chat.next()) {
      const member = ids.indexOf(turn.speaker);
      if (member < 0) continue;
      turn.pieces.forEach((text, k) => {
        if (k > 0) at += PACE.piece;
        const t1 = at + readFor(text, talk.read);
        s.lines.push({ member, text, t0: at, t1 });
        s.bytes += BYTES.line + 2 * text.length;
        at = t1;
      });
      at += PACE.turn;
    }
    s.next++;
    s.from = at + talk.quiet * (0.5 + chainRoll(2));
    this.made++;
  }

  /** A resident as the engine knows them: who they are when they talk (`voiceOf`) and their body. */
  private profileOf(i: number, id: string): Profile {
    const v = voiceOf(this.habitat, i);
    return { id, temperament: v.temperament, pursuits: v.pursuits, bodyKind: BODY[residentOf(this.habitat, i).body] };
  }

  /** Bytes held: the scripts' lines (an estimate; each conversation's engine is let go once its lines are timed). */
  bytes(): number {
    let b = 0;
    for (const s of this.scripts.values()) b += s.bytes;
    return b;
  }

  /** Give it all back: the scripts (made again, the same, when next asked). */
  shed(): void {
    this.scripts.clear();
  }

  summary(): string {
    return `talk: ${this.scripts.size} parties kept, ${this.made} conversations`;
  }
}
