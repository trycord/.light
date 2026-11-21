// .light — top-of-the-line: filesystem boundary, package registry, charts, product awareness.
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
async function customer() {
  const r = await req('/api/auth/register', { method: 'POST', body: {
    email: `top-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}@test.dev`,
    password: 'top-password-123', name: 'Top' } });
  assert.equal(r.status, 201); return r.body.token;
}
async function admin() {
  const r = await req('/api/auth/login', { method: 'POST', body: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'LightAdmin2026!' } });
  assert.equal(r.status, 200); return r.body.token;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('catalog exposes product-specific package options', async () => {
  const r = await req('/api/catalog/products/minecraft/options');
  assert.equal(r.status, 200);
  const ids = r.body.packages.map(p => p.id);
  assert.ok(ids.includes('minecraft-paper'));
  assert.ok(!ids.includes('node'), 'bot runtime must not appear for Minecraft');
  assert.ok(r.body.packages.every(p => p.versions.length > 0));
});

test('backend rejects incompatible package selection', async () => {
  const token = await customer();
  const r = await req('/api/checkout', { method: 'POST', token, body: {
    productId: 'minecraft', planId: 'free', packageId: 'node', packageVersion: '22',
    idempotencyKey: 'bad-package-' + Date.now() } });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'package_not_compatible_with_product');
});

test('purchased software is recorded on the service and snapshot', async () => {
  const token = await customer();
  const key = 'good-package-' + Date.now();
  const created = await req('/api/checkout', { method: 'POST', token, body: {
    productId: 'minecraft', planId: 'free', packageId: 'minecraft-paper', packageVersion: '1.21.4',
    config: { motd: 'Test', eulaAccepted: true }, serviceName: 'mc-top', idempotencyKey: key } });
  assert.equal(created.status, 201);
  const order = created.body.order;
  assert.equal(order.packageId, 'minecraft-paper');
  assert.equal(order.packageVersion, '1.21.4');
  assert.equal(order.planSnapshot.software.name, 'Paper');
  assert.equal(order.planSnapshot.software.runtimeVersion, '21');
  assert.equal(order.planSnapshot.software.config.eulaAccepted, true);
  // Replay must reuse the same order, never create a duplicate.
  const replay = await req('/api/checkout', { method: 'POST', token, body: {
    productId: 'minecraft', planId: 'free', packageId: 'minecraft-paper', packageVersion: '1.21.4',
    serviceName: 'mc-top', idempotencyKey: key } });
  assert.equal(replay.body.order.id, order.id);
});

test('EULA is required before a Minecraft order can be placed', async () => {
  const token = await customer();
  const r = await req('/api/checkout', { method: 'POST', token, body: {
    productId: 'minecraft', planId: 'free', packageId: 'minecraft-vanilla', packageVersion: '1.21.4',
    config: { motd: 'No EULA' }, idempotencyKey: 'no-eula-' + Date.now() } });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'eulaAccepted_required');
});

test('admin can manage the package registry and compatibility', async () => {
  const token = await admin();
  const pkgs = await req('/api/admin/packages', { token });
  assert.equal(pkgs.status, 200);
  assert.ok(pkgs.body.packages.some(p => p.id === 'minecraft-paper'));
  const compat = await req('/api/admin/compatibility', { token });
  assert.equal(compat.status, 200);
  assert.ok(compat.body.links.some(l => l.package_id === 'minecraft-paper' && l.product_id === 'minecraft'));
});
