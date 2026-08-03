import assert from 'node:assert/strict';
import test from 'node:test';
import { add, greet } from '../src/index.js';

test('add adds two numbers', () => {
  assert.equal(add(1, 2), 3);
});

test('add handles negatives', () => {
  assert.equal(add(-1, 1), 0);
});

test('greet greets', () => {
  assert.equal(greet('umbra'), 'hello, umbra');
});
