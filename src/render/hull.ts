/**
 * The habitat's body from outside, as meshes in the blueprint frame (+z from the wild wall to the port wall, r from
 * the axis), built from the blueprint's exterior (blueprint/exterior.ts). Every size comes from the habitat.
 *
 * Four pieces, one per kind: the drum's solar skin (SKIN), the radiators, endcap faces and brims (RADIATOR), the mast
 * (HARDWARE), all turning with the body; and the despun spindle with its berth arms (HARDWARE), which the view poses
 * without the spin.
 */
import type { BufferGeometry } from 'three/webgpu';
import { ShapeBuilder as Builder, type RGB } from './geometry';
import type { Habitat } from '../blueprint';
import { Rng, deriveSeed } from '@futuremagic/core';

/** Albedos of the hardware: the pale spindle and arms, the grey mast. */
const SPINDLE: RGB = [0.55, 0.55, 0.56];
const MAST: RGB = [0.32, 0.31, 0.3];
/** The berths' docking collars and clamps, and the antennas' dishes. */
const COLLAR: RGB = [0.7, 0.68, 0.62];
const CLAMP: RGB = [0.2, 0.2, 0.21];
const DISH: RGB = [0.8, 0.8, 0.78];
/** Segments around the drum: the facets stay within a few centimetres of the true circle even for the largest habitats. */
const DRUM_SEGMENTS = 2048;

export interface HullGeometry {
  /** The drum's solar skin (SKIN). */
  skin: BufferGeometry;
  /** Endcap faces and brims (RADIATOR). */
  radiators: BufferGeometry;
  /** The mast, turning with the body (HARDWARE). */
  mast: BufferGeometry;
  /** The despun spindle and its berth arms (HARDWARE). */
  spindle: BufferGeometry;
}

/** A berth arm along +x from the spindle's skin: the spar, then the collar a ship's lock mates with, and four clamps. */
function berthArm(length: number, width: number): Builder {
  const b = new Builder(24, true), w = width / 2;
  b.box([length / 2, 0, 0], [length / 2, w, w], SPINDLE);
  // The collar: a short ring facing out along the arm (built around z, turned to x).
  const ring = new Builder(24, true), rc = width * 0.9, deep = width * 0.5;
  ring.band(0, rc, deep, rc, 0, 1, COLLAR);
  ring.band(deep, rc, deep, rc * 0.7, 1, 0, COLLAR);
  ring.band(0, rc * 0.7, 0, rc, -1, 0, COLLAR);
  b.append(ring, [0, 1, 0], [0, 0, 1], [1, 0, 0], [length - deep, 0, 0]);
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box([length - deep * 0.5, y * rc * 1.1, z * rc * 1.1], [deep * 0.5, w * 0.25 + Math.abs(z) * w * 0.25, w * 0.25 + Math.abs(y) * w * 0.25], CLAMP);
  return b;
}

/** A parabolic dish of diameter d looking out along +z from its foot at the origin, on a mast `boom` long, with its feed. */
function dish(d: number, boom: number): Builder {
  const b = new Builder(32, true), r = d / 2, f = d * 0.4, rings = 5;
  const zAt = (x: number): number => boom + (x * x) / (4 * f);
  for (let k = 0; k < rings; k++) {
    const r0 = (k / rings) * r, r1 = ((k + 1) / rings) * r, z0 = zAt(r0), z1 = zAt(r1);
    const l = Math.hypot(r1 - r0, z1 - z0), nz = (r1 - r0) / l, nr = (z1 - z0) / l;
    // The bowl, both faces: inside looking out along +z, the back away from it.
    b.band(z1, r1, z0, r0, nz, -nr, DISH);
    b.band(z0, r0, z1, r1, -nz, nr, DISH);
  }
  const w = d * 0.015;
  b.box([0, 0, boom / 2], [w * 2, w * 2, boom / 2], MAST);
  b.box([0, 0, boom + f / 2], [w, w, f / 2], MAST);
  return b;
}

export function hullGeometry(h: Habitat): HullGeometry {
  const x = h.exterior, Ro = x.radius;
  const skin = new Builder(DRUM_SEGMENTS, false);
  skin.band(x.wildFace, Ro, x.portFace, Ro, 0, 1);

  const rad = new Builder(512, false);
  // The faces: the wild one closed to the axis (the mast leaves from its centre), the port one open for the spindle.
  rad.band(x.wildFace, 0, x.wildFace, Ro, -1, 0);
  rad.band(x.portFace, Ro, x.portFace, h.params.hubRadius, 1, 0);
  for (const b of x.brims) {
    // A flat ring in the endcap's plane, both faces radiating, with its rim.
    const z0 = b.z - b.thickness / 2, z1 = b.z + b.thickness / 2;
    rad.band(z0, b.tip, z0, b.inner, -1, 0);
    rad.band(z1, b.inner, z1, b.tip, 1, 0);
    rad.band(z0, b.tip, z1, b.tip, 0, 1);
  }

  const mast = new Builder(32, true);
  mast.band(x.mast.from, x.mast.radius, x.wildFace, x.mast.radius, 0, 1, MAST);
  mast.band(x.mast.from, 0, x.mast.from, x.mast.radius, -1, 0, MAST);

  const spindle = new Builder(64, true);
  const s = x.spindle, arms = s.arms;
  spindle.band(x.portFace, s.radius, s.to, s.radius, 0, 1, SPINDLE);
  spindle.band(s.to, s.radius, s.to, 0, 1, 0, SPINDLE);
  // Berth arms: spokes out from the spindle, where ships tie up, each with a docking collar and clamps at its tip.
  for (let i = 0; i < s.berthArms; i++) {
    const a = (i / s.berthArms) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const out = [ca, sa, 0], around = [-sa, ca, 0], axial = [0, 0, 1];
    spindle.append(berthArm(arms.length, arms.width), out, around, axial, [ca * s.radius, sa * s.radius, arms.z]);
  }
  // Antennas: dishes on the despun spindle's tip (they can hold still against the stars), whips and a dish on the
  // spinning mast's tip.
  const rng = new Rng(deriveSeed(h.seed, 'exterior', 'antennas'));
  const ant = h.params.exterior.antennas, hub = h.params.hubRadius;
  for (let k = 0; k < ant.count; k++) {
    const a = ((k + rng.range(-0.2, 0.2)) / ant.count) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const size = ant.dish * hub * rng.range(0.4, 1), tilt = rng.range(0.25, 0.9);
    // The dish looks out along the axis, tipped outward by `tilt`.
    const ez = [ca * Math.sin(tilt), sa * Math.sin(tilt), Math.cos(tilt)], ey = [-sa, ca, 0];
    const ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
    const foot = [ca * s.radius * 0.6, sa * s.radius * 0.6, s.to];
    spindle.append(dish(size, size * 0.35), ex, ey, ez, foot);
  }
  const m = x.mast;
  const mastTip = [0, 0, m.from];
  mast.append(dish(ant.dish * hub * 0.5, ant.dish * hub * 0.2), [1, 0, 0], [0, -1, 0], [0, 0, -1], mastTip);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * 2 * Math.PI, whip = new Builder(4, true), len = hub * rng.range(0.4, 0.8), w = m.radius * 0.08;
    whip.box([0, 0, len / 2], [w, w, len / 2], MAST);
    mast.append(whip, [Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0], [0, 0, 1], [Math.cos(a) * m.radius * 0.7, Math.sin(a) * m.radius * 0.7, m.from - len]);
  }
  return { skin: skin.build(), radiators: rad.build(), mast: mast.build(), spindle: spindle.build() };
}
