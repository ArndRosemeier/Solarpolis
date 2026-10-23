/**
 * The screen fabrics of Actors' Commonwear 3026 wardrobe (`fabric:screen`: the aurora mantle, the living canvas, the
 * screen leggings, the conversation cuffs, the memory sash, the orbital halo) share Actors' `ScreenTexturePool`
 * (0.8.2): four phase textures for every wearer, each redrawn at most 12 times a second however many wear it, with
 * each garment's glow in its own colour. One redraw costs about 0.7 ms of the main thread, so a texture per garment
 * would cost several per cent of every second with a few wearers near the eye.
 *
 * Every figure loads with `screenTextures` (figure.ts), and the view advances it once a frame, before the figures.
 */
import { SCREEN_TEXTURE_SIZE, ScreenTexturePool } from '@actors/three';

/** How many phases the screens share (Actors' own default), so a crowd's skies do not pulse together. */
const PHASES = 4;

/** The one pool every figure's screens share. */
export const screenTextures = new ScreenTexturePool(PHASES);

/** Bytes the shared textures hold at most (on the heap and on the GPU each; a phase nobody wears is not made). */
export function screenTextureBytes(): number {
  return PHASES * SCREEN_TEXTURE_SIZE * SCREEN_TEXTURE_SIZE * 4 * 2;
}

/**
 * How bright a screen garment looks against a plain one of its colour (linear, for its stand-in): its dark backing
 * (Actors darkens its colour to 6 % and tints by luminance against 0.2: about a sixth of the dye) plus its glow (1.8
 * times the aurora's mean of 0.054, measured over a minute of it).
 */
export const SCREEN_BRIGHTNESS = 0.17 + 1.8 * 0.054;
