import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaches } from './budget-reporter.mjs';

const B = { perTestMs: 1000, perFileMs: 3000, totalMs: 60000 }; // fixed numbers for the test, not the real budget

test('budget: within limits is green', () => {
  assert.deepEqual(breaches([{ name: 'a', file: 'f', ms: 900 }], new Map([['f', 2900]]), 30000, B, 1), { warn: [], fail: [] });
});

test('budget: a slow test and a slow file only warn, a slow suite fails, each named', () => {
  const { warn, fail } = breaches([{ name: 'a', file: 'f', ms: 1500 }], new Map([['f', 3500]]), 61000, B, 1);
  assert.equal(warn.length, 2);
  assert.match(warn[0], /test over 1000 ms: 1500 ms {2}a/);
  assert.match(warn[1], /file over 3000 ms/);
  assert.deepEqual(fail, ['suite over 60000 ms: 61000 ms']);
  assert.deepEqual(breaches([{ name: 'a', file: 'f', ms: 1500 }], new Map([['f', 3500]]), 30000, B, 1).fail, [], 'slow parts alone never fail');
});

test('budget: the scale factor loosens every limit', () => {
  assert.deepEqual(breaches([{ name: 'a', file: 'f', ms: 1500 }], new Map([['f', 3500]]), 61000, B, 2), { warn: [], fail: [] });
});
