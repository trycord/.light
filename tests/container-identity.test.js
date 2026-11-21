// Regression tests: container_not_found root cause + multi-node scheduling.
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

test('structured error: missing service is not confused with missing container', async () => {
  const token = await admin();
  const r = await req('/api/instances/ins_nonexistent/action', { method: 'POST', token, body: { action: 'start' } });
  assert.equal(r.status, 404);
  assert.ok(['not_found', 'instance_not_found', 'error'].includes(r.body.error), JSON.stringify(r.body));
});

test('admin can register and list multiple nodes', async () => {
  const token = await admin();
  const name = `node-test-${Date.now().toString(36)}`;
  const created = await req('/api/nodes', { method: 'POST', token, body: { name, host: '10.0.0.99', region: 'test' } });
  assert.equal(created.status, 201);
  assert.ok(created.body.token, 'registration returns a node token');
  const nodes = await req('/api/nodes', { token });
  assert.equal(nodes.status, 200);
  assert.ok(nodes.body.nodes.some(n => n.id === created.body.node.id));
  // Non-admin users must never see node tokens.
  const email = `nodeview-${Date.now().toString(36)}@test.dev`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password: 'nodeview-password', name: 'NV' } });
  const customerNodes = await req('/api/nodes', { token: reg.body.token });
  assert.equal(customerNodes.status, 200);
  assert.ok(customerNodes.body.nodes.every(n => n.token === undefined));
});
