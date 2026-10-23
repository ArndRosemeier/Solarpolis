/** Small shared meshes for activities: one ball per pair, tools held by the animated hand, timber to work on.
 * Props stay in the same view as their people, independent of the figure/stand-in handover. */
import { Float32BufferAttribute, Group, InstancedMesh, Matrix4, SphereGeometry, Vector3 } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import type { Vec3 } from '../blueprint';
import { Shape } from '../gen/shapes';
import { personKey, type Person } from '../sim';
import { tossAt } from '../sim/props';
import { arraysGeometry, dropUploaded, freeMesh } from './geometry';
import { PROP } from './materials';
import type { Figure, AnimState } from './actors/figure';
import { CMU } from './actors/animator';

export interface PropPerson { person: Person; feet: Vec3; up: Vec3; front: Vec3; height: number; figure: Figure | null; anim: AnimState }
type Kind = 'ball' | 'saw' | 'axe' | 'bench' | 'block';
const KINDS: Kind[] = ['ball', 'saw', 'axe', 'bench', 'block'];
const CAPACITY = 128;
const WOOD: Vec3 = [0.32, 0.14, 0.045], METAL: Vec3 = [0.5, 0.58, 0.62];

function geometryOf(kind: Kind) {
  if (kind === 'ball') {
    const g = new SphereGeometry(0.11, 16, 10).deleteAttribute('uv'), p = g.getAttribute('position'), colors = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) colors.set(Math.abs(p.getY(k)) < 0.025 ? [0.06, 0.2, 0.45] : [0.95, 0.32, 0.035], k * 3);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g;
  }
  const s = new Shape(10, true);
  if (kind === 'saw') {
    // Grip at the origin, blade along the palm's local Y; a rounded wooden handle and toothed steel blade.
    s.box([0, 0, 0], [0.055, 0.09, 0.025], WOOD);
    s.box([0, 0.3, 0], [0.065, 0.22, 0.006], METAL);
    for (let k = 0; k < 18; k++) s.box([0.068, 0.1 + k * 0.023, 0], [0.009, 0.007, 0.006], METAL);
  } else if (kind === 'axe') {
    s.box([0, 0.22, 0], [0.022, 0.32, 0.025], WOOD);
    s.box([0.045, 0.51, 0], [0.1, 0.065, 0.024], METAL);
  } else if (kind === 'bench') {
    for (const x of [-0.5, 0.5]) for (const z of [-0.22, 0.22]) s.box([x, 0.33, z], [0.045, 0.33, 0.045], WOOD);
    s.box([0, 0.69, 0], [0.65, 0.035, 0.3], WOOD);
    s.box([0, 0.77, 0], [0.47, 0.045, 0.07], [0.62, 0.4, 0.19]);
  } else {
    s.box([0, 0.2, 0], [0.25, 0.2, 0.25], WOOD);
    s.box([0, 0.49, 0], [0.075, 0.09, 0.08], [0.62, 0.4, 0.19]);
  }
  return arraysGeometry(s.arrays());
}

export class ActivityProps {
  readonly group = new Group();
  private readonly meshes = new Map<Kind, InstancedMesh>();
  private readonly replacements = new Map<Kind, InstancedMesh>();
  private readonly growing = new Set<Kind>();
  private disposed = false;
  private ready = false;
  private held = 0;
  constructor(private readonly stage: Stage, private readonly scale: number) { void this.prepare(); }
  private make(kind: Kind, capacity: number): InstancedMesh {
    const geometry = geometryOf(kind), mesh = new InstancedMesh(geometry, PROP.material, capacity);
    mesh.name = `activity ${kind}`; mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = true;
    let bytes = mesh.instanceMatrix.array.byteLength;
    for (const a of Object.values(geometry.attributes)) bytes += a.array.byteLength;
    bytes += geometry.index?.array.byteLength ?? 0;
    mesh.userData.propBytes = bytes;
    this.held += bytes;
    return mesh;
  }
  private async prepare(): Promise<void> {
    for (const kind of KINDS) {
      const mesh = this.make(kind, CAPACITY);
      await this.stage.prepare(mesh, { everyCaster: true });
      if (this.disposed) { freeMesh(mesh); return; }
      this.meshes.set(kind, mesh); this.group.add(mesh);
    }
    this.ready = true;
  }
  bytes(): number { return this.held; }
  dispose(): void {
    this.disposed = true;
    for (const m of [...this.meshes.values(), ...this.replacements.values()]) freeMesh(m);
    this.meshes.clear(); this.replacements.clear(); this.group.removeFromParent();
  }

  update(people: readonly PropPerson[], eye: Vec3): void {
    if (!this.ready) return;
    // A larger instance buffer needs its own warmed bindings. Keep drawing the old pool until this frame.
    for (const [kind, mesh] of this.replacements) {
      const old = this.meshes.get(kind)!;
      this.held -= old.userData.propBytes;
      freeMesh(old); this.meshes.set(kind, mesh); this.group.add(mesh);
    }
    this.replacements.clear();
    for (const mesh of this.meshes.values()) { if (mesh.count) dropUploaded(mesh, this.stage.renderer); mesh.count = 0; }
    const byKey = new Map(people.map((p) => [personKey(p.person), p]));
    for (const one of people) {
      const p = one.person;
      if (p.act === 'catch' && p.member % 2 === 0 && p.member + 1 < p.size) {
        const other = byKey.get(personKey({ ...p, outing: p.outing + 1 }));
        if (!other || other.person.act !== 'catch') continue;
        const phase = tossAt(p.since), from = phase.thrower ? other : one, to = phase.thrower ? one : other;
        const a = this.hand(from, eye), b = this.hand(to, eye), k = p.moving || other.person.moving ? 0 : phase.flight;
        const pos = new Vector3().setFromMatrixPosition(a).lerp(new Vector3().setFromMatrixPosition(b), k);
        const up = new Vector3(...one.up).add(new Vector3(...other.up)).normalize();
        pos.addScaledVector(up, 4 * k * (1 - k) * this.scale * 0.85);
        this.put('ball', new Matrix4().makeTranslation(pos.x, pos.y, pos.z));
      }
      if (p.act === 'work' && !p.moving && p.posture === 0) {
        const saw = one.anim.pose?.clip === CMU.saw.clip;
        this.put(saw ? 'saw' : 'axe', this.hand(one, eye));
        const right = new Vector3(...one.up).cross(new Vector3(...one.front));
        const frame = new Matrix4().makeBasis(right, new Vector3(...one.up), new Vector3(...one.front));
        frame.setPosition(...one.feet.map((v, k) => v - eye[k] + one.front[k] * this.scale * 0.6) as Vec3);
        this.put(saw ? 'bench' : 'block', frame);
      }
    }
    for (const mesh of this.meshes.values()) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, Math.max(1, mesh.count) * 16); }
  }
  private put(kind: Kind, matrix: Matrix4): void {
    const mesh = this.meshes.get(kind)!;
    if (mesh.count >= mesh.instanceMatrix.count) {
      if (!this.growing.has(kind)) void this.enlarge(kind, mesh.instanceMatrix.count * 2);
      return;
    }
    mesh.setMatrixAt(mesh.count++, matrix.scale(new Vector3(this.scale, this.scale, this.scale)));
  }
  private async enlarge(kind: Kind, capacity: number): Promise<void> {
    this.growing.add(kind);
    const mesh = this.make(kind, capacity);
    await this.stage.prepare(mesh, { everyCaster: true });
    if (this.disposed) freeMesh(mesh);
    else this.replacements.set(kind, mesh);
    this.growing.delete(kind);
  }
  private hand(one: PropPerson, eye: Vec3): Matrix4 {
    const f = one.figure, bone = f?.character.actor.bones.find((b) => b.name === 'hand_r');
    if (bone) {
      f!.object.updateWorldMatrix(true, true);
      const m = new Matrix4().extractRotation(bone.matrixWorld);
      return m.setPosition(new Vector3().setFromMatrixPosition(bone.matrixWorld));
    }
    const right = new Vector3(...one.up).cross(new Vector3(...one.front));
    const m = new Matrix4().makeBasis(right, new Vector3(...one.front), new Vector3(...one.up).negate());
    return m.setPosition(...one.feet.map((v, k) => v - eye[k] + one.up[k] * one.height * 0.68 + one.front[k] * this.scale * 0.25 + right.getComponent(k) * this.scale * 0.2) as Vec3);
  }
}
