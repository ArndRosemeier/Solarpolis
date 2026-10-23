/** The port face's windows (src/gen/portFace.ts): rings of storeys in their bands, lit by the hour, over the matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { MATRIX } from '../src/blueprint';
import { makeSkin } from '../src/gen/skin';
import { WINDOW_CLOCK_WRAP, bandMean, litShare, portFaceOf, windowAt, windowHours, windowLit, windowsRound } from '../src/gen/portFace';
import { habitatOf } from './worlds';

for (const { name } of MATRIX) {
  const h = habitatOf(name), f = portFaceOf(h, makeSkin(h)), x = h.exterior;

  test(`port face (${name}): the bands lie on the face in order, clear of the bearing ring, each a few storeys deep`, () => {
    assert.equal(f.z, x.portFace);
    assert.deepEqual(f.bands.map((b) => b.kind), ['docks', 'town', 'galleries']);
    assert.ok(f.bearingR0 >= x.spindle.radius && f.bearingR1 > f.bearingR0);
    let edge = f.bearingR1;
    for (const b of f.bands) {
      assert.ok(b.r0 >= edge && b.r1 > b.r0 && b.r1 <= x.radius, `${b.kind} within the face, after the band before`);
      assert.ok((b.r1 - b.r0) / b.storey >= 2, `${b.kind} holds two storeys`);
      assert.ok(b.sill < b.head && b.mullion < 1 && b.glow > 0);
      edge = b.r1;
    }
  });

  test(`port face (${name}): the windows' light averages to the band's mean, and the town lights up at night`, () => {
    const rng = new Rng(7);
    for (const [i, b] of f.bands.entries()) {
      for (const night of [0, 1]) {
        let sum = 0;
        const n = 3000, share = litShare(b, night);
        for (let k = 0; k < n; k++) {
          const w = windowAt(f, rng.range(b.r0, b.r1), rng.range(0, 2 * Math.PI));
          if (w && windowLit(f, w, rng.range(0, 48), share)) sum += w.shade * b.glow;
          if (w) assert.equal(w.band, i);
        }
        // Only over enough blocks: a small habitat's dock halls are a handful of blocks, each built or not.
        const mean = bandMean(b, night), blocks = ((b.r1 - b.r0) / b.storey / b.blockStoreys) * (windowsRound(b, b.r0) / b.blockWindows);
        assert.ok(sum > 0, `${b.kind} shows some light`);
        if (blocks >= 40) assert.ok(Math.abs(sum / n - mean) < 0.25 * mean, `${b.kind} at night ${night}: ${sum / n} vs ${mean}`);
      }
    }
    const town = f.bands.find((b) => b.kind === 'town')!;
    assert.ok(litShare(town, 1) > 2 * litShare(town, 0));
    // Nothing lit between the bands or past the rim.
    assert.equal(windowAt(f, (f.bands[0].r1 + f.bands[1].r0) / 2, 1), null);
    assert.equal(windowAt(f, x.radius * 0.99, 1), null);
  });

  test(`port face (${name}): a block's windows stack storey over storey, and each window keeps its light a while`, () => {
    const town = f.bands.find((b) => b.kind === 'town')!, i = f.bands.indexOf(town);
    // The storeys of the first block row share one count round, so the same angle finds the same window.
    const n = windowsRound(town, town.r0), theta = ((Math.floor(n / 3) + 0.5) / n) * 2 * Math.PI;
    const at = (k: number) => windowAt(f, town.r0 + (k + (town.sill + town.head) / 2) * town.storey, theta);
    const rows = [0, 1, 2].map(at);
    for (const w of rows) if (w) assert.equal(w.index, rows.find((x) => x)!.index);
    assert.ok(rows.every((w) => w === null) || rows.every((w) => w !== null), 'a block is built or left out whole');
    // Over a day, a window goes on and off a few times, never flickering frame to frame.
    const w = { band: i, storey: 3, index: 11, shade: 1 };
    let changes = 0, last = windowLit(f, w, 0, 0.5);
    for (let m = 1; m <= 24 * 60; m++) {
      const lit = windowLit(f, w, m / 60, 0.5);
      if (lit !== last) changes++;
      last = lit;
    }
    assert.ok(changes > 2 && changes < 60, `${changes} changes in a day`);
    assert.ok(windowHours(3600 * (WINDOW_CLOCK_WRAP + 5)) - 5 < 1e-9);
  });
}
