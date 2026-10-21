/**
 * The habitat's solar skin seen from outside (design "Solarpolis: the outside", O4): a grid of panels around and along
 * the drum. Two centuries of repairs leave a patchwork: repair campaigns renewed patches at a time, single panels
 * were swapped as they failed, and weathering turns the black cells blue. Columns of light collectors (glassy strips
 * that pipe sunlight to the sunline) take the share `derive` asks for; a few panels are starfloor windows, rooms in
 * the living layer looking out, lit from inside.
 *
 * Everything comes from the habitat's seed through integer hashes (`hash3i` from @futuremagic/core), so the shader
 * that draws the skin (render/skyShaders.ts, `skinPanel`) computes the very same panels per pixel, and the far view's
 * glints (`skinFlux`) and the interior's starfloor rooms read the same grid here. Pure: no three.js, no DOM.
 */
import { deriveSeed, hash3i, hashToFloat, type Vec3 } from '@futuremagic/core';
import { SOLAR_CONSTANT, SUNLIGHT_VISIBLE, type Habitat } from '../blueprint';

export type PanelKind = 'cell' | 'collector' | 'starfloor';

export interface Panel {
  kind: PanelKind;
  /** Years since this panel was put in. */
  age: number;
  /** Its own shade within its kind (0–1). */
  shade: number;
}

export interface Skin {
  /** The skin's own seed (32 bits). */
  seed: number;
  /** Panels around the drum and along it, and where the drum runs along the axis (blueprint frame, m). */
  nTheta: number;
  nZ: number;
  z0: number;
  z1: number;
  /** Outer radius of the drum (m). */
  radius: number;
  /** The collectors' share of the columns, in 1/65536 (the shader counts the same integers). */
  collectorQ: number;
  /** Share of the cell panels that are starfloor windows. */
  starfloors: number;
  /** A repair campaign's patch, in panels. */
  around: number;
  along: number;
  /** The habitat's age and a panel's mean life (years). */
  age: number;
  panelLife: number;
  /** A lit room seen through a starfloor window, in the outside's units (white paper in full sunlight is 1). */
  roomLight: number;
}

/** The hash's third argument: which property of a panel or a patch is drawn. */
export const SALT = { campaign: 0, offset: 1, replaced: 2, replacedAge: 3, shade: 4, starfloor: 5, radiator: 6 } as const;

/** The look of each kind: albedo (linear RGB) and how glossy the glass is (0–1). The shader reads these numbers too. */
export const LOOK = {
  /** A new cell panel is near black; weathering turns it the blue of old silicon. */
  cellNew: [0.016, 0.018, 0.026] as Vec3,
  cellOld: [0.05, 0.075, 0.15] as Vec3,
  cellGloss: 0.35,
  /** Collectors: clear glass over light guides, glossy when new, hazed with age. */
  collector: [0.035, 0.04, 0.036] as Vec3,
  collectorGloss: [1, 0.5] as [number, number],
  /** A starfloor window: dark glass, lit from the room behind it. */
  starfloor: [0.012, 0.014, 0.02] as Vec3,
  starfloorGloss: 0.8,
  /** How far one panel's shade may stray from its kind (± half of this share). */
  shade: 0.3,
};

/** Room light behind a starfloor window: a room lit like the floor, white walls at 40 % albedo. */
const ROOM_ALBEDO = 0.4;

export function makeSkin(h: Habitat): Skin {
  const x = h.exterior, p = h.params.exterior;
  const flux = SOLAR_CONSTANT / (h.params.sunDistanceAu * h.params.sunDistanceAu);
  return {
    seed: deriveSeed(h.seed, 'exterior', 'skin'),
    nTheta: Math.max(8, Math.round((2 * Math.PI * x.radius) / p.panel)),
    nZ: Math.max(1, Math.round((x.portFace - x.wildFace) / p.panel)),
    z0: x.wildFace,
    z1: x.portFace,
    radius: x.radius,
    collectorQ: Math.round(Math.min(1, Math.max(0, h.collectorShare)) * 65536),
    starfloors: p.starfloors,
    around: Math.max(1, Math.round(p.campaign.around)),
    along: Math.max(1, Math.round(p.campaign.along)),
    age: h.params.age,
    panelLife: p.panelLife,
    roomLight: (ROOM_ALBEDO * h.params.lightTarget) / (SUNLIGHT_VISIBLE * flux),
  };
}

const u = (s: Skin, x: number, y: number, salt: number): number => hashToFloat(hash3i(s.seed, x, y, salt));

/** Whether column i holds light collectors: spread evenly around, so the light gathered stays even as the drum turns. */
export function isCollector(s: Skin, i: number): boolean {
  return Math.floor(((i + 1) * s.collectorQ) / 65536) !== Math.floor((i * s.collectorQ) / 65536);
}

/** The repair campaign that last renewed the patch holding panel (i, j), and how many years ago. */
export function campaignAt(s: Skin, i: number, j: number): { I: number; J: number; age: number } {
  const I = Math.floor(i / s.around);
  // Each band of columns starts its patches at its own row, so the patches do not line up into a grid.
  const offset = hash3i(s.seed, I, 0, SALT.offset) % s.along;
  const J = Math.floor((j + offset) / s.along);
  return { I, J, age: u(s, I, J, SALT.campaign) * s.age };
}

/** Panel (i, j): column i around from θ = 0, row j along from the wild face. */
export function panelAt(s: Skin, i: number, j: number): Panel {
  const c = campaignAt(s, i, j).age;
  const replaced = u(s, i, j, SALT.replaced) < 1 - Math.exp(-c / s.panelLife);
  const age = replaced ? u(s, i, j, SALT.replacedAge) * c : c;
  const kind: PanelKind = isCollector(s, i) ? 'collector' : u(s, i, j, SALT.starfloor) < s.starfloors ? 'starfloor' : 'cell';
  return { kind, age, shade: u(s, i, j, SALT.shade) };
}

/** Which panel a point of the drum is on (blueprint frame); null off the drum. */
export function panelOf(s: Skin, p: Vec3): { i: number; j: number } | null {
  if (p[2] < s.z0 || p[2] >= s.z1) return null;
  const turn = Math.atan2(p[1], p[0]) / (2 * Math.PI);
  const i = Math.min(s.nTheta - 1, Math.floor((turn - Math.floor(turn)) * s.nTheta));
  const j = Math.min(s.nZ - 1, Math.floor(((p[2] - s.z0) / (s.z1 - s.z0)) * s.nZ));
  return { i, j };
}

export interface Look {
  albedo: Vec3;
  gloss: number;
  /** Light from inside (starfloor windows), in the outside's radiance units. */
  emit: number;
}

/** How weathered a panel of this age looks (0 new, toward 1 old). */
export const weathering = (s: Skin, age: number): number => 1 - Math.exp(-age / s.panelLife);

export function lookOf(s: Skin, p: Panel): Look {
  const w = weathering(s, p.age), k = 1 + LOOK.shade * (p.shade - 0.5);
  if (p.kind === 'collector') {
    return { albedo: scale(LOOK.collector, k * (1 + 0.5 * w)), gloss: LOOK.collectorGloss[0] + (LOOK.collectorGloss[1] - LOOK.collectorGloss[0]) * w, emit: 0 };
  }
  if (p.kind === 'starfloor') return { albedo: LOOK.starfloor, gloss: LOOK.starfloorGloss, emit: s.roomLight };
  const a = LOOK.cellNew.map((n, c) => (n + (LOOK.cellOld[c] - n) * w) * k) as Vec3;
  return { albedo: a, gloss: LOOK.cellGloss, emit: 0 };
}

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

/** The skin's look averaged down each column (sampling `rows` rows), for the far view. */
export interface Columns {
  albedo: Float32Array;
  gloss: Float32Array;
  /** Averages over the whole skin. */
  mean: Look;
}

export function columnsOf(s: Skin, rows = 64): Columns {
  const n = s.nTheta, albedo = new Float32Array(n * 3), gloss = new Float32Array(n);
  const step = Math.max(1, Math.floor(s.nZ / rows)), mean: Look = { albedo: [0, 0, 0], gloss: 0, emit: 0 };
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < s.nZ; j += step, k++) {
      const l = lookOf(s, panelAt(s, i, j));
      for (let c = 0; c < 3; c++) albedo[i * 3 + c] += l.albedo[c];
      gloss[i] += l.gloss;
    }
    for (let c = 0; c < 3; c++) { albedo[i * 3 + c] /= k; mean.albedo[c] += albedo[i * 3 + c]; }
    gloss[i] /= k;
    mean.gloss += gloss[i];
  }
  mean.albedo = scale(mean.albedo, 1 / n);
  mean.gloss /= n;
  // Starfloors are rare: count them over every panel, not over the sampled rows.
  mean.emit = (1 - s.collectorQ / 65536) * s.starfloors * s.roomLight;
  return { albedo, gloss, mean };
}

/** Sharpness of the glass's glint of the Sun, and its strength (the shader's numbers). */
export const GLINT_POWER = 120;
export const GLINT_GAIN = 3;

/**
 * The light of a far habitat's drum at the eye, as flux relative to the Sun's (linear RGB), the same model the near
 * shader draws: each strip of the drum is diffuse at its column's albedo plus the glint of the Sun on its glass. The
 * glint moves across the columns as the drum turns, so the patchwork makes it flicker.
 *
 * `sun` and `toEye` are unit vectors in the habitat's body frame (blueprint axes, turned with the spin); `distance` in m.
 */
export function skinFlux(s: Skin, cols: Columns, sun: Vec3, toEye: Vec3, distance: number, sunlight: number): Vec3 {
  const bins = Math.max(512, s.nTheta), dphi = (2 * Math.PI) / bins, len = s.z1 - s.z0;
  const h = norm([sun[0] + toEye[0], sun[1] + toEye[1], sun[2] + toEye[2]]);
  const out: Vec3 = [0, 0, 0];
  for (let b = 0; b < bins; b++) {
    const phi = (b + 0.5) * dphi, nx = Math.cos(phi), ny = Math.sin(phi);
    const mu = nx * toEye[0] + ny * toEye[1];
    const mu0 = nx * sun[0] + ny * sun[1];
    if (mu <= 0 || mu0 <= 0) continue;
    const i = Math.min(s.nTheta - 1, Math.floor((b / bins) * s.nTheta));
    const lit = mu0 * sunlight;
    const glint = Math.pow(Math.max(0, nx * h[0] + ny * h[1]), GLINT_POWER) * lit * cols.gloss[i] * GLINT_GAIN;
    const w = mu * s.radius * dphi * len;
    for (let c = 0; c < 3; c++) out[c] += (cols.albedo[i * 3 + c] * lit + glint) * w;
  }
  const k = 1 / (Math.PI * distance * distance);
  return [out[0] * k, out[1] * k, out[2] * k];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
