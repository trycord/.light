import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { dispatch } from '../commands.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, notFound, id, now, str } from '../util.js';
import { cronMatches } from '../util.js';

export function schedulesRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    res.json({ schedules: getDb().prepare('SELECT s.*, i.name AS instance_name FROM schedules s JOIN instances i ON i.id = s.instance_id WHERE s.team_id = ? ORDER BY s.created_at DESC').all(req.teamId) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const instance = getDb().prepare('SELECT * FROM instances WHERE id = ? AND team_id = ?').get(str(b.instanceId), req.teamId);
    if (!instance) throw notFound('instance_not_found');
    if (!['start','stop','restart','backup','deploy'].includes(b.action)) throw badRequest('invalid_action');
    if (!cronMatches(b.cron, new Date()) && !/^[\d*/,\-\s]+$/.test(str(b.cron))) throw badRequest('invalid_cron');
    const sid = id('sch');
    getDb().prepare('INSERT INTO schedules (id, instance_id, team_id, name, action, cron, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sid, instance.id, req.teamId, str(b.name || `${b.action} schedule`, 100), b.action, str(b.cron, 100), b.enabled === false ? 0 : 1, now());
    res.status(201).json({ schedule: getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(sid) });
  }));

  router.patch('/:id', asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM schedules WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!row) throw notFound();
    const b = req.body || {};
    const enabled = b.enabled === undefined ? row.enabled : (b.enabled ? 1 : 0);
    getDb().prepare('UPDATE schedules SET enabled = ?, cron = ?, name = ? WHERE id = ?').run(enabled, str(b.cron || row.cron, 100), str(b.name || row.name, 100), row.id);
    res.json({ schedule: getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(row.id) });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM schedules WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!row) throw notFound();
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(row.id);
    res.json({ ok: true });
  }));

  return router;
}

export function runSchedules() {
  const db = getDb();
  const due = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all().filter((s) => cronMatches(s.cron, new Date()));
  for (const schedule of due) {
    const last = schedule.last_run || 0;
    if (now() - last < 60000) continue;
    db.prepare('UPDATE schedules SET last_run = ? WHERE id = ?').run(now(), schedule.id);
    const instance = db.prepare('SELECT * FROM instances WHERE id = ?').get(schedule.instance_id);
    if (!instance || !instance.node_id) continue;
    const typeMap = { start: 'instance.start', stop: 'instance.stop', restart: 'instance.restart' };
    if (typeMap[schedule.action]) {
      dispatch(instance.node_id, typeMap[schedule.action], { instanceId: instance.id }, instance.id).catch(() => {});
    } else if (schedule.action === 'backup') {
      const backupId = id('bak');
      db.prepare('INSERT INTO backups (id, instance_id, team_id, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(backupId, instance.id, instance.team_id, `Scheduled ${new Date().toISOString()}`, 'pending', now());
      dispatch(instance.node_id, 'instance.backup', { instanceId: instance.id, backupId }, instance.id)
        .then((result) => db.prepare("UPDATE backups SET status = 'ready', location = ?, size_bytes = ?, finished_at = ? WHERE id = ?")
          .run(String(result.location || ''), Number(result.sizeBytes) || 0, now(), backupId))
        .catch(() => db.prepare("UPDATE backups SET status = 'failed' WHERE id = ?").run(backupId));
    }
  }
}
