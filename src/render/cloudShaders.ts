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
import { Break, Fn, If, Loop, abs, ceil, clamp, int, min, dot, exp, float, max, mx_fractal_noise_float, pow, select, smoothstep, sqrt, uniform, vec2, vec3 } from 'three/tsl';
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
/** One sample per this share of the layer's thickness along a line of sight, within these bounds. */
const STEP = 0.1;
const MIN_STEPS = 8;
const MAX_STEPS = 40;
/** Field over the threshold for a column the layer's whole thickness tall. */
const COLUMN = 0.6;
/** Extinction in a cloud (1/m): light gets about this far into one. */
const SIGMA = 0.012;
/** How deep in a cloud the sunline's light from above is down to a third (m), and what is left below any depth. */
const LIGHT_DEPTH = 120;
const UNDER = 0.22;
/** How much brighter a thin edge is, seen against the light (silver lining). */
const FORWARD = 0.5;
/** How far a cloud's base lifts toward its rim, and how much the wear raises and lowers it (shares of the thickness). */
const RIM_LIFT = 0.18;
const WORN_BASE = 0.06;
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
 * The layer along a line of sight from `eye` (world) along `d` (unit) to the fragment `D` metres away. The layer is a
 * closed can (radius `base`, from `z0` to `z1`) with a hole around the axis (inside `top`); a line crosses the can
 * once, and the hole splits that into a stretch before it and one after. The can's outer faces (`far` false, seen
 * from outside it) march the stretch before the hole from where the line enters (the fragment); its inner faces
 * (`far` true) march the stretch after the hole up to where it leaves (the fragment), and from an eye inside the can
 * also the stretch before. So the clouds in front of the sunline are drawn in front of it. `jitter` (0 … 1, per pixel)
 * staggers the samples. Returns the light scattered toward the eye (as a share of the sunline's light on the layer's
 * top) and the opacity.
 */
export function cloudMarch(eye: V3, d: V3, D: F, far: boolean, jitter: F): Node<'vec2'> {
  return Fn(() => {
    const A = max(dot(d.xy, d.xy), 1e-8), B = dot(eye.xy, d.xy), E = dot(eye.xy, eye.xy);
    // Where the line meets a cylinder of radius rho: the nearer and farther crossing, and whether it does.
    const meet = (rho: F) => {
      const disc = B.mul(B).sub(A.mul(E.sub(rho.mul(rho))));
      const root = sqrt(max(disc, 0));
      return { ok: disc.greaterThan(0), near: B.negate().sub(root).div(A), far: B.negate().add(root).div(A) };
    };
    const outer = meet(cloud.base), hole = meet(cloud.top);
    // Into and out of the can: past both its side and its ends.
    const dz = select(abs(d.z).lessThan(1e-6), float(1e-6), d.z);
    const t0 = cloud.z0.sub(eye.z).div(dz), t1 = cloud.z1.sub(eye.z).div(dz);
    const into = max(outer.near, min(t0, t1)), outOf = min(outer.far, max(t0, t1));
    // Whether the line passes through the hole while in the can.
    const crossed = hole.ok.and(hole.far.greaterThan(max(into, 0))).and(hole.near.lessThan(outOf));
    let a0: F, a1: F, b0: F, b1: F;
    if (!far) {
      a0 = D; a1 = select(crossed, clamp(hole.near, D, outOf), outOf); b0 = a1; b1 = a1;
    } else {
      const inCan = into.lessThan(0);
      b1 = D;
      a0 = select(inCan, float(0), D);
      a1 = select(inCan, select(crossed, clamp(hole.near, 0, D), D), D);
      b0 = select(crossed, clamp(hole.far, max(into, 0), D), D);
    }
    const lenA = max(a1.sub(a0), 0), lenB = max(b1.sub(b0), 0);
    // Samples by the length marched (a grazing line crosses kilometres of the layer), so every line sees the clouds
    // in about the same detail; and none once the clouds ahead are opaque.
    const thick = cloud.base.sub(cloud.top), total = lenA.add(lenB);
    const n = clamp(ceil(total.div(thick.mul(STEP))), MIN_STEPS, MAX_STEPS);
    const dt = total.div(n);
    const T = float(1).toVar(), L = float(0).toVar();
    Loop({ start: int(0), end: int(n), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
      If(T.lessThan(0.01), () => { Break(); });
      const u = float(i).add(jitter).mul(dt);
      const t = select(u.lessThan(lenA), a0.add(u), b0.add(u.sub(lenA)));
      const p = eye.add(d.mul(t));
      const r = max(p.xy.length(), 1e-3);
      // Height in the layer: 0 at the flat base, 1 at the top.
      const b = cloud.base.sub(r).div(thick);
      const c = column(p, 4);
      const wear = mx_fractal_noise_float(inField(p, r).mul(3.3), 2, 2, 0.5);
      // Domed: the column's height rounds off toward its edges, and finer noise wears the dome into heaps. The base is
      // flat under the cloud's middle and lifts toward its rim and with the wear, so no two clouds' bases line up.
      const lift = float(1).sub(smoothstep(0, 0.5, c)).mul(RIM_LIFT).add(wear.mul(WORN_BASE)).max(0);
      const inside = band(b, lift, lift.add(0.04), 0.97, 1).mul(smoothstep(0, 0.12, c));
      const density = clamp(c.sub(b.mul(b).mul(0.9)).add(wear.mul(0.3)).mul(3), 0, 1).mul(inside);
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
