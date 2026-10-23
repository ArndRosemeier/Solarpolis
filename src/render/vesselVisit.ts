/** A passenger visit to a recipe-built ship, hosted by OutsideView's existing camera and solar sky. */
import type { Stage } from '@futuremagic/stage';
import { v3add, v3sub, type Vec3 } from '@futuremagic/core';
import { apply, type Mat3 } from '../space/pose';
import { EXPLORER, vesselPlan, VesselDrive, type VesselRecipe } from '../space/vessel';
import { VesselPassenger } from '../space/vesselPassenger';
import type { FlyInput } from '../space/flyer';
import { VesselMeshes } from './vessel';
import './vessel.css';

export class VesselVisit {
  readonly element = document.createElement('section');
  readonly launch = document.createElement('button');
  readonly help = document.createElement('div');
  readonly plan;
  readonly drive;
  readonly passenger;
  meshes: VesselMeshes;
  active = false; inside = false;
  private yaw = -.65; private pitch = .2; private distance: number;
  private elapsed = 0; private burnLeft = 0;
  private status = document.createElement('p');
  private deckInfo = document.createElement('p');
  private message = document.createElement('p');
  private deckSelect = document.createElement('select');
  private insideControls = document.createElement('div');
  private enter = document.createElement('button');
  private openFloor = false;
  private updateTime = 0;
  private loading = false;
  private readonly axes: Mat3 = [0, 1, 0, 0, 0, 1, 1, 0, 0];
  private readonly berth: Vec3 = [5000000, 0, 0];

  constructor(private stage: Stage, private onEnter: () => void, private onLeave: () => void, recipe: VesselRecipe = EXPLORER) {
    this.plan = vesselPlan(recipe); this.drive = new VesselDrive(recipe.drive); this.passenger = new VesselPassenger(this.plan);
    this.meshes = new VesselMeshes(this.plan, stage); this.distance = this.plan.shape.params.length * 1.3;
    this.element.className = 'vessel-panel'; this.element.hidden = true;
    this.help.className = 'vessel-help'; this.help.hidden = true;
    this.launch.className = 'vessel-launch'; this.launch.textContent = 'Visit exploration ship';
    this.launch.addEventListener('click', () => { void this.open(); });
    const title = document.createElement('h2'); title.textContent = recipe.name;
    const eyebrow = document.createElement('p'); eyebrow.className = 'vessel-eyebrow'; eyebrow.textContent = recipe.className;
    const hello = document.createElement('p'); hello.className = 'vessel-welcome'; hello.textContent = `“${recipe.greeting}”`;
    const actions = document.createElement('div'); actions.className = 'vessel-actions';
    this.enter.textContent = 'Enter airlock'; this.enter.addEventListener('click', () => { this.inside = !this.inside; this.refresh(); });
    const leave = document.createElement('button'); leave.textContent = 'Return to habitat'; leave.addEventListener('click', () => this.close()); actions.append(this.enter, leave);
    this.deckSelect.setAttribute('aria-label', 'Ship deck');
    recipe.decks.forEach((d, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1} · ${d.name}`; this.deckSelect.append(o); });
    const lift = document.createElement('button'); lift.textContent = 'Take central lift';
    lift.addEventListener('click', () => { this.message.textContent = this.passenger.takeLift(Number(this.deckSelect.value)) ? 'The lift carries you through the deck stack.' : 'Come to the central lift first. Follow the illuminated circular opening.'; });
    const furniture = document.createElement('button'); furniture.textContent = 'Make room';
    furniture.addEventListener('click', () => { this.openFloor = !this.openFloor; this.meshes.setOpenFloor(this.openFloor); furniture.textContent = this.openFloor ? 'Restore furnishings' : 'Make room'; this.message.textContent = this.openFloor ? 'The supports withdraw into the deck. I’ll keep your occupied space clear.' : 'Your room is settling back into place.'; });
    this.insideControls.append(this.deckSelect, lift, furniture, this.deckInfo);
    const burn = document.createElement('button'); burn.textContent = 'Try a 20-second departure burn'; burn.className = 'vessel-burn';
    burn.addEventListener('click', () => {
      this.drive.burning = !this.drive.burning && this.drive.fuel > 0; this.burnLeft = this.drive.burning ? 20 : 0;
      burn.textContent = this.drive.burning ? 'Cut thrust · coast' : 'Try a 20-second departure burn';
      this.message.textContent = this.drive.burning ? 'Thrust will settle you toward the engine. The deck beneath you is aft.' : 'Thrust off. We retain our velocity; the rooms are in freefall.';
    });
    this.status.className = 'vessel-status'; this.message.className = 'vessel-message';
    this.element.append(eyebrow, title, hello, actions, this.insideControls, burn, this.status, this.message);
    this.refresh();
  }
  private async open(): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.launch.disabled = true; this.launch.textContent = 'Preparing your visit…';
    try {
      if (!this.meshes.ready) await this.meshes.start();
      this.active = true; this.onEnter(); this.refresh();
    } catch (e) { this.launch.textContent = `Ship unavailable: ${e instanceof Error ? e.message : String(e)}`; }
    finally { this.loading = false; this.launch.disabled = false; if (this.active) this.launch.textContent = 'Visit exploration ship'; }
  }
  close(): void { this.active = false; this.drive.burning = false; this.drive.acceleration = 0; this.burnLeft = 0; this.meshes.hide(); this.refresh(); this.onLeave(); }
  releaseIdle(): void {
    if (this.active || this.loading || !this.meshes.ready) return;
    this.meshes.dispose(); this.meshes = new VesselMeshes(this.plan, this.stage);
  }
  show(on: boolean): void { this.launch.hidden = !on || this.active; this.element.hidden = !on || !this.active; this.help.hidden = !on || !this.active; }
  turn(dx: number, dy: number): void {
    if (this.inside) this.passenger.turn(dx, dy);
    else { this.yaw -= dx * .005; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + dy * .005)); }
  }
  zoom(delta: number): void { if (!this.inside) this.distance = Math.max(this.plan.recipe.radius * 3, Math.min(this.plan.shape.params.length * 8, this.distance * Math.exp(delta * .001))); }
  step(dt: number, input: FlyInput, brake: boolean): void {
    if (!this.active) return;
    this.elapsed += dt;
    const burn = Math.min(dt, this.burnLeft);
    if (burn > 0) { this.drive.advance(burn); this.burnLeft -= burn; }
    if (this.burnLeft <= 0) this.drive.burning = false;
    this.drive.advance(dt - burn);
    if (!this.drive.burning) this.drive.acceleration = 0;
    if (this.inside) this.passenger.step(input, dt, this.drive.acceleration, this.meshes.fittings, brake);
    this.meshes.updateRooms(dt, this.elapsed, this.passenger.liftFloor, this.passenger.eye);
    this.updateTime += dt;
    if (this.updateTime > .2) { this.updateTime = 0; this.refresh(); }
  }
  private origin(): Vec3 { return v3add(this.berth, apply(this.axes, [this.drive.distance, 0, 0])); }
  meterHull(eye: Vec3): { center: Vec3; axis: Vec3; radius: number; halfLength: number; albedo: number } {
    const length = this.plan.shape.params.length;
    return { center: v3sub(v3add(this.origin(), apply(this.axes, [length / 2, 0, 0])), eye), axis: apply(this.axes, [1, 0, 0]), radius: this.plan.recipe.radius, halfLength: length / 2, albedo: .5 };
  }
  camera(): { eye: Vec3; target: Vec3; up: Vec3; fov: number } {
    const origin = this.origin(), local = this.passenger.eye;
    if (this.inside) {
      const eye = v3add(origin, apply(this.axes, local));
      return { eye, target: v3add(eye, apply(this.axes, this.passenger.direction())), up: apply(this.axes, [1, 0, 0]), fov: 65 };
    }
    const target = v3add(origin, apply(this.axes, [this.plan.shape.params.length * .56, 0, 0]));
    const offset: Vec3 = [Math.sin(this.pitch) * this.distance, Math.cos(this.pitch) * Math.cos(this.yaw) * this.distance, Math.cos(this.pitch) * Math.sin(this.yaw) * this.distance];
    return { eye: v3add(target, apply(this.axes, offset)), target, up: apply(this.axes, [1, 0, 0]), fov: 50 };
  }
  place(eye: Vec3): void { if (this.active) this.meshes.pose(this.axes, v3sub(this.origin(), eye), this.drive.burning ? 1 : 0); }
  private refresh(): void {
    this.show(true); this.insideControls.hidden = !this.inside;
    this.enter.textContent = this.inside ? 'Observe exterior' : 'Enter airlock';
    const d = this.plan.decks[this.passenger.deck]; this.deckInfo.textContent = `${d.recipe.name} · ${d.recipe.description}`
      + (d.recipe.use === 'arrival' ? ` ${this.plan.recipe.companions.map(c => `${c.name}: ${c.role}${c.person ? ' (a person)' : ''}`).join('; ')}.` : '');
    const gravity = this.drive.acceleration / 9.80665;
    this.status.textContent = `${this.drive.burning ? `${gravity.toFixed(2)} g · thrust toward bow` : '0 g · coasting'} · ${this.drive.speed.toFixed(1)} m/s gained · ${(this.drive.fuel / 1000).toFixed(1)} t reaction mass`;
    const burn = this.element.querySelector('.vessel-burn'); if (burn) burn.textContent = this.drive.burning ? `Cut thrust · ${Math.ceil(this.burnLeft)} s left` : 'Try a 20-second departure burn';
    this.help.textContent = this.inside ? 'Hold right mouse to look · WASD to move · E / Q to rise or descend · B to stop drift · central lift connects every deck' : 'Hold right mouse to orbit · scroll to approach · enter through the airlock to explore the decks';
  }
}
