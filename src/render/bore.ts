/**
 * The spindle's bore (design "Solarpolis: the outside", "Docking with a spinning habitat"): the tube on the axis
 * that people float through from the berth arms to the Hub. The still part runs from the arms to the bearing at the
 * port face and is posed with the spindle; past the bearing's seal the sleeve turns with the habitat, through the
 * endcap's layers to the Hub, with one small window out to the stars. Pale panelled walls (BORE, lit by the lamp
 * strips that run along the tube) and the strips themselves (LAMP). At the Hub's end the tube opens into the interior,
 * which this view does not draw: a disc of the Hub's daylight stands in for it until the outside and inside views
 * share one scene (Arnd, 2026-10-21: a short fade for now).
 *
 * Built relative to the bearing, so float32 holds the walls to well under a millimetre wherever the habitat is.
 */
import { Mesh } from 'three/webgpu';
import { Rng, deriveSeed, v3add, type Vec3 } from '@futuremagic/core';
import type { Habitat } from '../blueprint';
import { apply, type Mat3 } from '../space';
import { ShapeBuilder, posedMesh, setPose, type RGB } from './geometry';
import { BORE, LAMP } from './materials';
import { BORE_LAMPS, BORE_LIGHT, LAMP_GLOW, boreHoopPitch } from './hullShaders';

/** Panels around the tube; a panel is as long as the tube's radius, with a seam round it (share of the radius). */
const AROUND = 16;
const SEAM = 0.012;
/** The walls' albedo (warm ivory), panel to panel within ± SPREAD; the seams behind them, the seal's. */
const WALL: RGB = [0.78, 0.74, 0.66];
/** The walls' mean albedo, as the exposure meter sees them. */
export const BORE_ALBEDO = (WALL[0] + WALL[1] + WALL[2]) / 3;
const SPREAD = 0.06;
const SEAM_COLOUR: RGB = [0.2, 0.19, 0.18];
const SEAL: RGB = [0.12, 0.12, 0.13];
/** The hoops' frames: the still part's in deep teal, the turning sleeve's in terracotta, so which is which reads at a glance. */
const FRAME_STILL: RGB = [0.08, 0.26, 0.28];
const FRAME_TURNING: RGB = [0.42, 0.16, 0.08];
const RAIL: RGB = [0.22, 0.23, 0.25];
/** The handholds: warm brass, worn bright by hands. */
const BRASS: RGB = [0.66, 0.46, 0.18];
const BEARING_RACE: RGB = [0.5, 0.36, 0.16];
/** The Hub's light at the tube's end: the interior's daylight on pale ground, relative to full sunlight. */
export const HUB_LIGHT = 0.3;

/**
 * The bore's hall (plan "The Threshold", step 5: "the bore is a hall, not a pipe"), in radii of the tube: hoops of warm
 * light every `pitch` from the bearing (each in a frame standing `deep` in from the wall, `wide` along it, its light
 * `glow` × BORE_LIGHT's white paper); guide rails between the strips `rail` in from the wall on stand-offs, a brass
 * handhold beside each; amber chevrons pointing the way to the Hub halfway between hoops; and at the bearing, a bronze
 * race on either side of the seal, the sleeve's carrying a broken ring of lights that turns with it (`TURNING_LIGHTS`
 * of them), the still side's a whole one, so the turn is seen against it.
 */
export const BORE_HALL = { pitch: 2, deep: 0.07, wide: 0.05, glow: 14, rail: 0.13, race: 0.3, chevron: { glow: 6, wide: 0.3, long: 0.24, thick: 0.07 } } as const;
const HOOP: RGB = [1, 0.84, 0.62];
const CHEVRON: RGB = [1, 0.56, 0.16];
export const TURNING_LIGHTS = 24;

/** The window in the sleeve: panels around and along it, and where along the sleeve it sits (share of its length). */
const WINDOW = { around: 2, along: 1, at: 0.5 };

/** The sleeve's window out to the stars, relative to the bearing: angles round the axis and the stretch along it (m). */
export function boreWindow(h: Habitat): { a0: number; a1: number; z0: number; z1: number } {
  const b = h.exterior.spindle.bore, rows = Math.max(1, Math.round((b.bearing - b.from) / b.radius)), dz = (b.bearing - b.from) / rows;
  const wj = Math.min(rows - 1, Math.floor(rows * WINDOW.at));
  return { a0: 0, a1: (WINDOW.around / AROUND) * 2 * Math.PI, z0: b.from - b.bearing + wj * dz, z1: b.from - b.bearing + (wj + WINDOW.along) * dz };
}

export interface BoreGeometry {
  /** Each part's walls and lamps, relative to the bearing on the axis (spindle or body frame). */
  still: { walls: ShapeBuilder; lamps: ShapeBuilder };
  turning: { walls: ShapeBuilder; lamps: ShapeBuilder };
}

/** The bore's shapes for a habitat (every size from its blueprint). */
export function boreShapes(h: Habitat): BoreGeometry {
  const b = h.exterior.spindle.bore, r = b.radius, rng = new Rng(deriveSeed(h.seed, 'bore')), H = BORE_HALL, pitch = H.pitch * r;
  const rel = (z: number): number => z - b.bearing;
  const wallPoint = (a: number, z: number, rr = r): Vec3 => [rr * Math.cos(a), rr * Math.sin(a), z];
  const inward = (a: number): Vec3 => [-Math.cos(a), -Math.sin(a), 0];
  const boreRun = (z0: number, z1: number, frame: RGB, skip: (i: number, j: number) => boolean): { walls: ShapeBuilder; lamps: ShapeBuilder } => {
    const walls = new ShapeBuilder(AROUND * 4, true), lamps = new ShapeBuilder(AROUND * 4, true);
    const rows = Math.max(1, Math.round((z1 - z0) / r)), dz = (z1 - z0) / rows, step = (2 * Math.PI) / AROUND, gap = SEAM * r;
    for (let j = 0; j < rows; j++) {
      const za = rel(z0 + j * dz) + gap, zb = rel(z0 + (j + 1) * dz) - gap;
      for (let i = 0; i < AROUND; i++) {
        if (skip(i, j)) continue;
        // The seam: a dark cell at the wall, the panel just in front of it a seam's width short all round. Facing the
        // axis: counter-clockwise seen from inside.
        walls.quad(wallPoint(i * step, za - gap), wallPoint(i * step, zb + gap), wallPoint((i + 1) * step, zb + gap), wallPoint((i + 1) * step, za - gap), inward((i + 0.5) * step), SEAM_COLOUR);
        const a0 = i * step + gap / r, a1 = (i + 1) * step - gap / r, rr = r * 0.997;
        const k = 1 + rng.range(-SPREAD, SPREAD), c: RGB = [WALL[0] * k, WALL[1] * k, WALL[2] * k];
        walls.quad(wallPoint(a0, za, rr), wallPoint(a0, zb, rr), wallPoint(a1, zb, rr), wallPoint(a1, za, rr), inward((i + 0.5) * step), c);
      }
    }
    // The lamp strips along the wall, between window panels left out.
    const glow = BORE_LIGHT * LAMP_GLOW, lamp: RGB = [glow, glow * 0.95, glow * 0.86], half = (0.012 * 2 * Math.PI) / 2;
    for (let s = 0; s < BORE_LAMPS; s++) {
      const a = (s / BORE_LAMPS) * 2 * Math.PI, i = Math.floor((s / BORE_LAMPS) * AROUND + 0.5) % AROUND;
      for (let j = 0; j < rows; j++) {
        if (skip(i, j) || skip((i + AROUND - 1) % AROUND, j)) continue;
        const za = rel(z0 + j * dz) + r * 0.05, zb = rel(z0 + (j + 1) * dz) - r * 0.05, rr = r * 0.99;
        lamps.quad(wallPoint(a - half, za, rr), wallPoint(a - half, zb, rr), wallPoint(a + half, zb, rr), wallPoint(a + half, za, rr), inward(a), lamp);
      }
    }
    // The hoops: a frame standing in from the wall, its inner face a ring of warm light, every pitch from the bearing.
    const hoop: RGB = [HOOP[0] * BORE_LIGHT * H.glow, HOOP[1] * BORE_LIGHT * H.glow, HOOP[2] * BORE_LIGHT * H.glow];
    const lo = rel(z0), hi = rel(z1), w = (H.wide * r) / 2, inner = r * (1 - H.deep);
    for (let n = Math.ceil((lo + w) / pitch); n * pitch <= hi - w; n++) {
      const z = n * pitch;
      if (n === 0) continue;
      walls.band(z - w, inner, z - w, r * 0.994, -1, 0, frame);
      walls.band(z + w, r * 0.994, z + w, inner, 1, 0, frame);
      lamps.band(z + w, inner, z - w, inner, 0, -1, hoop);
    }
    // The guide rails between the strips, on stand-offs two rows apart, each with a brass handhold beside it.
    const zAxis: Vec3 = [0, 0, 1], railR = r * (1 - H.rail), t = r * 0.018;
    for (let s = 0; s < BORE_LAMPS; s++) {
      const a = ((s + 0.5) / BORE_LAMPS) * 2 * Math.PI, side: Vec3 = [-Math.sin(a), Math.cos(a), 0], inn = inward(a);
      const mid = wallPoint(a, (lo + hi) / 2, railR);
      walls.block(mid, zAxis, side, inn, [(hi - lo) / 2 - r * 0.02, t, t], RAIL);
      for (let j = 0; j < rows; j += 2) {
        const z = rel(z0 + (j + 0.5) * dz), foot = (r * 0.99 - railR) / 2;
        // The stand-off, from the wall in to the rail (open where it meets the wall).
        walls.block(wallPoint(a, z, railR + foot), zAxis, side, inn, [t * 0.8, t * 0.8, foot], RAIL, true);
        // The handhold: a brass bar a hand's width off the wall, beside the rail, on two short posts.
        const ha = a + (r * 0.07) / r, hr = r * 0.95, len = r * 0.13, hs: Vec3 = [-Math.sin(ha), Math.cos(ha), 0], hi2 = inward(ha);
        walls.block(wallPoint(ha, z + r * 0.25, hr), zAxis, hs, hi2, [len, t * 0.7, t * 0.7], BRASS);
        for (const e of [-1, 1]) walls.block(wallPoint(ha, z + r * 0.25 + e * len * 0.85, (hr + r * 0.99) / 2), zAxis, hs, hi2, [t * 0.6, t * 0.6, (r * 0.99 - hr) / 2], BRASS, true);
      }
    }
    // Chevrons pointing the way to the Hub (toward −z), halfway between hoops, on two sides between strip and rail.
    const C = H.chevron, cg = BORE_LIGHT * C.glow, chev: RGB = [CHEVRON[0] * cg, CHEVRON[1] * cg, CHEVRON[2] * cg], cr = r * 0.992;
    for (let n = Math.ceil((lo - pitch / 2) / pitch); (n + 0.5) * pitch <= hi - pitch * 0.1; n++) {
      const tip = (n + 0.5) * pitch - (C.long * r) / 2;
      if (tip < lo + r * 0.1) continue;
      for (const a of [Math.PI / 8, Math.PI + Math.PI / 8]) {
        // Not on the window's glass.
        if (skip(Math.floor(a / step), Math.min(rows - 1, Math.floor((tip - lo) / dz)))) continue;
        const p = (s: number, z: number): Vec3 => wallPoint(a + s / cr, z, cr), hw = C.wide * r, L = C.long * r, T = C.thick * r, n0 = inward(a);
        lamps.quad(p(-hw, tip + L), p(-hw, tip + L + T), p(0, tip + T), p(0, tip), n0, chev);
        lamps.quad(p(0, tip), p(0, tip + T), p(hw, tip + L + T), p(hw, tip + L), n0, chev);
      }
    }
    return { walls, lamps };
  };

  const still = boreRun(b.bearing, b.to, FRAME_STILL, () => false);
  const win = boreWindow(h), rows = Math.max(1, Math.round((b.bearing - b.from) / r)), dz = (b.bearing - b.from) / rows;
  const inWindow = (i: number, j: number): boolean => {
    const a = ((i + 0.5) / AROUND) * 2 * Math.PI, z = b.from - b.bearing + (j + 0.5) * dz;
    return a > win.a0 && a < win.a1 && z > win.z0 && z < win.z1;
  };
  const turning = boreRun(b.from, b.bearing, FRAME_TURNING, inWindow);
  // The bearing: the seal between two bronze races, the still part's closed end at the arms.
  const race = BORE_HALL.race * r, rr = r * 0.97;
  still.walls.band(r * 0.06, r * 0.999, 0, r * 0.999, 0, -1, SEAL);
  still.walls.band(race, rr, r * 0.06, rr, 0, -1, BEARING_RACE);
  still.walls.band(race, r * 0.996, race, rr, 1, 0, BEARING_RACE);
  turning.walls.band(0, rr, -race, rr, 0, -1, BEARING_RACE);
  turning.walls.band(-race, rr, -race, r * 0.996, -1, 0, BEARING_RACE);
  still.walls.band(rel(b.to), 0, rel(b.to), r, -1, 0, FRAME_STILL);
  // Its lights: a whole ring on the still race, a broken one on the turning race, which moves round against it.
  const ring = BORE_LIGHT * BORE_HALL.glow, warm: RGB = [HOOP[0] * ring, HOOP[1] * ring, HOOP[2] * ring], lw = race * 0.15, lr = rr * 0.999;
  still.lamps.band(race * 0.5 + lw, lr, race * 0.5 - lw, lr, 0, -1, warm);
  for (let k = 0; k < TURNING_LIGHTS; k++) {
    const a0 = (k / TURNING_LIGHTS) * 2 * Math.PI, a1 = a0 + (0.45 / TURNING_LIGHTS) * 2 * Math.PI;
    turning.lamps.arc(-race * 0.5 + lw, lr, -race * 0.5 - lw, lr, 0, -1, a0, a1, 2, warm);
  }
  // The Hub's light where the sleeve opens into the interior.
  turning.lamps.band(rel(b.from), r, rel(b.from), 0, 1, 0, [HUB_LIGHT, HUB_LIGHT * 0.97, HUB_LIGHT * 0.9]);
  return { still, turning };
}

/** The bore's four meshes: walls and lamps, still with the spindle and turning with the body (their owner adds and frees `all`). */
export class BoreMeshes {
  private readonly meshes: { mesh: Mesh; turning: boolean }[];
  private readonly bearing: number;

  constructor(h: Habitat, name: string) {
    const s = boreShapes(h);
    this.bearing = h.exterior.spindle.bore.bearing;
    boreHoopPitch.value = BORE_HALL.pitch * h.exterior.spindle.bore.radius;
    const make = (shape: ShapeBuilder, kind: typeof BORE, what: string, turning: boolean): { mesh: Mesh; turning: boolean } => {
      const g = shape.build();
      // Exactly the kind's attributes, or the mesh is not the shader the Stage warmed (a build when the view starts).
      for (const name of Object.keys(g.attributes)) if (!kind.attributes.includes(name)) g.deleteAttribute(name);
      const mesh = posedMesh(g, kind.material, `${name} ${what}`);
      mesh.frustumCulled = false;
      return { mesh, turning };
    };
    this.meshes = [
      make(s.still.walls, BORE, 'bore', false), make(s.still.lamps, LAMP, 'bore lamps', false),
      make(s.turning.walls, BORE, 'sleeve', true), make(s.turning.lamps, LAMP, 'sleeve lamps', true),
    ];
  }

  get all(): Mesh[] { return this.meshes.map((m) => m.mesh); }

  /** With the body's and the spindle's axes in the scene and the body's origin relative to the eye. */
  poseIn(body: Mat3, spindle: Mat3, origin: Vec3): void {
    for (const { mesh, turning } of this.meshes) {
      const axes = turning ? body : spindle;
      setPose(mesh, axes, v3add(origin, apply(axes, [0, 0, this.bearing])));
    }
  }
}
