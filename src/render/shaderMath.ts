/** Small shader-side helpers that several kinds' shaders share (TSL). */
import { clamp, float, fract, fwidth, length, max, min, smoothstep } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type Edge = F | number;

/** 0 below `rise0`, rising to 1 by `rise1`, falling back to 0 between `fall0` and `fall1` (smoothly, by smoothstep). */
export function band(x: F, rise0: Edge, rise1: Edge, fall0: Edge, fall1: Edge): F {
  return smoothstep(rise0, rise1, x).mul(float(1).sub(smoothstep(fall0, fall1, x)));
}

/**
 * How much of a pattern of period 1 shows: 1 while a period spans more than a few pixels, fading to 0 (the pattern's
 * mean) before it would alias. Every fine layer fades in this way as the eye comes closer.
 */
export const shows = (x: Node<'float'> | Node<'vec2'> | Node<'vec3'>): Node<'float'> =>
  float(1).sub(smoothstep(0.3, 0.7, length(fwidth(x as Node<'vec2'>))));

/**
 * Lines where x crosses a whole number, `width` (share of a period) wide, box-filtered over the pixel: a line thinner
 * than a pixel shows as a fainter one, so its share of the area is `width` at every distance.
 */
export const lineAt = (x: Node<'float'>, width: number): Node<'float'> => {
  const fw = max(fwidth(x), 1e-6), f = fract(x), d = min(f, f.oneMinus());
  return clamp(min(d.add(fw.mul(0.5)), width / 2).sub(max(d.sub(fw.mul(0.5)), -width / 2)).div(fw), 0, 1);
};

/** A brightness factor `contrast` on lines covering `share` of the area, shown by `r`, its mean kept at 1. */
export const keepMean = (line: Node<'float'>, share: number, contrast: number, r: Node<'float'>): Node<'float'> =>
  float(1).add(line.mul(r).mul(contrast - 1)).div(r.mul(share * (contrast - 1)).add(1));
