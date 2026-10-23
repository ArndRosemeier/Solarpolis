/**
 * Ported from Actors packages/three/src/screens.ts (v0.7.0, `screenPixels`), the screen fabrics of its Commonwear 3026
 * wardrobe (`fabric:screen`: the aurora mantle, the living canvas, the conversation cuffs, the orbital halo).
 *
 * Why here: Actors keeps a screen's state in a module of its main entry (`@actors/three`), and its WebGPU kit
 * (`@actors/three/webgpu`, our `actorKit`) ships its own copy of that module. So in the node-material path a screen is
 * made but never animated (`ThreeActor.update` looks in the other copy) and a dye never reaches its glow
 * (`setGarmentColor` likewise). Until Actors keeps that state on the material, this module does both for our figures.
 *
 * The pattern does not depend on a garment's colour (the glow is its emissive colour times the pattern), so screens
 * share a few textures, each the same aurora at its own phase, instead of one each: `PHASES` uploads of 16 KB at most
 * 12 times a second however many people wear screens, against one per visible garment. Each screen gets one of the
 * phases, so a crowd's skies do not pulse together.
 */
import { Color, DataTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, type Material, type MeshStandardMaterial, type Object3D, type Mesh } from 'three/webgpu';

/** The texture's side (pixels; Actors' own) and how often it changes (per second). */
const SIZE = 64, RATE = 12;
/** How many phases the screens share, and how far apart in the aurora's time they are (s). */
const PHASES = 4, GAP = 41;

/** The aurora at time t (s): slow ribbons on a pixel grid, opaque (Actors' `screenPixels`). */
function screenPixels(time: number, data: Uint8Array): void {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    const wave = Math.sin(v * 17 + Math.sin(u * 9 + time * 0.22) * 2.8 - time * 0.38);
    const ribbon = Math.pow(Math.max(0, wave), 4);
    const grid = x % 4 === 0 || y % 4 === 0 ? 0.7 : 1;
    const p = (y * SIZE + x) * 4;
    for (let c = 0; c < 3; c++) {
      const hue = 0.5 + 0.5 * Math.sin(u * 6 + v * 4 + c * 2.094 + time * 0.13);
      data[p + c] = Math.round((12 + ribbon * (80 + hue * 163)) * grid);
    }
    data[p + 3] = 255;
  }
}

/**
 * How bright a screen garment looks against a plain one of its colour (linear, for its stand-in): its dark base (Actors
 * darkens the colour to 6 % and tints by luminance against 0.2, so about a sixth of the dye) plus its glow (1.8 times
 * the aurora's mean of 0.054, measured over a minute of it).
 */
export const SCREEN_BRIGHTNESS = 0.17 + 1.8 * 0.054;

type ScreenMaterial = Material & Pick<MeshStandardMaterial, 'emissive' | 'emissiveMap'>;

class ScreenFabrics {
  private readonly textures: DataTexture[] = [];
  private time = 0;
  private frame = -1;
  private next = 0;
  private live = 0;

  /**
   * A screen material Actors' kit has just made (before it is compiled): it takes one of the shared phases in place
   * of its own texture, which is let go unused.
   */
  adopt(material: ScreenMaterial): void {
    const own = material.emissiveMap;
    if (!own || !(own instanceof DataTexture)) return;
    if (!this.textures.length) this.makePhases();
    material.emissiveMap = this.textures[this.next++ % PHASES];
    own.dispose();
    own.image = { data: new Uint8Array(0), width: 0, height: 0 };
    material.userData.screen = true;
    this.live++;
    material.addEventListener('dispose', () => { this.live--; });
  }

  /** Light a figure's screens in its garments' colours (sRGB hex by garment, the look's `garmentColors`). */
  dye(root: Object3D, colors: Readonly<Record<string, string>>): void {
    root.traverse((o) => {
      const m = (o as Mesh).material as ScreenMaterial | undefined;
      const c = m && !Array.isArray(m) && m.userData.screen ? colors[o.name] : undefined;
      if (c) m!.emissive.copy(new Color(c));
    });
  }

  /** Move the aurora on by a frame's time (s); the textures change at most `RATE` times a second, and only while worn. */
  advance(dt: number): void {
    if (!this.live || !(dt > 0)) return;
    this.time += dt;
    const frame = Math.floor(this.time * RATE);
    if (frame === this.frame) return;
    this.frame = frame;
    this.textures.forEach((t, k) => {
      screenPixels(this.time + k * GAP, t.image.data as Uint8Array);
      t.needsUpdate = true;
    });
  }

  /** Bytes the shared textures hold (on the heap and on the GPU each). */
  textureBytes(): number {
    return this.textures.length * SIZE * SIZE * 4 * 2;
  }

  private makePhases(): void {
    for (let k = 0; k < PHASES; k++) {
      const data = new Uint8Array(SIZE * SIZE * 4);
      screenPixels(k * GAP, data);
      const t = new DataTexture(data, SIZE, SIZE);
      t.name = `actors-screen-${k}`;
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.magFilter = t.minFilter = LinearFilter;
      t.needsUpdate = true;
      this.textures.push(t);
    }
  }
}

/** The one keeper of every figure's screen fabrics. */
export const screenFabrics = new ScreenFabrics();
