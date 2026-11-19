// .light — guided setup helper tests (pure, no server or Docker needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnv, updateEnvText, buildDefaults, parseArgs,
  randomHex, randomNodeToken, isValidEmail, isValidPassword,
  isValidPort, isValidDomain, mask,
} from '../setup.js';

test('parseEnv handles comments, quotes and export prefixes', () => {
  const env = parseEnv('# comment\nPORT=6000\nexport NAME="hello world"\nFLAG=\'yes\'\n\nBAD LINE');
  assert.equal(env.PORT, '6000');
  assert.equal(env.NAME, 'hello world');
  assert.equal(env.FLAG, 'yes');
  assert.equal(env['BAD LINE'], undefined);
});

test('updateEnvText updates in place and preserves comments', () => {
  const before = '# header\nPORT=5858\n# keep me\nALLOW_SIGNUP=true\n';
  const after = updateEnvText(before, { PORT: '6000', NEW_KEY: 'value' });
  assert.ok(after.includes('# header'));
  assert.ok(after.includes('# keep me'));
  assert.match(after, /^PORT=6000$/m);
  assert.match(after, /^ALLOW_SIGNUP=true$/m);
  assert.match(after, /^NEW_KEY=value$/m);
  assert.equal(parseEnv(after).PORT, '6000');
});

test('buildDefaults generates secrets and derives URLs from the port', () => {
  const cfg = buildDefaults({}, {});
  assert.equal(cfg.PORT, '5858');
  assert.equal(cfg.CONTROL_URL, 'http://127.0.0.1:5858');
  assert.equal(cfg.CONTROL_BASE_URL, 'http://localhost:5858');
  assert.match(cfg.JWT_SECRET, /^[0-9a-f]{96}$/);
  assert.match(cfg.NODE_TOKEN, /^n_[0-9a-f]{64}$/);
  assert.ok(isValidPassword(cfg.BOOTSTRAP_ADMIN_PASSWORD));
});

test('buildDefaults respects explicit overrides and existing values', () => {
  const cfg = buildDefaults({ PORT: '7000', PLATFORM_DOMAIN: 'example.com' }, { PORT: '7100' });
  assert.equal(cfg.PORT, '7100');
  assert.equal(cfg.PLATFORM_DOMAIN, 'example.com');
  assert.equal(cfg.CONTROL_URL, 'http://127.0.0.1:7100');
});

test('parseArgs supports all CLI options and repeated --set', () => {
  const o = parseArgs(['--check', '--yes', '--local', '--no-start', '--force', '--set', 'PORT=6000', '--set=NAME=x', '-h']);
  assert.equal(o.check, true);
  assert.equal(o.yes, true);
  assert.equal(o.docker, false);
  assert.equal(o.start, false);
  assert.equal(o.force, true);
  assert.equal(o.help, true);
  assert.equal(o.set.PORT, '6000');
  assert.equal(o.set.NAME, 'x');
});

test('validation and masking helpers', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('nope'), false);
  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword('longenough123'), true);
  assert.equal(isValidPort('65536'), false);
  assert.equal(isValidPort('5858'), true);
  assert.equal(isValidDomain('trycord.dev'), true);
  assert.equal(isValidDomain('not a domain'), false);
  assert.ok(mask('supersecret').includes('•'));
  assert.equal(mask(''), '(not set)');
  assert.equal(randomHex(4).length, 8);
  assert.ok(randomNodeToken().startsWith('n_'));
});
