/**
 * The newcomer's fellow passengers in the arrival's cabin shot (plan "The Threshold", step 5: "You are on board"): a
 * few people of Actors (dressed as the residents are, `Residents.lookFrom`, each from the world's seed) seated
 * on the lounge's couches in view (space/lounge.ts `placesInView`), belted in for the approach, looking out at the
 * habitat. Loaded while the title plays (Arnd, 2026-10-23: the cast is loaded first); a seat whose passenger is not
 * ready yet stays empty, so nobody appears in the middle of the shot. Given back once the arrival is over.
 *
 * Actors' bodies are lit by three's lights, so the lounge has its own in the Outside scene (lights.ts `loungeLights`),
 * lit as the room's kind is (loungeShaders.ts): its lamps from the ceiling and the light its windows let in from the
 * view, both scaled by the eyes' exposure as the kinds are.
 */
import type { Stage } from '@futuremagic/stage';
import { deriveSeed, v3add, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { LOUNGE, fromShip, fromShipDirection, seatedFeet, type Lounge, type Place } from '../space';
import { Figure } from './actors/figure';
import { Residents } from './actors/residents';
import { humanCatalog } from './actors/pack';
import { screenTextures } from './actors/screens';
import { logged } from './loadLog';
import { loungeLights } from './lights';
import type { ShipPose } from './lounge';

/** How many fellow passengers the shot is cast with. */
export const PASSENGERS = 4;
/** Of the room's own light, the share that comes down from the cove (the rest from all round, off the pale walls). */
const LAMPS_FROM_ABOVE = 0.7;

export class Passengers {
  private readonly seated: Figure[] = [];
  private readonly lamps = loungeLights.lamps;
  private readonly windows = loungeLights.windows;
  private readonly room = loungeLights.room;
  private disposed = false;
  /** Resolves once every passenger is loaded (or given up). */
  readonly ready: Promise<void>;

  constructor(private readonly stage: Stage, seed: number, count = PASSENGERS) {
    this.ready = logged('passengers', () => this.loadCast(seed, count));
  }

  /** One after another, so the first seats fill first and the frames between loads stay light. */
  private async loadCast(seed: number, count: number): Promise<void> {
    const { catalog, base, human } = await humanCatalog(), looks = new Residents(catalog, base, human);
    for (let k = 0; k < count && !this.disposed; k++) {
      const figure = await Figure.load(looks.lookFrom(deriveSeed(seed, 'passenger', k)), human);
      if (this.disposed) { figure.dispose(); return; }
      figure.object.visible = false;
      await this.stage.add(figure.object);
      if (this.disposed) { this.stage.remove(figure.object); figure.dispose(); return; }
      this.seated.push(figure);
    }
  }

  /**
   * Seat them on `places` (nearest the window first), with the ship at `ship` round the eye at `eye`, sitting still,
   * lit by the room's lamps (`lamps`, its light on the floor) and by what its windows let in (`windows`, ship frame),
   * at the eyes' `exposure`. The rest are hidden.
   */
  seat(l: Lounge, places: readonly Place[], ship: ShipPose, eye: Vec3, windows: { all: number; toward: Vec3 }, exposure: number, dt: number, time: number): void {
    screenTextures.update(dt);
    const up = fromShipDirection(ship, [1, 0, 0]);
    this.seated.forEach((f, k) => {
      const p = places[k];
      f.object.visible = !!p;
      if (!p) return;
      f.update({ feet: v3sub(fromShip(ship, seatedFeet(l, p)), eye), up, front: fromShipDirection(ship, p.facing), speed: 0, anim: { move: 'sit' } }, dt, time);
    });
    // The lights in the scene's axes, relative to the eye: the cove's from above (toward aft), the windows' from where
    // the light they let in comes from on balance.
    const at = v3sub(fromShip(ship, [l.floor, 0, 0]), eye), toward = fromShipDirection(ship, windows.toward), strength = v3len(windows.toward);
    this.lamps.position.set(...v3add(at, v3scale(up, 10)));
    this.lamps.target.position.set(...at);
    this.lamps.intensity = Math.PI * LOUNGE.lamps * LAMPS_FROM_ABOVE * exposure;
    this.windows.position.set(...v3add(at, strength > 0 ? v3scale(toward, 10 / strength) : [0, 0, 0]));
    this.windows.target.position.set(...at);
    this.windows.intensity = (Math.PI * strength * exposure) / 2;
    this.room.intensity = Math.PI * (LOUNGE.lamps * (1 - LAMPS_FROM_ABOVE) + windows.all / 2) * exposure;
    for (const light of [this.lamps.target, this.windows.target]) light.updateMatrixWorld();
  }

  hide(): void {
    for (const f of this.seated) f.object.visible = false;
    this.lamps.intensity = this.windows.intensity = this.room.intensity = 0;
  }

  /** Bytes their bodies hold (memory watchdog). */
  bytes(): number {
    return this.seated.reduce((n, f) => n + f.bytes(), 0);
  }

  /** Give them back: the arrival is over. */
  dispose(): void {
    this.disposed = true;
    for (const f of this.seated) { this.stage.remove(f.object); f.dispose(); }
    this.seated.length = 0;
    this.hide();
  }
}

