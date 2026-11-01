import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials } from './build/text.js';
test('acceptance', () => {
  assert.equal(initials('  ada   lovelace byron '), 'AL');
  assert.equal(initials('grace'), 'G');
  assert.equal(initials('  '), '');
});
