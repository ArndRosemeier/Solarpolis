/** App-owned passenger interface injected into the renderer; render never imports app UI. */
import type { Vec3 } from '@futuremagic/core';
import type { SolarSystem } from '../space/solarSystem';
import type { Space } from '../space/space';
import type { VoyagePlan, VoyageState } from '../space/voyage';

export interface VoyagePanel {
  element: HTMLElement; active: boolean; plan: VoyagePlan | null; state: VoyageState | null; clock: number; cameraKey: string;
  bytes(): number; reset(): void; tick(dt: number): void; setActive(on: boolean): void; showCabin(on: boolean): void;
  turn(dx: number, dy: number): void; magnify(delta: number): void;
  camera(): { eye: Vec3; target: Vec3; up: Vec3; fov: number } | null;
}
export type VoyagePanelFactory = (system: SolarSystem, space: () => Space, time: () => number, depart: () => void, visit: () => void) => VoyagePanel;
