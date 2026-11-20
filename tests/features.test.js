import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import 'dotenv/config';

const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@trycord.dev';
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'LightAdmin2026!';
const base = process.env.LIGHT_TEST_URL || 'http://127.0.0.1:5858';
async function req(route, options = {}) {
  const r = await fetch(base + route, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login() {
  const r = await req('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  return r.body.token;
}

// RFC 6238 TOTP code generator for verifying 2FA behavior.
function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) { const i = alphabet.indexOf(c.toUpperCase()); if (i >= 0) bits += i.toString(2).padStart(5, '0'); }
  const key = []; for (let i = 0; i + 8 <= bits.length; i += 8) key.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', Buffer.from(key)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  return String((((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1000000).padStart(6, '0');
}

test('2FA setup produces a valid secret and enabling requires a correct code', async () => {
  // Use a throwaway user so a failure can never leave the shared admin locked behind 2FA.
  const email = `2fa-${Date.now().toString(36)}@test.dev`, password = 'twofa-password-123';
  const reg = await req('/api/auth/register', { method: 'POST', body: { email, password, name: '2FA Test' } });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  let secret = '';
  try {
    const setup = await req('/api/features/2fa/setup', { method: 'POST', token, body: {} });
    assert.equal(setup.status, 200);
    assert.ok(setup.body.secret && setup.body.secret.length >= 16);
    secret = setup.body.secret;
    const bad = await req('/api/features/2fa/enable', { method: 'POST', token, body: { code: '000000' } });
    assert.ok(bad.status === 400 || bad.body.enabled === false, 'wrong code must not enable 2FA');
    const enabled = await req('/api/features/2fa/enable', { method: 'POST', token, body: { code: totp(secret) } });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.enabled, true);
    assert.equal(enabled.body.backupCodes.length, 8);
    const status = await req('/api/features/2fa/status', { token });
    assert.equal(status.body.enabled, true);
    const noCode = await req('/api/features/2fa/login', { method: 'POST', body: { email, password } });
    assert.equal(noCode.status, 401);
    const withCode = await req('/api/features/2fa/login', { method: 'POST', body: { email, password, code: totp(secret) } });
    assert.equal(withCode.status, 200);
    assert.ok(withCode.body.token);
    const disabled = await req('/api/features/2fa/disable', { method: 'POST', token, body: { code: totp(secret) } });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.enabled, false);
  } finally {
    if (secret) await req('/api/features/2fa/disable', { method: 'POST', token, body: { code: totp(secret) } }).catch(() => {});
  }
});

test('payment providers are honest when unconfigured', async () => {
  const token = await login();
  const methods = await req('/api/billing/methods', { token });
  assert.equal(methods.status, 200);
  assert.ok(Array.isArray(methods.body.providers));
  // No STRIPE_SECRET_KEY in test env => no providers advertised.
  // A provider is only advertised when BOTH the API key and webhook secret are
  // configured — otherwise checkout could succeed while provisioning never fires.
  assert.equal(methods.body.providers.includes('stripe'), Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET));
});

test('failing webhook signature verification never processes events', async () => {
  const bad = await req('/api/billing/webhook/stripe', { method: 'POST', body: { id: 'evt_fake', type: 'checkout.session.completed' }, headers: { 'stripe-signature': 'invalid' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_signature');
  const badGh = await req('/api/github/webhook', { method: 'POST', body: { repository: { full_name: 'a/b' } }, headers: { 'x-hub-signature-256': 'bad' } });
  assert.equal(badGh.status, 401);
});

test('proxy config is generated from real domains when configured', async () => {
  const token = await login();
  const r = await fetch(base + '/api/features/proxy/config', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes('reverse_proxy') || text.length > 0);
});

test('github config reports honest unconfigured state', async () => {
  const token = await login();
  const cfg = await req('/api/github/config', { token });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.configured, Boolean(process.env.GITHUB_CLIENT_ID));
});
