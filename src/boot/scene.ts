/**
 * What the opening draws each frame (design "First Light", space/cinema.ts `opening`): the camera, the Sun, Earth and
 * the Moon, the eyes' exposure, the stars' turn, and the points of light (the ring's habitats and the planets), all
 * from the same pure models the Outside view reads, so the opening shows the sky the game shows. No GPU here: the
 * boot's worker (worker.ts) turns a frame into uniforms; tests run it headless (test/firstLight.test.ts).
 *
 * The Outside view draws Earth and the Moon as celestial meshes (render/solar.ts, celestialShaders.ts), the limb, the
 * Sun and its glare in the sky dome (skyShaders.ts), the stars and every far point with the STARS kind; the opening's
 * shader draws the same looks per pixel (shaders.ts). Without the 4 MB ephemeris pack the planets come from their
 * mean elements (`meanPlanetAt`), the Sun, Earth and Moon from the analytic ephemeris (`makeSpace` without a system):
 * well inside a pixel at this lens.
 */
import { v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import type { Habitat, HabitatParams } from '../blueprint';
import { AU, REFERENCE_SPACE, chooseStart, cloudOffset, makeSpace, opening, skyFrom, sunlightFrom, transpose, apply, DAY, type Mat3, type Opening, type Space } from '../space';
import { MEAN_PLANETS, meanPlanetAt } from '../space/meanPlanets';
import { SOLAR_BODIES } from '../space/solarData';
import { bodyPointFlux } from '../space/solarSystem';
import { columnsOf, makeSkin, skinFlux, type Columns, type Skin } from '../gen/skin';
import { DARKEST, PERIPHERY, adapt, exposureFor, meterRays, starExposure, type Meterable } from '../render/exposure';

/** The Moon's mean albedo, as the solar system's catalogue gives it (solarSystem.ts: a rocky moon). */
const MOON_ALBEDO = 0.12;

/** A point of light: its unit direction (scene axes), flux relative to the Sun's at 1 AU, and whether Earth or the Moon may stand in front. */
export interface LightPoint {
  dir: Vec3;
  flux: Vec3;
  behind: boolean;
}

export interface Disc {
  /** Unit direction to the centre, and the sine of the angular radius. */
  dir: Vec3;
  sin: number;
  /** Scene → the body's own axes (Earth: x to Greenwich, z north). */
  toBody: Mat3;
  /** The Sun's direction in the body's axes, and the sunlight on it relative to 1 AU. */
  sun: Vec3;
  light: number;
}

export interface OpeningState {
  /** Seconds since the first frame, and the clock it shows. */
  elapsed: number;
  clock: number;
  /** Camera axes (scene), the tangent of half the vertical field of view, width / height. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalf: number;
  aspect: number;
  sunDir: Vec3;
  sunRadius: number;
  sunlight: number;
  irradiance: number;
  earth: Disc;
  moon: Disc;
  exposure: number;
  starExposure: number;
  /** Solid angle of one pixel (sr). */
  pixelSolidAngle: number;
  /** J2000 ecliptic (the star catalogue's axes) → scene. */
  starAxes: Mat3;
  /** Earth's cloud field (its noise offset). */
  clouds: Vec3;
  /** Whether Earth is nearer than the Moon (it then stands in front where both are in line). */
  earthNearer: boolean;
  points: LightPoint[];
}

interface Ring {
  /** The drum's look, made between frames (`prepareRing`): null until then. */
  look: { skin: Skin; cols: Columns } | null;
  habitat: Habitat;
  orbitFrame: string;
  bodyFrame: string;
  length: number;
}

export class OpeningSky {
  readonly space: Space;
  readonly opening: Opening;
  private readonly ring: Ring[];
  private exposure = 0;

  /** The opening over the home habitat `home`, or over a space already made (tests share theirs). */
  constructor(home: HabitatParams | Space) {
    this.space = 'habitats' in home ? home : makeSpace({ ...REFERENCE_SPACE, home });
    this.opening = opening(this.space, chooseStart(this.space, 0));
    this.ring = this.space.habitats.map((h) => ({ look: null, habitat: h.habitat, orbitFrame: h.orbitFrame, bodyFrame: h.bodyFrame, length: h.habitat.length }));
  }

  /**
   * Make the drums' looks, one habitat at a time, until `enough()` says the frame's time is up: tens of milliseconds
   * each, too long to wait for before the first frame. True once every habitat has its look; until then the opening
   * shows no glints (the worker fades them in together).
   */
  prepareRing(enough: () => boolean = () => false): boolean {
    for (const r of this.ring) {
      if (r.look) continue;
      if (enough()) return false;
      const skin = makeSkin(r.habitat);
      r.look = { skin, cols: columnsOf(skin) };
    }
    return true;
  }

  /** The frame `elapsed` s in, drawn `width` × `height` pixels, `dt` s after the last (Infinity: meter afresh). */
  stateAt(elapsed: number, width: number, height: number, dt: number): OpeningState {
    const sp = this.space, home = sp.home.orbitFrame, f = this.opening.at(elapsed), t = f.clock;
    const forward = v3norm(v3sub(f.target, f.eye)), up = f.up, right = v3cross(forward, up);
    const tanHalf = Math.tan((f.fov * Math.PI) / 360), aspect = width / Math.max(1, height);
    const sky = skyFrom(sp, home, f.eye, t);
    const irradiance = (AU / sky.sunDistance) ** 2;
    const disc = (center: Vec3, radius: number, axes: Mat3): Disc => {
      const d = v3len(center), toBody = transpose(axes);
      return { dir: v3scale(center, 1 / d), sin: radius / d, toBody, sun: v3norm(apply(toBody, sky.sunDir)), light: irradiance };
    };
    const earth = disc(sky.earth.center, sky.earth.radius, sky.earth.axes);
    const moon = disc(sky.moon.center, sky.moon.radius, sky.moon.axes);

    const earthBody = SOLAR_BODIES.find((b) => b.id === 'earth')!;
    const metered: Meterable = {
      sky, hulls: [], earthshine: 0, room: null,
      celestial: [
        { center: sky.earth.center, radius: sky.earth.radius, albedo: earthBody.albedo, light: irradiance },
        { center: sky.moon.center, radius: sky.moon.radius, albedo: MOON_ALBEDO, light: irradiance },
      ].sort((a, b) => v3len(a.center) - v3len(b.center)),
    };
    const rays = meterRays(forward, right, up, Math.tan((PERIPHERY * f.fov * Math.PI) / 360), aspect, 16, 9);
    const target = exposureFor(metered, rays, DARKEST.plain);
    this.exposure = this.exposure > 0 && Number.isFinite(dt) ? adapt(this.exposure, target, dt) : target;
    const pixelSolidAngle = ((f.fov * Math.PI) / 180 / Math.max(1, height)) ** 2;
    // The Sun is behind the eye all through the opening (cinema.ts): the stars are heroic.
    const stars = starExposure(this.exposure, pixelSolidAngle, 0, true);

    return {
      elapsed, clock: t, right, up, forward, tanHalf, aspect,
      sunDir: sky.sunDir, sunRadius: sky.sunRadius, sunlight: sky.sunlight, irradiance,
      earth, moon, exposure: this.exposure, starExposure: stars, pixelSolidAngle,
      starAxes: this.starAxes(elapsed),
      clouds: cloudOffset(sp.params.seed, elapsed / DAY),
      earthNearer: v3len(sky.earth.center) < v3len(sky.moon.center),
      points: [...this.glints(f.eye, t, sky), ...this.planets(f.eye, t)],
    };
  }

  /** The star catalogue's axes (J2000 ecliptic) in the scene's at `elapsed`. */
  starAxes(elapsed: number): Mat3 {
    return this.space.frames.relative('sun', this.space.home.orbitFrame, this.opening.at(elapsed).clock).axes;
  }

  /** Every habitat of the ring as a glint, home too (from out here it is a point): its drum's reflected sunlight. None until `prepareRing` is done. */
  private glints(eye: Vec3, t: number, sky: ReturnType<typeof skyFrom>): LightPoint[] {
    const sp = this.space, home = sp.home.orbitFrame, sunC = v3scale(sky.sunDir, sky.sunDistance);
    if (this.ring.some((r) => !r.look)) return [];
    return this.ring.map((r) => {
      const look = r.look!, pose = sp.frames.relative(r.bodyFrame, home, t);
      // The drum's centre relative to the eye, as NecklaceView places it.
      const at = v3sub(v3add(pose.origin, apply(pose.axes, [0, 0, r.length / 2])), eye);
      const dist = v3len(at), dir = v3scale(at, 1 / dist);
      const lit = sunlightFrom(v3sub(sunC, at), v3sub(sky.earth.center, at), v3sub(sky.moon.center, at));
      const toBody = transpose(pose.axes);
      const flux = skinFlux(look.skin, look.cols, apply(toBody, sky.sunDir), apply(toBody, v3scale(dir, -1)), dist, lit);
      return { dir, flux, behind: dist > v3len(sky.earth.center) };
    });
  }

  /** The planets as points (render/solar.ts draws them the same way), from their mean elements. */
  private planets(eye: Vec3, t: number): LightPoint[] {
    const sp = this.space, home = sp.home.orbitFrame, jd = sp.jd(t);
    const eyeSolar = sp.frames.position(eye, home, 'sun', t), axes = sp.frames.relative('sun', home, t).axes;
    const out: LightPoint[] = [];
    for (const id of MEAN_PLANETS) {
      if (id === 'earth') continue;
      const body = SOLAR_BODIES.find((b) => b.id === id);
      if (!body) continue;
      const solar = meanPlanetAt(id, jd), rel = v3sub(solar, eyeSolar), distance = v3len(rel);
      const flux = bodyPointFlux(body, solar, eyeSolar, distance, (AU / v3len(solar)) ** 2);
      out.push({ dir: v3norm(apply(axes, rel)), flux, behind: true });
    }
    return out;
  }
}

/** The points as the shader's instance data: direction and whether it may be hidden, then flux (8 floats each). */
export function packPoints(points: readonly LightPoint[], out: Float32Array, offset = 0): void {
  points.forEach((p, i) => {
    const k = (offset + i) * 8;
    out.set([p.dir[0], p.dir[1], p.dir[2], p.behind ? 1 : 0, p.flux[0], p.flux[1], p.flux[2], 0], k);
  });
}

/** The star catalogue as instance data, turned into the scene's axes once (they turn by arcseconds in a minute). */
export function packStars(dir: Float32Array, flux: Float32Array, color: Float32Array, axes: Mat3, out: Float32Array): void {
  const n = flux.length;
  for (let i = 0; i < n; i++) {
    const d = apply(axes, [dir[i * 3], dir[i * 3 + 1], dir[i * 3 + 2]]), k = i * 8;
    out.set([d[0], d[1], d[2], 1, color[i * 3] * flux[i], color[i * 3 + 1] * flux[i], color[i * 3 + 2] * flux[i], 0], k);
  }
}

/** Planets drawn as points: their count, for sizing buffers. */
export const PLANET_POINTS = MEAN_PLANETS.length - 1;

/** A seen direction against a disc: whether it is behind it (the stars hide behind Earth and the Moon). */
export function behindDisc(d: Vec3, disc: { dir: Vec3; sin: number }): boolean {
  const c = v3cross(d, disc.dir);
  return v3dot(d, disc.dir) > 0 && v3dot(c, c) < disc.sin * disc.sin;
}
