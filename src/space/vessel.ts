/** Reusable inhabited-ship recipes. +x is bow/up under thrust; y/z span each deck.
 * A Mind is the ship; biological occupants are guests. No crew, gravity plating or wall clock.
 * Dimensions are metres, masses kg, thrust N and exhaust velocity m/s. Performance is a fictional design envelope. */
import type { Vec3 } from '@futuremagic/core';
import { torchShip, type ShipShape } from './ship';

export type DeckUse = 'arrival' | 'commons' | 'suites' | 'care' | 'workshop' | 'observatory';
export interface DeckRecipe { use: DeckUse; name: string; description: string }
export interface VesselRecipe {
  id: string; name: string; className: string; seed: number;
  radius: number; deckHeight: number; shell: number; shaft: number;
  decks: readonly DeckRecipe[];
  drive: { dryMass: number; propellant: number; thrust: number; exhaustVelocity: number };
  palette: { shell: Vec3; floor: Vec3; fabric: Vec3; accent: Vec3 };
  greeting: string;
  companions: readonly { name: string; person: boolean; role: string }[];
}
export const EXPLORER: VesselRecipe = {
  id: 'patient-inquiry', name: 'A Perfectly Reasonable Detour', className: 'Long-range exploration companion', seed: 3401,
  radius: 12, deckHeight: 4.2, shell: .45, shaft: 1.45,
  drive: { dryMass: 1800000, propellant: 2400000, thrust: 12000000, exhaustVelocity: 400000 },
  palette: { shell: [.72, .69, .60], floor: [.18, .15, .11], fabric: [.12, .25, .20], accent: [.53, .23, .11] },
  greeting: 'You’re welcome aboard. Curiosity is quite sufficient reason.',
  companions: [{ name: 'Pip', person: true, role: 'fellow traveller and sample enthusiast' }, { name: 'Tending drone', person: false, role: 'care, maintenance and mobility assistance' }],
  decks: [
    { use: 'arrival', name: 'Welcome', description: 'Airlock, luggage and the ship’s drone companions. You are a guest, not a crew member.' },
    { use: 'commons', name: 'Together', description: 'A shared table, a quiet kitchen and space to spend an unhurried evening together.' },
    { use: 'suites', name: 'Your own space', description: 'Four private suites, each with a sleeping alcove, wash space and a wall that can become a world.' },
    { use: 'care', name: 'Wellbeing', description: 'Care, exercise and a place to recover. Supports accommodate both thrust and freefall.' },
    { use: 'workshop', name: 'Curiosity', description: 'Sample study, fabrication and drone tending. Sealed storage keeps loose objects secure.' },
    { use: 'observatory', name: 'A wider conversation', description: 'Meet the ship Mind, explore the sky and consider where to go next.' },
  ],
};

export interface VesselBox { id: string; center: Vec3; half: Vec3; colour: Vec3; adaptive?: boolean }
export interface VesselDeck { index: number; floor: number; ceiling: number; recipe: DeckRecipe; walls: VesselBox[]; furnishings: VesselBox[] }
export interface VesselPlan { recipe: VesselRecipe; shape: ShipShape; radius: number; start: number; end: number; decks: VesselDeck[] }

export function vesselPlan(recipe: VesselRecipe): VesselPlan {
  const r = recipe.radius - recipe.shell, h = recipe.deckHeight;
  if (![r, h, recipe.shell, recipe.shaft].every(Number.isFinite) || r < 7 || h < 3.2 || h > 6 || recipe.shell < .2 || recipe.shaft < 1.2 || recipe.shaft > 2 || recipe.decks.length < 2 || recipe.decks.length > 12)
    throw new RangeError('Ship recipe needs 2–12 decks, 3.2–6 m headroom, a pressure shell and a clear central lift.');
  const d = recipe.drive;
  if (![d.dryMass, d.propellant, d.thrust, d.exhaustVelocity].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Ship propulsion quantities must be positive.');
  // Reuse the traffic ship's machinery grammar. Its crew envelope is 16% of total length.
  const length = (recipe.decks.length * h + recipe.shell * 2) / .16;
  const shape = torchShip({ drive: 'torch', length, beam: recipe.radius * 2, plume: 8, thrust: d.thrust / (d.dryMass + d.propellant), rcs: .2, seed: recipe.seed });
  shape.colours = { hull: recipe.palette.shell, crew: recipe.palette.shell, tank: [.55, .58, .54], drive: [.10, .14, .14], truss: [.32, .40, .36] };
  // The forward tank shoulders must end before the pressure cabin, including on wide recipes.
  shape.parts = shape.parts.map(p => p.role === 'tank' && p.shape === 'cylinder' ? { ...p, to: p.to - p.radius * .4 } : p);
  // Mature ships enclose their spine in a continuous tapered service fairing.
  shape.parts = shape.parts.flatMap(p => p.role === 'truss' && p.shape === 'box'
    ? [{ shape: 'cone' as const, role: 'truss' as const, from: p.center[0] - p.half[0], to: p.center[0] + p.half[0], r0: recipe.radius * .24, r1: recipe.radius * .34 }] : [p]);
  const start = .8 * length + recipe.shell, end = start + recipe.decks.length * h;
  const decks = recipe.decks.map((deck, index): VesselDeck => {
    const floor = start + h * index, ceiling = floor + h - .22;
    const walls: VesselBox[] = [], furnishings: VesselBox[] = [];
    const add = (id: string, y: number, z: number, rise: number, wy: number, wz: number, colour: Vec3, adaptive = false): void => {
      furnishings.push({ id: `${index}:${id}`, center: [floor + rise / 2, y, z], half: [rise / 2, wy / 2, wz / 2], colour, adaptive });
    };
    const raised = (id: string, y: number, z: number, base: number, rise: number, wy: number, wz: number, colour: Vec3, adaptive = true): void => {
      add(id, y, z, rise, wy, wz, colour, adaptive); furnishings[furnishings.length - 1].center[0] += base;
    };
    const suite = deck.use === 'suites' || deck.use === 'care';
    if (deck.use === 'arrival') {
      for (const side of [-1, 1]) walls.push({ id: `${index}:airlock:${side}`, center: [floor + (h - .22) / 2, r - 2, side * 1.45], half: [(h - .22) / 2, 1.6, .08], colour: recipe.palette.shell });
      walls.push({ id: `${index}:outer-hatch`, center: [floor + h / 2, r - .35, 0], half: [Math.min(1.55, (h - .6) / 2), .06, 1.15], colour: [.08, .18, .16] });
      for (const side of [-1, 1]) add(`luggage:${side}`, r * .65, side * 2.45, .95, 1.8, .65, recipe.palette.shell);
    }
    if (suite) for (const sign of [-1, 1]) {
      // Open doors on the axial corridor, with a generous clear width and no thresholds.
      for (const [z, span] of [[-r * .71, r * .23], [0, r * .43], [r * .71, r * .23]])
        walls.push({ id: `${index}:partition:${sign}:${z}`, center: [floor + (h - .22) / 2, sign * 2.25, z], half: [(h - .22) / 2, .09, span / 2], colour: recipe.palette.shell });
      walls.push({ id: `${index}:privacy:${sign}`, center: [floor + (h - .22) / 2, sign * r * .56, 0], half: [(h - .22) / 2, r * .36, .09], colour: recipe.palette.shell });
    }
    for (const side of [-1, 1]) for (const fore of [-1, 1]) {
      const y = side * r * .49, z = fore * r * .38, key = `${side}:${fore}`;
      const privateRoom = suite, workstation = deck.use === 'workshop';
      const width = privateRoom ? 2.1 : workstation ? 2.7 : 3.2;
      if (workstation) {
        add(`lab-base:${key}`, y, z, .85, 2.8, 1.35, recipe.palette.shell);
        raised(`lab-surface:${key}`, y, z, .85, .06, 3, 1.5, [.12, .23, .21], false);
        raised(`sample-vault:${key}`, y + side * .7, z, .91, .52, .9, .85, [.19, .37, .36], false);
        raised(`instrument:${key}`, y - side * .65, z + fore * .35, .91, .14, .7, .5, [.55, .53, .40], false);
        add(`lab-perch:${key}`, y - side * 1.8, z, .48, .65, .65, recipe.palette.fabric, true);
        continue;
      }
      add(`support:${key}`, y, z, .30, width + .16, privateRoom ? 2.5 : 1.1, recipe.palette.shell, true);
      raised(`cushion:${key}`, y, z, .30, .22, width, privateRoom ? 2.3 : .95, privateRoom ? [.49, .53, .48] : recipe.palette.fabric);
      raised(`back:${key}`, y, z + fore * (privateRoom ? 1.05 : .48), .30, .8, width, .22, recipe.palette.fabric);
      for (const edge of [-1, 1]) {
        if (!privateRoom) raised(`arm:${key}:${edge}`, y + edge * width * .48, z, .32, .38, .18, .94, recipe.palette.fabric);
        raised(`pillow:${key}:${edge}`, y + edge * width * .24, z + fore * (privateRoom ? .72 : .22), privateRoom ? .53 : .55, privateRoom ? .12 : .35, .6, .38, edge < 0 ? [.57, .36, .21] : [.59, .57, .43]);
      }
      // An integrated side table / sealed sample counter, with no unsecured ornaments.
      add(`table-base:${key}`, y - side * 1.8, z - fore * .4, .64, .22, .38, recipe.palette.accent, true);
      raised(`table:${key}`, y - side * 1.8, z - fore * .4, .64, .08, .8, .9, recipe.palette.shell);
      if (deck.use === 'suites') {
        add(`wash:${key}`, side * r * .70, fore * r * .16, .85, 1.3, 1.6, [.64, .66, .61]);
        raised(`wash-basin:${key}`, side * r * .70, fore * r * .16, .85, .035, .75, 1.1, [.12, .21, .19], false);
      }
    }
    if (deck.use === 'commons') {
      add('shared-pedestal', 0, -r * .63, .67, 1.4, .65, recipe.palette.shell, true);
      raised('shared-table', 0, -r * .63, .67, .07, 4.6, 1.2, [.52, .34, .20]);
      add('kitchen', 0, r * .75, 1.0, 5, .85, recipe.palette.shell);
      raised('kitchen-preparation', 0, r * .75, 1, .03, 4.5, .70, [.12, .23, .21], false);
    }
    if (deck.use === 'arrival' || deck.use === 'workshop') for (const sign of [-1, 1])
      add(`drone-nest:${sign}`, sign * r * .76, 0, .75, 1.2, 2.5, recipe.palette.accent);
    return { index, floor, ceiling, recipe: deck, walls, furnishings };
  });
  return { recipe, shape, radius: r, start, end, decks };
}

/** Exact constant-thrust rocket step; coast has neither fuel consumption nor apparent gravity.
 * Inertial displacement is along the current bow axis. Orbital transfer navigation is a separate future layer. */
export class VesselDrive {
  fuel: number; speed = 0; distance = 0; acceleration = 0; burning = false;
  constructor(readonly spec: VesselRecipe['drive']) { this.fuel = spec.propellant; }
  advance(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    const rate = this.spec.thrust / this.spec.exhaustVelocity, burn = this.burning ? Math.min(seconds, this.fuel / rate) : 0;
    const m0 = this.spec.dryMass + this.fuel, used = rate * burn, m1 = m0 - used;
    const logarithm = Math.log1p(used / m1);
    const dv = burn ? this.spec.exhaustVelocity * logarithm : 0;
    const travel = burn ? this.spec.exhaustVelocity / rate * (used - m1 * logarithm) : 0;
    this.distance += this.speed * seconds + travel + dv * (seconds - burn);
    this.speed += dv; this.fuel = Math.max(0, this.fuel - used);
    if (!this.fuel) this.burning = false;
    this.acceleration = this.burning ? this.spec.thrust / (this.spec.dryMass + this.fuel) : 0;
  }
}
