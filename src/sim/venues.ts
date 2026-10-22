/**
 * Where people go when they come up on the land (design "Who is out on the land"): the places the habitat plan made
 * room for, each with the court people come up at to reach it, how strongly it draws them and what they do there.
 *
 *   court      the rim of every entrance court: people meet, talk, sit on the steps;
 *   commons    the middle of each district's commons, used in the district's style (`STYLE_ACTIVITY`);
 *   stroll     the Sunwalk where it passes near a court;
 *   shore      the ring lake's shore below a court in reach of it: bathing;
 *   reserve    points along the Sunwalk in the reserve: hikers;
 *   landmarks  the Lift Stair (climbed by day, watched from at dusk), the lake pavilion, the founders' grove and the
 *              summit hut, each drawing a fixed share of the habitat's visitors (`LANDMARK_SHARE`) from anywhere.
 *
 * People come up at the court nearest where they are going (the city below has its own transit), so every venue
 * belongs to a court, and a court draws by what lies around it. Places of the land (orchards, vineyards, grown halls)
 * join when the people are drawn (the terrain knows them). Pure, made once per habitat.
 */
import { kept } from '../gen/kept';
import { fromLake, planOf, type Lake, type Site, type SiteKind } from '../gen/plan';
import type { DistrictStyle, Habitat } from '../blueprint';
import { floorGap, sunwalkOf, walksOf } from './walks';


/** What someone is doing. */
export type Activity =
  | 'walk' | 'meet' | 'stroll' | 'picnic' | 'bathe' | 'sit' | 'gather' | 'herd' | 'play' | 'make' | 'wander'
  | 'swim' | 'climb' | 'watch' | 'fly' | 'hike' | 'stargaze' | 'sunwalk';

export const ACTIVITIES: readonly Activity[] = ['walk', 'meet', 'stroll', 'picnic', 'bathe', 'sit', 'gather', 'herd', 'play', 'make', 'wander', 'swim', 'climb', 'watch', 'fly', 'hike', 'stargaze', 'sunwalk'];

/** What a district's people do on its commons, by its style (blueprint/cultures.ts). */
export const STYLE_ACTIVITY: Readonly<Record<DistrictStyle, Activity>> = {
  orchard: 'picnic', water: 'bathe', stone: 'sit', grove: 'gather', herd: 'herd', play: 'play', makers: 'make', 'let-go': 'wander',
};

export type VenueKind = 'court' | 'commons' | 'stroll' | 'shore' | 'reserve' | 'landmark';

/** Share of all the habitat's outings each landmark draws, from anywhere, and when. */
export const LANDMARK_SHARE: Partial<Record<SiteKind, { share: number; activity: Activity; evening?: boolean }[]>> = {
  'lift-stair': [{ share: 0.03, activity: 'climb' }, { share: 0.05, activity: 'watch', evening: true }],
  'lake-pavilion': [{ share: 0.03, activity: 'gather' }],
  'founders-grove': [{ share: 0.015, activity: 'sit' }],
  'summit-hut': [{ share: 0.01, activity: 'fly' }],
};

/** The point `off` m out from the lake's shore (negative: into the water) on the side of the axis where s lies. */
export const besideLake = (lake: Lake, s: number, off: number): number => lake.s + (s < lake.s ? -1 : 1) * (lake.halfWidth + off);

export interface Venue {
  kind: VenueKind;
  activity: Activity;
  theta: number;
  s: number;
  /** How far around it people spread out while they are there (m). */
  spread: number;
  /** The court people come up at to reach it (index into `courts`). */
  court: number;
  /** How strongly it draws people from its court (landmarks: 0, they draw by `share`). */
  pull: number;
  /** For a landmark, the share of all outings it draws. */
  share: number;
  /** Visited at dusk, not by day. */
  evening: boolean;
  /** The point of the walk net people leave the paths at for it. */
  vertex: number;
}

export interface Venues {
  readonly courts: readonly Site[];
  /** Each court's point of the walk net (its way's end). */
  readonly courtVertex: readonly number[];
  readonly venues: readonly Venue[];
  /** Each court's venues (indices into `venues`), and how far its farthest one lies (m, with its spread). */
  readonly byCourt: readonly (readonly number[])[];
  readonly reach: Float64Array;
  /** Each court's own draw: the sum of its venues' pulls. */
  readonly draw: Float64Array;
}

function makeVenues(h: Habitat): Venues {
  const plan = planOf(h), net = walksOf(h), R = h.radius, life = h.params.life, { profile } = h;
  const courts = plan.sites.filter((x) => x.kind === 'entrance');
  const apart = (t0: number, s0: number, t1: number, s1: number): number => floorGap(R, t0, s0, t1, s1);
  const nearestCourt = (theta: number, s: number, among: readonly Site[] = courts): number => {
    let best = 0, g = Infinity;
    for (const c of among) {
      const d = apart(c.theta, c.s, theta, s);
      if (d < g) { g = d; best = courts.indexOf(c); }
    }
    return best;
  };
  const venues: Venue[] = [];
  const keep = (v: Omit<Venue, 'vertex'>): void => { venues.push({ ...v, vertex: net.vertexNear(v.theta, v.s) }); };
  const spacing = h.params.plan.entranceSpacing, lake = plan.lake;

  courts.forEach((c, i) => keep({ kind: 'court', activity: 'meet', theta: c.theta, s: c.s, spread: c.size * 1.5, court: i, pull: 1, share: 0, evening: false }));
  for (const d of plan.districts) {
    if (!courts.length || fromLake(lake, d.s) < 0 || d.s < profile.floorStart || d.s > profile.floorEnd) continue;
    keep({ kind: 'commons', activity: STYLE_ACTIVITY[d.style], theta: d.theta, s: d.s, spread: spacing * 0.15, court: nearestCourt(d.theta, d.s, d.entrances.length ? d.entrances : courts), pull: 1.5, share: 0, evening: false });
  }
  const walk = sunwalkOf(h);
  if (walk) {
    courts.forEach((c, i) => {
      // The Sunwalk's nearest point to the court, if it is in reach.
      let best = -1, g = Infinity;
      for (let k = 0; k < walk.length; k += 2) {
        const d = apart(c.theta, c.s, walk[k], walk[k + 1]);
        if (d < g) { g = d; best = k; }
      }
      if (best >= 0 && g < life.reach) keep({ kind: 'stroll', activity: 'stroll', theta: walk[best], s: walk[best + 1], spread: spacing * 0.1, court: i, pull: 1, share: 0, evening: false });
    });
    // Hikes into the reserve: along the Sunwalk where it runs through it, a reach apart.
    let last = -Infinity;
    for (let k = 0; k < walk.length; k += 2) {
      const s = walk[k + 1];
      if (s >= plan.reserveEnd) break;
      if (s - last < life.reach) continue;
      last = s;
      if (courts.length) keep({ kind: 'reserve', activity: 'hike', theta: walk[k], s, spread: spacing * 0.05, court: nearestCourt(walk[k], s), pull: 0.4, share: 0, evening: false });
    }
  }
  if (lake) {
    courts.forEach((c, i) => {
      const off = fromLake(lake, c.s);
      if (off > life.reach) return;
      // The shore straight down the axis from the court, just at the water.
      const s = besideLake(lake, c.s, -lake.halfWidth * 0.03);
      keep({ kind: 'shore', activity: 'swim', theta: c.theta, s, spread: Math.min(spacing * 0.08, lake.halfWidth * 0.5), court: i, pull: 1.2, share: 0, evening: false });
    });
  }
  for (const site of plan.sites) {
    const shares = LANDMARK_SHARE[site.kind];
    if (!shares || !courts.length) continue;
    for (const { share, activity, evening } of shares) {
      // The Stair is climbed from its foot and watched from the face's lowest terraces, beside it.
      let s = site.s, spread = Math.max(site.size, spacing * 0.03);
      if (site.kind === 'lift-stair') { s = site.s + (evening ? 0.05 : 0.02) * (profile.length - site.s); spread = (evening ? 6 : 1) * site.size; }
      keep({ kind: 'landmark', activity, theta: site.theta, s, spread, court: nearestCourt(site.theta, Math.min(site.s, profile.floorEnd)), pull: 0, share, evening: !!evening });
    }
  }

  const byCourt: number[][] = courts.map(() => []), reach = new Float64Array(courts.length), draw = new Float64Array(courts.length);
  // A court's reach: the farthest any of its people gets, along the route to a venue or around it.
  const courtVertex = courts.map((c) => { const v = net.vertexAt(c.theta, c.s); return v >= 0 ? v : net.vertexNear(c.theta, c.s); });
  venues.forEach((v, k) => {
    byCourt[v.court].push(k);
    const c = courts[v.court], p = net.between(courtVertex[v.court], v.vertex).points;
    let far = apart(c.theta, c.s, v.theta, v.s) + v.spread;
    for (let i = 0; i < p.length; i += 2) far = Math.max(far, apart(c.theta, c.s, p[i], p[i + 1]));
    reach[v.court] = Math.max(reach[v.court], far);
    draw[v.court] += v.pull;
  });
  return { courts, courtVertex, venues, byCourt, reach, draw };
}

/** The habitat's venues, made once and kept. */
export const venuesOf: (h: Habitat) => Venues = kept(makeVenues);
