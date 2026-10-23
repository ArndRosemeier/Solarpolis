/**
 * The lights a habitat and its ships show outside (plan "The Threshold", the flight, step 2 "light on the flight"):
 * the port is busy day and night, and its face never sees the Sun (the axis points at an ecliptic pole), so what a
 * newcomer sees of it coming in is mostly its lights.
 *
 * - Every brim's rim carries red obstruction lights all round, flashing together, so the whole body's outline blinks
 *   at once, like a wind farm's.
 * - The port face's rim is ringed by steady green lights: the face with the dock.
 * - The despun spindle has rings of steady white running lights, and a red beacon on its tip.
 * - Each berth arm has a white strobe at its collar (the arms' strobes go round the spindle one after another), a run
 *   of lead-in lights along its outer face that flash in sequence toward the collar, and red, green and white lights
 *   round the collar, so a pilot (or a Mind) sees which way it is turned.
 * - Ships carry navigation lights: red to port, green to starboard at the widest point, a white strobe at the nose.
 *
 * Positions are in the blueprint frame for what turns with the habitat (`'body'`) and in the spindle's frame (the
 * same axes, without the spin) for the dock (`'spindle'`), or in the ship's frame. Every count, size and spacing comes
 * from the habitat or the ship. Intensities are real luminous intensities (candela), so a light's brightness at the eye
 * is `lampFlux` and falls off with the square of the distance. Pure.
 */
import type { Vec3 } from '@futuremagic/core';
import { berthArmAt, type Habitat } from '../blueprint';
import type { ShipShape } from './ship';

/** The Sun's illuminance at 1 AU (lux): the unit a light's flux is given in. */
export const SUN_LUX = 128_000;

/** A light's flashing: `period` s apart (0: steady), lit `on` s each time, `phase` s after the clock's zero. */
export interface Blink {
  period: number;
  on: number;
  phase: number;
}

export type LightFrame = 'body' | 'spindle' | 'ship';

export interface HullLight {
  frame: LightFrame;
  at: Vec3;
  /** Its colour, scaled to luminance 1 (Rec. 709), so `candela` alone sets how bright it is. */
  colour: Vec3;
  /** Its peak luminous intensity (cd), the same all round. */
  candela: number;
  blink: Blink;
}

const luminance1 = (c: Vec3): Vec3 => {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / y, c[1] / y, c[2] / y];
};

/** Aviation's colours, as lamps show them. */
export const LIGHT_COLOUR = {
  red: luminance1([1, 0.06, 0.03]),
  green: luminance1([0.1, 1, 0.45]),
  white: luminance1([1, 0.97, 0.92]),
  strobe: luminance1([0.92, 0.95, 1]),
  amber: luminance1([1, 0.62, 0.22]),
} as const;

/**
 * What the lights are: intensities (cd), as for aviation (medium-intensity red obstruction lights, strobes, approach
 * lights) and ships' navigation lights; how they flash (s); and how far apart the rim lights stand, in hub radii.
 */
export const LIGHTS = {
  obstruction: { candela: 2000, blink: { period: 1.5, on: 0.6 } },
  rim: { candela: 600, pitch: 8 },
  running: { candela: 300, rings: 4, around: 8 },
  tip: { candela: 20000, blink: { period: 2, on: 0.25 } },
  strobe: { candela: 20000, blink: { period: 1.6, on: 0.1 } },
  leadIn: { candela: 2500, lights: 8, blink: { period: 2.4, on: 0.12, step: 0.07 } },
  collar: { candela: 400 },
  nav: { candela: 600 },
  navStrobe: { candela: 6000, blink: { period: 1.2, on: 0.08 } },
} as const;

const STEADY: Blink = { period: 0, on: 0, phase: 0 };

/** How lit a light with this blink is at clock time t (s): 0 or 1, with a short rise and fall (no single-frame flash). */
export function shineAt(b: Blink, t: number): number {
  if (b.period <= 0) return 1;
  const s = (((t - b.phase) % b.period) + b.period) % b.period, edge = Math.min(0.03, b.on / 4);
  if (s >= b.on + edge) return 0;
  return Math.min(1, s / edge + 0.5, (b.on + edge - s) / (2 * edge));
}

/** A light's flux at the eye `dist` m away, relative to the Sun's at 1 AU, per channel, at clock time t. */
export function lampFlux(l: HullLight, dist: number, t: number): Vec3 {
  const e = (l.candela * shineAt(l.blink, t)) / (dist * dist * SUN_LUX);
  return [l.colour[0] * e, l.colour[1] * e, l.colour[2] * e];
}

/** Points evenly round a circle of radius r at height z, the first at angle `start`. */
function roundCircle(n: number, r: number, z: number, start = 0): Vec3[] {
  return Array.from({ length: n }, (_, k) => {
    const a = start + (k / n) * 2 * Math.PI;
    return [Math.cos(a) * r, Math.sin(a) * r, z] as Vec3;
  });
}

/** Every light on a habitat's outside. */
export function hullLightsOf(h: Habitat): HullLight[] {
  const x = h.exterior, s = x.spindle, arms = s.arms, hub = h.params.hubRadius, out: HullLight[] = [];
  const mount = (frame: LightFrame, at: Vec3, colour: Vec3, candela: number, blink: Blink = STEADY): void => { out.push({ frame, at, colour, candela, blink }); };
  const pitch = LIGHTS.rim.pitch * hub, lightsRound = (r: number): number => Math.max(8, Math.round((2 * Math.PI * r) / pitch));
  // The body's outline: every brim's rim, flashing together.
  const flash: Blink = { ...LIGHTS.obstruction.blink, phase: 0 };
  for (const b of x.brims) for (const p of roundCircle(lightsRound(b.tip), b.tip, b.z)) mount('body', p, LIGHT_COLOUR.red, LIGHTS.obstruction.candela, flash);
  // The port face's rim, steady green.
  for (const p of roundCircle(lightsRound(x.radius), x.radius, x.portFace)) mount('body', p, LIGHT_COLOUR.green, LIGHTS.rim.candela);
  // The spindle: rings of running lights between the face and the arms, and beyond them, and the beacon on its tip.
  const { rings, around } = LIGHTS.running;
  for (let q = 1; q <= rings; q++) {
    const z = s.from + ((s.to - s.from) * q) / (rings + 1);
    if (Math.abs(z - arms.z) < arms.width * 2) continue;
    for (const p of roundCircle(around, s.radius, z, Math.PI / around)) mount('spindle', p, LIGHT_COLOUR.white, LIGHTS.running.candela);
  }
  mount('spindle', [0, 0, s.to], LIGHT_COLOUR.red, LIGHTS.tip.candela, { ...LIGHTS.tip.blink, phase: 0 });
  // The berth arms.
  const lead = LIGHTS.leadIn, w = arms.width, rc = w * 0.9 * 1.1;
  for (let i = 0; i < s.berthArms; i++) {
    const [ca, sa] = berthArmAt(s, i), aroundDir: Vec3 = [-sa, ca, 0];
    const onArm = (r: number, side: number, up: number): Vec3 => [ca * r + aroundDir[0] * side, sa * r + aroundDir[1] * side, arms.z + up];
    const tip = s.radius + arms.length;
    // The strobe at the collar's outer edge, the arms' in turn round the spindle.
    mount('spindle', onArm(tip, 0, w * 0.9), LIGHT_COLOUR.strobe, LIGHTS.strobe.candela, { ...LIGHTS.strobe.blink, phase: (i / s.berthArms) * LIGHTS.strobe.blink.period });
    // The lead-in: two rows along the outer face's edges, flashing in sequence from the spindle out to the collar.
    for (let k = 0; k < lead.lights; k++) {
      const r = s.radius + (arms.length - w) * ((k + 0.5) / lead.lights);
      for (const side of [-1, 1]) mount('spindle', onArm(r, (side * w) / 2, w / 2), LIGHT_COLOUR.amber, lead.candela, { period: lead.blink.period, on: lead.blink.on, phase: k * lead.blink.step });
    }
    // Round the collar: green on the side ahead round the spindle, red behind, white over and under.
    mount('spindle', onArm(tip, rc, 0), LIGHT_COLOUR.green, LIGHTS.collar.candela);
    mount('spindle', onArm(tip, -rc, 0), LIGHT_COLOUR.red, LIGHTS.collar.candela);
    for (const up of [-1, 1]) mount('spindle', onArm(tip, 0, up * rc), LIGHT_COLOUR.white, LIGHTS.collar.candela);
  }
  return out;
}

/** How far a ship's parts reach out along +z (its wings' side), and where along it that is (m). */
function widest(shape: ShipShape): { x: number; z: number } {
  let best = { x: shape.params.length / 2, z: shape.params.beam / 2 };
  for (const p of shape.parts) {
    const reach = p.shape === 'box' ? Math.abs(p.center[2]) + p.half[2]
      : p.shape === 'cylinder' ? p.radius + Math.hypot(...(p.offset ?? [0, 0]))
      : Math.max(p.r0, p.r1);
    const x = p.shape === 'box' ? p.center[0] : (p.from + p.to) / 2;
    if (reach > best.z) best = { x, z: reach };
  }
  return best;
}

/**
 * A ship's navigation lights, in its frame (+x to the nose, +y up, +z to starboard): red to port and green to
 * starboard at its widest, a white strobe on the nose, timed from its seed so no two ships flash together.
 */
export function shipLightsOf(shape: ShipShape): HullLight[] {
  const { x, z } = widest(shape), L = shape.params.length, b = LIGHTS.navStrobe.blink;
  const phase = ((shape.params.seed * 0.618034) % 1) * b.period;
  return [
    { frame: 'ship', at: [x, 0, -z], colour: LIGHT_COLOUR.red, candela: LIGHTS.nav.candela, blink: STEADY },
    { frame: 'ship', at: [x, 0, z], colour: LIGHT_COLOUR.green, candela: LIGHTS.nav.candela, blink: STEADY },
    { frame: 'ship', at: [L, 0, 0], colour: LIGHT_COLOUR.strobe, candela: LIGHTS.navStrobe.candela, blink: { period: b.period, on: b.on, phase } },
  ];
}
