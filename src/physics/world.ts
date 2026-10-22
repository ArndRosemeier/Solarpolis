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
import { TRUNK_PIECE } from '../gen/trunks';
import { Character, uprightRotation, type WaterDepth } from './character';

type Rapier = typeof RAPIER_NS;

/** Fixed physics step (s) and the most steps one frame may take. */
export const PHYSICS_STEP = 1 / 120;
const MAX_STEPS = 8;
/** Rolling resistance of grass and soil, as angular damping (1/s), and air drag on a ball, as linear damping (1/s). */
const ROLLING_DAMPING = 1.5;
const AIR_DAMPING = 0.01;
/** Bark: how it grips and how much a ball bounces off it. */
const BARK_FRICTION = 0.7;
const BARK_BOUNCE = 0.2;

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
  /** The trunks on the ground patch: one fixed body holding a capsule per piece. */
  private trunks: RAPIER_NS.RigidBody | null = null;
  private patch: GroundPatch | null = null;
  /** The bubble's origin in the habitat (float64). */
  private origin: Vec3 = [0, 0, 0];
  private readonly bodies = new Map<number, { body: RAPIER_NS.RigidBody; radius: number }>();
  private next = 1;
  private carry = 0;
  private character: Character | null = null;

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
    const moving = [...this.bodies.values()].map((b) => b.body);
    if (this.character) moving.push(this.character.rigidBody);
    for (const body of moving) {
      const t = body.translation();
      body.setTranslation({ x: t.x + shift[0], y: t.y + shift[1], z: t.z + shift[2] }, true);
    }
    this.origin = [...patch.origin];
    this.patch = patch;
    this.ground = this.world.createCollider(this.R.ColliderDesc.trimesh(patch.positions, patch.index, this.R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8).setRestitution(0.3));
    this.standTrunks(patch.trunks);
    this.dropStrays();
  }

  /** Trunk pieces in the bubble (debug menu). */
  get trunkCount(): number { return this.trunks?.numColliders() ?? 0; }

  /** Stand the patch's trunks (capsules relative to its origin, gen/trunks.ts) in the bubble, in place of the last patch's. */
  private standTrunks(pieces: Float32Array): void {
    if (this.trunks) this.world.removeRigidBody(this.trunks);
    this.trunks = null;
    if (!pieces.length) return;
    const R = this.R, body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (let i = 0; i < pieces.length; i += TRUNK_PIECE) {
      const ax = pieces[i], ay = pieces[i + 1], az = pieces[i + 2], dx = pieces[i + 3] - ax, dy = pieces[i + 4] - ay, dz = pieces[i + 5] - az;
      const length = Math.hypot(dx, dy, dz), radius = pieces[i + 6];
      // A capsule's own axis is +y: turned onto the piece, its middle between the ends.
      const q = length > 1e-6 ? uprightRotation([dx / length, dy / length, dz / length]) : [0, 0, 0, 1];
      const desc = R.ColliderDesc.capsule(length / 2, radius).setTranslation(ax + dx / 2, ay + dy / 2, az + dz / 2)
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setFriction(BARK_FRICTION).setRestitution(BARK_BOUNCE);
      this.world.createCollider(desc, body);
    }
    this.trunks = body;
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

  /** The player's body, standing with its feet at a world position (replaces any earlier one). */
  addCharacter(feet: Vec3, water?: WaterDepth): Character {
    this.removeCharacter();
    this.character = new Character(this.R, this.world, this.habitat, feet, this.origin, water);
    return this.character;
  }

  removeCharacter(): void {
    this.character?.release();
    this.character = null;
  }

  /** How far (0 … 1) the time not yet stepped is into the next step: draw moving things that share between steps. */
  get blend(): number {
    return this.carry / PHYSICS_STEP;
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
      this.character?.step(PHYSICS_STEP, this.origin);
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

  /** Whether a world point is further than `share` of the patch's size from its centre, sideways (height does not count). */
  offPatch(p: Vec3, share = 0.5): boolean {
    return !this.patch || this.sideways(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]) > this.patch.size * share;
  }

  /** How far a point in the bubble's coordinates lies from its centre, across the up at the centre. */
  private sideways(x: number, y: number, z: number): number {
    const o = this.origin, r = Math.hypot(o[0], o[1]) || 1, ux = -o[0] / r, uy = -o[1] / r; // up: toward the axis
    const along = x * ux + y * uy;
    return Math.hypot(x - along * ux, y - along * uy, z);
  }

  /** Drop the bodies that have left the ground patch sideways (nothing to land on there). */
  private dropStrays(): void {
    if (!this.patch) return;
    for (const [id, { body }] of this.bodies) {
      const t = body.translation();
      if (this.sideways(t.x, t.y, t.z) > this.patch.size * 0.5) this.remove(id);
    }
  }

  dispose(): void {
    this.character = null;
    this.world.free();
    this.bodies.clear();
  }
}
