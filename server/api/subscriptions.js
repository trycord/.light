import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, notFound, conflict, id, now, str, int } from '../util.js';
import { pricingConfig, calculatePrice, validateResources, getPlan, publicPlan, planPrice } from '../pricing.js';

export function subscriptionsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/current', asyncRoute(async (req, res) => {
    let sub = getDb().prepare('SELECT * FROM subscriptions WHERE team_id = ? ORDER BY created_at DESC LIMIT 1').get(req.teamId);
    if (!sub) {
      const ts = now();
      const sid = id('sub');
      getDb().prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, price_monthly, currency, started_at, created_at, updated_at) VALUES (?, ?, 'free', 'active', 'preset', 0, 'USD', ?, ?, ?)`).run(sid, req.teamId, ts, ts, ts);
      sub = getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(sid);
    }
    const plan = sub.plan_id ? getDb().prepare('SELECT * FROM plans WHERE id = ?').get(sub.plan_id) : null;
    res.json({ subscription: view(sub), plan: plan ? publicPlan(plan) : null, customConfig: parse(sub.custom_config, {}) });
  }));

  router.post('/activate', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const current = getDb().prepare('SELECT * FROM subscriptions WHERE team_id = ? ORDER BY created_at DESC LIMIT 1').get(req.teamId);
    if (current && current.status === 'active' && current.plan_id === b.planId) throw conflict('plan_already_active');

    let planId = null, source = 'preset', configData = {}, price = 0, currency = 'USD';
    if (b.planId) {
      const plan = getPlan(b.planId);
      if (!plan.available || plan.status !== 'published') throw badRequest('plan_unavailable');
      planId = plan.id; price = planPrice(plan, b.interval || 'monthly'); currency = plan.currency || 'USD';
    } else if (b.custom) {
      const cfg = pricingConfig();
      const resources = validateResources(cfg, b.custom);
      const estimate = calculatePrice(cfg, resources, b.interval || 'monthly');
      planId = null; source = 'custom'; configData = resources; price = estimate.total; currency = estimate.currency;
    } else throw badRequest('plan_or_custom_required');

    // Payment is not configured — activation is administrator-approved manual mode.
    // We never pretend a payment occurred; record a pending transaction.
    const ts = now();
    const sid = id('sub');
    const txid = id('txn');
    getDb().transaction(() => {
      if (current) getDb().prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, current.id);
      getDb().prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, custom_config, price_monthly, currency, started_at, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`).run(sid, req.teamId, planId, source, JSON.stringify(configData), price, currency, ts, ts, ts);
      // Team quota is driven by plan; for custom, store config in subscription and apply via planFor.
      getDb().prepare(`INSERT INTO transactions (id, team_id, subscription_id, type, description, amount, currency, status, provider, reference, created_at)
        VALUES (?, ?, ?, 'activation', ?, ?, ?, 'manual', 'none', ?, ?)`).run(txid, req.teamId, sid, planId ? `Plan activation: ${planId}` : 'Custom plan activation', price, currency, sid, ts);
    })();
    audit(req, 'subscription.activate', 'subscription', sid, { planId, source, price });
    res.status(201).json({ subscription: view(getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(sid)), requiresManualApproval: !process.env.PAYMENT_PROVIDER });
  }));

  router.post('/cancel', asyncRoute(async (req, res) => {
    const sub = getDb().prepare('SELECT * FROM subscriptions WHERE team_id = ? ORDER BY created_at DESC LIMIT 1').get(req.teamId);
    if (!sub) throw notFound();
    getDb().prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), sub.id);
    audit(req, 'subscription.cancel', 'subscription', sub.id, {});
    res.json({ ok: true });
  }));

  router.get('/history', asyncRoute(async (req, res) => {
    res.json({ transactions: getDb().prepare('SELECT * FROM transactions WHERE team_id = ? ORDER BY created_at DESC LIMIT 200').all(req.teamId).map((t) => ({
      id: t.id, type: t.type, description: t.description, amount: t.amount, currency: t.currency,
      status: t.status, provider: t.provider, reference: t.reference, createdAt: t.created_at,
    })) });
  }));

  return router;
}

function view(s) {
  return { id: s.id, teamId: s.team_id, planId: s.plan_id, status: s.status, source: s.source, priceMonthly: s.price_monthly, currency: s.currency, startedAt: s.started_at, renewsAt: s.renews_at, cancelledAt: s.cancelled_at };
}
function parse(v, f) { try { return JSON.parse(v || ''); } catch { return f; } }
