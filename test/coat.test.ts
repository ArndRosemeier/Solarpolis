import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breedParams } from '@actors/animal';
import { bakeCoat, coatBands, irisOf, paramsOf, type CoatSource } from '../src/gen/coat';
import { unpackColor } from '../src/gen/standIn';

/**
 * Three regions of a made-up body, as Actors' importer writes them per vertex: the back (vertex 0), the belly (1) and
 * the nose leather (2), stacked in height belly, nose, back.
 */
function body(): CoatSource {
  const four = (rows: number[][]) => Float32Array.from(rows.flat());
  return {
    // legs (1: none), head, muzzle, tail
    coatA: four([[1, 0, 0, 0], [1, 0, 0, 0], [1, 1, 1, 0]]),
    coatB: four([[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]]),
    // bare skin: the nose
    coatC: four([[0, 0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0]]),
    // back, underside, mask, blaze
    coatD: four([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]]),
    coatE: four([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    coatPos: Float32Array.from([0, 0.25, 0, 0, 0.05, 0, 0, 0.15, 0.1]),
    furFlow: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, 1]),
  };
}

const lum = (c: ArrayLike<number>, i: number): number => 0.2126 * c[i * 4] + 0.7152 * c[i * 4 + 1] + 0.0722 * c[i * 4 + 2];

test('coat: a grey squirrel has a grey back, a white belly and a dark nose, and its hair grain', () => {
  const coat = breedParams('grey', 'squirrel').coat, c = bakeCoat(body(), coat).coat;
  assert.equal(c.length, 12);
  assert.ok(lum(c, 1) > 2 * lum(c, 0), `belly ${lum(c, 1).toFixed(3)} lighter than the back ${lum(c, 0).toFixed(3)}`);
  assert.ok(lum(c, 2) < 0.6 * lum(c, 0), 'the nose leather darker than the fur');
  assert.equal(c[3], Math.fround(coat.grain ?? 1));
  for (const v of c) assert.ok(v >= 0 && v <= 1.0001);
});

test('coat: a red squirrel is redder than a grey one; a black one darker; the bands run back, middle, belly', () => {
  const grey = bakeCoat(body(), breedParams('grey', 'squirrel').coat).coat, red = bakeCoat(body(), breedParams('red', 'squirrel').coat).coat;
  const black = bakeCoat(body(), breedParams('black', 'squirrel').coat).coat;
  assert.ok(red[0] / red[2] > 1.5 * (grey[0] / grey[2]), 'red back');
  assert.ok(lum(black, 0) < 0.5 * lum(grey, 0), 'black back');
  const src = body(), bands = coatBands(src.coatPos, grey).map(unpackColor);
  const l = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(l(bands[2]) > l(bands[0]), 'the bottom band (belly) lighter than the top (back)');
  assert.ok(irisOf(breedParams('grey', 'squirrel').coat).every((v) => v >= 0 && v < 0.1), 'dark eyes');
});

/**
 * A made-up deer: its flank (vertex 0, well below the spine, where spots show), its belly (1), its rump patch (2), as
 * Actors' deer importer writes coatF (rump, along the body, from the spine, spotty).
 */
function deer(): CoatSource {
  const four = (rows: number[][]) => Float32Array.from(rows.flat());
  const none = four([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  return {
    coatA: none, coatB: none, coatC: none,
    coatD: four([[1, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 0]]),
    coatE: none,
    coatF: four([[0, 0.6, 0.1, 1], [0, 0.6, 0.3, 0], [1, 0.95, 0.02, 0]]),
    coatPos: Float32Array.from([0.2, 0.9, 0, 0.1, 0.6, 0, 0, 0.95, -0.5]),
    furFlow: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
  };
}

test('coat: a fallow deer has spots on its flanks and a pale rump; a red deer has no spots', () => {
  const fallow = bakeCoat(deer(), paramsOf('deer', 'fallow').coat), red = bakeCoat(deer(), paramsOf('deer', 'red').coat);
  assert.ok(fallow.dapple, 'spots for the fur material');
  assert.ok(fallow.dapple[2] > 0.3, `spots on the flank (${fallow.dapple[2].toFixed(2)})`);
  assert.equal(fallow.dapple[6], 0, 'none on the belly');
  assert.ok(lum(fallow.coat, 2) > 1.5 * lum(fallow.coat, 0), 'a pale rump');
  assert.equal(red.dapple, null, 'no spots');
  for (const v of [...fallow.coat, ...red.coat]) assert.ok(v >= 0 && v <= 1.0001);
});
