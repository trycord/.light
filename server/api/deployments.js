import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncRoute, notFound, str } from '../util.js';

export function deploymentsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const rows = req.user.role === 'admin' && req.query.all === 'true'
      ? getDb().prepare('SELECT d.*, i.name AS instance_name FROM deployments d JOIN instances i ON i.id = d.instance_id ORDER BY d.id DESC LIMIT 200').all()
      : getDb().prepare('SELECT d.*, i.name AS instance_name FROM deployments d JOIN instances i ON i.id = d.instance_id WHERE d.team_id = ? ORDER BY d.id DESC LIMIT 200').all(req.teamId);
    res.json({ deployments: rows.map(view) });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id);
    if (!row || (row.team_id !== req.teamId && req.user.role !== 'admin')) throw notFound();
    res.json({ deployment: view(row) });
  }));

  return router;
}

function view(row) {
  return { id: row.id, instanceId: row.instance_id, teamId: row.team_id, status: row.status, version: row.version, source: row.source, repoUrl: row.repo_url, ref: row.ref, commitSha: row.commit_sha, command: row.command, createdAt: row.created_at, finishedAt: row.finished_at };
}
