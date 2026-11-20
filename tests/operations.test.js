// .light — notifications, support tickets, analytics and RBAC integration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';
async function req(route, options = {}) {
  const r = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
// Admin login can briefly require a 2FA code while features.test.js toggles it.
async function adminLogin() {
  for (let i = 0; i < 8; i++) {
    const r = await req('/api/auth/login', { method: 'POST', body: {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev',
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'LightAdmin2026!',
    } });
    if (r.status === 200 && r.body.token) return r.body.token;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('admin login failed');
}

const suffix = Date.now().toString(36);
const email = `ops-${suffix}@test.dev`;
const password = 'ops-test-password-123';
let adminToken, userToken, userId, teamId;

test('platform offers only the Free plan', async () => {
  const token = await adminLogin();
  const admin = await req('/api/admin/plans', { token });
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.plans.map((p) => p.id), ['free']);
  const catalog = await req('/api/catalog/plans', { token });
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.plans.length >= 1);
  assert.deepEqual([...new Set(catalog.body.plans.map((p) => p.id))], ['free']);
});

test('BYOP is opt-in and Cloudflare reports honest unconfigured state', async () => {
  const token = await adminLogin();
  const estimate = await req('/api/catalog/pricing/estimate', { method: 'POST', token, body: { resources: { cpuCores: 4, memoryMb: 8192, diskGb: 100 } } });
  assert.equal(estimate.status, 403);
  assert.equal(estimate.body.message, 'custom_plans_disabled');
  const activate = await req('/api/subscriptions/activate', { method: 'POST', token, body: { custom: { cpuCores: 4, memoryMb: 8192, diskGb: 100 } } });
  assert.equal(activate.status, 403);
  const cfg = await req('/api/features/cloudflare', { token });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.configured, Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ZONE_ID));
});

test('Shade health reports are persisted on services', async () => {
  const email = `health-${Date.now().toString(36)}@test.dev`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password: 'health-password-123', name: 'Health Test' } });
  assert.equal(reg.status, 201);
  const created = await req('/api/instances', { method: 'POST', token: reg.body.token,
    body: { name: 'health-test', environmentId: 'static-site' } });
  assert.equal(created.status, 201);
  const iid = created.body.instance.id;
  let nodeToken = process.env.NODE_TOKEN || '';
  try { nodeToken = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', '.secrets.json'), 'utf8')).NODE_TOKEN || nodeToken; } catch { /* use env */ }
  assert.ok(nodeToken, 'node token must be available');
  const reported = await req('/api/agent/instances/health', { method: 'POST',
    headers: { 'x-node-token': nodeToken },
    body: { instances: [{ instanceId: iid, status: 'running', health: 'healthy' }] } });
  assert.equal(reported.status, 200);
  assert.equal(reported.body.updated, 1);
  const row = await req(`/api/instances/${iid}`, { token: reg.body.token });
  assert.equal(row.body.instance.healthStatus, 'healthy');
});

test('setup: admin and customer credentials', async () => {
  adminToken = await adminLogin();
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password, name: 'Ops Test', username: `ops_${suffix}`, acceptTerms: true } });
  assert.equal(reg.status, 201);
  userToken = reg.body.token;
  userId = reg.body.user.id;
  teamId = reg.body.user.teamId;
  assert.ok(userId && teamId);
});

test('notifications: broadcast reaches customer, unread count and mark-read work', async () => {
  const title = `notice-${suffix}`;
  const created = await req('/api/notifications', { method: 'POST', token: adminToken, body: { broadcast: true, type: 'info', title, message: 'hello' } });
  assert.equal(created.status, 201);
  assert.ok(created.body.created >= 1);

  const list = await req('/api/notifications', { token: userToken });
  assert.equal(list.status, 200);
  const mine = list.body.notifications.find((n) => n.title === title);
  assert.ok(mine, 'broadcast notification visible to customer');
  assert.equal(mine.read, false);
  assert.ok(list.body.unread >= 1);

  const read = await req(`/api/notifications/${mine.id}/read`, { method: 'PATCH', token: userToken, body: {} });
  assert.equal(read.status, 200);
  assert.equal(read.body.notification.read, true);

  const all = await req('/api/notifications/read-all', { method: 'POST', token: userToken, body: {} });
  assert.equal(all.status, 200);
  const after = await req('/api/notifications/unread', { token: userToken });
  assert.equal(after.body.unread, 0);
});

test('support tickets: customer creates, admin replies, customer sees notification and can close', async () => {
  const subject = `Ticket ${suffix}`;
  const made = await req('/api/tickets', { method: 'POST', token: userToken, body: { subject, category: 'technical', priority: 'high', message: 'Please help' } });
  assert.equal(made.status, 201);
  const tid = made.body.ticket.id;
  assert.equal(made.body.ticket.status, 'open');
  assert.equal(made.body.ticket.messages.length, 1);

  const mine = await req('/api/tickets', { token: userToken });
  assert.ok(mine.body.tickets.some((t) => t.id === tid));

  const adminList = await req('/api/admin/tickets', { token: adminToken });
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body.tickets.some((t) => t.id === tid));

  const reply = await req(`/api/admin/tickets/${tid}/messages`, { method: 'POST', token: adminToken, body: { message: 'We are on it' } });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.ticket.messages.length, 2);
  assert.equal(reply.body.ticket.messages[1].isStaff, true);

  const detail = await req(`/api/tickets/${tid}`, { token: userToken });
  assert.equal(detail.body.ticket.messages.length, 2);
  assert.equal(detail.body.ticket.messages[1].message, 'We are on it');

  const notes = await req('/api/notifications', { token: userToken });
  assert.ok(notes.body.notifications.some((n) => n.data?.ticketId === tid), 'reply generated a ticket notification');

  const closed = await req(`/api/tickets/${tid}`, { method: 'PATCH', token: userToken, body: { status: 'closed' } });
  assert.equal(closed.body.ticket.status, 'closed');
  assert.ok(closed.body.ticket.closedAt);
});

test('analytics: aggregates real persisted data', async () => {
  const r = await req('/api/admin/analytics', { token: adminToken });
  assert.equal(r.status, 200);
  const s = r.body.summary;
  assert.ok(s.users >= 1 && s.teams >= 1);
  assert.ok(Number.isInteger(s.openTickets));
  assert.ok(Array.isArray(r.body.signups) && r.body.signups.length === 30);
  assert.ok(Array.isArray(r.body.instancesByCategory));
  assert.ok(Array.isArray(r.body.recentActivity));
  const denied = await req('/api/admin/analytics', { token: userToken });
  assert.equal(denied.status, 403);
});

test('RBAC: custom roles grant permissions and can be assigned', async () => {
  const roleId = `opsrole-${suffix}`;
  const created = await req('/api/admin/roles', { method: 'POST', token: adminToken,
    body: { name: roleId, description: 'test role', permissions: ['admin.access', 'tickets.read'] } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.role.permissions.sort(), ['admin.access', 'tickets.read']);

  const assigned = await req(`/api/admin/users/${userId}`, { method: 'PATCH', token: adminToken, body: { role: roleId } });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.user.role, roleId);

  // Assignment bumps token_version, so re-authenticate.
  const login = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  const roleToken = login.body.token;

  const me = await req('/api/auth/me', { token: roleToken });
  assert.ok(me.body.permissions.includes('tickets.read'));
  assert.ok(!me.body.permissions.includes('analytics.read'));

  const allowed = await req('/api/admin/tickets', { token: roleToken });
  assert.equal(allowed.status, 200, 'role with admin.access and tickets.read reads tickets');
  const denied = await req('/api/admin/analytics', { token: roleToken });
  assert.equal(denied.status, 403, 'role without analytics.read is denied');
  const writeDenied = await req(`/api/admin/tickets/${'tkt_none'}/messages`, { method: 'POST', token: roleToken, body: { message: 'x' } });
  assert.equal(writeDenied.status, 403, 'role without tickets.write cannot reply');
  const customersDenied = await req('/api/admin/products', { token: roleToken });
  assert.equal(customersDenied.status, 403, 'role without products.read cannot browse catalogue');

  const invalid = await req('/api/admin/roles', { method: 'POST', token: adminToken,
    body: { name: `bad-${suffix}`, permissions: ['not.a.permission'] } });
  assert.equal(invalid.status, 201);
  assert.deepEqual(invalid.body.role.permissions, [], 'unknown permissions are ignored');
  await req(`/api/admin/roles/${invalid.body.role.id}`, { method: 'DELETE', token: adminToken });

  // Restore the customer to the plain user role.
  await req(`/api/admin/users/${userId}`, { method: 'PATCH', token: adminToken, body: { role: 'user' } });
  await req(`/api/admin/roles/${roleId}`, { method: 'DELETE', token: adminToken });
});

test('impersonation: real admin gets a scoped token; privileged actions stay blocked', async () => {
  const imp = await req(`/api/admin/users/${userId}/impersonate`, { method: 'POST', token: adminToken, body: {} });
  assert.equal(imp.status, 200);
  assert.ok(imp.body.token);
  const me = await req('/api/auth/me', { token: imp.body.token });
  assert.equal(me.body.user.id, userId);
  assert.equal(me.body.impersonatedBy, imp.body.impersonatedBy);
  const blocked = await req('/api/admin/roles', { token: imp.body.token });
  assert.equal(blocked.status, 403, 'impersonation tokens cannot manage roles');
  const selfImpersonate = await req(`/api/admin/users/${userId}/impersonate`, { method: 'POST', token: imp.body.token, body: {} });
  assert.equal(selfImpersonate.status, 403);
});
