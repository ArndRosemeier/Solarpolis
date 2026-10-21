/**
 * The one way a texture gets its sampling set up. Every texture the kinds sample is filterable (linear), placeholders
 * included: three r186's WGSL builder declares no sampler for a texture with nearest filters, yet `.grad()` still
 * samples through one, so the pipeline would fail in WebGPU only (docs/SHADERS.md).
 */
import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three/webgpu';

export interface Sampling {
  /** Colour in sRGB (decoded to linear when sampled); otherwise data. */
  srgb?: boolean;
  /** Mipmaps: three makes them (`true`), or the texture brings its own (`'own'`). */
  mips?: boolean | 'own';
  anisotropy?: number;
  /** Repeat across u and v (otherwise clamp to the edge). */
  repeat?: boolean | 'v';
}

/** Set a texture's filters, colour space, mips and wrapping, and mark it for upload. */
export function filtered<T extends Texture>(t: T, o: Sampling = {}): T {
  t.magFilter = LinearFilter;
  t.minFilter = o.mips ? LinearMipmapLinearFilter : LinearFilter;
  t.generateMipmaps = o.mips === true;
  if (o.anisotropy) t.anisotropy = o.anisotropy;
  if (o.srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = o.repeat === true ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = o.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
