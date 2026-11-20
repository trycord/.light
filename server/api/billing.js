import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, notFound, conflict, id, now, str, int, json } from '../util.js';
import * as payments from '../payments.js';
import { markOrderPaid, markOrderFailed, addOrderEvent } from '../orders.js';
import { provisionOrder } from '../provisioning.js';

export function billingRoutes() {
  const router = Router();

  router.get('/methods', asyncRoute(async (req, res) => {
    res.json({ providers: payments.enabledProviders(), methods: payments.enabledProviders().map((p) => ({ provider: p, label: p === 'stripe' ? 'Card (Stripe)' : p })) });
  }));

  router.post('/checkout', requireAuth, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const planId = str(b.planId);
    const plan = getDb().prepare('SELECT * FROM plans WHERE id = ? AND status = ?').get(planId, 'published');
    if (!plan) throw badRequest('plan_not_found');
    const interval = b.interval === 'yearly' ? 'yearly' : 'monthly';
    const amount = interval === 'yearly' && plan.price_yearly ? plan.price_yearly : plan.price_monthly;
    if (!amount) {
      // Free plan — activate directly, no payment.
      return res.json({ free: true, message: 'Free plan requires no payment' });
    }
    const csid = id('co');
    getDb().prepare(`INSERT INTO checkout_sessions (id, team_id, plan_id, provider, amount, currency, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(csid, req.teamId, planId, 'stripe', amount, plan.currency || 'USD', JSON.stringify({ interval }), now());
    try {
      const session = await payments.createCheckout({ teamId: req.teamId, amount, currency: plan.currency || 'USD', description: plan.name, metadata: { checkoutId: csid, planId, teamId: req.teamId, interval } });
      getDb().prepare('UPDATE checkout_sessions SET provider_session_id = ? WHERE id = ?').run(session.sessionId, csid);
      audit(req, 'billing.checkout.create', 'checkout', csid, { planId, amount });
      res.json({ checkoutId: csid, provider: session.provider, url: session.url, sessionId: session.sessionId });
    } catch (error) {
      getDb().prepare("UPDATE checkout_sessions SET status = 'failed' WHERE id = ?").run(csid);
      throw badRequest(error.message || 'checkout_failed');
    }
  }));

  router.get('/checkout/:id', requireAuth, asyncRoute(async (req, res) => {
    const cs = getDb().prepare('SELECT * FROM checkout_sessions WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!cs) throw notFound();
    res.json({ checkout: { id: cs.id, planId: cs.plan_id, amount: cs.amount, currency: cs.currency, status: cs.status, createdAt: cs.created_at } });
  }));

  // Stripe webhook — raw body required; mounted before express.json in index.js.
  router.post('/webhook/:provider', asyncRoute(async (req, res) => {
    const provider = req.params.provider;
    const raw = req.rawBody || JSON.stringify(req.body || {});
    const sig = req.headers['stripe-signature'];
    if (!payments.verifyWebhookSignature(provider, raw, sig)) return res.status(400).json({ error: 'invalid_signature' });
    const event = req.body || {};
    const eventId = event.id;
    if (!eventId) return res.status(400).json({ error: 'missing_event_id' });
    if (!payments.recordWebhook(provider, eventId, event.type, event)) return res.json({ received: true, duplicate: true });
    const db = getDb();
    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      // Orders are the authoritative purchase record. Verify the provider's
      // paid status and amount before doing anything irreversible.
      const orderId = s.metadata?.orderId;
      if (orderId) {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (order && !['active', 'refunded', 'terminated', 'cancelled'].includes(order.status)) {
          if (s.payment_status !== 'paid') {
            addOrderEvent(order.id, 'payment_processing', 'Provider has not confirmed payment');
          } else if (Number(s.amount_total || 0) !== Number(order.total) || String(s.currency || '').toLowerCase() !== String(order.currency || '').toLowerCase()) {
            markOrderFailed(order.id, 'payment_amount_mismatch');
          } else {
            try {
              const paid = markOrderPaid(order.id, { provider, reference: s.payment_intent || s.id });
              if (!paid.alreadyPaid) provisionOrder(paid.order.id);
            } catch (error) { console.error('[checkout] provisioning failed:', error); }
          }
        }
      }
      const cid = s.metadata?.checkoutId;
      const planId = s.metadata?.planId;
      const teamId = s.metadata?.teamId;
      const cs = cid ? db.prepare('SELECT * FROM checkout_sessions WHERE id = ?').get(cid) : null;
      if (cs && cs.status !== 'paid') {
        db.transaction(() => {
          db.prepare("UPDATE checkout_sessions SET status = 'paid' WHERE id = ?").run(cs.id);
          db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE team_id = ? AND status = 'active'").run(now(), now(), teamId);
          const sid = id('sub');
          db.prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, price_monthly, currency, started_at, created_at, updated_at)
            VALUES (?, ?, ?, 'active', 'payment', ?, ?, ?, ?, ?)`).run(sid, teamId, planId, cs.amount, cs.currency, now(), now(), now());
          db.prepare(`INSERT INTO transactions (id, team_id, subscription_id, type, description, amount, currency, status, provider, reference, created_at)
            VALUES (?, ?, ?, 'charge', ?, ?, ?, 'paid', ?, ?, ?)`).run(id('txn'), teamId, sid, `Payment for ${planId}`, cs.amount, cs.currency, provider, s.payment_intent || s.id, now());
          const invNum = `INV-${Date.now().toString(36).toUpperCase()}`;
          db.prepare(`INSERT INTO invoices (id, team_id, subscription_id, number, amount, currency, status, provider, provider_ref, issued_at, paid_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`).run(id('inv'), teamId, sid, invNum, cs.amount, cs.currency, provider, s.payment_intent || s.id, now(), now(), now());
        })();
      }
    } else if (event.type === 'charge.refunded') {
      const c = event.data?.object || {};
      db.prepare("UPDATE transactions SET status = 'refunded' WHERE reference = ?").run(c.payment_intent || c.id);
    }
    res.json({ received: true });
  }));

  router.get('/invoices', requireAuth, asyncRoute(async (req, res) => {
    res.json({ invoices: getDb().prepare('SELECT * FROM invoices WHERE team_id = ? ORDER BY issued_at DESC').all(req.teamId) });
  }));

  router.get('/checkouts', requireAuth, asyncRoute(async (req, res) => {
    res.json({ checkouts: getDb().prepare('SELECT id, plan_id, amount, currency, status, created_at FROM checkout_sessions WHERE team_id = ? ORDER BY created_at DESC').all(req.teamId) });
  }));

  // Admin: refund a transaction.
  router.post('/refund/:txnId', requireAdmin, asyncRoute(async (req, res) => {
    const tx = getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!tx) throw notFound();
    if (tx.status !== 'paid') throw badRequest('transaction_not_paid');
    const refund = await payments.createRefund(tx.reference, tx.amount);
    getDb().prepare("UPDATE transactions SET status = 'refunded' WHERE id = ?").run(tx.id);
    audit(req, 'billing.refund', 'transaction', tx.id, { amount: tx.amount });
    res.json({ ok: true, refundId: refund.id });
  }));

  router.get('/admin/summary', requireAdmin, asyncRoute(async (req, res) => {
    const db = getDb();
    const gross = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE status = 'paid'").get().s;
    const refunds = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE status = 'refunded'").get().s;
    const paymentsCount = db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE status = 'paid'").get().c;
    res.json({ gross, refunds, net: gross - refunds, payments: paymentsCount, providers: payments.enabledProviders() });
  }));

  return router;
}
