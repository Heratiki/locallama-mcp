import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCents } from './build/price.js';
import { receipt } from './build/receipt.js';
test('acceptance', () => {
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatCents(-105), '-1.05');
  assert.equal(formatCents(200), '2.00');
  assert.equal(receipt(' Tea ', -125), 'Tea: $-1.25');
});
