import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './build/text.js';
test('acceptance', () => {
  assert.equal(slugify('  Hello, WORLD!! '), 'hello-world');
  assert.equal(slugify('a___b  c'), 'a-b-c');
  assert.equal(slugify('!!!'), '');
});
