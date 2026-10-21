/**
 * Walking on the inside of the habitat: a position in the interior's own coordinates (θ, s, h), a heading and a
 * pitch, turned into an eye, a view direction and an up vector in world axes. "Up" is the spin's: straight toward the
 * axis (`upAt`), so the view stays upright on the endcap slopes while the ground tilts away under the feet. Heading 0
 * looks along +z (toward the port end). Pure (no three.js).
 *
 * The physics body (`physics/character.ts`) carries the walker: `stride` turns the keys into the velocity it wants,
 * and `follow` puts the eye on the body's feet. Until the physics has ground under it, the walker glides over the
 * ground at eye height (`ground` gives where one stands: the terrain, or the water over the lake).
 */
import { fromWorld, toWorld, groundNormal, wrapAngle, type Interior, type Profile, type Vec3 } from '../blueprint';
import { v3madd } from '@futuremagic/core';
import { upAt } from './motion';

export interface WalkInput {
  /** -1 back … 1 forward, -1 left … 1 right. */
  forward: number;
  right: number;
}

export interface View {
  eye: Vec3;
  /** Unit vector the eye looks along. */
  look: Vec3;
  /** Unit up vector (the ground's normal). */
  up: Vec3;
}

/** Eye height of a standing human (m). */
export const EYE_HEIGHT = 1.7;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export class Walker {
  /** Where the walker stands (h is the eye's height above the ground, not above the profile). */
  at: Interior;
  /** Heading on the ground: 0 along +s (towards the port end on the floor); growing turns right. */
  heading = 0;
  /** Up and down, from the horizon. */
  pitch = 0;
  /** Ground speed (m/s). */
  speed = 5;
  /** The feet's world position while the physics carries the walker, or null while it glides. */
  private feet: Vec3 | null = null;

  constructor(private profile: Profile, at: Interior = startOf(profile), private ground: (theta: number, s: number) => number = () => 0) {
    this.at = { ...at };
  }

  /** Move to another habitat (the Lab changed it), keeping the share of the way along its profile. */
  setProfile(profile: Profile, ground: (theta: number, s: number) => number = () => 0): void {
    const share = this.at.s / this.profile.length;
    this.profile = profile;
    this.ground = ground;
    this.at.s = share * profile.length;
    this.feet = null;
  }

  /** Turn by mouse movement (radians). */
  turn(dHeading: number, dPitch: number): void {
    this.heading = wrapAngle(this.heading + dHeading);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch));
  }

  /** The velocity along the ground the keys ask for (world axes, m/s), for the physics body. */
  stride(input: WalkInput): Vec3 {
    const len = Math.hypot(input.forward, input.right);
    if (len === 0) return [0, 0, 0];
    const d = this.speed / Math.max(1, len);
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const { along, side } = this.frame();
    return v3madd(v3madd([0, 0, 0], along, d * (input.forward * ch - input.right * sh)), side, d * (input.forward * sh + input.right * ch));
  }

  /** Stand on the physics body's feet (world position). */
  follow(feet: Vec3): void {
    const at = fromWorld(this.profile, feet[0], feet[1], feet[2]);
    this.at = { theta: at.theta, s: at.s, h: EYE_HEIGHT };
    this.feet = [...feet];
  }

  /** Glide over the ground (no physics yet). */
  step(input: WalkInput, dt: number): void {
    this.feet = null;
    const len = Math.hypot(input.forward, input.right);
    if (len === 0) return;
    const d = (this.speed * dt) / Math.max(1, len);
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    // Forward along the heading, and right of it. `side` (see `view`) is -θ, so a step to the side turns θ back.
    const ds = d * (input.forward * ch - input.right * sh);
    const dSide = d * (input.forward * sh + input.right * ch);
    const r = Math.max(this.profile.at(this.at.s).r, 1);
    this.at.s = Math.min(this.profile.length, Math.max(0, this.at.s + ds));
    this.at.theta = wrapAngle(this.at.theta - dSide / r);
  }

  /** Stand at (θ, s) facing the way `look` points along the ground (after flying: landing under the flyer). */
  land(theta: number, s: number, look: Vec3): void {
    this.at = { theta: wrapAngle(theta), s: Math.min(this.profile.length, Math.max(0, s)), h: EYE_HEIGHT };
    this.feet = null;
    const { along, side } = this.frame();
    const a = look[0] * along[0] + look[1] * along[1] + look[2] * along[2];
    const b = look[0] * side[0] + look[1] * side[1] + look[2] * side[2];
    if (Math.hypot(a, b) > 1e-6) this.heading = Math.atan2(b, a);
    this.pitch = 0;
  }

  /** Where the feet are: on the physics body, or on the ground under (θ, s). */
  private standing(): Vec3 {
    const { theta, s } = this.at;
    return this.feet ?? toWorld(this.profile, { theta, s, h: this.ground(theta, s) });
  }

  /**
   * The directions here: ahead (+z, toward the port end, always level since up has no z), to the right of it, and up
   * toward the axis (on the axis itself, the ground's normal).
   */
  private frame(): { along: Vec3; side: Vec3; up: Vec3 } {
    const up = upAt(this.standing()) ?? groundNormal(this.profile, this.at.theta, this.at.s);
    // along × up: on the floor at θ that is (sin θ, −cos θ, 0), toward −θ.
    return { along: [0, 0, 1], side: [-up[1], up[0], 0], up };
  }

  view(): View {
    const { along, side, up } = this.frame();
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const look: Vec3 = [0, 1, 2].map((i) => cp * (ch * along[i] + sh * side[i]) + sp * up[i]) as Vec3;
    return { eye: v3madd(this.standing(), up, this.at.h), look, up };
  }
}

/** Where a walk starts: on the floor, a third of the way from the wild end, looking along the axis to the port end. */
export function startOf(profile: Profile): Interior {
  return { theta: 0.3, s: profile.floorStart + (profile.floorEnd - profile.floorStart) / 3, h: EYE_HEIGHT };
}
