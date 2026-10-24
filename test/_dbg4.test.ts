import { test } from 'node:test';
import { ecologyOf, terrainOf } from './worlds';
import { plantsOf, cellsNear, plantCell } from '../src/gen/scatter';
import { plantingsOf } from '../src/gen/planted';
import { liftStairOf, rampOf } from '../src/gen/liftStair';
test('dbg4', () => {
  const t = terrainOf('reference'), h = t.habitat, st = liftStairOf(h)!, ramp = rampOf(h);
  const g = st.threshold!.galleries[0];
  const eye = ramp.world((g.z0 + g.z1) / 2, (g.w0 + g.w1) / 2, g.e + 1.7);
  const eco = ecologyOf('reference'), species = plantsOf(eco);
  const bed = plantingsOf(t).garden[0];
  const sp = species.find((s) => s.spec.name === bed.spec.name)!;
  console.log('band0', JSON.stringify(sp.band[0]), 'cell', sp.cell[0]);
  const cells = cellsNear(eco, sp, 0, eye);
  for (const c of cells.slice(0, 3)) {
    const cell = plantCell(eco, species, c.key);
    const o = cell.origin as number[];
    const d = (cell as any).lists ?? (cell as any).shapes;
    console.log('cell near', c.near.toFixed(1), 'far', c.far.toFixed(1), 'count', (cell as any).count, 'origin d from eye', Math.hypot(o[0]-eye[0],o[1]-eye[1],o[2]-eye[2]).toFixed(1), Object.keys(cell));
  }
});
