/**
 * The districts' works: the ground each district shaped in its own style over two centuries (design "Shaped ground",
 * step 3, Arnd 2026-10-22: "it does not need to look natural everywhere"). The habitat mind built the frame (the Rings
 * and the Heights, gen/plan.ts `grounds`); inside it every district made its commons' ground its own way, and a visitor
 * reads who made a place from its shapes:
 *
 *   stone     turf pyramids with level tops, stepped cones, sunken courts, all crisp;
 *   makers    mesas with sheer quarry-cut faces, and the Fold: land creased into sharp chevron ridges;
 *   orchard   broad domes in contour terraces, so the rows follow the level;
 *   herd      bold downland: round downs with a dew pond on top, and long scarps facing along the axis;
 *   grove     deep vales under the canopy;
 *   water     bowls ringed by embankments, and stepwells;
 *   play      half-pipe valleys to slide and glide in, festival amphitheatres, and Ramps to launch from;
 *   let-go    natural again: drumlins, and tors of jointed rock.
 *
 * The plan places them (gen/plan.ts, `works`: in their district, clear of its courts, the Sunwalk, the rivers, the lake
 * and the Heights, with the ways bent round them); this file holds their kinds, sizes and shapes. A work's shape is its
 * designed surface over the land: the terrain adds it (gen/terrain.ts), and like the landforms a raised work is hollow
 * (the living layer keeps to the land under it). Care sets how crisp it is kept: sharp terraces and edges at the port
 * end, softened toward the reserve. Faces that should catch the travelling sun face along the axis.
 *
 * Sizes are shares of the habitat's tallest work (`relief.landforms.works` radii), so every habitat of the blueprint
 * gets them at its own scale.
 *
 * Besides the districts' works stand a few signature works (design step 4), made by the habitat's people together and
 * read from the far side: the Spiral, a mound with a ramp winding up it; the Wave Field, grass waves round the cylinder
 * that the travelling sun lights one after another; and the Tilt, a slab of meadow tilted up to a cliff flyers leave
 * from. They are works too (the same `Work`, surface and terrain), sized as shares of the radius (`SIGNATURE_KINDS`).
 * Pure: no three, no DOM.
 */
import { smoothstep } from '@futuremagic/core';
import type { DistrictStyle } from '../blueprint';

const TURN = 2 * Math.PI;

/** The kinds of the districts' works. */
export type DistrictWorkKind =
  | 'pyramid' | 'cone' | 'sunken'
  | 'mesa' | 'fold'
  | 'dome'
  | 'down' | 'scarp'
  | 'vale'
  | 'bowl' | 'stepwell'
  | 'halfpipe' | 'amphitheatre' | 'ramp'
  | 'drumlin' | 'tor';

/** The kinds of the signature works. */
export type SignatureKind = 'spiral' | 'wave-field' | 'tilt';

export type WorkKind = DistrictWorkKind | SignatureKind;

/** A district's work on the floor. */
export interface Work {
  id: number;
  kind: WorkKind;
  /** The district that made it (for a signature work, the one it stands in); −1 for the wild reserve. */
  district: number;
  theta: number;
  s: number;
  /** How high it stands over the land, or how deep it is dug for the sunken kinds (m, always > 0). */
  height: number;
  /** How far its footprint reaches from its middle (m): nothing of it lies further out. */
  radius: number;
  /** Which way it faces on the floor unrolled, as a site does (radians: 0 toward the port end, +s; π/2 spinward, +θ). */
  facing: number;
  /** How crisply it is kept, from its district's care: 0 softened by neglect … 1 cut sharp. */
  crisp: number;
  /** Its own variation (0 … 1): how many steps, how its outline wobbles, where its rocks stand. */
  vary: number;
}

/**
 * Each kind: its height (a dug kind's depth) as shares of the habitat's tallest work, its footprint's radius in heights,
 * whether it is dug into the land, and whether it faces along the axis (so the travelling sun lights one face and shades
 * the other) rather than any way.
 */
export const WORK_KINDS: Readonly<Record<DistrictWorkKind, { height: readonly [number, number]; spread: number; dug?: boolean; axial?: boolean }>> = {
  pyramid: { height: [0.15, 0.48], spread: 2.2 },
  cone: { height: [0.12, 0.4], spread: 2 },
  sunken: { height: [0.08, 0.16], spread: 4, dug: true },
  mesa: { height: [0.32, 1], spread: 1.6 },
  fold: { height: [0.3, 0.6], spread: 3, axial: true },
  dome: { height: [0.24, 0.6], spread: 3.5 },
  down: { height: [0.4, 0.8], spread: 3 },
  scarp: { height: [0.4, 0.8], spread: 3, axial: true },
  vale: { height: [0.08, 0.24], spread: 8, dug: true },
  bowl: { height: [0.12, 0.16], spread: 6 },
  stepwell: { height: [0.1, 0.16], spread: 3, dug: true },
  halfpipe: { height: [0.2, 0.5], spread: 4, axial: true },
  amphitheatre: { height: [0.2, 0.4], spread: 3, axial: true },
  ramp: { height: [0.4, 1.2], spread: 3, axial: true },
  drumlin: { height: [0.3, 0.6], spread: 4 },
  tor: { height: [0.1, 0.25], spread: 2.5 },
};

/** The kinds each style makes, in the order a district takes them. */
export const STYLE_WORKS: Readonly<Record<DistrictStyle, readonly DistrictWorkKind[]>> = {
  stone: ['pyramid', 'sunken', 'cone'],
  makers: ['mesa', 'fold'],
  orchard: ['dome'],
  herd: ['down', 'scarp'],
  grove: ['vale'],
  water: ['bowl', 'stepwell'],
  play: ['halfpipe', 'amphitheatre', 'ramp'],
  'let-go': ['drumlin', 'tor'],
};

/**
 * How the plan places them: up to `perDistrict` works in each district, `tries` throws each; a footprint at most `reach`
 * of the entrance spacing; clear of an entrance's court by `court` spacings, of the Sunwalk by `walk` of its widths and
 * of a river's line by `river` of its widths past its meander; each kept `apart` of their radii from the next. A work is
 * kept crisp in a district cared for more than `care[1]`, worn soft below `care[0]`.
 */
export const WORKS = { perDistrict: 6, tries: 12, reach: 0.4, court: 0.12, walk: 3, river: 4, apart: 1.1, care: [0.3, 0.8] as const };

/**
 * The signature works: height (a wave's crest at its tallest) and footprint radius as shares of the habitat's radius,
 * at most `room` of the length of a room between two Rings (scaled down whole where that is less), and whether it faces
 * along the axis. The Spiral is 2 km across and 250 m high in the reference habitat (R 4 km), its ramp winding `turns`
 * times round; the Wave Field's waves stand up to 30 m, a wave every `wave` heights; the Tilt's slab is 3 km long and
 * climbs 400 m (about 8°) to its cliff.
 */
export const SIGNATURE_KINDS: Readonly<Record<SignatureKind, { height: number; radius: number; room: number; axial?: boolean }>> = {
  spiral: { height: 0.0625, radius: 0.25, room: 0.23 },
  'wave-field': { height: 0.0075, radius: 0.3, room: 0.28, axial: true },
  tilt: { height: 0.1, radius: 0.41, room: 0.38, axial: true },
};

/**
 * How the plan places them (`landforms.signature` of them, in `order`): the best of `tries` throws, by sightlines: each
 * as near the Sunwalk as it fits (seen from it, and from the far side over it), in a room between the Rings of its own.
 * The Spiral winds `turns` times; a wave is `wave` of its heights long. They are kept at least `crisp`.
 */
export const SIGNATURE = { order: ['spiral', 'wave-field', 'tilt'] as const, tries: 160, turns: 4, wave: 6, crisp: 0.6 };

/** Whether a work is a signature work. */
export const isSignature = (w: Work): boolean => w.kind in SIGNATURE_KINDS;

/** The share of a step's run its riser takes: steep where the work is crisp, worn back where it is not. */
const riserOf = (crisp: number): number => 0.6 - 0.38 * crisp;

/** A height cut in level steps `step` apart (m), each ledge flat, each riser `riserOf(crisp)` of the step's run. */
function stepped(h: number, step: number, crisp: number): number {
  if (!(step > 0)) return h;
  const q = h / step, n = Math.floor(q), w = riserOf(crisp);
  return step * (n + smoothstep(1 - w, 1, q - n));
}

/**
 * A work's designed surface over the land at a point `du` (round the axis, unrolled) and `dv` (along it) metres from its
 * middle: positive where it raises the land, negative where it is dug. 0 outside its footprint; continuous everywhere.
 */
export function workAt(w: Work, du: number, dv: number): number {
  const r = w.radius, c = Math.cos(w.facing), sn = Math.sin(w.facing);
  // Its own frame, in radii: x along its facing, y across.
  const x = (du * sn + dv * c) / r, y = (du * c - dv * sn) / r, rho2 = x * x + y * y;
  if (rho2 >= 1) return 0;
  const rho = Math.sqrt(rho2), ax = Math.abs(x), ay = Math.abs(y), H = w.height, k = w.crisp, v = w.vary;
  // Every shape is brought down to the land over the footprint's last tenth.
  const edge = 1 - smoothstep(0.9, 1, rho);
  // Square kinds: the side's distance, rounded toward a circle where the work is less kept.
  const square = (Math.max(ax, ay) * (0.5 + 0.5 * k) + rho * (0.5 - 0.5 * k)) * 1.3;
  let h: number;
  switch (w.kind) {
    case 'pyramid': {
      // A level top, straight sides, one ledge per step.
      const t = Math.min(1, Math.max(0, (0.95 - square) / 0.65));
      h = stepped(H * t, H / (3 + Math.floor(v * 3)), k);
      break;
    }
    case 'cone': {
      const t = Math.min(1, Math.max(0, (0.95 - rho) / 0.8));
      h = stepped(H * t, H / (4 + Math.floor(v * 4)), k);
      break;
    }
    case 'sunken': {
      // A square court dug level, its sides in three steps, a low bank round its brink.
      const t = Math.min(1, Math.max(0, (0.8 - square) / 0.4));
      h = -H * stepped(t, 1 / 3, k) + H * 0.12 * Math.exp(-(((square - 0.88) / 0.06) ** 2));
      break;
    }
    case 'mesa': {
      // A level top within a wobbling outline, a sheer face (never past about 80°), a talus apron at its foot.
      const a = Math.atan2(y, x);
      const d = rho * (1 + 0.08 * Math.sin(3 * a + 6.283 * v) + 0.04 * Math.sin(5 * a + 12.57 * v));
      const run = Math.max((0.25 * H) / r, 0.02) * (1.6 - 0.6 * k);
      h = H * (0.8 * (1 - smoothstep(0.58 - run, 0.58, d)) + 0.2 * (1 - smoothstep(0.58 - run, 0.78, d)));
      break;
    }
    case 'fold': {
      // Sharp ridges across its facing, bent into chevrons, in a long field.
      const phase = 2.5 * x + 1.2 * ay + v, f = phase - Math.floor(phase);
      const crest = 1 - Math.abs(2 * f - 1);
      const soft = 0.15 * (1 - k);
      h = H * (crest > 1 - soft ? 1 - soft + (crest - 1 + soft) * 0.5 : crest) * (1 - smoothstep(0.6, 0.95, rho));
      break;
    }
    case 'dome': {
      // A broad dome in contour terraces, so the orchard's rows keep level.
      const t = Math.cos((Math.PI / 2) * Math.min(1, Math.hypot(x, y / 0.9) / 0.95));
      h = stepped(H * t * Math.sqrt(t), H / (6 + Math.floor(v * 4)), k * 0.8 + 0.2);
      break;
    }
    case 'down': {
      // A round down, a little long, with a dew pond on its top.
      const q = Math.min(1, x * x + (y * y) / 0.56);
      h = H * (1 - q) * (1 - q) - H * 0.04 * Math.max(0, 1 - rho2 / 0.005);
      break;
    }
    case 'scarp': {
      // A steep face looking along its facing's back, then a long dip slope away; long across.
      h = H * smoothstep(-0.6, -0.35, x) * (1 - smoothstep(-0.35, 0.95, x)) * (1 - smoothstep(0.55, 0.95, ay));
      break;
    }
    case 'vale': {
      // A deep, long vale, its sides rounded down to its floor.
      const across = Math.min(1, ay / 0.38);
      h = -H * (0.5 + 0.5 * Math.cos(Math.PI * across)) * (1 - smoothstep(0.55, 0.98, ax));
      break;
    }
    case 'bowl': {
      // A bowl dug as deep as its embankment stands high round it.
      h = H * Math.exp(-(((rho - 0.8) / 0.09) ** 2)) - H * (1 - smoothstep(0.15, 0.72, rho));
      break;
    }
    case 'stepwell': {
      // A square well of steps down to a level floor.
      const t = Math.min(1, Math.max(0, (0.85 - square) / 0.7));
      h = -H * stepped(t, 1 / (6 + Math.floor(v * 4)), k);
      break;
    }
    case 'halfpipe': {
      // A raised U along its facing: the floor at the land's level, the walls curving up to their lips, open at the ends.
      const wall = ay < 0.45 ? Math.pow(ay / 0.45, 2.5) : 1 - smoothstep(0.45, 0.95, ay);
      h = H * wall * (1 - smoothstep(0.7, 0.98, ax));
      break;
    }
    case 'amphitheatre': {
      // Tiers of seats rising from a level stage, round the half away from its facing; open on its facing's side.
      const t = rho < 0.8 ? stepped(Math.min(1, Math.max(0, (rho - 0.2) / 0.6)), 1 / (8 + Math.floor(v * 6)), k) : 1 - smoothstep(0.8, 0.98, rho);
      h = H * t * smoothstep(0.5, -0.2, x);
      break;
    }
    case 'ramp': {
      // A tilted plane rising along its facing to a sheer edge people launch from.
      const run = Math.max((0.25 * H) / r, 0.02);
      const rise = Math.min(1, Math.max(0, (x + 0.9) / 1.6));
      h = H * rise * (1 - smoothstep(0.7, 0.7 + run, x)) * (1 - smoothstep(0.45, 0.45 + run, ay));
      break;
    }
    case 'drumlin': {
      // A long smooth whaleback, blunt at its back end, tapering forward.
      const xs = x < 0 ? x / 0.7 : x, q = xs * xs + (y * y) / 0.18;
      h = q < 1 ? H * Math.pow(1 - q, 1.6) : 0;
      break;
    }
    case 'spiral': {
      // A mound with a level top, its flank one ramp winding up `turns` times: each turn's tread level across, rising
      // along the way round, a riser up to the next turn inside it.
      const top = 0.12, T = SIGNATURE.turns, w = riserOf(k);
      const t = ((1 - rho) / (1 - top)) * T, around = (Math.atan2(y, x) / TURN + 1) % 1;
      const u = t - around, n = Math.floor(u);
      h = Math.min(H, Math.max(0, (H / T) * (n + around + smoothstep(1 - w, 1, u - n))));
      break;
    }
    case 'wave-field': {
      // Parallel waves across its facing (round the cylinder when it faces along the axis), tallest in its middle.
      const crest = H * (0.35 + 0.65 * (1 - rho2)) * (1 - smoothstep(0.75, 0.97, rho));
      h = crest * (0.5 - 0.5 * Math.cos((TURN * x * r) / (SIGNATURE.wave * H)));
      break;
    }
    case 'tilt': {
      // A long slab of meadow rising along its facing to a sheer cliff (78°), its sides walls (70°); wholly inside the
      // footprint, so it needs no fading at the edge.
      const a = 0.92, b = 0.36;
      if (Math.abs(x) > a || ay > b) return 0;
      return Math.max(0, Math.min(H * (x + a) / (2 * a), (a - x) * r * 4.7, (b - ay) * r * 2.75));
    }
    case 'tor': {
      // A low knoll crowned by three stacks of rock.
      h = H * 0.4 * (1 - rho2) * (1 - rho2);
      for (let i = 0; i < 3; i++) {
        const a = 6.283 * v + i * 2.1, bx = (x - 0.25 * Math.cos(a)) / (0.18 - i * 0.03), by = (y - 0.25 * Math.sin(a)) / (0.18 - i * 0.03);
        const block = 1 - smoothstep(0.3, 1, Math.max(Math.abs(bx), Math.abs(by)));
        if (block > 0) h = Math.max(h, H * (1 - i * 0.2) * block);
      }
      break;
    }
  }
  return h * edge;
}

/** Whether a work's kind is dug into the land (its surface goes down, not up). */
export const isDug = (w: Work): boolean => !isSignature(w) && !!WORK_KINDS[w.kind as DistrictWorkKind].dug;
