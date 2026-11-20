// .light — Stripe Connect sample REST API.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncRoute, badRequest, str } from '../util.js';
import * as connect from '../connect.js';

// Preserve Stripe's helpful error messages instead of hiding them behind a 500.
const helpful = (fn) => asyncRoute(async (req, res) => {
  try { return await fn(req, res); }
  catch (error) { throw badRequest(`${error.code || 'stripe_error'}: ${error.message || error}`); }
});

export function connectRoutes() {
  const router = Router();

  // Public configuration/status check (no secret values are returned).
  router.get('/config', helpful(async (req, res) => res.json(connect.connectStatus())));

  // Public storefront: one page per connected account.
  // TODO(dev): use a human-friendly slug instead of the raw acct_ id in URLs.
  router.get('/store/:accountId', helpful(async (req, res) => {
    const products = await connect.listStoreProducts(req.params.accountId);
    res.json({ accountId: req.params.accountId, products });
  }));

  router.post('/store/:accountId/checkout', helpful(async (req, res) => {
    const result = await connect.createStoreCheckout(req.params.accountId, {
      priceId: str(req.body?.priceId, 100), quantity: req.body?.quantity || 1,
    });
    res.json(result);
  }));

  // Everything below acts on the signed-in .light user.
  router.use(requireAuth);

  router.post('/account', helpful(async (req, res) => {
    const result = await connect.createConnectedAccount(req.user.id, {
      email: req.user.email,
      displayName: str(req.body?.displayName || req.user.name || '', 100),
      country: str(req.body?.country || 'us', 2),
    });
    res.json(result);
  }));

  router.post('/account-link', helpful(async (req, res) => {
    res.json(await connect.createAccountLink(req.user.id));
  }));

  // The UI calls this on every load — status ALWAYS comes from Stripe's API.
  router.get('/account', helpful(async (req, res) => {
    res.json(await connect.getAccountStatus(req.user.id));
  }));

  router.post('/products', helpful(async (req, res) => {
    const b = req.body || {};
    if (!str(b.name, 100)) throw badRequest('name_required');
    res.status(201).json(await connect.createProduct(req.user.id, {
      name: b.name, description: str(b.description, 500),
      priceInCents: b.priceInCents, currency: str(b.currency || 'usd', 3),
    }));
  }));

  router.get('/products', helpful(async (req, res) => {
    res.json({ products: await connect.listProducts(req.user.id) });
  }));

  router.post('/checkout-direct', helpful(async (req, res) => {
    const b = req.body || {};
    if (!str(b.priceId, 100)) throw badRequest('priceId_required');
    res.json(await connect.createDirectCheckout(req.user.id, { priceId: b.priceId, quantity: b.quantity || 1 }));
  }));

  router.post('/checkout-subscription', helpful(async (req, res) => {
    res.json(await connect.createSubscriptionCheckout(req.user.id));
  }));

  router.post('/billing-portal', helpful(async (req, res) => {
    res.json(await connect.createBillingPortal(req.user.id));
  }));

  // THIN V2 webhook (account requirement / capability changes).
  router.post('/webhooks/thin', helpful(async (req, res) => {
    const result = await connect.handleThinWebhook(req.rawBody || JSON.stringify(req.body || {}), req.headers['stripe-signature']);
    res.json({ received: true, ...result });
  }));

  // Normal (non-thin) subscription / billing webhook.
  router.post('/webhooks/subscription', helpful(async (req, res) => {
    const result = await connect.handleSubscriptionWebhook(req.rawBody || JSON.stringify(req.body || {}), req.headers['stripe-signature']);
    res.json({ received: true, ...result });
  }));

  return router;
}
