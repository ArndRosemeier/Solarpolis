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
import { BORE_LAMPS, BORE_LIGHT, LAMP_GLOW } from './hullShaders';

/** Panels around the tube; a panel is as long as the tube's radius, a rib every RIB_EVERY panels. */
const AROUND = 16;
const RIB_EVERY = 4;
/** The walls' albedo, panel to panel within ± SPREAD; the seal's and the ribs'. */
const WALL: RGB = [0.72, 0.71, 0.68];
/** The walls' mean albedo, as the exposure meter sees them. */
export const BORE_ALBEDO = (WALL[0] + WALL[1] + WALL[2]) / 3;
const SPREAD = 0.06;
const SEAL: RGB = [0.12, 0.12, 0.13];
const RIB: RGB = [0.55, 0.55, 0.53];
const RAIL: RGB = [0.3, 0.32, 0.36];
/** The Hub's light at the tube's end: the interior's daylight on pale ground, relative to full sunlight. */
export const HUB_LIGHT = 0.3;

/** The window in the sleeve: panels around and along it, and where along the sleeve it sits (share of its length). */
const WINDOW = { around: 2, along: 1, at: 0.5 };

export interface BoreGeometry {
  /** Each part's walls and lamps, relative to the bearing on the axis (spindle or body frame). */
  still: { walls: ShapeBuilder; lamps: ShapeBuilder };
  turning: { walls: ShapeBuilder; lamps: ShapeBuilder };
}

/** The bore's shapes for a habitat (every size from its blueprint). */
export function boreShapes(h: Habitat): BoreGeometry {
  const b = h.exterior.spindle.bore, r = b.radius, rng = new Rng(deriveSeed(h.seed, 'bore'));
  const rel = (z: number): number => z - b.bearing;
  const boreRun = (z0: number, z1: number, skip: (i: number, j: number) => boolean): { walls: ShapeBuilder; lamps: ShapeBuilder } => {
    const walls = new ShapeBuilder(AROUND, true), lamps = new ShapeBuilder(AROUND, true);
    const rows = Math.max(1, Math.round((z1 - z0) / r)), dz = (z1 - z0) / rows;
    const at = (i: number, z: number, rr = r): Vec3 => {
      const a = (i / AROUND) * 2 * Math.PI;
      return [rr * Math.cos(a), rr * Math.sin(a), z];
    };
    for (let j = 0; j < rows; j++) {
      const za = rel(z0 + j * dz), zb = rel(z0 + (j + 1) * dz);
      for (let i = 0; i < AROUND; i++) {
        if (skip(i, j)) continue;
        // Facing the axis: counter-clockwise seen from inside.
        const mid = ((i + 0.5) / AROUND) * 2 * Math.PI, n: Vec3 = [-Math.cos(mid), -Math.sin(mid), 0];
        const k = 1 + rng.range(-SPREAD, SPREAD), c: RGB = [WALL[0] * k, WALL[1] * k, WALL[2] * k];
        walls.quad(at(i, za), at(i, zb), at(i + 1, zb), at(i + 1, za), n, c);
      }
      if (j > 0 && j % RIB_EVERY === 0) {
        // A rib: a shallow ring standing in from the wall.
        const zr = za, w = r * 0.04, inner = r * 0.94;
        walls.band(zr + w, inner, zr - w, inner, 0, -1, RIB);
        walls.band(zr - w, inner, zr - w, r, -1, 0, RIB);
        walls.band(zr + w, inner, zr + w, r, 1, 0, RIB);
      }
    }
    // The lamp strips along the wall, between window panels left out; a hand line between two strips.
    const glow = BORE_LIGHT * LAMP_GLOW, lamp: RGB = [glow, glow * 0.97, glow * 0.9], half = (0.012 * 2 * Math.PI) / 2;
    for (let s = 0; s < BORE_LAMPS; s++) {
      const a = (s / BORE_LAMPS) * 2 * Math.PI, i = Math.floor((s / BORE_LAMPS) * AROUND + 0.5) % AROUND;
      for (let j = 0; j < rows; j++) {
        if (skip(i, j) || skip((i + AROUND - 1) % AROUND, j)) continue;
        const za = rel(z0 + j * dz) + r * 0.05, zb = rel(z0 + (j + 1) * dz) - r * 0.05, rr = r * 0.99;
        const onWall = (an: number, z: number): Vec3 => [rr * Math.cos(an), rr * Math.sin(an), z];
        lamps.quad(onWall(a - half, za), onWall(a - half, zb), onWall(a + half, zb), onWall(a + half, za), [-Math.cos(a), -Math.sin(a), 0], lamp);
      }
    }
    const ra = (0.5 / BORE_LAMPS) * 2 * Math.PI, rr = r * 0.86;
    walls.box([rr * Math.cos(ra), rr * Math.sin(ra), (rel(z0) + rel(z1)) / 2], [r * 0.02, r * 0.02, (z1 - z0) / 2], RAIL);
    return { walls, lamps };
  };

  const still = boreRun(b.bearing, b.to, () => false);
  // The seal at the bearing, and the still part's closed end at the arms (their junction is beyond it).
  still.walls.band(r * 0.06, r * 0.999, 0, r * 0.999, 0, -1, SEAL);
  still.walls.band(rel(b.to), 0, rel(b.to), r, -1, 0, RIB);

  const rows = Math.max(1, Math.round((b.bearing - b.from) / r)), wj = Math.min(rows - 1, Math.floor(rows * WINDOW.at));
  const inWindow = (i: number, j: number): boolean => i < WINDOW.around && j >= wj && j < wj + WINDOW.along;
  const turning = boreRun(b.from, b.bearing, inWindow);
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
