/** Nearby adaptable furnishings: a bounded instance pool, shared geometry and continuous changes.
 * Fixed room shells remain in the Understorey's streamed tiles. */
import { Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Stage } from '@futuremagic/stage';
import { fromWorld, type Vec3 } from '../blueprint';
import type { Terrain } from '../gen/terrain';
import { underOf } from '../gen/under';
import { bayFrame, underHousesIn } from '../gen/underMesh';
import { floorAt, inFloorFrame, placeAt, type FloorFrame } from '../gen/shapes';
import type { House } from '../gen/homes';
import { homeFittings, homePlan, homeUseAt, type Fitting, type HomeMode } from '../gen/homeInterior';
import type { FurnitureBody } from '../physics/world';
import { dropUploaded, freeMesh } from './geometry';
import { PROP } from './materials';
import { EYE_HEIGHT } from '../world/walker';

interface Home { house: House; frame: FloorFrame; modes: HomeMode[]; fittings: Fitting[][] }
export interface RoomState { mode: HomeMode; automatic: boolean; floor: number; lived: boolean }
const CAPACITY = 2048;
export class HomesView {
  readonly group = new Group();
  readonly bodies: FurnitureBody[] = [];
  private mesh: InstancedMesh | null = null;
  private disposed = false;
  private homes: Home[] = [];
  private bay = '';
  private selected: { home: Home; floor: number } | null = null;
  private override: HomeMode | null = null;
  private held = 0;
  constructor(private readonly terrain: Terrain, private readonly stage: Stage) { void this.prepareFurniture(); }

  private async prepareFurniture(): Promise<void> {
    const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.08).deleteAttribute('uv');
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
    const mesh = new InstancedMesh(g, PROP.material, CAPACITY);
    mesh.setColorAt(0, new Color(1, 1, 1));
    mesh.count = 0; mesh.name = 'adaptive domestic fittings'; mesh.frustumCulled = false; mesh.castShadow = true;
    this.held = mesh.instanceMatrix.array.byteLength + mesh.instanceColor!.array.byteLength + Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0);
    await this.stage.prepare(mesh, { everyCaster: true });
    if (this.disposed) { freeMesh(mesh); return; }
    this.mesh = mesh; this.group.add(mesh);
  }
  bytes(): number { return this.held + this.homes.length * 4096; }
  shed(): void { this.bay = ''; this.homes = []; this.selected = null; this.override = null; }
  dispose(): void { this.disposed = true; if (this.mesh) freeMesh(this.mesh); this.group.removeFromParent(); this.shed(); }
  choose(mode: HomeMode | null): void { this.override = mode; }
  get intent(): { seed: number; mode: HomeMode } | null {
    return this.override && this.selected?.floor === 0 ? { seed: this.selected.home.house.seed, mode: this.override } : null;
  }

  update(eye: Vec3, clock: number, dt: number, below: boolean): RoomState | null {
    const mesh = this.mesh;
    this.bodies.length = 0;
    if (!mesh) return null;
    if (mesh.count) dropUploaded(mesh, this.stage.renderer);
    mesh.count = 0;
    if (!below) { this.shed(); return null; }
    const h = this.terrain.habitat, u = underOf(h), at = fromWorld(h.profile, ...eye), cell = u.bayAt(at.theta, at.s);
    if (!cell) return null;
    const hr = h.params.landmarks?.handrail ?? 1, key = `${cell.i}/${cell.j}`;
    if (key !== this.bay) {
      const old = new Map(this.homes.map((x) => [x.house.seed, x]));
      this.homes = [];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const i = (cell.i + di + u.around) % u.around, j = cell.j + dj;
        if (j < 0 || j >= u.along || u.useAt(i, j) !== 'home') continue;
        for (const house of underHousesIn(this.terrain, i, j).houses) {
          if (this.homes.length >= 32) break;
          const modes = Array.from({ length: house.storeys }, (_, k) => homeUseAt(house, clock, h.params.life.pause, k));
          this.homes.push(old.get(house.seed) ?? { house, frame: bayFrame(u, i, j), modes, fittings: modes.map((m, k) => homeFittings(house, hr, k, m)) });
        }
      }
      this.bay = key;
    }
    const current = this.homes.find((home) => {
      const [x, y] = inFloorFrame(h, home.frame, at.theta, at.s), r = homePlan(home.house, hr).room;
      return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && at.h >= home.house.base && at.h < home.house.base + home.house.storeys * home.house.storey;
    });
    const floor = current ? Math.min(current.house.storeys - 1, Math.max(0, Math.floor((at.h - EYE_HEIGHT - current.house.base + hr * 0.05) / current.house.storey))) : 0;
    if (this.selected?.home !== current || this.selected?.floor !== floor) this.override = null;
    this.selected = current ? { home: current, floor } : null;
    const matrix = new Matrix4(), rotation = new Quaternion(), colour = new Color();
    for (const home of this.homes) for (let k = 0; k < home.house.storeys; k++) {
      const mode = home === current && k === floor && this.override ? this.override : homeUseAt(home.house, clock, h.params.life.pause, k);
      home.modes[k] = mode;
      const target = homeFittings(home === current && this.override ? { ...home.house, lived: true } : home.house, hr, k, mode), fitting = home.fittings[k], blend = 1 - Math.exp(-Math.min(dt, 0.1) * 2);
      const [px, py] = inFloorFrame(h, home.frame, at.theta, at.s);
      for (let n = 0; n < fitting.length; n++) {
        const f = fitting[n], to = target[n];
        // Leave a person's occupied floor clear; never raise a surface through the player.
        if (home === current && k === floor && Math.abs(px - to.centre[0]) < to.size[0] / 2 + hr * 0.45 && Math.abs(py - to.centre[1]) < to.size[1] / 2 + hr * 0.45) {
          to.size[2] = 0.002; to.centre[2] = home.house.base + k * home.house.storey;
        }
        for (let a = 0; a < 3; a++) { f.centre[a] += (to.centre[a] - f.centre[a]) * blend; f.size[a] += (to.size[a] - f.size[a]) * blend; }
        if (f.size[2] < 0.008 || mesh.count >= CAPACITY) continue;
        const p = floorAt(h, home.frame, f.centre[0], f.centre[1]), place = placeAt(h, p.theta, p.s, f.centre[2]);
        matrix.makeBasis(new Vector3(...place.ex), new Vector3(...place.ey), new Vector3(...place.ez));
        rotation.setFromRotationMatrix(matrix);
        matrix.scale(new Vector3(...f.size)).setPosition(...place.at.map((v, a) => v - eye[a]) as Vec3);
        mesh.setMatrixAt(mesh.count, matrix); mesh.setColorAt(mesh.count++, colour.setRGB(...f.colour));
        if (home === current && k === floor) this.bodies.push({ centre: place.at, size: [...f.size], rotation: rotation.toArray() });
      }
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, Math.max(1, mesh.count) * 16);
    mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, Math.max(1, mesh.count) * 3);
    return current ? { mode: current.modes[floor], automatic: !this.override, floor, lived: current.house.lived } : null;
  }
}
