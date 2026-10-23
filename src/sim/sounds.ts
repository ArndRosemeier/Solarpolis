/**
 * What can be heard where (design "Solarpolis: how it sounds"): the land's beds of sound and how loud each is at a
 * listener, the single bird calls (each from a bird on the land, sim/birds.ts), the ground under a footstep, and the stride
 * that times the steps. The player (`audio/sound.ts`) plays what this says; nothing here knows of Web Audio. Pure.
 *
 * Every weight follows from what the habitat already knows: crowns and meadow from the ecology, the lake and the rivers
 * from the terrain, the light from the sunline's bright stretch at the listener's place along the axis (so the dawn
 * chorus rolls from the wild end to the port end with the light), and the air's density from the blueprint (thinner
 * toward the axis, so everything there is a little quieter). Nothing is placed by hand and nothing uses `Math.random`.
 */
import { clamp, smoothstep } from '@futuremagic/core';
import { toWorld, type Habitat } from '../blueprint';
import { canopyOf, type Ecology } from '../gen/ecology';
import { kept } from '../gen/kept';
import { pathsOf } from '../gen/paths';
import { placesOf } from '../gen/places';
import { fromLake, planOf } from '../gen/plan';
import { sampleS } from '../gen/rivers';
import { crossingsOf } from '../gen/crossings';
import { landmarksOf } from '../gen/landmarks';
import type { Terrain } from '../gen/terrain';
import { BIRD_KINDS } from '../gen/birds';
import { chorusAt, lightAt, songsIn, LIGHT_LAG, type Nest } from './birds';
import { crownsOf } from './fauna';
import { floorGap } from './walks';
import type { Source } from './sources';
import { ROOM_BEDS, roomAt, roomBedsAt, throughDeck, type Room } from './rooms';

/** The beds: long sounds that loop, each mixed by its weight (files `bed/<name>` in public/sound). */
export const BEDS = [
  'wind-soft', 'wind-open', 'wind-high', 'leaves-broad', 'leaves-conifer', 'grass',
  'river-riffle', 'river-slow', 'lake', 'falls', 'birds-wood', 'birds-meadow', 'birds-water', 'bees', 'crickets',
  // The landmarks' own: water under the pavilion's piers, banners at the summit hut, the founders' grove's old oaks.
  'piers', 'flags', 'oaks',
  // Below the land (sim/rooms.ts): room tones and the halls' work.
  ...ROOM_BEDS,
] as const;
export type Bed = (typeof BEDS)[number];

/** What a footstep can land on (files `step/<name>-1 … 4`). */
export const STEP_SURFACES = ['grass', 'litter', 'gravel', 'stone', 'timber', 'snow', 'water', 'floor'] as const;
export type StepSurface = (typeof STEP_SURFACES)[number];

/** The single calls (files `call/<name>`): the woods' birds, the meadow's lark, the owl at night. */
export const CALLS = BIRD_KINDS;
export type CallKind = (typeof CALLS)[number];

/** Who is listening, and where: the eye on the profile, the ground under it, below the land or not, how fast it goes. */
export interface Listener {
  theta: number;
  s: number;
  /** The eye's height above the profile (m). */
  h: number;
  /** The height of what it stands on or flies over (m above the profile). */
  ground: number;
  below: boolean;
  /** Speed through the air (m/s): flying, falling or running adds wind. */
  speed: number;
}

/**
 * What the player's ears get from the Inside view each frame (`InteriorView.hearing`): the land, the clock, the
 * listener on it, the eye's pose in the world (for placing calls), and how the feet move (for the steps).
 */
export interface Hearing {
  ecology: Ecology;
  time: number;
  listener: Listener;
  eye: [number, number, number];
  look: [number, number, number];
  up: [number, number, number];
  /** On foot on the ground: where the feet are (θ, s, height above the profile) and their speed along it (m/s). */
  feet: { theta: number; s: number; h: number; speed: number } | null;
  /** The gravity at the feet (m/s²), which sets the stride. */
  gravity: number;
  /** How fast the body climbs (m/s along up; a jump starts fast upward) and flies through the air (m/s; 0 on foot). */
  climb: number;
  flight: number;
  /** What is near enough to be heard: people, animals, drones, lift portals (sim/sources.ts). */
  sources: Source[];
  /** Riding a lift: whose (its court), how far along the ride (0 … 1), and whether it moves yet. */
  lift: { court: number; share: number; moving: boolean } | null;
  /** The birds round the listener (the view's; their songs are the calls). */
  birds: readonly Nest[];
}

export interface Soundscape {
  /** Each bed's weight (0 … 1, an amplitude). */
  beds: Record<Bed, number>;
  /** The air's carrying factor at the eye (1 on the floor): the square root of its density over the floor's. */
  air: number;
  /** How much of the day's light reaches the listener's place along the axis (0 night … 1 the bright stretch over it). */
  light: number;
  /** How busy the birds are (0 … 1): highest as the light comes up (the dawn chorus), low through the day, none at night. */
  birds: number;
  /** The echo of the room the listener is in (sim/rooms.ts; none on the open land). */
  room: Room;
  /** Below: how much of the land above comes down, muffled (0 … 1); the land's beds are already scaled by it. */
  through: number;
}

/** A single call: what, where (world), and when it starts (clock s). */
export interface Call {
  kind: CallKind;
  at: [number, number, number];
  t: number;
}

/** Tree forms that are conifers: their crowns sigh rather than rustle. */
const CONIFERS = new Set(['pine', 'stone-pine', 'cypress', 'juniper']);

/** How far round the listener the crowns and meadow are sampled (m), and in how many spots on that ring. */
const AROUND = 25, SPOTS = 6;
/** How far the water is heard: half loudness at these distances (m) for a river, the lake and a fall. */
const RIVER_HALF = 12, LAKE_HALF = 25, FALLS_HALF = 150;
/** River samples farther than this along the axis are not looked at (m). */
const RIVER_REACH = 800;
/** A river stretch falling this steeply (m per m) is a fall; one this flat and wide flows slowly. */
const FALL_STEEP = 0.3, SLOW_STEEP = 0.004, SLOW_WIDTH = 5;
/** Half loudness this far (m) past the pavilion's deck (the water under its piers) and the summit hut (its banners). */
const PIERS_HALF = 20, FLAGS_HALF = 25;
/** How far from its centre the summit hut's timber deck and terrace reach (m). */
export const HUT_REACH = 30;

/** How loud something is at a distance d (m) past its edge, half as loud at `at` m. */
const falloff = (d: number, at: number): number => 1 / (1 + (Math.max(0, d) / at) ** 2);

/** Orders things that happen by their clock time. */
export const byTime = (a: { t: number }, b: { t: number }): number => a.t - b.t;

/** Per ecology: each biome's share of its crown cover that is conifers. */
const conifersOf = kept((e: Ecology): Float32Array => Float32Array.from(e.climate.biomes, (b) => {
  let all = 0, cone = 0;
  for (const p of b.plants) {
    if (p.height[1] < 6) continue;
    const c = (p.height[0] + p.height[1]) / 2 / p.spacing;
    all += c;
    if (CONIFERS.has(p.form)) cone += c;
  }
  return all > 0 ? cone / all : 0;
}));

const crownsKept = kept((e: Ecology) => crownsOf(e));
const canopyKept = kept((e: Ecology) => e.climate.biomes.map((b) => canopyOf(b).cover));

export { lightAt };

/** The air's carrying factor at a distance r from the axis: √(ρ(r) / ρ(floor)), from the blueprint. */
export function airAt(h: Habitat, r: number): number {
  return Math.sqrt(h.airDensityAt(r) / h.airDensityAt(h.radius));
}

/** Where water is near the listener: the nearest river (and how slow), the nearest fall, the lake. */
function waterNear(t: Terrain, l: Listener): { river: number; slow: number; falls: number; lake: number } {
  let river = Infinity, slow = 0, falls = Infinity, fallWidth = 0;
  for (const rv of t.rivers) {
    const k0 = Math.max(0, Math.floor((l.s - RIVER_REACH - rv.s0) / rv.step)), k1 = Math.min(rv.count - 1, Math.ceil((l.s + RIVER_REACH - rv.s0) / rv.step));
    for (let k = k0; k <= k1; k++) {
      const s = sampleS(rv, k), across = floorGap(rv.radius[k], l.theta, l.s, rv.theta[k], s);
      const d = Math.max(0, Math.hypot(across, l.h - rv.surface[k]) - rv.halfWidth[k]);
      if (rv.steep[k] >= FALL_STEEP) { if (d < falls) { falls = d; fallWidth = rv.halfWidth[k]; } continue; }
      if (d < river) { river = d; slow = rv.steep[k] < SLOW_STEEP && rv.halfWidth[k] > SLOW_WIDTH ? 1 : 0; }
    }
  }
  let lakeAway = t.lake ? Math.hypot(Math.max(0, fromLake(t.lake, l.s)), l.h - t.lake.level) : Infinity;
  // A lake on the floor laps at its shore the same way.
  const by = t.meres.length ? t.form.mereAt(l.theta, l.s, LAKE_HALF * 8) : null;
  if (by) lakeAway = Math.min(lakeAway, Math.hypot(Math.max(0, by.edge), l.h - by.mere.level));
  return {
    river: falloff(river, RIVER_HALF),
    slow,
    falls: falloff(falls, FALLS_HALF) * Math.min(1, fallWidth / 5),
    lake: falloff(lakeAway, LAKE_HALF),
  };
}

/** The crowns (0 … 1), how much of them are conifers, and how much of the ground is meadow, round a point. */
function coverNear(e: Ecology, l: Listener): { wood: number; conifer: number; meadow: number } {
  const t = e.terrain, h = t.habitat, crowns = crownsKept(e), cones = conifersOf(e), covers = canopyKept(e);
  const shares = new Float32Array(cones.length), colour = new Float32Array(3), floor = new Uint8Array(8);
  const r = Math.max(1, h.profile.at(l.s).r);
  let wood = 0, conifer = 0, coverSum = 0, meadow = 0;
  for (let i = 0; i <= SPOTS; i++) {
    const a = (2 * Math.PI * i) / SPOTS, d = i === 0 ? 0 : AROUND;
    const theta = l.theta + (d * Math.cos(a)) / r, s = clamp(l.s + d * Math.sin(a), 0, h.profile.length);
    const ground = t.heightAt(theta, s);
    wood += crowns(theta, s, ground);
    e.biomesAt(theta, s, ground, 0, shares);
    for (let b = 0; b < shares.length; b++) { conifer += shares[b] * covers[b] * cones[b]; coverSum += shares[b] * covers[b]; }
    e.colorAt(theta, s, ground, 0, colour, 0, undefined, floor);
    meadow += (floor[0] + floor[1]) / 255;
  }
  const n = SPOTS + 1;
  return { wood: Math.min(1, wood / n), conifer: coverSum > 0 ? conifer / coverSum : 0, meadow: Math.min(1, meadow / n) };
}

/** Everything heard at a listener at clock time t. `buffer` is a scratch for the sunline's emission (any length). */
export function soundscapeAt(e: Ecology, t: number, l: Listener, buffer?: Float32Array<ArrayBuffer>): Soundscape {
  const terrain = e.terrain, h = terrain.habitat;
  const beds = {} as Record<Bed, number>;
  for (const b of BEDS) beds[b] = 0;
  const eye = toWorld(h.profile, { theta: l.theta, s: l.s, h: l.h }), r = Math.hypot(eye[0], eye[1]);
  const air = airAt(h, r);
  const light = lightAt(h, l.s, t, buffer), before = lightAt(h, l.s, t - LIGHT_LAG, buffer);
  const birds = chorusAt(light, light > before);
  const room = roomAt(terrain, l);
  if (l.below) {
    const rooms = roomBedsAt(terrain, l), through = throughDeck(terrain, l);
    // Through a wellhead's light well, the court above: what one would hear standing on its floor.
    if (through > 0) {
      const ground = terrain.heightAt(l.theta, l.s), above = soundscapeAt(e, t, { ...l, below: false, h: ground + 1.7, ground, speed: 0 }, buffer);
      for (const b of BEDS) beds[b] = above.beds[b] * through;
    }
    for (const b of ROOM_BEDS) beds[b] = rooms[b];
    return { beds, air, light, birds, room, through };
  }

  const high = smoothstep(0.15, 0.6, 1 - r / h.radius);
  const lift = smoothstep(2, 40, l.h - l.ground);
  const raised = smoothstep(0, 0.03 * h.radius, l.ground);
  const { wood, conifer, meadow } = coverNear(e, l);
  const open = 1 - wood, low = 1 - high;
  const windy = Math.min(1, 0.35 + raised * 0.4 + lift * 0.4 + l.speed / 30);
  beds['wind-soft'] = (0.25 + 0.75 * open) * low * 0.6;
  beds['wind-open'] = Math.min(1, raised * open * 0.7 + lift * 0.6 + l.speed / 30) * (1 - 0.5 * high);
  beds['wind-high'] = high;
  beds['leaves-broad'] = wood * (1 - conifer) * windy * low;
  beds['leaves-conifer'] = wood * conifer * windy * low;
  beds['grass'] = open * meadow * windy * low * (1 - lift);

  const w = waterNear(terrain, l);
  beds['river-riffle'] = w.river * (1 - w.slow);
  beds['river-slow'] = w.river * w.slow;
  beds['falls'] = w.falls;
  beds['lake'] = w.lake;

  beds['birds-wood'] = wood * birds * low;
  beds['birds-meadow'] = open * meadow * birds * low;
  beds['birds-water'] = Math.max(w.lake, w.river * 0.6) * birds * low;
  const orchard = placesOf(terrain).placeAt(l.theta, l.s)?.kind === 'orchard' ? 1 : 0;
  const warm = smoothstep(0.5, 0.9, light);
  beds['bees'] = warm * Math.max(orchard, meadow * open * 0.35) * low * (1 - lift);
  const evening = light < before ? smoothstep(0.02, 0.15, light) * (1 - smoothstep(0.3, 0.6, light)) : light < 0.04 ? 0.3 : 0;
  beds['crickets'] = evening * meadow * open * low * (1 - lift);
  const marks = landmarksNear(terrain, l);
  beds['piers'] = marks.piers;
  beds['flags'] = marks.flags * windy;
  // The grove's old oaks ring its lawn: heard all through it, the lawn in the middle too.
  beds['oaks'] = marks.grove * windy;
  for (const b of BEDS) beds[b] = Math.min(1, beds[b] * air);
  return { beds, air, light, birds, room, through: 0 };
}

/**
 * How near the landmarks with a sound of their own are (0 … 1): the pavilion (water slapping under its piers, heard
 * from its deck and the lake round it), the summit hut (banners snapping in the wind), the founders' grove (old oaks
 * creaking, all through the grove and fading at its edge).
 */
function landmarksNear(t: Terrain, l: Listener): { piers: number; flags: number; grove: number } {
  const h = t.habitat, r = h.profile.at(l.s).r;
  let piers = 0, flags = 0, grove = 0;
  for (const m of landmarksOf(t)) {
    const d = Math.hypot(floorGap(r, l.theta, l.s, m.theta, m.s), l.h - m.level);
    if (m.kind === 'pavilion') piers = Math.max(piers, falloff(d - m.radius, PIERS_HALF));
    else flags = Math.max(flags, falloff(d - HUT_REACH / 2, FLAGS_HALF));
  }
  for (const site of planOf(h).sites) {
    if (site.kind !== 'founders-grove') continue;
    grove = Math.max(grove, 1 - smoothstep(0.6 * site.size, site.size, floorGap(r, l.theta, l.s, site.theta, site.s)));
  }
  return { piers, flags, grove };
}

/** How far from the listener a bird's calls are dealt (m): farther ones are lost in the beds. */
export const CALLS_REACH = 150;

/**
 * The single calls that start between clock times t0 and t1 round a listener: the songs of the birds near it
 * (`nests`, those the view keeps; sim/birds.ts `songsIn`), each from the bird's head as it sings on its post or in
 * the air. The same birds and times always give the same calls, whoever asks.
 */
export function callsIn(e: Ecology, nests: readonly Nest[], t0: number, t1: number, l: Listener): Call[] {
  const out: Call[] = [];
  if (l.below || t1 <= t0) return out;
  const t = e.terrain, r = Math.max(1, t.habitat.profile.at(l.s).r);
  for (const n of nests) if (floorGap(r, l.theta, l.s, n.theta, n.s) <= CALLS_REACH) out.push(...songsIn(t, n, t0, t1));
  return out.sort(byTime);
}

/** What the floor layers sound like under a foot. */
const LAYER_STEP: Record<string, StepSurface> = { grass: 'grass', 'dry grass': 'grass', litter: 'litter', needles: 'litter', dirt: 'grass', gravel: 'gravel', sand: 'gravel', rock: 'stone' };

/**
 * What a foot at (θ, s) lands on, standing `feet` m above the profile: the Understorey's floor below; water when it is
 * in the lake or a river; a built thing's deck (timber on the pavilion, the hut and timber or log crossings; stone on
 * the rest: courts, the Lift Stair, arches); snow above the snow line; a path's laid surface; else the floor's
 * strongest layer.
 */
export function stepSurfaceAt(e: Ecology, theta: number, s: number, feet: number, below: boolean): StepSurface {
  if (below) return 'floor';
  const t = e.terrain, h = t.habitat, ground = t.heightAt(theta, s), lake = t.lake && fromLake(t.lake, s) < 0 ? t.lake : null;
  if (lake && feet < lake.level + 0.3) return 'water';
  const by = t.meres.length ? t.form.mereAt(theta, s) : null;
  if (by && by.edge < 0 && feet < by.mere.level + 0.3) return 'water';
  const river = t.riverAt(theta, s);
  if (river && feet < river.surface + 0.3) return 'water';
  if (feet > ground + 0.25) {
    // Over the lake, the only deck is the pavilion's and its bridges'; the summit hut is timber too.
    if (lake) return 'timber';
    for (const l of landmarksOf(t)) if (l.kind === 'hut' && floorGap(h.profile.at(l.s).r, theta, s, l.theta, l.s) < HUT_REACH) return 'timber';
    for (const c of crossingsOf(t)) {
      if (floorGap(h.profile.at(c.frame.s).r, theta, s, c.frame.theta, c.frame.s) < c.half + 2) return c.kind === 'timber' || c.kind === 'log' ? 'timber' : 'stone';
    }
    return 'stone';
  }
  if (t.courtAt(theta, s)) return 'stone';
  if (e.snowAt(theta, s, ground) > 0.5) return 'snow';
  const path = pathsOf(h).pathAt(theta, s, 0);
  if (path && path.distance <= path.width / 2) return LAYER_STEP[path.layer] ?? 'gravel';
  const colour = new Float32Array(3), floor = new Uint8Array(8);
  e.colorAt(theta, s, ground, 0, colour, 0, undefined, floor);
  let best = 0;
  for (let k = 1; k < floor.length; k++) if (floor[k] > floor[best]) best = k;
  return LAYER_STEP[['grass', 'dry grass', 'litter', 'needles', 'dirt', 'gravel', 'sand', 'rock'][best]] ?? 'grass';
}

/**
 * How far apart footsteps fall (m) at a walking speed (m/s) under a gravity (m/s²). A leg swings like a pendulum, so
 * the cadence goes with √g: on the floor about two steps a second at a walk; near the axis slower, longer strides.
 */
export function strideAt(speed: number, gravity: number): number {
  const cadence = (1.5 + 0.3 * Math.min(speed, 6)) * Math.sqrt(Math.max(gravity, 0.05) / 9.81);
  return Math.max(0.3, speed / Math.max(cadence, 0.2));
}
