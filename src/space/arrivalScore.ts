/**
 * What the passenger hears and reads on the arrival after Start (design "Solarpolis: how it sounds", the title flight):
 * the ship's cabin round them, its thrusters as it slows up its corridor and trims its creep in, the berth's contact
 * and clamps, the lock, then the bore's great bearing rumbling past and the air that brings them up to the spin. The
 * ship's Mind speaks only as text on screen (Arnd, 2026-10-23: no voice). Everything is placed by the arrival's
 * moments (cinema.ts `ArrivalMoments`), so a habitat whose ships come in slower or whose bore is longer sounds so.
 * Pure: the title music plays over it (main.ts), the player schedules it (audio/sound.ts `arrival`).
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import { ARRIVAL, SPIN_UP, type ArrivalMoments } from './cinema';
import { CLAMP_CLUNKS, SEALED } from './dock';

/** The loops under the arrival: the cabin, a steady thruster burn, the bearing, the air turning the passenger. */
export const SHIP_BEDS = ['ship/cabin', 'ship/burn', 'ship/bearing', 'body/rush'] as const;
export type ShipBed = (typeof SHIP_BEDS)[number];

/** A one-shot of the arrival: which sound, which take, when (s since Start), how loud, at what pitch. */
export interface ScoreCue {
  sound: string;
  take: number;
  t: number;
  gain: number;
  pitch: number;
}

/** A line of the ship's Mind on screen, from `from` to `to` (s since Start). */
export interface Caption {
  from: number;
  to: number;
  text: string;
}

export interface ArrivalScore {
  cues: ScoreCue[];
  captions: Caption[];
  /** Each loop's loudness (0 … 1) at `e` s since Start. */
  beds(e: number): Record<ShipBed, number>;
}

/**
 * The ship's Mind, to its passenger: on the approach, just before the berth, and in the bore. Calm, a little dry, and
 * about what is really happening (the arm turning to meet them, the spin the air brings them up to).
 */
export const MIND_LINES = [
  "Final approach. Their arm is coming round to meet us; I'll match its turn.",
  "Gently now. A ship this size touches its berth the way you'd set down a full cup.",
  'Through you go. Past the bearing the air turns with them. Let it carry you round.',
] as const;

/** How long a line of the Mind stays up at least (s), and when the first comes. */
const LINE = 6, FIRST_LINE = 1.5;
/** The lock, this long after shot 6 begins (s). The clamps' clunks and the seal are the berth's own (space/dock.ts). */
const LOCK = 0.2;
/** Loudness of each loop at its fullest. */
const CABIN = 0.5, BURN = 0.55, BEARING = 0.8, RUSH = 0.4;
/** How fast a loop comes in or goes (s). */
const EDGE = 0.4;

const ramp = (x: number): number => Math.min(1, Math.max(0, x / EDGE));

/** The arrival's score, from its moments and the ship's seed (the pitches of its pulses). */
export function arrivalScore(m: ArrivalMoments, seed: number): ArrivalScore {
  const vary = (n: number, k: number): number => hashToFloat(hash3i(seed, n, k, 0x5c0e));
  const cues: ScoreCue[] = m.pulses.map((t, n) => ({ sound: 'ship/thruster', take: 0, t, gain: 0.5 + 0.2 * vary(n, 1), pitch: 0.9 + 0.2 * vary(n, 2) }));
  cues.push({ sound: 'ship/contact', take: 0, t: m.berth, gain: 0.9, pitch: 1 });
  CLAMP_CLUNKS.forEach((d, k) => cues.push({ sound: 'ship/clamp', take: k, t: m.berth + d, gain: 0.7, pitch: 0.95 + 0.1 * vary(k, 3) }));
  if (m.berth + SEALED < m.through) cues.push({ sound: 'ship/seal', take: 0, t: m.berth + SEALED, gain: 0.6, pitch: 1 });
  cues.push({ sound: 'ship/airlock', take: 0, t: m.through + LOCK, gain: 0.55, pitch: 1 });
  cues.sort((a, b) => a.t - b.t);
  // The second line ends as the ship touches; the third comes once the passenger is in the bore.
  const second = Math.max(FIRST_LINE + LINE, m.berth - LINE + 0.5);
  const captions: Caption[] = [
    { from: FIRST_LINE, to: FIRST_LINE + LINE, text: MIND_LINES[0] },
    { from: second, to: second + LINE, text: MIND_LINES[1] },
    { from: m.through + 2, to: Math.min(ARRIVAL, m.through + 2 + LINE + 2), text: MIND_LINES[2] },
  ];
  return {
    cues,
    captions,
    beds(e: number): Record<ShipBed, number> {
      const out: Record<ShipBed, number> = { 'ship/cabin': 0, 'ship/burn': 0, 'ship/bearing': 0, 'body/rush': 0 };
      if (e < 0 || e >= ARRIVAL) return out;
      if (e < m.through) out['ship/cabin'] = CABIN * ramp(e) * ramp(m.through - e);
      for (const [a, b] of m.burns) if (e >= a && e < b) out['ship/burn'] = BURN * ramp(e - a) * ramp(b - e);
      if (e >= m.through) {
        // The bearing rumbles nearest as the passenger floats past it.
        out['ship/bearing'] = BEARING * ramp(e - m.through) * (0.3 + 0.7 * Math.exp(-(((e - m.bearing) / 4) ** 2)));
        // Past it the air moves against them, less as it brings them up to the spin.
        if (e > m.bearing) out['body/rush'] = RUSH * ramp(e - m.bearing) * Math.max(0, 1 - (e - m.bearing) / SPIN_UP);
      }
      return out;
    },
  };
}

/** The Mind's line on screen at `e` s since Start, if any. */
export function captionAt(s: ArrivalScore, e: number): string | null {
  return s.captions.find((c) => e >= c.from && e < c.to)?.text ?? null;
}
