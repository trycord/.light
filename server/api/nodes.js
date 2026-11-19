import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { asyncRoute, badRequest, notFound, id, now, str, int } from '../util.js';

export function nodesRoutes() {
  const router = Router();

  router.get('/', requireAuth, asyncRoute(async (req, res) => {
    const rows = getDb().prepare(`
      SELECT n.*, (SELECT COUNT(*) FROM instances i WHERE i.node_id = n.id AND i.status IN ('running','creating','deploying')) AS workload_count
      FROM nodes n ORDER BY n.name
    `).all();
    const isAdmin = req.user.role === 'admin';
    res.json({ nodes: rows.map((n) => isAdmin ? n : publicNode(n)) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name).trim();
    const host = str(b.host).trim();
    if (!name || !host) throw badRequest('name_and_host_required');
    const nid = id('node');
    const token = b.token ? str(b.token, 200) : `n_${id('tok')}`;
    const ts = now();
    getDb().prepare(`INSERT INTO nodes (id, token, name, host, region, version, status, cpu_cores, memory_mb, disk_gb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(nid, token, name, host, str(b.region || 'local', 80), '1.0.0', 'offline', Math.min(256, Math.max(1, int(b.cpuCores, 4))), Math.min(1048576, Math.max(512, int(b.memoryMb, 8192))), Math.min(100000, Math.max(1, int(b.diskGb, 100))), ts, ts);
    res.status(201).json({ node: getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(nid), token });
  }));

  router.patch('/:id', asyncRoute(async (req, res) => {
    const node = getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
    if (!node) throw notFound();
    const b = req.body || {};
    const updates = []; const values = [];
    for (const key of ['name', 'host', 'region', 'availability']) {
      if (b[key] !== undefined) { updates.push(`${key} = ?`); values.push(str(b[key], 200)); }
    }
    for (const key of ['cpuCores', 'memoryMb', 'diskGb']) {
      if (b[key] !== undefined) { const column = key === 'cpuCores' ? 'cpu_cores' : key === 'memoryMb' ? 'memory_mb' : 'disk_gb'; updates.push(`${column} = ?`); values.push(int(b[key], 1)); }
    }
    if (updates.length) { updates.push('updated_at = ?'); values.push(now()); getDb().prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...values, node.id); }
    res.json({ node: getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(node.id) });
  }));

  router.post('/:id/drain', asyncRoute(async (req, res) => {
    const node = getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
    if (!node) throw notFound();
    getDb().prepare("UPDATE nodes SET availability = 'draining', updated_at = ? WHERE id = ?").run(now(), node.id);
    res.json({ ok: true });
  }));

  router.post('/:id/token', asyncRoute(async (req, res) => {
    const node = getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
    if (!node) throw notFound();
    const token = `n_${id('tok')}`;
    getDb().prepare('UPDATE nodes SET token = ?, updated_at = ? WHERE id = ?').run(token, now(), node.id);
    res.json({ token });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const node = getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
    if (!node) throw notFound();
    const assigned = getDb().prepare('SELECT COUNT(*) AS count FROM instances WHERE node_id = ?').get(node.id).count;
    if (assigned > 0) throw badRequest('node_has_instances');
    getDb().prepare('DELETE FROM metric_samples WHERE node_id = ?').run(node.id);
    getDb().prepare('DELETE FROM node_commands WHERE node_id = ?').run(node.id);
    getDb().prepare('DELETE FROM nodes WHERE id = ?').run(node.id);
    res.json({ ok: true });
  }));

  router.get('/:id/metrics', requireAuth, asyncRoute(async (req, res) => {
    const node = getDb().prepare('SELECT id FROM nodes WHERE id = ?').get(req.params.id);
    if (!node) throw notFound();
    const range = Math.min(1440, Math.max(1, int(req.query.range, 60)));
    const metrics = getDb().prepare('SELECT ts, cpu, mem, disk, net_in, net_out, temp FROM metric_samples WHERE node_id = ? AND instance_id IS NULL AND ts > ? ORDER BY ts ASC').all(node.id, now() - range * 60000);
    res.json({ metrics });
  }));

  return router;
}

function publicNode(n) {
  const { token, ...rest } = n;
  return rest;
}
