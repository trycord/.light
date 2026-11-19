import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';
const suffix = Date.now().toString(36);
const email = `auth-${suffix}@test.dev`;
const password = 'test-password-12345';

async function req(route, options = {}) {
  const r = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('public website and branding are accessible without auth', async () => {
  const site = await fetch(base + '/');
  assert.equal(site.status, 200);
  const branding = await req('/api/branding');
  assert.equal(branding.status, 200);
  assert.ok(branding.body.product);
  assert.ok(branding.body.watermark?.text?.toUpperCase().includes('TRYCORD'));
  assert.ok(branding.body.identity?.identifier === 'trycord-light');
});

test('software identification is exposed', async () => {
  const r = await req('/api/identify');
  assert.equal(r.body.owner, 'Trycord');
  assert.equal(r.body.software, '.light');
});

test('registration with username and terms works when email disabled', async () => {
  const r = await req('/api/auth/register', { method: 'POST', body: { email, password, username: `user${suffix}`, name: 'Auth Test', acceptTerms: true } });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.emailVerified, true);
  assert.equal(r.body.verifyRequired, false);
});

test('duplicate registration is rejected', async () => {
  const r = await req('/api/auth/register', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 409);
});

test('login works and wrong password is rejected', async () => {
  const ok = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(ok.status, 200);
  const bad = await req('/api/auth/login', { method: 'POST', body: { email, password: 'wrong' } });
  assert.equal(bad.status, 401);
});

test('forgot password reports email-disabled alternative', async () => {
  const r = await req('/api/auth/forgot-password', { method: 'POST', body: { email } });
  assert.equal(r.status, 200);
  assert.equal(r.body.reason, 'email_disabled');
});

test('profile update and sessions work', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  const token = login.body.token;
  const update = await req('/api/auth/profile', { method: 'PATCH', token, body: { name: 'Renamed', theme: 'light' } });
  assert.equal(update.status, 200);
  assert.equal(update.body.user.name, 'Renamed');
  const sessions = await req('/api/auth/sessions', { token });
  assert.ok(Array.isArray(sessions.body.sessions));
});

test('logout invalidates the token', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  const token = login.body.token;
  const out = await req('/api/auth/logout', { method: 'POST', token, body: {} });
  assert.equal(out.status, 200);
  const me = await req('/api/auth/me', { token });
  assert.equal(me.status, 401);
});

test('nodes are readable by any user but tokens are hidden', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  const nodes = await req('/api/nodes', { token: login.body.token });
  assert.equal(nodes.status, 200);
  for (const n of nodes.body.nodes) assert.equal(n.token, undefined);
});
