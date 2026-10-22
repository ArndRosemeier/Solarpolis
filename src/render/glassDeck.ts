/**
 * The glass deck (gen/skies.ts `glass`): a hamlet that chose it shows on its ceilings the real sky over the land above,
 * as one standing there would see it: the far side of the habitat overhead, the sunline, the clouds. It is taken as six
 * views from the land straight over the eye (one a frame, a round again every `REFRESH` seconds) into an atlas of six
 * faces, which the VAULT kind looks up by the direction one looks (`glassSky`), so it reads as far off as the land is.
 *
 * Memory (CLAUDE.md rule 12): the atlas holds GPU memory only while a glass deck is near (`GLASS_FACE`² × 6 half-float
 * texels, 3 MB at 256); the views are drawn into a target of one face (its multisampled buffers transient), given up
 * after each round. Nothing is kept on the CPU.
 *
 * The views are drawn with the frame's own materials into a target like the renderer's own frame target (the same
 * format, samples and depth), so they need no shaders but those already built.
 */
import { HalfFloatType, LinearFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Vector2, Box2, type Scene, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, clamp, dot, float, select, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { Node, Texture, TextureNode } from 'three/webgpu';
import { toView, type Vec3 } from '../blueprint';

type V3 = Node<'vec3'>;

/** Texels a side of each face. */
export const GLASS_FACE = 256;
/** Seconds (real) between rounds of views: the light moves slowly, and the eye walks under it. */
const REFRESH = 15;
/** The faces in the atlas: three across, two down. */
const COLUMNS = 3;
const ROWS = 2;

/**
 * The six views: each looks along `f` with `u` up (world axes; the atlas is looked up by world direction, which the
 * eye-relative scene shares, being only moved, never turned).
 */
const FACES: readonly { f: Vec3; u: Vec3 }[] = [
  { f: [1, 0, 0], u: [0, 0, 1] },
  { f: [-1, 0, 0], u: [0, 0, 1] },
  { f: [0, 1, 0], u: [0, 0, 1] },
  { f: [0, -1, 0], u: [0, 0, 1] },
  { f: [0, 0, 1], u: [1, 0, 0] },
  { f: [0, 0, -1], u: [1, 0, 0] },
];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A face's right: its views' x. */
const rightOf = (k: number): Vec3 => cross(FACES[k].f, FACES[k].u);

/** The atlas's texels: half floats, filtered, no depth. */
const atlasOptions = { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter } as const;
/**
 * What the VAULT kind samples until a glass deck is near: one texel. The atlas, made when one is, takes its place in
 * the shader's texture nodes (`looks`), so no shader is built again.
 */
const blank = new RenderTarget(1, 1, atlasOptions);
const looks = new Set<TextureNode>();
let looking: Texture = blank.texture;
const lookAt = (t: Texture): void => {
  looking = t;
  for (const n of looks) n.value = t;
};
/** 1 once a whole round of views is in the atlas, 0 until then (the deck is dark for those few frames). */
const ready = uniform(0);

/**
 * The land's light seen through the glass deck along `d` (unit, world), in the land's units (sunlit white paper 1).
 * The face is the one `d` leaves the cube by; within it, where the face's view put that direction.
 */
export const glassSky = (d: V3): V3 => Fn(() => {
  const a = abs(d), x = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z)), y = x.not().and(a.y.greaterThanEqual(a.z));
  // Which face (0 … 5, as FACES) and its axes.
  const k = select(x, select(d.x.greaterThan(0), float(0), float(1)), select(y, select(d.y.greaterThan(0), float(2), float(3)), select(d.z.greaterThan(0), float(4), float(5))));
  const pick = (of: (n: number) => Vec3): V3 => {
    let v: V3 = vec3(...of(5));
    for (let n = 4; n >= 0; n--) v = select(k.lessThan(n + 0.5), vec3(...of(n)), v);
    return v;
  };
  const f = pick((n) => FACES[n].f), u = pick((n) => FACES[n].u), r = pick(rightOf);
  const ahead = dot(d, f), half = 0.5 / GLASS_FACE;
  // Where the face's view drew it (0 … 1 across, 0 … 1 up), kept off the face's edge texels.
  const across = clamp(dot(d, r).div(ahead).mul(0.5).add(0.5), half, 1 - half);
  const up = clamp(dot(d, u).div(ahead).mul(0.5).add(0.5), half, 1 - half);
  // Texels as drawn: a view's first row is its top, and a render target's texture is looked up by its rows from the first.
  const col = k.mod(COLUMNS), row = k.div(COLUMNS).floor();
  const at = vec2(col.add(across).div(COLUMNS), row.add(float(1).sub(up)).div(ROWS));
  const look = texture(looking, at);
  looks.add(look);
  return look.rgb.mul(ready);
})() as unknown as V3;

/** Where and for which hamlet the glass deck wants its views taken: straight over the eye, on the land. */
export interface GlassWant {
  court: number;
  at: Vec3;
}

/** What the views need from the frame: the land shown (or hidden again), lit and seen as on the land from a point. */
export interface GlassStage {
  /** Show the land's things as from `at` (world): lit there, the eyes and background as on the land; with null, as before. */
  onLand(at: Vec3 | null): void;
}

export class GlassDeck {
  private view: RenderTarget | null = null;
  private atlas: RenderTarget | null = null;
  private readonly camera = new PerspectiveCamera(90, 1, 0.3, 1e6);
  /** The hamlet the atlas is of (−1: none), where the round under way looks from, its next face, seconds to the next round. */
  private court = -1;
  private from: Vec3 | null = null;
  private face = 0;
  private wait = 0;
  private readonly region = new Box2(new Vector2(0, 0), new Vector2(GLASS_FACE, GLASS_FACE));
  private readonly to = new Vector2();

  constructor(private readonly renderer: WebGPURenderer, private readonly scene: Scene, private readonly main: PerspectiveCamera) {}

  /** Bytes on the GPU (memory watchdog): the atlas while a deck is near, and the view target during a round. */
  bytes(): number {
    const face = GLASS_FACE * GLASS_FACE * 8, samples = Math.max(1, this.renderer.samples);
    return (this.court >= 0 ? COLUMNS * ROWS * face : 0) + (this.view ? face * (1 + samples) + GLASS_FACE * GLASS_FACE * 4 * samples : 0);
  }

  /** Whether the atlas holds a whole round of views of the deck near. */
  get shown(): boolean {
    return this.court >= 0 && ready.value === 1;
  }

  /**
   * After the frame is drawn: take the next view for the deck wanted (null: none is near, and the atlas is given up),
   * with the scene posed about the frame's `eye` (world). `dt` real seconds.
   */
  step(dt: number, eye: Vec3, want: GlassWant | null, stage: GlassStage): void {
    if (!want) { this.release(); return; }
    if (want.court !== this.court) {
      if (!this.atlas) {
        this.atlas = new RenderTarget(COLUMNS * GLASS_FACE, ROWS * GLASS_FACE, atlasOptions);
        this.atlas.texture.name = 'glass deck';
        this.renderer.initTexture(this.atlas.texture);
        lookAt(this.atlas.texture);
      }
      this.court = want.court;
      ready.value = 0;
      this.from = null;
      this.wait = 0;
    }
    if (!this.from) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.from = want.at;
      this.face = 0;
    }
    this.take(this.face, eye, this.from, stage);
    if (++this.face < FACES.length) return;
    ready.value = 1;
    this.from = null;
    this.wait = REFRESH;
    this.view?.dispose();
    this.view = null;
  }

  /** Draw face `k` of the views from `from` and copy it into the atlas. */
  private take(k: number, eye: Vec3, from: Vec3, stage: GlassStage): void {
    const r = this.renderer;
    this.view ??= new RenderTarget(GLASS_FACE, GLASS_FACE, {
      type: HalfFloatType, format: RGBAFormat, depthBuffer: r.depth, stencilBuffer: r.stencil, samples: r.samples, generateMipmaps: false,
    });
    const c = this.camera, at = toView(eye, from), { f, u } = FACES[k];
    c.near = this.main.near;
    c.far = this.main.far;
    c.updateProjectionMatrix();
    c.position.set(at[0], at[1], at[2]);
    c.up.set(u[0], u[1], u[2]);
    c.lookAt(at[0] + f[0], at[1] + f[1], at[2] + f[2]);
    c.updateMatrixWorld();
    // A camera's x is up × back, here u × −f = f × u: the face's right, as `glassSky` reads it.
    stage.onLand(from);
    const before = r.getRenderTarget();
    r.setRenderTarget(this.view);
    r.render(this.scene, c);
    r.setRenderTarget(before);
    stage.onLand(null);
    if (this.atlas) r.copyTextureToTexture(this.view.texture, this.atlas.texture, this.region, this.to.set((k % COLUMNS) * GLASS_FACE, Math.floor(k / COLUMNS) * GLASS_FACE));
  }

  /** Give the atlas and any view target back. */
  release(): void {
    if (this.court < 0) return;
    this.court = -1;
    this.from = null;
    ready.value = 0;
    this.view?.dispose();
    this.view = null;
    lookAt(blank.texture);
    this.atlas?.dispose();
    this.atlas = null;
  }

  dispose(): void {
    this.release();
  }
}
