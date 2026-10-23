/** Local passenger motion: thrust is the only acceleration toward a deck. In coast, movement uses
 * the ship's explicitly offered mobility assistance; releasing controls preserves drift, B arrests it.
 * The circular pressure hull, deck slabs, partitions and deployed furnishings share the drawn plan. */
import type { Vec3 } from '@futuremagic/core';
import type { FlyInput } from './flyer';
import type { VesselBox, VesselPlan } from './vessel';

export class VesselPassenger {
  eye: Vec3; velocity: Vec3 = [0, 0, 0]; yaw = -.42; pitch = -.06;
  private lift: { target: number; index: number } | null = null;
  liftFloor: number;
  constructor(readonly plan: VesselPlan) {
    this.eye = [plan.start + 1.65, 0, -2.4]; this.liftFloor = plan.start;
  }
  get deck(): number { return Math.max(0, Math.min(this.plan.decks.length - 1, Math.floor((this.eye[0] - this.plan.start) / this.plan.recipe.deckHeight))); }
  get riding(): boolean { return this.lift !== null; }
  direction(): Vec3 { const c = Math.cos(this.pitch); return [Math.sin(this.pitch), Math.cos(this.yaw) * c, Math.sin(this.yaw) * c]; }
  turn(dx: number, dy: number): void { this.yaw -= dx * .004; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * .004)); }
  takeLift(index: number): boolean {
    if (Math.hypot(this.eye[1], this.eye[2]) > 2.8 || !this.plan.decks[index]) return false;
    this.liftFloor = this.plan.decks[this.deck].floor;
    this.eye = [this.liftFloor + 1.65, 0, 0]; this.velocity = [0, 0, 0];
    this.lift = { target: this.plan.decks[index].floor, index };
    return true;
  }
  step(input: FlyInput, seconds: number, gravity: number, fittings: readonly VesselBox[], brake: boolean): void {
    const dt = Math.min(.1, Math.max(0, seconds));
    if (this.lift) {
      const distance = this.lift.target - this.liftFloor, step = Math.sign(distance) * Math.min(Math.abs(distance), dt * 2);
      this.liftFloor += step; this.eye = [this.liftFloor + 1.65, 0, 0];
      if (Math.abs(distance) < .001) { this.lift = null; this.eye[2] = -2.2; }
      return;
    }
    const f = this.direction(), right: Vec3 = [0, Math.sin(this.yaw), -Math.cos(this.yaw)];
    const speed = input.fast ? 2.2 : 1.35, active = input.forward || input.right || input.up;
    if (brake) this.velocity = this.velocity.map(v => v * Math.exp(-dt * 10)) as Vec3;
    for (let a = 0; a < 3; a++) {
      const target = (f[a] * input.forward + right[a] * input.right + (a === 0 ? input.up : 0)) * speed;
      if (active || (gravity > .01 && a > 0)) this.velocity[a] += (target - this.velocity[a]) * Math.min(1, dt * 4);
    }
    this.velocity[0] -= gravity * dt;
    const solids = [...this.plan.decks[this.deck].walls, ...fittings];
    for (let axis = 0; axis < 3; axis++) {
      const next = [...this.eye] as Vec3; next[axis] += this.velocity[axis] * dt;
      if (this.clear(next, gravity, solids)) this.eye = next; else this.velocity[axis] = 0;
    }
    if (Math.hypot(this.eye[1], this.eye[2]) > this.plan.recipe.shaft + .4) this.liftFloor = this.plan.decks[this.deck].floor;
  }
  private clear(p: Vec3, gravity: number, solids: readonly VesselBox[]): boolean {
    const radius = .28, head = .22, below = gravity > .01 ? 1.65 : .4;
    if (Math.hypot(p[1], p[2]) > this.plan.radius - radius || p[0] < this.plan.start + below || p[0] > this.plan.end - .25 - head) return false;
    if (Math.hypot(p[1], p[2]) > this.plan.recipe.shaft - radius) {
      for (const deck of this.plan.decks) if (p[0] > deck.floor - .22 - head && p[0] < deck.floor + below - .002) return false;
    } else if (p[0] < this.liftFloor + below - .002 && p[0] > this.liftFloor - .25) return false;
    return !solids.some(b => p[0] + head > b.center[0] - b.half[0] && p[0] - below < b.center[0] + b.half[0]
      && Math.abs(p[1] - b.center[1]) < b.half[1] + radius && Math.abs(p[2] - b.center[2]) < b.half[2] + radius);
  }
}
