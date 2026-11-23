import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncRoute, badRequest, str } from '../util.js';
import { audit } from '../audit.js';
import * as credits from '../credits.js';
import { getDb } from '../db.js';
import { id, now } from '../util.js';

export function creditsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    res.json({ ...credits.view(req.teamId), offers: credits.offers(req.teamId, req.user.id), history: credits.history(req.teamId) });
  }));

  router.post('/offers/:id/complete', asyncRoute(async (req, res) => {
    const result = credits.completeOffer(req.params.id, req.teamId, req.user.id);
    audit(req, 'credits.offer.complete', 'credits', req.params.id, { reward: result.reward });
    res.json(result);
  }));

  // Friends are .light users — adding one is a small profile offer.
  router.get('/friends', asyncRoute(async (req, res) => {
    res.json({ friends: getDb().prepare('SELECT id, friend_email, status, created_at FROM friendships WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) });
  }));

  router.post('/friends', asyncRoute(async (req, res) => {
    const email = str(req.body?.email, 200).trim().toLowerCase();
    if (!email || !email.includes('@')) throw badRequest('Please enter a valid email address.');
    const exists = getDb().prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!exists) throw badRequest('That email is not registered on .light yet.');
    if (email === req.user.email) throw badRequest('You cannot add yourself as a friend.');
    getDb().prepare('INSERT OR IGNORE INTO friendships (id, user_id, friend_email, status, created_at) VALUES (?,?,?,?,?)')
      .run(id('fr'), req.user.id, email, 'active', now());
    res.json({ ok: true, friend: email });
  }));

  router.delete('/friends/:id', asyncRoute(async (req, res) => {
    getDb().prepare('DELETE FROM friendships WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  return router;
}

export function adminCreditsRoutes() {
  const router = Router();
  router.get('/', requireAdmin, asyncRoute(async (req, res) => {
    res.json({
      accounts: getDb().prepare('SELECT * FROM credit_accounts ORDER BY balance DESC LIMIT 200').all(),
      recent: getDb().prepare('SELECT * FROM credit_transactions ORDER BY created_at DESC LIMIT 200').all(),
      offers: credits.OFFERS,
    });
  }));
  return router;
}
