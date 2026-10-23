/**
 * The lounge under the arriving ship's nose (space/lounge.ts), drawn for the arrival's cabin shot (space/cinema.ts):
 * its floor and ceiling, the wall round it with the deep reveals of its panoramic windows (the same openings the hull
 * shows from outside), wooden ledges along the sills with a rail under them, beams across the ceiling over the
 * pillars, the core up its middle, the couches facing the glass on their rugs, and the lamps in the ceiling's cove.
 * Meshes in the ship frame (+x to the nose), posed with the ship each frame of the shot and hidden otherwise. The ship's
 * own hull faces outward only, so from in here it is not drawn: the room stands in for it.
 *
 * The room is lit in loungeShaders.ts; `lit` hands it the light of the frame: the Sun in the ship frame, and what
 * the windows let in (`windowLight`, metered by the caller on the view outside).
 */
import type { BufferGeometry } from 'three/webgpu';
import type { Vec3 } from '@futuremagic/core';
import { LOUNGE, toShipDirection, windowHalf, type Lounge } from '../space';
import type { RGB } from '../gen/shapes';
import { PosedMeshes, ShapeBuilder, posedMesh } from './geometry';
import { LAMP, LOUNGE_ROOM } from './materials';
import { loungeLight } from './loungeShaders';
import { shipAxes, shipAxisShape } from './ship';

/** The room's albedos (linear): a dark warm carpet, pale walls and ceiling, satin metal reveals, a wooden core, leather. */
const FLOOR: RGB = [0.11, 0.095, 0.08];
const WALL: RGB = [0.56, 0.53, 0.48];
const CEILING: RGB = [0.62, 0.6, 0.56];
const REVEAL: RGB = [0.22, 0.22, 0.23];
const CORE: RGB = [0.3, 0.18, 0.1];
const COUCH: RGB = [0.34, 0.2, 0.11];
const CUSHION: RGB = [0.4, 0.26, 0.15];
/** The window ledges (the core's wood), the brass rail under them, the beams across the ceiling, the rugs. */
const LEDGE: RGB = CORE;
const RAIL: RGB = [0.45, 0.33, 0.16];
const BEAM: RGB = [0.44, 0.42, 0.39];
const RUG: RGB = [0.07, 0.1, 0.1];
/** A ledge's depth into the room and thickness, the rail's height under the sill and its thickness, a beam's width and depth (m). */
const LEDGE_DEEP = 0.2, LEDGE_THICK = 0.04, RAIL_UNDER = 0.2, RAIL_THICK = 0.035, BEAM_WIDE = 0.12, BEAM_DEEP = 0.1;
/** A rug reaches this far (m) in front of its couch's seat, behind its back, and past its ends. */
const RUG_FRONT = 0.75, RUG_BACK = 0.45, RUG_ENDS = 0.4;
/** The cove's light strip (luminance, relative to sunlit white paper) and the faint line along the foot of the wall. */
const COVE: RGB = [0.09, 0.075, 0.055];
const FOOT: RGB = [0.03, 0.025, 0.02];
/** The cove's strip: this far in from the wall, this wide (m). */
const COVE_IN = 0.35, COVE_WIDE = 0.2;
/** Segments round the room. */
const AROUND = 96;

/** A point of the ship frame (x along the axis, r out from it at angle a) in the builder's frame (it works around its z). */
const inShip = (x: number, r: number, a: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), x];
/** Out from the axis at angle a, and the ship's axis, in the builder's frame. */
const radial = (a: number): Vec3 => [Math.cos(a), Math.sin(a), 0];
const AXIS: Vec3 = [0, 0, 1];

/** The lounge's room (LOUNGE_ROOM) and its lamps (LAMP), in the ship frame. */
export function loungeGeometry(l: Lounge): { room: BufferGeometry; lamps: BufferGeometry } {
  const b = new ShapeBuilder(AROUND, true), lit = new ShapeBuilder(AROUND, true), w = l.windows, all = 2 * Math.PI;
  const R = l.radius, H = l.hull, sill = l.floor + w.sill, head = sill + w.high, half = windowHalf(l), step = all / w.count;
  // Floor and ceiling (to the core, or to the axis), the wall under the sills and over the heads (its front faces in).
  b.arc(l.floor, R, l.floor, l.core, 1, 0, 0, all, AROUND, FLOOR);
  b.arc(l.ceiling, l.core, l.ceiling, R, -1, 0, 0, all, AROUND, CEILING);
  b.arc(sill, R, l.floor, R, 0, -1, 0, all, AROUND, WALL);
  b.arc(l.ceiling, R, head, R, 0, -1, 0, all, AROUND, WALL);
  if (l.core > 0) b.arc(l.floor, l.core, l.ceiling, l.core, 0, 1, 0, all, AROUND, CORE);
  for (let k = 0; k < w.count; k++) {
    const a = w.turn + k * step;
    // The pillar to the next window, then this one's reveals through the hull's thickness: its sill, head and jambs.
    b.arc(head, R, sill, R, 0, -1, a + half, a + step - half, 2, WALL);
    b.arc(sill, H, sill, R, 1, 0, a - half, a + half, 2, REVEAL);
    b.arc(head, R, head, H, -1, 0, a - half, a + half, 2, REVEAL);
    for (const side of [-1, 1]) {
      const e = a + side * half, into: Vec3 = [Math.sin(e) * side, -Math.cos(e) * side, 0];
      b.faceToward(inShip(sill, R, e), inShip(sill, H, e), inShip(head, H, e), inShip(head, R, e), into, REVEAL);
    }
    // A wooden ledge along the sill to lean on, a rail under it to hold on to, a beam across the ceiling over the pillar.
    const u = radial(a), v = radial(a + Math.PI / 2), chord = R * Math.sin(half);
    b.block(inShip(sill - LEDGE_THICK / 2, R - LEDGE_DEEP / 2, a), u, v, AXIS, [LEDGE_DEEP / 2, chord, LEDGE_THICK / 2], LEDGE);
    b.block(inShip(sill - RAIL_UNDER, R - 0.07, a), u, v, AXIS, [RAIL_THICK / 2, chord * 0.92, RAIL_THICK / 2], RAIL);
    const p = a + step / 2, inner = Math.max(l.core, 0.3);
    b.block(inShip(l.ceiling - BEAM_DEEP / 2, (R + inner) / 2, p), radial(p), radial(p + Math.PI / 2), AXIS, [(R - inner) / 2, BEAM_WIDE / 2, BEAM_DEEP / 2], BEAM);
  }
  // The couches: a seat, a back toward the axis with its cushion, an arm at each end.
  const c = LOUNGE.couch;
  for (const couch of l.couches) {
    const a = couch.angle, u = radial(a), v = radial(a + Math.PI / 2), z = AXIS;
    const width = couch.places.length * c.place + 0.1, mid = (r: number, x: number): Vec3 => inShip(x, r, a);
    // The rug the couch stands on (just over the floor; its front faces the ceiling, as the floor's does).
    const span = (width / 2 + RUG_ENDS) / couch.out, inner = Math.max(couch.out - c.deep / 2 - RUG_BACK, l.core + 0.05);
    b.arc(l.floor + 0.004, Math.min(couch.out + c.deep / 2 + RUG_FRONT, R - 0.05), l.floor + 0.004, inner, 1, 0, a - span, a + span, 8, RUG);
    b.block(mid(couch.out, l.floor + c.seat / 2), u, v, z, [c.deep / 2, width / 2, c.seat / 2], COUCH, true);
    b.block(mid(couch.out - c.deep / 2 - 0.08, l.floor + c.back / 2), u, v, z, [0.08, width / 2, c.back / 2], COUCH, true);
    b.block(mid(couch.out - c.deep / 2 + 0.06, l.floor + c.seat + 0.22), u, v, z, [0.06, width / 2 - 0.04, 0.2], CUSHION);
    for (const side of [-1, 1]) {
      const o = side * (width / 2 + 0.06), centre = mid(couch.out - 0.04, l.floor + (c.seat + 0.2) / 2);
      b.block([centre[0] + v[0] * o, centre[1] + v[1] * o, centre[2]], u, v, z, [c.deep / 2 + 0.04, 0.06, (c.seat + 0.2) / 2], COUCH, true);
    }
  }
  // The lamps: the cove's strip round the ceiling, one round the core's head, a faint line at the foot of the wall.
  lit.arc(l.ceiling - 0.01, R - COVE_IN - COVE_WIDE, l.ceiling - 0.01, R - COVE_IN, -1, 0, 0, all, AROUND, COVE);
  if (l.core > 0) lit.arc(l.ceiling - 0.01, l.core + 0.1, l.ceiling - 0.01, l.core + 0.1 + COVE_WIDE, -1, 0, 0, all, AROUND, COVE);
  lit.arc(l.floor + 0.005, R - 0.02, l.floor + 0.005, R - 0.06, 1, 0, 0, all, AROUND, FOOT);
  shipAxisShape(b);
  shipAxisShape(lit);
  return { room: b.build(), lamps: lit.build() };
}

/** The ship's pose in the frame the eye is in: its stern, nose and up. */
export interface ShipPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/** The lounge's meshes: into the scene once (behind the title), posed in the cabin shot, hidden in every other. */
export class LoungeView extends PosedMeshes {
  constructor(readonly lounge: Lounge, name: string) {
    const g = loungeGeometry(lounge);
    super([posedMesh(g.room, LOUNGE_ROOM.material, `${name} lounge`), posedMesh(g.lamps, LAMP.material, `${name} lounge lamps`)]);
  }

  /** Shown round the eye with the ship at `ship` (its frame's axes: the scene's). */
  aboard(ship: ShipPose, eye: Vec3): void {
    this.poseAll(shipAxes(ship.forward, ship.up), [ship.position[0] - eye[0], ship.position[1] - eye[1], ship.position[2] - eye[2]]);
  }

  /**
   * Lit by the Sun (`sunDir` in the scene, `sunlight` its light there) and by what its windows look out on
   * (`windows`, space/lounge.ts `windowLight`).
   */
  lit(ship: ShipPose, sunDir: Vec3, sunlight: number, windows: { all: number; toward: Vec3 }): void {
    const s = toShipDirection(ship, sunDir), l = this.lounge;
    loungeLight.sun.value.set(s[0], s[1], s[2], sunlight);
    loungeLight.windows.value.set(...windows.toward, windows.all);
    loungeLight.lamps.value = LOUNGE.lamps;
    loungeLight.room.value.set(l.radius, l.core, l.floor + l.windows.sill, l.floor + l.windows.sill + l.windows.high);
    loungeLight.glass.value.set(l.windows.count, l.windows.turn, windowHalf(l));
  }
}
