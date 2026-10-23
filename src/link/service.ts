/**
 * What a part of the game offers the player through their neural link (Arnd, 2026-10-23: the link and its overlay are
 * canon, as common as phones today, and everything integrates into it). Pure types: a service is written where its
 * system lives (the capsules, later the news, the habitat's Mind, people who share their names) and served to the one
 * overlay (`Link`, src/app/link) by main.ts. The overlay asks; a service never draws anything of its own.
 */
import type { Vec3 } from '@futuremagic/core';

/** One system's part of the link: its offers here and now, and what it is doing for the player. */
export interface LinkService {
  /** Stable id ('capsules'). */
  readonly id: string;
  /** Its heading in the link ('Capsules'). */
  readonly title: string;
  /** What it offers here and now: asked when the link opens and about once a second while it is open. */
  offers(): readonly LinkOffer[];
  /** What it is doing for the player now, shown as a live card (and a mark in the world): asked every frame. */
  status?(): LinkStatus | null;
}

/** Something the player can do through the link ('Call a capsule'), with a list to pick from or none. */
export interface LinkOffer {
  readonly id: string;
  readonly title: string;
  /** A line under the title ('One stop away, 20 s'). */
  readonly detail?: string;
  /** What to pick from (destinations): grouped, searchable. Without choices the offer is taken at once. */
  readonly choices?: readonly LinkChoice[];
  /** Taken, with the chosen choice's id when it has choices. */
  take(choice?: string): void;
}

/** One entry of an offer's list: a destination 'Lift Stair', '3.2 km · 4 min', group 'Landmarks'. */
export interface LinkChoice {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  /** The group it is listed under; groups keep the order their first choice comes in. */
  readonly group?: string;
  /** How far it is (m): a group lists its nearest first. */
  readonly near?: number;
}

/** What a service is doing for the player now: 'Your capsule', 'Arriving in 30 s'. */
export interface LinkStatus {
  /** Who speaks (the capsule's own small Mind, the habitat's Mind). */
  readonly from: string;
  readonly title: string;
  readonly detail?: string;
  /** How far along, 0…1, when that means something. */
  readonly progress?: number;
  /** The point in the habitat's world frame the overlay marks (the capsule coming), if any. */
  readonly at?: Vec3;
  /** What the mark says beside the point ('your capsule · 30 s'); the title when left out. */
  readonly mark?: string;
  /** Offered as a button on the card ('Cancel'). */
  cancel?(): void;
}

/** One line said to the player through the link (a capsule's Mind: 'On my way. Forty seconds.'). */
export interface LinkLine {
  readonly from: string;
  readonly text: string;
}
