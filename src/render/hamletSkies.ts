/**
 * The skies on the Understorey's ceilings (gen/skies.ts: which hamlet shows which). Each is drawn as one seen
 * infinitely far off: from the direction one looks alone, in the frame of the eye (up toward the axis, along it, and
 * across), so a sky stays put as one walks under it and reads as sky, not as a picture on the ceiling. Clouds, leaves
 * and the sea's surface lie on a plane far overhead (`overhead`), so they foreshorten toward the horizon as real ones do.
 *
 * Colours are the sky's own at full day (about 1 for its brightest), before the screen's brightness (materials.ts,
 * VAULT): the day (`day`, 0 night … 1 full day) dims the skies that keep their day in step with the land's; the
 * others keep their own night. Moving parts move with the habitat's clock (`clock`, s).
 */
import { Fn, If, abs, clamp, cos, dot, exp, float, floor, hash, max, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, normalize, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { glassSky } from './glassDeck';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** The skies in the order drawn: must be the catalogue's (gen/skies.ts; a test checks). */
export const SKY_DRAWN = ['open', 'aurora', 'moon', 'mars', 'canopy', 'deep', 'glass'] as const;

/** Stars: cells round the sky (per radian) and the share of cells holding one. */
const STAR_CELLS = 260;
const STAR_SHARE = 0.004;
/** Earth from the Moon: its angular radius (rad), drawn heroic (about four times its true size). */
const EARTH = 0.06;
/**
 * The glass deck's land light (sunlit white paper 1) as a sky's (about 1 for its brightest): the far side by day is a
 * few tenths of paper's, the sunline far brighter.
 */
const GLASS_GAIN = 2.5;

/** Where a direction meets a plane one unit overhead (its along and across), and how far up the direction looks. */
function overhead(d: V3, up: V3, along: V3, across: V3): { at: V2; rise: F } {
  const rise = dot(d, up), k = float(1).div(max(rise, 0.04));
  return { at: vec2(dot(d, along).mul(k), dot(d, across).mul(k)), rise };
}

/** A field of stars over the directions (in the eye's frame, so they keep still), `share` of cells lit. */
function stars(d: V3, share: number): F {
  // Kept positive (a negative cell number would turn every hash on that side of the sky into the same one).
  const c = floor(d.mul(STAR_CELLS)), h = hash(c.x.add(c.y.mul(157)).add(c.z.mul(9133)).add(STAR_CELLS * (1 + 157 + 9133) + 1));
  const lit = smoothstep(1 - share, 1, h);
  return lit.mul(lit).mul(4);
}

/** A night sky: deep blue at the zenith, a little lighter low down, and stars. */
const night = (d: V3, rise: F): V3 => mix(vec3(0.012, 0.016, 0.03), vec3(0.004, 0.006, 0.014), smoothstep(0, 0.7, rise)).add(vec3(0.8, 0.85, 1).mul(stars(d, STAR_SHARE)));

/** An old Earth summer sky: pale low down, deep blue overhead, cumulus drifting along. */
function open(d: V3, o: { at: V2; rise: F }, day: F, clock: F): V3 {
  const blue = mix(vec3(0.62, 0.74, 0.9), vec3(0.16, 0.34, 0.78), smoothstep(0, 0.65, o.rise));
  const n = mx_fractal_noise_float(vec3(o.at.mul(0.9).add(vec2(clock.mul(0.003), 0)), 3.1), 4, 2, 0.5);
  const cover = smoothstep(-0.02, 0.28, n).mul(smoothstep(0.02, 0.25, o.rise));
  const cloud = mix(vec3(0.62, 0.64, 0.7), vec3(1, 1, 0.98), smoothstep(0.2, 0.7, n));
  return mix(night(d, o.rise), mix(blue, cloud, cover), day);
}

/** A polar night: curtains of aurora swaying slowly across the stars. */
function aurora(d: V3, o: { at: V2; rise: F }, clock: F): V3 {
  const sway = mx_noise_float(vec3(o.at.x.mul(0.25), clock.mul(0.004), 1.7)).mul(3);
  const fold = sin(o.at.y.mul(0.9).add(sway)), band = exp(fold.mul(fold).mul(-5));
  const rays = mx_noise_float(vec3(o.at.x.mul(4), o.at.y.mul(0.4), clock.mul(0.01))).mul(0.5).add(0.5);
  const glow = band.mul(rays).mul(smoothstep(0.05, 0.4, o.rise));
  const hue = mix(vec3(0.15, 0.95, 0.45), vec3(0.55, 0.25, 0.85), smoothstep(0.4, 1, rays));
  return night(d, o.rise).add(hue.mul(glow).mul(0.6));
}

/** The sky from the Moon: black, dense with stars, Earth hanging high in it, lit from one side. */
function moon(d: V3, up: V3, along: V3, across: V3, clock: F): V3 {
  const toward = normalize(up.mul(0.99).add(across.mul(0.12)).add(along.mul(0.08)));
  const c = dot(d, toward), r = max(float(1).sub(c), 0).mul(2).sqrt().div(EARTH);
  const disc = float(1).sub(smoothstep(0.96, 1, r));
  // Earth's face: blue sea, white weather, its lit half toward `along`.
  const local = d.sub(toward.mul(c)).div(EARTH);
  const weather = mx_fractal_noise_float(vec3(local.mul(2.2).add(vec3(clock.mul(0.0004), 0, 0))), 3, 2, 0.5);
  const face = mix(vec3(0.05, 0.16, 0.42), vec3(0.95, 0.96, 1), smoothstep(0.1, 0.5, weather));
  const lit = smoothstep(-0.3, 0.4, dot(local, along).add(float(1).sub(r).mul(0.3)));
  const halo = exp(r.sub(1).max(0).mul(-6)).mul(0.08).mul(float(1).sub(disc));
  return vec3(0.002, 0.002, 0.003).add(vec3(1).mul(stars(d, STAR_SHARE * 3))).mul(float(1).sub(disc)).add(face.mul(lit).mul(disc)).add(vec3(0.4, 0.6, 1).mul(halo));
}

/** A Martian day: butterscotch dust, bluer near a small pale sun, dimming to a dusky rose at night. */
function mars(d: V3, o: { at: V2; rise: F }, up: V3, along: V3, day: F): V3 {
  const sun = normalize(up.mul(0.8).add(along.mul(0.6))), c = dot(d, sun);
  const streaks = mx_fractal_noise_float(vec3(o.at.x.mul(0.3), o.at.y.mul(1.4), 7.7), 3, 2, 0.5).mul(0.1);
  const dust = mix(vec3(0.8, 0.58, 0.38), vec3(0.6, 0.42, 0.3), smoothstep(0, 0.7, o.rise)).add(streaks);
  const halo = mix(dust, vec3(0.55, 0.65, 0.8), smoothstep(0.93, 0.995, c));
  const disc = smoothstep(0.9993, 0.9996, c);
  const sky = halo.add(vec3(1, 1, 0.95).mul(disc));
  return mix(night(d, o.rise).add(vec3(0.02, 0.01, 0.01)), sky, day);
}

/** Up through a forest canopy: leaves in layers, each swaying a little, the sky bright in their gaps. */
function canopy(d: V3, o: { at: V2; rise: F }, day: F, clock: F): V3 {
  let out: V3 = mix(vec3(0.85, 0.92, 1), vec3(0.55, 0.72, 0.95), smoothstep(0, 0.7, o.rise));
  let gaps: F = float(1);
  // From the highest layer down: the light through the leaves greener and dimmer the more layers it has passed. Each
  // layer's crowns are ragged with single leaves at their edges, and dappled where the leaves overlap.
  for (const [scale, shade, k] of [[0.7, 0.45, 1], [1.6, 0.65, 2], [3.4, 0.85, 3]] as const) {
    const sway = vec2(sin(clock.mul(0.4 + k * 0.13)).mul(0.03), cos(clock.mul(0.3 + k * 0.17)).mul(0.03));
    const at = o.at.add(sway).mul(scale);
    const crowns = mx_fractal_noise_float(vec3(at, k * 4.1), 3, 2, 0.5);
    const leaves = mx_fractal_noise_float(vec3(at.mul(14), k * 7.3), 2, 2, 0.5);
    const leaf = smoothstep(0.1, 0.16, crowns.add(leaves.mul(0.16)));
    const dapple = mx_noise_float(vec3(at.mul(30), k * 2.9)).mul(0.25).add(1);
    out = mix(out, vec3(0.36, 0.62, 0.14).mul(shade).mul(dapple), leaf);
    gaps = gaps.mul(float(1).sub(leaf));
  }
  // By night the leaves are black against the stars in their gaps.
  return mix(night(d, o.rise).mul(gaps), out, day);
}

/** Up from under the sea: blue going green, the surface's waves and the light running in bright threads under it. */
function deep(o: { at: V2; rise: F }, day: F, clock: F): V3 {
  const water = mix(vec3(0.02, 0.15, 0.22), vec3(0.06, 0.34, 0.48), smoothstep(0.1, 0.9, o.rise));
  // The light's threads: the bright net where the waves overhead focus it, two drifting nets over each other.
  const at = o.at.mul(7);
  const a = mx_worley_noise_vec2(vec3(at, clock.mul(0.2))), b = mx_worley_noise_vec2(vec3(at.mul(1.9).add(5.3), clock.mul(0.27)));
  const net = float(1).sub(smoothstep(0, 0.1, a.y.sub(a.x))).add(float(1).sub(smoothstep(0, 0.07, b.y.sub(b.x))).mul(0.6));
  const threads = net.mul(smoothstep(0.25, 0.7, o.rise));
  // The surface overhead: the bright window the light comes in by, rippled by the waves.
  const ripple = mx_fractal_noise_float(vec3(o.at.mul(3), clock.mul(0.2)), 2, 2, 0.5).mul(0.3).add(1);
  const window = smoothstep(0.8, 0.97, o.rise).mul(0.3).mul(ripple);
  const sea = water.add(vec3(0.55, 0.85, 0.95).mul(threads.mul(0.5).add(window)));
  // By night only the threads show, faintly, as under a moon.
  return mix(vec3(0.004, 0.012, 0.02).add(vec3(0.02, 0.05, 0.06).mul(threads)), sea, day);
}

/** What every sky is drawn from: the direction, the eye's up, the day (0 … 1) and the clock. */
type SkyArgs = { d: V3; up: V3; along: V3; across: V3; o: { at: V2; rise: F }; day: F; clock: F };

/**
 * A sky as its own shader function, so that nothing worked out inside one sky's branch is read by another's: three's
 * node builder declares an expression used twice as a variable set where it is first used twice, which may be inside
 * one sky's branch, and then reads it unset in the next (render 20261022-193919-skies3: the moon, canopy and sea drew
 * as if at night, the moon without stars).
 */
function skyFunction(name: string, draw: (a: SkyArgs) => V3): (d: V3, up: V3, day: F, clock: F) => V3 {
  const f = Fn(([d, up, day, clock]: [V3, V3, F, F]) => {
    const along = vec3(0, 0, 1), across = normalize(vec3(up.y, up.x.negate(), 0));
    return draw({ d, up, along, across, o: overhead(d, up, along, across), day, clock });
  }).setLayout({
    name: `hamletSky_${name}`,
    type: 'vec3',
    inputs: [
      { name: 'd', type: 'vec3' },
      { name: 'up', type: 'vec3' },
      { name: 'day', type: 'float' },
      { name: 'clock', type: 'float' },
    ],
  });
  return (d, up, day, clock) => f(d, up, day, clock) as unknown as V3;
}

/** The skies' functions, in the order drawn. */
const SKY_FUNCTIONS = [
  skyFunction('open', (a) => open(a.d, a.o, a.day, a.clock)),
  skyFunction('aurora', (a) => aurora(a.d, a.o, a.clock)),
  skyFunction('moon', (a) => moon(a.d, a.up, a.along, a.across, a.clock)),
  skyFunction('mars', (a) => mars(a.d, a.o, a.up, a.along, a.day)),
  skyFunction('canopy', (a) => canopy(a.d, a.o, a.day, a.clock)),
  skyFunction('deep', (a) => deep(a.o, a.day, a.clock)),
  // The real sky above: its own day and night, as taken (render/glassDeck.ts).
  skyFunction('glass', (a) => glassSky(a.d).mul(GLASS_GAIN)),
];

/**
 * Sky `index` (gen/skies.ts) seen along `d` (unit, world) from an eye whose up (toward the axis) is `up`, at `day` of
 * the land's day (the skies that keep their own night ignore it), at the habitat's `clock`.
 */
export function hamletSky(d: V3, up: V3, index: F, day: F, clock: F): V3 {
  return Fn(() => {
    // The arguments set before the branches, for the same reason (`skyFunction`).
    const out = vec3(0).toVar(), k = floor(index.add(0.5)).toVar(), look = d.toVar(), above = up.toVar();
    const lit = clamp(day, 0, 1).toVar(), time = clock.toVar();
    SKY_FUNCTIONS.forEach((sky, n) => If(abs(k.sub(n)).lessThan(0.5), () => { out.assign(sky(look, above, lit, time)); }));
    return out;
  })() as unknown as V3;
}
