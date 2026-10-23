/**
 * The homes' adaptable furnishings: one bounded instance pool for every house whose rooms are drawn (the Understorey's
 * mid and near tiles, gen/underMesh.ts), shared geometry and continuous changes. Fixed room shells remain in the
 * streamed tiles; far tiles build no rooms, so a home's furniture is drawn exactly while its tile draws its rooms: it
 * comes and goes with them in the same frame (`update`'s `drawn`), never by distance alone (CLAUDE.md 16). Rounded
 * pieces in near tiles, plain boxes of the same size and colour in mid ones (their rounding is under a pixel there).
 */
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Stage } from '@futuremagic/stage';
import { fromWorld, toView, type Vec3 } from '../blueprint';
import type { TileKey } from '../gen/detailTree';
import type { Terrain } from '../gen/terrain';
import { underOf } from '../gen/under';
import { bayFrame, furnishedBays, underHousesIn, type UnderDetail } from '../gen/underMesh';
import { floorAt, inFloorFrame, placeAt, type FloorFrame } from '../gen/shapes';
import type { House } from '../gen/homes';
import { FURNITURE_CAPACITY, homeFittings, homePlan, homeUseAt, type Fitting, type HomeMode } from '../gen/homeInterior';
import type { FurnitureBody } from '../physics/world';
import { dropUploaded, freeMesh } from './geometry';
import { PROP } from './materials';
import { EYE_HEIGHT } from '../world/walker';

type Level = Exclude<UnderDetail, 'far'>;
/** One home's furniture: what each storey shows now, and where each piece stands (world, its turn, drawn or stowed). */
interface Home {
  house: House;
  frame: FloorFrame;
  level: Level;
  modes: HomeMode[];
  fittings: Fitting[][];
  /** Each storey's arrangement for its mode (`targetOf`), kept until the mode changes. */
  targets: { key: string; fittings: Fitting[] }[];
  /** Per piece: world centre, quaternion, whether it shows (a stowed piece is flat in the floor). */
  at: Float64Array;
  turn: Float32Array;
  shown: Uint8Array;
}
export interface RoomState { mode: HomeMode; automatic: boolean; floor: number; lived: boolean }

/** How close a moving piece must come to where it is going before it settles there (m). */
const SETTLE = 1e-4;
/** Below this height a piece is stowed in the floor and not drawn (m). */
const STOWED = 0.008;

/** Moves `now` a share `blend` of the way to `want`, settling once within `SETTLE`; whether it moved. */
function approach(now: Vec3, want: Vec3, blend: number): boolean {
  let moved = false;
  for (let a = 0; a < 3; a++) {
    const d = want[a] - now[a];
    if (d === 0) continue;
    now[a] = Math.abs(d) < SETTLE ? want[a] : now[a] + d * blend;
    moved = true;
  }
  return moved;
}

/** A storey's arrangement for a mode, kept on the home (the same pieces for every mode: `homeFittings`). */
function targetOf(home: Home, floor: number, mode: HomeMode, hr: number): Fitting[] {
  const kept = home.targets[floor];
  if (kept?.key === mode) return kept.fittings;
  const fittings = homeFittings(home.house, hr, floor, mode);
  home.targets[floor] = { key: mode, fittings };
  return fittings;
}

export class HomesView {
  readonly group = new Group();
  readonly bodies: FurnitureBody[] = [];
  private meshes: Record<Level, InstancedMesh> | null = null;
  private disposed = false;
  private homes: Home[] = [];
  private tiles = '';
  /** Where the instances are placed from (world): the eye when the homes were last laid out. */
  private origin: Vec3 = [0, 0, 0];
  private dirty = false;
  private selected: { home: Home; floor: number } | null = null;
  private override: HomeMode | null = null;
  private held = 0;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly colour = new Color();
  private readonly v = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  constructor(private readonly terrain: Terrain, private readonly stage: Stage) { void this.prepareFurniture(); }

  private async prepareFurniture(): Promise<void> {
    const shaped = (g: BufferGeometry): BufferGeometry => {
      g.deleteAttribute('uv');
      g.setAttribute('color', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
      return g;
    };
    const instanced = (g: BufferGeometry, level: Level): InstancedMesh => {
      const mesh = new InstancedMesh(shaped(g), PROP.material, FURNITURE_CAPACITY);
      mesh.setColorAt(0, new Color(1, 1, 1));
      mesh.count = 0; mesh.name = `adaptive domestic fittings (${level})`; mesh.frustumCulled = false; mesh.castShadow = true;
      return mesh;
    };
    const meshes = { near: instanced(new RoundedBoxGeometry(1, 1, 1, 2, 0.08), 'near'), mid: instanced(new BoxGeometry(1, 1, 1), 'mid') };
    for (const mesh of Object.values(meshes)) await this.stage.prepare(mesh, { everyCaster: true });
    if (this.disposed) { for (const mesh of Object.values(meshes)) freeMesh(mesh); return; }
    for (const mesh of Object.values(meshes)) this.group.add(mesh);
    this.held = Object.values(meshes).reduce((n, m) => n + m.instanceMatrix.array.byteLength + m.instanceColor!.array.byteLength, 0);
    this.meshes = meshes;
  }

  /** Debug line: the homes furnished (with their rooms, so no home is ever drawn without), the pieces drawn. */
  info(): string {
    const near = this.homes.filter((h) => h.level === 'near').length, m = this.meshes;
    return `home furniture: ${this.homes.length} homes (${near} near, ${this.homes.length - near} mid), ${m ? m.near.count + m.mid.count : 0} of ${2 * FURNITURE_CAPACITY} pieces drawn`;
  }
  bytes(): number { return this.held + this.homes.reduce((n, h) => n + h.at.byteLength + h.turn.byteLength + h.shown.byteLength + h.fittings.length * 5 * 9 * 8, 0); }
  shed(): void { this.tiles = ''; this.homes = []; this.selected = null; this.override = null; this.dirty = true; }
  dispose(): void { this.disposed = true; if (this.meshes) for (const mesh of Object.values(this.meshes)) freeMesh(mesh); this.group.removeFromParent(); this.shed(); }
  choose(mode: HomeMode | null): void { this.override = mode; }
  get intent(): { seed: number; mode: HomeMode } | null {
    return this.override && this.selected?.floor === 0 ? { seed: this.selected.home.house.seed, mode: this.override } : null;
  }

  /** Each frame, after the Understorey's tiles: `drawn` the tiles they draw (`TiledView.drawnKeys`). */
  update(eye: Vec3, clock: number, dt: number, below: boolean, drawn: readonly TileKey[]): RoomState | null {
    this.bodies.length = 0;
    const meshes = this.meshes;
    if (!meshes) return null;
    if (!below) {
      if (this.homes.length) this.shed();
      this.pack(meshes);
      return null;
    }
    const h = this.terrain.habitat, hr = h.params.landmarks?.handrail ?? 1, at = fromWorld(h.profile, ...eye);
    this.layOut(drawn, eye, clock, hr);
    const current = this.homes.find((home) => {
      const [x, y] = inFloorFrame(h, home.frame, at.theta, at.s), r = homePlan(home.house, hr).room;
      return x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && at.h >= home.house.base && at.h < home.house.base + home.house.storeys * home.house.storey;
    });
    const floor = current ? Math.min(current.house.storeys - 1, Math.max(0, Math.floor((at.h - EYE_HEIGHT - current.house.base + hr * 0.05) / current.house.storey))) : 0;
    if (this.selected?.home !== current || this.selected?.floor !== floor) this.override = null;
    this.selected = current ? { home: current, floor } : null;
    const blend = 1 - Math.exp(-Math.min(dt, 0.1) * 2);
    for (const home of this.homes) for (let k = 0; k < home.house.storeys; k++) {
      const here = home === current && k === floor, mode = here && this.override ? this.override : homeUseAt(home.house, clock, h.params.life.pause, k);
      home.modes[k] = mode;
      // The player's own floor is worked out afresh each frame (it clears round them); every other one is kept.
      const lived = home === current && !!this.override, target = here ? homeFittings(lived ? { ...home.house, lived } : home.house, hr, k, mode) : targetOf(home, k, mode, hr);
      const fitting = home.fittings[k], [px, py] = here ? inFloorFrame(h, home.frame, at.theta, at.s) : [0, 0];
      for (let n = 0; n < fitting.length; n++) {
        const f = fitting[n], to = target[n], piece = k * fitting.length + n;
        // Leave a person's occupied floor clear; never raise a surface through the player.
        if (here && Math.abs(px - to.centre[0]) < to.size[0] / 2 + hr * 0.45 && Math.abs(py - to.centre[1]) < to.size[1] / 2 + hr * 0.45) {
          to.size[2] = 0.002; to.centre[2] = home.house.base + k * home.house.storey;
        }
        const moved = approach(f.centre, to.centre, blend);
        if (approach(f.size, to.size, blend) || moved) { this.place(home, piece, f); this.dirty = true; }
        if (here && home.shown[piece]) this.bodies.push({ centre: [home.at[piece * 3], home.at[piece * 3 + 1], home.at[piece * 3 + 2]], size: [...f.size], rotation: [home.turn[piece * 4], home.turn[piece * 4 + 1], home.turn[piece * 4 + 2], home.turn[piece * 4 + 3]] });
      }
    }
    this.pack(meshes);
    for (const mesh of Object.values(meshes)) {
      mesh.position.set(...toView(eye, this.origin));
      if (mesh.count) dropUploaded(mesh, this.stage.renderer);
    }
    return current ? { mode: current.modes[floor], automatic: !this.override, floor, lived: current.house.lived } : null;
  }

  /** The homes whose rooms the drawn tiles build, each new one furnished as its household has it now. */
  private layOut(drawn: readonly TileKey[], eye: Vec3, clock: number, hr: number): void {
    let id = '';
    for (const k of drawn) if (k.level <= 1) id += `${k.level}:${k.i}:${k.j};`;
    if (id === this.tiles) return;
    this.tiles = id;
    const h = this.terrain.habitat, u = underOf(h), old = new Map(this.homes.map((x) => [x.house.seed, x]));
    this.homes = [];
    let pieces = 0;
    for (const { i, j, level } of furnishedBays(this.terrain, drawn).values()) {
      for (const house of underHousesIn(this.terrain, i, j).houses) {
        const kept = old.get(house.seed);
        const modes = kept?.modes ?? Array.from({ length: house.storeys }, (_, k) => homeUseAt(house, clock, h.params.life.pause, k));
        const fittings = kept?.fittings ?? modes.map((m, k) => homeFittings(house, hr, k, m)), count = fittings.reduce((n, fs) => n + fs.length, 0);
        if (pieces + count > FURNITURE_CAPACITY) continue;
        pieces += count;
        if (kept) { kept.level = level; this.homes.push(kept); continue; }
        const home: Home = {
          house, frame: bayFrame(u, i, j), level, modes, fittings, targets: [],
          at: new Float64Array(count * 3), turn: new Float32Array(count * 4), shown: new Uint8Array(count),
        };
        home.fittings.forEach((fs, k) => fs.forEach((f, n) => this.place(home, k * fs.length + n, f)));
        this.homes.push(home);
      }
    }
    this.origin = [...eye];
    this.dirty = true;
  }

  /** Where a piece stands in the world now, and whether it shows. */
  private place(home: Home, piece: number, f: Fitting): void {
    const h = this.terrain.habitat, p = floorAt(h, home.frame, f.centre[0], f.centre[1]), place = placeAt(h, p.theta, p.s, f.centre[2]);
    home.at.set(place.at, piece * 3);
    const [ex, ey, ez] = this.v;
    this.matrix.makeBasis(ex.set(...place.ex), ey.set(...place.ey), ez.set(...place.ez));
    this.rotation.setFromRotationMatrix(this.matrix);
    home.turn.set([this.rotation.x, this.rotation.y, this.rotation.z, this.rotation.w], piece * 4);
    home.shown[piece] = f.size[2] < STOWED ? 0 : 1;
  }

  /** The pieces that show into the two meshes, placed from `origin`, when anything moved or the homes changed. */
  private pack(meshes: Record<Level, InstancedMesh>): void {
    if (!this.dirty) return;
    this.dirty = false;
    meshes.mid.count = 0; meshes.near.count = 0;
    const [, , , scale] = this.v, o = this.origin;
    for (const home of this.homes) {
      const mesh = meshes[home.level];
      home.fittings.forEach((fs, k) => fs.forEach((f, n) => {
        const piece = k * fs.length + n;
        if (!home.shown[piece] || mesh.count >= FURNITURE_CAPACITY) return;
        this.rotation.set(home.turn[piece * 4], home.turn[piece * 4 + 1], home.turn[piece * 4 + 2], home.turn[piece * 4 + 3]);
        this.matrix.compose(this.v[0].set(home.at[piece * 3] - o[0], home.at[piece * 3 + 1] - o[1], home.at[piece * 3 + 2] - o[2]), this.rotation, scale.set(...f.size));
        mesh.setMatrixAt(mesh.count, this.matrix);
        mesh.setColorAt(mesh.count++, this.colour.setRGB(...f.colour));
      }));
    }
    for (const mesh of Object.values(meshes)) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, Math.max(1, mesh.count) * 16);
      mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, Math.max(1, mesh.count) * 3);
    }
  }
}
