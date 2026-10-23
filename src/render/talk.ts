/**
 * The speech bubbles (design "Speech bubbles: how people talk in Solarpolis", Arnd 2026-10-23): who in the parties
 * near the eye is saying what, and where on the screen. People never speak aloud; a party on a `talk` beat holds a
 * conversation (src/talk, loaded the first time anyone near talks), and its speaker's words show over their head
 * within `life.talk.words` of the eye, for the nearest `life.talk.parties` parties. Farther out, to `life.talk.dots`,
 * a small bubble shows that someone speaks; beyond that the gestures carry it.
 *
 * It also says who speaks (`speaker`) for the figures' talk and listen clips and the drone persons' nod: the
 * conversation's speaker where one is held, `talkerAt` elsewhere. Drawing the bubbles is the page's (app/bubbles.ts).
 */
import type { Camera } from 'three';
import { toView, toWorld, type Habitat, type Vec3 } from '../blueprint';
import { POSE } from '../gen/standIn';
import type { Terrain } from '../gen/terrain';
import { footingOf, partyKey, partyMembers, talkerAt, voiceOf, type Person } from '../sim';
import type { Conversations } from '../talk';
import { lineAt, type Line } from '../talk/lines';
import type { Talker } from './people';
import { toScreen } from './screen';

/** A bubble this frame: whose (party and member), where its tail points (CSS px), the name and words (null: "…"). */
export interface Bubble {
  id: string;
  x: number;
  y: number;
  name: string;
  text: string | null;
  /** How far the speaker is (m), for the bubble's size and fade. */
  distance: number;
}

/** How high over the feet a bubble's tail points, by how someone holds themselves (shares of their height, then m). */
const HEAD = { upright: 1.0, kneel: 0.62, lie: 0.22, above: 0.25 };
/** A drone body's bubble, over where it hovers (m). */
const DRONE_ABOVE = 0.45;
/** How far off the screen a bubble's speaker may be and still show it (px). */
const MARGIN = 40;

interface Party {
  key: number;
  members: Talker[];
  distance: number;
}

export class TalkView {
  private conversations: Conversations | null = null;
  private loading = false;
  private readonly talkers: Talker[] = [];
  /** The speaker by party this frame, where a conversation is held (−1: a pause). */
  private readonly speaking = new Map<number, number>();
  readonly bubbles: Bubble[] = [];

  constructor(private readonly habitat: Habitat, private readonly terrain: Terrain) {}

  /** Who in someone's party speaks at clock time t: the conversation's speaker where one is held, else `talkerAt`. */
  readonly speaker = (p: Person, t: number): number => this.speaking.get(partyKey(p)) ?? talkerAt(p, t);

  /** Bring the bubbles up to clock time t: the talking parties around the eye (world), seen by the camera. */
  bubblesAt(people: { talkers(out: Talker[]): void }, eye: Vec3, t: number, camera: Camera, width: number, height: number): void {
    const h = this.habitat, talk = h.params.life.talk, out = this.bubbles;
    out.length = 0;
    this.speaking.clear();
    people.talkers(this.talkers);
    if (!this.talkers.length) return;
    if (!this.conversations) { this.loadEngine(); return; }
    camera.updateMatrixWorld();
    const parties = new Map<number, Party>();
    for (const one of this.talkers) {
      if (one.person.below || one.person.court < 0) continue;
      const key = partyKey(one.person), d = this.distanceTo(one, eye);
      const party = parties.get(key);
      if (party) { party.members.push(one); party.distance = Math.min(party.distance, d); } else parties.set(key, { key, members: [one], distance: d });
    }
    const near = [...parties.values()].filter((p) => p.distance <= talk.dots).sort((a, b) => a.distance - b.distance);
    let make = true, worded = 0;
    for (const party of near) {
      const lead = party.members[0].person;
      const words = worded < talk.parties && party.distance <= talk.words;
      let line: Line | null = null, member = talkerAt(lead, t);
      if (words) {
        worded++;
        const made = this.conversations.made;
        const lines = this.conversations.linesOf({ key: party.key, members: partyMembers(h, t, lead), start: t - lead.since }, t, make);
        // At most one new conversation a frame (the first of the day's engine work takes longest).
        if (this.conversations.made !== made) make = false;
        if (lines) {
          // The conversation says who speaks; between its lines nobody does.
          line = lineAt(lines, t);
          member = line ? line.member : -1;
          this.speaking.set(party.key, member);
        }
      }
      const who = party.members.find((m) => m.person.member === member);
      if (!who) continue;
      const head = this.headOf(who), at = toScreen(camera, toView(eye, head), width, height, MARGIN);
      if (!at) continue;
      out.push({ id: `${party.key}:${member}`, x: at[0], y: at[1], name: voiceOf(h, who.person.resident).name, text: line ? line.text : null, distance: this.distanceTo(who, eye) });
    }
  }

  /** Where someone's bubble points: over their head as they hold themselves, or over a drone body (world). */
  private headOf(one: Talker): Vec3 {
    const p = one.person;
    if (!one.feet) {
      const foot = footingOf(this.terrain, p, one.deck, 0);
      return toWorld(this.habitat.profile, { theta: p.theta, s: p.s, h: foot.h + DRONE_ABOVE });
    }
    const share = p.posture === POSE.lie ? HEAD.lie : p.posture === POSE.kneel ? HEAD.kneel : HEAD.upright, up = share * one.height + HEAD.above;
    return [one.feet[0] + one.up[0] * up, one.feet[1] + one.up[1] * up, one.feet[2] + one.up[2] * up];
  }

  private distanceTo(one: Talker, eye: Vec3): number {
    if (one.feet) return Math.hypot(one.feet[0] - eye[0], one.feet[1] - eye[1], one.feet[2] - eye[2]);
    const at = toWorld(this.habitat.profile, { theta: one.person.theta, s: one.person.s, h: 0 });
    return Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
  }

  /** The conversation engine, loaded the first time anyone near talks (its own chunk). */
  private loadEngine(): void {
    if (this.loading) return;
    this.loading = true;
    void import('../talk').then((m) => { this.conversations = new m.Conversations(this.habitat); });
  }

  bytes(): number {
    return this.conversations?.bytes() ?? 0;
  }

  shed(): void {
    this.conversations?.shed();
  }

  info(): string {
    return this.conversations ? `${this.conversations.summary()}, ${this.bubbles.length} bubbles` : `talk: ${this.loading ? 'loading' : 'not loaded'}`;
  }
}
