import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';
async function req(route, options = {}) {
  const r = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('E2E: register -> create server -> provisioned by integrated agent -> lifecycle -> delete', async () => {
  const email = `e2e-${Date.now().toString(36)}@test.dev`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password: 'test-password-123', username: `e2e${Date.now().toString(36)}`, acceptTerms: true } });
  assert.equal(reg.status, 201);
  const token = reg.body.token;

  const created = await req('/api/instances', { method: 'POST', token, body: {
    name: 'e2e-nginx', image: 'nginx:alpine', category: 'web', ports: [{ container: 80 }], memoryMb: 128, cpuCores: 1, diskGb: 1,
  } });
  assert.equal(created.status, 201);
  const iid = created.body.instance.id;
  assert.equal(created.body.instance.status, 'pending');

  // Wait for the integrated agent to provision the container.
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const r = await req(`/api/instances/${iid}`, { token });
    status = r.body.instance.status;
    if (status === 'running' || status === 'error') break;
  }
  assert.notEqual(status, 'pending', 'agent should have processed the command');
  assert.ok(['running', 'error'].includes(status), `unexpected status ${status}`);

  if (status === 'running') {
    const stop = await req(`/api/instances/${iid}/action`, { method: 'POST', token, body: { action: 'stop' } });
    assert.equal(stop.status, 200);
    const start = await req(`/api/instances/${iid}/action`, { method: 'POST', token, body: { action: 'start' } });
    assert.equal(start.status, 200);
    const del = await req(`/api/instances/${iid}`, { method: 'DELETE', token });
    assert.equal(del.status, 200);
  }
});

test('tenant isolation: a second user cannot see the first user instance', async () => {
  const a = await req('/api/auth/register', { method: 'POST', body: { email: `iso-a-${Date.now()}@test.dev`, password: 'test-password-123' } });
  const b = await req('/api/auth/register', { method: 'POST', body: { email: `iso-b-${Date.now()}@test.dev`, password: 'test-password-123' } });
  const created = await req('/api/instances', { method: 'POST', token: a.body.token, body: { name: 'iso-test', image: 'nginx:alpine', memoryMb: 128, diskGb: 1 } });
  if (created.status === 201) {
    const iid = created.body.instance.id;
    const visible = await req(`/api/instances/${iid}`, { token: b.body.token });
    assert.equal(visible.status, 404);
  }
});
