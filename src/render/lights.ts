/**
 * The habitat's three.js lights: a fixed pool, made before the warm-up (the number of lights is part of every
 * shader's cache key, docs/SHADERS.md). The registry's kinds do not use them: they are lit by the sunline inside
 * their own shaders. These light what three.js's own materials draw (Actors' bodies), with the same light:
 *
 *   key  a directional light standing in for the sunline at the lit point (`lightVector`: where its light comes from
 *        on average, and how strong), past the terrain's horizons there;
 *   sky  an ambient light for the air's scattered glow (the kinds' sky term).
 *
 * Both are scaled so a white Lambert surface gets what a white ground there gets (three divides diffuse by π).
 */
import { AmbientLight, DirectionalLight, type Scene } from 'three/webgpu';
import type { Habitat, Vec3 } from '../blueprint';
import { fromWorld } from '../blueprint';
import { horizonAt } from '../gen/horizon';
import type { Terrain } from '../gen/terrain';
import { lightVector } from '../world/sunline';

export class Lights {
  readonly key = new DirectionalLight(0xffffff, 0);
  readonly sky = new AmbientLight(0xffffff, 0);

  constructor(scene: Scene) {
    this.key.name = 'sunline key';
    this.sky.name = 'sky light';
    scene.add(this.key, this.key.target, this.sky);
  }

  /**
   * Light things at the world point `p`, with the hour's emission and mean, the share of sky light and the sunline's
   * scale (`sunlineNorm`). The camera sits at the origin, so only the key light's direction matters.
   */
  shineOn(h: Habitat, terrain: Terrain, emission: Float32Array, mean: number, skyShare: number, norm: number, p: Vec3): void {
    const at = fromWorld(h.profile, p[0], p[1], p[2]);
    const [port, wild] = horizonAt(terrain, at.theta, at.s);
    const v = lightVector(h, emission, p, port, wild, norm);
    const strength = Math.hypot(v[0], v[1], v[2]);
    if (strength > 1e-9) this.key.position.set(v[0] / strength, v[1] / strength, v[2] / strength);
    this.key.target.position.set(0, 0, 0);
    this.key.intensity = Math.PI * strength * (1 - skyShare);
    const open = Math.min(1, Math.max(0, (port + wild) / Math.PI));
    this.sky.intensity = Math.PI * skyShare * mean * open;
  }
}
