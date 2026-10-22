/**
 * What the physics bumps into among the plants: the trunks of the trees and the fallen trunks on the ground. A runner
 * stops at a trunk (Arnd, 2026-10-22: trees were walk-through; the trunk should stop a runner, nothing more): branches,
 * leaves, shrubs, grass and fallen branches stay walk-through.
 *
 * Each trunk is a chain of pieces, capsules between two points, from the same lattice (`standsIn`), the same pose
 * (`poseOf`, `plantPoint`) and the same full-detail model (`trunkOf`, `fallenLine` in gen/trees.ts) as the tree the
 * renderer draws nearest, whichever level is drawn. Built with the ground patch (gen/patch.ts) in the generation workers,
 * relative to its origin; the trunk lines are made once per form and shape and kept with the habitat. Pure.
 */
import { toWorld, type Habitat, type PlantForm, type PlantSpec, type DebrisSpec, type Vec3 } from '../blueprint';
import { TREE_HEIGHT, type Ecology } from './ecology';
import { LEVELS, plantPoint, poseOf, standsIn, type Species } from './scatter';
import { fallenLine, trunkOf, TRUNK_POINT } from './trees';
import { kept } from './kept';

/** Floats per piece in `GroundPatch.trunks`: its two ends (relative to the patch's origin) and its radius (m). */
export const TRUNK_PIECE = 7;

/** Whether a species stands in the physics: a tree (as tall as `TREE_HEIGHT` full grown), or a fallen trunk. */
export const isSolid = (sp: Species): boolean =>
  sp.what === 'debris' ? (sp.spec as DebrisSpec).form === 'log' : (sp.what === 'plant' || sp.what === 'planted') && sp.spec.height[1] >= TREE_HEIGHT;

/** Each form's trunk line per shape (`TRUNK_POINT` floats a point, one unit high or long), made when first met. */
const linesOf = kept((_h: Habitat) => new Map<string, Float32Array>());

/** The trunk line of a solid species' shape. */
function lineOf(h: Habitat, sp: Species, shape: number): Float32Array {
  const debris = sp.what === 'debris', form = debris ? ((sp.spec as DebrisSpec).wood ?? 'oak') : (sp.spec as PlantSpec).form;
  const key = `${debris ? 'log' : 'tree'}:${form}:${shape}`, lines = linesOf(h);
  let line = lines.get(key);
  if (!line) {
    line = debris ? fallenLine(form as PlantForm, 'log', h.seed, shape) : trunkOf(form as PlantForm, h.seed, shape);
    lines.set(key, line);
  }
  return line;
}

/**
 * The trunks standing within a square `size` m across centred on (θ, s), as pieces (`TRUNK_PIECE` floats each)
 * relative to `origin` (world).
 */
export function trunksNear(ecology: Ecology, plants: readonly Species[], theta: number, s: number, size: number, origin: Vec3): Float32Array {
  const h = ecology.terrain.habitat, { profile } = h, half = size / 2;
  const s0 = Math.max(0, s - half), s1 = Math.min(profile.length, s + half);
  // Around the axis as far as half the square reaches where the circle is narrowest within it.
  const r = Math.min(profile.at(s0).r, profile.at(s).r, profile.at(s1).r);
  const turn = r > half / Math.PI ? half / r : Math.PI;
  const bounds = { theta0: theta - turn, theta1: theta + turn, s0, s1 };
  const out: number[] = [];
  for (const sp of plants) {
    if (!isSolid(sp)) continue;
    const shapes = LEVELS[0].variants;
    standsIn(ecology, sp, bounds, 0, (pt, ps, ground, f, along0) => {
      const foot = toWorld(profile, { theta: pt, s: ps, h: ground });
      const pose = poseOf(ecology, sp, pt, ps, foot, f, along0, shapes), line = lineOf(h, sp, pose.shape);
      let a = plantPoint(foot, pose, line[0], line[1], line[2]);
      for (let i = TRUNK_POINT; i < line.length; i += TRUNK_POINT) {
        const b = plantPoint(foot, pose, line[i], line[i + 1], line[i + 2]);
        const radius = ((line[i - 1] + line[i + 3]) / 2) * pose.height;
        out.push(a[0] - origin[0], a[1] - origin[1], a[2] - origin[2], b[0] - origin[0], b[1] - origin[1], b[2] - origin[2], radius);
        a = b;
      }
    });
  }
  return new Float32Array(out);
}
