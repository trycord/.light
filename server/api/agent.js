import { Router } from 'express';
import { getDb } from '../db.js';
import { requireNode } from '../auth.js';
import { pendingCommands, completeCommand, claimCommand, recoverStaleCommands, renewCommand } from '../commands.js';
import { asyncRoute, str, num, int, now } from '../util.js';
import { setAgentHealth } from '../health.js';
import { handleProvisionResult } from '../provisioning.js';

export function agentRoutes() {
  const router = Router();
  router.use(requireNode);

  router.post('/commands/:id/ack', asyncRoute(async (req, res) => {
    const claimed = claimCommand(req.params.id, req.node.id);
    res.json({ ok: claimed });
  }));

  router.post('/commands/:id/renew', asyncRoute(async (req, res) => {
    res.json({ ok: renewCommand(req.params.id, req.node.id) });
  }));

  router.post('/health', asyncRoute(async (req, res) => {
    setAgentHealth(req.body?.ok !== false);
    res.json({ ok: true });
  }));

  router.get('/instances', asyncRoute(async (req, res) => {
    const rows = getDb().prepare('SELECT id, status, node_id FROM instances WHERE node_id = ?').all(req.node.id);
    res.json({ instances: rows });
  }));

  router.post('/heartbeat', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const db = getDb();
    const ts = now();
    recoverStaleCommands(req.node.id);
    db.prepare(`UPDATE nodes SET status = 'online', version = ?, cpu_cores = ?, memory_mb = ?, disk_gb = ?, cpu_used = ?, mem_used = ?, disk_used = ?, net_in = ?, net_out = ?, temp = ?, last_heartbeat = ?, updated_at = ? WHERE id = ?`)
      .run(str(b.version || req.node.version, 60), int(b.cpuCores, req.node.cpu_cores), int(b.memoryMb, req.node.memory_mb), int(b.diskGb, req.node.disk_gb),
        num(b.cpu), num(b.mem), num(b.disk), num(b.netIn), num(b.netOut), num(b.temp), ts, ts, req.node.id);
    insertSample(req.node.id, null, b, ts);
    prune();
    res.json({ ok: true, nodeId: req.node.id, serverTime: ts });
  }));

  router.get('/commands', asyncRoute(async (req, res) => {
    const commands = pendingCommands(req.node.id).map((c) => ({ id: c.id, instanceId: c.instance_id, type: c.type, payload: parse(c.payload) }));
    res.json({ commands });
  }));

  router.post('/commands/:id/result', asyncRoute(async (req, res) => {
    const command = getDb().prepare('SELECT * FROM node_commands WHERE id = ? AND node_id = ?').get(req.params.id, req.node.id);
    if (!command) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const ok = b.ok !== false;
    completeCommand(command.id, ok ? 'done' : 'failed', b.result ?? b.error ?? {});
    if (command.type === 'instance.create' || command.type === 'instance.reprovision') {
      try { handleProvisionResult(command, ok, b.result || {}); } catch (error) { console.error('[provision] result handling failed:', error); }
    }
    if (!command.instance_id) return res.json({ ok: true });
    const result = b.result || {};
    let status = b.status;
    if (!status) {
      if (command.type === 'instance.create' || command.type === 'instance.reprovision') status = ok ? 'running' : 'error';
      else if (!ok) status = 'error';
    }
    const sets = [];
    const values = [];
    if (status) { sets.push('status = ?'); values.push(str(status, 40)); }
    if (command.type === 'instance.create' && ok) {
      if (result.containerId) { sets.push('container_id = ?'); values.push(str(result.containerId, 200)); }
      // Docker allocates ephemeral host ports at start time — store the real
      // mapping so the panel shows where a service is actually reachable.
      if (Array.isArray(result.ports) && result.ports.length) {
        const row = getDb().prepare('SELECT ports_json FROM instances WHERE id = ?').get(command.instance_id);
        let configured = [];
        try { configured = JSON.parse(row?.ports_json || '[]'); } catch { configured = []; }
        sets.push('ports_json = ?'); values.push(JSON.stringify(mergeAssignedPorts(configured, result.ports)));
      }
    }
    if (sets.length) {
      sets.push('updated_at = ?'); values.push(now(), command.instance_id);
      getDb().prepare(`UPDATE instances SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    res.json({ ok: true });
  }));

  // Shade reports real container state periodically and after restarts.
  router.post('/instances/health', asyncRoute(async (req, res) => {
    const reports = Array.isArray(req.body?.instances) ? req.body.instances.slice(0, 500) : [];
    const db = getDb();
    let updated = 0;
    for (const r of reports) {
      const iid = str(r?.instanceId, 100);
      if (!iid) continue;
      const instance = db.prepare('SELECT id, node_id, status FROM instances WHERE id = ?').get(iid);
      if (!instance || instance.node_id !== req.node.id) continue;
      const health = str(r.health, 40) || 'unknown';
      // pending / deploying / suspended / error are control-plane intent states.
      // Agent reports must never overwrite them — only the observed health.
      const intent = ['pending', 'deploying', 'suspended', 'error'].includes(instance.status);
      if (intent) {
        db.prepare('UPDATE instances SET health_status = ? WHERE id = ?').run(health, iid);
      } else {
        const status = str(r.status, 40) || 'stopped';
        db.prepare('UPDATE instances SET status = ?, health_status = ?, updated_at = ? WHERE id = ?')
          .run(status, health, now(), iid);
      }
      updated++;
    }
    res.json({ ok: true, updated });
  }));

  router.post('/logs', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const instanceId = str(b.instanceId, 100);
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
    if (!instanceId) return res.status(400).json({ error: 'instanceId_required' });
    const instance = getDb().prepare('SELECT team_id FROM instances WHERE id = ? AND node_id = ?').get(instanceId, req.node.id);
    if (!instance) return res.status(404).json({ error: 'not_found' });
    const stmt = getDb().prepare('INSERT INTO logs (instance_id, team_id, ts, stream, line) VALUES (?, ?, ?, ?, ?)');
    const ts = now();
    getDb().transaction(() => {
      for (const line of lines) stmt.run(instanceId, instance.team_id, num(line.ts, ts), str(line.stream || 'stdout', 20), str(line.line, 4000));
    })();
    pruneLogs();
    res.json({ ok: true });
  }));

  router.post('/metrics', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const ts = now();
    const instanceId = str(b.instanceId, 100);
    const owned = instanceId ? getDb().prepare('SELECT id FROM instances WHERE id = ? AND node_id = ?').get(instanceId, req.node.id) : null;
    insertSample(req.node.id, owned ? instanceId : null, b, ts);
    if (owned && b.status) getDb().prepare('UPDATE instances SET status = ?, updated_at = ? WHERE id = ?').run(str(b.status, 40), ts, instanceId);
    prune();
    res.json({ ok: true });
  }));

  return router;
}

function insertSample(nodeId, instanceId, b, ts) {
  getDb().prepare('INSERT INTO metric_samples (node_id, instance_id, ts, cpu, mem, disk, net_in, net_out, temp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nodeId, instanceId, ts, num(b.cpu), num(b.mem), num(b.disk), num(b.netIn ?? b.net_in), num(b.netOut ?? b.net_out), num(b.temp));
}
function prune() {
  getDb().prepare('DELETE FROM metric_samples WHERE ts < ?').run(now() - 6 * 60 * 60 * 1000);
}
function pruneLogs() {
  getDb().prepare('DELETE FROM logs WHERE ts < ?').run(now() - 24 * 60 * 60 * 1000);
}
function parse(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

/** Merge Docker-assigned host ports into the configured port list. */
export function mergeAssignedPorts(configured = [], assigned = []) {
  const byKey = new Map((Array.isArray(assigned) ? assigned : [])
    .map((p) => [`${p.container}/${p.protocol || 'tcp'}`, Number(p.host) || 0]));
  return (Array.isArray(configured) ? configured : []).map((p) => {
    const host = byKey.get(`${p.container}/${p.protocol || 'tcp'}`);
    return host === undefined ? p : { ...p, host };
  });
}
