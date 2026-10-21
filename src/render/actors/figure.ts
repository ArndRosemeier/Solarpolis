/**
 * Ported from Dunfinity src/render/actors/figure.ts, turned to stand on a curved floor: a figure is placed by its feet,
 * its up (toward the axis) and the way it faces, not by a yaw about +Y.
 *
 * A drawn person or humanoid of Actors: its Character (body, skin, hair, clothes, face) and the game's animator.
 */
import { Group, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three/webgpu';
import { nodeMaterials } from '@actors/three/webgpu';
import type { CharacterPatch } from '@actors/generator';
import type { Vec3 } from '../../blueprint';
import { Character, HUMAN_PACK, packFetch } from './pack';
import { FigureAnimator, type AnimState } from './animator';

export type { AnimState, MoveState, Mood } from './animator';

/** One frame of a figure: its feet relative to the eye, its up and front (unit, world axes), speed (m/s), what it does. */
export interface FigureFrame {
  feet: Vec3;
  up: Vec3;
  front: Vec3;
  speed: number;
  anim: AnimState;
}

/**
 * Actors layers clothes over skin with a depth bias toward the camera (negative polygon offset). The renderer uses a
 * reversed depth buffer (larger is nearer), and three r186 reverses the depth test for it but not the bias, so the
 * bias would push the clothes behind the skin. Turn it round on every biased material, before anything compiles.
 * (The Stage in @futuremagic/stage is the better home for this, for every material; until then it is done here.)
 */
function reverseDepthBias(root: Object3D): void {
  const done = new Set<Material>();
  root.traverse((o) => {
    const m = (o as Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (!mat.polygonOffset || done.has(mat)) continue;
      done.add(mat);
      mat.polygonOffsetFactor = -mat.polygonOffsetFactor;
      mat.polygonOffsetUnits = -mat.polygonOffsetUnits;
    }
  });
}

export class Figure {
  /** The scene object: at the feet, standing along up, facing front. */
  readonly object = new Group();
  readonly animator: FigureAnimator;
  private readonly basis = new Matrix4();
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()] as const;

  private constructor(readonly character: Character) {
    this.object.name = 'actors-figure';
    this.object.add(character.object);
    this.animator = new FigureAnimator(character);
  }

  /** Builds a figure with a look (missing fields: Actors' defaults) and loads its clips. */
  static async load(look: CharacterPatch): Promise<Figure> {
    const character = await Character.load({
      pack: HUMAN_PACK,
      renderer: null,
      materials: nodeMaterials,
      clipLibraries: false,
      fetcher: packFetch,
      config: { anatomy: false, ...look, animation: null },
    });
    reverseDepthBias(character.object);
    const figure = new Figure(character);
    await figure.animator.load();
    return figure;
  }

  /** Standing height, metres. */
  get height(): number {
    return this.character.height;
  }

  /** Bytes of the figure's geometry (memory watchdog). */
  bytes(): number {
    let n = 0;
    this.object.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (!g) return;
      for (const a of Object.values(g.attributes)) n += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
      if (g.index) n += (g.index.array as ArrayLike<number> & { byteLength: number }).byteLength;
    });
    return n;
  }

  /** Pose for this frame. Actors' bodies stand along +Y and face +Z. */
  update(f: FigureFrame, dt: number, time: number): void {
    const [ux, uy, uz] = f.up, [fx, fy, fz] = f.front;
    // x = up × front, so (x, up, front) is right-handed like (X, Y, Z).
    const [X, Y, Z] = this.axes;
    this.basis.makeBasis(X.set(uy * fz - uz * fy, uz * fx - ux * fz, ux * fy - uy * fx), Y.set(ux, uy, uz), Z.set(fx, fy, fz));
    this.object.quaternion.setFromRotationMatrix(this.basis);
    this.object.position.set(f.feet[0], f.feet[1], f.feet[2]);
    this.animator.update({ anim: f.anim, speed: f.speed, time }, dt);
    this.character.update(dt);
  }

  dispose(): void {
    this.animator.stop();
    this.character.dispose();
    this.object.removeFromParent();
  }
}
