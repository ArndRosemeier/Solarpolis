/**
 * The clouds on the GPU (world/clouds.ts has their schedule): a slab of air between two radii, `top` (toward the axis)
 * and `base`, where a seeded noise field lays out cumulus. Each cloud is a column standing on the flat base, as tall as
 * the field is far over the hour's threshold, its top domed and its edges worn by finer noise. The field is laid on the
 * cylinder (no seam around the axis) and carried by the wind.
 *
 * Seen from the floor the layer is crossed twice: overhead (grey undersides, bright where the sunline shines through a
 * thin edge) and on the far side of the axis (the sunlit tops). Both crossings are ray-marched in the fragment shader
 * of a cylinder at the base radius (`CLOUDS_NEAR` its outer faces, `CLOUDS_FAR` its inner ones, in materials.ts). The
 * same field shades the land below (`cloudShade`).
 */
import { Vector2, type Node } from 'three/webgpu';
import { Fn, Loop, clamp, dot, exp, float, max, mx_fractal_noise_float, pow, select, smoothstep, sqrt, uniform, vec2, vec3 } from 'three/tsl';
import { band } from './shaderMath';
import { coverThreshold, type CloudSpan, type CloudState } from '../world/clouds';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The layer's uniforms (set per habitat with `setCloudSpan` and per frame with `setCloudState`). */
const cloud = {
  top: uniform(1),
  base: uniform(2),
  z0: uniform(0),
  z1: uniform(0),
  fade: uniform(1),
  /** One cloud's width (m), and the radius the field is laid on. */
  size: uniform(1),
  middle: uniform(1),
  /** The field's threshold at this hour: where it is higher there are clouds (very high: none). */
  threshold: uniform(1e3),
  /** How far the wind has carried them: along the axis (m), and around it (cos, sin of the turn). */
  along: uniform(0),
  turn: uniform(new Vector2(1, 0)),
};

/** How widely the field's values spread (their standard deviation): four octaves of MaterialX noise. */
const FIELD_SPREAD = 0.3;
/** Samples along a line of sight through one crossing of the layer. */
const STEPS = 14;
/** Field over the threshold for a column the layer's whole thickness tall. */
const COLUMN = 0.3;
/** Extinction in a cloud (1/m): light gets about this far into one. */
const SIGMA = 0.012;
/** How deep in a cloud the sunline's light from above is down to a third (m), and what is left below any depth. */
const LIGHT_DEPTH = 160;
const UNDER = 0.3;
/** How much brighter a thin edge is, seen against the light (silver lining). */
const FORWARD = 1.6;
/** How much of the sunline a cloud overhead keeps off the land at most. */
const SHADE = 0.6;

export function setCloudSpan(span: CloudSpan | null, size: number): void {
  if (!span) { cloud.threshold.value = 1e3; return; }
  cloud.top.value = span.top;
  cloud.base.value = span.base;
  cloud.z0.value = span.z0;
  cloud.z1.value = span.z1;
  cloud.fade.value = span.fade;
  cloud.size.value = size;
  cloud.middle.value = (span.top + span.base) / 2;
}

export function setCloudState(state: CloudState | null): void {
  if (!state) { cloud.threshold.value = 1e3; return; }
  cloud.threshold.value = coverThreshold(state.cover) * FIELD_SPREAD;
  cloud.along.value = state.along;
  cloud.turn.value.set(Math.cos(state.turn), Math.sin(state.turn));
}

/** Where a world point lies in the wind-carried field: its direction from the axis at `radius`, and z (in cloud sizes). */
function inField(p: V3, radius: F): V3 {
  const len = max(p.xy.length(), 1e-3);
  const x = p.x.div(len), y = p.y.div(len), c = cloud.turn.x, s = cloud.turn.y;
  return vec3(x.mul(c).add(y.mul(s)).mul(radius), y.mul(c).sub(x.mul(s)).mul(radius), p.z.sub(cloud.along)).div(cloud.size);
}

/** The column's height over the point's place in the field (0 none … 1 the layer's thickness), thinning by the endcaps. */
function column(p: V3, octaves: number): F {
  const f = mx_fractal_noise_float(inField(p, cloud.middle), octaves, 2, 0.5);
  const ends = band(p.z, cloud.z0, cloud.z0.add(cloud.fade), cloud.z1.sub(cloud.fade), cloud.z1);
  return clamp(f.sub(cloud.threshold).div(COLUMN), 0, 1).mul(ends);
}

/**
 * How much of the sunline reaches a point under the layer past the cloud over it (1 clear … 1 − SHADE): the light
 * comes from the axis, so the cloud straight overhead stands in for it.
 */
export function cloudShade(p: V3): F {
  const below = smoothstep(cloud.base, cloud.base.add(10), p.xy.length());
  return float(1).sub(smoothstep(0.03, 0.4, column(p, 3)).mul(SHADE).mul(below));
}

/**
 * The layer along a line of sight from `eye` (world) along `d` (unit), through one crossing: the near one (`far`
 * false: from where it enters the base to the top, or the closest approach to the axis) or the far one (onward to
 * where it leaves the base; from the eye itself when the eye is in or above the layer). `jitter` (0 … 1, per pixel)
 * staggers the samples. Returns the light scattered toward the eye (as a share of the sunline's light on the layer's
 * top) and the opacity.
 */
export function cloudMarch(eye: V3, d: V3, far: boolean, jitter: F): Node<'vec2'> {
  return Fn(() => {
    const A = max(dot(d.xy, d.xy), 1e-8), B = dot(eye.xy, d.xy), E = dot(eye.xy, eye.xy);
    // Where the line meets a cylinder of radius rho: the nearer and farther crossing, and whether it does.
    const meet = (rho: F) => {
      const disc = B.mul(B).sub(A.mul(E.sub(rho.mul(rho))));
      const root = sqrt(max(disc, 0));
      return { ok: disc.greaterThan(0), near: B.negate().sub(root).div(A), far: B.negate().add(root).div(A) };
    };
    const outer = meet(cloud.base), inner = meet(cloud.top), closest = B.negate().div(A);
    // Two stretches (a, then b) of the line inside the layer.
    let a0: F, a1: F, b0: F, b1: F;
    if (!far) {
      a0 = max(outer.near, 0); a1 = select(inner.ok, inner.near, closest); b0 = a1; b1 = a1;
    } else {
      const under = E.greaterThan(cloud.base.mul(cloud.base));
      b1 = max(outer.far, 0);
      a0 = select(under, select(inner.ok, inner.far, closest), float(0));
      a1 = select(under, b1, select(inner.ok, clamp(inner.near, 0, b1), b1));
      b0 = select(under, b1, select(inner.ok, clamp(inner.far, 0, b1), b1));
    }
    const lenA = max(a1.sub(a0), 0), lenB = max(b1.sub(b0), 0);
    const dt = lenA.add(lenB).div(STEPS);
    const thick = cloud.base.sub(cloud.top);
    const T = float(1).toVar(), L = float(0).toVar();
    Loop(STEPS, ({ i }: { i: Node<'int'> }) => {
      const u = float(i).add(jitter).mul(dt);
      const t = select(u.lessThan(lenA), a0.add(u), b0.add(u.sub(lenA)));
      const p = eye.add(d.mul(t));
      const r = max(p.xy.length(), 1e-3);
      // Height in the layer: 0 at the flat base, 1 at the top.
      const b = cloud.base.sub(r).div(thick);
      const c = column(p, 4);
      const wear = mx_fractal_noise_float(inField(p, r).mul(3.3), 2, 2, 0.5);
      const inside = band(b, 0, 0.04, 0.97, 1).mul(smoothstep(0, 0.12, c));
      const density = clamp(c.sub(b.mul(b).mul(0.9)).add(wear.mul(0.22)).mul(5), 0, 1).mul(inside);
      // Light from the sunline above, dimmed by the cloud over the sample; brighter seen against it (forward scatter).
      const through = exp(max(c.sub(b), 0).mul(thick).div(-LIGHT_DEPTH));
      const out = p.xy.div(r);
      const ahead = pow(clamp(dot(d.xy, out).negate(), 0, 1), 6);
      const light = float(UNDER).add(through.mul(1 - UNDER)).add(through.mul(ahead).mul(FORWARD));
      const a = float(1).sub(exp(density.mul(SIGMA).mul(dt).negate()));
      L.addAssign(T.mul(a).mul(light));
      T.mulAssign(float(1).sub(a));
    });
    return vec2(L, float(1).sub(T));
  })() as unknown as Node<'vec2'>;
}
