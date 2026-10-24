/**
 * Everyone up on the land at once, as the far view needs them (render/specks.ts): where their feet are in the world,
 * which way and how fast they go (so a list made every few seconds can be carried on between), how they hold
 * themselves, the terrain's horizons where they stand (their light), and their colours as far as their look's seed
 * tells without measuring it (those in drone bodies: their design's size and colours as its spec tells). Made in a worker for the whole habitat: some
 * tens of thousands of people, each about a pixel or less from where the near levels end. Pure.
 */
import { toWorld, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { horizonAt } from '../gen/horizon';
import { landmarkTopAt } from '../gen/landmarks';
import { BODY_WIDTH, MEAN_HEIGHT, POSE, SPECK_STRIDE, guessBands, packColor, writeSpeck } from '../gen/standIn';
import { designGuess } from '../gen/drone';
import { kept } from '../gen/kept';
import type { Habitat } from '../blueprint';
import { feetOf, footingOf } from './footing';
import { peopleAt, personKey, residentOf } from './population';

/** Everyone up on the land at clock time `t`, as the speck layer draws them, in order of `personKey`. */
export interface Specks {
  t: number;
  count: number;
  /** `SPECK_STRIDE` floats per person (gen/standIn.ts `writeSpeck`): feet, way, pose, colours guessed from their look's seed, horizons. */
  data: Float32Array;
  /** `personKey`, ascending: the same person as the near levels know them. */
  key: Float64Array;
  /** Who they are (`residentOf`): their measured look, where it is known, replaces the guess. */
  resident: Int32Array;
  /** The drone body they wear (`Resident.design`), or −1: once built, its measure replaces the guess. */
  design: Int8Array;
}

/** Horizons are shared by everyone within a cell this wide (m): far off, the light changes slowly over the land. */
const HORIZON_CELL = 40;
/** The most horizon cells kept per terrain before the cache starts over. */
const HORIZON_CELLS = 50000;
const horizons = new WeakMap<Terrain, Map<number, [number, number]>>();

function horizonOf(terrain: Terrain, theta: number, s: number): [number, number] {
  let cache = horizons.get(terrain);
  if (!cache) horizons.set(terrain, (cache = new Map()));
  const R = terrain.habitat.radius, i = Math.round((theta * R) / HORIZON_CELL), j = Math.round(s / HORIZON_CELL);
  const key = i * 1e7 + j;
  let h = cache.get(key);
  if (!h) {
    if (cache.size >= HORIZON_CELLS) cache.clear();
    h = horizonAt(terrain, (i * HORIZON_CELL) / R, Math.max(0, Math.min(terrain.habitat.profile.length, j * HORIZON_CELL)));
    cache.set(key, h);
  }
  return h;
}

/**
 * Those who stayed put in the last list made over a terrain, by key (ascending), and where they stood: most people
 * out are at their places, so the next list takes their footing and light from here instead of finding them again.
 * At most `KEPT` people (about 40 bytes each), so the cache has a byte budget whatever the habitat's size.
 */
interface Still {
  key: Float64Array;
  theta: Float64Array;
  s: Float64Array;
  h: Float32Array;
  swim: Uint8Array;
  /** How they held themselves (a new beat may sit them down where they stood). */
  pose: Uint8Array;
  horizon: Float32Array;
}
const KEPT = 250000;
const stills = new WeakMap<Terrain, Still>();

/** The drone bodies residents wear as their specks guess them: height, width (as `writeSpeck` takes it) and colour. */
const bodiesOf = kept((h: Habitat) => Array.from({ length: h.params.life.drones.bodies }, (_, k) => {
  const g = designGuess(h, 'person', k);
  return { height: g.height, width: g.across / (g.height * BODY_WIDTH), color: packColor(g.albedo.map((v) => Math.pow(v, 1 / 2.2)) as [number, number, number]) };
}));

/** Everyone up on the land at clock time t (s). */
export function specksAt(terrain: Terrain, t: number): Specks {
  const h = terrain.habitat, { profile } = h, people = peopleAt(h, t, undefined, terrain), n = people.length;
  const keys = people.map(personKey), order = Array.from(people.keys()).sort((a, b) => keys[a] - keys[b]);
  const out: Specks = { t, count: n, data: new Float32Array(n * SPECK_STRIDE), key: new Float64Array(n), resident: new Int32Array(n), design: new Int8Array(n) };
  const before = stills.get(terrain), still = order.filter((at) => !people[at].moving).length;
  const next: Still | null = still <= KEPT ? { key: new Float64Array(still), theta: new Float64Array(still), s: new Float64Array(still), h: new Float32Array(still), swim: new Uint8Array(still), pose: new Uint8Array(still), horizon: new Float32Array(still * 2) } : null;
  let j = 0, kept = 0;
  order.forEach((at, i) => {
    const p = people[at], key = keys[at];
    let foot: { h: number; pose: number; swim: boolean } | null = null, horizon: [number, number] | null = null;
    if (!p.moving && before) {
      // Both lists go up by key: the last one's row for this person, if they stood still there too.
      while (j < before.key.length && before.key[j] < key) j++;
      if (j < before.key.length && before.key[j] === key && before.theta[j] === p.theta && before.s[j] === p.s && before.pose[j] === p.posture) {
        const swim = before.swim[j] === 1;
        foot = { h: before.h[j], pose: swim ? POSE.upright : p.posture, swim };
        horizon = [before.horizon[j * 2], before.horizon[j * 2 + 1]];
      }
    }
    const who = residentOf(h, p.resident), body = who.design >= 0 ? bodiesOf(h)[who.design] : null;
    foot ??= footingOf(terrain, p, landmarkTopAt(terrain, ...feetOf(h, p)), body?.height ?? MEAN_HEIGHT);
    horizon ??= horizonOf(terrain, p.theta, p.s);
    if (!p.moving && next) {
      next.key[kept] = key; next.theta[kept] = p.theta; next.s[kept] = p.s; next.h[kept] = foot.h; next.swim[kept] = foot.swim ? 1 : 0; next.pose[kept] = p.posture;
      next.horizon[kept * 2] = horizon[0]; next.horizon[kept * 2 + 1] = horizon[1];
      kept++;
    }
    const feet = toWorld(profile, { theta: p.theta, s: p.s, h: foot.h });
    let drift: Vec3 = [0, 0, 0];
    // Walking, or aboard a boat under way (going the way it goes, whichever way they face).
    if ((p.moving || p.drift !== undefined) && p.speed > 0) {
      // Over the floor: along the axis (heading 0) and around it (heading π/2), a metre each way.
      const r = Math.max(1, profile.at(p.s).r);
      const along = unit(toWorld(profile, { theta: p.theta, s: Math.min(profile.length, p.s + 0.5), h: foot.h }), toWorld(profile, { theta: p.theta, s: Math.max(0, p.s - 0.5), h: foot.h }));
      const around = unit(toWorld(profile, { theta: p.theta + 0.5 / r, s: p.s, h: foot.h }), toWorld(profile, { theta: p.theta - 0.5 / r, s: p.s, h: foot.h }));
      const way = p.drift ?? p.heading, c = Math.cos(way) * p.speed, sn = Math.sin(way) * p.speed;
      drift = [along[0] * c + around[0] * sn, along[1] * c + around[1] * sn, along[2] * c + around[2] * sn];
    }
    if (body) writeSpeck(out.data, i * SPECK_STRIDE, feet, body.height, drift, POSE.upright, [body.color, body.color, body.color], horizon, body.width);
    else writeSpeck(out.data, i * SPECK_STRIDE, feet, MEAN_HEIGHT, drift, foot.pose, guessBands(who.look, who.body === 'shell'), horizon, 1);
    out.key[i] = key;
    out.resident[i] = p.resident;
    out.design[i] = who.design;
  });
  if (next) stills.set(terrain, next); else stills.delete(terrain);
  return out;
}

function unit(a: Vec3, b: Vec3): Vec3 {
  const d: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}
