/**
 * The player's body in the physics: an upright capsule moved by Rapier's character controller. "Up" is not fixed: it
 * points toward the axis wherever the body is (`world/motion.ts`, `upAt`), and gravity is the spin's, so it weakens
 * up the endcaps and a jump there carries much higher and further. In the air the body follows the turning frame's
 * apparent acceleration (centrifugal and Coriolis), the same as every ball; on the ground the feet set the speed.
 * In deep water it floats: buoyancy holds it with the head just out, and it swims slowly.
 *
 * Made by `PhysicsWorld.addCharacter`, stepped by `PhysicsWorld.advance` before each physics step. Positions here are
 * world positions (float64); the Rapier body sits in the bubble's own coordinates (see `world.ts`).
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Habitat, Vec3 } from '../blueprint';
import { v3add as add, v3dot as dot, v3lerp, v3madd as along, v3scale as scale, v3sub as sub } from '@futuremagic/core';
import { apparentAcceleration, upAt } from '../world/motion';

type Rapier = typeof RAPIER_NS;

/** A standing human: capsule radius and full height (m), and mass (kg). */
export const HUMAN = { radius: 0.3, height: 1.8, mass: 75 };
/** Take-off speed of a standing jump (m/s): about half a metre high at Earth gravity. */
export const JUMP_SPEED = 3.2;
/** Steepest ground the feet climb, and where they start to slide (radians from level). */
const MAX_CLIMB = (50 * Math.PI) / 180;
const SLIDE_FROM = (55 * Math.PI) / 180;
/** Steps the feet take without jumping, and how far down they stay on the ground when walking over a crest (m). */
const STEP_UP = 0.4;
const SNAP_DOWN = 0.3;
/**
 * In water: the share of the body under water when treading water (the head just out), how fast water slows the body
 * (1/s), the top swimming speed (m/s) and how fast a swimmer gets to it (1/s).
 */
const FLOATS_AT = 0.85;
const WATER_DRAG = 2.5;
const SWIM_SPEED = 1.2;
const SWIM_PULL = 2;

/** What the player wants this step: a velocity along the ground (world axes, m/s) and whether to jump. */
export interface Stride {
  walk: Vec3;
  jump: boolean;
}

/** How deep a world point lies under water (m); 0 or less where it is dry. */
export type WaterDepth = (p: Vec3) => number;

export class Character {
  /** Velocity in the habitat's frame (m/s). */
  velocity: Vec3 = [0, 0, 0];
  /** Standing on something, and floating in water, after the last step. */
  grounded = false;
  swimming = false;
  /** Up at the feet: toward the axis (kept as it was on the axis itself). */
  up: Vec3;
  stride: Stride = { walk: [0, 0, 0], jump: false };
  private readonly body: RAPIER_NS.RigidBody;
  private readonly collider: RAPIER_NS.Collider;
  private readonly control: RAPIER_NS.KinematicCharacterController;
  /** Feet (world) after the step before last and after the last: drawn between them. */
  private before: Vec3;
  private now: Vec3;

  constructor(R: Rapier, private readonly world: RAPIER_NS.World, private readonly habitat: Habitat, feet: Vec3, origin: Vec3, private readonly water: WaterDepth = () => 0) {
    this.up = upAt(feet) ?? [0, 1, 0];
    this.before = [...feet];
    this.now = [...feet];
    const centre = sub(along(feet, this.up, HUMAN.height / 2), origin);
    const q = uprightRotation(this.up);
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(centre[0], centre[1], centre[2])
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }));
    this.collider = world.createCollider(R.ColliderDesc.capsule(HUMAN.height / 2 - HUMAN.radius, HUMAN.radius), this.body);
    this.control = world.createCharacterController(0.02);
    this.control.setMaxSlopeClimbAngle(MAX_CLIMB);
    this.control.setMinSlopeSlideAngle(SLIDE_FROM);
    this.control.enableAutostep(STEP_UP, HUMAN.radius, false);
    this.control.enableSnapToGround(SNAP_DOWN);
    this.control.setApplyImpulsesToDynamicBodies(true);
    this.control.setCharacterMass(HUMAN.mass);
  }

  /** The feet's world position, `blend` of the way from the step before last to the last (smooth drawing). */
  feet(blend = 1): Vec3 {
    return v3lerp(this.before, this.now, blend);
  }

  /** The body is a rigid body of the world: the world moves it with the bubble. */
  get rigidBody(): RAPIER_NS.RigidBody {
    return this.body;
  }

  /** One physics step of `dt` seconds, in a bubble whose origin is `origin`. */
  step(dt: number, origin: Vec3): void {
    const feet = this.now;
    this.up = upAt(feet) ?? this.up;
    const up = this.up;
    let v = this.velocity;
    const a = apparentAcceleration(this.habitat, feet, v);
    const under = Math.min(1, Math.max(0, this.water(feet) / HUMAN.height));
    this.swimming = under > 0.5;
    const flat = (w: Vec3): Vec3 => along(w, up, -dot(w, up));
    if (this.swimming) {
      // Water carries the weight once FLOATS_AT of the body is under; it slows every motion; the swimmer pulls along.
      const g = this.habitat.gravityAt(Math.hypot(feet[0], feet[1]));
      v = along(v, a, dt);
      v = along(v, up, g * (under / FLOATS_AT) * dt);
      v = along(v, v, -Math.min(1, WATER_DRAG * dt));
      const want = flat(this.stride.walk), speed = Math.hypot(...want);
      const goal = speed > SWIM_SPEED ? scale(want, SWIM_SPEED / speed) : want;
      v = along(v, sub(goal, flat(v)), Math.min(1, SWIM_PULL * dt));
    } else if (this.grounded) {
      // The feet set the speed along the ground; gravity keeps them pressed to it. A jump leaves it.
      v = along(flat(this.stride.walk), a, dt);
      if (this.stride.jump) v = along(flat(this.stride.walk), up, JUMP_SPEED);
    } else {
      v = along(v, a, dt);
    }
    this.stride.jump = false;

    const want = { x: v[0] * dt, y: v[1] * dt, z: v[2] * dt };
    this.control.setUp({ x: up[0], y: up[1], z: up[2] });
    this.control.computeColliderMovement(this.collider, want);
    const m = this.control.computedMovement();
    const moved: Vec3 = [m.x, m.y, m.z];
    this.grounded = this.control.computedGrounded() && dot(v, up) <= 0.5;
    // What the ground or a wall stopped is gone from the velocity; on the ground nothing moves into it.
    v = scale(moved, 1 / dt);
    if (this.grounded && dot(v, up) < 0) v = flat(v);
    this.velocity = v;

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    const q = uprightRotation(up);
    this.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    this.before = this.now;
    this.now = add(along([t.x + m.x, t.y + m.y, t.z + m.z], up, -HUMAN.height / 2), origin);
  }

  /** Take the body and its controller out of the world. */
  release(): void {
    this.world.removeCharacterController(this.control);
    this.world.removeRigidBody(this.body);
  }
}

/** The rotation (x, y, z, w) that turns a capsule's own axis (+y) to `up` (a unit vector). */
export function uprightRotation(up: Vec3): [number, number, number, number] {
  const w = 1 + up[1];
  if (w < 1e-9) return [1, 0, 0, 0];
  const n = Math.hypot(up[2], up[0], w);
  return [up[2] / n, 0, -up[0] / n, w / n];
}
