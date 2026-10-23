/** Exterior modules derived from the inhabited-ship recipe: heat-rejection wings, hull seams,
 * docking collar, sensors and reaction-control pods. Built with the shared Shape grammar. */
import type { Vec3 } from '@futuremagic/core';
import { Shape } from '../gen/shapes';
import type { VesselPlan } from '../space/vessel';
import { shipAxisShape } from './ship';

export function vesselDetails(plan: VesselPlan): Shape {
  const shape = new Shape(96, true), L = plan.shape.params.length, R = plan.recipe.radius;
  const ceramic = plan.recipe.palette.shell, dark: Vec3 = [.025, .045, .047], bronze: Vec3 = [.25, .15, .075];
  // Narrow bands reveal the deck stack without making each floor a separate pressure vessel.
  for (const d of plan.decks) {
    shape.band(d.floor + .1, R + .04, d.floor + .38, R + .04, 0, 1, dark);
    shape.band(d.floor + .08, R + .07, d.floor + .1, R + .07, 0, 1, bronze);
  }
  // Rounded shoulders on each tank, covering its formerly flat ends.
  for (const part of plan.shape.parts) if (part.role === 'tank' && part.shape === 'cylinder') {
    for (const end of [-1, 1]) {
      const base = shape.pos.length;
      for (let j = 0; j < 10; j++) {
        const a = j / 10 * Math.PI / 2, b = (j + 1) / 10 * Math.PI / 2;
        const x = end < 0 ? part.from : part.to, sign = end;
        const x0 = x + sign * part.radius * .4 * Math.sin(a), x1 = x + sign * part.radius * .4 * Math.sin(b);
        const r0 = part.radius * Math.cos(a), r1 = part.radius * Math.cos(b);
        if (end > 0) shape.band(x0, r0, x1, r1, Math.sin((a + b) / 2), Math.cos((a + b) / 2), ceramic);
        else shape.band(x1, r1, x0, r0, -Math.sin((a + b) / 2), Math.cos((a + b) / 2), ceramic);
      }
      if (part.offset) for (let k = base; k < shape.pos.length; k += 3) { shape.pos[k] += part.offset[0]; shape.pos[k + 1] += part.offset[1]; }
    }
  }
  for (const x of [.12, .19, .60, .79]) shape.band(L * x, R * .34, L * x + .2, R * .34, 0, 1, bronze);
  shipAxisShape(shape);
  // Twelve replaceable leaves per wing; swept margins and slim channels, rather than a single rectangular plate.
  for (const side of [-1, 1]) for (let k = 0; k < 12; k++) {
    const u0 = k / 12, u1 = (k + .96) / 12;
    const edge = (u: number, front: boolean, y: number): Vec3 => [L * (front ? .61 - .09 * u : .22 + .06 * u), y, side * R * (.25 + u * 4.2)];
    for (const face of [-1, 1]) {
      const y = face * .12;
      shape.faceToward(edge(u0, false, y), edge(u0, true, y), edge(u1, true, y), edge(u1, false, y), [0, face, 0], k % 3 ? dark : [.045, .065, .060]);
    }
    const outer = (u0 + u1) / 2;
    shape.box([L * (.61 - .09 * outer), 0, side * R * (.25 + outer * 4.2)], [.1, .16, R * 4.2 / 24], bronze);
  }
  // A side-facing pressure collar on the Welcome deck, with nested seals and an opaque outer hatch.
  const hatch = new Shape(64, true), center = plan.start + plan.recipe.deckHeight / 2, hatchRadius = Math.min(1.85, (plan.recipe.deckHeight - .5) / 2);
  hatch.band(R - .3, hatchRadius, R + 1.1, hatchRadius, 0, 1, ceramic);
  hatch.band(R + 1.1, hatchRadius, R + 1.1, hatchRadius * .8, 1, 0, bronze);
  hatch.band(R + 1.13, hatchRadius * .8, R + 1.13, 0, 1, 0, dark);
  // Hatch's z axis becomes +y; its x/y disc spans ship x/z.
  const offset = shape.vertices;
  for (let k = 0; k < hatch.pos.length; k += 3) {
    shape.pos.push(center + hatch.pos[k], hatch.pos[k + 2], -hatch.pos[k + 1]);
    shape.nrm.push(hatch.nrm[k], hatch.nrm[k + 2], -hatch.nrm[k + 1]);
    shape.col.push(hatch.col[k], hatch.col[k + 1], hatch.col[k + 2]);
  }
  shape.idx.push(...hatch.idx.map(i => i + offset));
  // Flush optical instruments and four symmetric attitude-control clusters.
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, y = Math.cos(a), z = Math.sin(a);
    shape.box([L * .965, y * R * .82, z * R * .82], [.55, .65, .65], dark);
    shape.box([L * .805, y * (R + .2), z * (R + .2)], [.8, .45, .45], ceramic);
  }
  return shape;
}
