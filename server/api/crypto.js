import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncRoute, badRequest, str, int } from '../util.js';
import { audit } from '../audit.js';
import { getDb } from '../db.js';
import { get } from '../settings.js';
import * as crypto from '../crypto-payments.js';

export function cryptoRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/status', asyncRoute(async (req, res) => {
    const c = crypto.config();
    res.json({ enabled: c.enabled, network: c.network, token: c.token, wallet: c.wallet, note: 'Decentralized on-chain payments — no KYC.' });
  }));

  router.get('/payments', asyncRoute(async (req, res) => {
    res.json({ payments: crypto.history(req.teamId) });
  }));

  // Subscribe with crypto: create a recurring-reference payment for the plan.
  router.post('/subscribe', asyncRoute(async (req, res) => {
    const planId = str(req.body?.planId, 100);
    const interval = req.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    const plan = getDb().prepare("SELECT * FROM plans WHERE id = ? AND status='published'").get(planId);
    if (!plan) throw badRequest('Plan not found.');
    const amount = interval === 'yearly' ? (plan.price_yearly || plan.price_monthly) : plan.price_monthly;
    if (!amount) return res.json({ free: true, message: 'This plan is free.' });
    const pay = crypto.createPayment({ teamId: req.teamId, userId: req.user.id,
      kind: 'subscription', referenceId: planId, amountCents: amount });
    getDb().prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, price_monthly, currency, started_at, created_at, updated_at)
      VALUES (?, ?, ?, 'awaiting_payment', 'crypto', ?, ?, ?, ?, ?)`)
      .run(id('sub'), req.teamId, planId, amount, plan.currency || 'USD', now(), now(), now());
    audit(req, 'crypto.subscribe', 'subscription', planId, { amount, interval });
    res.status(201).json({ payment: pay, subscriptionPlan: planId, interval });
  }));

  return router;
}

export function adminCryptoRoutes() {
  const router = Router();
  router.get('/', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ payments: getDb().prepare('SELECT * FROM crypto_payments ORDER BY created_at DESC LIMIT 200').all(), config: crypto.config() });
  }));
  return router;
}
