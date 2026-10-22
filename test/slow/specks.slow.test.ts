import { test } from 'node:test';
import { MATRIX } from '../../src/blueprint';
import { checkSpecks } from '../specksCheck';

// Slow (the whole population of the big habitats, twice): run with `npm run test:slow`.
for (const { name, params } of MATRIX) {
  test(`specks (${name}): everyone up on the land, each once, where the near levels stand them, also from the kept list`, () => {
    checkSpecks(name, params.day.length, 2000);
  });
}
