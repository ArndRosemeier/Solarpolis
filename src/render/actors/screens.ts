/**
 * The screen fabrics of Actors' Commonwear 3026 wardrobe (`fabric:screen`: the aurora mantle, the living canvas, the
 * screen leggings, the conversation cuffs, the memory sash, the orbital halo), as our own screen materials.
 *
 * Actors gives every screen garment a texture of its own and redraws it up to 12 times a second: about 0.7 ms of the
 * main thread per garment and redraw, so eight wearers near the eye would spend several per cent of every second on
 * it, more on an iPad. The pattern does not depend on a garment's colour (the glow is its emissive colour times the
 * pattern), so here screens share a few textures, each the same aurora (Actors' `screenPixels`) at its own phase:
 * `PHASES` redraws at most 12 times a second however many people wear screens. Each screen gets one of the phases, so
 * a crowd's skies do not pulse together. (Actors 0.8.1 exports the pattern for this; screen materials an application
 * makes are its own to animate, tint and free.)
 *
 * So `actorKit` (pack.ts) has a screen garment made as plain cloth (`plainCloth`), which Actors does not animate, and
 * `adopt`s it here: dark backing and glow as Actors makes them, the glow from a shared phase.
 */
import { DataTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, Color, type Material, type MeshStandardMaterial, type Object3D, type Mesh } from 'three/webgpu';
import type { MeshData } from '@actors/core';
import { SCREEN_TEXTURE_SIZE as SIZE, screenPixels } from '@actors/three';

/** How often the aurora changes (per second; Actors' own rate). */
const RATE = 12;
/** How many phases the screens share, and how far apart in the aurora's time they are (s). */
const PHASES = 4, GAP = 41;
/** A screen as Actors lights it: its glow's strength, and how dark its backing is against its colour. */
const GLOW = 1.8, BACKING = 0.06;

/**
 * How bright a screen garment looks against a plain one of its colour (linear, for its stand-in): its dark backing
 * (6 % of its colour, tinted by luminance against 0.2: about a sixth of the dye) plus its glow (1.8 times the aurora's
 * mean of 0.054, measured over a minute of it).
 */
export const SCREEN_BRIGHTNESS = 0.17 + GLOW * 0.054;

type ScreenMaterial = Material & Pick<MeshStandardMaterial, 'color' | 'emissive' | 'emissiveMap' | 'emissiveIntensity'>;

/** Whether a pack mesh is a screen garment. */
export function isScreen(data: MeshData): boolean {
  return !!data.def.tags?.includes('fabric:screen');
}

/** A screen garment's mesh as plain cloth (a copy; the pack's own stays as it is), so Actors makes it unanimated. */
export function plainCloth(data: MeshData): MeshData {
  const tags = data.def.tags?.map((t) => (t === 'fabric:screen' ? 'fabric:smooth' : t));
  return { ...data, def: { ...data.def, tags } };
}

class ScreenFabrics {
  private readonly textures: DataTexture[] = [];
  private time = 0;
  private frame = -1;
  private next = 0;
  private live = 0;

  /** Light plain cloth Actors' kit has just made (before it is compiled) as a screen, on one of the shared phases. */
  adopt(material: ScreenMaterial): void {
    if (!this.textures.length) this.makePhases();
    material.emissive.copy(material.color);
    material.emissiveIntensity = GLOW;
    material.emissiveMap = this.textures[this.next++ % PHASES];
    material.color.multiplyScalar(BACKING);
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
      const t = new DataTexture(screenPixels(k * GAP), SIZE, SIZE);
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
