/**
 * The system's habitats as points of light (plan "The Whole System", S2): every habitat of the ledger beyond the
 * Necklace (necklace.ts draws those) shows where its reflected sunlight would show, drawn as the stars and planets are
 * (STARS) at its true brightness. So from home the two clouds at the Earth–Moon L4 and L5 are bands of bright stars
 * either side of the Moon's path, while the thousands around Mars or Saturn appear only as one comes near them,
 * swarming about the planet, dark in its shadow. The world bible's polities and the brightest of the rest are named
 * beside their points, and the catalogue (`panel`) tells of each polity: where, how many, and how long its light takes
 * to reach home.
 *
 * Tens of thousands of habitats cannot all be placed every frame, nor need to be: each frame places those lit now
 * exactly, and looks through a few hundred more for any that have come into sight, region by region, the regions that
 * could hold the brightest first (`Ledger.reach`); a region that cannot hold anything bright enough from here is passed
 * over whole. A habitat stays lit until it is well below the threshold, so nothing flickers at the edge.
 */
import { Mesh } from 'three/webgpu';
import type { Camera } from 'three';
import type { Stage } from '@futuremagic/stage';
import { v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { LOOK } from '../gen/skin';
import { AU } from '../space/constants';
import { apply } from '../space/pose';
import type { Asteroid } from '../space/asteroids';
import type { SolarSystem } from '../space/solarSystem';
import type { Space } from '../space/space';
import { meanBodyAt, type Body, type BodyAt, type HabitatRecord, type Ledger, type Orbit } from '../system';
import { STARS } from './materials';
import { dropUploaded, freeMesh, pointsChanged, pointsGeometry, setPoint } from './geometry';
import { STAR_SIGMA } from './exposure';
import { toScreen } from './screen';
import { pickMarks } from '../link';
import './habitats.css';

/** At most this many habitats lit at once (the points' buffer). */
const MOST = 8192;
/** Below this flux (relative to the Sun's at 1 AU) a habitat is too faint to see even with the eyes opened for the stars. */
const FLOOR = 1e-15;
/** A lit habitat goes out only below this share of the floor. */
const OUT = 0.5;
/** Habitats looked through per frame for any that have come into sight. */
const LOOK_THROUGH = 150;
/** A habitat is named once its brightest pixel shows at this (exposed), at most this many at a time, this far apart (px). */
const NAMED_PEAK = 0.12;
const MOST_NAMED = 8;
const NAMES_APART: readonly [number, number] = [110, 16];
/** The hull's albedo from far off: its cells, new and weathered, half and half (gen/skin.ts). */
const HULL: Vec3 = [0, 1, 2].map((c) => (LOOK.cellNew[c] + LOOK.cellOld[c]) / 2) as Vec3;
/** A habitat placed by the mean orbits this far off from where the eye is can jump when the eye arrives (m). */
const JUMP = 1e9;

/** One lit habitat: what it orbits, its ledger index, and what its light needs. */
interface Lit {
  k: number;
  orbit: Orbit;
  /** The radius of a sphere with its surface (m), and its albedo in linear RGB. */
  size: number;
  albedo: Vec3;
  kept: boolean;
  /** This frame: its flux (RGB), direction from the eye, depth, and whether it is drawn. */
  flux: Vec3;
  dir: Vec3;
  distance: number;
  shown: boolean;
}

/** Something a habitat can be behind, relative to the eye in view axes (m). */
export interface Occluder {
  center: Vec3;
  radius: number;
}

/** A diffuse sphere's brightness at phase angle α, relative to full (Lambert). */
function lambert(alpha: number): number {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
}

/** How big and bright a habitat looks from far: a drum or bubble by its hull, a hollowed rock by the rock. */
function looks(h: HabitatRecord, rock: Asteroid | null): { size: number; albedo: Vec3 } {
  if (h.form === 'asteroid' && rock) return { size: rock.body.radius, albedo: rock.body.colour };
  // Mean projected area of a convex body is a quarter of its surface (Cauchy); a swarm spreads its floor wider.
  const surface = h.form === 'bubble' ? 4 * Math.PI * h.radius * h.radius : 2 * Math.PI * h.radius * (h.length + h.radius);
  return { size: Math.sqrt(surface * (h.form === 'swarm' ? 2.5 : 1) / (4 * Math.PI)), albedo: HULL };
}

export class HabitatLights {
  private points = pointsGeometry(MOST);
  private mesh: Mesh;
  private lit: Lit[] = [];
  private litK = new Set<number>();
  /** The look through: regions still to look through this round (ledger region index, −1 for the kept), and where. */
  private queue: number[] = [];
  private cursor = 0;
  private lastEye: Vec3 | null = null;
  private names = document.createElement('div');
  private nameOf = new Map<number, string>();
  private shedGeneric = false;
  private ready = false;
  /** Names beside the points (the catalogue's checkbox). */
  naming = true;
  /** A name clicked: the habitat's ledger id. */
  onPick: ((id: string) => void) | null = null;

  constructor(private stage: Stage, private system: SolarSystem, private ledger: Ledger, private far: number) {
    this.mesh = new Mesh(this.points.geometry, STARS.material);
    this.mesh.name = 'habitats of the system';
    this.mesh.frustumCulled = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.names.className = 'habitat-names';
    this.names.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).dataset.k;
      if (k !== undefined) this.onPick?.(this.ledger.nth(Number(k)).id);
    });
  }

  /** The labels' layer, to put over the canvas. */
  get element(): HTMLElement { return this.names; }
  get count(): number { return this.lit.length; }

  async start(): Promise<void> {
    await this.stage.add(this.mesh);
    this.ready = true;
  }

  /** Another home habitat (the Lab): another ledger; the lights start over. */
  reset(ledger: Ledger): void {
    this.ledger = ledger;
    this.lit = []; this.litK.clear(); this.queue = []; this.nameOf.clear(); this.lastEye = null;
  }

  /**
   * Bodies: Earth, the Moon and the Sun from the space model (as the eye and the Necklace are), the rest exactly; each
   * once a date, as thousands of habitats ask.
   */
  private bodies = new Map<Body, Vec3>();
  private bodiesJd = NaN;
  private bodyAt: BodyAt = (b: Body, jd: number) => {
    if (jd !== this.bodiesJd) { this.bodies.clear(); this.bodiesJd = jd; }
    let p = this.bodies.get(b);
    if (!p) {
      p = b === 'sun' || b === 'earth' || b === 'moon' ? meanBodyAt(b, jd) : this.system.position(b, jd);
      this.bodies.set(b, p);
    }
    return p;
  };

  /**
   * Place and light the habitats in sight from `eye` (in the home habitat's orbit frame) at clock time t: the points
   * in view axes, as SolarView's. `occluders` (relative to the eye, view axes) hide what is behind them.
   */
  follow(space: Space, eye: Vec3, t: number, occluders: readonly Occluder[]): void {
    if (!this.ready) return;
    const jd = space.jd(t), axes = space.frames.relative('sun', space.home.orbitFrame, t).axes;
    const eyeSolar = space.frames.position(eye, space.home.orbitFrame, 'sun', t);
    if (this.lastEye && v3len(v3sub(eyeSolar, this.lastEye)) > JUMP) this.queue = [];
    this.lastEye = eyeSolar;
    const light = (l: Lit, at: Vec3): void => {
      const rel = v3sub(at, eyeSolar), distance = v3len(rel), sunD = v3len(at);
      // The phase angle, Sun–habitat–eye, from the vectors to the Sun (−at) and to the eye (−rel).
      const alpha = Math.atan2(v3len(v3cross(at, rel)), v3dot(at, rel));
      const k = lambert(alpha) * (l.size / distance) ** 2 * (AU / sunD) ** 2 * this.shade(l.orbit, at, jd);
      l.flux = [l.albedo[0] * k, l.albedo[1] * k, l.albedo[2] * k];
      l.dir = apply(axes, v3scale(rel, 1 / distance));
      l.distance = distance;
    };
    // The lit ones, exactly; out with any well below the floor.
    for (let i = this.lit.length - 1; i >= 0; i--) {
      const l = this.lit[i];
      light(l, this.ledger.position(l, t, this.bodyAt));
      if (brightness(l.flux) < FLOOR * OUT && !l.kept) { this.litK.delete(l.k); this.lit[i] = this.lit[this.lit.length - 1]; this.lit.pop(); }
    }
    // Look through a few hundred more.
    for (let n = 0; n < LOOK_THROUGH && this.lit.length < MOST; n++) {
      const k = this.next(eyeSolar, t);
      if (k < 0) break;
      if (this.litK.has(k)) continue;
      const h = this.ledger.nth(k);
      if (h.region === 'necklace' || h.form === 'surface') continue;
      const l: Lit = { k, orbit: h.orbit, ...looks(h, this.ledger.rock(h)), kept: k < this.ledger.habitats.length, flux: [0, 0, 0], dir: [0, 0, 1], distance: 1, shown: false };
      light(l, this.ledger.position(h, t, this.bodyAt));
      if (brightness(l.flux) >= FLOOR) { this.lit.push(l); this.litK.add(k); }
    }
    // Into the points, those not behind a body (one that shows a disc: the rest hide next to nothing).
    const discs = occluders.filter((o) => o.radius > 1e-5 * v3len(o.center));
    let point = 0;
    for (const l of this.lit) {
      l.shown = brightness(l.flux) >= FLOOR * OUT && !discs.some((o) => {
        const d = v3len(o.center);
        if (d >= l.distance || v3dot(o.center, l.dir) <= 0) return false;
        return v3len(v3sub(o.center, v3scale(l.dir, v3dot(o.center, l.dir)))) < o.radius;
      });
      if (!l.shown) continue;
      setPoint(this.points.position, this.points.color, point++, l.dir, l.distance * this.far / (this.far + l.distance), l.flux);
    }
    this.mesh.geometry.setDrawRange(0, point * 6);
    pointsChanged(this.mesh);
    dropUploaded(this.mesh, this.stage.renderer, ['position', 'color']);
  }

  /** The share of sunlight a habitat gets: none in the shadow of the planet it orbits (a cylinder of its radius). */
  private shade(orbit: Orbit, at: Vec3, jd: number): number {
    if (orbit.kind !== 'circle') return 1;
    const body = this.system.byId.get(orbit.body), centre = this.bodyAt(orbit.body, jd);
    if (!body) return 1;
    const away = v3norm(centre), offset = v3sub(at, centre), along = v3dot(offset, away);
    return along > 0 && v3len(v3sub(offset, v3scale(away, along))) < body.radius ? 0 : 1;
  }

  /**
   * The next habitat to look at (ledger index), or −1 when this frame has looked through all that could show. A round
   * goes through the kept ones, then the regions that could hold anything above the floor, the brightest first.
   */
  private next(eye: Vec3, t: number): number {
    while (true) {
      if (!this.queue.length) {
        this.queue = this.round(eye, t);
        this.cursor = 0;
        if (!this.queue.length) return -1;
      }
      const r = this.queue[0], { start, count } = this.span(r);
      if (this.cursor < count) return start + this.cursor++;
      this.queue.shift();
      this.cursor = 0;
      if (!this.queue.length) return -1;
    }
  }

  /** The kept habitats (−1), then each region (its index) whose brightest could show from the eye, brightest first. */
  private round(eye: Vec3, t: number): number[] {
    const open = this.shedGeneric ? [] : this.ledger.regions.map((region, r) => {
      const reach = this.ledger.reach(region, t, this.bodyAt), d = v3len(v3sub(eye, reach.centre));
      const nearest = Math.max(1, reach.inner - d, d - reach.outer);
      // The nearest any of them can be to the Sun, for the most light (at least the centre body's radius).
      const sunward = Math.max(v3len(reach.centre) - reach.outer, reach.inner, 1e9);
      const flux = this.biggest(region.id) ** 2 / nearest ** 2 * (AU / sunward) ** 2;
      return { r, flux };
    }).filter((o) => o.flux >= FLOOR).sort((a, b) => b.flux - a.flux).map((o) => o.r);
    return [-1, ...open];
  }

  /** The biggest look (radius times the square root of the albedo) any habitat of a region can have (m). */
  private biggest(id: string): number {
    const region = this.ledger.regions.find((r) => r.id === id)!;
    const r = region.radius[1], hull = Math.sqrt(r * (r * region.aspect[1] + r) * 2.5 / 2) * Math.sqrt(Math.max(...HULL));
    // A hollowed rock is the rock: the belt's largest, albedo at most a third.
    return region.place.kind === 'belt' ? Math.max(hull, 1.75e5 * Math.sqrt(0.3)) : hull;
  }

  /** Where a round's entry lies in the ledger's order. */
  private span(r: number): { start: number; count: number } {
    if (r < 0) return { start: 0, count: this.ledger.habitats.length };
    let start = this.ledger.habitats.length;
    for (let i = 0; i < r; i++) start += this.ledger.regions[i].count;
    return { start, count: this.ledger.regions[r].count };
  }

  /**
   * Names beside the brightest points on screen (the bible's polities first), as the stars' exposure shows them:
   * `exposure` and `pixelSolidAngle` as the STARS shader has them; `show` false hides them all.
   */
  writeNames(camera: Camera, width: number, height: number, exposure: number, pixelSolidAngle: number, show: boolean): void {
    const peakOf = (l: Lit): number => brightness(l.flux) * Math.PI / (2 * Math.PI * STAR_SIGMA * STAR_SIGMA) / pixelSolidAngle * exposure;
    const bright = show && this.naming ? this.lit.filter((l) => l.shown && peakOf(l) >= NAMED_PEAK).sort((a, b) => Number(b.kept) - Number(a.kept) || peakOf(b) - peakOf(a)) : [];
    const chosen = pickMarks(bright, (l) => toScreen(camera, v3scale(l.dir, l.distance * this.far / (this.far + l.distance)), width, height), MOST_NAMED, NAMES_APART)
      .map(({ item, at }) => ({ l: item, at }));
    while (this.names.children.length < chosen.length) this.names.append(document.createElement('span'));
    Array.from(this.names.children).forEach((el, i) => {
      const c = chosen[i], span = el as HTMLElement;
      span.hidden = !c;
      if (!c) return;
      span.textContent = this.nameOfK(c.l.k);
      span.dataset.k = String(c.l.k);
      span.style.transform = `translate(${Math.round(c.at[0] + 7)}px, ${Math.round(c.at[1] - 8)}px)`;
    });
  }

  private nameOfK(k: number): string {
    let name = this.nameOf.get(k);
    if (!name) {
      name = this.ledger.nth(k).name;
      if (this.nameOf.size > 256) this.nameOf.clear();
      this.nameOf.set(k, name);
    }
    return name;
  }

  /** Bytes held: the points (CPU and GPU), what each lit habitat keeps, the ledger. */
  bytes(): number {
    return MOST * (12 + 12 + 8 + 6) * 4 + MOST * 12 * 4 * 2 + this.lit.length * 260 + this.ledger.bytes();
  }

  /** Give memory back: only the kept habitats stay lit. */
  shed(): void {
    this.shedGeneric = true;
    this.lit = this.lit.filter((l) => l.kept);
    this.litK = new Set(this.lit.map((l) => l.k));
    this.queue = [];
  }

  dispose(): void {
    freeMesh(this.mesh);
    this.names.remove();
  }
}

/** A flux's luminance (linear RGB). */
function brightness(f: Vec3): number {
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
