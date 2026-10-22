import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Human, sanitizeRace } from '@actors/human';
import { buildCatalog, defaultConfig } from '@actors/generator';
import { IRIS_PRESETS } from '@actors/three';
import { Residents } from '../../src/render/actors/residents';
import { REFERENCE, derive } from '../../src/blueprint';
import { residentOf } from '../../src/sim';

// Slow (builds 40 whole Actors bodies): run with `npm run test:slow`. Needs the Actors pack (`npm run actors:pack`).
const version = JSON.parse(readFileSync('node_modules/@actors/generator/package.json', 'utf8')).version as string;
const pack = join('.actors-pack', version, 'human');

test('residents: a stand-in is exactly as tall as the figure Actors builds from the same look', { skip: !existsSync(join(pack, 'manifest.json')) && 'no Actors pack' }, async () => {
  const fetcher = async (url: string): Promise<ArrayBuffer> => { const b = await readFile(join(pack, url.replace(/^.*human\//, ''))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const human = await Human.load(join(pack, 'manifest.json'), fetcher);
  const all = buildCatalog(human, Object.keys(IRIS_PRESETS));
  const catalog = { ...all, garments: all.garments.filter((g) => !g.credit), hair: all.hair.filter((x) => !x.credit) };
  const residents = new Residents(catalog, defaultConfig(catalog), human), h = derive(REFERENCE);
  const body = human.runtime.meshes.find((m) => m.def.role === 'body' && !(m as { stencil?: unknown }).stencil) as unknown as { map: ArrayLike<number> };
  let shells = 0;
  for (let i = 0; i < 40; i++) {
    const r = residentOf(h, i * 997 + 3);
    let dress = residents.dressOf(r);
    for (let k = 0; !dress && k < 500; k++) { await new Promise((ok) => setTimeout(ok, 20)); dress = residents.dressOf(r); }
    assert.ok(dress, "the targets never loaded");
    const look = residents.figureLook(r);
    human.params = { ...look.body };
    human.race = sanitizeRace({ race: look.race, race2: look.race2, mix: look.raceMix, size: look.raceSize });
    human.modifierValues = { ...look.details };
    const shape = await human.evaluate();
    let lo = Infinity, hi = -Infinity;
    for (const v of Array.from(body.map)) { lo = Math.min(lo, shape.positions[v * 3 + 1]); hi = Math.max(hi, shape.positions[v * 3 + 1]); }
    if (look.robot) shells++;
    const exact = hi - lo + (look.robot ? 0.03 : 0);
    assert.ok(Math.abs(dress.height - exact) < 1e-4, `resident ${r.id}: stand-in ${dress.height.toFixed(4)} m, figure ${exact.toFixed(4)} m`);
    assert.equal(dress.colors.length, 7);
  }
  assert.ok(shells > 0, 'no shells among 40 residents');
});
