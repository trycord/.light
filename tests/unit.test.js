import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, safeEqual } from '../server/security.js';
import { cronMatches, id, validateEmail, validatePassword } from '../server/util.js';

test('password hashing and verification', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
  assert.notEqual(hashPassword('same password'), hashPassword('same password'));
});

test('safe equal', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('validation', () => {
  assert.equal(validateEmail('user@example.com'), true);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('long-enough-password'), true);
});

test('cron matching', () => {
  const at = (hour, minute) => { const d = new Date(); d.setHours(hour, minute, 0, 0); return d; };
  assert.equal(cronMatches('* * * * *', at(10, 30)), true);
  assert.equal(cronMatches('0 3 * * *', at(3, 0)), true);
  assert.equal(cronMatches('0 3 * * *', at(4, 0)), false);
  assert.equal(cronMatches('*/5 * * * *', at(10, 15)), true);
  assert.equal(cronMatches('*/5 * * * *', at(10, 17)), false);
  assert.equal(cronMatches('not a cron', new Date()), false);
});

test('ids are prefixed and unique', () => {
  const a = id('ins'); const b = id('ins');
  assert.ok(a.startsWith('ins_'));
  assert.notEqual(a, b);
});
