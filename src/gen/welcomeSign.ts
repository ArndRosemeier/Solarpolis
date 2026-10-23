/**
 * The notice that greets newcomers at the port door (Arnd, 2026-10-23: "something to tell the player that the strange
 * control behaviour is not a bug … a big fat warning sign with glowing letters … meant for citizens"). Close to the axis
 * one weighs a small share of what one weighs on the floor, and a body used to full weight overshoots every step. The
 * habitat says so where everyone arrives: a panel of dark glass with glowing letters, hung from the porch's front rib
 * over the walk out of the door (gen/arrivalTerrace.ts, `porchOf`), facing the door, so it is the first thing one reads.
 *
 * What it says comes from the habitat: its name (its Mind's), the gravity on the landing and on the floor, and how
 * much of one's weight is left here. Where the landing is not light (a share of the floor's above `LIGHT`), there is
 * no notice. The case it hangs in is the Lift Stair's (gen/liftStairMesh.ts); the glass and its letters are drawn by
 * render/notice.ts. Pure.
 */
import { v3cross, v3dot, v3madd, v3norm, v3sub } from '@futuremagic/core';
import type { Habitat, Vec3 } from '../blueprint';
import { arrivalTerraceOf, PORCH, porchOf } from './arrivalTerrace';
import { liftStairOf, rampOf } from './liftStair';

/** Standard gravity (m/s²): what "1 g" means on the notice. */
export const STANDARD_G = 9.80665;

/** Where there is no notice: weight on the landing above this share of the floor's. */
export const LIGHT = 0.5;

/**
 * The panel (handrails): its height, how far the glass stays in from the porch's posts, its bronze case's rim round the
 * glass and its depth back from the glass.
 */
export const WELCOME = { high: 1.25, inset: 0.12, rim: 0.05, deep: 0.08 } as const;

/** Between the heading's parts: where it breaks over two rows on a narrow panel. */
export const HEADING_JOIN = '  ·  ';

/** A line of the notice: its words, and its letters' height as a share of the panel's height. */
export interface NoticeLine {
  text: string;
  size: number;
  /** The heading glows brighter and warmer than the lines under it. */
  heading: boolean;
}

export interface WelcomeSign {
  /** The glass in plan on the landing: its face at z, across w0..w1, from height e0 up to e1 (m). */
  plan: { z: number; w0: number; w1: number; e0: number; e1: number };
  /**
   * The glass in the world: its middle, and its axes (unit): `ex` along the lines as they are read, `ey` up the panel,
   * `ez` out of its face toward the reader at the door. Its width and height (m).
   */
  at: Vec3;
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
  width: number;
  height: number;
  /** Gravity on the landing and on the floor, in standard g. */
  here: number;
  floor: number;
  lines: NoticeLine[];
}

/** A gravity in g as the notice prints it: two significant figures, no trailing zeros ("0.04 g", "1 g", "0.95 g"). */
export function gText(g: number): string {
  return `${Number(g.toPrecision(2))} g`;
}

/** The notice at a habitat's port door, or null where it has no arrival landing or the landing is not light. */
export function welcomeSignOf(h: Habitat): WelcomeSign | null {
  const terrace = arrivalTerraceOf(h), st = liftStairOf(h);
  if (!terrace || !st) return null;
  const q = terrace.platform, hr = st.handrail, ramp = rampOf(h);
  const floor = h.params.floorGravity, weight = h.gravityAt(Math.hypot(terrace.feet[0], terrace.feet[1])) / floor;
  if (!(weight < LIGHT)) return null;
  // Under the front rib, between the posts, its top against the rib.
  const porch = porchOf(q, hr, st.parapet), side = hr * (PORCH.post + WELCOME.inset);
  const plan = { z: porch.front + hr * PORCH.ribHalf, w0: porch.posts[0] + side, w1: porch.posts[1] - side, e0: q.e + hr * (PORCH.rib - WELCOME.high), e1: q.e + hr * PORCH.rib };
  const zm = plan.z, wm = (plan.w0 + plan.w1) / 2, em = (plan.e0 + plan.e1) / 2;
  const at = ramp.world(zm, wm, em), toward = (p: Vec3): Vec3 => v3norm(v3sub(p, at));
  // In the plane of the case's face: along it (w, the way someone facing it from the door reads), up away from the
  // floor square to that, and out of it toward the door.
  const w = toward(ramp.world(zm, wm + 1, em)), up = toward(ramp.world(zm, wm, em + 1)), door = toward(ramp.world(zm + 1, wm, em));
  const ex = v3dot(v3cross(up, door), w) > 0 ? w : v3madd([0, 0, 0], w, -1);
  const ey = v3norm(v3madd(up, ex, -v3dot(up, ex))), ez = v3cross(ex, ey);
  const width = Math.hypot(...v3sub(ramp.world(zm, plan.w1, em), ramp.world(zm, plan.w0, em)));
  const here = (weight * floor) / STANDARD_G, onFloor = floor / STANDARD_G;
  const lines: NoticeLine[] = [
    { text: `Welcome to ${h.params.mind}`.toUpperCase(), size: 0.08, heading: false },
    { text: `LIGHT GRAVITY${HEADING_JOIN}${gText(here)}`, size: 0.26, heading: true },
    { text: `Here you weigh 1/${Math.round(1 / weight)} of what you weigh on the floor.`, size: 0.085, heading: false },
    { text: 'Nothing is wrong with you or the world: this is the spin, close to the axis.', size: 0.085, heading: false },
    { text: 'Move gently. A step carries you far, and you come down slowly.', size: 0.085, heading: false },
    { text: `Your weight comes back as you go down: ${gText(onFloor)} on the floor.`, size: 0.085, heading: false },
  ];
  return { plan, at, ex, ey, ez, width, height: hr * WELCOME.high, here, floor: onFloor, lines };
}
