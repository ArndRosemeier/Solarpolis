/**
 * The stand-in for a person beyond the near figures (render/people.ts): one small body for everyone, drawn instanced
 * (the CROWD kind), so a crowd of thousands is one draw. It has the figure's proportions at height 1 (feet at 0, up
 * +y, facing +z, the person's left at +x), every part tagged with what it wears (a colour slot) and the joint it swings
 * from, so the shader can walk it, kneel it or lay it down. Each person's height, width, gait and colours come per
 * instance (`STAND_IN_STRIDE` floats), from the same look their Actors figure is built from, so the two match in size,
 * colour and silhouette when they hand over (CLAUDE.md, rule 16). Pure.
 */
import { hash3i } from '@futuremagic/core';
import type { Vec3 } from '../blueprint';

/** What a part wears: skin, hair, the top, the forearms (sleeve or skin), the bottom, the shins, the shoes. */
export const SLOT = { skin: 0, hair: 1, top: 2, sleeve: 3, bottom: 4, shin: 5, shoes: 6 } as const;
export type Slot = keyof typeof SLOT;
export const SLOTS = Object.keys(SLOT) as Slot[];

/**
 * The limb a part belongs to (0: the trunk and head), so the shader knows how it swings: thighs from the hips, shins
 * from the knees and then the hips, upper arms from the shoulders, forearms from the elbows and then the shoulders.
 */
export const LIMB = { trunk: 0, thighL: 1, shinL: 2, thighR: 3, shinR: 4, armL: 5, forearmL: 6, armR: 7, forearmR: 8 } as const;

/** The joints, at height 1 (y up from the soles, x to the left). */
export const JOINT = {
  hip: { x: 0.055, y: 0.52 },
  knee: { y: 0.285 },
  ankle: { y: 0.045 },
  shoulder: { x: 0.125, y: 0.815 },
  elbow: { x: 0.145, y: 0.63 },
  wrist: { x: 0.155, y: 0.48 },
} as const;

/** A person's height before their look is measured (m): about Actors' grown bodies' middle. */
export const MEAN_HEIGHT = 1.7;

/** How a stand-in stands (`pose` per instance): upright (walking or standing; swimmers too, sunk), kneeling, lying on its back. */
export const POSE = { upright: 0, kneel: 1, lie: 2 } as const;

/**
 * Floats per instance, in five vec4 attributes (materials.ts, `layInstances`):
 *   stand  foot (x, y, z relative to the mesh), height (m)
 *   gait   turn (rad, as plants), stride phase (rad), stride rate (rad/s; 0 standing), pose
 *   light  width (× the mean body's), horizon port, horizon wild (rad), skin colour
 *   wear   hair, top, sleeve, bottom colours
 *   feet   shin, shoes colours, and two spare
 * Colours are sRGB bytes packed in one float (`packColor`).
 */
export const STAND_IN_STRIDE = 20;
export const STAND_IN_ATTRIBUTES = ['stand', 'gait', 'light', 'wear', 'feet'] as const;

/** An sRGB colour (0..1 each) as one float: three bytes, exact in a 32-bit float. */
export function packColor(c: readonly [number, number, number]): number {
  const b = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
  return b(c[0]) + b(c[1]) * 256 + b(c[2]) * 65536;
}

/** An sRGB hex colour ('#rrggbb') as 0..1 channels. */
export function hexColor(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [0.5, 0.5, 0.5];
}

/** Garment colours (sRGB) the residents dress in (render/actors/residents.ts): light, quiet, natural dyes, and a few strong ones. */
export const DYES = ['#e6e1d6', '#d2bd98', '#8b8e93', '#5b6470', '#3566a8', '#2f6b45', '#a8b8c0', '#c9a27e', '#f1efe9', '#5f6838', '#8a4b2a', '#b9504a', '#d8b04a', '#1f7a7a', '#3b3f46'];

/** A procedural skin's colour from its tone (0 light … 1 dark), sRGB. */
export function skinTone(t: number): [number, number, number] {
  const light = [0.87, 0.72, 0.62], dark = [0.3, 0.2, 0.15];
  return [0, 1, 2].map((k) => light[k] + (dark[k] - light[k]) * t) as [number, number, number];
}

/** A packed colour (`packColor`) back as 0..1 channels. */
export function unpackColor(v: number): [number, number, number] {
  return [(v % 256) / 255, (Math.floor(v / 256) % 256) / 255, Math.floor(v / 65536) / 255];
}

/**
 * A speck (render/specks.ts): someone further off than the stand-ins, drawn as the few pixels they cover. Floats per
 * instance, in four vec4 attributes (materials.ts, `layInstances`):
 *   speckFoot   feet (world, m), height (m)
 *   speckDrift  their way over the floor (world, m/s), pose
 *   speckTint   head, top, bottom colours (packed, as the stand-in's), and one spare
 *   speckSky    horizon port, horizon wild (rad), width (× the mean), and one spare
 * Whether a speck is drawn at all is its own attribute (`SPECK_SHOWN`, one float): 0 where a nearer level draws them.
 */
export const SPECK_STRIDE = 16;
export const SPECK_ATTRIBUTES = ['speckFoot', 'speckDrift', 'speckTint', 'speckSky'] as const;
export const SPECK_SHOWN = 'speckShown';
/** Where a body's bands meet, as shares of its height: the bottom below the waist, the head above the neck. */
export const WAIST = 0.55;
export const NECK = 0.87;
/** How deep a body is, and how much of its outline (height by width) it fills, at height 1 (from the stand-in's body). */
export const BODY_DEPTH = 0.2;
export const BODY_WIDTH = 0.3;
export const BODY_FILL = 0.55;

/**
 * A speck's three bands (packed) from a stand-in's colours by slot: the head (hair and face), the top (with the
 * forearms) and the legs (the bottom, the shins and the shoes), each as the stand-in shows it from a little way off.
 */
export function speckBands(colors: readonly number[]): [number, number, number] {
  const mixed = (...parts: [Slot, number][]): number => {
    const c = [0, 0, 0];
    for (const [slot, w] of parts) unpackColor(colors[SLOT[slot]]).forEach((v, k) => { c[k] += v * w; });
    return packColor(c as [number, number, number]);
  };
  return [mixed(['hair', 0.6], ['skin', 0.4]), mixed(['top', 0.8], ['sleeve', 0.2]), mixed(['bottom', 0.6], ['shin', 0.3], ['shoes', 0.1])];
}

/**
 * A speck's bands for someone whose look is not measured yet: drawn from the same dyes and skin tones their look is
 * (by their look's seed), so a far crowd has the colours of the crowd it will be close up; any one of them is under a
 * pixel there. A shell is plated in one paint.
 */
export function guessBands(look: number, shell: boolean): [number, number, number] {
  const pick = (k: number): number => hash3i(look, k, 41, 0) >>> 0;
  const dye = (k: number): number => packColor(hexColor(DYES[pick(k) % DYES.length]));
  if (shell) return [dye(1), dye(1), dye(2)];
  const skin = skinTone((pick(3) % 1000) / 1000), hair = hexColor(DYES[[14, 10, 7, 3][pick(4) % 4]]);
  const head = packColor([0, 1, 2].map((k) => hair[k] * 0.6 + skin[k] * 0.4) as [number, number, number]);
  return [head, dye(5), dye(6)];
}

/** A person's speck instance (`SPECK_STRIDE` floats at `o`): feet (world), height, drift (world, m/s), pose, bands, horizons, width. */
export function writeSpeck(d: Float32Array, o: number, feet: Vec3, height: number, drift: Vec3, pose: number, bands: readonly number[], horizon: readonly [number, number], width: number): void {
  d[o] = feet[0]; d[o + 1] = feet[1]; d[o + 2] = feet[2]; d[o + 3] = height;
  d[o + 4] = drift[0]; d[o + 5] = drift[1]; d[o + 6] = drift[2]; d[o + 7] = pose;
  d[o + 8] = bands[0]; d[o + 9] = bands[1]; d[o + 10] = bands[2]; d[o + 11] = 0;
  d[o + 12] = horizon[0]; d[o + 13] = horizon[1]; d[o + 14] = width; d[o + 15] = 0;
}

export interface StandInArrays {
  positions: Float32Array;
  normals: Float32Array;
  /** Per vertex: colour slot, limb. */
  parts: Float32Array;
  index: Uint32Array;
}

/** Sides around a limb or the trunk. */
const AROUND = 8;

/** The stand-in's body: tapered tubes for the trunk and limbs, an egg for the head with a cap of hair, boxes for the feet. */
export function standInArrays(): StandInArrays {
  const pos: number[] = [], nrm: number[] = [], part: number[] = [], idx: number[] = [];
  const vertex = (p: Vec3, n: Vec3, slot: number, limb: number): number => {
    pos.push(...p);
    const l = Math.hypot(...n) || 1;
    nrm.push(n[0] / l, n[1] / l, n[2] / l);
    part.push(slot, limb);
    return pos.length / 3 - 1;
  };
  /** A segment of the body from a to b (mostly vertical), elliptic: half-widths across (x) and deep (z) at each end, closed at both. */
  const segment = (a: Vec3, b: Vec3, wa: [number, number], wb: [number, number], slot: number, limb: number): void => {
    const ring = (c: Vec3, w: [number, number]): number[] => {
      const out: number[] = [];
      for (let k = 0; k < AROUND; k++) {
        const t = (2 * Math.PI * k) / AROUND, x = Math.cos(t), z = Math.sin(t);
        out.push(vertex([c[0] + w[0] * x, c[1], c[2] + w[1] * z], [x / w[0], 0, z / w[1]], slot, limb));
      }
      return out;
    };
    const lo = ring(a, wa), hi = ring(b, wb);
    for (let k = 0; k < AROUND; k++) {
      const k1 = (k + 1) % AROUND;
      idx.push(lo[k], lo[k1], hi[k1], lo[k], hi[k1], hi[k]);
    }
    const capOf = (c: Vec3, w: [number, number], up: number): void => {
      const centre = vertex(c, [0, up, 0], slot, limb), rim: number[] = [];
      for (let k = 0; k < AROUND; k++) {
        const t = (2 * Math.PI * k) / AROUND;
        rim.push(vertex([c[0] + w[0] * Math.cos(t), c[1], c[2] + w[1] * Math.sin(t)], [0, up, 0], slot, limb));
      }
      for (let k = 0; k < AROUND; k++) {
        const k1 = (k + 1) % AROUND;
        if (up > 0) idx.push(centre, rim[k1], rim[k]); else idx.push(centre, rim[k], rim[k1]);
      }
    };
    capOf(a, wa, a[1] < b[1] ? -1 : 1);
    capOf(b, wb, a[1] < b[1] ? 1 : -1);
  };
  /** An egg (ellipsoid) around c with half-axes r, the part of it above `from` (−1 … 1 of its height). */
  const egg = (c: Vec3, r: Vec3, slot: number, from = -1, grow = 1): void => {
    const rows = 6, start = vertex([c[0], c[1] + r[1] * grow, c[2]], [0, 1, 0], slot, LIMB.trunk);
    let prev: number[] = [];
    for (let j = 1; j <= rows; j++) {
      const y = Math.cos((Math.PI * j) / rows);
      if (y < from - 1e-9) break;
      const rr = Math.sqrt(Math.max(0, 1 - y * y)), row: number[] = [];
      for (let k = 0; k < AROUND; k++) {
        const t = (2 * Math.PI * k) / AROUND, x = rr * Math.cos(t), z = rr * Math.sin(t);
        row.push(vertex([c[0] + r[0] * x * grow, c[1] + r[1] * y * grow, c[2] + r[2] * z * grow], [x / r[0], y / r[1], z / r[2]], slot, LIMB.trunk));
      }
      for (let k = 0; k < AROUND; k++) {
        const k1 = (k + 1) % AROUND;
        if (j === 1) idx.push(start, row[k1], row[k]);
        else idx.push(prev[k], prev[k1], row[k1], prev[k], row[k1], row[k]);
      }
      prev = row;
    }
  };
  const box = (lo: Vec3, hi: Vec3, slot: number, limb: number): void => {
    const faces: [Vec3, Vec3[]][] = [
      [[1, 0, 0], [[hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [hi[0], lo[1], hi[2]]]],
      [[-1, 0, 0], [[lo[0], lo[1], hi[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]], [lo[0], lo[1], lo[2]]]],
      [[0, 1, 0], [[lo[0], hi[1], lo[2]], [lo[0], hi[1], hi[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[1], lo[2]]]],
      [[0, 0, 1], [[lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]]],
      [[0, 0, -1], [[hi[0], lo[1], lo[2]], [lo[0], lo[1], lo[2]], [lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]]]],
    ];
    for (const [n, q] of faces) {
      const v = q.map((p) => vertex(p, n, slot, limb));
      idx.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    }
  };

  const { hip, knee, ankle, shoulder, elbow, wrist } = JOINT;
  // Head and hair: the hair a cap over the crown and back, a little proud of the head.
  egg([0, 0.935, 0.005], [0.05, 0.065, 0.06], SLOT.skin);
  egg([0, 0.94, -0.005], [0.053, 0.064, 0.062], SLOT.hair, 0.1, 1.04);
  segment([0, 0.845, 0], [0, 0.885, 0], [0.025, 0.025], [0.024, 0.024], SLOT.skin, LIMB.trunk);
  // Trunk: chest and waist in the top, the pelvis in the bottom.
  segment([0, 0.62, 0], [0, 0.8, 0], [0.085, 0.055], [0.115, 0.06], SLOT.top, LIMB.trunk);
  segment([0, 0.8, 0], [0, 0.845, 0], [0.115, 0.06], [0.045, 0.035], SLOT.top, LIMB.trunk);
  segment([0, 0.55, 0], [0, 0.62, 0], [0.095, 0.06], [0.085, 0.055], SLOT.top, LIMB.trunk);
  segment([0, 0.47, 0], [0, 0.55, 0], [0.095, 0.06], [0.095, 0.06], SLOT.bottom, LIMB.trunk);
  for (const side of [1, -1]) {
    const L = side > 0;
    const x = hip.x * side;
    segment([x, knee.y, 0], [x, hip.y - 0.02, 0], [0.034, 0.036], [0.05, 0.052], SLOT.bottom, L ? LIMB.thighL : LIMB.thighR);
    segment([x, ankle.y, -0.005], [x, knee.y, 0], [0.022, 0.024], [0.033, 0.035], SLOT.shin, L ? LIMB.shinL : LIMB.shinR);
    box([x - 0.035, 0, -0.04], [x + 0.035, ankle.y + 0.01, 0.11], SLOT.shoes, L ? LIMB.shinL : LIMB.shinR);
    segment([elbow.x * side, elbow.y, 0], [shoulder.x * side, shoulder.y - 0.01, 0], [0.026, 0.028], [0.034, 0.036], SLOT.top, L ? LIMB.armL : LIMB.armR);
    segment([wrist.x * side, wrist.y, 0.005], [elbow.x * side, elbow.y, 0], [0.019, 0.021], [0.026, 0.028], SLOT.sleeve, L ? LIMB.forearmL : LIMB.forearmR);
    segment([wrist.x * side * 1.02, wrist.y - 0.09, 0.012], [wrist.x * side, wrist.y, 0.005], [0.012, 0.02], [0.019, 0.022], SLOT.skin, L ? LIMB.forearmL : LIMB.forearmR);
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), parts: Float32Array.from(part), index: Uint32Array.from(idx) };
}
