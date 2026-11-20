// .light — provider-independent payments abstraction.
// No raw card data is ever stored. Configuration from environment/admin.
import crypto from 'crypto';
import config from './config.js';
import { getDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { id, now, json } from './util.js';
import { get } from './settings.js';

function stripeKey() {
  return String(get('STRIPE_SECRET_KEY', '') || '');
}
function stripeEnabled() {
  return Boolean(stripeKey() && get('STRIPE_WEBHOOK_SECRET', ''));
}

async function stripeRequest(path, method = 'GET', body) {
  const key = stripeKey();
  if (!key) throw new Error('stripe_not_configured');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const form = body ? new URLSearchParams(body).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `stripe_${res.status}`);
  return data;
}

export function enabledProviders() {
  const out = [];
  if (stripeEnabled()) out.push('stripe');
  return out;
}

export function isEnabled(provider) {
  return provider === 'stripe' && stripeEnabled();
}

export async function createCheckout({ teamId, amount, currency, description, metadata, successUrl, cancelUrl }) {
  if (!stripeEnabled()) throw new Error('no_payment_provider_configured');
  const session = await stripeRequest('/checkout/sessions', 'POST', {
    'mode': 'payment',
    'line_items[0][price_data][currency]': currency || 'usd',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': description || '.light hosting',
    'line_items[0][quantity]': '1',
    'success_url': successUrl || `${config.controlBaseUrl}/login?checkout=success&session={CHECKOUT_SESSION_ID}`,
    'cancel_url': cancelUrl || `${config.controlBaseUrl}/hosting?checkout=cancelled`,
    'client_reference_id': teamId,
    ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)])),
  });
  return { provider: 'stripe', sessionId: session.id, url: session.url };
}

export async function createRefund(providerRef, amount) {
  if (!stripeEnabled()) throw new Error('no_payment_provider_configured');
  const body = { 'payment_intent': providerRef };
  if (amount) body.amount = String(amount);
  return stripeRequest('/refunds', 'POST', body);
}

export function verifyWebhookSignature(provider, rawBody, signatureHeader) {
  if (provider !== 'stripe') return false;
  const secret = String(get('STRIPE_WEBHOOK_SECRET', '') || '');
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const t = parts.t; const v1 = parts.v1;
  if (!t || !v1) return false;
  // Reject stale payloads (5 min tolerance)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch { return false; }
}

export function recordWebhook(provider, eventId, eventType, payload, status = 'processed', error = '') {
  const db = getDb();
  if (db.prepare('SELECT id FROM payment_webhooks WHERE event_id = ?').get(eventId)) return false;
  db.prepare('INSERT INTO payment_webhooks (id, provider, event_id, event_type, payload, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id('wh'), provider, eventId, eventType, JSON.stringify(payload || {}), status, error, now());
  return true;
}
