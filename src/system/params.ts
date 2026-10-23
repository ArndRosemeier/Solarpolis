/**
 * The parameters of the whole system (plan "The Whole System", S2): which habitats live in which orbits, in what
 * forms, under what kinds of names and economies, and what news happens where. `SystemParams` is to the solar system
 * what `HabitatParams` is to one cylinder: every count and range here is an example value, and a different seed or
 * different numbers give a different, equally lawful system. Plain data.
 */
import type { Belt } from '../space/asteroids';
import type { MeanPlanet } from '../space/meanPlanets';
import type { NameStyle } from './names';

/** The bible's habitat forms (Part I): only the cylinder has a blueprint yet; the others are named for the ledger. */
export const FORMS = ['cylinder', 'torus', 'bubble', 'asteroid', 'swarm', 'water', 'surface'] as const;
export type Form = (typeof FORMS)[number];

/** How resources reach citizens (Part V): no-money commons, a citizen dividend, or stone-cold markets. */
export const ECONOMIES = ['commons', 'dividend', 'market'] as const;
export type Economy = (typeof ECONOMIES)[number];

/** Power in the Assembly (Part III). */
export const TIERS = ['major', 'significant', 'minor'] as const;
export type Tier = (typeof TIERS)[number];

/** A body whose place is known without the ephemeris pack (space/meanPlanets.ts, space/ephemeris.ts). */
export type Body = MeanPlanet | 'sun' | 'moon';

/** Where one habitat is, always relative to something whose position is known. Angles in radians, lengths in metres. */
export type Orbit =
  /** A slot on the geostationary ring over one longitude of Earth (space/necklace.ts). */
  | { kind: 'necklace'; longitude: number; radius: number }
  /** A circular orbit about a body, in the ecliptic frame tipped by `inclination` about the line of `node`. */
  | { kind: 'circle'; body: Body; radius: number; inclination: number; node: number; phase: number }
  /** Earth–Moon L4 (60° ahead of the Moon) or L5 (behind), `along` further round so several habitats share a point. */
  | { kind: 'lagrange'; point: 4 | 5; along: number }
  /** Hollowed out of one asteroid of the model populations (space/asteroids.ts): it goes where its rock goes. */
  | { kind: 'asteroid'; belt: Belt; index: number }
  /** Its own ellipse about the Sun (elements at J2000; `mean` the mean anomaly then). */
  | { kind: 'sun'; a: number; e: number; inclination: number; node: number; peri: number; mean: number }
  /** On a body's surface (Earth, the Moon): its centre stands in, as light from anywhere on it differs by milliseconds. */
  | { kind: 'surface'; body: Body };

/** Where a region's habitats are drawn from. Distances about a body in its radii; about the Sun in AU. */
export type RegionPlace =
  /** The geostationary ring: its habitats and their blueprints come from `SpaceParams` (space/necklace.ts). */
  | { kind: 'necklace' }
  | { kind: 'circle'; body: MeanPlanet; distance: readonly [number, number]; inclination: number }
  | { kind: 'lagrange'; point: 4 | 5; spread: number }
  | { kind: 'belt'; belt: Belt; within: number }
  | { kind: 'sun'; a: readonly [number, number]; e: number; inclination: number };

export interface RegionParams {
  id: string;
  /** What people call it. */
  name: string;
  count: number;
  place: RegionPlace;
  /** How often each form is built here, relative to the others. */
  forms: Partial<Readonly<Record<Form, number>>>;
  /** How often each naming style (the culture behind it) is found here. */
  styles: Partial<Readonly<Record<NameStyle, number>>>;
  economies: Partial<Readonly<Record<Economy, number>>>;
  /** Spin radius (m), drawn evenly in its logarithm; the floor's length (a torus's width) is the radius times `aspect`. */
  radius: readonly [number, number];
  aspect: readonly [number, number];
}

/** What happens on its own clock, somewhere, and is heard elsewhere when its light arrives (news.ts). Times in s. */
export interface NewsParams {
  /** Notable flares on the Sun: one chance per `every`, a `great` share of them great. */
  flare: { every: number; chance: number; great: number };
  /** Aurelipolis's twenty arks (bible, Part VIII): the first launch (Julian date), then one about every `every`, ± `jitter` of it. */
  arks: { count: number; firstJd: number; every: number; jitter: number };
  /** The Assembly sits every `every` at its `seat` (a habitat id) and decides one motion. */
  assembly: { every: number; seat: string };
  /** Velloran Reach elects its president: the first time (Julian date), then every `every`. */
  election: { firstJd: number; every: number };
  /** How long after its light arrives a piece of news has reached everyone in a habitat (s): most hear it early. */
  spread: number;
  /** How long people still bring a piece of news up (s). */
  recent: number;
}

export interface SystemParams {
  /** The generic habitats, region by region (the Necklace's own come from `SpaceParams`, the canon from polities.ts). */
  regions: RegionParams[];
  /**
   * People per m² of floor, by form, as a share of the home habitat's (`HabitatParams.population` over its floor):
   * a swarm is crowded, a water-volume gives its swimmers room. A surface settlement's population is its own.
   */
  crowding: Readonly<Record<Exclude<Form, 'surface'>, number>>;
  /** Whether the world bible's polities are in the system. */
  canon: boolean;
  news: NewsParams;
}
