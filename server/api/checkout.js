// .light — product/plan checkout and order status API.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { isEnabled as stripeEnabled, createCheckout } from '../payments.js';
import { createOrder, getOrder, viewOrder, attachCheckout, addOrderEvent } from '../orders.js';
import { retryOrder } from '../provisioning.js';
import { asyncRoute, badRequest, str } from '../util.js';
import { audit } from '../audit.js';

export function checkoutRoutes() {
  const router = Router();
  router.use(requireAuth);

  // Build an order entirely from server-resolved catalogue + pricing config.
  router.post('/', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const { order, created, quote } = createOrder({
      teamId: req.teamId, userId: req.user.id,
      input: {
        idempotencyKey: b.idempotencyKey || b.idempotency_key,
        productId: b.productId || b.product_id, planId: b.planId || b.plan_id,
        environmentId: b.environmentId || b.runtimeId,
        version: b.version || b.runtimeVersion,
        serviceName: b.serviceName || b.name,
        interval: b.interval, custom: b.custom,
      }, req,
    });
    let checkoutUrl = null;
    if (created && order.total > 0 && stripeEnabled()) {
      try {
        const session = await createCheckout({
          teamId: req.teamId, amount: order.total, currency: order.currency,
          description: quote.snapshot.name || '.light hosting',
          metadata: { orderId: order.id, teamId: req.teamId, planId: order.plan_id || '' },
          successUrl: `${process.env.CONTROL_BASE_URL || 'http://localhost:5858'}/order/${order.id}`,
          cancelUrl: `${process.env.CONTROL_BASE_URL || 'http://localhost:5858'}/hosting?checkout=cancelled&order=${order.id}`,
        });
        attachCheckout(order.id, session.sessionId, session.provider);
        await getDb().prepare('UPDATE orders SET checkout_session_id = ? WHERE id = ?').run(session.sessionId, order.id);
        checkoutUrl = session.url;
      } catch (error) {
        addOrderEvent(order.id, 'failed', `payment session error: ${error.message}`);
        throw badRequest(`payment_session_failed: ${error.message}`);
      }
    }
    res.status(created ? 201 : 200).json({
      order: viewOrder(getOrder(order.id, req.teamId)),
      checkoutUrl,
      requiresPayment: order.total > 0,
      providerConfigured: stripeEnabled(),
    });
  }));

  router.get('/', asyncRoute(async (req, res) => {
    const rows = getDb().prepare('SELECT * FROM orders WHERE team_id = ? ORDER BY created_at DESC LIMIT 100').all(req.teamId);
    res.json({ orders: rows.map(viewOrder) });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    res.json({ order: viewOrder(getOrder(req.params.id, req.teamId)) });
  }));

  router.post('/:id/retry', asyncRoute(async (req, res) => {
    const result = retryOrder(req.params.id);
    audit(req, 'order.retry', 'order', req.params.id, {});
    res.json({ order: viewOrder(result.order), instanceId: result.instance?.id || null });
  }));

  router.post('/:id/cancel', asyncRoute(async (req, res) => {
    const order = getOrder(req.params.id, req.teamId);
    if (!['awaiting_payment', 'payment_processing'].includes(order.status)) throw badRequest('order_not_cancellable');
    getDb().prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(Date.now(), order.id);
    addOrderEvent(order.id, 'cancelled', 'Order cancelled by customer');
    res.json({ order: viewOrder(getOrder(order.id, req.teamId)) });
  }));

  // Manual-approval mode: explicit confirmation that no gateway took payment.
  router.post('/:id/confirm-manual', asyncRoute(async (req, res) => {
    if (stripeEnabled()) throw badRequest('payment_provider_configured');
    if (str(req.body?.confirm, 40) !== 'CONFIRM_MANUAL') throw badRequest('confirmation_required');
    const order = getOrder(req.params.id, req.teamId);
    if (order.total > 0) throw badRequest('manual_confirmation_only_for_free_orders');
    const { markOrderPaid } = await import('../orders.js');
    const { provisionOrder } = await import('../provisioning.js');
    const paid = markOrderPaid(order.id, { provider: 'manual', reference: 'free_order' });
    const result = provisionOrder(paid.order.id);
    audit(req, 'order.manual_confirm', 'order', order.id, {});
    res.json({ order: viewOrder(result.order), instanceId: result.instance?.id || null });
  }));

  return router;
}
