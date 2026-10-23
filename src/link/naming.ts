/**
 * What the link calls the things of the land (names on hover, names.ts): the places (landmarks, courts, harbours,
 * crossings, the founders' grove, the Lift Stair and the Threshold), the plants and stones scattered over it, its water
 * and its ground. Made once per terrain; `name` answers for one ray from the eye, a few times a second while the
 * pointer rests.
 */
import { angleDiff, v3, type Vec3 } from '@futuremagic/core';
import { fromWorld, toWorld, type Habitat } from '../blueprint';
import { WATER_NAMES, courtReach, styleWords } from '../gen/capsules';
import { crossingsOf, type CrossingKind } from '../gen/crossings';
import type { Ecology } from '../gen/ecology';
import { fleetOf, inBasin, inBasinFrame } from '../gen/harbours';
import { landmarksOf, reachOf, standOnLand } from '../gen/landmarks';
import { centreOf, liftStairOf, rampOf } from '../gen/liftStair';
import { handrailOf } from '../gen/lifts';
import { entrancesOf, planOf, siteOf } from '../gen/plan';
import { LEVELS, plantsOf, poseOf, standsIn, type Species } from '../gen/scatter';
import type { Terrain } from '../gen/terrain';
import { capital, groundUnder, nameUnder, oneOf, type Nameable, type Named } from './names';

/** How far the link names a tree or a big stone, and anything smaller (m). */
export const NAMES_REACH = { tall: 150, small: 40 } as const;
/** From this tall a plant counts as tall, and below this small it is not named at all (m). */
const TALL = 3;
const SMALLEST = 0.5;
/** How far a court still names the ground round it ("by Court 4", m). */
const BY_COURT = 800;
/** How far the land may rise or fall under the ray's stretch (m), and how long a piece of it is looked along at a time. */
const LAND_WOBBLE = 25;
const CHUNK = 20;

const CROSSING_NAMES: Readonly<Record<CrossingKind, string>> = { arch: 'Stone bridge', timber: 'Timber bridge', stepping: 'Stepping stones', log: 'Log bridge' };

/** A named stretch of land: the ground under the pointer within `radius` of `at` (world) is it. */
type Area = Nameable;

export class Namer {
  private readonly h: Habitat;
  /** Named where the ground under the pointer lies in them (the smallest that holds it). */
  private readonly areas: Area[] = [];
  /** Named where the ray passes them (the Lift Stair and the Threshold stand up the endcap, off the floor). */
  private readonly standing: Nameable[] = [];
  private readonly courts: { n: number; theta: number; s: number }[] = [];
  private readonly plants: Species[];
  private readonly shares: Float32Array;

  constructor(readonly t: Terrain, private readonly ecology: Ecology) {
    const h = (this.h = t.habitat), plan = planOf(h), hr = handrailOf(h);
    const area = (key: string, name: string, theta: number, s: number, radius: number, detail?: string): void => {
      this.areas.push({ key, name, detail, radius, at: toWorld(h.profile, { theta, s, h: t.standAt(theta, s) }) });
    };
    for (const l of landmarksOf(t)) {
      if (l.kind === 'pavilion') area('pavilion', 'Lake pavilion', l.theta, l.s, reachOf(l), 'On the ring lake');
      else area('summit-hut', 'Summit hut', l.theta, l.s, reachOf(l), 'High on the Mountain');
    }
    const grove = siteOf(plan, 'founders-grove');
    if (grove) area('grove', "Founders' grove", grove.theta, grove.s, grove.size, 'Planted by the first people here');
    entrancesOf(plan).forEach((site, i) => {
      const style = styleWords(plan, site);
      this.courts.push({ n: i + 1, theta: site.theta, s: site.s });
      area(`court-${i}`, `Court ${i + 1}`, site.theta, site.s, courtReach(t, site), `${style ? capital(style) + ' · ' : ''}a way down to the homes below`);
    });
    const fleet = fleetOf(h);
    fleet.harbours.forEach((hb, i) => {
      const basin = fleet.basins[hb.basin];
      area(`harbour-${i}`, `Harbour ${i + 1}`, hb.frame.theta, hb.frame.s, Math.max(hb.reach, 10 * hb.handrail), basin ? capital(WATER_NAMES[basin.kind]) : undefined);
    });
    crossingsOf(t).forEach((c, i) => area(`crossing-${i}`, CROSSING_NAMES[c.kind], c.frame.theta, c.frame.s, c.half, 'Over the river'));
    const stair = liftStairOf(h);
    if (stair) {
      const ramp = rampOf(h);
      stair.platforms.forEach((p, i) => {
        const top = p.kind === 'top' || p.kind === 'gallery';
        this.standing.push({
          key: top ? 'threshold' : 'lift-stair', at: ramp.world(...centreOf(p), p.e + hr), radius: Math.hypot(p.z1 - p.z0, p.w1 - p.w0) / 2,
          name: top ? 'The Threshold' : 'Lift Stair', detail: top ? 'Where newcomers arrive' : `Up the endcap to the Threshold · landing ${i + 1}`,
        });
      });
    }
    this.plants = plantsOf(ecology).filter((sp) => sp.what !== 'cover' && sp.tall >= SMALLEST);
    this.shares = new Float32Array(ecology.climate.biomes.length);
  }

  /**
   * What the ray from `eye` along `dir` (unit) rests on: `others` (people, passing things) or a plant, else the place
   * where it meets the ground (or the water, or a landmark's deck), else the ground itself. `below`: under the land,
   * only `others` are named.
   */
  name(eye: Vec3, dir: Vec3, others: Iterable<Nameable>, below = false): Named | null {
    const h = this.h, t = this.t, { profile } = h;
    if (below) return nameUnder(eye, dir, others, NAMES_REACH.small * 1.5);
    const height = (p: Vec3): number => {
      const at = fromWorld(profile, p[0], p[1], p[2]);
      return at.s < 0 || at.s > profile.length ? 1e3 : at.h - standOnLand(t, at.theta, at.s);
    };
    const ground = groundUnder(eye, dir, height, 2.5 * Math.max(h.radius, profile.length));
    const hit = nameUnder(eye, dir, [...others, ...this.standing, ...this.plantsAlong(eye, dir, ground ?? Infinity)], ground ?? Infinity);
    if (hit || ground === null) return hit;
    const p = v3(eye[0] + dir[0] * ground, eye[1] + dir[1] * ground, eye[2] + dir[2] * ground);
    let area: Area | null = null;
    for (const a of this.areas) {
      const d = Math.hypot(p[0] - a.at[0], p[1] - a.at[1], p[2] - a.at[2]);
      if (d <= a.radius && (!area || a.radius < area.radius)) area = a;
    }
    if (area) return { key: area.key, name: area.name, detail: area.detail, distance: ground };
    const at = fromWorld(profile, ...p);
    return { ...this.groundAt(at.theta, at.s), distance: ground };
  }

  /** The ground at (θ, s): its water, its snow, or what grows there, and the court it is by. */
  private groundAt(theta: number, s: number): { key: string; name: string; detail?: string } {
    const t = this.t, h = this.h, rise = t.heightAt(theta, s);
    let by: { n: number; d: number } | null = null;
    for (const c of this.courts) {
      const d = Math.hypot(angleDiff(theta, c.theta) * h.radius, c.s - s);
      if (d < BY_COURT && (!by || d < by.d)) by = { n: c.n, d };
    }
    const detail = by ? `By Court ${by.n}` : undefined;
    if (t.standAt(theta, s) > rise + 0.05) {
      if (t.riverAt(theta, s)) return { key: 'river', name: 'River', detail };
      const fleet = fleetOf(h);
      for (const b of fleet.basins) {
        const { u, v } = inBasinFrame(b, theta, s);
        if (inBasin(b, u, v, -40)) return { key: `water-${b.id}`, name: capital(WATER_NAMES[b.kind]), detail };
      }
      return { key: 'water', name: 'Water', detail };
    }
    if (this.ecology.snowAt(theta, s, rise) > 0.5) return { key: 'snow', name: 'Snow', detail: 'Above the Mountain’s snow line' };
    const shares = this.ecology.biomesAt(theta, s, rise, 0, this.shares);
    let k = 0;
    for (let b = 1; b < shares.length; b++) if (shares[b] > shares[k]) k = b;
    const biome = this.ecology.climate.biomes[k];
    return { key: `biome-${k}`, name: capital(biome.name), detail };
  }

  /**
   * The plants and stones the ray passes on its way to the ground (`ground` m along it), as balls round them: looked
   * for only along the stretch of the ray low enough to touch them, a short piece of floor at a time.
   */
  private plantsAlong(eye: Vec3, dir: Vec3, ground: number): Nameable[] {
    const out: Nameable[] = [], { profile } = this.h, shapes = LEVELS[0].variants, from = fromWorld(profile, ...eye);
    // How fast the ray climbs away from the floor (per m), and how high over the floor it starts (m).
    const r0 = Math.max(1, Math.hypot(eye[0], eye[1])), climb = -(eye[0] * dir[0] + eye[1] * dir[1]) / r0, over = from.h - this.t.standAt(from.theta, from.s);
    for (const sp of this.plants) {
      const tall = sp.tall >= TALL, debris = sp.what === 'debris', pad = 0.5 * sp.tall + 1;
      // Only where the ray is below the tallest of them (the land may rise or fall a little on the way).
      const room = sp.tall + LAND_WOBBLE;
      let t0 = 0, t1 = Math.min(ground, tall ? NAMES_REACH.tall : NAMES_REACH.small);
      if (climb > 1e-6) t1 = Math.min(t1, (room - over) / climb);
      else if (climb < -1e-6) t0 = Math.max(0, (over - room) / -climb);
      for (let a = t0; a < t1; a += CHUNK) {
        const b = Math.min(t1, a + CHUNK), p = fromWorld(profile, eye[0] + dir[0] * a, eye[1] + dir[1] * a, eye[2] + dir[2] * a);
        const q = fromWorld(profile, eye[0] + dir[0] * b, eye[1] + dir[1] * b, eye[2] + dir[2] * b);
        const r = Math.max(1, profile.at(p.s).r), qt = p.theta + angleDiff(p.theta, q.theta);
        const box = { theta0: Math.min(p.theta, qt) - pad / r, theta1: Math.max(p.theta, qt) + pad / r, s0: Math.min(p.s, q.s) - pad, s1: Math.max(p.s, q.s) + pad };
        standsIn(this.ecology, sp, box, 0, (theta, s, ground0, f, along) => {
          // Each once: the boxes overlap by the pad.
          const key = `plant-${sp.id}-${theta.toFixed(5)}-${s.toFixed(2)}`;
          if (out.some((n) => n.key === key)) return;
          const foot = toWorld(profile, { theta, s, h: ground0 });
          // As tall as it could be first (cheap), then as tall as it is.
          if (!passes(eye, dir, foot, sp.tall, t1)) return;
          const size = poseOf(this.ecology, sp, theta, s, foot, f, along, shapes).height;
          const lift = debris ? 0.35 : 0.55, radius = (debris ? 0.5 : 0.45) * size;
          out.push({ key, at: toWorld(profile, { theta, s, h: ground0 + lift * size }), radius, name: debris ? oneOf(sp.spec.name) : capital(sp.spec.name), detail: tall && !debris ? `About ${Math.round(size)} m tall` : undefined });
        });
      }
    }
    return out;
  }
}

/** Whether the ray could pass something up to `size` tall standing at `foot`, within `reach` m. */
function passes(eye: Vec3, dir: Vec3, foot: Vec3, size: number, reach: number): boolean {
  const x = foot[0] - eye[0], y = foot[1] - eye[1], z = foot[2] - eye[2], t = x * dir[0] + y * dir[1] + z * dir[2];
  if (t < -size || t > reach + size) return false;
  const off2 = x * x + y * y + z * z - t * t, r = size * 1.2 + 1;
  return off2 <= r * r;
}
