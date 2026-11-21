import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncRoute, notFound, int } from '../util.js';

export function backupsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, int(req.query.limit, 100)));
    const rows = getDb().prepare('SELECT b.*, i.name AS instance_name FROM backups b JOIN instances i ON i.id = b.instance_id WHERE b.team_id = ? ORDER BY b.created_at DESC LIMIT ?').all(req.teamId, limit);
    res.json({ backups: rows.map((b) => ({ id: b.id, instanceId: b.instance_id, instanceName: b.instance_name,
      name: b.name, status: b.status, sizeBytes: b.size_bytes, createdAt: b.created_at, finishedAt: b.finished_at })) });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM backups WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!row) throw notFound();
    getDb().prepare('DELETE FROM backups WHERE id = ?').run(row.id);
    res.json({ ok: true });
  }));

  return router;
}
