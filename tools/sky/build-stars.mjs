// Builds public/sky/stars.bin from d3-celestial's stars.8.json (Hipparcos stars to magnitude 8, ESA 1997; the
// d3-celestial package is BSD-3-Clause): node tools/sky/build-stars.mjs <path to stars.8.json>
// Output: little-endian float32 records [right ascension (rad), declination (rad), V magnitude, B−V], J2000 equatorial.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/sky/build-stars.mjs <stars.8.json>'); process.exit(1); }
const features = JSON.parse(readFileSync(src, 'utf8')).features;
const out = new Float32Array(features.length * 4);
const D = Math.PI / 180;
features.forEach((f, i) => {
  const [ra, dec] = f.geometry.coordinates;
  const bv = Number.parseFloat(f.properties.bv);
  out.set([((ra + 360) % 360) * D, dec * D, f.properties.mag, Number.isFinite(bv) ? bv : 0.6], i * 4);
});
writeFileSync(new URL('../../public/sky/stars.bin', import.meta.url), Buffer.from(out.buffer));
console.log(`${features.length} stars`);
