// .light — in-product notifications API.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncRoute, badRequest, forbidden, notFound, str, int } from '../util.js';
import { notifyUsers, notifyTeam, unreadCount, viewNotification, NOTIFICATION_TYPES } from '../notifications.js';
import { audit } from '../audit.js';

export function notificationsRoutes() {
  const router = Router();
  router.use(requireAuth);

  // A user sees notifications addressed to them or broadcast to their team.
  router.get('/', asyncRoute(async (req, res) => {
    const limit = Math.min(300, Math.max(1, int(req.query.limit, 100)));
    const rows = getDb().prepare(`SELECT * FROM notifications
      WHERE user_id = ? OR (user_id IS NULL AND team_id = ?)
      ORDER BY created_at DESC LIMIT ?`).all(req.user.id, req.teamId, limit);
    res.json({ notifications: rows.map(viewNotification), unread: unreadCount(req.user.id) });
  }));

  router.get('/unread', asyncRoute(async (req, res) => {
    res.json({ unread: unreadCount(req.user.id) });
  }));

  router.post('/read-all', asyncRoute(async (req, res) => {
    const r = getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
    res.json({ ok: true, updated: r.changes });
  }));

  router.patch('/:id/read', asyncRoute(async (req, res) => {
    const n = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!n) throw notFound();
    if (n.user_id && n.user_id !== req.user.id && !req.permissions.includes('*')) throw notFound();
    getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(n.id);
    res.json({ notification: viewNotification(getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(n.id)), unread: unreadCount(req.user.id) });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const n = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!n) throw notFound();
    if (n.user_id && n.user_id !== req.user.id && !req.permissions.includes('*')) throw notFound();
    getDb().prepare('DELETE FROM notifications WHERE id = ?').run(n.id);
    res.json({ ok: true });
  }));

  // Administrators (or roles with notifications.write) can broadcast a notice.
  router.post('/', asyncRoute(async (req, res) => {
    const canBroadcast = req.permissions.some((p) => ['*', 'admin.access', 'notifications.write'].includes(p));
    if (!canBroadcast) throw forbidden('permission_required');
    const b = req.body || {};
    const title = str(b.title, 200).trim();
    if (!title) throw badRequest('title_required');
    const payload = { type: NOTIFICATION_TYPES.includes(b.type) ? b.type : 'info', title,
      message: str(b.message, 2000), data: b.data && typeof b.data === 'object' ? b.data : {} };
    let created;
    if (Array.isArray(b.userIds)) created = notifyUsers(b.userIds, payload);
    else if (b.teamId) created = notifyTeam(b.teamId, payload);
    else if (b.broadcast === true) {
      const users = getDb().prepare('SELECT id FROM users WHERE status = ?').all('active').map((u) => u.id);
      created = notifyUsers(users, payload);
    } else throw badRequest('audience_required');
    audit(req, 'admin.notification.create', 'notification', created[0]?.id || '', { title, count: created.length });
    res.status(201).json({ created: created.length, notifications: created.map(viewNotification) });
  }));

  return router;
}
