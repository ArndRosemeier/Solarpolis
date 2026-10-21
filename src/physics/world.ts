/**
 * The physics (Rapier; guarded: only src/physics imports it). It runs in the habitat's own turning frame: Rapier's
 * gravity is off and every body gets the apparent force of `world/motion.ts` each step (centrifugal "gravity" and
 * Coriolis), so a dropped ball lands off the vertical and gravity fades up the endcaps by themselves.
 *
 * The physics lives in a small bubble around the player: its origin is the centre of the current ground patch
 * (`gen/patch.ts`), everything inside is stored relative to it, and when a new patch arrives the bubble moves and
 * every body moves with it. So Rapier's 32-bit floats stay precise anywhere in a habitat tens of kilometres long.
 * Bodies that leave the patch are dropped: there is no ground under them.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Habitat, Vec3 } from '../blueprint';
import type { GroundPatch } from '../gen/patch';
import { apparentAcceleration } from '../world/motion';

type Rapier = typeof RAPIER_NS;

/** Fixed physics step (s) and the most steps one frame may take. */
export const PHYSICS_STEP = 1 / 120;
const MAX_STEPS = 8;
/** Rolling resistance of grass and soil, as angular damping (1/s), and air drag on a ball, as linear damping (1/s). */
const ROLLING_DAMPING = 1.5;
const AIR_DAMPING = 0.01;

export interface BodyState {
  id: number;
  /** World position (float64) and velocity in the habitat's frame. */
  position: Vec3;
  velocity: Vec3;
  /** Rotation as a quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
  radius: number;
}

export class PhysicsWorld {
  private readonly world: RAPIER_NS.World;
  private ground: RAPIER_NS.Collider | null = null;
  private patch: GroundPatch | null = null;
  /** The bubble's origin in the habitat (float64). */
  private origin: Vec3 = [0, 0, 0];
  private readonly bodies = new Map<number, { body: RAPIER_NS.RigidBody; radius: number }>();
  private next = 1;
  private carry = 0;

  private constructor(private readonly R: Rapier, private habitat: Habitat) {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = PHYSICS_STEP;
  }

  /** Load Rapier (its WebAssembly) and make a world for a habitat. */
  static async create(habitat: Habitat): Promise<PhysicsWorld> {
    const R = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    return new PhysicsWorld(R, habitat);
  }

  /** The ground patch the bubble stands on, or null before the first arrives. */
  get groundPatch(): GroundPatch | null { return this.patch; }

  /** Whether a new ground patch is due: none yet, or `p` has moved a quarter of the patch away from its centre. */
  needsGround(p: Vec3): boolean {
    if (!this.patch) return true;
    const o = this.patch.origin;
    return Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) > this.patch.size / 4;
  }

  /** Stand the bubble on a new ground patch: its origin becomes the bubble's, and the bodies move along. */
  setGround(patch: GroundPatch): void {
    if (this.ground) this.world.removeCollider(this.ground, false);
    const shift: Vec3 = [this.origin[0] - patch.origin[0], this.origin[1] - patch.origin[1], this.origin[2] - patch.origin[2]];
    for (const { body } of this.bodies.values()) {
      const t = body.translation();
      body.setTranslation({ x: t.x + shift[0], y: t.y + shift[1], z: t.z + shift[2] }, true);
    }
    this.origin = [...patch.origin];
    this.patch = patch;
    this.ground = this.world.createCollider(this.R.ColliderDesc.trimesh(patch.positions, patch.index).setFriction(0.8).setRestitution(0.3));
    this.dropStrays();
  }

  /** A ball at a world position and velocity; returns its id. */
  addBall(position: Vec3, velocity: Vec3, radius: number, density = 1000): number {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(position[0] - this.origin[0], position[1] - this.origin[1], position[2] - this.origin[2])
      .setLinvel(velocity[0], velocity[1], velocity[2])
      // Grass and soil resist rolling; a little air drag.
      .setAngularDamping(ROLLING_DAMPING)
      .setLinearDamping(AIR_DAMPING)
      .setCcdEnabled(true));
    this.world.createCollider(R.ColliderDesc.ball(radius).setDensity(density).setFriction(0.8).setRestitution(0.3), body);
    const id = this.next++;
    this.bodies.set(id, { body, radius });
    return id;
  }

  remove(id: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b.body);
    this.bodies.delete(id);
  }

  /** Advance by a frame's time in fixed steps, applying the turning frame's forces before each. */
  advance(dt: number): void {
    this.carry = Math.min(this.carry + dt, PHYSICS_STEP * MAX_STEPS);
    while (this.carry >= PHYSICS_STEP) {
      for (const { body } of this.bodies.values()) {
        const t = body.translation(), v = body.linvel(), m = body.mass();
        const a = apparentAcceleration(this.habitat, [t.x + this.origin[0], t.y + this.origin[1], t.z + this.origin[2]], [v.x, v.y, v.z]);
        body.resetForces(false);
        body.addForce({ x: a[0] * m, y: a[1] * m, z: a[2] * m }, true);
      }
      this.world.step();
      this.carry -= PHYSICS_STEP;
    }
    this.dropStrays();
  }

  /** Every body, in world coordinates. */
  states(): BodyState[] {
    const out: BodyState[] = [];
    for (const [id, { body, radius }] of this.bodies) {
      const t = body.translation(), v = body.linvel(), q = body.rotation();
      out.push({ id, radius, position: [t.x + this.origin[0], t.y + this.origin[1], t.z + this.origin[2]], velocity: [v.x, v.y, v.z], rotation: [q.x, q.y, q.z, q.w] });
    }
    return out;
  }

  /** Bodies in the world. */
  get count(): number { return this.bodies.size; }

  /** Drop the bodies that have left the ground patch sideways (nothing to land on there); height does not count. */
  private dropStrays(): void {
    if (!this.patch) return;
    const o = this.origin, r = Math.hypot(o[0], o[1]) || 1, ux = -o[0] / r, uy = -o[1] / r; // up: toward the axis
    for (const [id, { body }] of this.bodies) {
      const t = body.translation(), along = t.x * ux + t.y * uy;
      const side = Math.hypot(t.x - along * ux, t.y - along * uy, t.z);
      if (side > this.patch.size * 0.5) this.remove(id);
    }
  }

  dispose(): void {
    this.world.free();
    this.bodies.clear();
  }
}
