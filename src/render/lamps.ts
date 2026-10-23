/**
 * Lamps outside as points of their own light (space/lights.ts: a habitat's beacons, strobes and running lights, ships'
 * navigation lights), drawn as stars are (STARS): a lamp is far smaller than a pixel from any distance one sees it
 * at, and like a star it shows by its intensity alone, falling off with the square of the distance. They take the
 * stars' exposure (heroic, Arnd 2026-10-21): the eye picks a point of light out of a sunlit view as it picks out a star.
 *
 * Each sits at its true distance, pulled a hair toward the eye off the part it is fixed to, so the part's own body
 * hides it from behind and nothing in front of it is passed.
 */
import { Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { v3add, v3len, v3scale, type Vec3 } from '@futuremagic/core';
import { apply, lampFlux, type HullLight, type Mat3 } from '../space';
import { freeMesh, pointsChanged, pointsGeometry, setPoint } from './geometry';
import { STARS } from './materials';
import { outside } from './skyShaders';
import { STAR_SIGMA } from './exposure';

/**
 * A lamp is drawn this share of its distance nearer the eye than the part it sits on, so the surface round it does not
 * cut its flare where it is seen grazing (whether the body hides it is `lampHidden`'s, before it is put).
 */
const LIFT = 0.03;
/**
 * The brightest a lamp's peak pixel gets (exposed, as `HEROIC_PEAK` for a star of magnitude 0): nearer than where it
 * would pass this, its flux eases toward it, so a strobe beside the eye is a sharp star, not a disc of glare.
 */
export const LAMP_PEAK = 30;

export class LampPoints {
  readonly mesh: Mesh;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private used = 0;

  constructor(readonly capacity: number, name: string) {
    const pts = pointsGeometry(Math.max(1, capacity));
    this.position = pts.position;
    this.color = pts.color;
    this.mesh = new Mesh(pts.geometry, STARS.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
  }

  enter(stage: Stage): Promise<void> {
    return stage.add(this.mesh);
  }

  leave(stage: Stage): void {
    stage.remove(this.mesh);
    freeMesh(this.mesh);
  }

  /** Start a frame: every lamp lit since is drawn, the rest go dark at `send`. */
  restart(): void {
    this.used = 0;
  }

  /** A lamp at `rel` (scene axes, relative to the eye) at clock time t. */
  shine(light: HullLight, rel: Vec3, t: number): void {
    if (this.used >= this.capacity) return;
    const dist = v3len(rel);
    if (dist <= 0) return;
    const flux = lampFlux(light, dist, t), y = 0.2126 * flux[0] + 0.7152 * flux[1] + 0.0722 * flux[2];
    // Last frame's exposure for points: the flux whose peak is LAMP_PEAK (starPeak in skyShaders.ts, turned round).
    const most = (LAMP_PEAK * 2 * STAR_SIGMA * STAR_SIGMA * outside.pixelSolidAngle.value) / Math.max(1e-30, outside.starExposure.value);
    const k = 1 / (1 + y / most);
    setPoint(this.position, this.color, this.used++, v3scale(rel, 1 / dist), dist * (1 - LIFT), [flux[0] * k, flux[1] * k, flux[2] * k]);
  }

  /** The lamps fixed to a body posed with these axes (scene) and origin (relative to the eye), at clock time t. */
  shineOn(lights: Iterable<HullLight>, axes: Mat3, origin: Vec3, t: number): void {
    for (const l of lights) this.shine(l, v3add(origin, apply(axes, l.at)), t);
  }

  send(): void {
    this.color.fill(0, this.used * 12);
    pointsChanged(this.mesh);
  }
}
