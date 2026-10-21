/**
 * The shader pieces of the view outside (design "Solarpolis: the outside", O3): the sky dome with the Sun, Earth and
 * the Moon drawn analytically per pixel, the star points, and the habitat's hull lit by the Sun and by earthshine.
 * The kinds that use them live in the material registry (materials.ts); these are only node builders and uniforms.
 *
 * Units: radiance where a white Lambertian surface in full sunlight is 1, so the Sun's disc is about 46,000 and a
 * first-magnitude star a few millionths of a pixel's worth. `outside.exposure` scales everything before the tone
 * mapping: the view adapts it to what is in sight (render/outside.ts), as eyes do.
 *
 * The scene's axes are the home habitat's orbit frame (src/space: ecliptic of date), and the camera sits at the origin:
 * everything is placed relative to the eye, so `positionWorld` is the offset from the eye.
 */
import { DataTexture, Matrix3, RGBAFormat, SRGBColorSpace, Vector2, Vector3, type Texture } from 'three/webgpu';
import {
  abs, asin, atan, attribute, floor, fwidth, mx_noise_float, cameraProjectionMatrix, clamp, cross, dFdx, dFdy, dot, exp, float, fract, length, max, mix,
  modelViewMatrix, modelWorldMatrix, mx_fractal_noise_float, normalWorld, normalize, positionLocal, positionWorld, pow,
  select, smoothstep, sqrt, texture, uniform, varying, vec2, vec3, vec4, vertexColor,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { GLARE, GLARE_REACH } from './exposure';

/** Everything the outside's shaders read; set each frame by the view (render/outside.ts). */
export const outside = {
  exposure: uniform(1),
  /** Unit direction to the Sun, its angular radius (rad), and the share of its disc not hidden (eclipses). */
  sunDir: uniform(new Vector3(1, 0, 0)),
  sunRadius: uniform(0.00465),
  sunlight: uniform(1),
  /** Earth and Moon: unit direction to the centre, sine of the angular radius, and scene → body axes. */
  earthDir: uniform(new Vector3(0, -1, 0)),
  earthSin: uniform(0.15),
  earthAxes: uniform(new Matrix3()),
  moonDir: uniform(new Vector3(0, 1, 0)),
  moonSin: uniform(0.0045),
  moonAxes: uniform(new Matrix3()),
  /** Irradiance from Earth's lit side at the eye, relative to full sunlight. */
  earthshine: uniform(0),
  /** The cloud field's seeded offset and slow drift. */
  clouds: uniform(new Vector3()),
  /** City lights at night, in the radiance units above: dim, targeted light (Arnd: cities are much darker in 3026). */
  cityLights: uniform(2e-4),
  /** Solid angle of one pixel (sr): turns a star's flux into the radiance of its pixel. */
  pixelSolidAngle: uniform(1e-6),
  /** The drawing buffer's size in pixels, for the stars' fixed pixel size. */
  viewport: uniform(new Vector2(1280, 720)),
};

/** Placeholder until the maps load (render/outside.ts swaps them in). */
const blank = (): Texture => {
  const t = new DataTexture(new Uint8Array([20, 20, 30, 255]), 1, 1, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

/** The surface maps; their `.value` takes the loaded texture. */
export const skyMaps = {
  earthDay: texture(blank()),
  earthNight: texture(blank()),
  moon: texture(blank()),
};

/** Equirectangular lookup (longitude 0 in the middle) on a unit-sphere normal in the body's own axes, without the mip seam where longitude wraps. */
function sphereMap(map: typeof skyMaps.earthDay, n: Node<'vec3'>): Node<'vec4'> {
  const u = atan(n.y, n.x).div(2 * Math.PI).add(0.5);
  // The maps are not flipped: v = 0 is the top row, the north pole.
  const v = float(0.5).sub(asin(clamp(n.z, -1, 1)).div(Math.PI));
  // Derivatives of the same longitude measured from the opposite meridian: the smaller one is the true change.
  const u2 = fract(u.add(0.5));
  const gx = select(abs(dFdx(u)).lessThan(abs(dFdx(u2))), dFdx(u), dFdx(u2));
  const gy = select(abs(dFdy(u)).lessThan(abs(dFdy(u2))), dFdy(u), dFdy(u2));
  return map.sample(vec2(u, v)).grad(vec2(gx, dFdx(v)), vec2(gy, dFdy(v)));
}

/**
 * A ray from the eye against a far sphere given by its unit direction c and the sine of its angular radius s.
 * Returns whether it hits, the unit normal at the near hit, and the impact parameter b (1 at the limb, in radii).
 * The angle comes from the cross product, so the limb stays sharp at a few arcseconds in 32-bit floats.
 */
function farSphere(d: Node<'vec3'>, c: Node<'vec3'>, s: Node<'float'>): { hit: Node<'bool'>; n: Node<'vec3'>; b: Node<'float'>; edge: Node<'vec3'> } {
  const cr = cross(d, c);
  const sin2 = dot(cr, cr);
  const along = dot(d, c);
  const hit = along.greaterThan(0).and(sin2.lessThan(s.mul(s)));
  const t = along.sub(sqrt(max(s.mul(s).sub(sin2), 0)));
  const n = normalize(d.mul(t).sub(c));
  // Nearest point of the ray to the centre, as a direction from the centre: where the limb glow is lit from.
  const edge = normalize(d.mul(along).sub(c));
  return { hit, n, b: sqrt(sin2).div(s), edge };
}

/** Earth seen from outside: day map, seeded clouds, ocean glint, the thin blue limb and the dim city lights. */
function earthColor(d: Node<'vec3'>, e: ReturnType<typeof farSphere>): Node<'vec3'> {
  const nE = outside.earthAxes.mul(e.n);
  const mu0 = dot(e.n, outside.sunDir), mu = max(dot(e.n, d.negate()), 0);
  const day = sphereMap(skyMaps.earthDay, nE).rgb;
  // Clouds: a seeded fractal field, busier at middle latitudes and thinner in the subtropics.
  const lat = asin(clamp(nE.z, -1, 1));
  const band = lat.mul(6).cos().mul(0.1).add(lat.abs().mul(0.12));
  // Two scales: weather systems, and the streets of cumulus inside them; soft edges, thin veils between.
  const big = mx_fractal_noise_float(nE.mul(3.5).add(outside.clouds), 4, 2.1, 0.5);
  const fine = mx_fractal_noise_float(nE.mul(28).add(outside.clouds.mul(1.7)), 4, 2.3, 0.6);
  const cover = big.mul(0.8).add(fine.mul(0.35)).add(band).sub(0.2);
  const cloud = smoothstep(-0.1, 0.45, cover).mul(0.85);
  const ocean = smoothstep(0.004, 0.02, day.b.sub(max(day.r, day.g)));
  const surface = mix(day, vec3(0.82, 0.84, 0.88), cloud);
  const lit = max(mu0, 0).mul(outside.sunlight);
  // Sun glint on open water.
  const half = normalize(outside.sunDir.sub(d));
  const glint = pow(max(dot(e.n, half), 0), 900).mul(ocean).mul(float(1).sub(cloud)).mul(lit).mul(0.6);
  // The air seen edge-on near the limb turns the disc blue, on the day side.
  const air = pow(float(1).sub(mu), 3).mul(smoothstep(-0.15, 0.25, mu0)).mul(0.35);
  const lights = max(sphereMap(skyMaps.earthNight, nE).r.sub(0.003), 0).mul(outside.cityLights).mul(8)
    .mul(smoothstep(0.02, -0.12, mu0)).mul(float(1).sub(cloud.mul(0.8)));
  return surface.mul(lit).add(glint).add(vec3(0.22, 0.42, 1).mul(air)).add(vec3(1, 0.78, 0.45).mul(lights));
}

/** The Moon: its albedo map (mean albedo 0.12), lit Lommel-Seeliger, so the full Moon looks flat as it does. */
function moonColor(d: Node<'vec3'>, m: ReturnType<typeof farSphere>): Node<'vec3'> {
  const nM = outside.moonAxes.mul(m.n);
  const mu0 = max(dot(m.n, outside.sunDir), 0), mu = max(dot(m.n, d.negate()), 1e-3);
  const albedo = sphereMap(skyMaps.moon, nM).rgb.mul(0.36);
  return albedo.mul(mu0.mul(2).div(mu0.add(mu))).mul(outside.sunlight).add(albedo.mul(2e-4));
}

/** Radiance of the sky in direction d (unit, scene axes): Earth over the Moon over the Sun, plus the eye's glare. */
export function skyRadiance(d: Node<'vec3'>): Node<'vec3'> {
  const e = farSphere(d, outside.earthDir, outside.earthSin);
  const m = farSphere(d, outside.moonDir, outside.moonSin);
  // The Sun's disc with limb darkening, its mean radiance π / Ω (white paper in sunlight is 1).
  const th = outside.sunRadius;
  const sa = cross(d, outside.sunDir), a2 = dot(sa, sa), facing = dot(d, outside.sunDir).greaterThan(0);
  const muS = sqrt(max(float(1).sub(a2.div(th.mul(th))), 0));
  const disc = select(facing.and(a2.lessThan(th.mul(th))), float(1).div(th.mul(th).mul(0.8)).mul(float(1).sub(muS.oneMinus().mul(0.6))), float(0));
  // Glare: light scattered in the eye, falling with the square of the angle from the Sun and fading out past ten degrees.
  const glare = select(facing, float(GLARE).div(a2.add(th.mul(th))).mul(exp(sqrt(a2).div(-GLARE_REACH))), float(0)).mul(outside.sunlight);
  // Earth's limb outside the disc: a thin shell of lit air, bright where the Sun lights it or shines through it.
  const limb = exp(e.b.sub(1).max(0).negate().div(0.004)).mul(select(e.hit, float(0), float(1))).mul(dot(d, outside.earthDir).greaterThan(0).select(float(1), float(0)));
  // Blue where sunlight scatters off the lit air; red-orange where it shines through the air from behind (sunsets
  // all around Earth's rim when the habitat is in its shadow).
  const scattered = vec3(0.3, 0.5, 1).mul(smoothstep(-0.25, 0.2, dot(e.edge, outside.sunDir)));
  const through = vec3(1, 0.42, 0.15).mul(pow(max(dot(d, outside.sunDir), 0), 40).mul(1.5));
  const sky = vec3(1, 0.97, 0.92).mul(disc.mul(outside.sunlight)).add(scattered.add(through).mul(limb).mul(0.25));
  const behind = select(m.hit, moonColor(d, m), sky);
  return select(e.hit, earthColor(d, e), behind).add(vec3(1, 0.95, 0.88).mul(glare));
}

/** The sky dome's colour: everything beyond the habitat, exposed. */
export function skyDome(): Node<'vec3'> {
  return skyRadiance(normalize(positionWorld)).mul(outside.exposure);
}

/** Star quads: σ of the Gaussian spot (px) and the half size of the quad (px). */
export const STAR_SIGMA = 0.75;
export const STAR_HALF = 3 * STAR_SIGMA;

/**
 * The stars: tiny quads that always face the camera, a fixed number of pixels across. Each carries its direction
 * (position), its colour × flux relative to the Sun (color) and its quad corner (corner, ±1). Its total light is the
 * star's: flux × π over the pixel's solid angle, spread in a Gaussian. Hidden where Earth or the Moon stands in front.
 */
export function starVertex(): Node<'vec4'> {
  const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
  const corner = attribute<'vec2'>('corner', 'vec2');
  return vec4(clip.xy.add(corner.mul(STAR_HALF * 2).div(outside.viewport).mul(clip.w)), clip.zw);
}

export function starColor(): Node<'vec3'> {
  const corner = varying(attribute<'vec2'>('corner', 'vec2'));
  const dir = normalize(modelWorldMatrix.mul(vec4(positionLocal, 0)).xyz);
  const covered = (c: Node<'vec3'>, s: Node<'float'>): Node<'float'> => {
    const cr = cross(dir, c);
    return select(dot(dir, c).greaterThan(0).and(dot(cr, cr).lessThan(s.mul(s))), float(0), float(1));
  };
  const seen = varying(covered(outside.earthDir, outside.earthSin).mul(covered(outside.moonDir, outside.moonSin)));
  const r2 = dot(corner, corner).mul(STAR_HALF * STAR_HALF);
  const spot = exp(r2.div(-2 * STAR_SIGMA * STAR_SIGMA)).div(2 * Math.PI * STAR_SIGMA * STAR_SIGMA);
  return vertexColor().rgb.mul(seen).mul(spot).mul(Math.PI).div(outside.pixelSolidAngle).mul(outside.exposure);
}

/**
 * The hull: albedo from the vertex colour (solar skin, endcap faces, brims, spindle), a patchwork of panels two
 * centuries of repair have left, lit by the Sun and by earthshine, with the glint of sunlight on the glass skin.
 */
export function hullColor(): Node<'vec3'> {
  const n = normalWorld;
  const d = normalize(positionWorld);
  const sun = max(dot(n, outside.sunDir), 0).mul(outside.sunlight);
  const earth = max(dot(n, outside.earthDir), 0).mul(outside.earthshine);
  const p = positionLocal;
  // Panels 60 m on a side: along the axis, around it, and in rings on the endcap faces. Each panel has its own shade
  // (two centuries of replacements), over slower patches of weathering.
  const PANEL = 60;
  const arc = atan(p.y, p.x).mul(length(p.xy));
  const cell = floor(vec3(p.z.div(PANEL), arc.div(PANEL), length(p.xy).div(PANEL)));
  const panel = mx_noise_float(cell.mul(0.731).add(0.5)).mul(0.18).add(1);
  const patch = mx_fractal_noise_float(p.mul(1 / 900), 3, 2, 0.5).mul(0.2).add(1);
  // Seams, faded out where they get thinner than a pixel so they never shimmer.
  const seam = (x: Node<'float'>): Node<'float'> => {
    const f = fract(x), w = fwidth(x);
    const line = smoothstep(0, 0.02, f).mul(smoothstep(0, 0.02, f.oneMinus()));
    return mix(float(1), line, clamp(float(1).sub(w.div(0.05)), 0, 1));
  };
  const seams = seam(p.z.div(PANEL)).mul(seam(arc.div(PANEL))).mul(seam(length(p.xy).div(PANEL)));
  const base = vertexColor().rgb;
  const albedo = base.mul(panel).mul(patch).mul(mix(float(0.55), float(1), seams));
  // Dark glass glints most.
  const gloss = float(1).sub(dot(base, vec3(0.2126, 0.7152, 0.0722)).mul(2)).max(0);
  const glint = pow(max(dot(n, normalize(outside.sunDir.sub(d))), 0), 120).mul(sun).mul(gloss).mul(3);
  return albedo.mul(sun.add(earth)).add(glint).mul(outside.exposure);
}
