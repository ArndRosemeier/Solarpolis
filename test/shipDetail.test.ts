/** Ships fitted out (space/shipDetail.ts) and drawn (render/ship.ts): plating, decks of windows, the collar, the dish. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3cross, v3dot, v3sub, type Vec3 } from '@futuremagic/core';
import { deriveShip, partSpan, sailShip, shipShape, torchShip, type ShipParams } from '../src/space';
import { DECK, WINDOW_GLOW } from '../src/space/shipDetail';
import { shipGeometry } from '../src/render/ship';

const ships = (berths: readonly number[], seeds = 6): ShipParams[] =>
  berths.flatMap((berth) => Array.from({ length: seeds }, (_, k) => k).flatMap((k) => [deriveShip(k, berth, 'torch'), deriveShip(k, berth, 'sail')]));

test('ship fittings: the same from the seed, decks of windows on the crew section, most of them lit', () => {
  for (const p of ships([120, 300])) {
    const s = shipShape(p);
    assert.deepEqual(shipShape(p), s, 'from the seed alone');
    const crew = (p.drive === 'sail' ? sailShip(p) : torchShip(p)).parts.find((q) => q.role === 'crew' && q.shape === 'cylinder');
    assert.ok(crew && crew.shape === 'cylinder');
    // Every shell faces out from the axis or along it, never in (but the dish's bowl, facing ahead into itself).
    for (const q of s.parts) if (q.shape === 'shell' && !(q.offset && q.r0 > q.r1)) assert.ok(q.to - q.from >= -1e-12 || q.r1 >= q.r0, `${q.role} shell faces the axis`);
    const lit = s.parts.filter((q) => q.role === 'window'), dark = s.parts.filter((q) => q.shape === 'shell' && q.role === 'fitting' && q.colour?.[0] === 0.02);
    const decks = Math.floor((crew.to - crew.from - DECK * 1.1) / DECK);
    if (decks > 0) assert.ok(lit.length > (lit.length + dark.length) * 0.5, `${p.drive} ${p.length.toFixed(0)} m: ${lit.length} of ${lit.length + dark.length} windows lit`);
    for (const w of lit) {
      assert.equal(w.shape, 'shell');
      if (w.shape !== 'shell') continue;
      const onCrew = w.from >= crew.from && w.to <= crew.to && w.r0 > crew.radius;
      const onCollar = w.from === p.length && w.to === p.length;
      assert.ok(onCrew || onCollar, `a light at ${w.from.toFixed(1)} m`);
      if (onCrew) assert.ok(Math.max(...w.colour!) <= WINDOW_GLOW * 1.3 + 1e-12 && Math.max(...w.colour!) > 0, 'a lived-in room, not a lamp');
    }
  }
});

test('ship fittings: the comms dish stands clear of every part beside it', () => {
  for (const p of ships([20, 120, 300], 3)) {
    const s = shipShape(p), base = (p.drive === 'sail' ? sailShip(p) : torchShip(p)).parts;
    const bowl = s.parts.find((q) => q.shape === 'shell' && q.role === 'hull' && (q.offset?.[0] ?? 0) < 0 && q.r1 > q.r0);
    assert.ok(bowl && bowl.shape === 'shell' && bowl.offset);
    const R = bowl.r1, out = -bowl.offset[0] - R;
    for (const q of base) {
      const span = partSpan(q);
      if (span.x1 < bowl.from || span.x0 > bowl.to) continue;
      assert.ok(span.radius < out, `${p.drive}: its rim ${out.toFixed(2)} m out, ${q.role} reaches ${span.radius.toFixed(2)} m`);
    }
  }
});

test('ship geometry: every face turned the way its normal says, its windows apart, within a budget', () => {
  for (const p of ships([20, 120, 300], 1)) {
    const g = shipGeometry(shipShape(p));
    for (const geometry of [g.body, g.lamps!]) {
      assert.ok(geometry, `${p.drive} ${p.length.toFixed(0)} m has lit windows or collar lights`);
      const pos = geometry.attributes.position.array, nrm = geometry.attributes.normal.array, idx = geometry.index!.array;
      const at = (i: number): Vec3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      let wrong = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], f = v3cross(v3sub(at(b), at(a)), v3sub(at(c), at(a)));
        if (Math.hypot(...f) < 1e-12) continue;
        if (v3dot(f, [nrm[a * 3], nrm[a * 3 + 1], nrm[a * 3 + 2]]) <= 0) wrong++;
      }
      assert.equal(wrong, 0, `${p.drive} ${p.length.toFixed(0)} m: ${wrong} faces turned against their normals`);
    }
    // Budget: the arrays a ship's meshes hold (positions, normals, colours, index).
    const bytes = [g.body, g.lamps!].reduce((n, x) => n + Object.values(x.attributes).reduce((k, a) => k + a.array.byteLength, 0) + x.index!.array.byteLength, 0);
    assert.ok(bytes < 1.6 * 1024 * 1024, `${p.drive} ${p.length.toFixed(0)} m: ${(bytes / 1024).toFixed(0)} KB`);
  }
});
