/**
 * The solar skin up close (Arnd, 2026-10-21: "the closer I get, the more details need to come into view", and the
 * player can go anywhere and find details all the way down): a quadtree of tiles over the drum's panel grid, each tile
 * a mesh of real parts, more of them the smaller the tile.
 *
 * A panel of gen/skin.ts is a bay: a flat tray (the drum is a polygon of flat bays, not a smooth tube) between beams
 * that run in the seams, carrying a grid of solar modules (`Skin.modules` a side), each a grid of cells. By tile size:
 *
 * - 0, tiles of more than eight modules: each bay's tray and glass, the beams, the nodes where beams cross, the drone
 *   tracks (channel and rails).
 * - 1, eight modules down to five: each module its own glass in its frame, the tray showing in the gaps.
 * - 2, a few modules: bolts along the beams, clamps holding the modules, the cable trays on the beams, sensor posts
 *   on the nodes, the tracks' ties.
 * - 3, a module and less: the beams' chamfered profile, washers under the bolts, the cables in their trays and their
 *   ties, the clamps' own bolts.
 *
 * Below the smallest tiles the shaders carry on (cells, their silver fingers, dust, scratches and pits; hullShaders.ts).
 *
 * Each tile holds exactly the parts it owns: an area (tray, glass) cut to its rectangle, a bar the stretch of it whose
 * middle line runs inside, a bolt or clamp whose centre does. Neighbours at any two levels meet without gaps or
 * double parts. Positions are relative to the tile's origin (on the drum at its middle), so float32 keeps them to the
 * millimetre; normals in the blueprint frame. Pure: no three.js.
 */
import { v3cross, type Vec3 } from '@futuremagic/core';
import { LOOK, isTrack, type Skin } from './skin';
import { Shape, bytesOf, type RGB } from './shapes';
import { cellsOf, wantedCells, type Grid, type GridEye, type TileKey, type WantedTile } from './detailTree';

/** A tile of the skin: 2^level bays a side (gen/detailTree.ts). */
export type HullTileKey = TileKey;

/** The largest tiles: 2^ROOT_LEVEL bays a side. */
export const ROOT_LEVEL = 3;

/** The smallest tiles: half a module a side. */
export const finestLevel = (s: Skin): number => -Math.ceil(Math.log2(s.modules)) - 1;

/** How much a tile of this level holds (0–3, the list above). */
export function detailOf(s: Skin, level: number): 0 | 1 | 2 | 3 {
  const modules = Math.pow(2, level) * s.modules;
  if (modules > 8) return 0;
  if (modules > 4) return 1;
  if (modules > 1) return 2;
  return 3;
}

export interface HullTile {
  key: HullTileKey;
  /** The tile's origin in the blueprint frame (m); every position below is relative to it. */
  origin: Vec3;
  /**
   * The glass (the SKIN_DETAIL kind): position, normal, and `grid` = (bay column i, bay row j, x, y), where x and y
   * count modules across the bay's module grid (0 to `Skin.modules`), so the shader finds module, cell and finger.
   */
  glass: { positions: Float32Array; normals: Float32Array; grid: Float32Array; index: Uint32Array };
  /** Trays, beams, frames, bolts, tracks (HARDWARE: position, normal, colour). */
  parts: { positions: Float32Array; normals: Float32Array; colors: Float32Array; index: Uint32Array };
}

/**
 * The bay's design. Beams are shares of the bay's edge `P` (they carry the bay); the rest are shares of the module's
 * edge `M` (a part of a module is as big as the module is), the tracks' parts shares of the track's width.
 */
export const PART = {
  /** The tray stands this far off the drum (M). */
  tray: 0.002,
  /** The modules' glass this far above the tray (M), their frames this wide and this far above the glass (M), gaps between modules (M). */
  glass: 0.016,
  frame: 0.016,
  frameHeight: 0.006,
  gap: 0.008,
  /** Beams in the seams: width (P) and how far their top stands above the glass (M). */
  beam: 0.012,
  beamHeight: 0.06,
  /** A node where beams cross: its half size as a multiple of the beam's half width, its height above the beam top (M). */
  node: 1.6,
  nodeHeight: 0.03,
  /** Sensor post on a node: radius and height (M). */
  post: 0.012,
  postHeight: 0.16,
  /** Bolts along the beams: rows at ± this share of the beam's half width, spacing, head radius, head height, washer (M). */
  boltRow: 0.7,
  boltEvery: 0.4,
  bolt: 0.008,
  boltHeight: 0.006,
  washer: 0.012,
  washerHeight: 0.0015,
  /** Clamps across the gaps between modules: length along the gap, width over each frame, height above the frame (M). */
  clamp: 0.05,
  clampWidth: 0.012,
  clampHeight: 0.008,
  /** The cable tray along each beam that runs with the drum's axis: half width (share of the beam's), wall height, cable radius, ties (M). */
  cableTray: 0.45,
  cableWall: 0.025,
  cable: 0.008,
  cableTieEvery: 0.25,
  /** Tracks: the channel's thickness (M), rail height, tie height and width (shares of the track's width). */
  channel: 0.004,
  railHeight: 0.03,
  tieHeight: 0.008,
  tieWidth: 0.025,
} as const;

/** Albedo of the parts (linear). The tracks' are LOOK.track's, as the shader draws them from afar. */
const COLOR: Record<string, RGB> = {
  tray: [0.035, 0.035, 0.04],
  frame: [0.42, 0.42, 0.44],
  beam: [0.36, 0.36, 0.37],
  node: [0.3, 0.3, 0.31],
  post: [0.55, 0.54, 0.5],
  bolt: [0.5, 0.5, 0.52],
  washer: [0.4, 0.4, 0.42],
  clamp: [0.25, 0.25, 0.26],
  cableTray: [0.2, 0.2, 0.21],
  cable: [0.06, 0.06, 0.065],
  cableTie: [0.5, 0.48, 0.2],
  channel: [...LOOK.track.channel] as RGB,
  rail: [...LOOK.track.rail] as RGB,
  tie: [0.16, 0.16, 0.17],
};

/** The bay (i, j) as a flat frame: its middle (blueprint, on the drum), outward normal, unit around θ, width and length (m). */
export function bayFrame(s: Skin, i: number, j: number): { mid: Vec3; out: Vec3; around: Vec3; width: number; length: number } {
  const dth = (2 * Math.PI) / s.nTheta, th = (i + 0.5) * dth, dz = (s.z1 - s.z0) / s.nZ;
  const out: Vec3 = [Math.cos(th), Math.sin(th), 0], around: Vec3 = [-Math.sin(th), Math.cos(th), 0];
  // The chord through the bay's corners, lifted so its middle touches the drum: it never dips below the drum's mesh.
  return { mid: [out[0] * s.radius, out[1] * s.radius, s.z0 + (j + 0.5) * dz], out, around, width: 2 * s.radius * Math.sin(dth / 2), length: dz };
}

/** The bay's edge and a module's (m). */
export const bayEdge = (s: Skin): number => (2 * Math.PI * s.radius) / s.nTheta;
export const moduleEdge = (s: Skin): number => bayEdge(s) / s.modules;

/** How high the tracks' rails stand above the drum (m): the drones ride on them (render/drones.ts). */
export const railTop = (s: Skin): number => moduleEdge(s) * (PART.tray + PART.channel) + s.trackWidth * PART.railHeight;

/** Where a tile's origin sits: on the drum, at its middle. */
export function tileOrigin(s: Skin, k: HullTileKey): Vec3 {
  const size = Math.pow(2, k.level);
  const ci = (k.i + Math.min(k.i + size, s.nTheta)) / 2, cj = (k.j + Math.min(k.j + size, s.nZ)) / 2;
  const th = (ci / s.nTheta) * 2 * Math.PI;
  return [Math.cos(th) * s.radius, Math.sin(th) * s.radius, s.z0 + (cj / s.nZ) * (s.z1 - s.z0)];
}

const Z: Vec3 = [0, 0, 1];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const offset = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** One tile: the parts it owns of the bays it covers. */
export function buildHullTile(s: Skin, key: HullTileKey): HullTile {
  const origin = tileOrigin(s, key), detail = detailOf(s, key.level);
  const glass = new Shape(4, false), parts = new Shape(4, true), moduleAt: number[] = [];
  const P = bayEdge(s), M = moduleEdge(s), n = s.modules;
  const beamW = P * PART.beam, wTray = M * PART.tray, wGlass = wTray + M * PART.glass, wFrame = wGlass + M * PART.frameHeight;
  const wBeam = wGlass + M * PART.beamHeight;

  for (const { i, j, cut } of cellsOf(skinGrid(s), key)) {
    const f = bayFrame(s, i, j), W = f.width, L = f.length, back = neg(f.around);
    // What the tile owns of this bay (gen/detailTree.ts); `end` when it reaches the drum's far end.
    const { ownsX, ownsY, clipX, clipY } = cut, end = cut.endV;
    // A point of the bay (x, y in bay units, w out from the drum in m), relative to the tile's origin.
    const at = (x: number, y: number, w: number): Vec3 => {
      const u = (x - 0.5) * W, v = (y - 0.5) * L;
      return [0, 1, 2].map((a) => f.mid[a] + f.around[a] * u + Z[a] * v + f.out[a] * w - origin[a]) as Vec3;
    };
    const ux = (m: number): number => m / W, vy = (m: number): number => m / L;
    // Module coordinates across the bay's module grid, for the glass's `grid` attribute.
    const px = (1 - 2 * ux(beamW / 2)) / n, py = (1 - 2 * vy(beamW / 2)) / n;
    const moduleX = (x: number): number => (x - ux(beamW / 2)) / px, moduleY = (y: number): number => (y - vy(beamW / 2)) / py;
    /** An area of the bay at height w, cut to the tile: the tray, or glass. */
    const area = (glassy: boolean, xa: number, xb: number, ya: number, yb: number, w: number): void => {
      const cx = clipX(xa, xb), cy = clipY(ya, yb);
      if (!cx || !cy) return;
      const [a, b] = cx, [c, d] = cy;
      if (!glassy) { parts.quad(at(a, c, w), at(b, c, w), at(b, d, w), at(a, d, w), f.out, COLOR.tray); return; }
      glass.quad(at(a, c, w), at(b, c, w), at(b, d, w), at(a, d, w), f.out);
      for (const [x, y] of [[a, c], [b, c], [b, d], [a, d]]) moduleAt.push(i, j, moduleX(x), moduleY(y));
    };
    /**
     * A straight part along the bay's x (`dir` 'x', at y = `fixed`) or its y (at x = `fixed`), from a to b in bay
     * units, owned where its middle line runs inside the tile and cut to it; `build` gets the two cut ends.
     */
    const bar = (dir: 'x' | 'y', fixed: number, a: number, b: number, build: (p: [number, number], q: [number, number]) => void): void => {
      if (dir === 'x' ? !ownsY(fixed) : !ownsX(fixed)) return;
      const c = dir === 'x' ? clipX(a, b) : clipY(a, b);
      if (!c) return;
      build(dir === 'x' ? [c[0], fixed] : [fixed, c[0]], dir === 'x' ? [c[1], fixed] : [fixed, c[1]]);
    };
    const length = (p: [number, number], q: [number, number]): number => Math.hypot((q[0] - p[0]) * W, (q[1] - p[1]) * L);
    const middle = (p: [number, number], q: [number, number], w: number): Vec3 => at((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, w);

    // Where modules and beams go: clear of a drone track's lane in the seam on either side.
    const lane = s.trackWidth / 2 + M * PART.gap;
    const trackLo = isTrack(s, i), trackHi = isTrack(s, (i + 1) % s.nTheta);
    const xa = trackLo ? ux(lane) : ux(beamW / 2), xb = 1 - (trackHi ? ux(lane) : ux(beamW / 2));
    const ya = vy(beamW / 2), yb = 1 - vy(beamW / 2);

    // The tray under everything.
    area(false, 0, 1, 0, 1, wTray);

    if (detail === 0) {
      area(true, xa, xb, ya, yb, wGlass);
    } else {
      const gap = M * PART.gap, fw = M * PART.frame, hw = fw / 2, hh = (wFrame - wTray) / 2;
      const frameBar = (p: [number, number], q: [number, number], along: Vec3, across: Vec3): void =>
        parts.block(middle(p, q, wTray + hh), along, across, f.out, [length(p, q) / 2, hw, hh], COLOR.frame, true);
      for (let a = 0; a < n; a++) {
        const mx0 = ux(beamW / 2) + a * px + ux(gap / 2), mx1 = mx0 + px - ux(gap);
        if (mx0 < xa || mx1 > xb) continue;
        for (let b = 0; b < n; b++) {
          const my0 = vy(beamW / 2) + b * py + vy(gap / 2), my1 = my0 + py - vy(gap);
          // The glass inside its frame, and the frame's four bars from the tray to just above the glass.
          area(true, mx0 + ux(fw), mx1 - ux(fw), my0 + vy(fw), my1 - vy(fw), wGlass);
          bar('y', mx0 + ux(hw), my0, my1, (p, q) => frameBar(p, q, Z, back));
          bar('y', mx1 - ux(hw), my0, my1, (p, q) => frameBar(p, q, Z, back));
          bar('x', my0 + vy(hw), mx0 + ux(fw), mx1 - ux(fw), (p, q) => frameBar(p, q, f.around, Z));
          bar('x', my1 - vy(hw), mx0 + ux(fw), mx1 - ux(fw), (p, q) => frameBar(p, q, f.around, Z));
          if (detail < 2) continue;
          // Clamps over the gap on the module's +x side, near each end, holding it and its neighbour down.
          const cx = mx1 + ux(gap / 2), cl = M * PART.clamp, ch = M * PART.clampHeight, cw = gap / 2 + M * PART.clampWidth;
          if (cx + ux(gap) > xb) continue;
          for (const yy of [my0 + vy(cl), my1 - vy(cl)]) {
            if (!ownsX(cx) || !ownsY(yy)) continue;
            parts.block(at(cx, yy, wFrame + ch / 2), Z, back, f.out, [cl / 2, cw, ch / 2], COLOR.clamp, true);
            if (detail >= 3) parts.prism(at(cx, yy, wFrame + ch), f.around, Z, f.out, M * PART.bolt * 0.6, M * PART.boltHeight * 0.6, 6, COLOR.bolt);
          }
        }
      }
    }

    // Bolts in two rows along a beam's top; on beams along the axis the cable tray down its middle instead of one row.
    const beamFittings = (dir: 'x' | 'y', p: [number, number], q: [number, number], along: Vec3): void => {
      const span = dir === 'y' ? L : W, count = Math.floor(span / (M * PART.boltEvery));
      const side = v3cross(f.out, along), hb = beamW / 2;
      const from = dir === 'y' ? p[1] : p[0], to = dir === 'y' ? q[1] : q[0];
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        if (t < from || t >= to) continue;
        for (const r of [-1, 1]) {
          const base = dir === 'y' ? at(p[0], t, wBeam) : at(t, p[1], wBeam), c = offset(base, side, r * PART.boltRow * hb);
          if (detail >= 3) parts.prism(c, along, side, f.out, M * PART.washer, M * PART.washerHeight, 12, COLOR.washer);
          parts.prism(offset(c, f.out, detail >= 3 ? M * PART.washerHeight : 0), along, side, f.out, M * PART.bolt, M * PART.boltHeight, 6, COLOR.bolt);
        }
      }
      if (dir !== 'y') return;
      // The cable tray: two low walls on the beam's top, and inside them three cables with their ties (detail 3).
      const tw = PART.cableTray * hb, wall = M * PART.cableWall, a = at(p[0], p[1], wBeam), len = length(p, q);
      for (const r of [-1, 1]) parts.block(offset(offset(middle(p, q, wBeam), side, r * tw), f.out, wall / 2), along, side, f.out, [len / 2, M * 0.003, wall / 2], COLOR.cableTray, true);
      if (detail < 3) return;
      const rc = M * PART.cable;
      for (const r of [-1, 0, 1]) parts.prism(offset(offset(a, side, r * rc * 2.2), f.out, rc), side, f.out, along, rc, len, 8, COLOR.cable);
      const ties = Math.floor(L / (M * PART.cableTieEvery));
      for (let k = 0; k < ties; k++) {
        const t = (k + 0.5) / ties;
        if (t >= p[1] && t < q[1]) parts.block(at(p[0], t, wBeam + rc), along, side, f.out, [M * 0.002, rc * 3.6, rc * 1.15], COLOR.cableTie, true);
      }
    };
    // The beams: along y in the seam at x = 0 (unless a track runs there), along x in the seam at y = 0, and at the
    // drum's far end also at y = 1. Each from the tray to its top, centred on the seam, stopping at a track's lane.
    const beam = (dir: 'x' | 'y', fixed: number, a: number, b: number): void => bar(dir, fixed, a, b, (p, q) => {
      const along: Vec3 = dir === 'y' ? Z : f.around, across: Vec3 = dir === 'y' ? back : Z, hb = beamW / 2, ht = wBeam - wTray;
      if (detail >= 3) {
        const ch = Math.min(hb * 0.25, ht * 0.4);
        const profile: [number, number][] = [[-hb, 0], [hb, 0], [hb, ht - ch], [hb - ch, ht], [-hb + ch, ht], [-hb, ht - ch]];
        parts.sweep(profile, at(p[0], p[1], wTray), at(q[0], q[1], wTray), v3cross(f.out, along), f.out, COLOR.beam);
      } else {
        parts.block(middle(p, q, wTray + ht / 2), along, across, f.out, [length(p, q) / 2, hb, ht / 2], COLOR.beam, true);
      }
      if (detail >= 2) beamFittings(dir, p, q, along);
    });
    const bx0 = trackLo ? ux(lane) : 0, bx1 = trackHi ? 1 - ux(lane) : 1;
    if (!trackLo) beam('y', 0, 0, 1);
    beam('x', 0, bx0, bx1);
    if (end) beam('x', 1, bx0, bx1);

    // Nodes where the beams cross, with a sensor post (detail 2).
    const node = (y: number): void => {
      if (trackLo || !ownsX(0) || !ownsY(y)) return;
      const h = (beamW / 2) * PART.node, top = wBeam + M * PART.nodeHeight;
      parts.block(at(0, y, (wTray + top) / 2), f.around, Z, f.out, [h, h, (top - wTray) / 2], COLOR.node, true);
      if (detail >= 2) parts.prism(at(0, y, top), f.around, Z, f.out, M * PART.post, M * PART.postHeight, 8, COLOR.post);
    };
    node(0);
    if (end) node(1);

    // The drone track in the seam at x = 0: a channel, two rails (LOOK.track's), ties across every tieEvery m.
    if (trackLo) {
      const tw = s.trackWidth, wc = wTray + M * PART.channel, wr = tw * PART.railHeight, T = LOOK.track;
      bar('y', 0, 0, 1, (p, q) => {
        const len = length(p, q) / 2, mid = (p[1] + q[1]) / 2;
        parts.block(at(0, mid, (wTray + wc) / 2), Z, back, f.out, [len, tw / 2, (wc - wTray) / 2], COLOR.channel, true);
        for (const r of [-1, 1]) parts.block(at(ux(r * tw * T.railAt), mid, wc + wr / 2), Z, back, f.out, [len, (tw * T.railWidth) / 2, wr / 2], COLOR.rail, true);
        if (detail < 2) return;
        const z0 = s.z0 + (j + p[1]) * L, z1 = s.z0 + (j + q[1]) * L, h = tw * PART.tieHeight;
        for (let z = Math.ceil(z0 / T.tieEvery) * T.tieEvery; z < z1; z += T.tieEvery) {
          parts.block(at(0, (z - s.z0) / L - j, wc + h / 2), Z, back, f.out, [(tw * PART.tieWidth) / 2, tw * (T.railAt - T.railWidth / 2), h / 2], COLOR.tie, true);
        }
      });
    }
  }
  const g = glass.arrays(), q = parts.arrays();
  return {
    key, origin,
    glass: { positions: g.positions, normals: g.normals, grid: new Float32Array(moduleAt), index: g.index },
    parts: { positions: q.positions, normals: q.normals, colors: q.colors ?? new Float32Array(0), index: q.index },
  };
}

/** Bytes a built tile holds. */
export function hullTileBytes(t: HullTile): number {
  return bytesOf([t.glass.positions, t.glass.normals, t.glass.grid, t.glass.index, t.parts.positions, t.parts.normals, t.parts.colors, t.parts.index]);
}

/** The skin's bays as a detail grid: columns around (wrapping), rows along the drum. */
export function skinGrid(s: Skin): Grid {
  return { nU: s.nTheta, nV: s.nZ, wrap: true, edgeU: bayEdge(s), edgeV: (s.z1 - s.z0) / s.nZ, root: ROOT_LEVEL, finest: finestLevel(s) };
}

/** A body-frame eye (m) over the skin's grid. */
export function skinEye(s: Skin, eye: Vec3): GridEye {
  const turn = Math.atan2(eye[1], eye[0]) / (2 * Math.PI);
  return { u: (turn - Math.floor(turn)) * s.nTheta, v: ((eye[2] - s.z0) / (s.z1 - s.z0)) * s.nZ, h: Math.max(0, Math.hypot(eye[0], eye[1]) - s.radius) };
}

/** The skin's tiles around an eye at body-frame point `eye` (m). */
export const wantedTiles = (s: Skin, eye: Vec3): WantedTile[] => wantedCells(skinGrid(s), skinEye(s, eye));
