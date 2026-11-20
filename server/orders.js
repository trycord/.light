// .light — orders: the authoritative purchase record for hosted services.
// Prices, plan configuration and ownership are always resolved server-side.
import { getDb } from './db.js';
import { id, now, str, json, conflict, badRequest, notFound } from './util.js';
import { pricingConfig, calculatePrice, validateResources, planPrice, publicPlan } from './pricing.js';
import { validateSelection } from './packages.js';
import { audit } from './audit.js';

export const ORDER_STATES = Object.freeze([
  'awaiting_payment', 'payment_processing', 'paid', 'queued', 'provisioning',
  'active', 'failed', 'suspended', 'terminated', 'cancelled', 'refunded',
]);

export function addOrderEvent(orderId, status, message = '') {
  getDb().prepare('INSERT INTO order_events (order_id, status, message, ts) VALUES (?, ?, ?, ?)')
    .run(orderId, str(status, 40), str(message, 500), now());
}

export function viewOrder(o) {
  return {
    id: o.id, teamId: o.team_id, userId: o.user_id, status: o.status,
    productId: o.product_id, planId: o.plan_id, planSnapshot: json(o.plan_snapshot, {}),
    environmentId: o.environment_id, runtimeVersion: o.runtime_version,
    packageId: o.package_id, packageVersion: o.package_version, packageConfig: json(o.package_config, {}),
    serviceName: o.service_name,
    interval: o.interval, currency: o.currency, subtotal: o.subtotal, tax: o.tax,
    discount: o.discount, total: o.total, provider: o.provider,
    providerSessionId: o.provider_session_id, checkoutSessionId: o.checkout_session_id,
    instanceId: o.instance_id, failureReason: o.failure_reason,
    provisionAttempts: o.provision_attempts,
    createdAt: o.created_at, updatedAt: o.updated_at, paidAt: o.paid_at, completedAt: o.completed_at,
    events: getDb().prepare('SELECT status, message, ts FROM order_events WHERE order_id = ? ORDER BY ts, id').all(o.id),
  };
}

/** Resolve the exact purchasable configuration from the catalogue. */
export function buildQuote(input = {}) {
  const db = getDb();
  const interval = input.interval === 'yearly' ? 'yearly' : 'monthly';
  const product = input.productId ? db.prepare("SELECT * FROM products WHERE id = ? AND status = 'published'").get(String(input.productId)) : null;
  if (input.productId && !product) throw badRequest('product_unavailable');

  let plan = null; let snapshot = {}; let amount = 0;
  if (input.planId) {
    plan = db.prepare("SELECT * FROM plans WHERE id = ? AND status = 'published' AND available = 1").get(String(input.planId));
    if (!plan) throw badRequest('plan_unavailable');
    if (product && plan.product_id && plan.product_id !== product.id) throw badRequest('plan_not_for_product');
    snapshot = {
      name: plan.name, cpuCores: plan.cpu_cores, memoryMb: plan.memory_mb,
      diskGb: plan.disk_gb, networkGb: plan.network_gb, instances: plan.instances,
      features: json(plan.features, []), restrictions: json(plan.restrictions, []),
      supportedRuntimes: json(plan.supported_runtimes, []),
      priceMonthly: plan.price_monthly, priceYearly: plan.price_yearly,
    };
    amount = planPrice(plan, interval);
  } else if (input.custom) {
    const cfg = pricingConfig();
    const resources = validateResources(cfg, input.custom);
    const estimate = calculatePrice(cfg, resources, interval);
    snapshot = { name: 'Custom Plan', ...resources, features: [], restrictions: [], supportedRuntimes: [] };
    amount = estimate.subtotal;
  } else throw badRequest('plan_or_custom_required');

  const cfg = pricingConfig();
  const discount = 0;
  const tax = Math.round((amount - discount) * (Number(cfg.tax_percent) || 0) / 100);
  const total = Math.max(0, amount - discount + tax);
  return { product, plan, snapshot, interval, currency: cfg.currency || 'USD',
    subtotal: amount, discount, tax, total };
}

/** Create an order. Repeated idempotency keys return the existing order. */
export function createOrder({ teamId, userId, input = {}, req }) {
  const key = str(input.idempotencyKey || input.idempotency_key, 200);
  if (!key) throw badRequest('idempotency_key_required');
  const existing = getDb().prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
  if (existing) return { order: existing, created: false };

  const quote = buildQuote(input);
  // Product-aware validation: the backend decides which software a product may use.
  const selection = input.packageId
    ? validateSelection({ productId: quote.product?.id, packageId: input.packageId,
        version: input.packageVersion || input.version, config: input.config || {} })
    : null;
  const runtimeId = selection?.package?.runtimeId || str(input.environmentId || input.runtimeId, 100) ||
    (quote.snapshot.supportedRuntimes || [])[0] || 'node';
  const runtimeVersion = selection?.runtimeVersion || str(input.version || input.runtimeVersion, 60);
  const oid = id('ord'); const ts = now();
  if (selection) quote.snapshot.software = { packageId: selection.package.id, name: selection.package.name,
    version: selection.version, runtimeId: selection.package.runtimeId, runtimeVersion: selection.runtimeVersion,
    config: selection.config };
  getDb().prepare(`INSERT INTO orders (id, team_id, user_id, status, product_id, plan_id, plan_snapshot,
    environment_id, runtime_version, package_id, package_version, package_config, service_name, interval,
    currency, subtotal, tax, discount, total, provider, idempotency_key, created_at, updated_at)
    VALUES (?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
    .run(oid, teamId, userId, quote.product?.id || null, quote.plan?.id || null,
      JSON.stringify(quote.snapshot), runtimeId, runtimeVersion,
      selection?.package?.id || null, selection?.version || null,
      JSON.stringify(selection?.config || {}),
      str(input.serviceName || input.name || 'My service', 100), quote.interval, quote.currency,
      quote.subtotal, quote.tax, quote.discount, quote.total, key, ts, ts);
  addOrderEvent(oid, 'awaiting_payment', 'Order created; awaiting payment');
  if (req) audit(req, 'order.create', 'order', oid, { planId: quote.plan?.id, total: quote.total });
  return { order: getDb().prepare('SELECT * FROM orders WHERE id = ?').get(oid), created: true, quote };
}

export function getOrder(orderId, teamId) {
  const o = teamId
    ? getDb().prepare('SELECT * FROM orders WHERE id = ? AND team_id = ?').get(orderId, teamId)
    : getDb().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw notFound();
  return o;
}

export function attachCheckout(orderId, sessionId, provider = 'stripe') {
  getDb().prepare("UPDATE orders SET provider = ?, provider_session_id = ?, status = 'payment_processing', updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
    .run(provider, str(sessionId, 200), now(), orderId);
  addOrderEvent(orderId, 'payment_processing', 'Payment session created');
}

/** Idempotent payment confirmation. Only paid orders can be provisioned. */
export function markOrderPaid(orderId, { provider, reference } = {}) {
  const o = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw notFound();
  if (['paid', 'queued', 'provisioning', 'active', 'refunded'].includes(o.status)) return { order: o, alreadyPaid: true };
  if (['cancelled', 'terminated'].includes(o.status)) throw conflict('order_closed');
  getDb().prepare("UPDATE orders SET status = 'paid', provider = COALESCE(NULLIF(provider,''), ?), paid_at = ?, updated_at = ? WHERE id = ?")
    .run(str(provider || '', 40), now(), now(), o.id);
  addOrderEvent(o.id, 'paid', `Payment confirmed${reference ? ` (${reference})` : ''}`);
  return { order: getDb().prepare('SELECT * FROM orders WHERE id = ?').get(o.id), alreadyPaid: false };
}

export function markOrderFailed(orderId, reason) {
  getDb().prepare("UPDATE orders SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?")
    .run(str(reason, 500), now(), orderId);
  addOrderEvent(orderId, 'failed', str(reason, 500));
}

export function markOrderActive(orderId) {
  getDb().prepare("UPDATE orders SET status = 'active', completed_at = ?, updated_at = ? WHERE id = ?")
    .run(now(), now(), orderId);
  addOrderEvent(orderId, 'active', 'Service is active');
}

export function incrementAttempt(orderId) {
  getDb().prepare('UPDATE orders SET provision_attempts = provision_attempts + 1, updated_at = ? WHERE id = ?').run(now(), orderId);
}
