import { derive, REFERENCE } from '../src/blueprint';
import { droneDesigns, designBytes } from '../src/gen/drone';
import { ROLES } from '../src/sim';
const h = derive(REFERENCE);
const t0 = performance.now();
const ds = droneDesigns(h, ROLES);
console.log('built', ds.length, 'in', (performance.now() - t0).toFixed(0), 'ms');
let bytes = 0;
for (const d of ds) {
  bytes += designBytes(d);
  const spins = new Set<number>(), strobes = new Set<number>();
  for (let i = 3; i < d.body.spin.length; i += 4) { const w = d.body.spin[i]; if (w > 0 || w < 0 && w > -10) spins.add(Math.round(w)); else if (w < -10) strobes.add(w); }
  console.log(d.name.padEnd(40), 'tris', d.body.index.length / 3, d.veil.index.length / 3, 'coarse', d.coarse.body.index.length / 3, d.coarse.veil.index.length / 3, 'size', d.min.map((v, k) => (d.max[k] - v).toFixed(2)).join('x'), 'hover', d.hover.toFixed(2), d.landed.toFixed(2), 'bob', d.bob.map((v) => v.toFixed(3)).join('/'), 'albedo', d.albedo.map((v) => v.toFixed(2)).join(','), 'spins', [...spins].join(' '), 'strobes', [...strobes].map((v) => v.toFixed(2)).join(' '));
}
console.log('MB', (bytes / 2 ** 20).toFixed(1));
