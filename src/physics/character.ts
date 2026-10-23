/**
 * The player's body in the physics: an upright capsule moved by Rapier's character controller. "Up" is not fixed: it
 * points toward the axis wherever the body is (`world/motion.ts`, `upAt`), and gravity is the spin's, so it weakens
 * up the endcaps and a jump there carries much higher and further. In the air the body follows the turning frame's
 * apparent acceleration (centrifugal and Coriolis) and the air's drag, the same as every ball. On the ground the same
 * forces push it, and the legs push back toward the stride through their grip: friction times the weight the body
 * feels (`feltGravity`, Arnd 2026-10-23). So running with the spin grips harder and against it skids sooner; toward
 * the axis the feet barely hold; a headwind at a run takes grip; and on an endcap slope the Coriolis force leans the
 * body sideways while the legs hold the line. In deep water it floats: buoyancy holds it with the head just out, and
 * it swims slowly; water brakes a fast body hard (drag grows with the square of the speed), so a runner who plunges in
 * stops within a few metres.
 *
 * The controller's corrections move the body but never speed it up: stepping onto a kerb, sliding over a seam between
 * ground triangles or being pushed out of a slope may lift it a few centimetres in one step, and taken as velocity
 * that lift became a launch of 10 m/s or more (the "moon jumps" Arnd met running fast, 2026-10-22). So after a step
 * the body keeps no more upward speed than the feet, a jump or the water gave it, and no more speed in all than it had.
 *
 * Made by `PhysicsWorld.addCharacter`, stepped by `PhysicsWorld.advance` before each physics step. Positions here are
 * world positions (float64); the Rapier body sits in the bubble's own coordinates (see `world.ts`).
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Habitat, Vec3 } from '../blueprint';
import { v3add as add, v3dot as dot, v3lerp, v3madd as along, v3scale as scale, v3sub as sub } from '@futuremagic/core';
import { airDrag, apparentAcceleration, feltGravity, upAt } from '../world/motion';

type Rapier = typeof RAPIER_NS;

/**
 * A standing human: capsule radius and full height (m), mass (kg), and drag area (Cd · A, m²) of a falling body: a
 * skydiver lying flat falls at about 55 m/s in Earth's air (Cd · A = 2 m g / ρ v²).
 */
export const HUMAN = { radius: 0.3, height: 1.8, mass: 75, dragArea: 0.4 };
/** The body's drag area over its mass (m²/kg), for `airDrag`. */
export const HUMAN_DRAG = HUMAN.dragArea / HUMAN.mass;
/** Take-off speed of a standing jump (m/s): about half a metre high at Earth gravity. */
export const JUMP_SPEED = 3.2;
/** After a jump the feet count as off the ground for this long (s), so the ground just left does not catch them. */
const JUMP_LEAVES = 0.1;
/** Steepest ground the feet climb, and where they start to slide (radians from level). */
const MAX_CLIMB = (50 * Math.PI) / 180;
const SLIDE_FROM = (55 * Math.PI) / 180;
/**
 * How hard the legs can push along the ground per unit of felt weight (a friction coefficient): good soles on turf or
 * rock, as much as the steepest slope the feet climb asks of them.
 */
export const GRIP = Math.tan(MAX_CLIMB);
/**
 * The work (J/kg) the legs put into one step up without jumping: half a metre at Earth's gravity, so the highest step
 * grows as the weight fades (`stepUpAt`), as the Lift Stair's risers do (gen/liftStair.ts `riserAt`).
 */
const STEP_WORK = 0.5 * 9.81;
/**
 * What the capsule meets ahead that it treats as a step to take rather than ground to walk up (radians from level):
 * a riser, or the rounded edge of one the capsule's foot has ridden onto. Gentler slopes the controller climbs.
 */
const EDGE = (30 * Math.PI) / 180;
/** How far past a riser a foot finds the step's tread (m). */
const FOOT = 0.05;
/** How far down the feet stay on the ground when walking over a crest (m). */
const SNAP_DOWN = 0.3;
/** The gap the controller keeps between the capsule and what it touches (m). */
const SKIN = 0.02;
/**
 * In water: the share of the body under water when treading water (the head just out), how fast water slows the body
 * (1/s), the top swimming speed (m/s) and how fast a swimmer gets to it (1/s).
 */
const FLOATS_AT = 0.85;
const WATER_DRAG = 2.5;
const SWIM_SPEED = 1.2;
const SWIM_PULL = 2;
/**
 * Water's drag growing with the square of the speed, per metre (ρ·Cd·A / 2m for a body half in the water: 1000 kg/m³,
 * Cd·A about 0.15 m², 75 kg). Slow swimming hardly feels it; a body that hits the water at 40 m/s stops in about 3 m.
 */
const WATER_RAM = 1;

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
  /**
   * The legs' strength as a multiple of a human's (the debug menu's travel boost): their grip goes with its square, so
   * a boosted run reaches its speed in the same time and holds it against the headwind as a plain one does.
   */
  legs = 1;
  /** Time left (s) in which a jump is still leaving the ground. */
  private leaving = 0;
  /** How much higher (m) the body is still rising onto a step it began to climb. */
  private climbing = 0;
  private readonly body: RAPIER_NS.RigidBody;
  private readonly collider: RAPIER_NS.Collider;
  private readonly control: RAPIER_NS.KinematicCharacterController;
  /** Feet (world) after the step before last and after the last: drawn between them. */
  private before: Vec3;
  private now: Vec3;

  constructor(private readonly R: Rapier, private readonly world: RAPIER_NS.World, private readonly habitat: Habitat, feet: Vec3, origin: Vec3, private readonly water: WaterDepth = () => 0) {
    this.up = upAt(feet) ?? [0, 1, 0];
    this.before = [...feet];
    this.now = [...feet];
    const centre = sub(along(feet, this.up, HUMAN.height / 2), origin);
    const q = uprightRotation(this.up);
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(centre[0], centre[1], centre[2])
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }));
    this.collider = world.createCollider(R.ColliderDesc.capsule(HUMAN.height / 2 - HUMAN.radius, HUMAN.radius), this.body);
    this.control = world.createCharacterController(SKIN);
    this.control.setMaxSlopeClimbAngle(MAX_CLIMB);
    this.control.setMinSlopeSlideAngle(SLIDE_FROM);
    // Steps are the body's own (`stepUp`): Rapier's autostep stalls on short treads and tall risers.
    this.control.disableAutostep();
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
    // On the feet at the start of the step, and not leaving them for a jump.
    const footed = this.grounded && !this.swimming && this.leaving === 0;
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
      v = scale(v, 1 / (1 + WATER_RAM * Math.hypot(...v) * dt));
      const want = flat(this.stride.walk), speed = Math.hypot(...want);
      const goal = speed > SWIM_SPEED ? scale(want, SWIM_SPEED / speed) : want;
      v = along(v, sub(goal, flat(v)), Math.min(1, SWIM_PULL * dt));
    } else if (this.grounded) {
      // The turning frame and the air push the body; the legs push it toward the stride across up, as hard as the
      // grip allows. Up and down are the stride's (`downhill`) and gravity's, as on any ground: uphill the controller
      // lifts the feet, and the legs gain no speed upward that a crest would throw the body off with. The ground's
      // push holds up the weight. A jump leaves it, keeping the speed along the ground.
      const t = this.body.translation();
      const n = this.groundBelow([t.x, t.y, t.z], up, HUMAN.radius + SNAP_DOWN)?.normal ?? null;
      const want = downhill(flat(this.stride.walk), up, n);
      const pushed = flat(along(v, add(a, airDrag(this.habitat, feet, v, HUMAN_DRAG)), dt));
      const press = Math.max(0, feltGravity(this.habitat, feet, v) * dot(n ?? up, up));
      v = along(legs(pushed, flat(want), up, GRIP * this.legs * this.legs * press * dt), up, dot(want, up) + dot(a, up) * dt);
      if (this.stride.jump) {
        v = along(flat(v), up, JUMP_SPEED);
        this.leaving = JUMP_LEAVES;
      }
    } else {
      v = along(v, add(a, airDrag(this.habitat, feet, v, HUMAN_DRAG)), dt);
    }
    this.stride.jump = false;
    this.leaving = Math.max(0, this.leaving - dt);

    // A step ahead (a riser, a kerb, a ledge as high as the legs lift the body here): the body rises onto it as fast
    // as the stride would climb the steepest slope, the legs keep their speed, and the rise is no speed upward.
    const t0 = this.body.translation(), wantFlat = flat(this.stride.walk);
    // Once begun, a step is climbed to its top, even where the capsule's rounded foot already rests on its edge.
    if (!footed || this.swimming || this.stride.walk.every((x) => x === 0)) this.climbing = 0;
    else if (this.climbing <= 0) this.climbing = this.stepUp([t0.x, t0.y, t0.z], up, flat(v), wantFlat, dt, stepUpAt(feltGravity(this.habitat, feet, v)));
    const lift = Math.min(this.climbing, Math.max(JUMP_SPEED, Math.hypot(...wantFlat) * Math.tan(MAX_CLIMB)) * dt);
    const want = { x: v[0] * dt + up[0] * lift, y: v[1] * dt + up[1] * lift, z: v[2] * dt + up[2] * lift };
    this.control.setUp({ x: up[0], y: up[1], z: up[2] });
    this.control.computeColliderMovement(this.collider, want);
    const m = this.control.computedMovement(), t = this.body.translation();
    let moved: Vec3 = [m.x, m.y, m.z], touching = this.control.computedGrounded() || lift > 0;
    // What is overhead may stop the climb.
    if (lift > 0) this.climbing = dot(moved, up) < 0.5 * lift ? 0 : Math.max(0, this.climbing - lift);
    // A seam between ground triangles can catch the capsule and lift it off the ground in one step: the feet stay down.
    const extra = dot(moved, up) - Math.max(0, dot(v, up)) * dt - lift;
    if (footed && extra > 0.01) {
      const g = this.groundBelow(add([t.x, t.y, t.z], moved), up, HUMAN.radius + extra + SNAP_DOWN);
      const gap = g ? g.toi - HUMAN.radius / Math.max(dot(g.normal, up), 0.5) - SKIN : 0;
      if (gap > 0) { moved = along(moved, up, -Math.min(gap, extra)); touching = true; }
    }
    this.grounded = touching && this.leaving === 0;
    this.velocity = afterMove(v, scale(moved, 1 / dt), up);
    // On the feet only a wall takes speed along the ground: a seam between ground triangles may stall the capsule for
    // a step, but the legs carry on (with momentum, a stall kept as speed would be a stumble on flat ground).
    // Climbing a step, the riser takes no speed either, and the rise leaves none upward.
    if (footed && !this.swimming && lift > 0) this.velocity = flat(v);
    else if (footed && !this.swimming && !walled(this.control, up)) this.velocity = along(flat(v), up, dot(this.velocity, up));

    this.body.setNextKinematicTranslation({ x: t.x + moved[0], y: t.y + moved[1], z: t.z + moved[2] });
    const q = uprightRotation(up);
    this.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    this.before = this.now;
    this.now = add(along(add([t.x, t.y, t.z], moved), up, -HUMAN.height / 2), origin);
  }

  /**
   * How high the body must rise this step to go on onto a step ahead (m), or 0: none, or none it can take. The capsule
   * at `centre` (bubble axes) moving at `v` along the ground meets a riser or its edge within this step's move
   * (steeper than `EDGE`); lifted by up to `most`, under whatever is overhead, it could go on; and a foot's length
   * past the riser there is ground to stand on, no steeper than the feet climb, above where they are now and well
   * above the ground a foot's length before it. The capsule is wider than a foot: on short treads it rests on the
   * nosings, as a foot rests on one tread.
   */
  private stepUp(centre: Vec3, up: Vec3, v: Vec3, wantFlat: Vec3, dt: number, most: number): number {
    const speed = Math.hypot(...wantFlat);
    if (speed < 1e-3) return 0;
    const dir = scale(wantFlat, 1 / speed), move = Math.max(Math.max(0, dot(v, dir)), speed) * dt + 4 * SKIN;
    // A little above where it stands, so the ground under the capsule is not what it meets.
    const ahead = this.cast(along(centre, up, 2 * SKIN), dir, move);
    if (!ahead || dot(ahead.normal, up) >= Math.cos(EDGE)) return 0;
    const over = this.cast(centre, up, most), room = over ? Math.max(0, over.toi - SKIN) : most;
    if (room < 0.02) return 0;
    const high = along(centre, up, room), past = this.cast(high, dir, ahead.toi + FOOT);
    if (past && past.toi < ahead.toi + SKIN) return 0;
    // The ground a foot's length before and past where the capsule meets it, over the soles (straight down from as
    // high as there is room): a step is a jump in it up to a tread, most of the rise; a slope rises evenly, and the
    // controller walks up that.
    const soles = dot(centre, up) - HUMAN.height / 2;
    const footing = (x: number): { rise: number; level: boolean } | null => {
      const p = along(along(ahead.point, dir, x), up, soles + room - dot(ahead.point, up));
      const ray = new this.R.Ray({ x: p[0], y: p[1], z: p[2] }, { x: -up[0], y: -up[1], z: -up[2] });
      const hit = this.world.castRayAndGetNormal(ray, room + SNAP_DOWN, true, undefined, undefined, this.collider);
      if (!hit) return null;
      return { rise: room - hit.timeOfImpact, level: Math.abs(hit.normal.x * up[0] + hit.normal.y * up[1] + hit.normal.z * up[2]) >= Math.cos(EDGE) };
    };
    const before = footing(-FOOT), top = footing(FOOT);
    if (!top || !top.level || top.rise < 0.01) return 0;
    // Steeper between the two than the feet climb, and most of the rise.
    const jump = top.rise - (before?.rise ?? 0);
    return jump > 2 * FOOT * Math.tan(MAX_CLIMB) && jump >= 0.5 * top.rise ? top.rise + SKIN : 0;
  }

  /** Sweep the capsule from `centre` (bubble axes) along the unit `dir` up to `distance`: how far, the normal and point met. */
  private cast(centre: Vec3, dir: Vec3, distance: number): { toi: number; normal: Vec3; point: Vec3 } | null {
    const q = uprightRotation(this.up), rot = { x: q[0], y: q[1], z: q[2], w: q[3] };
    const hit = this.world.castShape({ x: centre[0], y: centre[1], z: centre[2] }, rot, { x: dir[0], y: dir[1], z: dir[2] }, this.collider.shape, 0, distance, false, undefined, undefined, this.collider);
    if (!hit) return null;
    // The world's query gives both in the bubble's axes: the normal of what it meets (toward the capsule), and where.
    return { toi: hit.time_of_impact, normal: [hit.normal1.x, hit.normal1.y, hit.normal1.z], point: [hit.witness1.x, hit.witness1.y, hit.witness1.z] };
  }

  /**
   * The ground straight below the capsule's lower sphere when the body's middle is at `centre` (bubble axes): how far
   * down from that sphere's centre, and its normal; null when there is none within `reach`.
   */
  private groundBelow(centre: Vec3, up: Vec3, reach: number): { toi: number; normal: Vec3 } | null {
    const o = along(centre, up, -(HUMAN.height / 2 - HUMAN.radius));
    const ray = new this.R.Ray({ x: o[0], y: o[1], z: o[2] }, { x: -up[0], y: -up[1], z: -up[2] });
    const hit = this.world.castRayAndGetNormal(ray, reach, true, undefined, undefined, this.collider);
    if (!hit) return null;
    const n: Vec3 = [hit.normal.x, hit.normal.y, hit.normal.z];
    return { toi: hit.timeOfImpact, normal: dot(n, up) < 0 ? scale(n, -1) : n };
  }

  /** Take the body and its controller out of the world. */
  release(): void {
    this.world.removeCharacterController(this.control);
    this.world.removeRigidBody(this.body);
  }
}

/**
 * A level stride `walk` turned to follow the ground (normal `n`) where it falls away ahead, so a runner going downhill
 * moves with the slope instead of straight out over it. Uphill it stays level: the controller lifts the feet up the
 * slope, and the legs take the climb back at the top rather than throw the body off the crest. Exported for tests.
 */
export function downhill(walk: Vec3, up: Vec3, n: Vec3 | null): Vec3 {
  const lift = n ? dot(n, up) : 0;
  if (lift < Math.cos(MAX_CLIMB)) return walk;
  const rate = -dot(walk, n!) / lift;
  return rate < 0 ? along(walk, up, rate) : walk;
}

/** Whether the controller met a wall this step (`computedCollision`: anything steeper than the feet climb). */
function walled(control: RAPIER_NS.KinematicCharacterController, up: Vec3): boolean {
  for (let i = 0; i < control.numComputedCollisions(); i++) {
    const n = control.computedCollision(i)?.normal1;
    if (n && Math.abs(n.x * up[0] + n.y * up[1] + n.z * up[2]) < Math.cos(MAX_CLIMB)) return true;
  }
  return false;
}

/**
 * The velocity `v` after the legs push it toward `want` along the ground (normal `n`) by at most `reach` (m/s) this
 * step: what they can change is the part along the ground, and what is left over skids. Exported for tests.
 */
export function legs(v: Vec3, want: Vec3, n: Vec3, reach: number): Vec3 {
  const d = sub(want, v), off = along(d, n, -dot(d, n)), size = Math.hypot(...off);
  return size <= reach ? add(v, off) : along(v, off, reach / size);
}

/**
 * The velocity a body keeps after the controller moved it by `moved` (as a velocity) when it wanted `want`: what the
 * ground or a wall stopped is gone, but the controller's corrections add nothing. It keeps no more upward speed than
 * it wanted (none, if it wanted to go down: the ground may stop a fall, never throw the body up), falls no faster than
 * it wanted (a snap down a kerb is no fall), and keeps no more speed in all. Exported for tests.
 */
export function afterMove(want: Vec3, moved: Vec3, up: Vec3): Vec3 {
  let v = moved;
  const rise = dot(v, up), wanted = dot(want, up), fit = Math.min(Math.max(rise, Math.min(0, wanted)), Math.max(0, wanted));
  v = along(v, up, fit - rise);
  const speed = Math.hypot(...v), limit = Math.hypot(...want);
  return speed > limit ? scale(v, limit / speed) : v;
}

/**
 * The highest step (m) the legs take without jumping where the body feels `g` (m/s²): `STEP_WORK` / g, at most the
 * body's own height. Exported for tests.
 */
export function stepUpAt(g: number): number {
  return Math.min(HUMAN.height, STEP_WORK / Math.max(g, 1e-3));
}

/** The rotation (x, y, z, w) that turns a capsule's own axis (+y) to `up` (a unit vector). */
export function uprightRotation(up: Vec3): [number, number, number, number] {
  const w = 1 + up[1];
  if (w < 1e-9) return [1, 0, 0, 0];
  const n = Math.hypot(up[2], up[0], w);
  return [up[2] / n, 0, -up[0] / n, w / n];
}
