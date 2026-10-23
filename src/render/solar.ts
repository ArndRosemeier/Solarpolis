/** Bounded outside renderer: shared low-poly meshes for resolved discs, flux-preserving points otherwise.
 * Physical positions remain float64; each body is projected to a finite camera-relative depth at its true angular size. */
import { Mesh, RingGeometry, SphereGeometry, Vector3, Vector4 } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { deriveSeed, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { AU, SUN } from '../space/constants';
import { apply, mul, transpose, type Mat3 } from '../space/pose';
import { circleOverlap } from '../space/sky';
import { asteroid, asteroidPosition, type Asteroid } from '../space/asteroids';
import type { SolarBody } from '../space/solarData';
import type { SolarSystem } from '../space/solarSystem';
import type { Space } from '../space/space';
import { CELESTIAL, PLANET_RING, STARS } from './materials';
import { dropUploaded, freeMesh, pointsChanged, pointsGeometry, setPoint, setPose } from './geometry';
import type { CelestialLook } from './celestialShaders';

export interface SeenBody { body: SolarBody; center: Vec3; solar: Vec3; distance: number; light: number }
const RESOLVED = 20;
const SAMPLES = 1024;

export class SolarView {
  private spheres: Mesh[] = [];
  private rings: Mesh[] = [];
  private points: ReturnType<typeof pointsGeometry>;
  private pointMesh: Mesh;
  private rocks: Asteroid[];
  seen: SeenBody[] = [];
  private ready = false;
  private shedRocks = false;

  constructor(private stage: Stage, readonly system: SolarSystem, private far: number, seed: number) {
    this.rocks = Array.from({ length: SAMPLES }, (_, i) => asteroid(seed, i < 512 ? 'main' : i < 768 ? 'trojan' : 'kuiper', i < 512 ? i : i < 768 ? i - 512 : i - 768));
    this.points = pointsGeometry(system.bodies.length + this.rocks.length);
    this.pointMesh = new Mesh(this.points.geometry, STARS.material);
    this.pointMesh.name = 'solar system unresolved bodies';
    this.pointMesh.frustumCulled = false;
  }

  async start(): Promise<void> {
    const sphere = new SphereGeometry(1, 64, 32), ring = new RingGeometry(0, 1, 192);
    sphere.deleteAttribute('uv'); ring.deleteAttribute('uv'); ring.deleteAttribute('normal');
    for (let i = 0; i < RESOLVED; i++) {
      const body = new Mesh(sphere, CELESTIAL.material), rings = new Mesh(ring, PLANET_RING.material);
      for (const mesh of [body, rings]) { mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; }
      body.name = 'solar body pool'; rings.name = 'solar ring pool';
      this.spheres.push(body); this.rings.push(rings);
    }
    await Promise.all([...this.spheres, ...this.rings, this.pointMesh].map(m => this.stage.add(m)));
    this.ready = true;
  }

  follow(space: Space, eye: Vec3, t: number, pixelsPerRadian: number): void {
    if (!this.ready) return;
    const jd = space.jd(t), frame = space.frames.relative('sun', space.home.orbitFrame, t);
    const eyeSolar = space.frames.position(eye, space.home.orbitFrame, 'sun', t);
    const jupiter = this.system.position('jupiter', jd), longitude = Math.atan2(jupiter[1], jupiter[0]);
    const entries = this.system.bodies.filter(b => b.id !== 'sun').map(body => ({ body, solar: this.system.position(body.id, jd) }));
    if (!this.shedRocks) for (const rock of this.rocks) entries.push({ body: rock.body, solar: asteroidPosition(rock, jd, longitude) });
    this.seen = entries.map(({ body, solar }): SeenBody => {
      const center = apply(frame.axes, v3sub(solar, eyeSolar)), distance = v3len(center);
      let light = (AU / v3len(solar)) ** 2;
      // Parent eclipses use the finite solar disc, not a hard on/off shadow at arbitrary distances.
      if (body.kind === 'moon') {
        const parent = this.system.byId.get(body.parent)!;
        const toParent = v3sub(this.system.position(parent.id, jd), solar), toSun = v3scale(solar, -1);
        const a = Math.asin(SUN.radius / v3len(toSun)), b = Math.asin(Math.min(1, parent.radius / v3len(toParent)));
        const angle = Math.acos(Math.max(-1, Math.min(1, v3dot(v3norm(toParent), v3norm(toSun)))));
        light *= Math.max(0, 1 - circleOverlap(a, b, angle) / (Math.PI * a * a));
      }
      return { body, solar, center, distance, light };
    });
    const resolved = this.seen.filter(s => s.body.radius / s.distance * pixelsPerRadian > .7)
      .sort((a, b) => b.body.radius / b.distance - a.body.radius / a.distance).slice(0, RESOLVED);
    const drawn = new Set(resolved.map(s => s.body.id));
    for (let i = 0; i < RESOLVED; i++) {
      const mesh = this.spheres[i], rings = this.rings[i], entry = resolved[i];
      mesh.visible = !!entry; rings.visible = !!entry?.body.rings;
      if (!entry) continue;
      const b = entry.body, axes = this.system.byId.has(b.id) ? this.system.axes(b.id, jd) : [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3;
      const scale = this.far / (this.far + entry.distance), sceneAxes = mul(frame.axes, axes), centre = v3scale(entry.center, scale);
      const r = b.radius * scale, polar = b.polar * scale;
      const transform = sceneAxes.map((v, k) => v * (k % 3 === 2 ? polar : r)) as Mat3;
      const look: CelestialLook = { colour: new Vector3(...b.colour), sun: new Vector3(...apply(transpose(axes), v3norm(v3scale(entry.solar, -1)))), light: entry.light,
        appearance: b.appearance, rings: new Vector4(b.rings ? b.rings.inner / b.radius : 0, b.rings ? b.rings.outer / b.radius : 0, b.rings?.opacity ?? 0, b.id === 'saturn' ? 1 : b.id === 'uranus' ? 2 : b.id === 'neptune' ? 3 : 0), seed: (deriveSeed(1, b.id) % 10000) / 100 };
      mesh.userData.celestial = rings.userData.celestial = look;
      setPose(mesh, transform, centre);
      if (b.rings) setPose(rings, sceneAxes.map(v => v * b.rings!.outer * scale) as Mat3, centre);
    }
    let point = 0;
    for (const s of this.seen) {
      if (drawn.has(s.body.id)) continue;
      const direction = v3scale(s.center, 1 / s.distance);
      const hidden = resolved.some(near => near.distance < s.distance && v3dot(direction, v3norm(near.center)) > 0 && v3len(v3sub(near.center, v3scale(direction, v3dot(near.center, direction)))) < near.body.radius);
      if (hidden) continue;
      const alpha = Math.acos(Math.max(-1, Math.min(1, v3dot(v3norm(v3scale(s.solar, -1)), v3norm(v3sub(eyeSolar, s.solar))))));
      const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
      const flux = s.body.albedo * phase * (s.body.radius / s.distance) ** 2 * s.light;
      if (flux < 1e-17) continue;
      const luminance = Math.max(.01, .2126 * s.body.colour[0] + .7152 * s.body.colour[1] + .0722 * s.body.colour[2]);
      setPoint(this.points.position, this.points.color, point++, direction, s.distance * this.far / (this.far + s.distance), v3scale(s.body.colour, flux / luminance));
    }
    this.pointMesh.geometry.setDrawRange(0, point * 6);
    pointsChanged(this.pointMesh);
    for (const m of [this.spheres[0], this.rings[0]]) dropUploaded(m, this.stage.renderer);
    dropUploaded(this.pointMesh, this.stage.renderer, ['position', 'color']);
  }

  bytes(): number { return this.system.bytes() + (this.system.bodies.length + SAMPLES) * 320 + 400000; }
  shed(): void { this.shedRocks = true; this.rocks = []; }
  dispose(): void {
    this.spheres.forEach((m, i) => freeMesh(m, i === 0 ? 'all' : 'none'));
    this.rings.forEach((m, i) => freeMesh(m, i === 0 ? 'all' : 'none'));
    freeMesh(this.pointMesh);
  }
}
