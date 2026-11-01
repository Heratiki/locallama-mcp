import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, truncate, initials } from '../build/text.js';
import { median } from '../build/numbers.js';
import { formatCents } from '../build/price.js';
import { receipt } from '../build/receipt.js';

test('basic text operations', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(truncate('hello', 5), 'hello');
  assert.equal(initials('Ada'), 'A');
});
test('singleton median', () => assert.equal(median([3]), 3));
test('whole price', () => {
  assert.equal(Number(formatCents(200)), 2);
  assert.ok(receipt('Tea', 200).startsWith('Tea: '));
});
