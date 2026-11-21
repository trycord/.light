// .light — gap closure: per-node tunnels, build logs, rollback, integrity.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';
async function req(route, options = {}) {
  const r = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function admin() {
  const r = await req('/api/auth/login', { method: 'POST', body: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'LightAdmin2026!' } });
  assert.equal(r.status, 200); return r.body.token;
}

test('node tunnel API reports per-node state without exposing secrets', async () => {
  const token = await admin();
  const r = await req('/api/cloudflare/tunnels', { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.tunnels));
  for (const t of r.body.tunnels) {
    assert.ok(t.nodeId);
    assert.equal(t.tunnelToken, undefined);
    assert.equal(t.token, undefined);
  }
});

test('deployment logs and rollback endpoints are contract-correct', async () => {
  const token = await admin();
  // Unknown deployment returns 404 rather than a 500.
  const logs = await req('/api/deployments/dep_missing/logs', { token });
  assert.equal(logs.status, 404);
  const rollback = await req('/api/instances/ins_missing/rollback/dep_missing', { method: 'POST', token, body: {} });
  assert.equal(rollback.status, 404);
});

test('backup records never expose host storage paths', async () => {
  const token = await admin();
  const r = await req('/api/backups', { token });
  assert.equal(r.status, 200);
  for (const b of r.body.backups || []) {
    assert.equal(b.location, undefined);
    assert.equal(b.size_bytes, undefined);
    assert.ok(b.sizeBytes !== undefined || b.status);
  }
});

test('proxy config is admin-only and never returned to customers', async () => {
  const email = `cf-${Date.now().toString(36)}@test.dev`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password: 'cf-password-123', name: 'CF' } });
  assert.equal(reg.status, 201);
  const denied = await req('/api/domains/config/proxy', { token: reg.body.token });
  assert.equal(denied.status, 403);
  const token = await admin();
  const allowed = await req('/api/domains/config/proxy', { token });
  assert.equal(allowed.status, 200);
});
