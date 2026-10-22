/**
 * Ported from Actors packages/three/src/fur.ts (`furCoat`, the WebGL fur shader's coat colour), for WebGPU: an animal's
 * coat colour at every vertex of its body, worked out once per look instead of per pixel.
 *
 * Actors draws an animal's coat in its WebGL shader from the region data its importer writes per vertex (`coatA` …
 * `coatF`: legs, head, muzzle, tail, ears, brows, bib, back, underside, mask, blaze, bare skin, nose…) and the coat's
 * colours and markings, then lays shells of strands over it. Its WebGPU kit has neither, so the game bakes the coat
 * here, per vertex (the markings are centimetres wide, the body's vertices millimetres apart), and the fur material
 * (render/materials.ts, `furMaterial`) adds the hair's grain per pixel. The shells' strand tips (agouti and frosted
 * guard hairs, a squirrel tail's banded hairs) are folded in as the colour they give the coat on average, so a coat
 * seen without shells, and its speck from afar, have the colour the shelled coat has.
 *
 * Colours are linear RGB, as the shader's uniforms were. Pure.
 */
import { clamp, lerp as mix, mixRgb, smoothstep, srgbToLinear } from '@futuremagic/core';
import { ActorRuntime, type Fetcher } from '@actors/core';
import { SPECIES, type DeerCoat, type DogCoat } from '@actors/animal';
import { packColor } from './standIn';

/** An animal's coat: a dog-shaped one (squirrels) or a deer's, as Actors' presets give them. */
export type Coat = DogCoat | DeerCoat;

/** A coat value the coat may not have (0 when it hasn't). */
const opt = (coat: Coat, key: string): number => (coat as unknown as Record<string, number | undefined>)[key] ?? 0;

/** An animal's look from its preset (`SPECIES` by the pack's kind: squirrel, deer…): its shape and coat. */
export function paramsOf(kind: string, preset: string): { shape: { size: number }; coat: Coat } {
  const species = SPECIES[kind];
  if (!species) throw new Error(`Unknown animal kind ${kind}`);
  return species.params(preset) as { shape: { size: number }; coat: Coat };
}

type Rgb = [number, number, number];

/** What the pack gives per vertex of a fur mesh (its `MeshData.attributes`): region data and the coat's own frame. */
export interface CoatSource {
  coatA: Float32Array;
  coatB: Float32Array;
  coatC: Float32Array;
  coatD: Float32Array;
  coatE: Float32Array;
  /**
   * Dogs and squirrels: nose coordinates (packs with a nose leather). Deer: the rump patch, the position along the body
   * (m), the distance from the spine line (m) and where spots grow. Absent on older packs.
   */
  coatF?: Float32Array;
  /** Where the vertex is on the base pack (m): the pattern stays on the body as it moves and changes shape. */
  coatPos: Float32Array;
  /** The way the hair lies. */
  furFlow: Float32Array;
}

/** How much shells (strands) lift a coat's colour on average, seen without them: the body under the fur, the WebGL kit's short-fur factor. */
const UNDER_FUR = 0.9;

const fract = (x: number): number => x - Math.floor(x);
const scaled = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const linear = (c: readonly number[]): Rgb => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];

/** The shader's hash (three floats from a point), as GLSL computes it. */
function hash(px: number, py: number, pz: number): Rgb {
  let x = fract(px * 0.1031), y = fract(py * 0.103), z = fract(pz * 0.0973);
  // p += dot(p, p.yxz + 33.33); then fract((p.xxy + p.yxx) * p.zyx).
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return [fract((x + y) * z), fract(2 * x * y), fract((y + x) * x)];
}

function noise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let fx = px - ix, fy = py - iy, fz = pz - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number): number => hash(ix + a, iy + b, iz + c)[0];
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), fx), x10 = mix(h(0, 1, 0), h(1, 1, 0), fx);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), fx), x11 = mix(h(0, 1, 1), h(1, 1, 1), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

const fbm = (x: number, y: number, z: number): number => 0.6 * noise(x, y, z) + 0.3 * noise(x * 2.1 + 7, y * 2.1 + 7, z * 2.1 + 7) + 0.1 * noise(x * 4.3 + 13, y * 4.3 + 13, z * 4.3 + 13);

/** Locks of hair: noise stretched along the hair's way (about 4 mm across, 3 cm along). */
function streak(px: number, py: number, pz: number, flow: Rgb): number {
  const l = Math.hypot(flow[0] + 1e-5, flow[1] + 1e-5, flow[2] + 1e-5);
  const f: Rgb = [(flow[0] + 1e-5) / l, (flow[1] + 1e-5) / l, (flow[2] + 1e-5) / l];
  const d = (px * f[0] + py * f[1] + pz * f[2]) * 0.86;
  const qx = px - f[0] * d, qy = py - f[1] * d, qz = pz - f[2] * d;
  return 0.6 * noise(qx * 230, qy * 230, qz * 230) + 0.4 * noise(qx * 520 + 3, qy * 520 + 3, qz * 520 + 3);
}

/** Round spots: distance to the nearest random point of a jittered grid. */
function spots(px: number, py: number, pz: number): number {
  const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
  let best = 1;
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const r = hash(cx + x, cy + y, cz + z), radius = 0.22 + 0.2 * r[2];
    const dx = px - (cx + x) - 0.15 - 0.7 * r[0], dy = py - (cy + y) - 0.15 - 0.7 * r[1], dz = pz - (cz + z) - 0.15 - 0.7 * r[2];
    best = Math.min(best, Math.hypot(dx, dy, dz) / radius);
  }
  return 1 - smoothstep(0.85, 1, best);
}

/** A coat's colours in linear light, and its markings, as the shader's uniforms held them. */
interface Marks {
  base: Rgb; second: Rgb; tan: Rgb; white: Rgb;
  nose: Rgb | null;
  /** Plain nose leather (the coat's `nose`, or near black). */
  leather: Rgb;
  grain: number;
  /** A deer's coat (its markings ride coatF), and its spots' amount and spacing (m). */
  deer: boolean;
  dapple: number;
  spacing: number;
}

/**
 * A coat baked for a fur mesh: linear RGB at every vertex and the hair's grain (the fur material's pattern scale:
 * `coat.grain`) in a fourth; the coat's colour with its markings, seen without the shells' strands. A spotted deer's
 * spots are smaller than its vertices are apart, so they are drawn per pixel (`furMaterial(true)`) from `dapple`: per
 * vertex the spot pattern's coordinates (in spot spacings), how strongly spots show there, and their colour (packed
 * sRGB); null for a coat without spots.
 */
export interface Baked {
  coat: Float32Array;
  dapple: Float32Array | null;
}

export function bakeCoat(src: CoatSource, coat: Coat): Baked {
  const deer = 'dapple' in coat, nose = (coat as { nose?: Rgb }).nose;
  const m: Marks = {
    base: linear(coat.base), second: linear(coat.second), tan: linear(coat.tan), white: linear(coat.white),
    nose: 'noseColor' in coat && coat.noseColor ? linear(coat.noseColor) : null,
    leather: nose ? linear(nose) : [0.025, 0.02, 0.02],
    grain: opt(coat, 'grain') || 1, deer, dapple: opt(coat, 'dapple'), spacing: 0.034 * Math.max(opt(coat, 'dappleSize') || 1, 0.3),
  };
  const n = src.coatPos.length / 3, out = new Float32Array(n * 4), spots = m.dapple > 0 && src.coatF ? new Float32Array(n * 4) : null;
  const white = packColor(coat.white), at = { x: 0, y: 0, amount: 0 };
  for (let i = 0; i < n; i++) {
    const c = coatAt(src, i, coat, m, at);
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = m.grain;
    if (spots) { spots[i * 4] = at.x; spots[i * 4 + 1] = at.y; spots[i * 4 + 2] = at.amount; spots[i * 4 + 3] = white; }
  }
  return { coat: out, dapple: spots };
}

/** Blend that looks linear to the eye (Actors' `furMixP`: light marks would swamp a dark coat in linear colour). */
function mixP(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1), c = (x: number, y: number): number => { const v = mix(Math.sqrt(Math.max(x, 0)), Math.sqrt(Math.max(y, 0)), k); return v * v; };
  return [c(a[0], b[0]), c(a[1], b[1]), c(a[2], b[2])];
}

/**
 * A deer's markings over the coat (Actors' `deerCoat`): a greyer head and neck, the dark dorsal stripe, the pale flank
 * line, eye ring, inner ears, gland tufts, the rump patch and its border. Its spots are left to the fur material; `at`
 * gets where the vertex lies in their pattern and how strongly they show there.
 */
function deerCoat(src: CoatSource, k: number, coat: Coat, m: Marks, colIn: Rgb, nz: number, flow: Rgb, at: { x: number; y: number; amount: number }): Rgb {
  const A = src.coatA, B = src.coatB, D = src.coatD, E = src.coatE, F = src.coatF!, P = src.coatPos, i3 = (k / 4) * 3;
  const rump = F[k], along = F[k + 1], fromSpine = F[k + 2], spotty = F[k + 3];
  let col = colIn;
  const neckTone = Math.max(A[k + 1], smoothstep(0.42, 0.2, along) * (1 - D[k + 1]));
  col = mixP(col, m.tan, neckTone * opt(coat, 'headTone') * (1 - E[k]));
  const stripe = smoothstep(0.014, 0.006, fromSpine + nz * 0.006) * smoothstep(0.3, 0.38, along) * (1 - A[k + 1]);
  col = mixRgb(col, mixRgb(col, m.second, 0.85), stripe * opt(coat, 'dorsal'));
  const lower = smoothstep(0.27, 0.15, fromSpine);
  at.x = along / m.spacing + nz * 0.35;
  at.y = (fromSpine - 0.012) / m.spacing + nz * 0.35;
  at.amount = smoothstep(0.008, 0.02, fromSpine) * spotty * mix(0.45, 1, lower) * m.dapple * 0.85;
  const line = smoothstep(1, 0, Math.abs(fromSpine - 0.255) / 0.011 + noise(P[i3] * 45, P[i3 + 1] * 45, P[i3 + 2] * 45) * 1.4 - 0.4) * spotty * smoothstep(0.5, 0.58, along) * smoothstep(0.95, 0.85, along);
  col = mixP(col, m.white, clamp(line * 0.5, 0, 1) * m.dapple * 0.85);
  col = mixP(col, m.white, smoothstep(0.2, 0.7, B[k + 2]) * opt(coat, 'eyeRing'));
  const pale = 0.24 + 0.22 * smoothstep(0.35, 0.8, streak(P[i3] * 1.6 + 1.7, P[i3 + 1] * 1.6 + 1.7, P[i3 + 2] * 1.6 + 1.7, flow));
  col = mixP(col, mixP(m.second, m.white, pale), smoothstep(0.15, 0.6, E[k + 1] + nz * 0.2) * opt(coat, 'innerEar'));
  col = mixP(col, m.white, smoothstep(0.2, 0.6, E[k + 2]) * opt(coat, 'glands'));
  col = mixRgb(col, m.white, smoothstep(0.3, 0.6, rump + nz * 0.2) * opt(coat, 'rump'));
  col = mixRgb(col, scaled(m.second, 0.6), clamp(smoothstep(0.25, 0.6, D[k + 3] + nz * 0.2) + smoothstep(0.3, 0.6, E[k + 3]), 0, 1) * opt(coat, 'rumpBorder'));
  return col;
}

/** The bare nose pad (packs with nose coordinates, when the coat sets a nose colour), seen from in front of the nose. */
function nosePad(F: ArrayLike<number> | null, k: number, m: Marks): number {
  if (!m.nose || !F) return 0;
  const qx = F[k], qy = F[k + 1] - 0.0008, ell = Math.hypot(qx / 0.0105, qy / 0.0085);
  return (1 - smoothstep(0.85, 1, ell)) * smoothstep(-0.011, -0.006, F[k + 2]);
}

/**
 * One vertex: the shader's `furCoat`, then its shells' tips on average (see the file comment). A deer's spots are
 * left out; `at` gets their pattern there, faded by whatever is laid over them after (white marks, bare skin).
 */
function coatAt(src: CoatSource, i: number, coat: Coat, m: Marks, at: { x: number; y: number; amount: number }): Rgb {
  const k = i * 4, A = src.coatA, B = src.coatB, C = src.coatC, D = src.coatD, E = src.coatE, F = src.coatF ?? null;
  const legT = A[k], headW = A[k + 1], muzzleT = A[k + 2], tailT = A[k + 3];
  const ear = B[k], brow = B[k + 2], bib = B[k + 3];
  const back = D[k], mask = D[k + 2], blaze = D[k + 3];
  const saddle = coat.saddle, maskA = coat.mask, points = coat.points, belly = coat.belly;
  const bibA = coat.bib, socks = coat.socks, blazeA = coat.blaze, tailTip = coat.tailTip;
  const spotsA = coat.spots, spotSize = coat.spotSize, shade = coat.shade;
  const paleMask = coat.paleMask ?? 0, agouti = coat.agouti ?? 0, tanLegs = coat.tanLegs ?? 0;
  // A deer's eye ring rides another channel (coatB.z, a dog's brow), in its own markings.
  const eyeRing = m.deer ? 0 : opt(coat, 'eyeRing'), frost = opt(coat, 'frost'), tailFrost = opt(coat, 'tailFrost');
  const under = D[k + 1] * (1 - E[k + 2] * (tailFrost >= 0.01 ? 1 : 0));
  const px = src.coatPos[i * 3] / m.grain, py = src.coatPos[i * 3 + 1] / m.grain, pz = src.coatPos[i * 3 + 2] / m.grain;
  const flow: Rgb = [src.furFlow[i * 3], src.furFlow[i * 3 + 1], src.furFlow[i * 3 + 2]];
  const nz = fbm(px * 22, py * 22, pz * 22) - 0.5;
  let col: Rgb = m.base;
  // Lighter underside and inner legs; a slightly darker topline (agouti shading).
  col = mixRgb(col, mixRgb(col, m.white, 0.5), smoothstep(0.2, 0.8, under) * shade);
  col = scaled(col, 1 - 0.25 * shade * smoothstep(0.6, 1, back));
  // Saddle and mask in the second colour; ears go dark with them.
  const sw = mix(0.08, 0.3, agouti);
  col = mixRgb(col, m.second, smoothstep(0.5 - sw, 0.5 + sw, back * (0.35 + 0.75 * saddle) + nz * 0.35) * (saddle >= 0.01 ? 1 : 0) * (1 - headW));
  col = mixRgb(col, m.second, smoothstep(0.35, 0.6, mask + nz * 0.25) * maskA);
  col = mixRgb(col, m.second, smoothstep(0.3, 0.6, ear) * Math.max(maskA, saddle * 0.85));
  // Tan points: brows, cheeks and muzzle, lower legs, chest.
  const pts = Math.max(Math.max(brow * 1.6, mask * 0.9 * (1 - smoothstep(0.2, 0.6, blaze * 3))), Math.max((1 - legT) * 1.1, bib * 0.55));
  col = mixRgb(col, m.tan, smoothstep(0.45, 0.6, pts + nz * 0.15) * points);
  // Agouti: banded hairs with dark tips, strongest on the back.
  if (agouti > 0) {
    const where = (1 - D[k + 1]) * (0.3 + 0.7 * D[k]) * (1 - E[k]) * (1 - 0.6 * (1 - A[k]));
    col = mixRgb(col, scaled(m.second, 0.75), smoothstep(0.42, 0.72, streak(px + 0.37, py + 0.37, pz + 0.37, flow)) * where * agouti * 0.6);
  }
  // Light (wolf) mask; tan lower legs.
  col = mixRgb(col, m.white, smoothstep(0.3, 0.7, E[k] + nz * 0.25) * paleMask);
  col = mixRgb(col, m.tan, smoothstep(1, 0.7, legT + nz * 0.15) * tanLegs);
  at.amount = 0;
  if (m.deer && F) col = deerCoat(src, k, coat, m, col, nz, flow, at);
  // (Cats' tabby stripes and tortoiseshell patches are not baked: no cats live here yet.)
  // Spots.
  const sp = 0.034 * Math.max(spotSize, 0.2);
  if (spotsA > 0) col = mixRgb(col, m.second, spots(px / sp, py / sp, pz / sp) * spotsA * (1 - C[k]));
  // White markings.
  let white = smoothstep(0.5, 0.65, under + nz * 0.25) * belly;
  white = Math.max(white, smoothstep(0.35, 0.6, bib + nz * 0.2) * bibA);
  white = Math.max(white, (1 - smoothstep(socks * 0.92 - 0.1, socks * 0.92, legT + nz * 0.1)) * (socks >= 0.01 ? 1 : 0));
  white = Math.max(white, smoothstep(0.25, 0.5, blaze * 1.4 * blazeA + muzzleT * blazeA * 0.6 * (blazeA >= 0.5 ? 1 : 0) + nz * 0.1) * (blazeA >= 0.01 ? 1 : 0));
  white = Math.max(white, smoothstep(1 - 0.3 * tailTip, 1 - 0.24 * tailTip, tailT) * (tailTip >= 0.01 ? 1 : 0));
  col = mixRgb(col, m.white, white);
  at.amount *= 1 - clamp(white, 0, 1);
  // Frosted coats: flecks of light and dark hair tips.
  if (frost > 0) {
    const fleck = streak(px * 0.9 + 2.3, py * 0.9 + 2.3, pz * 0.9 + 2.3, flow), where = (1 - under) * (1 - E[k + 1]) * (1 - C[k]);
    col = mixRgb(col, mixRgb(m.white, m.base, 0.25), smoothstep(0.5, 0.68, fleck) * where * frost * 0.75);
    col = mixRgb(col, m.second, smoothstep(0.4, 0.26, fleck) * where * frost * agouti * 0.7);
  }
  // Squirrel tail: the dark band of the hairs shows through near the skin.
  col = mixRgb(col, scaled(m.second, 0.8), E[k + 2] * tailFrost * 0.2);
  // Pale eye ring.
  col = mixRgb(col, scaled(m.white, 0.96), smoothstep(0.25, 0.6, E[k + 1] + nz * 0.15) * eyeRing);
  // The shells' strand tips, on average (their coverage over the upper shells, about half): dark agouti tips, white
  // frost tips, and a squirrel tail's dark band and white fringe.
  {
    const tips = 0.5, onTail = E[k + 2] * tailFrost;
    const where = (1 - D[k + 1]) * (0.35 + 0.65 * D[k]) * (1 - 0.7 * D[k + 2]) * (1 - E[k + 2] * (tailFrost >= 0.01 ? 1 : 0));
    col = mixRgb(col, scaled(m.second, 0.6), 0.25 * where * agouti * 0.75 * tips);
    col = mixRgb(col, m.white, 0.2 * (1 - D[k + 1]) * (1 - E[k + 1]) * frost * 0.8 * tips);
    col = mixRgb(col, scaled(m.second, 0.7), 0.2 * onTail * 0.6 * tips);
    col = mixRgb(col, m.white, 0.55 * onTail * 0.85 * tips);
  }
  // Bare skin: nose leather, lips, pads, eye rims.
  let bare: Rgb = [0.025, 0.02, 0.02];
  const pad = nosePad(F, k, m);
  const bareW = clamp(Math.max(C[k] + C[k + 1] + C[k + 2] + C[k + 3], pad), 0, 1);
  bare = mixRgb(bare, m.leather, clamp(C[k] / Math.max(bareW, 1e-3), 0, 1));
  if (m.nose && F) {
    // The leather's mean colour (its pebbling and nostrils are below a vertex's spacing).
    const leather = scaled(m.nose, 0.85);
    const noseW = Math.max(smoothstep(0, 0.6, C[k]), pad);
    bare = mixRgb(bare, scaled(m.nose, 0.22), clamp(C[k + 1] / Math.max(bareW, 1e-3), 0, 1));
    bare = mixRgb(bare, leather, clamp(noseW / Math.max(bareW, 1e-3), 0, 1));
  }
  col = mixRgb(col, bare, bareW);
  at.amount *= 1 - bareW;
  return scaled(col, mix(UNDER_FUR, 1, bareW));
}

/** A coat's iris colour (linear RGB): the eyes' colour, which the eye material draws round the pupil. */
export function irisOf(coat: Coat): Rgb {
  return linear(coat.iris ?? [0.32, 0.18, 0.06]);
}

/** Which coats to bake: an Actors animal pack (its manifest's URL), its kind (`extra.animal.kind`) and the presets. */
export interface CoatAsk {
  manifest: string;
  animal: string;
  presets: readonly string[];
}

/** One look's coat: per vertex of the fur mesh (`bakeCoat`), the eyes' colour, and the speck's three bands (packed sRGB). */
export interface Look {
  preset: string;
  coat: Float32Array;
  dapple: Float32Array | null;
  iris: Rgb;
  bands: [number, number, number];
  /** The preset's overall size (× the pack's body). */
  size: number;
}

/** A pack's coats: the fur mesh's name, each look's, and the pack's body at size 1 (m): height, length nose to tail, width. */
export interface Coats {
  fur: string;
  looks: Look[];
  height: number;
  length: number;
  width: number;
}

/** Bake every look of a pack (for the worker; the pack is let go after). */
export async function coatsOf(ask: CoatAsk, fetcher: Fetcher): Promise<Coats> {
  const rt = await ActorRuntime.load(ask.manifest, fetcher);
  const fur = rt.meshes.find((m) => m.def.material.kind === 'fur' && m.attributes?.coatPos);
  if (!fur?.attributes) throw new Error(`${ask.manifest}: no fur mesh with coat data`);
  const at = fur.attributes, src: CoatSource = {
    coatA: at.coatA.array, coatB: at.coatB.array, coatC: at.coatC.array, coatD: at.coatD.array, coatE: at.coatE.array,
    coatF: at.coatF?.array, coatPos: at.coatPos.array, furFlow: at.furFlow.array,
  };
  const p = rt.basePositions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k], p[i]); hi[k] = Math.max(hi[k], p[i]); }
  const looks = ask.presets.map((preset): Look => {
    const params = paramsOf(ask.animal, preset), { coat, dapple } = bakeCoat(src, params.coat);
    return { preset, coat, dapple, iris: irisOf(params.coat), bands: coatBands(src.coatPos, coat), size: params.shape.size };
  });
  return { fur: fur.def.name, looks, height: hi[1] - lo[1], length: hi[2] - lo[2], width: hi[0] - lo[0] };
}

const toSrgb = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/**
 * A coat's three bands for its speck (packed sRGB, as people's specks take them, render/specks.ts): the mean colour of
 * its top third (back, head, tail), middle and bottom third (legs, belly), by height on the body.
 */
export function coatBands(coatPos: Float32Array, coat: Float32Array): [number, number, number] {
  let top = -Infinity, bottom = Infinity;
  for (let i = 1; i < coatPos.length; i += 3) { top = Math.max(top, coatPos[i]); bottom = Math.min(bottom, coatPos[i]); }
  const sums = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], span = Math.max(top - bottom, 1e-6);
  for (let i = 0; i < coat.length / 4; i++) {
    const band = Math.min(2, Math.floor(((coatPos[i * 3 + 1] - bottom) / span) * 3)), b = sums[2 - band];
    for (let k = 0; k < 3; k++) b[k] += coat[i * 4 + k];
    b[3]++;
  }
  return sums.map((b) => packColor([0, 1, 2].map((k) => toSrgb(b[k] / Math.max(1, b[3]))) as Rgb)) as [number, number, number];
}
