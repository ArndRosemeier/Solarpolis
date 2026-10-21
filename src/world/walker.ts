/**
 * Walking on the inside of the habitat: a position in the interior's own coordinates (θ, s, h), a heading on the
 * ground and a pitch, turned into an eye, a view direction and an up vector in world axes. "Up" is the ground's
 * normal, so it swings with the curve of the floor and leans over on the endcap slopes. Pure (no three.js).
 *
 * For now the walker glides over the ground at a fixed eye height (`ground` gives where one stands: the terrain, or the
 * water over the lake): no physics, no Coriolis yet (both come with the physics stage).
 */
import { toWorld, groundNormal, wrapAngle, type Interior, type Profile, type Vec3 } from '../blueprint';

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

  constructor(private profile: Profile, at: Interior = startOf(profile), private ground: (theta: number, s: number) => number = () => 0) {
    this.at = { ...at };
  }

  /** Move to another habitat (the Lab changed it), keeping the share of the way along its profile. */
  setProfile(profile: Profile, ground: (theta: number, s: number) => number = () => 0): void {
    const share = this.at.s / this.profile.length;
    this.profile = profile;
    this.ground = ground;
    this.at.s = share * profile.length;
  }

  /** Turn by mouse movement (radians). */
  turn(dHeading: number, dPitch: number): void {
    this.heading = wrapAngle(this.heading + dHeading);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch));
  }

  step(input: WalkInput, dt: number): void {
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

  view(): View {
    const { theta, s } = this.at;
    const p = this.profile.at(s);
    const up = groundNormal(this.profile, theta, s);
    // Along the profile (+s): the curve's tangent (dz, dr) = (-nr, nz), in world axes. On the floor that is +z.
    const along: Vec3 = [p.nz * Math.cos(theta), p.nz * Math.sin(theta), -p.nr];
    // To the right when facing along +s with the ground's normal up: along × up, which is -θ.
    const side: Vec3 = [-Math.sin(theta), Math.cos(theta), 0].map((v) => -v) as Vec3;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const look: Vec3 = [0, 1, 2].map((i) => cp * (ch * along[i] + sh * side[i]) + sp * up[i]) as Vec3;
    return { eye: toWorld(this.profile, { theta, s, h: this.ground(theta, s) + this.at.h }), look, up };
  }
}

/** Where a walk starts: on the floor, a third of the way from the wild end, looking along the axis to the port end. */
export function startOf(profile: Profile): Interior {
  return { theta: 0.3, s: profile.floorStart + (profile.floorEnd - profile.floorStart) / 3, h: EYE_HEIGHT };
}
