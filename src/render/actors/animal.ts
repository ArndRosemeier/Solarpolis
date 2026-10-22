/**
 * A drawn animal of Actors (render/animals.ts): its pack's body in its look's shape, the coat baked for its look
 * (gen/coat.ts) on the game's fur material, posed every frame from the simulation. Actors' animal packs share one
 * quadruped rig and its clips; an animal stands on the curved floor by its feet, its up (toward the axis) and the way
 * it faces, as a person's figure does (figure.ts).
 */
import { Group, BufferAttribute, type Mesh, type SkinnedMesh } from 'three/webgpu';
import { Animal } from '@actors/animal';
import { ThreeActor, type ActorMaterialKit, type PlayableClip } from '@actors/three';
import { nodeMaterials } from '@actors/three/webgpu';
import { paramsOf, type Look } from '../../gen/coat';
import { animalEyeMaterial, furMaterial } from '../materials';
import { freeMesh } from '../geometry';
import { packFetch } from './pack';
import { castAsWorn, standAt, type Stance } from './figure';
import AnimalWorker from '@actors/animal/worker?worker';

/** An animal pack's manifest, by its name (`squirrel`, …): served and built under /actors/ with the humans' (pack.ts). */
export const animalPack = (name: string): string => `${import.meta.env?.BASE_URL ?? '/'}actors/${name}/manifest.json`;

/** Fur (spotted where the look has spots) and animal eyes from the game's materials, everything else as Actors' WebGPU kit makes it. */
const kitFor = (spotted: boolean): ActorMaterialKit => ({
  ...nodeMaterials,
  mesh: (data, actor) => {
    const { kind } = data.def.material;
    if (kind === 'fur') return furMaterial(spotted);
    if (kind === 'eye' && data.def.tags?.includes('animal')) return animalEyeMaterial();
    return nodeMaterials.mesh(data, actor);
  },
});
const kits = [kitFor(false), kitFor(true)];

/**
 * One pack, loaded once: its runtime and shape worker, shared by every animal drawn from it. (Actors' shape worker
 * holds one pack at a time, so each pack has its own.)
 */
export class AnimalPack {
  private constructor(readonly kind: string, readonly base: Animal, private readonly worker: Worker) {}

  static async load(name: string): Promise<AnimalPack> {
    const base = await Animal.load(animalPack(name), packFetch), worker = new AnimalWorker();
    await base.useWorker(worker);
    return new AnimalPack(base.extra.kind, base, worker);
  }

  /** A clip of the pack (Actors loads each once a runtime). */
  clip(name: string): Promise<PlayableClip> {
    return this.base.runtime.loadClip(name);
  }

  /** Stop its shape worker. */
  dispose(): void {
    this.worker.terminate();
  }

  /** How long a clip of the pack runs (s). */
  duration(name: string): number {
    const c = this.base.runtime.manifest.clips?.find((x) => x.name === name);
    return c ? Math.max(1, c.frameCount - 1) / c.fps : 1;
  }
}

/** What an animal does this frame: its clip, where in it (s), and how it stands. */
export interface AnimalFrame extends Stance {
  clip: string;
  time: number;
}

export class AnimalFigure {
  /** The scene object: at the feet, standing along up, facing front. */
  readonly object = new Group();
  private playing = '';
  private wanted = '';
  private ready = false;

  private constructor(readonly actor: ThreeActor, private readonly pack: AnimalPack) {
    this.object.name = `animal ${pack.kind}`;
    this.object.add(actor.object);
  }

  /** An animal in a look (its preset, `size` × the preset's), its coat baked (`look.coat`, on the pack's fur mesh `fur`). */
  static async load(pack: AnimalPack, look: Look, fur: string, size: number): Promise<AnimalFigure> {
    const animal = Animal.share(pack.base);
    animal.params = paramsOf(pack.kind, look.preset) as typeof animal.params;
    animal.shape.size *= size;
    const shape = await animal.evaluate();
    const actor = new ThreeActor(animal.runtime, kits[look.dapple ? 1 : 0]);
    actor.applyShape(shape);
    actor.object.position.y = actor.groundOffset();
    for (const [name, mesh] of actor.meshes) {
      const n = mesh.geometry.getAttribute('position').count;
      if (name === fur) {
        mesh.geometry.setAttribute('coat', new BufferAttribute(look.coat, 4));
        if (look.dapple) mesh.geometry.setAttribute('dapple', new BufferAttribute(look.dapple, 4));
      } else {
        // Eyes (and anything else): the iris colour, which the eye material draws.
        const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) c.set([...look.iris, 1], i * 4);
        mesh.geometry.setAttribute('coat', new BufferAttribute(c, 4));
      }
    }
    const f = new AnimalFigure(actor, pack);
    castAsWorn(f.object);
    await f.play('idle', 0);
    return f;
  }

  /** The levels of detail drawn (Actors' levels that draw parts separately), finest first. */
  get levels(): number[] {
    return this.actor.lods.flatMap((l, i) => (l.merge ? [] : [i]));
  }

  /** Bytes of the figure's geometry (memory watchdog). */
  bytes(): number {
    let n = 0;
    for (const mesh of this.actor.meshes.values()) {
      for (const a of Object.values(mesh.geometry.attributes)) n += (a.array as unknown as { byteLength: number }).byteLength;
      for (const list of Object.values(mesh.geometry.morphAttributes)) for (const a of list) n += (a.array as unknown as { byteLength: number }).byteLength;
      if (mesh.geometry.index) n += (mesh.geometry.index.array as unknown as { byteLength: number }).byteLength;
    }
    return n;
  }

  /** Play a clip from a time (s); the clip loads first, the last asked for wins. */
  private async play(name: string, time: number): Promise<void> {
    this.wanted = name;
    const clip = await this.pack.clip(name);
    if (this.wanted !== name) return;
    this.actor.play(clip);
    this.playing = name;
    this.seek(time);
    this.ready = true;
  }

  private seek(time: number): void {
    const a = this.actor.currentAction;
    if (!a) return;
    const d = a.getClip().duration;
    a.time = d > 0 ? ((time % d) + d) % d : 0;
    this.actor.update(0);
  }

  /** Pose for this frame: where it stands, and its clip at the time the simulation says. */
  update(f: AnimalFrame): void {
    standAt(this.object, f);
    if (f.clip !== this.playing) { if (f.clip !== this.wanted) void this.play(f.clip, f.time); }
    else if (this.ready) this.seek(f.time);
  }

  /** Let go of its meshes and skeleton; the fur and eye materials are shared, and stay. */
  dispose(): void {
    this.actor.mixer.stopAllAction();
    this.actor.dispose();
    const meshes: Mesh[] = [];
    this.object.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    (meshes[0] as SkinnedMesh | undefined)?.skeleton?.dispose();
    for (const m of meshes) freeMesh(m);
    this.object.removeFromParent();
  }
}
