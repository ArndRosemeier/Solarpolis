/**
 * A ship from its shape (space/ship.ts) as meshes in the ship frame (+x to the nose, the exhaust along −x): the body
 * (HARDWARE, an albedo per part) and the exhaust plume (FLAME, its glow set per mesh by `userData.flame`).
 */
import type { BufferGeometry } from 'three/webgpu';
import type { ShipRole, ShipShape } from '../space';
import { ShapeBuilder, type RGB } from './geometry';

const ALBEDO: Record<ShipRole, RGB> = {
  hull: [0.6, 0.6, 0.62],
  crew: [0.72, 0.71, 0.68],
  tank: [0.5, 0.48, 0.44],
  radiator: [0.06, 0.06, 0.065],
  drive: [0.3, 0.29, 0.28],
  truss: [0.35, 0.35, 0.36],
};

/** The builder works around z; the ship's axis is x. (x, y, z) of the ship is (z, x, y) of the builder. */
function toShip(b: ShapeBuilder): void {
  for (const a of [b.pos, b.nrm]) {
    for (let k = 0; k < a.length; k += 3) {
      const x = a[k], y = a[k + 1], z = a[k + 2];
      a[k] = z; a[k + 1] = x; a[k + 2] = y;
    }
  }
}

export function shipGeometry(s: ShipShape): { body: BufferGeometry; plume: BufferGeometry } {
  const b = new ShapeBuilder(32, true);
  for (const p of s.parts) {
    const c = ALBEDO[p.role];
    if (p.shape === 'box') {
      // Ship (x, y, z) to builder (y, z, x).
      b.box([p.center[1], p.center[2], p.center[0]], [p.half[1], p.half[2], p.half[0]], c);
    } else if (p.shape === 'cone') {
      const nz = p.r0 - p.r1, nr = p.to - p.from, l = Math.hypot(nz, nr);
      b.band(p.from, p.r0, p.to, p.r1, nz / l, nr / l, c);
      b.band(p.from, 0, p.from, p.r0, -1, 0, c);
    } else {
      const base = b.pos.length;
      b.band(p.from, p.radius, p.to, p.radius, 0, 1, c);
      b.band(p.to, p.radius, p.to, 0, 1, 0, c);
      b.band(p.from, 0, p.from, p.radius, -1, 0, c);
      if (p.offset) for (let k = base; k < b.pos.length; k += 3) { b.pos[k] += p.offset[0]; b.pos[k + 1] += p.offset[1]; }
    }
  }
  toShip(b);
  const plume = new ShapeBuilder(32, false);
  plume.band(0, s.nozzle, -s.plumeLength, s.plumeRadius, 0, 1);
  toShip(plume);
  return { body: b.build(), plume: plume.build() };
}

/** The body's albedo as the exposure meter sees it: the pale crew section and tanks outweigh the dark radiators. */
export const SHIP_ALBEDO = 0.5;
