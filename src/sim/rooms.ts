/**
 * How the rooms sound (design "Solarpolis: how it sounds": below is the opposite of above): the Understorey's beds,
 * from what the bays round the listener are used for (gen/under.ts, gen/halls.ts), and every room's echo, worked out
 * from its real size, never recorded: Sabine's reverberation time, T60 = 0.161 V / A, the room's volume over its
 * absorption (each surface's area times how much of the sound it takes, plus the air's own share, 4 m V).
 *
 *   courts     a hollow of stone open to the sky: the floor and the wall return the sound, the opening takes it all;
 *   below      the pillar forest: per bay, the floor, the ceiling screen and one pillar, with the air between, for a long
 *              stone echo (the Dim's), shorter in halls and homes, where people, wood and cloth take more of it.
 *
 * Every size comes from the blueprint (`under.bay`, the levels over each bay, the pillars' radius, the courts' plan),
 * so a bigger habitat's rooms really sound bigger. Pure.
 */
import { clamp, smoothstep } from '@futuremagic/core';
import { baysNear, baysOf } from '../gen/bays';
import { hallAt, type HallKind } from '../gen/halls';
import type { Terrain } from '../gen/terrain';
import { underOf, type BayUse } from '../gen/under';
import { levelsOf } from '../gen/underLevels';
import { floorGap } from './walks';
import type { Listener } from './sounds';

/** The Understorey's beds (files `bed/<name>`): room tones and the halls' work, never voices. */
export const ROOM_BEDS = ['dim', 'cistern', 'works', 'kitchen', 'bath', 'workshop', 'minds', 'home'] as const;
export type RoomBed = (typeof ROOM_BEDS)[number];

/** A room's echo: its reverberation time (s, to −60 dB), the delay before its first reflections (s), and how much of what is heard is echo (0 … 1). */
export interface Room {
  t60: number;
  delay: number;
  wet: number;
}

/** No room: open land. */
export const OPEN: Room = { t60: 0, delay: 0, wet: 0 };

/** The speed of sound (m/s) and the air's absorption (m⁻¹, at about 2 kHz in mild, moist air). */
const SOUND = 343, AIR = 0.003;
/** How much of the sound each surface takes (at mid frequencies). */
const ABSORB = { stone: 0.02, screen: 0.04, water: 0.01, plaster: 0.05, hall: 0.18, home: 0.3, open: 1 } as const;
/** How much of what is heard is echo, in each kind of room. */
const WET = { court: 0.35, dim: 0.5, hall: 0.3, home: 0.15 } as const;

/** What each hall's bed is (a stage plays music instead, sim/sources.ts; a commons is a quiet room). */
const HALL_BED: Readonly<Record<HallKind, RoomBed>> = { kitchen: 'kitchen', bath: 'bath', shop: 'workshop', stage: 'home', minds: 'minds', commons: 'home' };
/** The bays a hall or other use is heard over: half loudness this many bays past its edge. */
const HEARD_BAYS = 0.5;

/** Sabine: T60 = 0.161 V / (A + 4 m V). */
const sabine = (volume: number, absorption: number): number => (0.161 * volume) / (absorption + 4 * AIR * volume);

/** Where the listener stands below: its bay, that bay's use, and the room's height there. */
function bayUnder(t: Terrain, l: Listener): { i: number; j: number; use: BayUse; height: number } | null {
  const h = t.habitat, b = baysOf(h).bayAt(l.theta, l.s);
  if (!b) return null;
  const lv = levelsOf(t).levelAt(l.theta, l.s);
  return { ...b, use: underOf(h).useAt(b.i, b.j), height: Math.max(1, lv.ceiling - lv.floor) };
}

/** The echo where the listener is: in an entrance court, below the land, or none on the open land. */
export function roomAt(t: Terrain, l: Listener): Room {
  const h = t.habitat;
  if (!l.below) {
    const c = t.courtAt(l.theta, l.s)?.court;
    if (!c) return OPEN;
    // How far down in the court one stands: the echo grows from its rim to its floor.
    const inside = 1 - smoothstep(0, Math.max(0.5, c.depth), l.ground - c.floor);
    if (inside <= 0) return OPEN;
    const R = c.radius, D = Math.max(1, c.depth), disc = Math.PI * R * R;
    const t60 = sabine(disc * D, disc * ABSORB.stone + 2 * Math.PI * R * D * ABSORB.stone + disc * ABSORB.open);
    return { t60, delay: (2 * R) / SOUND, wet: WET.court * inside };
  }
  const b = bayUnder(t, l);
  if (!b) return { t60: 1, delay: 0.02, wet: WET.home };
  const bay = baysOf(h).bay, H = b.height, rp = h.pillars.radius;
  if (b.use === 'home') {
    // A household's walled house of tall rooms: a room half a bay a side, plastered, furnished.
    const L = bay / 2, floor = L * L;
    return { t60: sabine(floor * H, floor * ABSORB.home + floor * ABSORB.plaster + 4 * L * H * ABSORB.plaster), delay: L / SOUND, wet: WET.home };
  }
  // The pillar forest, bay by bay: floor and ceiling screen, one pillar's round face, the air between.
  const floor = bay * bay, pillar = 2 * Math.PI * rp * H * ABSORB.stone;
  const under = b.use === 'cistern' || b.use === 'lake' ? ABSORB.water : b.use === 'hall' ? ABSORB.hall : ABSORB.stone;
  const t60 = sabine(floor * H, floor * under + floor * ABSORB.screen + pillar);
  return { t60, delay: Math.min(bay, 2 * H) / SOUND, wet: b.use === 'hall' ? WET.hall : WET.dim };
}

/**
 * The Understorey's beds round a listener below (each 0 … 1): the pillar forest's room tone everywhere (most in the
 * Dim), the cisterns' water and the works' machines from their bays, each hall's work from its bay (kitchens, baths,
 * workshops, the minds' halls), a home's quiet inside one. Each is heard over HEARD_BAYS past its bay's edge.
 */
export function roomBedsAt(t: Terrain, l: Listener): Record<RoomBed, number> {
  const out = {} as Record<RoomBed, number>;
  for (const b of ROOM_BEDS) out[b] = 0;
  const h = t.habitat, bays = baysOf(h), u = underOf(h), R = h.radius, half = bays.bay / 2;
  if (!bays.bayAt(l.theta, l.s)) { out.dim = 0.6; return out; }
  const closeness = (i: number, j: number): number => {
    const c = bays.centreOf(i, j), d = Math.max(0, floorGap(R, l.theta, l.s, c.theta, c.s) - half) / bays.bay;
    return 1 / (1 + (d / HEARD_BAYS) ** 2);
  };
  out.dim = 0.35;
  for (const { i, j, di, dj } of baysNear(bays, l.theta, l.s, 2)) {
    const use = u.useAt(i, j), w = closeness(i, j);
    const bed: RoomBed | null = use === 'dim' || use === 'gallery' || use === 'lane' ? 'dim'
      : use === 'cistern' || use === 'lake' ? 'cistern'
        : use === 'works' ? 'works'
          : use === 'home' ? (di === 0 && dj === 0 ? 'home' : null)
            : use === 'hall' ? HALL_BED[hallAt(h, i, j) ?? 'commons'] : null;
    if (bed) out[bed] = Math.max(out[bed], bed === 'dim' ? 0.35 + 0.65 * w : w);
  }
  for (const b of ROOM_BEDS) out[b] = clamp(out[b], 0, 1);
  return out;
}

/**
 * How much of the land above comes down to a listener below (0 … 1), muffled: through a wellhead's light well, open to
 * its court, most; nothing through the deck elsewhere.
 */
export function throughDeck(t: Terrain, l: Listener): number {
  if (!l.below) return 0;
  const b = bayUnder(t, l);
  return b?.use === 'well' ? 0.5 : 0;
}

/** The Understorey's floor under a point (m over the profile). */
export function floorBelow(t: Terrain, theta: number, s: number): number {
  return levelsOf(t).levelAt(theta, s).floor;
}
