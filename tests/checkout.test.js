// .light — product checkout → verified payment → automatic provisioning.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
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
async function customer() {
  const email = `buy-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}@test.dev`;
  const r = await req('/api/auth/register', { method: 'POST', body: { email, password: 'buyer-password-123', name: 'Buyer' } });
  assert.equal(r.status, 201);
  return r.body.token;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('checkout creates a real order with server-resolved pricing and idempotency', async () => {
  const token = await customer();
  const key = `order-${crypto.randomUUID()}`;
  const body = { planId: 'free', environmentId: 'node', serviceName: 'purchased-service', idempotencyKey: key };
  const first = await req('/api/checkout', { method: 'POST', token, body });
  assert.equal(first.status, 201);
  assert.equal(first.body.order.status, 'awaiting_payment');
  assert.equal(first.body.order.serviceName, 'purchased-service');
  assert.equal(first.body.order.planSnapshot.name, 'Free');
  assert.equal(first.body.order.total, 0);
  assert.ok(first.body.order.events.some((e) => e.status === 'awaiting_payment'));

  const second = await req('/api/checkout', { method: 'POST', token, body });
  assert.equal(second.status, 200);
  assert.equal(second.body.order.id, first.body.order.id, 'idempotency key must not create a second order');
});

test('free order confirmation provisions a real service automatically', async () => {
  const token = await customer();
  const created = await req('/api/checkout', { method: 'POST', token, body: {
    planId: 'free', environmentId: 'node', serviceName: 'auto-service', idempotencyKey: crypto.randomUUID(),
  } });
  assert.equal(created.status, 201);
  const oid = created.body.order.id;

  const paid = await req(`/api/checkout/${oid}/confirm-manual`, { method: 'POST', token, body: { confirm: 'CONFIRM_MANUAL' } });
  assert.equal(paid.status, 200);
  assert.ok(paid.body.instanceId, 'must create a workload from the order');

  // Idempotent replay must not duplicate the service.
  const replay = await req(`/api/checkout/${oid}/confirm-manual`, { method: 'POST', token, body: { confirm: 'CONFIRM_MANUAL' } });
  assert.equal(replay.body.instanceId, paid.body.instanceId);

  let status = 'paid';
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const r = await req(`/api/checkout/${oid}`, { token });
    status = r.body.order.status;
    if (['active', 'failed'].includes(status)) break;
  }
  assert.equal(status, 'active', 'order must become active only after the workload reports success');

  const order = (await req(`/api/checkout/${oid}`, { token })).body.order;
  assert.ok(order.instanceId);
  assert.ok(order.events.some((e) => e.status === 'paid'));
  assert.ok(order.events.some((e) => e.status === 'active'));

  const service = await req(`/api/instances/${order.instanceId}`, { token });
  assert.equal(service.status, 200);
  assert.equal(service.body.instance.environmentId, 'node');
  assert.equal(service.body.instance.memoryMb, 512, 'resources come from the purchased plan snapshot');
  assert.equal(service.body.instance.name, 'auto-service');
  const list = await req('/api/instances', { token });
  assert.equal(list.body.instances.filter((i) => i.id === order.instanceId).length, 1, 'no duplicate services');
});

test('admin can inspect orders and read masked settings including Cloudflare and mail', async () => {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'LightAdmin2026!';
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  const token = login.body.token;

  const orders = await req('/api/admin/orders', { token });
  assert.equal(orders.status, 200);
  assert.ok(Array.isArray(orders.body.orders));

  const settings = await req('/api/admin/settings', { token });
  assert.equal(settings.status, 200);
  const s = settings.body.settings;
  for (const key of ['CLOUDFLARE_API_TOKEN', 'STRIPE_SECRET_KEY', 'SMTP_PASSWORD', 'DEOMAIL_API_KEY']) {
    assert.ok(s[key], `${key} must appear in admin settings`);
    assert.notEqual(s[key].value, 'secret-token', 'secrets must be masked');
  }
  assert.equal(s.CLOUDFLARE_ACCOUNT_ID.section, 'cloudflare');
  assert.equal(s.EMAIL_ENABLED.section, 'mail');
});
