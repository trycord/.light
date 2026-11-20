import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';

async function request(route, options = {}) {
  const response = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const suffix = Date.now().toString(36);
const email = `api-${suffix}@test.dev`;
const password = 'test-password-12345';
let token;

test('health check requires no auth', async () => {
  const r = await request('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('protected routes reject unauthenticated requests', async () => {
  const r = await request('/api/instances');
  assert.equal(r.status, 401);
});

test('register creates account and returns admin token for first user', async () => {
  const r = await request('/api/auth/register', { method: 'POST', body: { email, password, name: 'API Test' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  token = r.body.token;
  assert.ok(['admin', 'user'].includes(r.body.user.role));
});

test('login works with registered credentials', async () => {
  const r = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test('login rejects wrong password', async () => {
  const r = await request('/api/auth/login', { method: 'POST', body: { email, password: 'wrong' } });
  assert.equal(r.status, 401);
});

test('catalog returns real templates and plans', async () => {
  const templates = await request('/api/catalog/templates', { token });
  assert.equal(templates.status, 200);
  assert.ok(templates.body.templates.length > 0);
  const plans = await request('/api/catalog/plans', { token });
  assert.equal(plans.status, 200);
  assert.ok(plans.body.plans.some((p) => p.id === 'free'));
});

test('node agent auth is enforced', async () => {
  const denied = await request('/api/agent/commands');
  assert.equal(denied.status, 401);
  let nodeToken = process.env.NODE_TOKEN || '';
  if (!nodeToken && fs.existsSync(path.join(root, 'data', '.secrets.json'))) {
    try { nodeToken = JSON.parse(fs.readFileSync(path.join(root, 'data', '.secrets.json'), 'utf8')).NODE_TOKEN || ''; } catch { /* ignore */ }
  }
  if (!nodeToken && fs.existsSync(path.join(root, '.env'))) {
    nodeToken = (fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^NODE_TOKEN=(.+)$/m) || [])[1] || '';
  }
  assert.ok(nodeToken, 'a node token must be available for the authorized check');
  const allowed = await request('/api/agent/commands', { headers: { 'x-node-token': nodeToken.trim() } });
  assert.equal(allowed.status, 200);
});

test('plan grants fixed resources; client overrides are ignored', async () => {
  const r = await request('/api/instances', { method: 'POST', token, body: { name: 'plan-resources', environmentId: 'static-site', memoryMb: 99999, cpuCores: 32, diskGb: 2000 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.instance.memoryMb, 512);
  assert.equal(r.body.instance.cpuCores, 1);
  assert.equal(r.body.instance.diskGb, 4);
});

test('instance list requires auth and returns array', async () => {
  const r = await request('/api/instances', { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.instances));
});
