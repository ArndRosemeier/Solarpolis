/**
 * Ported from Dunfinity src/render/actors/figure.ts, turned to stand on a curved floor: a figure is placed by its feet,
 * its up (toward the axis) and the way it faces, not by a yaw about +Y.
 *
 * A drawn person or humanoid of Actors: its Character (body, skin, hair, clothes, face) and the game's animator.
 */
import { DoubleSide, FrontSide, Group, Matrix4, Vector3, type Material, type Mesh, type Object3D, type WebGPURenderer } from 'three/webgpu';
import type { AllowOptions, CharacterCatalog, CharacterPatch } from '@actors/generator';
import type { Human } from '@actors/human';
import type { Vec3 } from '../../blueprint';
import { Character, HUMAN_PACK, actorKit, packFetch } from './pack';
import { FigureAnimator, type AnimState } from './animator';
import { screenTextures } from './screens';
import { geometryBytes } from '../geometry';

export type { AnimState, MoveState, Mood } from './animator';

/** Where something stands: its feet relative to the eye, its up and front (unit, world axes). */
export interface Stance {
  feet: Vec3;
  up: Vec3;
  front: Vec3;
}

/** One frame of a figure: where it stands, speed (m/s), what it does. */
export interface FigureFrame extends Stance {
  speed: number;
  anim: AnimState;
}

/** Eye height as a share of standing height, for a figure whose eyes cannot be measured (adults: about 93 %). */
const EYE_SHARE = 0.935;

const basis = new Matrix4(), axes = [new Vector3(), new Vector3(), new Vector3()] as const;

/**
 * Stand an Actors body (figures, animals) on the curved floor: its object at the feet, along up, facing front. Actors'
 * bodies stand along +Y and face +Z.
 */
export function standAt(object: Object3D, f: Stance): void {
  const [ux, uy, uz] = f.up, [fx, fy, fz] = f.front;
  // x = up × front, so (x, up, front) is right-handed like (X, Y, Z).
  const [X, Y, Z] = axes;
  basis.makeBasis(X.set(uy * fz - uz * fy, uz * fx - ux * fz, ux * fy - uy * fx), Y.set(ux, uy, uz), Z.set(fx, fy, fz));
  object.quaternion.setFromRotationMatrix(basis);
  object.position.set(f.feet[0], f.feet[1], f.feet[2]);
}

/**
 * Parts too small or too deep in the face to show in a shadow: teeth, tongue, eyes, lashes, brows. Each caster costs a
 * figure a shadow build of its own under the shader cap (docs/SHADERS.md), a fifth of a second before it can be drawn.
 */
const SHADOWLESS = /^(teeth|tongue|eyes|eyelashes|brows-.*)$/;

/**
 * Ready a figure for the near shadow map (docs/SHADERS.md): it takes shadows; the parts it wears cast (the pack's other
 * garments stay hidden; a change of clothes would prepare it again), but not the small parts of the face; a see-through
 * two-sided part is drawn in two passes, one shader each, so its shadow is cast from one side.
 */
export function castAsWorn(root: Object3D): void {
  root.traverse((o) => {
    o.receiveShadow = true;
    o.castShadow = o.visible && !SHADOWLESS.test(o.name);
    const m = (o as Mesh).material as Material | undefined;
    if (m && !Array.isArray(m) && m.transparent && m.side === DoubleSide) m.shadowSide = FrontSide;
  });
}

/** `Figure.load`'s options. */
export interface FigureOptions {
  share?: Human;
  allow?: AllowOptions;
  catalog?: (catalog: CharacterCatalog) => CharacterCatalog;
}

export class Figure {
  /** The scene object: at the feet, standing along up, facing front. */
  readonly object = new Group();
  readonly animator: FigureAnimator;

  private constructor(readonly character: Character) {
    this.object.name = 'actors-figure';
    this.object.add(character.object);
    this.animator = new FigureAnimator(character);
    // A new shape (the creator) has its eyes elsewhere: measured again.
    this.unshape = character.onShape(() => { this.eyes = undefined; });
  }
  private readonly unshape: () => void;

  /**
   * Builds a figure with a look (missing fields: Actors' defaults) and loads its clips. `renderer` is the one it is
   * drawn with (Actors lays its clothes over the skin by its reversed depth). `share`: an already loaded human (pack.ts
   * `humanCatalog`) whose pack, targets and worker the figure uses instead of loading its own. `allow` and `catalog`:
   * what the figure's own catalog offers, for a figure that is changed later (the player's, pack.ts `PLAYER_OFFER`).
   */
  static async load(look: CharacterPatch, renderer: WebGPURenderer, opts: FigureOptions = {}): Promise<Figure> {
    const config = { anatomy: false, ...look, animation: null };
    const character = await Character.load({
      pack: HUMAN_PACK,
      renderer,
      materials: actorKit,
      screenTextures,
      clipLibraries: false,
      fetcher: packFetch,
      config,
      allow: opts.allow,
      catalog: opts.catalog,
      // Actors reads only the other character's human (and its kit, given here as `materials`).
      ...(opts.share ? { shareWith: { human: opts.share } as unknown as Character } : {}),
    });
    // Actors swings loose clothes on a spring over the world's x and z, as if up were +Y and the world stood still. Here
    // up turns with the floor and the world moves with the eye (it is drawn relative to it), so a skirt would swing
    // when the player walks: kept still, as before.
    character.actor.clothMotion = false;
    const figure = new Figure(character);
    await figure.animator.load();
    return figure;
  }

  /** Standing height, metres. */
  get height(): number {
    return this.character.height;
  }

  /**
   * How high its eyes are over its feet (m), standing: the middle of its eyes' mesh, or the usual share of its height
   * where it has none. The player's camera looks from there.
   */
  get eyeHeight(): number {
    if (this.eyes === undefined) {
      const mesh = this.object.getObjectByName('eyes') as Mesh | undefined, g = mesh?.geometry;
      g?.computeBoundingBox();
      const box = g?.boundingBox;
      const y = box && !box.isEmpty() ? (box.min.y + box.max.y) / 2 : NaN;
      // Only a measure in the head counts (a mesh in another frame or shape gives something else).
      this.eyes = y > this.height * 0.8 && y < this.height ? y : null;
    }
    return this.eyes ?? this.height * EYE_SHARE;
  }
  private eyes: number | null | undefined;

  /** Bytes of the figure's geometry (memory watchdog). */
  bytes(): number {
    let n = 0;
    this.object.traverse((o) => {
      const g = (o as Mesh).geometry;
      if (g) n += geometryBytes(g);
    });
    return n;
  }

  /** Pose for this frame. */
  update(f: FigureFrame, dt: number, time: number): void {
    standAt(this.object, f);
    this.animator.update({ anim: f.anim, speed: f.speed, time }, dt);
    this.character.update(dt);
  }

  dispose(): void {
    this.unshape();
    this.animator.stop();
    this.character.dispose();
    this.object.removeFromParent();
  }
}
