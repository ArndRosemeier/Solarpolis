/**
 * The one lift cabin drawn (gen/lifts.ts): the cabin of the lift last used, where it is on its ride, and the ride under
 * way. Cabins are drawn only at the lift one uses, so there is never more than one: an empty cage below waits for its
 * cabin to be called down. The cabin stays where its last ride left it (parked under a court, out of sight, or on the
 * floor below) until another lift is used.
 */
import { Group, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Vec3 } from '../blueprint';
import { buildCabin, cabinPlace, rideSeconds, rideShare } from '../gen/lifts';
import { underLiftOf } from '../gen/underMesh';
import { mappedBytes, type Place } from '../gen/shapes';
import type { Terrain } from '../gen/terrain';
import { axesOf, builtGeometry, freeMesh, posedMesh, setPose, uploadStatic } from './geometry';
import { VAULT } from './materials';

/** A ride: from and to which share of the way, how long it has gone and will take, and whether the player rides it. */
interface Ride {
  from: number;
  to: number;
  elapsed: number;
  seconds: number;
  aboard: boolean;
  /** Seconds the cabin has waited at its start for the floor below to be built (a ride down waits for it). */
  waited: number;
  waits: boolean;
}

/** The longest a ride down waits for the floor below (s), should its tiles not come. */
const LONGEST_WAIT = 8;

export class CabinView {
  readonly group = new Group();
  /** The court whose lift it is (−1 before the first), where it is on its way (0 below, 1 at the court's level), its ride. */
  court = -1;
  k = 1;
  ride: Ride | null = null;
  private mesh: Mesh | null = null;
  private meshBytes = 0;

  constructor(private readonly terrain: Terrain, private readonly stage: Stage) {
    this.group.name = 'lift cabin';
  }

  /** Bytes the cabin holds on the GPU (memory watchdog). */
  bytes(): number {
    return this.meshBytes;
  }

  /** Whether the player rides it now. */
  get aboard(): boolean {
    return !!this.ride?.aboard;
  }

  /** Make the cabin the one of a court's lift, at share `k` of its way (the last lift's cabin is given up). */
  async ofLift(court: number, k: number): Promise<void> {
    if (court !== this.court || !this.mesh) {
      const lift = underLiftOf(this.terrain, court);
      if (!lift) return;
      this.dropCabin();
      const a = buildCabin(this.terrain.habitat, lift.side).mappedArrays(), n = a.positions.length / 3;
      // Lit as the vaults are by the lamps at mid-bay (its own lamp, the cabin being the light it rides in), no daylight.
      const glow = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) glow[2 * i] = 1;
      const mesh = posedMesh(builtGeometry(a, glow), VAULT.material, 'lift cabin');
      mesh.frustumCulled = false;
      this.meshBytes = mappedBytes(a) + glow.byteLength;
      await uploadStatic(this.stage, mesh);
      mesh.visible = true;
      this.group.add(mesh);
      this.mesh = mesh;
      this.court = court;
    }
    this.k = k;
    this.ride = null;
  }

  /** Set off to share `to` of the way, with the player aboard or not; a ride down with them waits for the floor below. */
  setOff(to: number, aboard: boolean): void {
    this.ride = { from: this.k, to, elapsed: 0, seconds: rideSeconds(this.terrain, this.court, this.k, to), aboard, waited: 0, waits: aboard && to < this.k };
  }

  /** The cabin's frame now, or null before the first lift is used. */
  place(k = this.k): Place | null {
    return this.court < 0 ? null : cabinPlace(this.terrain, this.court, k);
  }

  /**
   * Move the ride on by `dt` (real seconds: the lift keeps its own pace whatever the clock's), once `ready` (the floor
   * below is built). Returns the ride just ended, if one did.
   */
  step(dt: number, ready: boolean): Ride | null {
    const r = this.ride;
    if (!r) return null;
    if (r.waits) {
      // Not on its first frame: the floor's tiles are first asked for after the boarding.
      const first = r.waited === 0;
      r.waited += dt;
      if ((first || !ready) && r.waited < LONGEST_WAIT) return null;
      r.waits = false;
    }
    r.elapsed += dt;
    this.k = rideShare(r.from, r.to, r.elapsed, r.seconds);
    if (r.elapsed < r.seconds) return null;
    this.k = r.to;
    this.ride = null;
    return r;
  }

  /** Pose the cabin for the frame (relative to the eye). */
  poseAt(eye: Vec3): void {
    const p = this.mesh && this.place();
    if (this.mesh && p) setPose(this.mesh, axesOf(p), toView(eye, p.at));
  }

  private dropCabin(): void {
    if (this.mesh) freeMesh(this.mesh);
    this.mesh = null;
    this.meshBytes = 0;
    this.court = -1;
    this.ride = null;
  }

  dispose(): void {
    this.dropCabin();
  }
}
