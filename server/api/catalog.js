import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncRoute } from '../util.js';

export function catalogRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/templates', asyncRoute(async (req, res) => {
    res.json({ templates: getDb().prepare('SELECT * FROM templates ORDER BY category, name').all().map((t) => ({
      id: t.id, name: t.name, category: t.category, image: t.image, description: t.description,
      versions: JSON.parse(t.versions || '[]'), command: t.command, ports: JSON.parse(t.ports || '[]'), env: JSON.parse(t.env || '{}'),
    })) });
  }));

  router.get('/plans', asyncRoute(async (req, res) => {
    res.json({ plans: getDb().prepare('SELECT * FROM plans ORDER BY price_monthly').all() });
  }));

  return router;
}
