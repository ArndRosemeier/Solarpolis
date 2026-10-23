/**
 * The opening's one shader module (design "First Light"): three entry pairs, built once each with
 * `createRenderPipelineAsync` before the first frame, so nothing compiles while it plays.
 *
 * 1. `sky`: per pixel, Earth and the Moon as the Outside view's celestial meshes draw them (celestialShaders.ts,
 *    appearances 7 and 8), else the dome: the Sun's disc, its glare and Earth's lit limb (skyShaders.ts `skyRadiance`,
 *    with Earth and the Moon left to the meshes, as `bodiesInDome` 0 does). Exposed and capped (`DISPLAY_CAP`).
 * 2. `star`: the stars and every point of light as the STARS kind draws them (skyShaders.ts `starVertex`,
 *    `starColor`): a Gaussian spot with a small halo and four spikes, sized in pixels by how far its light shows,
 *    added on top, hidden behind Earth and the Moon.
 * 3. `output`: three.js's output pass for this renderer (ACES filmic tone mapping at exposure 1, then the sRGB curve).
 *
 * WebGPU only, written by hand on the raw device: the one exception to the material registry (docs/SHADERS.md),
 * because the opening has to draw before three.js has even loaded. Every number of the look comes from the same
 * constants the TSL reads (render/exposure.ts); the formulas follow the TSL line by line, each part naming its source.
 * The cloud noise is MaterialX's Perlin noise as three.js builds it (three/src/nodes/materialx/MaterialXNoise.js).
 */
import {
  DISPLAY_CAP, FLARE_FLOOR, FLARE_HALO, FLARE_HALO_PX, FLARE_MAX_PX, FLARE_SPIKE, FLARE_SPIKE_PX, FLARE_SPIKE_WIDTH, GLARE, GLARE_REACH, STAR_HALF, STAR_SIGMA,
} from '../render/exposure';

/** City lights at night, in the sky's radiance units (skyShaders.ts `outside.cityLights`). */
export const CITY_LIGHTS = 2e-4;

const f = (x: number): string => {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

/** The uniform block, in vec4s (see `writeUniforms` in worker.ts for what each holds). */
export const UNIFORM_VEC4S = 20;

export const OPENING_WGSL = /* wgsl */ `
struct U {
  right: vec4f,     // camera right; w: tan(half fov) * aspect
  up: vec4f,        // camera up; w: tan(half fov)
  fwd: vec4f,       // camera forward; w: exposure
  sun: vec4f,       // unit direction to the Sun; w: its angular radius
  earth: vec4f,     // unit direction to Earth's centre; w: sine of its angular radius
  moon: vec4f,
  earthX: vec4f, earthY: vec4f, earthZ: vec4f,   // scene -> Earth's own axes, by rows
  moonX: vec4f, moonY: vec4f, moonZ: vec4f,
  earthSun: vec4f,  // the Sun in Earth's axes; w: the sunlight on it (1 AU = 1)
  moonSun: vec4f,
  clouds: vec4f,    // the cloud field's offset; w: city lights
  misc: vec4f,      // x: stars' exposure, y: a pixel's solid angle, z: the Sun's unhidden share, w: irradiance
  view: vec4f,      // x, y: drawing buffer size (px); z: Earth nearer than the Moon (1/0); w: maps faded in (0-1)
  pad0: vec4f, pad1: vec4f, pad2: vec4f,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var surface: sampler;
@group(0) @binding(2) var dayMap: texture_2d<f32>;
@group(0) @binding(3) var nightMap: texture_2d<f32>;
@group(0) @binding(4) var moonMap: texture_2d<f32>;
@group(0) @binding(5) var hdr: texture_2d<f32>;

const PI = 3.14159265358979;
const CAP = ${f(DISPLAY_CAP)};

// ---- MaterialX Perlin noise (three.js MaterialXNoise.js: mx_perlin_noise_float for a vec3) -------------------

fn mx_rotl32(x: u32, k: u32) -> u32 { return (x << k) | (x >> (32u - k)); }

fn mx_bjfinal(a0: u32, b0: u32, c0: u32) -> u32 {
  var a = a0; var b = b0; var c = c0;
  c ^= b; c -= mx_rotl32(b, 14u);
  a ^= c; a -= mx_rotl32(c, 11u);
  b ^= a; b -= mx_rotl32(a, 25u);
  c ^= b; c -= mx_rotl32(b, 16u);
  a ^= c; a -= mx_rotl32(c, 4u);
  b ^= a; b -= mx_rotl32(a, 14u);
  c ^= b; c -= mx_rotl32(b, 24u);
  return c;
}

fn mx_hash_int(x: i32, y: i32, z: i32) -> u32 {
  let start = 0xdeadbeefu + (3u << 2u) + 13u;
  return mx_bjfinal(start + u32(x), start + u32(y), start + u32(z));
}

fn mx_negate_if(v: f32, b: bool) -> f32 { return select(v, -v, b); }

fn mx_gradient_float(hash: u32, x: f32, y: f32, z: f32) -> f32 {
  let h = hash & 15u;
  let uu = select(y, x, h < 8u);
  let vv = select(select(z, x, h == 12u || h == 14u), y, h < 4u);
  return mx_negate_if(uu, (h & 1u) != 0u) + mx_negate_if(vv, (h & 2u) != 0u);
}

fn mx_fade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

fn mx_trilerp(v0: f32, v1: f32, v2: f32, v3: f32, v4: f32, v5: f32, v6: f32, v7: f32, s: f32, t: f32, r: f32) -> f32 {
  let s1 = 1.0 - s; let t1 = 1.0 - t; let r1 = 1.0 - r;
  return r1 * (t1 * (v0 * s1 + v1 * s) + t * (v2 * s1 + v3 * s)) + r * (t1 * (v4 * s1 + v5 * s) + t * (v6 * s1 + v7 * s));
}

fn mx_perlin(p: vec3f) -> f32 {
  let X = i32(floor(p.x)); let Y = i32(floor(p.y)); let Z = i32(floor(p.z));
  let fx = p.x - f32(X); let fy = p.y - f32(Y); let fz = p.z - f32(Z);
  let uu = mx_fade(fx); let vv = mx_fade(fy); let ww = mx_fade(fz);
  let r = mx_trilerp(
    mx_gradient_float(mx_hash_int(X, Y, Z), fx, fy, fz),
    mx_gradient_float(mx_hash_int(X + 1, Y, Z), fx - 1.0, fy, fz),
    mx_gradient_float(mx_hash_int(X, Y + 1, Z), fx, fy - 1.0, fz),
    mx_gradient_float(mx_hash_int(X + 1, Y + 1, Z), fx - 1.0, fy - 1.0, fz),
    mx_gradient_float(mx_hash_int(X, Y, Z + 1), fx, fy, fz - 1.0),
    mx_gradient_float(mx_hash_int(X + 1, Y, Z + 1), fx - 1.0, fy, fz - 1.0),
    mx_gradient_float(mx_hash_int(X, Y + 1, Z + 1), fx, fy - 1.0, fz - 1.0),
    mx_gradient_float(mx_hash_int(X + 1, Y + 1, Z + 1), fx - 1.0, fy - 1.0, fz - 1.0),
    uu, vv, ww);
  return 0.982 * r;
}

// ---- the full-screen passes --------------------------------------------------------------------------------

struct Screen { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex fn screenVertex(@builtin(vertex_index) i: u32) -> Screen {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: Screen;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

/** A ray against a far sphere (skyShaders.ts farSphere): the normal at the near hit, and b (1 at the limb). */
struct Far { hit: bool, n: vec3f, b: f32, edge: vec3f };
fn farSphere(d: vec3f, c: vec3f, s: f32) -> Far {
  let cr = cross(d, c);
  let sin2 = dot(cr, cr);
  let along = dot(d, c);
  var o: Far;
  o.hit = along > 0.0 && sin2 < s * s;
  let t = along - sqrt(max(s * s - sin2, 0.0));
  o.n = normalize(d * t - c);
  o.edge = normalize(d * along - c);
  o.b = sqrt(sin2) / s;
  return o;
}

/** Equirectangular lookup coordinates and gradients (skyShaders.ts sphereMap): no mip seam where longitude wraps. */
struct MapAt { uv: vec2f, gx: vec2f, gy: vec2f };
fn mapAt(n: vec3f) -> MapAt {
  let uu = atan2(n.y, n.x) / (2.0 * PI) + 0.5;
  let vv = 0.5 - asin(clamp(n.z, -1.0, 1.0)) / PI;
  let u2 = fract(uu + 0.5);
  let gx = select(dpdx(u2), dpdx(uu), abs(dpdx(uu)) < abs(dpdx(u2)));
  let gy = select(dpdy(u2), dpdy(uu), abs(dpdy(uu)) < abs(dpdy(u2)));
  var o: MapAt;
  o.uv = vec2f(uu, vv);
  o.gx = vec2f(gx, dpdx(vv));
  o.gy = vec2f(gy, dpdy(vv));
  return o;
}

fn toEarth(v: vec3f) -> vec3f { return vec3f(dot(u.earthX.xyz, v), dot(u.earthY.xyz, v), dot(u.earthZ.xyz, v)); }
fn toMoon(v: vec3f) -> vec3f { return vec3f(dot(u.moonX.xyz, v), dot(u.moonY.xyz, v), dot(u.moonZ.xyz, v)); }

@fragment fn skyFragment(px: Screen) -> @location(0) vec4f {
  let d = normalize(u.fwd.xyz + px.ndc.x * u.right.w * u.right.xyz + px.ndc.y * u.up.w * u.up.xyz);
  let e = farSphere(d, u.earth.xyz, u.earth.w);
  let m = farSphere(d, u.moon.xyz, u.moon.w);
  // Surface lookups first, where every pixel of the quad still takes part (their gradients need it).
  let pE = normalize(toEarth(e.n));
  let pM = normalize(toMoon(m.n));
  let atE = mapAt(pE);
  let atM = mapAt(pM);
  let day = textureSampleGrad(dayMap, surface, atE.uv, atE.gx, atE.gy).rgb;
  let night = textureSampleGrad(nightMap, surface, atE.uv, atE.gx, atE.gy).rgb;
  let moonAlbedo = textureSampleGrad(moonMap, surface, atM.uv, atM.gx, atM.gy).rgb;

  // The dome (skyShaders.ts skyRadiance): the Sun's disc with limb darkening, the eye's glare, Earth's lit limb.
  let sunDir = u.sun.xyz;
  let th = sin(u.sun.w);
  let sa = cross(d, sunDir);
  let a2 = dot(sa, sa);
  let facing = dot(d, sunDir) > 0.0;
  let muS = sqrt(max(1.0 - a2 / (th * th), 0.0));
  let disc = select(0.0, 1.0 / (th * th * 0.8) * (1.0 - (1.0 - muS) * 0.6), facing && a2 < th * th);
  let glare = select(0.0, ${f(GLARE)} / (a2 + th * th) * exp(sqrt(a2) / -${f(GLARE_REACH)}), facing) * u.misc.z;
  let limb = exp(-max(e.b - 1.0, 0.0) / 0.004) * select(1.0, 0.0, e.hit) * select(0.0, 1.0, dot(d, u.earth.xyz) > 0.0);
  let scattered = vec3f(0.3, 0.5, 1.0) * smoothstep(-0.25, 0.2, dot(e.edge, sunDir));
  let through = vec3f(1.0, 0.42, 0.15) * pow(max(dot(d, sunDir), 0.0), 40.0) * 1.5;
  let sky = vec3f(1.0, 0.97, 0.92) * (disc * u.misc.z) + (scattered + through) * limb * 0.25;
  var color = min((sky + vec3f(1.0, 0.95, 0.88) * glare) * u.misc.w * u.fwd.w, vec3f(CAP));

  // Earth (celestialShaders.ts, appearance 7): the day map under drifting clouds, the city lights on the night side.
  let sunE = u.earthSun.xyz;
  let lightE = max(dot(pE, sunE), 0.0);
  let clouds = smoothstep(0.02, 0.4, mx_perlin(pE * 5.0 + u.clouds.xyz) + mx_perlin(pE * 27.0) * 0.2);
  let earth = mix(day, vec3f(0.8, 0.83, 0.86), clouds * 0.8) * lightE
    + night * u.clouds.w * (1.0 - smoothstep(-0.1, 0.02, dot(pE, sunE)));
  let earthSeen = min(earth * u.earthSun.w * u.view.w * u.fwd.w, vec3f(1e4));
  // The Moon (appearance 8): its albedo map, Lambert-lit.
  let moonSeen = min(moonAlbedo * 0.36 * max(dot(pM, u.moonSun.xyz), 0.0) * u.moonSun.w * u.view.w * u.fwd.w, vec3f(1e4));
  let earthFirst = u.view.z > 0.5;
  if (m.hit && !(e.hit && earthFirst)) { color = moonSeen; }
  if (e.hit && (earthFirst || !m.hit)) { color = earthSeen; }
  return vec4f(color, 1.0);
}

// ---- the stars and points of light (skyShaders.ts starVertex, starColor) -----------------------------------

struct Point { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) @interpolate(flat) peak: vec3f, @location(2) @interpolate(flat) reach: f32 };

fn covered(d: vec3f, c: vec3f, s: f32) -> f32 {
  let cr = cross(d, c);
  return select(1.0, 0.0, dot(d, c) > 0.0 && dot(cr, cr) < s * s);
}

@vertex fn starVertex(@builtin(vertex_index) i: u32, @location(0) dir: vec4f, @location(1) flux: vec4f) -> Point {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[i];
  let d = dir.xyz;
  // A star's brightest pixel: flux x pi over the pixel's solid angle x the spot's centre value.
  let toPeak = PI / (2.0 * PI * ${f(STAR_SIGMA)} * ${f(STAR_SIGMA)}) / u.misc.y * u.misc.x;
  let seen = select(1.0, covered(d, u.earth.xyz, u.earth.w) * covered(d, u.moon.xyz, u.moon.w), dir.w > 0.5);
  let peak = dot(flux.rgb, vec3f(0.2126, 0.7152, 0.0722)) * toPeak;
  let reach = clamp(log(max(peak * ${f(FLARE_SPIKE / FLARE_FLOOR)}, 1.0)) * ${f(FLARE_SPIKE_PX)}, ${f(STAR_HALF)}, ${f(FLARE_MAX_PX)});
  let z = dot(d, u.fwd.xyz);
  var o: Point;
  o.corner = corner;
  o.peak = flux.rgb * toPeak * seen;
  o.reach = reach;
  if (z <= 0.0 || seen == 0.0) {
    o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }
  let clip = vec4f(dot(d, u.right.xyz) / u.right.w, dot(d, u.up.xyz) / u.up.w, 0.0, z);
  o.pos = vec4f(clip.xy + corner * (reach * 2.0) / u.view.xy * clip.w, clip.z, clip.w);
  return o;
}

fn spike(along: f32, across: f32) -> f32 {
  return exp(abs(along) / -${f(FLARE_SPIKE_PX)}) * exp(across * across / -${f(2 * FLARE_SPIKE_WIDTH * FLARE_SPIKE_WIDTH)});
}

@fragment fn starFragment(p: Point) -> @location(0) vec4f {
  let px = p.corner * p.reach;
  let r = length(px);
  let core = exp(dot(px, px) / -${f(2 * STAR_SIGMA * STAR_SIGMA)});
  let halo = exp(r / -${f(FLARE_HALO_PX)}) * ${f(FLARE_HALO)};
  let spikes = (spike(px.x, px.y) + spike(px.y, px.x)) * ${f(FLARE_SPIKE)};
  let edge = 1.0 - smoothstep(0.75, 1.0, max(abs(p.corner.x), abs(p.corner.y)));
  let shape = core + (halo + spikes) * edge;
  return vec4f(min(p.peak * shape, vec3f(CAP)), 1.0);
}

// ---- three.js's output pass: ACES filmic (ToneMappingFunctions.js), then the sRGB curve ---------------------

fn rrtAndOdtFit(v: vec3f) -> vec3f {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

fn acesFilmic(c: vec3f) -> vec3f {
  let toAp1 = mat3x3f(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
  let fromAp1 = mat3x3f(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
  // The matrices are written row by row (each row sums to 1, so white stays white): a vector times a WGSL matrix
  // multiplies by its rows.
  return clamp(rrtAndOdtFit((c / 0.6) * toAp1) * fromAp1, vec3f(0.0), vec3f(1.0));
}

fn srgb(c: vec3f) -> vec3f {
  return select(c * 12.92, pow(c, vec3f(0.41666)) * 1.055 - 0.055, c > vec3f(0.0031308));
}

@fragment fn outputFragment(px: Screen) -> @location(0) vec4f {
  let c = textureLoad(hdr, vec2i(px.pos.xy), 0).rgb;
  return vec4f(srgb(acesFilmic(c)), 1.0);
}
`;
