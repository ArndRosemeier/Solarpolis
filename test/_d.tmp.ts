import { toWorld } from '../src/blueprint';
import { ecologyOf } from './worlds';
import { cellsNear, plantCell, plantsOf } from '../src/gen/scatter';
const eco = ecologyOf('reference'), t = eco.terrain, P = t.habitat.profile, plants = plantsOf(eco);
const th = 38.4 * Math.PI / 180, s = 13810, eye = toWorld(P, { theta: th, s, h: t.heightAt(th, s) + 1.7 });
for (const sp of plants) for (const lvl of [0, 1] as const) {
  const cs = cellsNear(eco, sp, lvl, eye, lvl ? 0 : undefined).slice(0, 6);
  let n = 0, ms = 0, err = '';
  for (const c of cs) { const t0 = performance.now(); try { n += plantCell(eco, plants, c.key).count; } catch (e) { err = String(e); } ms += performance.now() - t0; }
  console.log(sp.spec.name, lvl, cs.length, n, ms.toFixed(0) + 'ms', err);
}
