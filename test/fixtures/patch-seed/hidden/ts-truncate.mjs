import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncate } from './build/text.js';
test('acceptance', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 1), '…');
  assert.equal(truncate('abc', 0), '');
  assert.equal(truncate('abc', -2), '');
  assert.equal(truncate('abc', 3), 'abc');
});
