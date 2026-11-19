import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAdmin } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, notFound, badRequest, int, str } from '../util.js';

export function adminRoutes() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', asyncRoute(async (req, res) => {
    res.json({ users: getDb().prepare('SELECT id, email, name, role, team_id, status, created_at, last_login FROM users ORDER BY created_at DESC').all() });
  }));

  router.patch('/users/:id', asyncRoute(async (req, res) => {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw notFound();
    const b = req.body || {};
    if (b.role && !['user', 'admin'].includes(b.role)) throw badRequest('invalid_role');
    if (b.status && !['active', 'suspended'].includes(b.status)) throw badRequest('invalid_status');
    getDb().prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(b.role || user.role, b.status || user.status, Date.now(), user.id);
    audit(req, 'admin.user.update', 'user', user.id, b);
    res.json({ user: getDb().prepare('SELECT id, email, name, role, team_id, status, created_at FROM users WHERE id = ?').get(user.id) });
  }));

  router.get('/audit', asyncRoute(async (req, res) => {
    const limit = Math.min(1000, Math.max(1, int(req.query.limit, 200)));
    res.json({ events: getDb().prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) });
  }));

  router.get('/teams', asyncRoute(async (req, res) => {
    res.json({ teams: getDb().prepare('SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, (SELECT COUNT(*) FROM instances i WHERE i.team_id = t.id) AS instances FROM teams t ORDER BY t.created_at DESC').all() });
  }));

  router.patch('/teams/:id/plan', asyncRoute(async (req, res) => {
    const plan = getDb().prepare('SELECT id FROM plans WHERE id = ?').get(str(req.body?.planId));
    if (!plan) throw badRequest('invalid_plan');
    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!team) throw notFound();
    getDb().prepare('UPDATE teams SET plan_id = ?, updated_at = ? WHERE id = ?').run(plan.id, Date.now(), team.id);
    audit(req, 'admin.team.plan', 'team', team.id, { planId: plan.id });
    res.json({ team: getDb().prepare('SELECT * FROM teams WHERE id = ?').get(team.id) });
  }));

  return router;
}
