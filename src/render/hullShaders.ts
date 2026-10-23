/**
 * The shader pieces of a habitat seen from outside (design "Solarpolis: the outside", O4): the solar skin's patchwork
 * per pixel, the radiators (endcap faces and brims), and the plain hardware (spindle, berth arms, mast). The kinds that
 * use them live in the material registry (materials.ts); lighting and units as in skyShaders.ts.
 *
 * The skin is the very grid of gen/skin.ts: the same integer hashes (`hash3i` from @futuremagic/core, mirrored here)
 * of the same seed pick each panel's kind, age and shade, so the near view, the far glints and the interior agree.
 * Each habitat's mesh carries its skin in `userData.skin` (`skinUniforms`), read per object, so one material draws
 * every habitat in the ring.
 */
import { Vector4 } from 'three/webgpu';
import {
  Fn, abs, atan, attribute, clamp, dot, float, floor, fract, fwidth, length, max, min, mix, modelWorldMatrix, mx_noise_float,
  normalLocal, normalWorld, normalize, positionLocal, positionWorld, pow, select, smoothstep, uint, uniform, vec2, vec3,
  vec4, vertexColor,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { GLINT_GAIN, GLINT_POWER, LOOK, SALT, type Columns, type Skin } from '../gen/skin';
import { DENSITY, MEAN_SHADE, PORT_SALT, PORT_TINT, QUARTER, TOGGLE_HOURS, bandMean, litShare, type PortFace } from '../gen/portFace';
import { DISPLAY_CAP, outside } from './skyShaders';
import { MASK_WORDS, ROOT_SPAN, type CoverMask } from '../gen/detailTree';
import { band, keepMean, lineAt, shows } from './shaderMath';

/** A habitat's skin as the four vectors its mesh hands the shader (`mesh.userData.skin`). */
export interface SkinUniforms {
  grid: Vector4;
  campaign: Vector4;
  age: Vector4;
  seed: Vector4;
  mean: Vector4;
  /** (modules a panel holds a side, cells a module holds a side, a module's edge (m), unused). */
  parts: Vector4;
  /**
   * Where the near tiles cover the drum this frame, so the far skin hides there (`coverMask`, gen/detailTree.ts):
   * (root tile size in panels, the eye's root column and row, root columns around), and the mask's four words.
   */
  hidden: Vector4;
  hiddenBits: Vector4;
}

/** Hand the skin's mesh this frame's cover mask. */
export function hideUnder(u: SkinUniforms, m: CoverMask): void {
  u.hidden.set(m.size, m.i, m.j, m.around);
  u.hiddenBits.set(m.words[0], m.words[1], m.words[2], m.words[3]);
}

export function skinUniforms(s: Skin, c: Columns): SkinUniforms {
  return {
    grid: new Vector4(s.nTheta, s.nZ, s.z0, s.z1),
    campaign: new Vector4(s.around, s.along, s.collectorQ, s.starfloors),
    age: new Vector4(s.age, s.panelLife, s.roomLight, s.radius),
    // The seed in two 16-bit halves: a float holds each exactly.
    seed: new Vector4(s.seed >>> 16, s.seed & 0xffff, s.trackEvery, s.trackWidth),
    mean: new Vector4(c.mean.albedo[0], c.mean.albedo[1], c.mean.albedo[2], c.mean.gloss),
    parts: new Vector4(s.modules, s.cells, (2 * Math.PI * s.radius) / s.nTheta / s.modules, 0),
    hidden: new Vector4(0, 0, 0, 1),
    hiddenBits: new Vector4(),
  };
}

const blank = (): SkinUniforms => skinUniforms(
  { seed: 0, nTheta: 8, nZ: 1, z0: 0, z1: 1, radius: 1, collectorQ: 0, starfloors: 0, around: 1, along: 1, age: 0, panelLife: 1, roomLight: 0, trackEvery: 2, trackWidth: 1, dronesPerTrack: 1, droneSize: 1, droneSpeed: 1, modules: 1, cells: 1 },
  { albedo: new Float32Array(24), gloss: new Float32Array(8), mean: { albedo: [0, 0, 0], gloss: 0, emit: 0 } },
);
const fallback = blank();
const perObject = (k: keyof SkinUniforms) => uniform(new Vector4()).onObjectUpdate(({ object }) => ((object?.userData.skin as SkinUniforms | undefined) ?? fallback)[k]);
const skin = { grid: perObject('grid'), campaign: perObject('campaign'), age: perObject('age'), seed: perObject('seed'), mean: perObject('mean'), parts: perObject('parts'), hidden: perObject('hidden'), hiddenBits: perObject('hiddenBits') };

/** lowbias32 (`hash32` in @futuremagic/core), on 32-bit unsigned integers, which wrap as JavaScript's Math.imul does. */
const hash32Fn = Fn(([x]: [Node<'uint'>]) => {
  let h = x.bitXor(x.shiftRight(uint(16)));
  h = h.mul(uint(0x7feb352d));
  h = h.bitXor(h.shiftRight(uint(15)));
  h = h.mul(uint(0x846ca68b));
  return h.bitXor(h.shiftRight(uint(16)));
}).setLayout({ name: 'skinHash32', type: 'uint', inputs: [{ name: 'x', type: 'uint' }] });
// One WGSL function, called wherever the skin hashes (the shaders stay small enough to build within the budget).
const hash32 = (x: Node<'uint'>): Node<'uint'> => hash32Fn(x) as unknown as Node<'uint'>;

/** `hash3i(seed, x, y, z)` from @futuremagic/core. */
function hash3(seed: Node<'uint'>, x: Node<'uint'>, y: Node<'uint'>, z: number): Node<'uint'> {
  const hz = hash32(uint(Math.imul(z, 0x9e3779b1) >>> 0));
  const hy = hash32(y.mul(uint(0x165667b1)).bitXor(hz));
  return hash32(seed.bitXor(hash32(x.mul(uint(0x27d4eb2d)).bitXor(hy))));
}

/** `hash3i(seed, x, y, z)` with z worked out per pixel (a uint multiply wraps as Math.imul does). */
function hash3z(seed: Node<'uint'>, x: Node<'uint'>, y: Node<'uint'>, z: Node<'uint'>): Node<'uint'> {
  const hz = hash32(z.mul(uint(0x9e3779b1)));
  const hy = hash32(y.mul(uint(0x165667b1)).bitXor(hz));
  return hash32(seed.bitXor(hash32(x.mul(uint(0x27d4eb2d)).bitXor(hy))));
}

/** `hashToFloat`: the top 24 bits as a float in [0, 1). */
const toFloat = (h: Node<'uint'>): Node<'float'> => float(h.shiftRight(uint(8))).div(16777216);

/** The skin's 32-bit seed, put back together from its two halves. */
const skinSeed = (): Node<'uint'> => uint(skin.seed.x).shiftLeft(uint(16)).bitOr(uint(skin.seed.y));

const v3 = (c: readonly number[]): Node<'vec3'> => vec3(c[0], c[1], c[2]);

const TRACK = LOOK.track;
/**
 * The panel frames stand proud of the glass: over the outer FRAME_BEVEL of each panel the surface tilts by up to
 * FRAME_TILT (as a share of the normal) toward the panel's middle, so frames catch the Sun at their own angle.
 */
const FRAME_BEVEL = 0.012;
const FRAME_TILT = 0.6;

/** A seam line where x crosses a whole number, `width` wide (in x's units), faded out where thinner than a pixel. */
function seam(x: Node<'float'>, width: number): Node<'float'> {
  const f = fract(x), w = fwidth(x);
  const line = smoothstep(0, width, f).mul(smoothstep(0, width, f.oneMinus()));
  return mix(float(1), line, clamp(float(1).sub(w.div(width * 2)), 0, 1));
}

/** The light on a surface with this normal: the Sun (less what Earth or the Moon hide) and earthshine. */
/** The light on a surface: the Sun's share (for its glint) and all of it, relative to full sunlight. */
type Light = { sun: Node<'float'>; all: Node<'float'> };

function lightOn(n: Node<'vec3'>): Light {
  const sun = max(dot(n, outside.sunDir), 0).mul(outside.sunlight);
  return { sun, all: sun.add(max(dot(n, outside.earthDir), 0).mul(outside.earthshine)) };
}

/** The glass's glint of the Sun, as gen/skin.ts's `skinFlux` has it. */
function glint(n: Node<'vec3'>, sun: Node<'float'>, gloss: Node<'float'>, sharp = 1): Node<'float'> {
  const h = normalize(outside.sunDir.sub(normalize(positionWorld)));
  return pow(max(dot(n, h), 0), GLINT_POWER * sharp).mul(sun).mul(gloss).mul(GLINT_GAIN * sharp);
}

/** A panel's look from its column and row: kind, age and shade exactly as `panelAt` and `lookOf` in gen/skin.ts. */
function panelLook(i: Node<'uint'>, j: Node<'uint'>) {
  const around = skin.campaign.x, along = skin.campaign.y, q = skin.campaign.z, starfloors = skin.campaign.w;
  const habitatAge = skin.age.x, life = skin.age.y, roomLight = skin.age.z;
  const seed = skinSeed();
  const u = (x: Node<'uint'>, y: Node<'uint'>, salt: number): Node<'float'> => toFloat(hash3(seed, x, y, salt));
  // The campaign (campaignAt): bands of columns, each starting its patches at its own row.
  const I = i.div(uint(around));
  const offset = hash3(seed, I, uint(0), SALT.offset).mod(uint(along));
  const J = j.add(offset).div(uint(along));
  const campaignAge = u(I, J, SALT.campaign).mul(habitatAge);
  const replaced = u(i, j, SALT.replaced).lessThan(float(1).sub(campaignAge.negate().div(life).exp()));
  const age = select(replaced, u(i, j, SALT.replacedAge).mul(campaignAge), campaignAge);
  const collector = i.add(uint(1)).mul(uint(q)).shiftRight(uint(16)).notEqual(i.mul(uint(q)).shiftRight(uint(16)));
  const starfloor = collector.not().and(u(i, j, SALT.starfloor).lessThan(starfloors));
  const k = u(i, j, SALT.shade).sub(0.5).mul(LOOK.shade).add(1);
  const weathered = (a: Node<'float'>): Node<'float'> => float(1).sub(a.negate().div(life).exp());
  const cellOf = (a: Node<'float'>): Node<'vec3'> => mix(v3(LOOK.cellNew), v3(LOOK.cellOld), weathered(a));
  const collectorOf = (a: Node<'float'>): Node<'vec3'> => v3(LOOK.collector).mul(weathered(a).mul(0.5).add(1));
  const collectorGloss = (a: Node<'float'>): Node<'float'> => mix(float(LOOK.collectorGloss[0]), float(LOOK.collectorGloss[1]), weathered(a));
  return {
    collector, starfloor, campaignAge, cellOf, collectorOf, collectorGloss,
    albedo: select(collector, collectorOf(age).mul(k), select(starfloor, v3(LOOK.starfloor), cellOf(age).mul(k))) as Node<'vec3'>,
    gloss: select(collector, collectorGloss(age), select(starfloor, float(LOOK.starfloorGloss), float(LOOK.cellGloss))) as Node<'float'>,
    emit: select(starfloor, roomLight, float(0)) as Node<'float'>,
  };
}

/** The light a surface sends to the eye: diffuse under the Sun and earthshine, the glint, light from behind it. */
function shade(albedo: Node<'vec3'>, gloss: Node<'float'>, emit: Node<'float'>, local: Node<'vec3'>, sharp = 1): Node<'vec3'> {
  const n = normalize(modelWorldMatrix.mul(vec4(local, 0)).xyz);
  const light = lightOn(n);
  return albedo.mul(light.all).add(glint(n, light.sun, gloss, sharp)).add(vec3(1, 0.86, 0.66).mul(emit)).mul(outside.exposure);
}

/**
 * Whether the far skin shows at this pixel: not where the near tiles cover the drum (`masked` in gen/detailTree.ts,
 * mirrored), so the two never fight over the same surface (Arnd, 2026-10-21).
 */
export function skinShown(): Node<'bool'> {
  const p = positionLocal, size = skin.hidden.x, around = skin.hidden.w, side = 2 * ROOT_SPAN + 1;
  const fi = fract(atan(p.y, p.x).div(2 * Math.PI)).mul(skin.grid.x);
  const fj = p.z.sub(skin.grid.z).div(skin.grid.w.sub(skin.grid.z)).mul(skin.grid.y);
  const d = floor(fi.div(size)).sub(skin.hidden.y);
  const di = d.sub(around.mul(floor(d.div(around).add(0.5)))), dj = floor(fj.div(size)).sub(skin.hidden.z);
  const inside = size.greaterThan(0).and(abs(di).lessThanEqual(ROOT_SPAN)).and(abs(dj).lessThanEqual(ROOT_SPAN));
  const bit = di.add(ROOT_SPAN).mul(side).add(dj.add(ROOT_SPAN)), slot = floor(bit.div(24)), shift = bit.sub(slot.mul(24));
  const words = (['x', 'y', 'z', 'w'] as const).slice(0, MASK_WORDS).map((c) => skin.hiddenBits[c]);
  let word = words[0] as Node<'float'>;
  for (let k = 1; k < words.length; k++) word = select(slot.equal(k), words[k], word);
  const set = fract(floor(word.div(pow(2, shift))).mul(0.5)).greaterThan(0.25);
  return inside.and(set).not();
}

/**
 * The solar skin, per pixel: which panel this is (column around from θ = 0, row along from the wild face), its kind,
 * age and shade exactly as `panelAt` in gen/skin.ts; seams and the modules inside a panel close up. Where panels shrink
 * below a pixel the look blends to the repair patch's, and where patches do too, to the skin's mean, so it never shimmers.
 * Near the eye the detail tiles (`skinDetailColor`) lie over it.
 */
export function skinColor(): Node<'vec3'> {
  const p = positionLocal;
  const nTheta = skin.grid.x, nZ = skin.grid.y, z0 = skin.grid.z, z1 = skin.grid.w;
  const around = skin.campaign.x, along = skin.campaign.y, q = skin.campaign.z, starfloors = skin.campaign.w;
  const roomLight = skin.age.z, radius = skin.age.w, modules = skin.parts.x;

  const fi = fract(atan(p.y, p.x).div(2 * Math.PI)).mul(nTheta);
  const fj = p.z.sub(z0).div(z1.sub(z0)).mul(nZ);
  const i = uint(clamp(floor(fi), 0, nTheta.sub(1))), j = uint(clamp(floor(fj), 0, nZ.sub(1)));
  const panel = panelLook(i, j), collector = panel.collector;

  // The patch's look with its panels below a pixel: collectors and cells mixed by their share.
  const share = q.div(65536);
  const patchAlbedo = mix(panel.cellOf(panel.campaignAge), panel.collectorOf(panel.campaignAge), share).mul(LOOK.frameMean);
  const patchGloss = mix(float(LOOK.cellGloss), panel.collectorGloss(panel.campaignAge), share);
  const meanEmit = share.oneMinus().mul(starfloors).mul(roomLight);

  // Panels per pixel, from how fast the position changes across the pixel (no seam where θ wraps).
  const panelSize = radius.mul(2 * Math.PI).div(nTheta);
  const perPixel = length(fwidth(p)).div(panelSize);
  const panelDetail = float(1).sub(smoothstep(0.25, 1, perPixel));
  const patchDetail = float(1).sub(smoothstep(0.25, 1, perPixel.div(min(around, along))));
  const near = (a: Node<'vec3'> | Node<'float'>, b: Node<'vec3'> | Node<'float'>, c: Node<'vec3'> | Node<'float'>) =>
    mix(a as Node<'vec3'>, mix(b as Node<'vec3'>, c as Node<'vec3'>, panelDetail), patchDetail);
  // Inside a panel: the beams between panels, and its modules (`modules` a side) or the collector's light guides.
  const frame = seam(fi, 0.01).mul(seam(fj, 0.01));
  const cells = select(collector, seam(fi.mul(modules.mul(0.5)), 0.05), seam(fi.mul(modules), 0.04).mul(seam(fj.mul(modules), 0.04)));
  const inner = mix(float(0.5), float(1), frame).mul(mix(float(0.8), float(1), cells));
  let albedo = near(skin.mean.xyz, patchAlbedo, panel.albedo.mul(inner)) as Node<'vec3'>;
  let gloss = near(skin.mean.w, patchGloss, panel.gloss) as unknown as Node<'float'>;
  const emit = near(meanEmit, meanEmit, panel.emit.mul(frame)) as unknown as Node<'float'>;

  // The frames' bevel: the normal tilts toward the panel's middle near each edge, around and along (local axes).
  const r = length(p.xy), radial = vec3(p.x.div(r), p.y.div(r), 0), tangent = vec3(p.y.negate().div(r), p.x.div(r), 0);
  const edge = (f: Node<'float'>): Node<'float'> =>
    float(1).sub(smoothstep(0, FRAME_BEVEL, f)).sub(float(1).sub(smoothstep(0, FRAME_BEVEL, f.oneMinus())));
  const tilt = vec2(edge(fract(fi)), edge(fract(fj))).mul(FRAME_TILT).mul(panelDetail);

  // Drone tracks in the seam below every trackEvery-th column: a channel with two rails and ties across.
  const trackEvery = skin.seed.z, trackWidth = skin.seed.w;
  const fromSeam = fract(fi.div(trackEvery).add(0.5)).sub(0.5).mul(trackEvery).mul(panelSize);
  const across = fromSeam.div(trackWidth).add(0.5);
  const onTrack = across.greaterThan(0).and(across.lessThan(1));
  const rail = (at: number): Node<'float'> => float(1).sub(smoothstep(TRACK.railWidth * 0.5, TRACK.railWidth, abs(across.sub(at))));
  const rails = max(rail(0.5 - TRACK.railAt), rail(0.5 + TRACK.railAt));
  const ties = float(1).sub(seam(p.z.div(TRACK.tieEvery), 0.15));
  const trackAlbedo = mix(v3(TRACK.channel).mul(float(1).sub(ties.mul(0.3))), v3(TRACK.rail), rails);
  // Seen from too far for the track's width, it does not vanish: its light joins the skin's in the share of the
  // drum it covers (Arnd, 2026-10-21: nothing vanishes with distance).
  const trackDetail = float(1).sub(smoothstep(0.5, 2, length(fwidth(p)).div(trackWidth)));
  const track = select(onTrack, trackDetail, float(0));
  const trackShare = trackWidth.div(trackEvery.mul(panelSize)).mul(float(1).sub(trackDetail));
  albedo = mix(mix(albedo, mix(v3(TRACK.channel), v3(TRACK.rail), 2 * TRACK.railWidth * 0.75), trackShare), trackAlbedo, track);
  gloss = mix(mix(gloss, float(2 * TRACK.railWidth * 0.75 * TRACK.railGloss), trackShare), rails.mul(TRACK.railGloss), track);

  const local = normalize(radial.add(tangent.mul(tilt.x)).add(vec3(0, 0, 1).mul(tilt.y)).mul(float(1).sub(track)).add(radial.mul(track)));
  return shade(albedo, gloss, emit.mul(float(1).sub(track)), local);
}

/** The cells' silver: fingers across each cell, busbars along it; the white backsheet showing between cells. */
const FINGERS = 64;
const FINGER = { width: 0.12, contrast: 5 };
const BUSBARS = 5;
const BUSBAR = { width: 0.05, contrast: 8 };
const CELL_GAP = { width: 0.025, contrast: 6 };
/** Light collectors: lenses (two cells a side) of concentric Fresnel rings tilting the glass up to LENS_TILT. */
const LENS_RINGS = 10;
const LENS_TILT = 0.35;
/** Dust and grime (wavelengths, m), scratches (width, m) and micrometeoroid pits (lattice, m), each finer octave smaller and more common. */
const DUST = [0.6, 0.15, 0.04];
const SCRATCH = { width: 1e-4, length: 0.3, share: 0.02, contrast: 2.5 };
const PITS = [{ cell: 0.08, chance: 0.15 }, { cell: 0.02, chance: 0.3 }, { cell: 0.005, chance: 0.5 }];
const PIT = { radius: [0.06, 0.16] as [number, number], rimContrast: 4, share: 0.012 };
/**
 * Up close the glint sharpens to the glass's own (GLINT_SHARP times the far view's power): no pane lies quite flat,
 * each module tilts by up to MODULE_TILT, so seen from afar the sharp glints of many modules add up to the far view's
 * broad one.
 */
const GLINT_SHARP = 12;
const MODULE_TILT = 0.09;

/**
 * The skin up close (gen/hullDetail.ts): each module's glass in its frame, its own shade within its panel's, the
 * cells, their silver fingers and busbars, dead cells, the collectors' Fresnel lenses, and the wear of two centuries
 * on the glass: dust, scratches and pits of every size, each layer fading in octave by octave as the eye comes closer
 * and every one keeping the mean the far view shows. The `grid` attribute is (column, row, module x, module y).
 */
export function skinDetailColor(): Node<'vec3'> {
  const m = attribute<'vec4'>('grid', 'vec4');
  const modules = skin.parts.x, cells = skin.parts.y, moduleEdge = skin.parts.z;
  // The bay's column and row are whole numbers, but interpolated they can land a hair below one: round, never cut,
  // or a triangle of the bay takes its neighbour's look.
  const i = uint(m.x.add(0.5)), j = uint(m.y.add(0.5)), panel = panelLook(i, j), seed = skinSeed();
  const a = clamp(floor(m.z), 0, modules.sub(1)), b = clamp(floor(m.w), 0, modules.sub(1));
  const mi = i.mul(uint(modules)).add(uint(a)), mj = j.mul(uint(modules)).add(uint(b));
  const fx = m.z.sub(a), fy = m.w.sub(b);
  const u = (x: Node<'uint'>, y: Node<'uint'>, salt: number): Node<'float'> => toFloat(hash3(seed, x, y, salt));
  // Each module's own shade and tilt only while modules are bigger than a pixel: below, a pixel would pick one
  // module's at random and the glass would sparkle as the eye moves; their mean (no shade, no tilt) stands in.
  const moduleShows = shows(vec2(m.z, m.w));
  const moduleShade = u(mi, mj, SALT.module).sub(0.5).mul(LOOK.moduleShade).mul(moduleShows).add(1);
  let albedo = panel.albedo.mul(moduleShade) as Node<'vec3'>;
  let gloss = panel.gloss;
  const nLocal = normalize(normalLocal), aroundLocal = normalize(vec3(nLocal.y.negate(), nLocal.x, 0)), alongLocal = vec3(0, 0, 1);
  // Each module's own tilt: its glint, sharp up close, lands on its own spot.
  let tilt = vec2(u(mi, mj, SALT.module + 30), u(mj, mi, SALT.module + 30)).sub(0.5).mul(2 * MODULE_TILT).mul(moduleShows) as Node<'vec2'>;

  // Solar cells: their gaps, dead ones, the fingers across them and the busbars along.
  const cx = fx.mul(cells), cy = fy.mul(cells);
  const cellShows = shows(vec2(cx, cy));
  const gaps = keepMean(max(lineAt(cx, CELL_GAP.width), lineAt(cy, CELL_GAP.width)), CELL_GAP.width * 2, CELL_GAP.contrast, cellShows);
  const dead = u(mi.mul(uint(cells)).add(uint(floor(cx))), mj.mul(uint(cells)).add(uint(floor(cy))), SALT.cell).lessThan(LOOK.deadCells);
  const fingers = keepMean(lineAt(cy.mul(FINGERS), FINGER.width), FINGER.width, FINGER.contrast, shows(cy.mul(FINGERS)));
  const busbars = keepMean(lineAt(cx.mul(BUSBARS).add(0.5), BUSBAR.width), BUSBAR.width, BUSBAR.contrast, shows(cx.mul(BUSBARS)));
  const cellAlbedo = mix(albedo.mul(gaps).mul(fingers).mul(busbars), v3(LOOK.cellDead), select(dead, cellShows, float(0)));

  // Collectors: lenses two cells a side, each of concentric rings whose facets tilt the glass outward.
  const lens = vec2(fx, fy).mul(cells.mul(0.5)), d = fract(lens).sub(0.5), rho = length(d);
  const lensShows = shows(lens), ringShows = shows(rho.mul(LENS_RINGS));
  const facet = d.mul(LENS_TILT * 2).mul(ringShows).mul(float(1).sub(lineAt(rho.mul(LENS_RINGS), 0.1).mul(0.5)));
  const lensRims = keepMean(max(lineAt(lens.x, 0.04), lineAt(lens.y, 0.04)), 0.08, 1.8, lensShows);
  albedo = select(panel.collector, albedo.mul(lensRims), select(panel.starfloor, albedo, cellAlbedo)) as Node<'vec3'>;
  tilt = select(panel.collector, tilt.add(facet.mul(lensShows)), tilt) as Node<'vec2'>;

  // Wear, in metres across the module from a point of its own (so no two modules wear alike).
  const q = vec2(fx, fy).mul(moduleEdge).add(vec2(u(mi, mj, SALT.wear), u(mj, mi, SALT.wear)).mul(64));
  let dust = float(0) as Node<'float'>;
  DUST.forEach((l, k) => { dust = dust.add(mx_noise_float(vec3(q.div(l), k * 7.1)).mul(shows(q.div(l))).mul(0.5 / (k + 1))); });
  albedo = albedo.mul(dust.mul(0.3).add(1));
  gloss = gloss.mul(float(1).sub(dust.mul(0.25)));
  // Scratches: hairlines along each module's own direction, from cleaning and drones' wheels.
  const angle = u(mi, mj, SALT.wear + 20).mul(Math.PI);
  const sq = vec2(q.x.mul(angle.cos()).add(q.y.mul(angle.sin())), q.y.mul(angle.cos()).sub(q.x.mul(angle.sin())));
  const scratchWave = mx_noise_float(vec3(sq.x.div(SCRATCH.length), sq.y.div(SCRATCH.width * 40), 3.3));
  const scratch = float(1).sub(smoothstep(0, SCRATCH.share, abs(scratchWave)));
  const scratchShows = shows(sq.y.div(SCRATCH.width * 40 * SCRATCH.share));
  albedo = albedo.mul(keepMean(scratch, SCRATCH.share, SCRATCH.contrast, scratchShows));
  gloss = gloss.mul(float(1).sub(scratch.mul(scratchShows).mul(0.5)));
  // Pits: micrometeoroid craters, a lattice per octave, each cell holding at most one, of a seeded size and place.
  PITS.forEach((o, k) => {
    const g = q.div(o.cell), c = floor(g), h = hash3(seed, uint(c.x.add(65536)), uint(c.y.add(65536)), SALT.pit + k);
    const at = vec2(float(h.shiftRight(uint(8)).bitAnd(uint(255))), float(h.shiftRight(uint(16)).bitAnd(uint(255)))).div(255).mul(0.5).add(0.25);
    const radius = mix(float(PIT.radius[0]), float(PIT.radius[1]), toFloat(hash32(h)));
    const off = fract(g).sub(at), dd = length(off).div(radius);
    const here = toFloat(h).lessThan(o.chance).and(dd.lessThan(1.2));
    const r = shows(g.mul(1 / PIT.radius[0]));
    const rim = band(dd, 0.55, 0.85, 0.95, 1.2);
    const factor = select(here, mix(float(0.5), float(PIT.rimContrast), rim), float(1));
    albedo = albedo.mul(mix(float(1), factor, r).div(r.mul(PIT.share * o.chance * (PIT.rimContrast - 1)).add(1)));
    gloss = gloss.mul(select(here, mix(float(1), float(0.2), r), float(1)));
    tilt = tilt.add(select(here, off.normalize().mul(dd.mul(0.6)).mul(r).mul(float(1).sub(smoothstep(0.8, 1, dd))), vec2(0, 0)));
  });

  const local = normalize(nLocal.add(aroundLocal.mul(tilt.x)).add(alongLocal.mul(tilt.y)));
  return shade(albedo, gloss, panel.emit, local, GLINT_SHARP);
}

/** Radiator albedo (endcap faces and brims): a dark, matte composite, ribbed by heat pipes running out from the axis. */
const RADIATOR: readonly number[] = [0.07, 0.068, 0.065];

/**
 * The radiators: endcap faces and brims, ruled in rings and radial strips (`panel` wide) that turn with the spin, with
 * a little weathering between strips. The faces never see the Sun head-on (the axis points at an ecliptic pole), so
 * they show by earthshine, and their rims catch the Sun edge-on.
 */
export function radiatorColor(): Node<'vec3'> {
  const p = positionLocal;
  const r = length(p.xy), panel = skin.age.w.mul(2 * Math.PI).div(skin.grid.x);
  const ring = r.div(panel), spoke = fract(atan(p.y, p.x).div(2 * Math.PI)).mul(skin.grid.x);
  // Each strip its own shade, seeded like the skin.
  const strip = toFloat(hash3(skinSeed(), uint(floor(ring)), uint(floor(spoke)), SALT.radiator)).sub(0.5).mul(0.24).add(1);
  const lines = seam(ring, 0.02).mul(seam(spoke, 0.02));
  const albedo = v3(RADIATOR).mul(strip).mul(mix(float(0.6), float(1), lines));
  const n = normalWorld, light = lightOn(n);
  return albedo.mul(light.all).add(glint(n, light.sun, float(0.05))).mul(outside.exposure).add(portFaceGlow());
}

/** Bands of windows the port face's uniforms hold (gen/portFace.ts has at most this many). */
export const PORT_BANDS = 3;

/**
 * The port face's windows and bearing ring as its mesh hands them to the shader (`mesh.userData.port`):
 * `face` (the face's z, the bearing ring's inner and outer radius, its lamps), `clock` (window hours, the bearing's
 * glow, the brightest band's glow), `seed` (the seed's two halves), and per band `g` (r0, r1, storey, pitch),
 * `w` (sill, head, mullion, blocks built), `b` (block storeys, block windows, glow, share lit now), `t` (tint, mean now).
 */
export type PortUniforms = Record<string, Vector4>;

const portKeys = ['face', 'clock', 'seed', ...Array.from({ length: PORT_BANDS }, (_, i) => ['g', 'w', 'b', 't'].map((k) => `${k}${i}`)).flat()];

export function portUniforms(f: PortFace): PortUniforms {
  const u: PortUniforms = {
    face: new Vector4(f.z, f.bearingR0, f.bearingR1, f.bearingLamps),
    clock: new Vector4(0, f.bearingGlow, Math.max(f.bearingGlow, ...f.bands.map((b) => b.glow)), 0),
    seed: new Vector4(f.seed >>> 16, f.seed & 0xffff, f.bands.length, 0),
  };
  for (let i = 0; i < PORT_BANDS; i++) {
    const b = f.bands[i];
    u[`g${i}`] = b ? new Vector4(b.r0, b.r1, b.storey, b.pitch) : new Vector4(0, 0, 1, 1);
    u[`w${i}`] = b ? new Vector4(b.sill, b.head, b.mullion, b.blocks) : new Vector4();
    u[`b${i}`] = b ? new Vector4(b.blockStoreys, b.blockWindows, b.glow, 0) : new Vector4(1, 1, 0, 0);
    u[`t${i}`] = b ? new Vector4(b.tint[0], b.tint[1], b.tint[2], 0) : new Vector4();
  }
  return u;
}

/** Set the window clock (`windowHours`) and how far into its night the habitat is (0 day, 1 night). */
export function setPortClock(u: PortUniforms, f: PortFace, hours: number, night: number): void {
  u.clock.x = hours;
  f.bands.forEach((b, i) => {
    u[`b${i}`].w = litShare(b, night);
    u[`t${i}`].w = bandMean(b, night);
  });
}

const noPort = portUniforms({ seed: 0, z: -1e30, bearingR0: 0, bearingR1: 0, bearingLamps: 1, bearingGlow: 0, bands: [] });
const port: Record<string, Node<'vec4'>> = {};
for (const k of portKeys) port[k] = uniform(new Vector4()).onObjectUpdate(({ object }) => ((object?.userData.port as PortUniforms | undefined) ?? noPort)[k]);

/** The brightest window shows at this level once the eyes have opened for the dark (with the Sun out of view). */
export const WINDOW_PEAK = 3;

/**
 * The port face's windows and its bearing ring, per pixel, exactly as `windowAt` and `windowLit` in gen/portFace.ts:
 * which band, storey and window this is, whether its block is built and it is lit at this hour, its own shade. Where
 * a storey or a window shrinks below a pixel, the band's mean light shows instead, so the rings of windows never
 * shimmer and never vanish with distance. Lights in the dark are seen as the eyes see them there, as the lamps and the
 * stars are (heroic, Arnd 2026-10-21): with the Sun out of view the brightest window shows at `WINDOW_PEAK`.
 */
function portFaceGlow(): Node<'vec3'> {
  const p = positionLocal, r = length(p.xy), face = port.face, clock = port.clock;
  const onFace = abs(p.z.sub(face.x)).lessThan(0.5);
  const a = fract(atan(p.y, p.x).div(2 * Math.PI));
  const seed = uint(port.seed.x).shiftLeft(uint(16)).bitOr(uint(port.seed.y));
  // The band this pixel is in (the last one when none, which `inAny` then puts out).
  const last = PORT_BANDS - 1;
  let g = port[`g${last}`], w = port[`w${last}`], b = port[`b${last}`], t = port[`t${last}`], index = float(last) as Node<'float'>;
  let inAny = r.greaterThanEqual(g.x).and(r.lessThan(g.y));
  for (let i = last - 1; i >= 0; i--) {
    const gi = port[`g${i}`], here = r.greaterThanEqual(gi.x).and(r.lessThan(gi.y));
    g = select(here, gi, g) as Node<'vec4'>;
    w = select(here, port[`w${i}`], w) as Node<'vec4'>;
    b = select(here, port[`b${i}`], b) as Node<'vec4'>;
    t = select(here, port[`t${i}`], t) as Node<'vec4'>;
    index = select(here, float(i), index) as Node<'float'>;
    inAny = inAny.or(here);
  }
  // Its storey, block row and quarter row; its window, block and quarter round the ring (`cellAt` in gen/portFace.ts).
  // A block's storeys share their count round, so their windows stack.
  const u = max(r.sub(g.x), 0).div(g.z), k = floor(u), fr = fract(u);
  const kb = floor(k.div(b.x)), kq = floor(kb.div(QUARTER.rows));
  const rq = g.x.add(kq.mul(QUARTER.rows).mul(b.x).mul(g.z));
  const salt = (s: number): Node<'uint'> => uint(index.mul(8).add(s));
  const stagger = toFloat(hash3z(seed, uint(kq), uint(0), salt(PORT_SALT.stagger)));
  const qa = a.add(stagger).mul(max(floor(rq.mul(2 * Math.PI).div(g.w.mul(b.y).mul(QUARTER.blocks))), 1)), jq = floor(qa), fq = fract(qa);
  const v = a.mul(max(floor(g.x.add(kb.mul(b.x).mul(g.z)).mul(2 * Math.PI).div(g.w)), 1)), j = floor(v), fj = fract(v), jb = floor(j.div(b.y));
  const ku = uint(k), ju = uint(j);
  const density = toFloat(hash3z(seed, uint(kq), uint(jq), salt(PORT_SALT.quarter))).mul(DENSITY.spread).add(DENSITY.least);
  const builtShare = min(w.w.mul(density), 1);
  // The avenue along each quarter's side, its edge smoothed over the pixel.
  const dq = min(fwidth(qa), 0.5).mul(0.5), street = smoothstep(float(QUARTER.avenue).sub(dq), float(QUARTER.avenue).add(dq), fq);
  const built = toFloat(hash3z(seed, uint(kb), uint(jb), salt(PORT_SALT.block))).lessThan(builtShare);
  // The block's own share lit (`blockLit`): some buildings bright, some nearly dark.
  const share = b.w, x = toFloat(hash3z(seed, uint(kb), uint(jb), salt(PORT_SALT.blockLit)));
  const blockLit = share.add(x.sub(0.5).mul(min(share, share.oneMinus()).mul(2)));
  // The window: glass between sill and head and between mullions, lit on its own schedule, at its own shade.
  const du = fwidth(u).mul(0.5), dv = min(fwidth(v), 0.5).mul(0.5), m = w.z.mul(0.5);
  const glass = band(fr, w.x.sub(du), w.x.add(du), w.y.sub(du), w.y.add(du)).mul(band(fj, m.sub(dv), m.add(dv), m.oneMinus().sub(dv), m.oneMinus().add(dv)));
  const shade = toFloat(hash3z(seed, ku, ju, salt(PORT_SALT.shade))).mul(0.5).add(0.5);
  const period = toFloat(hash3z(seed, ku, ju, salt(PORT_SALT.phase))).add(1).mul(TOGGLE_HOURS);
  const slot = floor(clock.x.div(period).add(toFloat(hash3z(seed, ju, ku, salt(PORT_SALT.phase)))));
  const lit = toFloat(hash3z(seed, ku.add(uint(slot).mul(uint(4096))), ju, salt(PORT_SALT.lit))).lessThan(blockLit);
  const window = glass.mul(select(built.and(lit), shade, float(0))).mul(b.z);
  // Too far for its windows but near enough for its storeys, a block shows its rows of glass lit by its share; too
  // far for storeys, the block as a whole (`blockGlow`); too far for blocks, its quarter (`quarterGlow`); too far for
  // quarters, the band's mean. Each level averages to the next, so none jumps.
  const lamps = select(built, blockLit.mul(MEAN_SHADE).mul(b.z), float(0));
  const rows = band(fr, w.x.sub(du), w.x.add(du), w.y.sub(du), w.y.add(du)).mul(w.z.oneMinus()).mul(lamps);
  const block = w.y.sub(w.x).mul(w.z.oneMinus()).mul(lamps);
  const quarter = w.y.sub(w.x).mul(w.z.oneMinus()).mul(builtShare).mul(share).mul(MEAN_SHADE).mul(b.z);
  const near = mix(quarter, mix(block, mix(rows, window, shows(v)), shows(u)), shows(u.div(b.x)).mul(shows(v.div(b.y))));
  const windows = select(inAny, mix(t.w, near.mul(street), shows(u.div(b.x.mul(QUARTER.rows))).mul(shows(qa))), float(0));
  // The bearing ring: a lamp every few handrails, every other one dimmer, so the face's slow turn shows against the dock.
  const inRing = r.greaterThanEqual(face.y).and(r.lessThan(face.z));
  const q = a.mul(face.w), lamp = band(fract(q), 0.15, 0.3, 0.7, 0.85).mul(select(fract(floor(q).mul(0.5)).greaterThan(0.25), float(0.35), float(1)));
  const ring = select(inRing, mix(float(0.55 * 0.675), lamp, shows(q)).mul(clock.y), float(0));
  const glow = t.xyz.mul(windows).add(v3(PORT_TINT.bearing).mul(ring));
  // Opened for the dark as the stars are, but never past showing the brightest window at its peak: lights keep their
  // colour (a burnt-out window is only white) and their order of brightness, as the lamps do.
  const peak = float(WINDOW_PEAK).div(max(clock.z, 1e-9));
  const eyes = min(max(outside.exposure, min(outside.starExposure, peak)), peak);
  return select(onFace, min(glow.mul(eyes), DISPLAY_CAP), vec3(0, 0, 0));
}

/** A torch's exhaust plume: its glowing length, how hard the drive thrusts (0–1), per mesh in `userData.flame`. */
export interface FlameUniforms {
  /** (plume length at full thrust (m), throttle 0–1, nozzle radius (m), unused). */
  flame: Vector4;
}
const noFlame: FlameUniforms = { flame: new Vector4(1, 0, 1, 0) };
const flameOf = uniform(new Vector4()).onObjectUpdate(({ object }) => ((object?.userData.flame as FlameUniforms | undefined) ?? noFlame).flame);
/** The plasma's glow at the nozzle at full thrust, in the outside's radiance units. */
export const FLAME_GLOW = 60;

/**
 * The exhaust of a fusion torch: hot plasma glowing violet-white at the nozzle and fading to blue down the plume. The
 * glow shortens with the throttle and goes out with it; seen edge-on the thin sheath of plasma fades, so it is soft.
 */
export function flameColor(): Node<'vec3'> {
  const length = flameOf.x, throttle = flameOf.y;
  const s = clamp(positionLocal.x.negate().div(length), 0, 1);
  const fall = s.negate().div(throttle.mul(0.25).add(1e-3)).exp();
  const facing = pow(dot(normalWorld, normalize(positionWorld)).abs(), 1.5);
  const tint = mix(vec3(0.88, 0.84, 1), vec3(0.42, 0.52, 1), smoothstep(0, 0.5, s));
  return min(tint.mul(fall).mul(facing).mul(throttle).mul(FLAME_GLOW).mul(outside.exposure), DISPLAY_CAP);
}

/** Grime and scuffs on hardware: wavelengths (m), from stains to fine scuffs. */
const GRIME = [1.5, 0.3, 0.06, 0.012];

/**
 * Plain hardware (spindle, berth arms, mast, the skin's beams, frames and bolts): albedo from the vertex colour, a
 * dull metal sheen, and grime and scuffs octave by octave as the eye comes closer, keeping the mean. An octave also
 * fades where the mesh's own coordinates are too large for float32 to hold it (big meshes far from their origin).
 */
export function hardwareColor(lighting: (n: Node<'vec3'>) => Light = lightOn): Node<'vec3'> {
  const p = positionLocal, n = normalWorld, light = lighting(n);
  const precision = max(abs(p.x), max(abs(p.y), abs(p.z))).mul(1.2e-7);
  let grime = float(0) as Node<'float'>;
  GRIME.forEach((l, k) => {
    const held = float(1).sub(smoothstep(l * 0.01, l * 0.04, precision));
    grime = grime.add(mx_noise_float(p.div(l).add(k * 3.7)).mul(shows(p.div(l))).mul(held).mul(0.45 / (k + 1)));
  });
  const albedo = vertexColor().rgb.mul(grime.mul(0.35).add(1));
  return albedo.mul(light.all).add(glint(n, light.sun, float(0.15).mul(float(1).sub(grime.mul(0.5))))).mul(outside.exposure);
}

/**
 * The light inside the spindle's bore (relative to full sunlight, about 400 lux): its lamp strips run along the tube
 * at BORE_LAMPS angles around it, and the pale walls pass their light around.
 */
export const BORE_LIGHT = 0.004;
export const BORE_LAMPS = 4;
/** A lamp strip's own luminance, as a share of BORE_LIGHT's white paper. */
export const LAMP_GLOW = 12;

/** Hardware lit from inside the bore (the BORE kind): brightest under the strips, half as bright between them. */
export function boreColor(): Node<'vec3'> {
  return hardwareColor(() => {
    // The strips at angles 2πk / BORE_LAMPS around the axis (render/bore.ts lays them there).
    const around = atan(positionLocal.y, positionLocal.x).mul(BORE_LAMPS);
    return { sun: float(0), all: float(BORE_LIGHT).mul(around.cos().mul(0.25).add(0.75)) };
  });
}

/** Lamps (the LAMP kind): their own light, vertex colour as luminance relative to white paper in full sunlight. */
export function lampColor(): Node<'vec3'> {
  return min(vertexColor().rgb.mul(outside.exposure), DISPLAY_CAP);
}
