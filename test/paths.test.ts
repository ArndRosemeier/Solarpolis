import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_LAYERS, MATRIX, STYLE_LAND, derive } from '../src/blueprint';
import { makeTerrain } from '../src/gen/terrain';
import { makeEcology } from '../src/gen/ecology';
import { planOf, type PlanPath } from '../src/gen/plan';
import { CROWN, pathCover, pathsOf } from '../src/gen/paths';
import { cellsNear, plantCell, plantsOf, PLANT_STRIDE } from '../src/gen/scatter';
import { fromWorld, toWorld } from '../src/blueprint';

/** Every `every`-th point of a path, with the direction across it there (unit, in θ·R and s). */
function along(path: PlanPath, R: number, every: number): { theta: number; s: number; nu: number; ns: number }[] {
  const p = path.points, out: { theta: number; s: number; nu: number; ns: number }[] = [];
  for (let i = 2; i < p.length; i += 2 * every) {
    const du = (p[i] - p[i - 2]) * R, ds = p[i + 1] - p[i - 1], l = Math.hypot(du, ds) || 1;
    out.push({ theta: (p[i] + p[i - 2]) / 2, s: (p[i + 1] + p[i - 1]) / 2, nu: -ds / l, ns: du / l });
  }
  return out;
}

for (const { name, params } of MATRIX) {
  test(`paths (${name}): the plan's paths have their widths, and the ways swing gently but keep out of the lake`, () => {
    const h = derive(params), plan = planOf(h), R = h.radius, widths = params.plan.pathWidth, lake = plan.lake;
    for (const p of plan.paths) assert.equal(p.width, widths[p.kind]);
    let swung = 0, long = 0;
    for (const p of plan.paths.filter((k) => k.kind === 'way')) {
      const q = p.points, n = q.length / 2;
      const du = (q[q.length - 2] - q[0]) * R, dv = q[q.length - 1] - q[1], length = Math.hypot(du, dv);
      let most = 0;
      for (let i = 0; i < n; i++) {
        const u = (q[i * 2] - q[0]) * R, v = q[i * 2 + 1] - q[1];
        most = Math.max(most, Math.abs(u * dv - v * du) / (length || 1));
        if (lake) assert.ok(Math.abs(q[i * 2 + 1] - lake.s) >= lake.halfWidth, 'a way runs into the lake');
      }
      assert.ok(most <= length * 0.11, `a way swings ${most.toFixed(0)} m off a ${length.toFixed(0)} m line`);
      if (n > 4) { long++; if (most > length * 0.005) swung++; }
    }
    assert.ok(long === 0 || swung > long * 0.8, `${swung} of ${long} long ways swing`);
  });

  test(`paths (${name}): the ground is level across each path, crowned a little, and stays close to the land`, () => {
    const h = derive(params), t = makeTerrain(h), plan = planOf(h), net = pathsOf(h), R = h.radius;
    let checked = 0;
    for (const path of plan.paths) {
      const half = path.width / 2;
      for (const at of along(path, R, path.kind === 'way' ? 7 : 3).slice(0, 40)) {
        const hit = net.pathAt(at.theta, at.s);
        assert.ok(hit && (hit.distance < 1e-3 || (hit.kind !== path.kind && hit.distance < hit.width / 2)), 'a point on the middle line finds its path, or a wider one over it');
        if (hit.kind !== path.kind) continue; // where paths meet, the wider is the ground
        if (t.riverAt(at.theta, at.s) || t.courtAt(at.theta, at.s) || (t.lake && Math.abs(at.s - t.lake.s) < t.lake.halfWidth * 1.2)) continue;
        const side = (k: number) => t.heightAt(at.theta + (at.nu * k) / R, at.s + at.ns * k);
        const left = side(-half * 0.8), mid = side(0), right = side(half * 0.8);
        if (net.pathAt(at.theta + (at.nu * -half * 0.8) / R, at.s + at.ns * -half * 0.8)?.kind !== path.kind) continue;
        if (net.pathAt(at.theta + (at.nu * half * 0.8) / R, at.s + at.ns * half * 0.8)?.kind !== path.kind) continue;
        // At a ford's edge one side is the river's bed (crossings.ts builds over it).
        if ([-1, 1].some((k) => t.riverAt(at.theta + (at.nu * k * half * 0.8) / R, at.s + at.ns * k * half * 0.8))) continue;
        assert.ok(Math.abs(left - right) < CROWN * half + 0.05, `${path.kind} tilts ${(left - right).toFixed(2)} m across`);
        assert.ok(mid >= Math.min(left, right) - 1e-6, `${path.kind} crowned`);
        checked++;
      }
    }
    assert.ok(checked > 10, `${checked} points checked`);
  });

  test(`paths (${name}): each path is laid in its surface, a far one is a faint line, and no plant stands on one`, () => {
    const h = derive(params), eco = makeEcology(makeTerrain(h)), t = eco.terrain, plan = planOf(h), net = pathsOf(h), R = h.radius;
    const out = new Float32Array(3), floor = new Uint8Array(FLOOR_LAYERS.length);
    const sunwalk = plan.paths.find((p) => p.kind === 'sunwalk')!;
    let laid = 0;
    for (const path of plan.paths.filter((p) => p.kind !== 'trail')) for (const at of along(path, R, 5).slice(0, 20)) {
      const hit = net.pathAt(at.theta, at.s);
      if (!hit || hit.kind !== path.kind || t.courtAt(at.theta, at.s) || t.riverAt(at.theta, at.s)) continue;
      const g = t.heightAt(at.theta, at.s);
      if (t.lake && g < t.lake.level) continue;
      eco.colorAt(at.theta, at.s, g, 0.02, out, 0, undefined, floor);
      const layer = FLOOR_LAYERS.indexOf(hit.layer);
      assert.ok(floor[layer] > 200, `${path.kind} laid in ${hit.layer}: ${floor[layer]}`);
      if (hit.style) assert.equal(hit.layer, STYLE_LAND[hit.style].way);
      laid++;
    }
    assert.ok(laid > 5, `${laid} points laid`);
    // From afar, a patch ten widths across holds a tenth of the path.
    const at = along(sunwalk, R, 9)[2];
    const hit = net.pathAt(at.theta, at.s, sunwalk.width * 5)!;
    assert.ok(Math.abs(pathCover(hit, sunwalk.width * 10) - 0.1) < 0.02, `cover ${pathCover(hit, sunwalk.width * 10)}`);
    // Trees, bushes and stones keep off the Sunwalk (grass grows only where its floor layer is). Planting is the same
    // code at any size: the small habitat shows it (the CI budget has no room for all four).
    if (name !== 'small') return;
    const plants = plantsOf(eco);
    for (const a of along(sunwalk, R, 37).slice(0, 3)) {
      const eye = toWorld(h.profile, { theta: a.theta, s: a.s, h: 1.7 });
      for (const sp of plants.filter((p) => p.what === 'plant' || p.what === 'debris')) {
        for (const near of cellsNear(eco, sp, 0, eye).slice(0, 6)) {
          const c = plantCell(eco, plants, near.key);
          for (const list of c.instances) for (let i = 0; i < list.length; i += PLANT_STRIDE) {
            const p = fromWorld(h.profile, c.origin[0] + list[i], c.origin[1] + list[i + 1], c.origin[2] + list[i + 2]);
            const on = net.pathAt(p.theta, p.s);
            assert.ok(!on || on.distance >= on.width / 2, `${sp.spec.name} on the ${on?.kind}`);
          }
        }
      }
    }
  });
}
