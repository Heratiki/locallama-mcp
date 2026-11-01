import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median } from './build/numbers.js';
test('acceptance', () => {
  const input = [10, 2, 8, 4];
  assert.equal(median(input), 6);
  assert.deepEqual(input, [10, 2, 8, 4]);
  assert.equal(median([9, 1, 3]), 3);
  assert.equal(median([]), 0);
});
