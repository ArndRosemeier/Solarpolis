/** Small shader-side helpers that several kinds' shaders share (TSL). */
import { float, smoothstep } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type Edge = F | number;

/** 0 below `rise0`, rising to 1 by `rise1`, falling back to 0 between `fall0` and `fall1` (smoothly, by smoothstep). */
export function band(x: F, rise0: Edge, rise1: Edge, fall0: Edge, fall1: Edge): F {
  return smoothstep(rise0, rise1, x).mul(float(1).sub(smoothstep(fall0, fall1, x)));
}
