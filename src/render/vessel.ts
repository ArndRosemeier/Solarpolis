/** One recipe, one physical exterior and a bounded set of connected rooms. Shares the existing ship,
 * geometry, material registry and Stage seams; owns no habitat-interior sources. */
import { CanvasTexture, Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, SphereGeometry, type Texture } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Stage } from '@futuremagic/stage';
import type { Vec3 } from '@futuremagic/core';
import type { Mat3 } from '../space/pose';
import { Shape } from '../gen/shapes';
import { type VesselBox, type VesselPlan } from '../space/vessel';
import { SHIP_CABIN, SHIP_SCREEN, SHIP_HULL, SHIP_SIGN } from './materials';
import { arraysGeometry, dropUploaded, freeMesh, setPose } from './geometry';
import { ShipMeshes, shipAxisShape } from './ship';
import { vesselLight, vesselSigns } from './vesselShaders';
import { vesselDetails } from './vesselDetails';
import { filtered } from './textures';

export class VesselMeshes {
  readonly hull: ShipMeshes;
  private root = new Group();
  private roomMeshes: Mesh[] = [];
  private furniture!: InstancedMesh;
  private drones!: InstancedMesh;
  private platform!: Mesh;
  private base: VesselBox[];
  fittings: VesselBox[] = [];
  private fold = 0;
  private targetFold = 0;
  private matrix = new Matrix4();
  private colour = new Color();
  private held = 0;
  private signs: Texture | null = null;
  ready = false;

  constructor(readonly plan: VesselPlan, private stage: Stage) {
    this.hull = new ShipMeshes({ ...plan.shape, parts: plan.shape.parts.filter(p => p.role !== 'radiator') }, plan.recipe.name, SHIP_HULL.material);
    this.base = plan.decks.flatMap(d => [...d.walls, ...d.furnishings]);
    this.root.matrixAutoUpdate = false;
  }
  async start(): Promise<void> {
    const plan = this.plan, r = plan.radius, shaft = plan.recipe.shaft;
    const shell = new Shape(96, true), displays = new Shape(96, false, true), trim = new Shape(96, true);
    const signs = new Shape(4, false, true), atlas = document.createElement('canvas'); atlas.width = atlas.height = 1024;
    const ink = atlas.getContext('2d')!; ink.fillStyle = '#173d37'; ink.fillRect(0, 0, 1024, 1024);
    ink.textAlign = 'center'; ink.textBaseline = 'middle';
    for (const d of plan.decks) {
      ink.fillStyle = '#f0e1b9'; ink.font = '500 30px sans-serif'; ink.fillText(`${String(d.index + 1).padStart(2, '0')}   /   ${d.recipe.name.toUpperCase()}`, 512, d.index * 64 + 23);
      ink.fillStyle = '#a4c6b8'; ink.font = '16px sans-serif'; ink.fillText('CENTRAL LIFT  ←     ·     BOW ABOVE / ENGINE BELOW', 512, d.index * 64 + 49);
      for (const side of [-1, 1]) {
        const z0 = -r * .55, z1 = -r * .19, y = side * 2.13, bottom = d.floor + 2.48, top = d.floor + 2.94, first = signs.vertices;
        signs.faceToward([y, z0, bottom], [y, z1, bottom], [y, z1, top], [y, z0, top], [-side, 0, 0]);
        for (let k = first; k < signs.vertices; k++) { signs.uv[k * 2] = side > 0 ? (z1 - signs.pos[k * 3 + 1]) / (z1 - z0) : (signs.pos[k * 3 + 1] - z0) / (z1 - z0); signs.uv[k * 2 + 1] = 1 - (d.index * 64 + (top - signs.pos[k * 3 + 2]) / (top - bottom) * 64) / 1024; }
      }
      // Each deck is a real slab with a central opening. Its underside is the deck below's ceiling.
      shell.band(d.floor, r, d.floor, shaft, 1, 0, plan.recipe.palette.floor);
      shell.band(d.floor - .2, shaft, d.floor - .2, r, -1, 0, plan.recipe.palette.shell);
      shell.band(d.floor - .2, shaft, d.floor, shaft, 0, -1, plan.recipe.palette.accent);
      // The inner pressure hull is screen-lined; dark reveals and physical coves make it legible as a surface.
      const base = displays.uv.length;
      displays.band(d.ceiling - .38, r - .025, d.floor + .32, r - .025, 0, -1);
      for (let k = base + 1; k < displays.uv.length; k += 2) displays.uv[k] -= d.floor;
      for (const wall of d.walls) {
        if (wall.half[1] > .2) continue;
        for (const side of [-1, 1]) {
          const y = wall.center[1] + side * (wall.half[1] + .012), z0 = wall.center[2] - wall.half[2] + .12, z1 = wall.center[2] + wall.half[2] - .12;
          const first = displays.uv.length;
          displays.faceToward([y, z0, d.floor + .75], [y, z1, d.floor + .75], [y, z1, d.ceiling - .55], [y, z0, d.ceiling - .55], [side, 0, 0]);
          for (let k = first + 1; k < displays.uv.length; k += 2) displays.uv[k] -= d.floor;
        }
      }
      for (const [lo, hi] of [[d.floor, d.floor + .32], [d.ceiling - .38, d.ceiling]])
        shell.band(hi, r, lo, r, 0, -1, plan.recipe.palette.shell);
      for (const x of [d.floor + .22, d.ceiling - .28]) trim.band(x + .035, r - .07, x, r - .07, 0, -1, [.92, .81, .60]);
      // Handholds stay against walls, never across a doorway or the free circulation route.
      trim.band(d.floor + 1.08, r - .12, d.floor + 1.02, r - .12, 0, -1, [.43, .32, .17]);
      for (const wall of d.walls) if (wall.half[1] < .2)
        trim.box([wall.center[1] - Math.sign(wall.center[1]) * .15, wall.center[2], d.floor + 1.05], [.035, Math.max(.1, wall.half[2] - .15), .035], [.43, .32, .17]);
      for (const side of [-1, 1]) for (const fore of [-1, 1]) {
        trim.box([side * 1.62, fore * r * .48, d.floor + .012], [.014, r * .25, .008], [.44, .50, .37]);
      }
      // The lift's guide columns are continuous, its threshold rim is softly illuminated.
      trim.band(d.floor + .025, shaft + .07, d.floor + .025, shaft, 1, 0, [.36, .69, .62]);
    }
    shell.band(plan.end - .22, shaft, plan.end - .22, r, -1, 0, plan.recipe.palette.shell);
    for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4])
      trim.box([Math.cos(angle) * (shaft + .05), Math.sin(angle) * (shaft + .05), (plan.start + plan.end) / 2], [.045, .045, (plan.end - plan.start) / 2], [.31, .39, .36]);
    for (const [shape, screen] of [[shell, false], [trim, false], [displays, true]] as const) {
      shipAxisShape(shape);
      const mesh = new Mesh(arraysGeometry(shape.arrays(), screen ? { uv: [new Float32Array(shape.uv), 2] } : {}), screen ? SHIP_SCREEN.material : SHIP_CABIN.material);
      if (screen) mesh.geometry.deleteAttribute('normal');
      mesh.name = screen ? 'ship wall displays' : 'ship deck structure'; this.root.add(mesh); this.roomMeshes.push(mesh);
    }
    const details = new Mesh(arraysGeometry(vesselDetails(plan).arrays()), SHIP_HULL.material);
    details.name = 'recipe ship exterior modules'; this.root.add(details); this.roomMeshes.push(details);
    shipAxisShape(signs);
    this.signs = filtered(new CanvasTexture(atlas), { srgb: true }); vesselSigns.value.dispose(); vesselSigns.value = this.signs;
    const labels = new Mesh(arraysGeometry(signs.arrays(), { uv: [new Float32Array(signs.uv), 2] }), SHIP_SIGN.material);
    labels.geometry.deleteAttribute('normal');
    labels.name = 'ship deck directions'; this.root.add(labels); this.roomMeshes.push(labels);
    const box = new RoundedBoxGeometry(1, 1, 1, 3, .1); box.deleteAttribute('uv');
    box.setAttribute('color', new Float32BufferAttribute(new Float32Array(box.getAttribute('position').count * 3).fill(1), 3));
    this.furniture = new InstancedMesh(box, SHIP_CABIN.material, this.base.length);
    this.furniture.frustumCulled = false; this.furniture.name = 'ship adaptive furnishings';
    this.root.add(this.furniture); this.roomMeshes.push(this.furniture);
    const sphere = new SphereGeometry(1, 24, 16); sphere.deleteAttribute('uv');
    sphere.setAttribute('color', new Float32BufferAttribute(new Float32Array(sphere.getAttribute('position').count * 3).fill(1), 3));
    this.drones = new InstancedMesh(sphere, SHIP_CABIN.material, plan.decks.length * 5);
    this.drones.frustumCulled = false; this.drones.name = 'ship companion drones'; this.root.add(this.drones); this.roomMeshes.push(this.drones);
    const platform = new Shape(64, true); platform.band(-.1, 0, -.1, shaft - .1, -1, 0, plan.recipe.palette.floor); platform.band(0, shaft - .1, 0, 0, 1, 0, plan.recipe.palette.floor);
    platform.band(-.1, shaft - .1, 0, shaft - .1, 0, 1, plan.recipe.palette.accent); shipAxisShape(platform);
    this.platform = new Mesh(arraysGeometry(platform.arrays()), SHIP_CABIN.material); this.platform.name = 'ship central lift'; this.root.add(this.platform); this.roomMeshes.push(this.platform);
    this.updateRooms(0, 0, plan.start, [plan.start + 1.65, 0, -2.4]);
    await this.hull.addTo(this.stage);
    // Prepare the coloured instance layouts explicitly before the parent group becomes drawable.
    await this.stage.prepare(this.furniture);
    await this.stage.prepare(this.drones);
    await this.stage.add(this.root);
    this.root.visible = false;
    this.held = [...this.roomMeshes, ...this.hull.meshes].reduce((n, m) => n + Object.values(m.geometry.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (m.geometry.index?.array.byteLength ?? 0), 0) + this.base.length * 256 + 1024 * 1024 * 4 * 4 / 3;
    this.ready = true;
  }
  setOpenFloor(on: boolean): void { this.targetFold = on ? 1 : 0; }
  updateRooms(dt: number, clock: number, lift: number, eye: Vec3): void {
    const old = this.fold, next = this.fold + (this.targetFold - this.fold) * (1 - Math.exp(-dt * 2));
    // Leave a generous occupied area untouched while the room changes.
    if (!this.base.some(b => b.adaptive && Math.abs(eye[0] - b.center[0]) < 2 && Math.hypot(eye[1] - b.center[1], eye[2] - b.center[2]) < Math.max(b.half[1], b.half[2]) + .8)) this.fold = next;
    if (!this.fittings.length || Math.abs(old - this.fold) > 1e-5) {
      this.fittings = this.base.map(b => {
        const floor = this.plan.decks[Math.max(0, Math.floor((b.center[0] - this.plan.start) / this.plan.recipe.deckHeight))].floor;
        const scale = b.adaptive ? 1 - this.fold * .985 : 1;
        return { ...b, center: [floor + (b.center[0] - floor) * scale, b.center[1], b.center[2]], half: [b.half[0] * scale, b.half[1], b.half[2]] };
      });
      this.fittings.forEach((b, i) => {
        this.matrix.makeScale(...b.half.map(n => n * 2) as Vec3).setPosition(...b.center);
        this.furniture.setMatrixAt(i, this.matrix); this.furniture.setColorAt(i, this.colour.setRGB(...b.colour));
      });
      this.furniture.instanceMatrix.needsUpdate = true; if (this.furniture.instanceColor) this.furniture.instanceColor.needsUpdate = true;
    }
    this.platform.position.x = lift;
    let i = 0;
    for (const deck of this.plan.decks) {
      const x = deck.floor + 1.75 + Math.sin(clock * .4 + deck.index) * .12, y = -this.plan.radius * .72, z = Math.sin(clock * .1 + deck.index) * .6;
      for (const [offset, size, rgb] of [
        [[0, 0, 0], [.19, .33, .28], [.67, .72, .69]], [[.04, .30, 0], [.055, .035, .11], [.08, .44, .43]],
        [[-.1, 0, -.32], [.08, .12, .09], [.20, .24, .23]], [[-.1, 0, .32], [.08, .12, .09], [.20, .24, .23]],
        [[.16, .13, 0], [.025, .06, .07], [.95, .61, .28]],
      ] as [Vec3, Vec3, Vec3][]) {
        this.matrix.makeScale(...size).setPosition(x + offset[0], y + offset[1], z + offset[2]);
        this.drones.setMatrixAt(i, this.matrix); this.drones.setColorAt(i++, this.colour.setRGB(...rgb));
      }
    }
    this.drones.instanceMatrix.needsUpdate = true; if (this.drones.instanceColor) this.drones.instanceColor.needsUpdate = true;
    vesselLight.clock.value = clock;
    vesselLight.radius.value = this.plan.radius;
  }
  pose(axes: Mat3, at: Vec3, throttle: number): void {
    this.hull.pose(axes, at, throttle); this.root.visible = true;
    // The habitat's shared pose helper accepts Mesh; Group carries the same transform fields.
    setPose(this.root as unknown as Mesh, axes, at);
    vesselLight.up.value.set(axes[0], axes[3], axes[6]);
    for (const mesh of [...this.roomMeshes, ...this.hull.meshes]) dropUploaded(mesh, this.stage.renderer);
  }
  hide(): void { this.hull.hide(); this.root.visible = false; }
  bytes(): number { return this.held; }
  dispose(): void { this.hull.removeFrom(this.stage); this.roomMeshes.forEach(m => freeMesh(m)); this.signs?.dispose(); this.root.removeFromParent(); }
}
