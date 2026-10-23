/**
 * The ledger: every habitat and polity in the solar system, as records (plan "The Whole System", S2). It is the first
 * of the system's three resolutions: a habitat here is a record from the world seed (where it orbits, its form and
 * size, how many live there, what it is called, who governs it), derived when asked, so tens of thousands cost
 * nothing to hold; near one, its blueprint is derived and drawn (the Outside view); inside, its land and people are
 * generated (the Inside view).
 *
 * Three sources, in this order: the Necklace (the geostationary ring of `SpaceParams`, the home habitat first, with
 * the same ids as `makeSpace`), the world bible's polities (polities.ts), and the generic habitats of each region of
 * `SystemParams`. Same parameters and seed, same ledger.
 *
 * Where a habitat is comes from what it orbits. Bodies are placed by `bodyAt`: by default the data-free mean orbits
 * (space/meanPlanets.ts, Earth and Moon by space/ephemeris.ts), which is what light time and news always use, so they
 * are the same everywhere; a view that holds the ephemeris pack may pass `SolarSystem.position` to draw them exactly.
 * Pure: no three, no DOM, no clock of its own.
 */
import { Rng, TAU, deriveSeed, v3add, v3cross, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { HabitatParams } from '../blueprint';
import { asteroid, asteroidPosition, beltReach, type Asteroid, type Belt } from '../space/asteroids';
import { AU, DAY, JD_J2000 } from '../space/constants';
import { earthAt, earthAxesAt, moonAt, moonFromEarthAt } from '../space/ephemeris';
import { meanPlanetAt } from '../space/meanPlanets';
import { necklace } from '../space/necklace';
import { ellipseAt } from '../space/orbits';
import { apply } from '../space/pose';
import { PLANET_GM, SOLAR_BODIES } from '../space/solarData';
import type { SpaceParams } from '../space/space';
import { jdAt } from '../space/time';
import { arrivalOf } from './light';
import { habitatName, mindName, uniqueName, type NameStyle } from './names';
import { CANON } from './polities';
import type { Body, Economy, Form, Orbit, RegionParams, SystemParams, Tier } from './params';

export interface HabitatRecord {
  id: string;
  name: string;
  /** Its steward Mind (a Mind-ruled habitat's name is its Mind's). */
  mind: string;
  /** The region it was drawn in: a `RegionParams.id`, `necklace` or `canon`. */
  region: string;
  orbit: Orbit;
  form: Form;
  /** Spin radius and the floor's extent across the spin (m). */
  radius: number;
  length: number;
  population: number;
  polity: string;
  style: NameStyle;
  /** Null where nothing says (the world bible's polities mostly). */
  economy: Economy | null;
  /** Whether the bible says where it is, or we chose (canon only). */
  placed?: 'bible' | 'ours';
  seed: number;
}

export interface Polity {
  id: string;
  name: string;
  tier: Tier;
  /** Its habitats' ids, the seat first. */
  habitats: string[];
  canon: boolean;
  economy: Economy | null;
  note: string | null;
}

/** Where a body is at a Julian date (heliocentric J2000 ecliptic, m). */
export type BodyAt = (body: Body, jd: number) => Vec3;

/** A shell about a centre (heliocentric, m) that a region's habitats all stay within: from `inner` to `outer` (m). */
export interface Reach {
  centre: Vec3;
  inner: number;
  outer: number;
}

/** The data-free bodies: Earth and Moon from the analytic series, the planets from their mean elements. */
export const meanBodyAt: BodyAt = (body, jd) =>
  body === 'sun' ? [0, 0, 0] : body === 'earth' ? earthAt(jd) : body === 'moon' ? moonAt(jd) : meanPlanetAt(body, jd);

const BODIES = new Set<string>(['sun', 'moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
const SUN_GM = PLANET_GM.sun;
/** How many derived habitats are remembered. */
const RECENT = 512;

export interface Ledger {
  readonly space: SpaceParams;
  readonly params: SystemParams;
  /** The habitats it keeps: the Necklace and the world bible's. */
  readonly habitats: readonly HabitatRecord[];
  /** The polities it keeps (the Necklace's and the bible's); every generic habitat is its own minor polity. */
  readonly polities: readonly Polity[];
  /** The regions of generic habitats, whose `region.id-n` (n from 1) are derived when asked. */
  readonly regions: readonly RegionParams[];
  /** How many habitats there are in all. */
  readonly count: number;
  /** Any habitat by id, kept or derived (the last few hundred derived are remembered). */
  habitat(id: string): HabitatRecord | undefined;
  polity(id: string): Polity | undefined;
  /** Every habitat: the kept ones, then region by region (derived as it goes). */
  each(f: (h: HabitatRecord) => void): void;
  /** The k-th habitat (0 ≤ k < count) in the order of `each`: derived, and not remembered. */
  nth(k: number): HabitatRecord;
  /** Where a habitat or a body (`sun`, `earth`, `moon`, a planet) is at clock time t (heliocentric J2000 ecliptic, m). */
  where(id: string, t: number, bodyAt?: BodyAt): Vec3;
  /** Where a habitat's record puts it at clock time t: `where` without the lookup. */
  position(h: Pick<HabitatRecord, 'orbit'>, t: number, bodyAt?: BodyAt): Vec3;
  /** The rock a habitat is hollowed into or orbits with (an `asteroid` orbit's), else null. */
  rock(h: HabitatRecord): Asteroid | null;
  /** The shell all of a region's habitats are within at clock time t. */
  reach(region: RegionParams, t: number, bodyAt?: BodyAt): Reach;
  /** When light sent from one place (habitat or body) at clock time `sent` reaches another (clock s; mean orbits). */
  arrival(from: string, sent: number, to: string): number;
  /** Rough bytes held. */
  bytes(): number;
}

/** People per m² of the home habitat's floor: what every built habitat's population is scaled from. */
function densityOf(home: HabitatParams): number {
  return home.population / (TAU * home.radius * home.length);
}

/** The floor people live on (m²) by form: a sphere's terraced inner surface counts half; the rest are drums. */
function floorOf(form: Form, radius: number, length: number): number {
  return form === 'bubble' ? 2 * Math.PI * radius * radius : TAU * radius * length;
}

function weightedKey<K extends string>(rng: Rng, weights: Partial<Readonly<Record<K, number>>>): K {
  const keys = Object.keys(weights) as K[];
  return rng.weighted(keys, (k) => weights[k] ?? 0);
}

/** The radius of a planet (m). */
function radiusOf(body: string): number {
  return SOLAR_BODIES.find((b) => b.id === body)!.radius;
}

export function makeLedger(space: SpaceParams, params: SystemParams): Ledger {
  const seed = deriveSeed(space.seed, 'system');
  const density = densityOf(space.home);
  const habitats: HabitatRecord[] = [], polities: Polity[] = [];
  const names = new Set<string>();
  const keep = (h: HabitatRecord, p: Omit<Polity, 'habitats'> | null): void => {
    habitats.push(h);
    if (p) polities.push({ ...p, habitats: [h.id] });
    else polities.find((q) => q.id === h.polity)!.habitats.push(h.id);
  };
  const nameIn = (style: NameStyle, s: number): string => uniqueName((k) => habitatName(style, deriveSeed(s, 'name', k)), names);
  const ring = params.regions.find((r) => r.place.kind === 'necklace');

  // The Necklace: the same placements and ids as makeSpace's.
  for (const p of necklace(space.home, space.necklace, space.seed)) {
    const home = p.id === 'home', rng = new Rng(deriveSeed(seed, 'necklace', p.id));
    const style: NameStyle = home ? 'mind' : ring ? weightedKey(rng, ring.styles) : 'plain';
    const name = home ? uniqueName(() => space.home.mind, names) : nameIn(style, deriveSeed(seed, p.id));
    keep({ id: p.id, name, mind: style === 'mind' ? name : mindName(deriveSeed(seed, 'mind', p.id)), region: 'necklace', form: 'cylinder',
      orbit: { kind: 'necklace', longitude: p.longitude, radius: p.orbitRadius }, radius: p.params.radius, length: p.params.length,
      population: p.params.population, polity: p.id, style, economy: home || !ring ? null : weightedKey(rng, ring.economies), seed: p.params.seed },
    { id: p.id, name, tier: 'minor', canon: false, economy: null, note: null });
  }

  // The world bible's polities.
  if (params.canon) for (const c of CANON) {
    c.habitats.forEach((h, k) => {
      const s = deriveSeed(seed, 'canon', h.id);
      const name = h.name ? uniqueName(() => h.name!, names) : nameIn(c.style, s);
      const population = h.population ?? Math.round(density * params.crowding[h.form as Exclude<Form, 'surface'>] * floorOf(h.form, h.radius, h.length));
      keep({ id: h.id, name, mind: c.mind ?? mindName(deriveSeed(seed, 'mind', h.id)), region: 'canon', orbit: h.orbit, form: h.form, radius: h.radius, length: h.length,
        population, polity: c.id, style: c.style, economy: c.economy, placed: h.placed, seed: s },
      k === 0 ? { id: c.id, name: c.name, tier: c.tier, canon: true, economy: c.economy, note: c.note } : null);
    });
  }

  // The model asteroids are the ones the Solar view draws (its seed is the world's).
  const rocks = new Map<string, Asteroid>(), recentRocks = new Map<string, Asteroid>();
  const rockOf = (belt: Belt, index: number): Asteroid => {
    const key = `${belt}-${index}`, kept = rocks.get(key) ?? recentRocks.get(key);
    if (kept) return kept;
    // A generic habitat's rock is asked for several times running (its size, its place), so the last few are kept.
    const rock = asteroid(space.seed, belt, index);
    recentRocks.set(key, rock);
    if (recentRocks.size > RECENT) recentRocks.delete(recentRocks.keys().next().value!);
    return rock;
  };
  for (const h of habitats) if (h.orbit.kind === 'asteroid') rocks.set(`${h.orbit.belt}-${h.orbit.index}`, asteroid(space.seed, h.orbit.belt, h.orbit.index));

  // Everyone else, region by region: tens of thousands, so derived when asked and never kept, like the people of a
  // habitat. Their names may repeat (as place names do) but never take a kept one.
  const regions = new Map(params.regions.filter((r) => r.place.kind !== 'necklace' && r.count > 0).map((r) => [r.id, r]));
  const recent = new Map<string, HabitatRecord>();
  const unkept = (make: (k: number) => string): string => {
    for (let k = 0; k < 8; k++) { const n = make(k); if (!names.has(n)) return n; }
    return `${make(0)} II`;
  };
  // Each belt region's permutation of its rocks, and the rocks the kept habitats hold, made once.
  const perms = new Map(params.regions.filter((r) => r.place.kind === 'belt').map((r) => [r.id, permutation((r.place as { within: number }).within, deriveSeed(seed, 'rocks', r.id))]));
  const keptRocks = (belt: Belt): number[] => habitats.flatMap((h) => (h.orbit.kind === 'asteroid' && h.orbit.belt === belt ? [h.orbit.index] : []));
  const generic = (region: RegionParams, i: number): HabitatRecord => {
    const id = `${region.id}-${i + 1}`, s = deriveSeed(seed, 'region', region.id, i), rng = new Rng(s);
    const form = weightedKey(rng, region.forms) as Exclude<Form, 'surface'>, style = weightedKey(rng, region.styles), economy = weightedKey(rng, region.economies);
    let radius = Math.exp(rng.range(Math.log(region.radius[0]), Math.log(region.radius[1])));
    const orbit = orbitIn(region, i, rng, perms, keptRocks);
    // A rock holds a drum no wider than a third of itself.
    if (orbit.kind === 'asteroid') radius = Math.min(radius, rockOf(orbit.belt, orbit.index).body.radius / 3);
    const length = form === 'bubble' ? 0 : radius * rng.range(region.aspect[0], region.aspect[1]);
    const name = unkept((k) => habitatName(style, deriveSeed(s, 'name', k)));
    return { id, name, mind: style === 'mind' ? name : unkept((k) => mindName(deriveSeed(seed, 'mind', id, k))), region: region.id, orbit, form, radius, length,
      population: Math.round(density * params.crowding[form] * floorOf(form, radius, length)), polity: id, style, economy, seed: s };
  };
  const byId = new Map(habitats.map((h) => [h.id, h]));
  const polityById = new Map(polities.map((p) => [p.id, p]));
  const habitat = (id: string): HabitatRecord | undefined => {
    const kept = byId.get(id) ?? recent.get(id);
    if (kept) return kept;
    const dash = id.lastIndexOf('-'), region = regions.get(id.slice(0, dash)), i = Number(id.slice(dash + 1)) - 1;
    if (!region || !Number.isInteger(i) || i < 0 || i >= region.count) return undefined;
    const h = generic(region, i);
    recent.set(id, h);
    if (recent.size > RECENT) recent.delete(recent.keys().next().value!);
    return h;
  };
  // The Moon's place and the pole of its orbit, for the Lagrange points: the last date's, as many habitats ask at once.
  let lunarJd = NaN, lunarAt: Lunar = { moon: [0, 0, 0], pole: [0, 0, 1] };
  const lunar = (jd: number): Lunar => {
    if (jd !== lunarJd) {
      const m = moonFromEarthAt(jd), ahead = moonFromEarthAt(jd + 1 / 24);
      lunarJd = jd;
      lunarAt = { moon: m, pole: v3norm(v3cross(m, v3sub(ahead, m))) };
    }
    return lunarAt;
  };
  const position = (h: Pick<HabitatRecord, 'orbit'>, t: number, bodyAt: BodyAt = meanBodyAt): Vec3 => orbitPosition(h.orbit, t, jdAt(space.epochJd, t), rockOf, bodyAt, lunar);
  const where = (id: string, t: number, bodyAt: BodyAt = meanBodyAt): Vec3 => {
    if (BODIES.has(id)) return bodyAt(id as Body, jdAt(space.epochJd, t));
    const h = habitat(id);
    if (!h) throw new Error(`No habitat or body ${id} in the ledger`);
    return position(h, t, bodyAt);
  };
  // Where each region's habitats start in the order of `each`.
  const order = [...regions.values()];
  const starts: number[] = [];
  let count = habitats.length;
  for (const r of order) { starts.push(count); count += r.count; }
  const nth = (k: number): HabitatRecord => {
    if (k < habitats.length) return habitats[k];
    let r = starts.length - 1;
    while (r > 0 && starts[r] > k) r--;
    if (k < 0 || k >= count) throw new RangeError(`No habitat ${k} of ${count}`);
    return generic(order[r], k - starts[r]);
  };
  const reach = (region: RegionParams, t: number, bodyAt: BodyAt = meanBodyAt): Reach => {
    const p = region.place, jd = jdAt(space.epochJd, t);
    switch (p.kind) {
      case 'circle': return { centre: bodyAt(p.body, jd), inner: 0, outer: p.distance[1] * radiusOf(p.body) };
      // The Moon's place turned about Earth: every one of them is as far from Earth as the Moon is.
      case 'lagrange': { const d = v3len(lunar(jd).moon); return { centre: bodyAt('earth', jd), inner: d * (1 - 1e-6), outer: d * (1 + 1e-6) }; }
      case 'belt': { const [inner, outer] = beltReach(p.belt); return { centre: [0, 0, 0], inner, outer }; }
      case 'sun': return { centre: [0, 0, 0], inner: p.a[0] * AU * (1 - p.e), outer: p.a[1] * AU * (1 + p.e) };
      case 'necklace': return { centre: bodyAt('earth', jd), inner: 0, outer: Math.max(...habitats.filter((h) => h.orbit.kind === 'necklace').map((h) => (h.orbit as { radius: number }).radius)) };
    }
  };
  return {
    space, params, habitats, polities, count, regions: order,
    habitat, nth, position, reach,
    rock: (h) => (h.orbit.kind === 'asteroid' ? rockOf(h.orbit.belt, h.orbit.index) : null),
    polity: (id) => {
      const kept = polityById.get(id);
      if (kept) return kept;
      const h = habitat(id);
      return h && { id, name: h.name, tier: 'minor', habitats: [id], canon: false, economy: h.economy, note: null };
    },
    each: (f) => {
      habitats.forEach(f);
      for (const r of order) for (let i = 0; i < r.count; i++) f(generic(r, i));
    },
    where,
    arrival: (from, sent, to) => arrivalOf(where(from, sent), sent, (t) => where(to, t)),
    bytes: () => habitats.length * 420 + polities.length * 160 + (rocks.size + recentRocks.size) * 360 + recent.size * 420,
  };
}

/** A generic habitat's orbit in its region. */
function orbitIn(region: RegionParams, i: number, rng: Rng, perms: ReadonlyMap<string, (i: number) => number>, kept: (belt: Belt) => number[]): Orbit {
  const p = region.place;
  switch (p.kind) {
    case 'circle': {
      const k = Math.exp(rng.range(Math.log(p.distance[0]), Math.log(p.distance[1])));
      return { kind: 'circle', body: p.body, radius: k * radiusOf(p.body), inclination: rng.range(0, p.inclination), node: rng.range(0, TAU), phase: rng.range(0, TAU) };
    }
    case 'lagrange': return { kind: 'lagrange', point: p.point, along: rng.range(-p.spread, p.spread) };
    case 'belt': {
      // The i-th habitat's rock: a seeded permutation of the region's first `within` rocks (an affine map with a
      // multiplier coprime to `within`), so no two share one; a rock a kept habitat holds goes to one past the count.
      const keep = kept(p.belt), perm = perms.get(region.id)!;
      let index = perm(i);
      for (let spare = region.count; keep.includes(index) && spare < p.within; spare++) index = perm(spare);
      return { kind: 'asteroid', belt: p.belt, index };
    }
    case 'sun': return { kind: 'sun', a: rng.range(p.a[0], p.a[1]) * AU, e: rng.range(0, p.e), inclination: rng.range(0, p.inclination), node: rng.range(0, TAU), peri: rng.range(0, TAU), mean: rng.range(0, TAU) };
    case 'necklace': throw new Error('The Necklace is placed by space/necklace.ts');
  }
}

/** A bijection of [0, n): i ↦ (a·i + b) mod n with a coprime to n, from a seed. */
function permutation(n: number, seed: number): (i: number) => number {
  const rng = new Rng(seed);
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  let a = 1 + Math.floor(rng.float() * (n - 1));
  while (gcd(a, n) !== 1) a = (a % (n - 1)) + 1;
  const b = Math.floor(rng.float() * n);
  return (i) => (a * i + b) % n;
}

/** The Moon from Earth (m) and the unit pole of its orbit at a date. */
interface Lunar {
  moon: Vec3;
  pole: Vec3;
}

/** The body an orbit is about: what a view takes it relative to. */
export function centreOf(o: Orbit): Body {
  return o.kind === 'necklace' || o.kind === 'lagrange' ? 'earth' : o.kind === 'circle' || o.kind === 'surface' ? o.body : 'sun';
}

/** Where an orbit puts its habitat at clock time t (Julian date jd), heliocentric. */
function orbitPosition(o: Orbit, t: number, jd: number, rockOf: (belt: Belt, index: number) => Asteroid, bodyAt: BodyAt, lunar: (jd: number) => Lunar): Vec3 {
  switch (o.kind) {
    case 'necklace': {
      // The slot turns with Earth (space.ts, the habitat's orbit frame).
      const slot: Vec3 = [o.radius * Math.cos(o.longitude), o.radius * Math.sin(o.longitude), 0];
      return v3add(bodyAt('earth', jd), apply(earthAxesAt(jd), slot));
    }
    case 'circle': {
      const gm = PLANET_GM[o.body], angle = o.phase + t * Math.sqrt(gm / (o.radius * o.radius * o.radius));
      // The circle tilted by its inclination about x, then turned to its node about z (rotZ(node)·rotX(inclination)).
      const x = o.radius * Math.cos(angle), y = o.radius * Math.sin(angle) * Math.cos(o.inclination), z = o.radius * Math.sin(angle) * Math.sin(o.inclination);
      const c = Math.cos(o.node), s = Math.sin(o.node), b = bodyAt(o.body, jd);
      return [b[0] + x * c - y * s, b[1] + x * s + y * c, b[2] + z];
    }
    case 'lagrange': {
      // The Moon's place turned by ±60° (and `along`) about the pole of its orbit, from Earth.
      const { moon: m, pole } = lunar(jd);
      const angle = (o.point === 4 ? 1 : -1) * Math.PI / 3 + o.along;
      const turned = v3add(v3scale(m, Math.cos(angle)), v3scale(v3cross(pole, m), Math.sin(angle)));
      return v3add(bodyAt('earth', jd), turned);
    }
    case 'asteroid': {
      const jupiter = bodyAt('jupiter', jd);
      return asteroidPosition(rockOf(o.belt, o.index), jd, Math.atan2(jupiter[1], jupiter[0]));
    }
    case 'sun': {
      const mean = o.mean + (jd - JD_J2000) * DAY * Math.sqrt(SUN_GM / (o.a * o.a * o.a));
      return ellipseAt(o.a, o.e, mean, o.inclination, o.node, o.peri);
    }
    case 'surface': return bodyAt(o.body, jd);
  }
}

/** How far a habitat is from the Sun (m), for sorting and the debug menu. */
export function sunDistance(ledger: Ledger, id: string, t: number): number {
  return v3len(ledger.where(id, t));
}
