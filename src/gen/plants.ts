/**
 * Plant shapes: one mesh per plant (species × variant × level of detail), built from the plant's form and a seed. A
 * mesh is one unit high (its base at the origin, +y up), so an instance scales it to its own height; the colours are
 * the plant's bark and leaves, with a little light and dark worked in (leaves darker deep in the crown).
 *
 * Crowns are clumps: small lumpy spheres of foliage on the ends of limbs, with normals bent outward from the crown's
 * middle, so a crown shades as one soft mass the way a tree does from a distance, while its outline stays broken.
 * Pure (no three.js): built once at load, in a worker or the main thread.
 */
import { Rng, deriveSeed, v3cross as cross } from '@futuremagic/core';
import type { PlantForm, PlantSpec, Rgb } from '../blueprint';

export interface PlantMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  index: Uint32Array;
  /** Radius of the plant around its axis, and its height, as shares of its height (for culling and fading). */
  reach: number;
}

/** Levels of detail: up close, and a much lighter one for the distance. */
export type PlantDetail = 'near' | 'far';

type V3 = [number, number, number];

/** Collects triangles. */
class Builder {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly i: number[] = [];

  vertex(pos: V3, nor: V3, col: Rgb): number {
    this.p.push(...pos); this.n.push(...nor); this.c.push(...col);
    return this.p.length / 3 - 1;
  }

  /** A tube along a path, `sides` around, radii per path point. */
  tube(path: V3[], radii: number[], sides: number, col: Rgb): void {
    const rings: number[] = [];
    for (let k = 0; k < path.length; k++) {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
      const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const u = norm(Math.abs(t[1]) < 0.9 ? cross(t, [0, 1, 0]) : cross(t, [1, 0, 0])), v = cross(t, u);
      rings.push(this.p.length / 3);
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * 2 * Math.PI, cs = Math.cos(ang), sn = Math.sin(ang);
        const nn: V3 = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn];
        const r = radii[k];
        this.vertex([path[k][0] + nn[0] * r, path[k][1] + nn[1] * r, path[k][2] + nn[2] * r], nn, col);
      }
    }
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let s = 0; s < sides; s++) {
        const a = rings[k] + s, b = rings[k] + ((s + 1) % sides), c = rings[k + 1] + s, d = rings[k + 1] + ((s + 1) % sides);
        this.i.push(a, b, c, b, d, c);
      }
    }
  }

  /**
   * A clump of foliage: a lumpy sphere (`detail` 0: 12 corners, 1: 42) with radii `r`, its normals bent toward the
   * direction from `middle`, its colour darker the deeper it sits in the crown.
   */
  clump(rng: Rng, at: V3, r: V3, detail: number, col: Rgb, middle: V3, crown: number): void {
    const { verts, faces } = icosphere(detail);
    const base = this.p.length / 3;
    const out = norm([at[0] - middle[0], at[1] - middle[1], at[2] - middle[2]]);
    const depth = Math.min(1, Math.hypot(at[0] - middle[0], at[1] - middle[1], at[2] - middle[2]) / Math.max(crown, 1e-6));
    for (const v of verts) {
      const lump = 1 + rng.range(-0.18, 0.18);
      const pos: V3 = [at[0] + v[0] * r[0] * lump, at[1] + v[1] * r[1] * lump, at[2] + v[2] * r[2] * lump];
      const nn = norm([v[0] + out[0] * 0.8, v[1] + out[1] * 0.8 + 0.2, v[2] + out[2] * 0.8]);
      // Darker underneath and deep inside, a little lighter on top: light the crown lets through.
      const shade = (0.65 + 0.35 * depth) * (0.85 + 0.15 * v[1]) * rng.range(0.9, 1.1);
      this.vertex(pos, nn, [col[0] * shade, col[1] * shade, col[2] * shade]);
    }
    for (const f of faces) this.i.push(base + f[0], base + f[1], base + f[2]);
  }

  /** A cone (a conifer's tier): its rim drooping and ragged. */
  cone(rng: Rng, y0: number, y1: number, radius: number, sides: number, col: Rgb): void {
    const tip = this.vertex([0, y1, 0], [0, 1, 0], col);
    const rim: number[] = [], below: number[] = [];
    const dark: Rgb = [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * 2 * Math.PI + rng.range(-0.2, 0.2), r = radius * rng.range(0.8, 1.15);
      const nn = norm([Math.cos(ang), radius / Math.max(y1 - y0, 1e-6), Math.sin(ang)]);
      const shade = rng.range(0.8, 1);
      const pos: V3 = [Math.cos(ang) * r, y0 + rng.range(-0.02, 0.01), Math.sin(ang) * r];
      rim.push(this.vertex(pos, nn, [col[0] * shade, col[1] * shade, col[2] * shade]));
      below.push(this.vertex(pos, norm([Math.cos(ang) * 0.3, -1, Math.sin(ang) * 0.3]), dark));
    }
    // The underside, dark: one vertex in the middle, a little up.
    const under = this.vertex([0, y0 + (y1 - y0) * 0.25, 0], [0, -1, 0], dark);
    for (let s = 0; s < sides; s++) {
      const n = (s + 1) % sides;
      this.i.push(tip, rim[n], rim[s], under, below[s], below[n]);
    }
  }

  /** A blade (a reed's leaf): a thin three-sided spike from `base` to `top`. */
  blade(base: V3, top: V3, width: number, col: Rgb): void {
    const t = norm([top[0] - base[0], top[1] - base[1], top[2] - base[2]]);
    const u = norm(cross(t, [0, 1, 0])[0] === 0 && cross(t, [0, 1, 0])[2] === 0 ? [1, 0, 0] : cross(t, [0, 1, 0])), v = cross(t, u);
    const ring: number[] = [];
    for (let s = 0; s < 3; s++) {
      const ang = (s / 3) * 2 * Math.PI, nn: V3 = [u[0] * Math.cos(ang) + v[0] * Math.sin(ang), u[1] * Math.cos(ang) + v[1] * Math.sin(ang), u[2] * Math.cos(ang) + v[2] * Math.sin(ang)];
      ring.push(this.vertex([base[0] + nn[0] * width, base[1] + nn[1] * width, base[2] + nn[2] * width], nn, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7]));
    }
    const tipN = norm([t[0] * 0.3 + u[0], t[1] * 0.3 + u[1], t[2] * 0.3 + u[2]]);
    const tip = this.vertex(top, tipN, col);
    for (let s = 0; s < 3; s++) this.i.push(ring[s], ring[(s + 1) % 3], tip);
  }

  done(reach: number): PlantMesh {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), colors: new Float32Array(this.c), index: new Uint32Array(this.i), reach };
  }
}

/** The variants each plant comes in: enough that neighbours rarely match. */
export const PLANT_VARIANTS = 3;

/** One plant's mesh: its form, variant (0 … PLANT_VARIANTS − 1) and level of detail, the same for the same seed. */
export function buildPlant(spec: PlantSpec, seed: number, variant: number, detail: PlantDetail): PlantMesh {
  const rng = new Rng(deriveSeed(seed, 'plant', spec.name, variant));
  const near = detail === 'near';
  return FORMS[spec.form](new Builder(), rng, spec, near);
}

type FormBuilder = (b: Builder, rng: Rng, spec: PlantSpec, near: boolean) => PlantMesh;

const FORMS: Record<PlantForm, FormBuilder> = {
  broadleaf(b, rng, spec, near) {
    // A trunk to about half the height, limbs fanning up and out to a round crown.
    const fork = rng.range(0.42, 0.52), lean: V3 = [rng.range(-0.04, 0.04), 0, rng.range(-0.04, 0.04)];
    const trunkTop: V3 = [lean[0], fork, lean[2]];
    b.tube([[0, -0.05, 0], [lean[0] * 0.5, fork * 0.5, lean[2] * 0.5], trunkTop], [0.03, 0.024, 0.02], near ? 7 : 4, spec.bark);
    const middle: V3 = [lean[0], rng.range(0.62, 0.7), lean[2]], crown = rng.range(0.3, 0.38), tall = rng.range(0.26, 0.32);
    const limbs = near ? Math.round(rng.range(5, 7)) : 3;
    const tips: V3[] = [];
    for (let k = 0; k < limbs; k++) {
      const ang = (k / limbs) * 2 * Math.PI + rng.range(-0.4, 0.4), out = crown * rng.range(0.5, 0.8);
      const tip: V3 = [middle[0] + Math.cos(ang) * out, middle[1] + rng.range(-0.05, 0.2) * tall / 0.3, middle[2] + Math.sin(ang) * out];
      tips.push(tip);
      if (near) {
        const mid: V3 = [(trunkTop[0] + tip[0]) / 2, (trunkTop[1] + tip[1]) / 2 + 0.03, (trunkTop[2] + tip[2]) / 2];
        b.tube([trunkTop, mid, tip], [0.016, 0.011, 0.006], 5, spec.bark);
      }
    }
    if (near) {
      // Clumps on every limb's end, more filling the crown's top, sides and underside (so the limbs vanish into it).
      for (const t of tips) b.clump(rng, t, sphereRadii(rng, crown * 0.42), 1, spec.leaf, middle, crown);
      const extra = Math.round(rng.range(7, 10));
      for (let k = 0; k < extra; k++) {
        const ang = rng.range(0, 2 * Math.PI), up = rng.range(-0.9, 1), out = crown * rng.range(0.2, 0.7) * Math.sqrt(1 - up * up * 0.5);
        b.clump(rng, [middle[0] + Math.cos(ang) * out, middle[1] + up * tall * 0.8, middle[2] + Math.sin(ang) * out], sphereRadii(rng, crown * 0.4), 1, spec.leaf, middle, crown);
      }
    } else {
      for (const t of tips) b.clump(rng, [(t[0] + middle[0]) / 2, (t[1] + middle[1]) / 2 + 0.05, (t[2] + middle[2]) / 2], sphereRadii(rng, crown * 0.62), 0, spec.leaf, middle, crown);
    }
    return b.done(crown * 1.3);
  },

  conifer(b, rng, spec, near) {
    // A straight trunk to the top; tiers of drooping cones, wide at the bottom of the crown and narrowing to a point.
    const base = rng.range(0.12, 0.3), width = rng.range(0.16, 0.24);
    b.tube([[0, -0.05, 0], [0, 0.5, 0], [0, 0.97, 0]], [0.022, 0.015, 0.004], near ? 6 : 4, spec.bark);
    const tiers = near ? Math.round(rng.range(7, 10)) : 3;
    for (let k = 0; k < tiers; k++) {
      const f = k / tiers, y0 = base + (1 - base) * f * 0.92, y1 = Math.min(1, y0 + (1 - base) / tiers * 1.9);
      b.cone(rng, y0, y1, width * (1 - f * 0.85) * rng.range(0.9, 1.1), near ? 10 : 6, spec.leaf);
    }
    return b.done(width * 1.2);
  },

  umbrella(b, rng, spec, near) {
    // A tall bare trunk that bends and forks under a broad, flat crown.
    const top = rng.range(0.72, 0.8), bend: V3 = [rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)];
    const head: V3 = [bend[0], top, bend[2]];
    b.tube([[0, -0.05, 0], [bend[0] * 0.3, top * 0.5, bend[2] * 0.3], head], [0.03, 0.022, 0.016], near ? 7 : 4, spec.bark);
    const crown = rng.range(0.38, 0.48), middle: V3 = [head[0], top + 0.1, head[2]];
    const clumps = near ? Math.round(rng.range(9, 13)) : 4;
    for (let k = 0; k < clumps; k++) {
      const ang = rng.range(0, 2 * Math.PI), out = crown * Math.sqrt(rng.range(0.05, 1)) * 0.75;
      const at: V3 = [middle[0] + Math.cos(ang) * out, middle[1] + rng.range(-0.02, 0.05), middle[2] + Math.sin(ang) * out];
      if (near && k < 4) b.tube([head, [(head[0] + at[0]) / 2, (head[1] + at[1]) / 2 + 0.02, (head[2] + at[2]) / 2], at], [0.012, 0.008, 0.005], 5, spec.bark);
      const r = crown * (near ? 0.32 : 0.55);
      b.clump(rng, at, [r * rng.range(0.9, 1.1), r * 0.38, r * rng.range(0.9, 1.1)], near ? 1 : 0, spec.leaf, [middle[0], middle[1] - 0.1, middle[2]], crown);
    }
    return b.done(crown * 1.2);
  },

  shrub(b, rng, spec, near) {
    // A low mound of clumps, no trunk to see.
    const spread = rng.range(0.35, 0.5), clumps = near ? Math.round(rng.range(4, 7)) : 2;
    const middle: V3 = [0, 0.35, 0];
    for (let k = 0; k < clumps; k++) {
      const ang = rng.range(0, 2 * Math.PI), out = spread * Math.sqrt(rng.range(0, 1)) * 0.6;
      const at: V3 = [Math.cos(ang) * out, rng.range(0.35, 0.6) * (1 - out), Math.sin(ang) * out];
      b.clump(rng, at, sphereRadii(rng, near ? spread * 0.55 : spread * 0.8), near ? 1 : 0, spec.leaf, middle, spread);
    }
    return b.done(spread * 1.2);
  },

  reeds(b, rng, spec, near) {
    // A clump of blades, leaning out from a tight base.
    const blades = near ? Math.round(rng.range(14, 22)) : 6;
    for (let k = 0; k < blades; k++) {
      const ang = rng.range(0, 2 * Math.PI), at = rng.range(0, 0.08), lean = rng.range(0.05, 0.3), h = rng.range(0.6, 1);
      const base: V3 = [Math.cos(ang) * at, 0, Math.sin(ang) * at];
      const top: V3 = [base[0] + Math.cos(ang) * lean, h, base[2] + Math.sin(ang) * lean];
      const shade = rng.range(0.8, 1.15);
      b.blade(base, top, near ? 0.012 : 0.02, [spec.leaf[0] * shade, spec.leaf[1] * shade, spec.leaf[2] * shade]);
    }
    return b.done(0.35);
  },
};

function sphereRadii(rng: Rng, r: number): V3 {
  return [r * rng.range(0.85, 1.15), r * rng.range(0.7, 0.95), r * rng.range(0.85, 1.15)];
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}


const spheres = new Map<number, { verts: V3[]; faces: [number, number, number][] }>();

/** A unit icosphere: the icosahedron, each face split in four `detail` times. */
function icosphere(detail: number): { verts: V3[]; faces: [number, number, number][] } {
  const known = spheres.get(detail);
  if (known) return known;
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm(v as V3));
  let faces: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const mid = new Map<string, number>(), next: [number, number, number][] = [];
    const half = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        m = verts.length;
        verts = [...verts, norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])];
        mid.set(key, m);
      }
      return m;
    };
    for (const [a, b, c] of faces) {
      const ab = half(a, b), bc = half(b, c), ca = half(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const out = { verts, faces };
  spheres.set(detail, out);
  return out;
}
