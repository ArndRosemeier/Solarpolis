/**
 * The drones' designs (Actors' drone kit, @actors/drone): each role of the habitat's drones (sim/air.ts) in
 * `life.drones.designs` designs, each designed and built once from a seed, then flattened for drawing many at once:
 * every part moved into the drone's own frame (y up, nose along +z, the ground under it at the origin), each surface
 * given its colour from the design's palette, and the parts that move marked on their vertices (rotors spin about
 * their hub, strobes flash), so one instanced mesh draws every drone of a design, each in its own phase.
 *
 * Two meshes per level: the body (plating, glass, lenses and lights) and the veil (what is seen through: the rotors'
 * blur, plumes and light beams). Two levels: the whole build, and a coarse one made from it (gen/simplify.ts) that
 * keeps its size, colours and outline for where a drone is a few dozen pixels across. From further off it is a speck
 * of its mean colour (`albedo`).
 *
 * Kept out: weapons (never fitted) and jets (no jet blast among people); roles pick their kit (`KIT`). Pure: runs in
 * the generation worker.
 */
import { buildDrone, designDrone, type ArchetypeId, type DroneModel, type DroneSlot, type DroneSpec, type PropKind, type RGB } from '@actors/drone';
import { deriveSeed, hash3i, hashToFloat } from '@futuremagic/core';
import type { DroneRole, Habitat, Vec3 } from '../blueprint';
type Role = DroneRole;
import { simplify, type Shape } from './simplify';

export type { Shape };

/**
 * Which of Actors' archetypes, propulsions and palettes each role is built from (a civil, unarmed fleet). A person's
 * body is one they chose: small, quiet (rings, ducts and ion lift, no open rotors) and in any colours.
 */
export const KIT: Readonly<Record<Role, { archetypes: readonly ArchetypeId[]; propulsion: readonly PropKind[]; palettes: readonly string[] }>> = {
  courier: { archetypes: ['courier'], propulsion: ['ducted', 'rotor'], palettes: ['corporate', 'medical', 'explorer'] },
  tender: { archetypes: ['worker'], propulsion: ['ducted', 'rotor'], palettes: ['industrial', 'explorer', 'desert'] },
  surveyor: { archetypes: ['surveyor'], propulsion: ['ring', 'ducted'], palettes: ['explorer', 'arctic'] },
  lifter: { archetypes: ['lifter'], propulsion: ['rotor', 'ducted'], palettes: ['industrial', 'corporate'] },
  glider: { archetypes: ['manta'], propulsion: ['ion', 'ducted'], palettes: ['chrome', 'arctic'] },
  guardian: { archetypes: ['sentinel'], propulsion: ['ducted', 'ring'], palettes: ['medical', 'arctic'] },
  watcher: { archetypes: ['sentinel'], propulsion: ['ring', 'ion'], palettes: ['arctic', 'chrome'] },
  person: { archetypes: ['sentinel', 'scout', 'sentinel'], propulsion: ['ring', 'ducted', 'ion'], palettes: ['chrome', 'corporate', 'medical', 'arctic', 'explorer', 'desert', 'racing', 'neon'] },
};

/** How many designs a role is built in: the working roles `designs` each, the bodies residents wear `bodies`. */
export function designsOf(h: Habitat, role: Role): number {
  const d = h.params.life.drones;
  return role === 'person' ? d.bodies : d.designs;
}

/**
 * A watcher, the habitat Mind's eye (design "Nobody falls far"), is plainly a camera: a small round body with nothing
 * on it but one big lens in its front, a dark bezel round the glass and a lit ring inside, turning to look about; no
 * tools, no antennae, no strobes, ring or ion lift (quiet, no rotors). Its length (m) between these, and the lens's
 * size against the kit's own eye.
 */
export const CAMERA = { size: [0.4, 0.55], lens: 2.6 } as const;

/** The spec of a role's design `index` (Actors' `designDrone`, unbuilt): a pure function of the habitat's seed. */
function specOf(h: Habitat, role: Role, index: number): DroneSpec {
  const kit = KIT[role], seed = deriveSeed(h.seed, 'drone', role, index), chance = (k: number): number => hashToFloat(hash3i(seed, k, 0, 0));
  const byChance = <T>(list: readonly T[], k: number): T => list[Math.floor(chance(k) * list.length)];
  const base = { seed, archetype: byChance(kit.archetypes, 3), propulsion: byChance(kit.propulsion, 2), palette: byChance(kit.palettes, 1), armed: false };
  if (role !== 'watcher') return designDrone(base);
  const spec = designDrone({ ...base, hull: 'orb', size: CAMERA.size[0] + (CAMERA.size[1] - CAMERA.size[0]) * chance(4), tools: false });
  return { ...spec, sensors: [{ kind: 'eye', mount: 'nose', size: CAMERA.lens }], tools: [], antennae: [], lights: { ...spec.lights, strobe: false, underglow: false } };
}

/**
 * A mesh of a design, ready to draw (the DRONE and DRONE_VEIL kinds): per vertex its position and normal (the drone's
 * frame, m), its `paint` (4 bytes, read as 0 … 1) and its `spin` (4 floats).
 *
 * Body paint: rgb its colour (linear) and a: 0 a lit surface of that albedo; 1 hazard stripes over it; else a light
 * of that colour, `LIGHT_SCALE` × a bright. Spin: the hub it turns about (xyz) and w: how fast it spins about the
 * drone's up (rad/s), 0 still; a strobe is w = −(`STROBE_CODE` + its period in hundredths of a second + its phase).
 *
 * Veil paint: a > 0 a lit surface of albedo rgb that lets 1 − a through (the rotors' blur); a = 0 light it adds,
 * `VEIL_LIGHT` × rgb (plumes and beams, faded to their tips). Spin unused.
 */
export interface DesignMesh {
  positions: Float32Array;
  normals: Float32Array;
  paint: Uint8Array;
  spin: Float32Array;
  index: Uint32Array;
}

/** How bright a body's light is at paint a (× a), a veil's light at rgb (× rgb), and where strobes' codes start. */
export const LIGHT_SCALE = 8;
export const VEIL_LIGHT = 2;
export const STROBE_CODE = 1000;

export interface DroneDesign {
  role: Role;
  /** Which of the role's designs. */
  index: number;
  name: string;
  body: DesignMesh;
  veil: DesignMesh;
  /** The coarse level: the same drone with far fewer triangles. */
  coarse: { body: DesignMesh; veil: DesignMesh };
  /** Bounds of the drone hovering (its frame, m), and its body's height over the ground hovering and landed. */
  min: Vec3;
  max: Vec3;
  hover: number;
  landed: number;
  /** The body's bob while hovering: how far up and down (m) and how long one bob takes (s). */
  bob: [number, number];
  /** Its colour from afar (linear): the mean of its lit surfaces by area. */
  albedo: Vec3;
}

/** How bright the kit's lights are (as Actors' adapter draws them): lenses and seams, position lights and strobes. */
const GLOW = 3.5;
const NAV = 5;
/** How see-through the rotors' blur is, how bright plumes and beams are. */
const BLUR = 0.12;
const PLUME = 1.4;
const BEAM = 0.16;
/** A guess from the spec (`designGuess`): height and width over its length, its primary colour's share against the secondary. */
const GUESS = { height: 0.8, across: 1.4, primary: 0.6 };
/** The coarse level's cells: the drone's size over this many. */
const COARSE_CELLS = 10;

/** The design of a role's drone `index` in a habitat (a pure function of its seed). */
export function droneDesign(h: Habitat, role: Role, index: number): DroneDesign {
  const spec = specOf(h, role, index);
  const model = buildDrone(spec);
  const { body, veil } = flatten(model);
  const ext = Math.max(...model.bounds.max.map((v, k) => v - model.bounds.min[k]));
  const cell = ext / COARSE_CELLS;
  return {
    role, index, name: `${role} ${index}: ${spec.name}`, body: painted(body, false), veil: painted(veil, true),
    coarse: { body: painted(simplify(body, cell), false), veil: painted(simplify(veil, cell), true) },
    min: [...model.bounds.min], max: [...model.bounds.max], hover: model.hoverHeight, landed: model.landedHeight,
    bob: bobOf(model), albedo: albedoOf(body),
  };
}

/** Every design of a habitat, role by role (`ROLES` order), `designsOf` each. */
export function droneDesigns(h: Habitat, roles: readonly Role[]): DroneDesign[] {
  const out: DroneDesign[] = [];
  for (const role of roles) for (let k = 0; k < designsOf(h, role); k++) out.push(droneDesign(h, role, k));
  return out;
}

/**
 * How a design looks from afar before it is built (the far specks of the drones people wear, made in a worker that
 * builds no drones): its height and width across (m) and its colour (linear), from its spec alone. Once built, its
 * measured size and `albedo` take over (render/fliers.ts).
 */
export function designGuess(h: Habitat, role: Role, index: number): { height: number; across: number; albedo: Vec3 } {
  const spec = specOf(h, role, index), p = spec.palette;
  return { height: GUESS.height * spec.size, across: GUESS.across * spec.size, albedo: linear(p.primary.map((v, k) => GUESS.primary * v + (1 - GUESS.primary) * p.secondary[k]) as RGB) };
}

/** sRGB to linear. */
const linear = (c: RGB): Vec3 => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as Vec3;

/** Each slot's colour and code (`DesignMesh`), from the palette as Actors' adapter maps it. */
function slotLook(model: DroneModel): Record<DroneSlot, { rgb: Vec3; a: number; veil: boolean }> {
  const p = model.spec.palette;
  const stripe: RGB = p.accent[0] + p.accent[1] + p.accent[2] < 0.6 ? [0.95, 0.75, 0.1] : p.accent;
  const lit = (c: RGB) => ({ rgb: linear(c), a: 0, veil: false });
  const light = (c: RGB, k: number) => ({ rgb: linear(c), a: k, veil: false });
  return {
    primary: lit(p.primary), secondary: lit(p.secondary), accent: lit(p.accent), metal: lit(p.metal),
    dark: lit(p.metal.map((v) => v * 0.3) as RGB), glass: lit(p.glass), hazard: { rgb: linear(stripe), a: -1, veil: false },
    glow: light(p.glow, GLOW), navRed: light([1, 0.1, 0.06], NAV), navGreen: light([0.1, 1, 0.3], NAV), white: light([1, 1, 1], NAV),
    blur: { rgb: linear(p.metal), a: BLUR, veil: true },
    exhaust: { rgb: linear(p.glow).map((v) => v * PLUME) as Vec3, a: 0, veil: true },
    beam: { rgb: linear(p.glow.map((v) => 0.5 + 0.5 * v) as RGB).map((v) => v * BEAM) as Vec3, a: 0, veil: true },
  };
}

type Mat = { r: [number, number, number, number]; t: Vec3; s: Vec3 };

/** Rotate v by unit quaternion q (x, y, z, w). */
function byQuaternion(q: readonly number[], v: readonly number[]): Vec3 {
  const [x, y, z, w] = q, [a, b, c] = v;
  const ix = w * a + y * c - z * b, iy = w * b + z * a - x * c, iz = w * c + x * b - y * a, iw = -x * a - y * b - z * c;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const qmul = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Each node's place in the drone's frame at rest (hovering): rotation, translation, scale (scale kept per axis, unrotated). */
function restFrames(model: DroneModel): Mat[] {
  const out: Mat[] = [];
  model.nodes.forEach((n, i) => {
    if (n.parent < 0) { out[i] = { r: [...n.quaternion] as Mat['r'], t: [...n.position], s: [...n.scale] }; return; }
    const p = out[n.parent], scaled: Vec3 = [n.position[0] * p.s[0], n.position[1] * p.s[1], n.position[2] * p.s[2]], moved = byQuaternion(p.r, scaled);
    out[i] = { r: qmul(p.r, n.quaternion), t: [p.t[0] + moved[0], p.t[1] + moved[1], p.t[2] + moved[2]], s: [p.s[0] * n.scale[0], p.s[1] * n.scale[1], p.s[2] * n.scale[2]] };
  });
  return out;
}

/** How the nodes move while hovering: spinners (rate about the drone's up, rad/s) and strobes (period, phase). */
function motionOf(model: DroneModel, frames: Mat[]): { spin: Map<number, number>; strobe: Map<number, [number, number]> } {
  const hover = model.clips.find((c) => c.name === 'hover'), spin = new Map<number, number>(), strobe = new Map<number, [number, number]>();
  for (const tr of hover?.tracks ?? []) {
    const n = tr.times.length;
    if (tr.path === 'quaternion' && n > 2) {
      // A spinner turns a whole turn or more over the clip, about its own up, which must be the drone's.
      let turned = 0;
      for (let k = 1; k < n; k++) {
        const d = Math.abs(tr.values[k * 4 - 4] * tr.values[k * 4] + tr.values[k * 4 - 3] * tr.values[k * 4 + 1] + tr.values[k * 4 - 2] * tr.values[k * 4 + 2] + tr.values[k * 4 - 1] * tr.values[k * 4 + 3]);
        turned += 2 * Math.acos(Math.min(1, d));
      }
      const up = byQuaternion(frames[tr.node].r, [0, 1, 0]);
      if (turned > 2 * Math.PI && up[1] > Math.cos((10 * Math.PI) / 180)) {
        // Its way round: the sign of the turn about up between the first two keys.
        const q0 = Array.from(tr.values.slice(0, 4)), q1 = Array.from(tr.values.slice(4, 8));
        const rel = qmul(q1, [-q0[0], -q0[1], -q0[2], q0[3]]);
        spin.set(tr.node, (Math.sign(rel[1] * rel[3]) || 1) * (turned / (tr.times[n - 1] - tr.times[0])));
      }
    }
    if (tr.path === 'scale' && tr.step && n > 2) {
      const on = (k: number): boolean => tr.values[k * 3] > 0.5, starts: number[] = [];
      for (let k = 0; k < n; k++) if (on(k) && (k === 0 || !on(k - 1))) starts.push(tr.times[k]);
      if (starts.length) {
        const period = starts.length > 1 ? starts[1] - starts[0] : hover!.duration;
        strobe.set(tr.node, [period, (((starts[0] / period) % 1) + 1) % 1]);
      }
    }
  }
  return { spin, strobe };
}

/** The drone's parts in its own frame, as one body and one veil, coloured and marked (`DesignMesh`). */
function flatten(model: DroneModel): { body: Shape; veil: Shape } {
  const frames = restFrames(model), { spin, strobe } = motionOf(model, frames), look = slotLook(model);
  /** The node that moves a mesh's node: itself or the nearest moving node above it. */
  const mover = (i: number): number => { for (let k = i; k >= 0; k = model.nodes[k].parent) if (spin.has(k) || strobe.has(k)) return k; return -1; };
  const parts = { body: [] as DroneModel['meshes'], veil: [] as DroneModel['meshes'] };
  for (const m of model.meshes) (look[m.slot].veil ? parts.veil : parts.body).push(m);
  const shapeOf = (list: DroneModel['meshes'], veil: boolean): Shape => {
    const vertices = list.reduce((a, m) => a + m.positions.length / 3, 0), triangles = list.reduce((a, m) => a + m.indices.length, 0);
    const out: Shape = { positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), colors: new Float32Array(vertices * 4), parts: new Float32Array(vertices * 4), index: new Uint32Array(triangles) };
    let v = 0, t = 0;
    for (const m of list) {
      const f = frames[m.node], s = look[m.slot], k = veil ? -1 : mover(m.node);
      const hub = k >= 0 ? frames[k].t : [0, 0, 0], w = k < 0 ? 0 : spin.has(k) ? spin.get(k)! : -(STROBE_CODE + Math.round(strobe.get(k)![0] * 100) + Math.min(0.999, strobe.get(k)![1]));
      for (let i = 0; i < m.indices.length; i++) out.index[t + i] = m.indices[i] + v;
      t += m.indices.length;
      for (let i = 0; i < m.positions.length / 3; i++, v++) {
        const p = byQuaternion(f.r, [m.positions[i * 3] * f.s[0], m.positions[i * 3 + 1] * f.s[1], m.positions[i * 3 + 2] * f.s[2]]);
        const nl = byQuaternion(f.r, [m.normals[i * 3] / f.s[0], m.normals[i * 3 + 1] / f.s[1], m.normals[i * 3 + 2] / f.s[2]]), l = Math.hypot(...nl) || 1;
        out.positions.set([p[0] + f.t[0], p[1] + f.t[1], p[2] + f.t[2]], v * 3);
        out.normals.set([nl[0] / l, nl[1] / l, nl[2] / l], v * 3);
        // A plume or beam fades to its tip (Actors' adapter: (1 − fade)^1.6).
        const fade = m.fade && s.a === 0 && veil ? Math.pow(1 - m.fade[i], 1.6) : 1;
        out.colors.set([s.rgb[0] * fade, s.rgb[1] * fade, s.rgb[2] * fade, s.a], v * 4);
        out.parts.set([hub[0], hub[1], hub[2], w], v * 4);
      }
    }
    return out;
  };
  return { body: shapeOf(parts.body, false), veil: shapeOf(parts.veil, true) };
}

/** The body's bob in the hover clip: half its rise and fall (m), and the clip's length. */
function bobOf(model: DroneModel): [number, number] {
  const hover = model.clips.find((c) => c.name === 'hover'), body = model.nodes.findIndex((n) => n.name === 'body');
  const tr = hover?.tracks.find((x) => x.node === body && x.path === 'position');
  if (!hover || !tr) return [0, 1];
  let lo = Infinity, hi = -Infinity;
  for (let k = 1; k < tr.values.length; k += 3) { lo = Math.min(lo, tr.values[k]); hi = Math.max(hi, tr.values[k]); }
  return [(hi - lo) / 2, hover.duration];
}

/** The mean albedo of a body's lit surfaces (hazard stripes half their colour, half black), weighted by area. */
function albedoOf(m: Shape): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  let area = 0;
  const p = m.positions, c = m.colors;
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, d] = [m.index[t], m.index[t + 1], m.index[t + 2]];
    if (c[a * 4 + 3] > 0) continue;
    const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]], w = [p[d * 3] - p[a * 3], p[d * 3 + 1] - p[a * 3 + 1], p[d * 3 + 2] - p[a * 3 + 2]];
    const A = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2, k = c[a * 4 + 3] < 0 ? 0.5 : 1;
    for (let j = 0; j < 3; j++) sum[j] += A * k * c[a * 4 + j];
    area += A;
  }
  return area > 0 ? [sum[0] / area, sum[1] / area, sum[2] / area] : [0.5, 0.5, 0.5];
}

/**
 * A shape's colours as paint (`DesignMesh`): the body's colour and code (lights at a / `LIGHT_SCALE`, hazard 1), or the
 * veil's albedo and opacity (lights at rgb / `VEIL_LIGHT`).
 */
function painted(m: Shape, veil: boolean): DesignMesh {
  const c = m.colors, paint = new Uint8Array(c.length), byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < c.length; i += 4) {
    const a = c[i + 3], light = veil ? a === 0 : a > 0, k = light && veil ? 1 / VEIL_LIGHT : 1;
    for (let j = 0; j < 3; j++) paint[i + j] = byte(c[i + j] * k);
    paint[i + 3] = veil ? byte(a) : a < 0 ? 255 : light ? Math.max(1, Math.min(254, Math.round((a / LIGHT_SCALE) * 255))) : 0;
  }
  return { positions: m.positions, normals: m.normals, paint, spin: m.parts, index: m.index };
}

/** Bytes a design's meshes hold (both levels). */
export function designBytes(d: DroneDesign): number {
  const of = (m: DesignMesh): number => m.positions.byteLength + m.normals.byteLength + m.paint.byteLength + m.spin.byteLength + m.index.byteLength;
  return of(d.body) + of(d.veil) + of(d.coarse.body) + of(d.coarse.veil);
}
