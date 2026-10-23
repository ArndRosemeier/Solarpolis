/**
 * A ship's fittings (plan "The Threshold", the flight, step 4 "a ship worth riding"): what turns a blueprint's
 * cylinders and boxes (space/ship.ts) into a ship one believes people live in and Minds keep, near and far.
 *
 * - Plating: every hull section is clad in plates no bigger than PLATE, a little proud of the hull, each its own tone
 *   (a few newer and paler), so the sunlit hull reads as metal with seams, and its size shows against the plates.
 * - Decks and windows: the crew section is stacked in decks along the thrust (DECK high); each has a row of windows,
 *   most lit warm from inside (they glow in the toned and are dark glass in sunlight), and the deck under the nose has
 *   a band of tall panoramic windows: the lounge one watches the arrival from.
 * - Livery: the ship's own colour on bands round the crew section and the nose, from its seed.
 * - Thrusters: quads of reaction-control thrusters (blocks with nozzles fore, aft and to each side) round the crew
 *   section's front and the reactor, the thrusters the approach is flown on.
 * - The nose ends in a docking collar with a ring of target lights.
 * - A torch's drive: cooling rings round its bell, two superconducting coil rings at its mouth (the magnetic nozzle),
 *   and a shadow shield in front of the reactor.
 * - The spine is a lattice truss (longerons, frames and diagonals, a feed pipe down its middle), the radiator wings
 *   are leaves on a manifold, each with its heat pipe, and the propellant tanks have domed ends and straps.
 * - A comms dish on a boom off the crew section, clear of everything round it.
 * - A sail ship's cargo pods each wear their own shipper's colour.
 *
 * Sizes people use (a deck, a window, a seam) are in metres; everything else is a share of the ship's beam or length,
 * so a 20 m tender and a 450 m freighter are both fitted out. Pure.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { ROLE_ALBEDO, partSpan, type ShipPart, type ShipRole, type ShipShape } from './ship';

type RGB = [number, number, number];
type Round = Extract<ShipPart, { shape: 'cylinder' }>;
type Cone = Extract<ShipPart, { shape: 'cone' }>;
type Box = Extract<ShipPart, { shape: 'box' }>;

/** A deck's height under thrust, a window's sill, height and width, a panoramic window's height, a seam's width (m). */
export const DECK = 3.6;
const SILL = 0.95, WINDOW_HIGH = 1.1, WINDOW_WIDE = 1.3, PANORAMA_HIGH = 2.2, SEAM = 0.08;
/** A crew section narrower than this has no decks (m): a tender's cockpit. */
const DECKED = 1.4;
/** The largest hull plate (m); how far each layer stands proud of the one under it (shares of the beam). */
export const PLATE = 3.2;
const PROUD = 0.003;
/** Of the windows, the share lit; a lit window's luminance (relative to white paper in full sunlight): a lived-in room. */
const LIT = 0.72;
export const WINDOW_GLOW = 0.012;
/** The light a window gives, by what is inside: lamplight, daylight panels, a screen. */
const WINDOW_TINTS: readonly RGB[] = [[1, 0.74, 0.46], [1, 0.86, 0.68], [0.82, 0.9, 1]];
/** The collar's target lights: how many, and their luminance. */
const TARGETS = 8;
const TARGET_GLOW = 0.06;
/** The ship's own colours: deep, quiet liveries, not toys. */
const LIVERIES: readonly RGB[] = [[0.05, 0.09, 0.24], [0.28, 0.05, 0.04], [0.05, 0.18, 0.1], [0.45, 0.28, 0.07], [0.04, 0.2, 0.22], [0.11, 0.12, 0.14], [0.55, 0.53, 0.48]];
/** Shippers' colours on cargo pods. */
const CARGO: readonly RGB[] = [[0.34, 0.12, 0.06], [0.52, 0.36, 0.11], [0.08, 0.28, 0.3], [0.4, 0.4, 0.42], [0.08, 0.14, 0.33], [0.68, 0.67, 0.64], [0.12, 0.27, 0.12]];
const COPPER: RGB = [0.42, 0.24, 0.11], SHIELD: RGB = [0.2, 0.19, 0.18], PIPE: RGB = [0.55, 0.54, 0.52], FRAME: RGB = [0.07, 0.07, 0.075];

const toned = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
/** A cone's radius at x along it. */
const coneRadius = (q: Cone, x: number): number => q.r0 + ((q.r1 - q.r0) * (x - q.from)) / (q.to - q.from);
const colourOf = (q: ShipPart): RGB => q.colour ?? ROLE_ALBEDO[q.role];

/** A blueprint's shape fitted out: its parts, some replaced by their detailed form, and the fittings added. */
export function fitOut(base: ShipShape): ShipShape {
  const p = base.params, B = p.beam, rng = new Rng(deriveSeed(p.seed, 'fittings'));
  const proud = B * PROUD, livery = rng.pick(LIVERIES);
  const out: ShipPart[] = [];
  const add = (q: ShipPart): void => { out.push(q); };
  const round = base.parts.filter((q): q is Round => q.shape === 'cylinder');
  const reactor = base.parts.find((q): q is Round => q.shape === 'cylinder' && q.role === 'drive');
  const crew = round.find((q) => q.role === 'crew');
  const nose = base.parts.find((q): q is Cone => q.shape === 'cone' && q.role === 'hull');
  const spine = base.parts.find((q): q is Box => q.shape === 'box' && q.role === 'truss');

  for (const q of base.parts) {
    if (q === nose) { noseOf(q, B, proud, livery, add); continue; }
    if (q === spine) { latticeSpine(q, add); continue; }
    if (q.shape === 'box' && q.role === 'radiator') { leaves(q, B, rng, add); continue; }
    if (q.shape === 'cylinder') {
      const colour = q.role === 'cargo' ? rng.pick(CARGO) : colourOf(q);
      // A pod is a shipper's container, ribbed; a hull section is plated, the hull under the plates showing only in
      // their seams: in their shadow.
      if (q.role === 'cargo') add({ ...q, colour });
      else {
        add({ ...q, colour: toned(colour, 0.5) });
        plate(q, colour, proud, rng, add);
      }
      if (q.role === 'tank') tankEnds(q, colour, proud, add);
      if (q.role === 'sail' || q.role === 'cargo') ribs(q, proud, add);
      continue;
    }
    if (q.shape === 'cone' && q.role === 'drive' && q.from === 0) { bell(q, B, proud, add); }
    add(q);
  }
  if (crew) decks(crew, proud, livery, rng, add);
  // Thruster quads round the crew section's front (forward of its decks) and the stern's widest round section (the
  // reactor, a sail's drum).
  const aft = reactor ?? round.find((q) => q.role === 'sail'), stations: [number, number][] = [];
  if (crew) stations.push([crew.to - Math.min(DECK * 0.3, (crew.to - crew.from) * 0.1), crew.radius]);
  if (aft) stations.push([(aft.from + aft.to) / 2, aft.radius]);
  for (const [at, r] of stations) for (let k = 0; k < 4; k++) thrusters(at, r + proud, Math.PI / 4 + (k * Math.PI) / 2, B, add);
  if (reactor && p.drive === 'torch') shield(reactor, B, add);
  if (crew) dish(crew, base.parts, B, add);
  return { ...base, parts: out };
}

/** A hull section clad in plates, each its own tone, a few newer and paler. */
function plate(q: Round, colour: RGB, proud: number, rng: Rng, add: (q: ShipPart) => void): void {
  const r = q.radius, size = Math.min(PLATE, (2 * Math.PI * r) / 6), len = q.to - q.from;
  const rows = Math.max(1, Math.round(len / size)), around = Math.max(6, Math.round((2 * Math.PI * r) / size));
  const seam = Math.min(SEAM, size * 0.05), gap = seam / r, step = len / rows, a = (2 * Math.PI) / around;
  for (let i = 0; i < rows; i++) {
    // Each row's plates staggered half a plate from the last, as they are laid.
    const turn = (i % 2) * a * 0.5;
    for (let k = 0; k < around; k++) {
      const tone = rng.chance(0.06) ? 1.14 : 1 + rng.range(-0.05, 0.05);
      add({ shape: 'shell', role: q.role, from: q.from + i * step + seam / 2, r0: r + proud, to: q.from + (i + 1) * step - seam / 2, r1: r + proud,
        arc: [turn + k * a + gap / 2, turn + (k + 1) * a - gap / 2], offset: q.offset, colour: toned(colour, tone) });
    }
  }
}

/** A propellant tank's domed ends and its two straps. */
function tankEnds(q: Round, colour: RGB, proud: number, add: (q: ShipPart) => void): void {
  const r = q.radius, deep = r * 0.5, n = 3;
  for (let j = 0; j < n; j++) {
    const f0 = (j * Math.PI) / 2 / n, f1 = ((j + 1) * Math.PI) / 2 / n;
    // Aft: from the inner ring out (facing aft and out); forward: from the outer ring in (facing forward and out).
    add({ shape: 'shell', role: q.role, from: q.from - deep * Math.sin(f1), r0: r * Math.cos(f1), to: q.from - deep * Math.sin(f0), r1: r * Math.cos(f0), offset: q.offset, colour });
    add({ shape: 'shell', role: q.role, from: q.to + deep * Math.sin(f0), r0: r * Math.cos(f0), to: q.to + deep * Math.sin(f1), r1: r * Math.cos(f1), offset: q.offset, colour });
  }
  const w = r * 0.12;
  for (const at of [0.25, 0.75]) band(q.from + (q.to - q.from) * at, w, r + 2 * proud, 'fitting', ROLE_ALBEDO.fitting, q.offset, add);
}

/** Ribs round a sail drum or a cargo pod: a frame every pod's width. */
function ribs(q: Round, proud: number, add: (q: ShipPart) => void): void {
  const r = q.radius, n = Math.max(2, Math.round((q.to - q.from) / (r * 2))), w = r * 0.08;
  for (let i = 0; i <= n; i++) band(q.from + w / 2 + ((q.to - q.from - w) * i) / n, w, r + 2 * proud, 'fitting', FRAME, q.offset, add);
}

/** A ring standing proud round the axis at x, w wide: its face and both its edges. */
function band(x: number, w: number, r: number, role: ShipRole, colour: RGB, offset: [number, number] | undefined, add: (q: ShipPart) => void, depth = r * 0.02): void {
  const a = x - w / 2, b = x + w / 2, inner = r - depth;
  add({ shape: 'shell', role, from: a, r0: r, to: b, r1: r, offset, colour });
  add({ shape: 'shell', role, from: b, r0: r, to: b, r1: inner, offset, colour });
  add({ shape: 'shell', role, from: a, r0: inner, to: a, r1: r, offset, colour });
}

/** One deck of the crew section and its row of windows (`deckWindows`): the last, under the nose, is the lounge. */
export interface DeckWindows {
  /** Its floor along the ship (m; the floor is aft: under thrust, down is toward the stern). */
  floor: number;
  /** The windows' sill above the floor, their height and width (m). */
  sill: number;
  high: number;
  wide: number;
  /** How many round the deck, the first one's angle (from +y toward +z, rad); the rest every 2π/count. */
  count: number;
  turn: number;
  /** The band of tall panoramic windows, the lounge one watches the arrival from. */
  panorama: boolean;
}

/** The decks of a crew section round its axis (radius `r`, from `from` to `to`), each with its row of windows. */
export function deckWindows(q: { from: number; to: number; radius: number }): DeckWindows[] {
  const r = q.radius, len = q.to - q.from;
  if (r < DECKED) return [];
  // Decks from just forward of the livery to short of the thrusters at the front.
  const n = Math.floor((len - DECK * 1.1) / DECK), out: DeckWindows[] = [];
  for (let j = 0; j < n; j++) {
    const panorama = j === n - 1 && n > 1;
    const high = panorama ? PANORAMA_HIGH : WINDOW_HIGH, sill = panorama ? (DECK - PANORAMA_HIGH) / 2 : SILL;
    const wide = panorama ? WINDOW_WIDE * 0.9 : WINDOW_WIDE, pitch = panorama ? wide * 1.08 : wide * 2.4;
    const count = Math.floor((2 * Math.PI * r) / pitch);
    out.push({ floor: q.from + DECK * 0.5 + j * DECK, sill, high, wide, count, turn: (j % 2) * Math.PI / count, panorama });
  }
  return out;
}

/**
 * The crew section's decks: a row of windows each (most lit), the deck under the nose a band of tall panoramic
 * windows, and the livery's bands at its aft end.
 */
function decks(q: Round, proud: number, livery: RGB, rng: Rng, add: (q: ShipPart) => void): void {
  const r = q.radius;
  band(q.from + DECK * 0.18, DECK * 0.18, r + 2 * proud, 'hull', livery, q.offset, add);
  band(q.from + DECK * 0.38, DECK * 0.05, r + 2 * proud, 'hull', livery, q.offset, add);
  for (const d of deckWindows(q)) {
    const { floor, sill, high, wide, count, turn, panorama } = d, half = wide / r / 2;
    const room = rng.pick(WINDOW_TINTS);
    for (let k = 0; k < count; k++) {
      const at = turn + (k * 2 * Math.PI) / count;
      // The window's frame, then its glass: lit or dark.
      add({ shape: 'shell', role: 'fitting', from: floor + sill - 0.08, r0: r + 2 * proud, to: floor + sill + high + 0.08, r1: r + 2 * proud, arc: [at - half - 0.08 / r, at + half + 0.08 / r], offset: q.offset, colour: FRAME });
      const lit = rng.chance(panorama ? 0.9 : LIT), glow = WINDOW_GLOW * rng.range(0.55, 1.3);
      const tint = rng.chance(0.25) ? rng.pick(WINDOW_TINTS) : room;
      add({ shape: 'shell', role: lit ? 'window' : 'fitting', from: floor + sill, r0: r + 3 * proud, to: floor + sill + high, r1: r + 3 * proud, arc: [at - half, at + half], offset: q.offset,
        colour: lit ? toned(tint, glow) : ROLE_ALBEDO.window });
    }
  }
}

/** The nose: its cone, short of the tip, a docking collar to the tip with its target lights, and a livery band. */
function noseOf(q: Cone, B: number, proud: number, livery: RGB, add: (q: ShipPart) => void): void {
  const collar = Math.min((q.to - q.from) * 0.4, B * 0.08), end = q.to - collar, rc = q.r1;
  const r1 = coneRadius(q, end);
  add({ ...q, to: end, r1 });
  // The cone's blunt end round the collar.
  add({ shape: 'shell', role: q.role, from: end, r0: r1, to: end, r1: rc, colour: q.colour });
  // The livery on the cone: a shell over its surface.
  const a = q.from + (end - q.from) * 0.15, b = q.from + (end - q.from) * 0.4;
  add({ shape: 'shell', role: 'hull', from: a, r0: coneRadius(q, a) + proud * 2, to: b, r1: coneRadius(q, b) + proud * 2, colour: livery });
  // The collar, its face a dark docking ring with the target lights round it, at the very tip.
  add({ shape: 'cylinder', role: 'fitting', from: end, to: q.to - 2 * proud, radius: rc });
  add({ shape: 'shell', role: 'fitting', from: q.to - proud, r0: rc * 0.98, to: q.to - proud, r1: rc * 0.55, colour: FRAME });
  const half = (Math.PI / TARGETS) * 0.25;
  for (let k = 0; k < TARGETS; k++) {
    const at = (k * 2 * Math.PI) / TARGETS;
    add({ shape: 'shell', role: 'window', from: q.to, r0: rc * 0.9, to: q.to, r1: rc * 0.8, arc: [at - half, at + half], colour: [TARGET_GLOW, TARGET_GLOW, TARGET_GLOW * 0.95] });
  }
}

/** A quad of reaction-control thrusters at x on a hull of radius r, at an angle round the axis: a block with nozzles. */
function thrusters(x: number, r: number, angle: number, B: number, add: (q: ShipPart) => void): void {
  const s = Math.max(0.25, B * 0.035), c = Math.cos(angle), sn = Math.sin(angle), up = r + s * 0.6;
  const place = (along: number, out: number, side: number): [number, number, number] => [x + along, c * out - sn * side, sn * out + c * side];
  add({ shape: 'box', role: 'fitting', center: place(0, up, 0), half: [s, s * 0.6, s * 0.8], turn: angle, colour: ROLE_ALBEDO.hull });
  const n = s * 0.28;
  for (const d of [-1, 1]) {
    add({ shape: 'box', role: 'fitting', center: place(d * (s + n), up, 0), half: [n, n, n], turn: angle });
    add({ shape: 'box', role: 'fitting', center: place(0, up, d * (s * 0.8 + n)), half: [n, n, n], turn: angle });
  }
  add({ shape: 'box', role: 'fitting', center: place(0, up + s * 0.6 + n, 0), half: [n, n, n], turn: angle });
}

/** A torch's bell: cooling rings along it and two coil rings at its mouth (the magnetic nozzle). */
function bell(q: Cone, B: number, proud: number, add: (q: ShipPart) => void): void {
  const len = q.to - q.from;
  for (let i = 1; i <= 5; i++) {
    const x = q.from + (len * i) / 6, w = len * 0.025;
    add({ shape: 'shell', role: 'fitting', from: x - w, r0: coneRadius(q, x - w) + proud * 2, to: x + w, r1: coneRadius(q, x + w) + proud * 2, colour: FRAME });
  }
  for (const x of [len * 0.04, len * 0.16]) band(q.from + x, B * 0.035, coneRadius(q, q.from + x) + B * 0.03, 'drive', COPPER, undefined, add, B * 0.03);
}

/** The reactor's shadow shield: a disc wider than the reactor, in front of it, chamfered toward the spine. */
function shield(q: Round, B: number, add: (q: ShipPart) => void): void {
  const t = B * 0.06, r = B * 0.4;
  add({ shape: 'cylinder', role: 'drive', from: q.to, to: q.to + t, radius: r, colour: SHIELD });
  add({ shape: 'cone', role: 'drive', from: q.to + t, to: q.to + t * 2.5, r0: r, r1: q.radius * 0.6, colour: SHIELD });
}

/** A lattice bay's length, in the truss's widths. */
const BAY = 1.5;

/** The spine as a lattice: four longerons, a square frame every bay, a diagonal across each face of each bay, a feed pipe. */
function latticeSpine(q: Box, add: (q: ShipPart) => void): void {
  const [cx] = q.center, hx = q.half[0], w = Math.min(q.half[1], q.half[2]), t = w * 0.1;
  const x0 = cx - hx, x1 = cx + hx, bays = Math.max(1, Math.round((2 * hx) / (BAY * 2 * w))), step = (2 * hx) / bays;
  const colour = colourOf(q);
  for (const [y, z] of [[-w, -w], [-w, w], [w, w], [w, -w]] as const) add({ shape: 'box', role: 'truss', center: [cx, y, z], half: [hx, t, t], colour });
  for (let i = 0; i <= bays; i++) {
    const x = x0 + i * step;
    for (const s of [-1, 1]) {
      add({ shape: 'box', role: 'truss', center: [x, s * w, 0], half: [t, t, w], colour });
      add({ shape: 'box', role: 'truss', center: [x, 0, s * w], half: [t, w, t], colour });
    }
    if (i === bays) break;
    // Diagonals, turning one way bay by bay.
    const d = i % 2 ? -1 : 1, xa = x, xb = x + step;
    for (const s of [-1, 1]) {
      add({ shape: 'strut', role: 'truss', a: [xa, s * w, -d * w], b: [xb, s * w, d * w], width: t * 1.4, colour });
      add({ shape: 'strut', role: 'truss', a: [xa, -d * w, s * w], b: [xb, d * w, s * w], width: t * 1.4, colour });
    }
  }
  add({ shape: 'cylinder', role: 'tank', from: x0, to: x1, radius: w * 0.3, colour: PIPE });
}

/** A radiator leaf's albedo, as a share of the radiator role's: its coating has a sheen the bare black lacks. */
const LEAF = 1.6;

/** A radiator wing as leaves on a manifold: each leaf its own tone, a heat pipe down its middle, a rail along the tip. */
function leaves(q: Box, B: number, rng: Rng, add: (q: ShipPart) => void): void {
  const [cx, , cz] = q.center, [hx, hy, hz] = q.half, side = Math.sign(cz), root = cz - side * hz, tip = cz + side * hz;
  const n = Math.max(4, Math.round((2 * hx) / (hz * 0.45))), pitch = (2 * hx) / n, gap = pitch * 0.06;
  add({ shape: 'cylinder', role: 'fitting', from: cx - hx, to: cx + hx, radius: Math.max(hy * 3, B * 0.025), offset: [0, root], colour: PIPE });
  for (let i = 0; i < n; i++) {
    const x = cx - hx + (i + 0.5) * pitch;
    add({ shape: 'box', role: 'radiator', center: [x, 0, cz], half: [pitch / 2 - gap / 2, hy, hz], colour: toned(ROLE_ALBEDO.radiator, LEAF * (1 + rng.range(-0.15, 0.15))) });
    add({ shape: 'box', role: 'fitting', center: [x, 0, cz], half: [pitch * 0.04, hy * 1.8, hz], colour: FRAME });
  }
  // The rail along the tip, the wing's outermost edge (the navigation lights stand at its middle).
  add({ shape: 'box', role: 'fitting', center: [cx, 0, tip], half: [hx, hy * 2, hy * 2], colour: ROLE_ALBEDO.truss });
}

/**
 * A comms dish on a boom off the crew section's aft end, on the side away from the radiators, facing ahead, out beyond
 * every part beside it.
 */
function dish(crew: Round, parts: readonly ShipPart[], B: number, add: (q: ShipPart) => void): void {
  // The bowl's rim at x, its back on the boom, which stands on the crew section's hull near its aft end.
  const R = B * 0.16, deep = R * 0.35, x = crew.from + B * 0.012 + deep;
  // How far out from the axis the parts beside the dish reach.
  let reach = crew.radius;
  for (const q of parts) {
    const s = partSpan(q);
    if (s.x1 >= x - deep - R && s.x0 <= x + R) reach = Math.max(reach, s.radius);
  }
  const y = -(reach + B * 0.05 + R), foot = -crew.radius * 0.9, end = y + R * 0.2;
  add({ shape: 'box', role: 'fitting', center: [x - deep, (foot + end) / 2, 0], half: [B * 0.012, (foot - end) / 2, B * 0.012], colour: ROLE_ALBEDO.truss });
  const at: [number, number] = [y, 0], hub = R * 0.12;
  // Its back (facing aft and out) and its bowl (facing ahead and in).
  add({ shape: 'shell', role: 'hull', from: x - deep, r0: hub, to: x, r1: R, offset: at, colour: ROLE_ALBEDO.hull });
  add({ shape: 'shell', role: 'hull', from: x, r0: R, to: x - deep + R * 0.01, r1: hub, offset: at, colour: ROLE_ALBEDO.crew });
  add({ shape: 'cylinder', role: 'fitting', from: x - deep, to: x + R * 0.5, radius: R * 0.03, offset: at });
}
