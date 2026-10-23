/**
 * The habitat's body from outside, as meshes in the blueprint frame (+z from the wild wall to the port wall, r from
 * the axis), built from the blueprint's exterior (blueprint/exterior.ts). Every size comes from the habitat.
 *
 * The drum's solar skin (SKIN), the radiators, endcap faces and brims (RADIATOR) and the mast's whips (HARDWARE), all
 * turning with the body; the despun spindle with its berth arms' docking collars (HARDWARE), which the view poses
 * without the spin. The berth arms, the mast and the dishes are not here: from afar too they are the root tiles of
 * their detail parts (gen/hullParts.ts, drawn by render/necklace.ts), the same trusses and petals the near tiles
 * refine, so nothing changes form as the eye comes close.
 */
import type { BufferGeometry } from 'three/webgpu';
import { ShapeBuilder as Builder, type RGB } from './geometry';
import { berthArmAt, type Habitat } from '../blueprint';
import { antennas } from '../gen/hullParts';

/** Albedos of the hardware: the pale spindle, the grey mast. */
const SPINDLE: RGB = [0.55, 0.55, 0.56];
const MAST: RGB = [0.32, 0.31, 0.3];
/** The berths' docking collars and clamps. */
const COLLAR: RGB = [0.7, 0.68, 0.62];
const CLAMP: RGB = [0.2, 0.2, 0.21];
/** Segments around the drum: the facets stay within a few centimetres of the true circle even for the largest habitats. */
const DRUM_SEGMENTS = 2048;
const DRUM_ROWS_PER_TURN = 16;

export interface HullGeometry {
  /** The drum's solar skin (SKIN). */
  skin: BufferGeometry;
  /** Endcap faces and brims (RADIATOR). */
  radiators: BufferGeometry;
  /** The mast's whips, turning with the body (HARDWARE). */
  mast: BufferGeometry;
  /** The despun spindle and its berths' collars (HARDWARE). */
  spindle: BufferGeometry;
}

/** A berth's end along +x from the spindle's skin: the collar a ship's lock mates with, and four clamps. */
function berthEnd(length: number, width: number): Builder {
  const b = new Builder(24, true), w = width / 2;
  // The collar: a short ring facing out along the arm (built around z, turned to x).
  const ring = new Builder(24, true), rc = width * 0.9, deep = width * 0.5;
  ring.band(0, rc, deep, rc, 0, 1, COLLAR);
  ring.band(deep, rc, deep, rc * 0.7, 1, 0, COLLAR);
  ring.band(0, rc * 0.7, 0, rc, -1, 0, COLLAR);
  b.append(ring, [0, 1, 0], [0, 0, 1], [1, 0, 0], [length - deep, 0, 0]);
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box([length - deep * 0.5, y * rc * 1.1, z * rc * 1.1], [deep * 0.5, w * 0.25 + Math.abs(z) * w * 0.25, w * 0.25 + Math.abs(y) * w * 0.25], CLAMP);
  return b;
}

export function hullGeometry(h: Habitat): HullGeometry {
  const x = h.exterior, Ro = x.radius;
  // In rows about a sixteenth of the way around long: a triangle as long as the drum holds its depth too loosely.
  const skin = new Builder(DRUM_SEGMENTS, false), rows = Math.ceil((x.portFace - x.wildFace) / ((2 * Math.PI * Ro) / DRUM_ROWS_PER_TURN));
  for (let k = 0; k < rows; k++) skin.band(x.wildFace + ((x.portFace - x.wildFace) * k) / rows, Ro, x.wildFace + ((x.portFace - x.wildFace) * (k + 1)) / rows, Ro, 0, 1);

  const rad = new Builder(512, false);
  // The faces: the wild one closed to the axis (the mast leaves from its centre), the port one open for the spindle.
  rad.band(x.wildFace, 0, x.wildFace, Ro, -1, 0);
  rad.band(x.portFace, Ro, x.portFace, h.params.hubRadius, 1, 0);
  for (const b of x.brims) {
    // A flat ring in the endcap's plane, both faces radiating, with its rim. Each face's front is the side its normal
    // points to: the material draws both sides and turns the normal round on the back, so a face wound the other way
    // would be lit as the side facing away.
    const z0 = b.z - b.thickness / 2, z1 = b.z + b.thickness / 2;
    rad.band(z0, b.inner, z0, b.tip, -1, 0);
    rad.band(z1, b.tip, z1, b.inner, 1, 0);
    rad.band(z0, b.tip, z1, b.tip, 0, 1);
  }

  const mast = new Builder(32, true);
  const spindle = new Builder(64, true);
  const s = x.spindle, arms = s.arms;
  spindle.band(x.portFace, s.radius, s.to, s.radius, 0, 1, SPINDLE);
  spindle.band(s.to, s.radius, s.to, 0, 1, 0, SPINDLE);
  // Berth arms' ends, where ships tie up: a docking collar and clamps at each arm's tip.
  for (let i = 0; i < s.berthArms; i++) {
    const [ca, sa] = berthArmAt(s, i);
    const out = [ca, sa, 0], around = [-sa, ca, 0], axial = [0, 0, 1];
    spindle.append(berthEnd(arms.length, arms.width), out, around, axial, [ca * s.radius, sa * s.radius, arms.z]);
  }
  // The mast's whips, beside the dish on its tip.
  const m = x.mast, whips = antennas(h).whips;
  for (let k = 0; k < whips.length; k++) {
    const a = (k / whips.length) * 2 * Math.PI, whip = new Builder(4, true), len = whips[k], w = m.radius * 0.08;
    whip.box([0, 0, len / 2], [w, w, len / 2], MAST);
    mast.append(whip, [Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0], [0, 0, 1], [Math.cos(a) * m.radius * 0.7, Math.sin(a) * m.radius * 0.7, m.from - len]);
  }
  return { skin: skin.build(), radiators: rad.build(), mast: mast.build(), spindle: spindle.build() };
}
