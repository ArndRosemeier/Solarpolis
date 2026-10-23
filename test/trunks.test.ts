import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, fromWorld, toWorld, type Vec3 } from '../src/blueprint';
import { buildPatch } from '../src/gen/patch';
import { cellsNear, nearestOf, plantCell, plantsOf, plantPoint } from '../src/gen/scatter';
import { isSolid, trunksNear, TRUNK_PIECE } from '../src/gen/trunks';
import { fallenLine, trunkOf, TRUNK_POINT } from '../src/gen/trees';
import { upAt } from '../src/world/motion';
import { PhysicsWorld, PHYSICS_STEP } from '../src/physics/world';
import { HUMAN } from '../src/physics/character';
import { ecologyOf } from './worlds';
import { STRONG } from './runs';

/** A square this wide (m) around the tree under test: a few neighbours, quick to plant. */
const SIZE = 24;
/** Tree species checked per habitat (each costs its trunk lines). */
const SPECIES = 2;
/** Running speed (m/s): the walker's 5 m/s, times the view's RUN. */
const RUNNING = 40;

/** How far a point lies from a piece's axis (the segment from a to b). */
function fromAxis(p: Vec3, t: Float32Array, i: number, origin: Vec3): number {
  const a = [t[i] + origin[0], t[i + 1] + origin[1], t[i + 2] + origin[2]], b = [t[i + 3] + origin[0], t[i + 4] + origin[1], t[i + 5] + origin[2]];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const f = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - d[0] * f, p[1] - a[1] - d[1] * f, p[2] - a[2] - d[2] * f);
}

for (const { name, params } of MATRIX) {
  test(`trunks (${name}): every tree drawn near the eye has its trunk in the physics, standing where it is drawn`, () => {
    const eco = ecologyOf(name, params), h = eco.terrain.habitat, plants = plantsOf(eco);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2, eye = toWorld(h.profile, { theta: 1, s, h: eco.terrain.heightAt(1, s) + 1.7 });
    const trees = plants.filter((sp) => sp.what === 'plant' && isSolid(sp));
    assert.ok(trees.length > 0, 'the climate has trees');
    let checked = 0;
    for (const sp of trees) {
      if (checked === SPECIES) break;
      // The tree nearest the eye in the full level's nearest cell, the square of trunks around it.
      const cell = cellsNear(eco, sp, 0, eye).map((c) => plantCell(eco, plants, c.key)).find((c) => c.count > 0);
      if (!cell) continue;
      const list = cell.instances.find((l) => l.length > 0)!, shape = cell.instances.indexOf(list);
      const foot: Vec3 = [cell.origin[0] + list[0], cell.origin[1] + list[1], cell.origin[2] + list[2]];
      const at = fromWorld(h.profile, ...foot), origin = toWorld(h.profile, { theta: at.theta, s: at.s, h: eco.terrain.heightAt(at.theta, at.s) });
      const pieces = trunksNear(eco, plants, at.theta, at.s, SIZE, origin);
      assert.deepEqual(pieces, trunksNear(eco, plants, at.theta, at.s, SIZE, origin), 'the same each time');
      // Its trunk starts at its foot (the line's first point, sunk a little), as the renderer stands it.
      const line = trunkOf((sp.spec as { form: 'oak' }).form, h.seed, shape), pose = { shape, height: list[3], turn: list[4], tilt: [0, 0] as [number, number] };
      const start = plantPoint(foot, pose, line[0], line[1], line[2]);
      let found = -1;
      for (let i = 0; i < pieces.length; i += TRUNK_PIECE) if (Math.hypot(pieces[i] + origin[0] - start[0], pieces[i + 1] + origin[1] - start[1], pieces[i + 2] + origin[2] - start[2]) < 1e-3) found = i;
      assert.ok(found >= 0, `${sp.spec.name}: its trunk is there`);
      // As thick as its bark is drawn, upright along up there, and a person's height up it is still trunk.
      assert.ok(Math.abs(pieces[found + 6] - ((line[3] + line[TRUNK_POINT + 3]) / 2) * pose.height) < 1e-4, 'its radius');
      const up = upAt(foot)!, rise = [0, 1, 2].map((k) => pieces[found + 3 + k] - pieces[found + k]), len = Math.hypot(...rise);
      assert.ok((rise[0] * up[0] + rise[1] * up[1] + rise[2] * up[2]) / len > 0.9, 'upright');
      const chest = [foot[0] + up[0] * 1.3, foot[1] + up[1] * 1.3, foot[2] + up[2] * 1.3] as Vec3;
      let inside = false;
      for (let i = 0; i < pieces.length; i += TRUNK_PIECE) if (fromAxis(chest, pieces, i, origin) < pieces[i + 6]) inside = true;
      assert.ok(inside, 'chest high on its axis is inside the trunk');
      checked++;
    }
    assert.ok(checked > 0, 'some trees checked');
  });
}

for (const { name, params } of MATRIX) {
  test(`trunks (${name}): a runner stops at a trunk and goes on past where there is none`, async () => {
    // The tree nearest the middle of the floor, and the patch round it.
    const eco = ecologyOf(name, params), h = eco.terrain.habitat, plants = plantsOf(eco);
    const s = (h.profile.floorStart + h.profile.floorEnd) / 2, eye = toWorld(h.profile, { theta: 0, s, h: eco.terrain.heightAt(0, s) + 1.7 });
    const tree = nearestOf(eco, plants, plants.find((sp) => sp.what === 'plant' && isSolid(sp))!, eye);
    assert.ok(tree, 'a tree');
    const at0 = fromWorld(h.profile, ...tree!);
    const patch = buildPatch(eco.terrain, at0.theta, at0.s, SIZE, 2, false, { ecology: eco, plants });
    const t = patch.trunks, o = patch.origin;
    assert.ok(t.length > 0, 'trees near');
    // A trunk with open ground round it: from 6 m off, a straight run at it meets no other piece.
    let run: { from: Vec3; dir: Vec3; pieces: number[] } | null = null;
    for (let i = 0; i < t.length && !run; i += TRUNK_PIECE) {
      const foot: Vec3 = [t[i] + o[0], t[i + 1] + o[1], t[i + 2] + o[2]], at = fromWorld(h.profile, ...foot);
      if (Math.abs(at.h - eco.terrain.heightAt(at.theta, at.s)) > 0.5 || Math.hypot(foot[0] - o[0], foot[1] - o[1], foot[2] - o[2]) > SIZE / 4) continue; // a trunk's foot, not a piece higher up
      for (let k = 0; k < 8 && !run; k++) {
        const a = (k / 8) * 2 * Math.PI, rr = Math.max(h.profile.at(at.s).r, 1);
        const th = at.theta + (Math.cos(a) * 6) / rr, ss = at.s + Math.sin(a) * 6;
        if (eco.terrain.standAt(th, ss) > eco.terrain.heightAt(th, ss)) continue; // in water
        const from = toWorld(h.profile, { theta: th, s: ss, h: eco.terrain.heightAt(th, ss) + 0.05 });
        const clear = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].every((d) => {
          const p: Vec3 = [from[0] + ((foot[0] - from[0]) * d) / 6, from[1] + ((foot[1] - from[1]) * d) / 6, from[2] + ((foot[2] - from[2]) * d) / 6];
          // Any other tree's pieces (not those of this one, which pass by its foot).
          for (let j = 0; j < t.length; j += TRUNK_PIECE) if (fromAxis(foot, t, j, o) > 2 && fromAxis(p, t, j, o) < t[j + 6] + HUMAN.radius + 0.5) return false;
          return true;
        });
        if (clear) {
          const d: Vec3 = [foot[0] - from[0], foot[1] - from[1], foot[2] - from[2]], n = Math.hypot(...d);
          // The tree's pieces: the chain from its foot, each starting where the last ends.
          const pieces = [i];
          for (let j = i + TRUNK_PIECE; j < t.length && t[j] === t[j - TRUNK_PIECE + 3] && t[j + 1] === t[j - TRUNK_PIECE + 4] && t[j + 2] === t[j - TRUNK_PIECE + 5]; j += TRUNK_PIECE) pieces.push(j);
          run = { from, dir: [d[0] / n, d[1] / n, d[2] / n], pieces };
        }
      }
    }
    assert.ok(run, 'a trunk to run at');
    /** Run at it: how far the body got along the run, and the least room between its axis and the bark (m). */
    const world = await PhysicsWorld.create(h);
    const go = (trunks: boolean): { gone: number; room: number } => {
      world.setGround(trunks ? patch : { ...patch, trunks: new Float32Array(0) });
      const c = world.addCharacter(run!.from);
      c.legs = STRONG;
      for (let i = 0; i < Math.round(0.4 / PHYSICS_STEP); i++) world.advance(PHYSICS_STEP);
      let room = Infinity;
      // Half a second at a run: 20 m, far past it.
      for (let i = 0; i < Math.round(0.5 / PHYSICS_STEP); i++) {
        const up = upAt(c.feet())!, k = run!.dir[0] * up[0] + run!.dir[1] * up[1] + run!.dir[2] * up[2];
        const along: Vec3 = [run!.dir[0] - up[0] * k, run!.dir[1] - up[1] * k, run!.dir[2] - up[2] * k], n = Math.hypot(...along);
        c.stride.walk = [(along[0] / n) * RUNNING, (along[1] / n) * RUNNING, (along[2] / n) * RUNNING];
        world.advance(PHYSICS_STEP);
        // Knee and chest high on the body's axis.
        const f = c.feet();
        for (const high of [0.5, 1.3]) {
          const p: Vec3 = [f[0] + up[0] * high, f[1] + up[1] * high, f[2] + up[2] * high];
          for (const j of run!.pieces) room = Math.min(room, fromAxis(p, t, j, o) - t[j + 6]);
        }
      }
      const f = c.feet(), gone = (f[0] - run!.from[0]) * run!.dir[0] + (f[1] - run!.from[1]) * run!.dir[1] + (f[2] - run!.from[2]) * run!.dir[2];
      return { gone, room };
    };
    const stopped = go(true), free = go(false);
    world.dispose();
    // The body never goes into the bark: its side meets it (it may slide round the trunk, as one glances off a tree).
    assert.ok(stopped.room > HUMAN.radius - 0.05, `kept ${stopped.room.toFixed(2)} m from the bark`);
    assert.ok(stopped.gone < free.gone - 2, `held up: ${stopped.gone.toFixed(2)} m vs ${free.gone.toFixed(2)} m`);
    // Without the trunk it runs straight through where it stands.
    assert.ok(free.room < 0, `without the trunk it runs on: ${free.gone.toFixed(2)} m, ${free.room.toFixed(2)} m from the bark`);
  });
}

test('trunks: a fallen trunk lies along its length, resting on the ground, as thick as its bark; fallen branches are walked through', () => {
  const eco = ecologyOf(MATRIX[0].name, MATRIX[0].params), plants = plantsOf(eco);
  const logs = plants.filter((sp) => sp.what === 'debris' && isSolid(sp));
  assert.ok(logs.length > 0, 'the climate has fallen trunks');
  assert.ok(plants.filter((sp) => sp.what === 'debris' && (sp.spec as { form: string }).form === 'branch').every((sp) => !isSolid(sp)), 'branches are not solid');
  assert.ok(plants.filter((sp) => sp.what === 'cover' || (sp.what === 'plant' && sp.spec.height[1] < 6)).every((sp) => !isSolid(sp)), 'grass and shrubs are not solid');
  const line = fallenLine('oak', 'log', eco.terrain.habitat.seed, 0), n = line.length / TRUNK_POINT;
  assert.ok(n >= 2);
  assert.ok(Math.abs(line[0] + 0.5) < 1e-3 && Math.abs(line[(n - 1) * TRUNK_POINT] - 0.5) < 1e-3, 'end to end along x, one unit long');
  for (let i = 0; i < line.length; i += TRUNK_POINT) assert.ok(line[i + 3] > 0 && line[i + 1] > 0 && line[i + 1] < line[i + 3] * 1.01, 'its axis less than a radius up: resting on the ground, sunk a little');
});
