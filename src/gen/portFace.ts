/**
 * The port face at night (plan "The Threshold", the flight in): the face never sees the Sun (the axis points at an
 * ecliptic pole), so what a newcomer sees of it coming in is the life behind it. The endcap's layer stack, between the
 * land and the face, holds the port quarter, and in a turning habitat every floor is a ring round the axis, so its
 * storeys show on the face as rings of windows, without a word of explanation:
 *
 * - the dock halls next to the spindle, where gravity is light and goods are moved by hand: tall halls in cool working
 *   light, lit day and night;
 * - the port town further out: lodgings for crews and newcomers, workshops, warm light, more of it in the habitat's
 *   night;
 * - the rim galleries near full gravity: promenades and star lounges, the one side of the habitat where the stars are
 *   always out, in long ribbon windows kept dim so people inside can see them;
 * - and the bearing ring round the spindle's foot, a seam of lamps where the turning face meets the still dock.
 *
 * Windows stand in blocks: a few storeys high, a few windows wide, like buildings set into the face, and some blocks
 * are blank. Each window is lit or dark by the hour; a window's light changes on its own slow schedule.
 *
 * Every size comes from the habitat: the bands' radii from the hub radius and the outer radius, storeys from the
 * handrail (as the hamlets' homes, gen/homes.ts), the light from the rooms' light (`Skin.roomLight`). Everything is
 * drawn by integer hashes of the skin's seed (`hash3i`), so the shader (render/hullShaders.ts, `portFaceGlow`) draws
 * the very same windows per pixel, and the tests count them here. Pure: no three.js, no DOM.
 */
import { hash3i, hashToFloat, type Vec3 } from '@futuremagic/core';
import { toLuminance1, type Habitat } from '../blueprint';
import type { Skin } from './skin';

export type PortBandKind = 'docks' | 'town' | 'galleries';

export interface PortBand {
  kind: PortBandKind;
  /** Where the band runs on the face, from the axis (m). */
  r0: number;
  r1: number;
  /** A storey's height (m): the band's rings of windows are this far apart. */
  storey: number;
  /** A window's width with its mullion, along the ring (m). */
  pitch: number;
  /** Where a window's sill and head are in its storey (shares of the storey, from its inner side). */
  sill: number;
  head: number;
  /** The mullion between two windows, as a share of the pitch. */
  mullion: number;
  /** A block is `blockStoreys` storeys high and `blockWindows` windows wide; `blocks` is the share of them built. */
  blockStoreys: number;
  blockWindows: number;
  blocks: number;
  /** A lit window's luminance (outside units: white paper in full sunlight is 1) and colour (luminance 1). */
  glow: number;
  tint: Vec3;
  /** The share of windows lit in the habitat's full day and in its night. */
  litDay: number;
  litNight: number;
}

export interface PortFace {
  /** The skin's seed: the windows are drawn from it. */
  seed: number;
  /** The face's place along the axis (blueprint frame, m). */
  z: number;
  /** The bearing ring's lamps: from the spindle's skin out to `bearingR1` (m), `bearingLamps` round it. */
  bearingR0: number;
  bearingR1: number;
  bearingLamps: number;
  bearingGlow: number;
  bands: PortBand[];
}

/** The hash's third argument for the port face, past the skin's own (`SALT` in gen/skin.ts); each band its own four. */
export const PORT_SALT = { block: 32, lit: 33, phase: 34, shade: 35, blockLit: 36 } as const;
const bandSalt = (salt: number, band: number): number => salt + band * 8;

/** A storey, in handrails: tall rooms (as gen/homes.ts). */
const STOREY = 4;
/** How long a window keeps its light on or off, in hours, at least (each its own, up to twice this). */
export const TOGGLE_HOURS = 0.75;
/** The bearing ring: how wide (in hub radii) and how far apart its lamps stand (in handrails). */
const BEARING = { width: 0.06, spacing: 3 };

/** The colours of the bands' light (luminance 1, Rec. 709): cool working light, warm lamplight, dim amber. */
export const PORT_TINT: Record<PortBandKind | 'bearing', Vec3> = {
  docks: toLuminance1([0.82, 0.92, 1]),
  town: toLuminance1([1, 0.72, 0.42]),
  galleries: toLuminance1([1, 0.78, 0.5]),
  bearing: toLuminance1([1, 0.9, 0.75]),
};

/**
 * Each band: its radii (in hub radii, `hub`, or shares of the outer radius, `outer`, added), its storey and window in
 * storeys, its blocks, its light as a share of a room lit like the land (`Skin.roomLight`), and how many windows are
 * lit by day and by night. Shares, not sizes: every size comes from the habitat.
 */
const BANDS: { kind: PortBandKind; from: { hub: number; outer: number }; to: { hub: number; outer: number }; storeys: number; pitch: number; sill: number; head: number; mullion: number; blockStoreys: number; blockWindows: number; blocks: number; light: number; litDay: number; litNight: number }[] = [
  { kind: 'docks', from: { hub: 1.25, outer: 0 }, to: { hub: 4, outer: 0 }, storeys: 2.5, pitch: 0.6, sill: 0.4, head: 0.85, mullion: 0.06, blockStoreys: 1, blockWindows: 5, blocks: 0.7, light: 0.5, litDay: 0.75, litNight: 0.7 },
  { kind: 'town', from: { hub: 6, outer: 0 }, to: { hub: 6, outer: 0.15 }, storeys: 1, pitch: 0.8, sill: 0.3, head: 0.78, mullion: 0.18, blockStoreys: 3, blockWindows: 8, blocks: 0.55, light: 0.25, litDay: 0.25, litNight: 0.7 },
  { kind: 'galleries', from: { hub: 0, outer: 0.88 }, to: { hub: 0, outer: 0.96 }, storeys: 1.5, pitch: 0.7, sill: 0.18, head: 0.86, mullion: 0.05, blockStoreys: 1, blockWindows: 24, blocks: 0.7, light: 0.12, litDay: 0.35, litNight: 0.85 },
];

export function portFaceOf(h: Habitat, skin: Skin): PortFace {
  const x = h.exterior, hub = h.params.hubRadius, Ro = x.radius, rail = h.params.exterior.parts.handrail, storey = STOREY * rail;
  const bands: PortBand[] = [];
  for (const b of BANDS) {
    const r0 = b.from.hub * hub + b.from.outer * Ro, r1 = Math.min(b.to.hub * hub + b.to.outer * Ro, Ro);
    const s = b.storeys * storey;
    // A band too narrow for two storeys, or running into the one before it, is left out.
    if (r1 - r0 < 2 * s || bands.some((o) => o.r1 > r0)) continue;
    bands.push({
      kind: b.kind, r0, r1, storey: s, pitch: b.pitch * s, sill: b.sill, head: b.head, mullion: b.mullion,
      blockStoreys: b.blockStoreys, blockWindows: b.blockWindows, blocks: b.blocks,
      glow: b.light * skin.roomLight, tint: PORT_TINT[b.kind], litDay: b.litDay, litNight: b.litNight,
    });
  }
  const bearingR0 = x.spindle.radius, bearingR1 = bearingR0 * (1 + BEARING.width);
  return {
    seed: skin.seed, z: x.portFace, bearingR0, bearingR1,
    bearingLamps: Math.max(8, Math.round((2 * Math.PI * bearingR1) / (BEARING.spacing * rail))),
    bearingGlow: 0.6 * skin.roomLight, bands,
  };
}

/** The share of a band's windows lit, by how far into its night the habitat is (0 full day, 1 night). */
export function litShare(b: PortBand, night: number): number {
  const k = Math.min(1, Math.max(0, night));
  return b.litDay + (b.litNight - b.litDay) * k;
}

/** How many windows round a block row whose inner edge is at r (each ring of a block has the same, so they stack). */
export function windowsRound(b: PortBand, r: number): number {
  return Math.max(1, Math.floor((2 * Math.PI * r) / b.pitch));
}

/** A window on the face: its storey and number round its ring, and its own shade (0.5–1). */
export interface PortWindow {
  band: number;
  storey: number;
  index: number;
  shade: number;
}

/**
 * The window at radius r and angle θ (rad) on the face, or null for blank face, a mullion, a wall between sill and
 * head, or a block left out. The shader finds the same window per pixel.
 */
export function windowAt(f: PortFace, r: number, theta: number): PortWindow | null {
  for (let i = 0; i < f.bands.length; i++) {
    const b = f.bands[i];
    if (r < b.r0 || r >= b.r1) continue;
    const u = (r - b.r0) / b.storey, k = Math.floor(u), fr = u - k;
    if (fr < b.sill || fr >= b.head) return null;
    const kb = Math.floor(k / b.blockStoreys), n = windowsRound(b, b.r0 + kb * b.blockStoreys * b.storey);
    const a = ((theta / (2 * Math.PI)) % 1 + 1) % 1, v = a * n, j = Math.floor(v), fj = v - j;
    if (fj < b.mullion / 2 || fj >= 1 - b.mullion / 2) return null;
    if (hashToFloat(hash3i(f.seed, kb, Math.floor(j / b.blockWindows), bandSalt(PORT_SALT.block, i))) >= b.blocks) return null;
    return { band: i, storey: k, index: j, shade: 0.5 + 0.5 * hashToFloat(hash3i(f.seed, k, j, bandSalt(PORT_SALT.shade, i))) };
  }
  return null;
}

/** Hours on the window clock: the clock (s) in hours, wrapped so a float32 holds it to about a second. */
export const WINDOW_CLOCK_WRAP = 4096;
export const windowHours = (t: number): number => {
  const h = t / 3600;
  return h - Math.floor(h / WINDOW_CLOCK_WRAP) * WINDOW_CLOCK_WRAP;
};

/** Whether a window is lit at `hours` (`windowHours`) with `share` of its band lit: each on its own slow schedule. */
export function windowLit(f: PortFace, w: PortWindow, hours: number, share: number): boolean {
  const salt = (s: number): number => bandSalt(s, w.band);
  const period = TOGGLE_HOURS * (1 + hashToFloat(hash3i(f.seed, w.storey, w.index, salt(PORT_SALT.phase))));
  const slot = Math.floor(hours / period + hashToFloat(hash3i(f.seed, w.index, w.storey, salt(PORT_SALT.phase))));
  return hashToFloat(hash3i(f.seed, w.storey + 4096 * slot, w.index, salt(PORT_SALT.lit))) < share;
}

/** A window's glass: the share of its storey and of its pitch that is glazed. */
const glazed = (b: PortBand): number => (b.head - b.sill) * (1 - b.mullion);

/** A window's mean shade (`PortWindow.shade` runs evenly over 0.5–1). */
export const MEAN_SHADE = 0.75;

/**
 * A block's light seen from too far to tell its windows apart, but near enough to tell the blocks (outside units):
 * its glass at the mean shade, lit by its own share around the band's (as many above as below it, so the blocks keep
 * the band's mean), and none for a block left out. The face reads as buildings, some brighter, some dark, not paint.
 */
export function blockGlow(f: PortFace, band: number, kb: number, jb: number, share: number): number {
  const b = f.bands[band];
  if (hashToFloat(hash3i(f.seed, kb, jb, bandSalt(PORT_SALT.block, band))) >= b.blocks) return 0;
  const spread = 2 * Math.min(share, 1 - share), x = hashToFloat(hash3i(f.seed, kb, jb, bandSalt(PORT_SALT.blockLit, band)));
  return glazed(b) * (share + (x - 0.5) * spread) * MEAN_SHADE * b.glow;
}

/**
 * The face's mean luminance over a band (outside units), its windows' light spread over it: what the face shows from
 * too far for one window to be told apart, and what the shader fades to before the windows would alias.
 */
export function bandMean(b: PortBand, night: number): number {
  return glazed(b) * b.blocks * litShare(b, night) * b.glow * MEAN_SHADE;
}
