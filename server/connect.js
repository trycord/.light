// ============================================================================
// .light — Stripe Connect SAMPLE INTEGRATION
// ============================================================================
// This module is intentionally explicit and commented step by step so it can
// be used as a reference implementation. It uses the official Stripe Node SDK
// (^23.2.0) and a single Stripe Client for EVERY Stripe request.
//
// IMPORTANT — API VERSION:
//   We deliberately do NOT set `apiVersion`. The SDK automatically uses the
//   latest API version (2026-11-18.endive at the time of writing). Never pin
//   an old version here unless Stripe explicitly tells you to.
//
// CONFIGURATION (fill these in your environment / admin Settings):
//   STRIPE_SECRET_KEY   = sk_***           // platform (your) secret key
//   STRIPE_WEBHOOK_SECRET = whsec_***      // secret for the THIN V2 destination
//   STRIPE_SUB_WEBHOOK_SECRET = whsec_***  // secret for the normal subscription endpoint
//   PLATFORM_PRICE_ID   = price_***        // recurring price for the platform subscription
//   CONNECT_APP_FEE_CENTS = 123            // sample application fee for direct charges
//   CONNECT_RETURN_URL  = https://your-domain/connect/success
// ============================================================================

import Stripe from 'stripe';
import { getDb } from './db.js';
import { id, now, str, json } from './util.js';
import { get } from './settings.js';

// ----------------------------------------------------------------------------
// 1. A single Stripe Client for all requests.
// ----------------------------------------------------------------------------
// TODO(dev): replace the placeholder in your .env with your real platform key:
//   STRIPE_SECRET_KEY=sk_test_REPLACE_ME
// Better-sqlite3 / config never store card data — only ids returned by Stripe.
let client;
export function getStripeClient() {
  const key = String(get('STRIPE_SECRET_KEY', '') || '');
  if (!key || key.includes('REPLACE_ME')) {
    throw new Error(
      'Stripe Connect is not configured. Set STRIPE_SECRET_KEY in .env or the admin Settings page ' +
      '(placeholder: sk_test_REPLACE_ME). No Stripe request was made.'
    );
  }
  if (!client || client._ltKey !== key) {
    // NOTE: no apiVersion option — the SDK supplies the latest version.
    client = new Stripe(key);
    client._ltKey = key;
  }
  return client;
}

function webhookSecret(which = 'thin') {
  const key = which === 'subscription' ? 'STRIPE_SUB_WEBHOOK_SECRET' : 'STRIPE_WEBHOOK_SECRET';
  const value = String(get(key, '') || '');
  if (!value || value.includes('REPLACE_ME')) {
    throw new Error(
      `${key} is not configured. Set it in .env or admin Settings (placeholder: whsec_REPLACE_ME). ` +
      `Use "stripe listen --print-secret" locally.`
    );
  }
  return value;
}

function platformPriceId() {
  // TODO(dev): create a recurring Price in your Stripe Dashboard and paste its id.
  const value = String(get('PLATFORM_PRICE_ID', '') || '');
  if (!value || value.includes('REPLACE_ME')) {
    throw new Error('PLATFORM_PRICE_ID is not configured (placeholder: price_REPLACE_ME). Create a recurring price in Stripe first.');
  }
  return value;
}

function returnUrl() {
  // TODO(dev): use your real public URL, e.g. https://hosting.example.com
  return String(get('CONNECT_RETURN_URL', '') || 'http://localhost:5858/connect/success');
}

// ----------------------------------------------------------------------------
// 2. Persist the user -> connected account mapping in our existing database.
// ----------------------------------------------------------------------------
function rowForUser(userId) {
  return getDb().prepare('SELECT * FROM connect_accounts WHERE user_id = ?').get(userId);
}
function ensureRow(userId) {
  const existing = rowForUser(userId);
  if (existing) return existing;
  const ts = now();
  getDb().prepare('INSERT INTO connect_accounts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id('cacc'), userId, ts, ts);
  return rowForUser(userId);
}
function touch(userId, patch = {}) {
  const row = ensureRow(userId);
  const sets = []; const values = [];
  for (const [column, value] of Object.entries(patch)) { sets.push(`${column} = ?`); values.push(value); }
  sets.push('updated_at = ?'); values.push(now(), row.id);
  getDb().prepare(`UPDATE connect_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return rowForUser(userId);
}

// ----------------------------------------------------------------------------
// 3. CREATE A CONNECTED ACCOUNT (V2 API).
// ----------------------------------------------------------------------------
// The V2 account object does NOT accept a top-level `type` field. The merchant
// and customer configurations below describe what the account can do.
export async function createConnectedAccount(userId, { email, displayName, country = 'us' } = {}) {
  const existing = rowForUser(userId);
  if (existing?.account_id) return { accountId: existing.account_id, reused: true };

  const stripe = getStripeClient();
  // STEP 1: ask Stripe to create the account using the V2 API.
  // Only the documented properties are sent — never `type: 'express'` etc.
  const account = await stripe.v2.core.accounts.create({
    display_name: displayName || 'Trycord seller',                 // From User
    contact_email: email || 'seller@example.com',                   // From User
    identity: {
      country: country || 'us',                                     // ISO country code
    },
    dashboard: 'full',                                             // full Express-style dashboard
    defaults: {
      responsibilities: {
        fees_collector: 'stripe',                                  // Stripe collects fees
        losses_collector: 'stripe',                                // Stripe handles losses
      },
    },
    configuration: {
      customer: {},                                                // enable customer configuration
      merchant: {
        capabilities: {
          card_payments: { requested: true },                      // request card payments
        },
      },
    },
  });

  // STEP 2: store the mapping in OUR database (never store secrets here).
  touch(userId, { account_id: account.id, status: 'created' });
  return { accountId: account.id, account, reused: false };
}

// ----------------------------------------------------------------------------
// 4. ONBOARDING — create an Account Link (V2 API).
// ----------------------------------------------------------------------------
export async function createAccountLink(userId) {
  const stripe = getStripeClient();
  const row = ensureRow(userId);
  if (!row.account_id) throw new Error('Connected account does not exist yet. Call /api/connect/account first.');

  // STEP 1: Stripe returns a short-lived URL the seller visits to finish KYC.
  // STEP 2: both URLs return to our app so we can re-check status from the API.
  const payload = {
    account: row.account_id,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'customer'],
        refresh_url: returnUrl(),                                   // expired link -> new one
        return_url: `${returnUrl()}?accountId=${row.account_id}`,   // finished onboarding
      },
    },
  };
  let accountLink;
  try {
    accountLink = await stripe.v2.core.accountLinks.create(payload);
  } catch (error) {
    // Compatibility: some Stripe API revisions reject `configurations` here.
    // The account was already created with merchant + customer configurations,
    // so retrying without the field is safe and preserves the onboarding flow.
    if (!String(error.message || '').includes('configurations: Unknown field')) throw error;
    delete payload.use_case.account_onboarding.configurations;
    accountLink = await stripe.v2.core.accountLinks.create(payload);
  }
  touch(userId, { status: 'onboarding' });
  return { url: accountLink.url, accountId: row.account_id };
}

// ----------------------------------------------------------------------------
// 5. ACCOUNT STATUS — ALWAYS read directly from the Stripe API.
// ----------------------------------------------------------------------------
// For this demo we intentionally do NOT trust a cached DB status. The webhook
// handlers below update our local copy for convenience, but the UI calls this
// function on every page load so the displayed state is always fresh.
export async function getAccountStatus(userId) {
  const stripe = getStripeClient();
  const row = rowForUser(userId);
  if (!row?.account_id) return { connected: false, status: 'not_started', readyToProcessPayments: false, onboardingComplete: false };

  // STEP 1: retrieve with the expansions that include capability + requirements.
  const account = await stripe.v2.core.accounts.retrieve(row.account_id, {
    include: ['configuration.merchant', 'requirements'],
  });

  // STEP 2: derive the two booleans the UI needs (see Stripe V2 account docs).
  const readyToProcessPayments =
    account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
  const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status;
  const onboardingComplete = requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';

  // STEP 3: keep a local convenience copy (the UI still re-fetches from API).
  touch(userId, { status: onboardingComplete ? 'complete' : 'onboarding' });
  return { connected: true, accountId: row.account_id, readyToProcessPayments, onboardingComplete,
    requirementsStatus: requirementsStatus || 'none', account };
}

// ----------------------------------------------------------------------------
// 6. PRODUCTS ON THE CONNECTED ACCOUNT (Stripe-Account header).
// ----------------------------------------------------------------------------
// Passing `{ stripeAccount }` as the SECOND argument tells the SDK to add the
// `Stripe-Account: acct_...` header — this is what makes the request act on
// behalf of the connected account rather than the platform.
export async function createProduct(userId, { name, description = '', priceInCents, currency = 'usd' }) {
  const stripe = getStripeClient();
  const row = ensureRow(userId);
  if (!row.account_id) throw new Error('Onboard the account before creating products.');
  if (!priceInCents || Number(priceInCents) <= 0) throw new Error('priceInCents must be a positive integer.');

  const product = await stripe.products.create({
    name,
    description,
    default_price_data: {
      unit_amount: Number(priceInCents),
      currency: String(currency).toLowerCase(),
    },
  }, { stripeAccount: row.account_id }); // <-- Stripe-Account header

  return { id: product.id, defaultPriceId: product.default_price?.id || null };
}

export async function listProducts(userId) {
  const stripe = getStripeClient();
  const row = rowForUser(userId);
  if (!row?.account_id) return [];
  const result = await stripe.products.list({
    limit: 20,
    active: true,
    expand: ['data.default_price'],
  }, { stripeAccount: row.account_id }); // <-- Stripe-Account header
  return result.data.map((p) => ({
    id: p.id, name: p.name, description: p.description,
    priceId: typeof p.default_price === 'string' ? p.default_price : p.default_price?.id,
    amount: typeof p.default_price === 'object' ? p.default_price.unit_amount : null,
    currency: typeof p.default_price === 'object' ? p.default_price.currency : null,
  }));
}

// ----------------------------------------------------------------------------
// 7. DIRECT CHARGE WITH APPLICATION FEE (hosted Checkout).
// ----------------------------------------------------------------------------
// A "direct charge" is created on the CONNECTED account, and the platform
// takes a fee via `application_fee_amount`. The Stripe-Account header routes
// the request to the seller's account.
export async function createDirectCheckout(userId, { priceId, quantity = 1, successUrl, cancelUrl }) {
  const stripe = getStripeClient();
  const row = ensureRow(userId);
  if (!row.account_id) throw new Error('Onboard the account before charging.');
  if (!priceId) throw new Error('priceId is required.');

  const feeCents = Number(get('CONNECT_APP_FEE_CENTS', '123') || 123);
  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: priceId, quantity: Number(quantity) || 1 }],
    payment_intent_data: {
      application_fee_amount: feeCents,   // sample platform monetisation
    },
    mode: 'payment',
    success_url: successUrl || `${returnUrl()}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${returnUrl()}?canceled=1`,
  }, { stripeAccount: row.account_id }); // <-- Stripe-Account header

  return { url: session.url, sessionId: session.id };
}

// ----------------------------------------------------------------------------
// 8. PLATFORM SUBSCRIPTION CHARGED TO THE CONNECTED ACCOUNT.
// ----------------------------------------------------------------------------
// With V2 accounts ONE id is used for both the customer and the connected
// account: pass it as `customer_account` (NOT `customer`). The subscription
// lives at the PLATFORM level (no Stripe-Account header here).
export async function createSubscriptionCheckout(userId, { successUrl, cancelUrl } = {}) {
  const stripe = getStripeClient();
  const row = ensureRow(userId);
  if (!row.account_id) throw new Error('Onboard the account before subscribing.');

  const session = await stripe.checkout.sessions.create({
    customer_account: row.account_id,          // V2 account id == customer id
    mode: 'subscription',
    line_items: [{ price: platformPriceId(), quantity: 1 }],
    success_url: successUrl || `${returnUrl()}?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${returnUrl()}?subscription=cancelled`,
  });
  return { url: session.url, sessionId: session.id };
}

// ----------------------------------------------------------------------------
// 9. BILLING PORTAL — let the seller manage their subscription.
// ----------------------------------------------------------------------------
export async function createBillingPortal(userId) {
  const stripe = getStripeClient();
  const row = rowForUser(userId);
  if (!row?.account_id) throw new Error('No connected account for this user.');
  const session = await stripe.billingPortal.sessions.create({
    customer_account: row.account_id,          // V2 account id, not .customer
    return_url: returnUrl(),
  });
  return { url: session.url };
}

// ----------------------------------------------------------------------------
// 10. THIN WEBHOOKS for V2 account requirement changes.
// ----------------------------------------------------------------------------
// Thin events contain only an id + type. We parse the signature, then FETCH
// the full event from Stripe before acting on it.
export async function handleThinWebhook(rawBody, signature) {
  const stripe = getStripeClient();
  if (!rawBody) throw new Error('Missing raw request body — webhook signature cannot be verified.');

  // STEP 1: verify signature and parse the thin envelope.
  const thinEvent = stripe.parseThinEvent(rawBody, signature, webhookSecret('thin'));

  // STEP 2: retrieve the FULL event from the V2 API.
  const event = await stripe.v2.core.events.retrieve(thinEvent.id);

  // STEP 3: dispatch to the correct handler by event.type.
  switch (event.type) {
    case 'v2.core.account[requirements].updated':
      return handleRequirementsUpdated(event);
    case 'v2.core.account[configuration.merchant].capability_status_updated':
      return handleCapabilityUpdated(event, 'merchant');
    case 'v2.core.account[configuration.customer].capability_status_updated':
      return handleCapabilityUpdated(event, 'customer');
    default:
      return { handled: false, type: event.type };
  }
}

function handleRequirementsUpdated(event) {
  // Thin-event objects expose the affected account in `event.data.object`.
  const accountId = event.data?.object?.id || event.account || '';
  const status = event.data?.object?.requirements?.summary?.minimum_deadline?.status || 'unknown';
  // TODO(dev): notify the seller (email/in-app) that new information is required.
  // DB write example (we keep a convenience copy; UI always re-fetches from API):
  getDb().prepare('UPDATE connect_accounts SET status = ?, updated_at = ? WHERE account_id = ?')
    .run(status === 'currently_due' || status === 'past_due' ? 'action_required' : 'complete', now(), accountId);
  return { handled: true, type: event.type, accountId, requirementsStatus: status };
}

function handleCapabilityUpdated(event, configuration) {
  const accountId = event.data?.object?.id || event.account || '';
  const capability = event.data?.object?.configuration?.[configuration]?.capabilities?.card_payments?.status || 'unknown';
  // TODO(dev): enable/disable payouts in your product when capability changes.
  getDb().prepare('UPDATE connect_accounts SET status = ?, updated_at = ? WHERE account_id = ?')
    .run(capability === 'active' ? 'complete' : 'onboarding', now(), accountId);
  return { handled: true, type: event.type, accountId, configuration, capability };
}

// ----------------------------------------------------------------------------
// 11. NORMAL (non-thin) SUBSCRIPTION / BILLING WEBHOOKS.
// ----------------------------------------------------------------------------
// These events are delivered for the PLATFORM-level subscription created in
// step 8. They are NOT thin events: verify with the normal signing secret.
export async function handleSubscriptionWebhook(rawBody, signature) {
  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret('subscription'));

  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      // IMPORTANT: for V2 accounts the id is in `customer_account`, NOT `customer`.
      const accountId = sub.customer_account || sub.customer || '';
      const priceId = sub.items?.data?.[0]?.price?.id || '';
      const quantity = sub.items?.data?.[0]?.quantity || 1;
      const active = sub.status === 'active' && !sub.cancel_at_period_end;
      // TODO(dev): write subscription status to YOUR database here. Example:
      getDb().prepare(`UPDATE connect_accounts SET subscription_id = ?, subscription_status = ?, updated_at = ? WHERE account_id = ?`)
        .run(sub.id || '', active ? sub.status : (sub.cancel_at_period_end ? 'cancel_scheduled' : sub.status), now(), accountId);
      // If you grant access to features, grant/revoke based on `active`, `priceId`, `quantity`.
      return { handled: true, type: event.type, accountId, priceId, quantity, active };
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      const accountId = invoice.customer_account || invoice.customer || '';
      // TODO(dev): record the paid invoice / extend entitlement in your DB.
      return { handled: true, type: event.type, accountId, invoiceId: invoice.id };
    }
    case 'payment_method.attached':
    case 'payment_method.detached':
    case 'customer.updated':
    case 'customer.tax_id.created':
    case 'customer.tax_id.deleted':
    case 'customer.tax_id.updated':
    case 'billing_portal.configuration.created':
    case 'billing_portal.configuration.updated':
    case 'billing_portal.session.created':
      // TODO(dev): mirror billing details into your DB. Treat as billing info
      // only — never use a billing email as a login credential.
      return { handled: true, type: event.type };
    default:
      return { handled: false, type: event.type };
  }
}

/** Public storefront data — customers of a seller do not need a .light account. */
export async function listStoreProducts(accountId) {
  const stripe = getStripeClient();
  const result = await stripe.products.list({
    limit: 20, active: true, expand: ['data.default_price'],
  }, { stripeAccount: accountId }); // <-- Stripe-Account header for the seller
  return result.data.map((p) => ({
    id: p.id, name: p.name, description: p.description,
    priceId: typeof p.default_price === 'string' ? p.default_price : p.default_price?.id,
    amount: typeof p.default_price === 'object' ? p.default_price.unit_amount : null,
    currency: typeof p.default_price === 'object' ? p.default_price.currency : null,
  }));
}

/** Public direct-checkout for a seller's storefront (no .light login needed). */
export async function createStoreCheckout(accountId, { priceId, quantity = 1 }) {
  const stripe = getStripeClient();
  if (!priceId) throw new Error('priceId is required.');
  const feeCents = Number(get('CONNECT_APP_FEE_CENTS', '123') || 123);
  // The Stripe-Account header makes this a DIRECT charge on the seller.
  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: priceId, quantity: Number(quantity) || 1 }],
    payment_intent_data: { application_fee_amount: feeCents },
    mode: 'payment',
    success_url: `${returnUrl()}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnUrl()}?canceled=1`,
  }, { stripeAccount: accountId });
  return { url: session.url, sessionId: session.id };
}

/** Resolve the internal user id for a public storefront URL. */
export function userForAccount(accountId) {
  const row = getDb().prepare('SELECT user_id FROM connect_accounts WHERE account_id = ?').get(accountId);
  return row?.user_id || null;
}

export function connectStatus() {
  const key = String(get('STRIPE_SECRET_KEY', '') || '');
  return { configured: Boolean(key && !key.includes('REPLACE_ME')),
    thinWebhookConfigured: Boolean(get('STRIPE_WEBHOOK_SECRET', '')),
    subscriptionWebhookConfigured: Boolean(get('STRIPE_SUB_WEBHOOK_SECRET', '')),
    platformPriceConfigured: Boolean(platformPriceIdSafe()) };
}
function platformPriceIdSafe() {
  try { return platformPriceId(); } catch { return ''; }
}
