import { Router } from 'express';
import { getDb } from '../db.js';
import config from '../config.js';
import { requireAuth } from '../auth.js';
import { dispatch, queueCommand } from '../commands.js';
import { audit } from '../audit.js';
import { checkQuota, teamUsage, planFor } from '../plans.js';
import { resolveRuntime } from '../runtime-catalog.js';
import { provisionTunnel, isCloudflareConfigured } from '../cloudflare.js';
import { asyncRoute, badRequest, notFound, forbidden, conflict, id, now, json, str, int, num } from '../util.js';

const CATEGORIES = ['game', 'web', 'app', 'database'];
const STATUSES = ['pending', 'creating', 'running', 'stopped', 'deploying', 'error', 'suspended'];

export function instancesRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    const db = getDb();
    const admin = req.user.role === 'admin';
    const rows = admin && req.query.all === 'true'
      ? db.prepare('SELECT i.*, n.name AS node_name, t.name AS team_name FROM instances i LEFT JOIN nodes n ON n.id = i.node_id LEFT JOIN teams t ON t.id = i.team_id ORDER BY i.created_at DESC').all()
      : db.prepare('SELECT i.*, n.name AS node_name FROM instances i LEFT JOIN nodes n ON n.id = i.node_id WHERE i.team_id = ? ORDER BY i.created_at DESC').all(req.teamId);
    res.json({ instances: rows.map(view) });
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    res.json({ instance: view(row) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name).trim();
    if (!name) throw badRequest('name_required');
    const category = CATEGORIES.includes(b.category) ? b.category : 'web';
    // Runtime + version are resolved against the approved catalogue. The client
    // never chooses an OS or an arbitrary image; Debian is fixed.
    const runtime = resolveRuntime(getDb(), {
      environmentId: b.environmentId || b.runtimeId,
      version: b.version || b.runtimeVersion,
      image: b.image,
    });
    const image = runtime.imageRef;
    // Resources are granted by the plan, never chosen by the customer.
    // A single service may use the whole allowance; quota blocks a second one.
    const plan = planFor(req.teamId);
    const cpu = Math.max(1, int(plan.cpu_cores, 1));
    const memory = Math.max(128, int(plan.memory_mb, 512));
    const disk = Math.max(1, int(plan.disk_gb, 4));
    checkQuota(req.teamId, memory, disk);

    // Assign any registered node (online or not). Creation is queued and the
    // integrated/remote agent provisions it asynchronously — users never wait
    // on infrastructure and no admin action is required.
    const node = pickNode(b.nodeId);
    if (!node) throw conflict('no_node_available');
    const iid = id('ins');
    const ts = now();
    const ports = normalizePorts(b.ports);
    const volumes = normalizeVolumes(b.volumes);
    const command = str(b.command || runtime.command, 1000);
    const env = { ...sanitizeEnv(b.env), ...(runtime.runtimeEnv || {}) };
    getDb().prepare(`
      INSERT INTO instances (id, team_id, node_id, name, category, type, status, image, command, version, env_json, ports_json, volumes_json, cpu_cores, memory_mb, disk_gb, environment_id, environment_version, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(iid, req.teamId, node.id, name, category, str(b.game || b.type || runtime.environmentName, 80), 'pending', image,
      command, runtime.version, JSON.stringify(env), JSON.stringify(ports), JSON.stringify(volumes),
      cpu, memory, disk, runtime.environmentId, runtime.version, 'environment', ts, ts);

    queueCommand(node.id, 'instance.create', {
      instanceId: iid, teamId: req.teamId, name, image, command, env,
      ports, volumes, cpu, memory, disk, version: runtime.version,
      environmentId: runtime.environmentId, environmentVersion: runtime.version,
      digest: runtime.digest, runtimeEnv: runtime.runtimeEnv || {}, workingDir: runtime.workingDir,
    }, iid);

    // Every instance gets a free public project subdomain on the universal domain.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'app';
    const subdomain = `${slug}-${iid.slice(-6)}.${config.platformDomain}`;
    const domainId = id('dom');
    getDb().prepare("INSERT OR IGNORE INTO domains (id, team_id, instance_id, domain, verified, ssl_status, created_at) VALUES (?, ?, ?, ?, 1, 'active', ?)")
      .run(domainId, req.teamId, iid, subdomain, ts);
    const domainRow = getDb().prepare('SELECT * FROM domains WHERE id = ?').get(domainId);
    if (domainRow && isCloudflareConfigured()) {
      provisionTunnel(domainRow, req).catch((error) => {
        getDb().prepare('UPDATE domains SET tunnel_status = ?, updated_at = ? WHERE id = ?')
          .run(`failed: ${error.message.slice(0, 120)}`, now(), domainId);
      });
    } else if (domainRow) {
      getDb().prepare("UPDATE domains SET tunnel_status = 'configuration_required', updated_at = ? WHERE id = ?").run(now(), domainId);
    }

    audit(req, 'instance.create', 'instance', iid, { name, image, node: node.id });
    res.status(201).json({ instance: view(getDb().prepare('SELECT i.*, n.name AS node_name FROM instances i LEFT JOIN nodes n ON n.id = i.node_id WHERE i.id = ?').get(iid)) });
  }));

  router.patch('/:id', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const b = req.body || {};
    const updates = [];
    const values = [];
    for (const key of ['name', 'command', 'category', 'type']) {
      if (b[key] !== undefined) {
        if (key === 'category' && !CATEGORIES.includes(b[key])) throw badRequest('invalid_category');
        updates.push(`${key} = ?`); values.push(str(b[key], key === 'command' ? 1000 : 200));
      }
    }
    if (b.env !== undefined) { updates.push('env_json = ?'); values.push(JSON.stringify(sanitizeEnv(b.env))); }
    if (b.ports !== undefined) { updates.push('ports_json = ?'); values.push(JSON.stringify(normalizePorts(b.ports))); }
    // CPU / RAM / disk are plan-granted and cannot be raised by the customer.
    if (!updates.length) throw badRequest('nothing_to_update');
    updates.push('updated_at = ?'); values.push(now()); values.push(row.id);
    getDb().prepare(`UPDATE instances SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    audit(req, 'instance.update', 'instance', row.id, b);
    const updated = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(row.id);
    res.json({ instance: view(updated), restartRequired: ['command','env','ports'].some((k) => b[k] !== undefined) });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    if (row.node_id) {
      try { await dispatch(row.node_id, 'instance.remove', { instanceId: row.id }, row.id); } catch { /* best effort */ }
    }
    const db = getDb();
    db.transaction(() => {
      for (const table of ['deployments','logs','metric_samples','backups','schedules','domains','node_commands']) {
        const col = table === 'node_commands' ? 'instance_id' : 'instance_id';
        try { db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(row.id); } catch { /* table may not have column */ }
      }
      db.prepare('DELETE FROM instances WHERE id = ?').run(row.id);
    })();
    audit(req, 'instance.delete', 'instance', row.id, { name: row.name });
    res.json({ ok: true });
  }));

  // Re-provision an existing service. Idempotent: Shade removes any stale
  // container before creating a fresh one with the same config and volumes.
  router.post('/:id/reprovision', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const payload = provisionPayload(row);
    const generation = (row.generation || 1) + 1;
    getDb().prepare("UPDATE instances SET status = 'pending', generation = ?, provision_attempts = COALESCE(provision_attempts,0)+1, updated_at = ? WHERE id = ?")
      .run(generation, now(), row.id);
    queueCommand(row.node_id, 'instance.reprovision', { ...payload, generation, preserveData: true }, row.id);
    audit(req, 'instance.reprovision', 'instance', row.id, { generation });
    res.json({ ok: true, generation, status: 'pending' });
  }));

  // Explicit runtime/version migration. Never silently swaps the environment;
  // the caller must confirm and customer data volumes are preserved.
  router.post('/:id/runtime', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const b = req.body || {};
    if (str(b.confirm) !== 'MIGRATE') throw badRequest('migration_confirmation_required');
    const runtime = resolveRuntime(getDb(), { environmentId: b.environmentId, version: b.version });
    const env = { ...json(row.env_json, {}), ...(runtime.runtimeEnv || {}) };
    const generation = (row.generation || 1) + 1;
    const ts = now();
    getDb().prepare(`UPDATE instances SET environment_id = ?, environment_version = ?, image = ?, command = ?, version = ?, env_json = ?,
      status = 'pending', generation = ?, provision_attempts = COALESCE(provision_attempts,0)+1, updated_at = ? WHERE id = ?`)
      .run(runtime.environmentId, runtime.version, runtime.imageRef,
        str(b.command || runtime.command, 1000), runtime.version, JSON.stringify(env), generation, ts, row.id);
    const fresh = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(row.id);
    queueCommand(row.node_id, 'instance.reprovision', { ...provisionPayload(fresh), generation, preserveData: true }, row.id);
    audit(req, 'instance.runtime.change', 'instance', row.id, { from: row.environment_id, to: runtime.environmentId, version: runtime.version });
    res.json({ ok: true, instance: view(fresh), generation, dataPreserved: true });
  }));

  router.post('/:id/action', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const action = str(req.body?.action).toLowerCase();
    const map = { start: 'instance.start', stop: 'instance.stop', restart: 'instance.restart', suspend: 'instance.suspend', resume: 'instance.resume' };
    const type = map[action];
    if (!type) throw badRequest('invalid_action');
    if (row.status === 'suspended' && action !== 'resume') throw conflict('instance_suspended');
    const statusMap = { start: 'running', stop: 'stopped', restart: 'running', suspend: 'suspended', resume: 'running' };
    const result = await dispatch(row.node_id, type, { instanceId: row.id }, row.id);
    getDb().prepare('UPDATE instances SET status = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?').run(
      statusMap[action], action === 'start' || action === 'restart' || action === 'resume' ? now() : row.started_at,
      action === 'stop' ? now() : null, now(), row.id
    );
    audit(req, `instance.${action}`, 'instance', row.id, {});
    res.json({ ok: true, status: statusMap[action], result });
  }));

  router.post('/:id/reinstall', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    await dispatch(row.node_id, 'instance.reinstall', {
      instanceId: row.id, teamId: row.team_id, name: row.name, image: row.image, command: row.command,
      env: json(row.env_json, {}), ports: json(row.ports_json, []), volumes: json(row.volumes_json, []),
      cpu: row.cpu_cores, memory: row.memory_mb, disk: row.disk_gb, version: row.version,
    }, row.id);
    getDb().prepare("UPDATE instances SET status = 'stopped', updated_at = ? WHERE id = ?").run(now(), row.id);
    audit(req, 'instance.reinstall', 'instance', row.id, {});
    res.json({ ok: true, status: 'stopped' });
  }));

  router.post('/:id/deploy', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const b = req.body || {};
    const did = id('dep');
    const ts = now();
    getDb().prepare('INSERT INTO deployments (id, instance_id, team_id, status, version, source, repo_url, ref, command) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(did, row.id, req.teamId, 'queued', str(b.version || row.version, 100), str(b.source || 'image', 20), str(b.repoUrl || '', 500), str(b.ref || 'main', 100), str(b.command || '', 1000));
    getDb().prepare("UPDATE instances SET status = 'deploying', updated_at = ? WHERE id = ?").run(ts, row.id);
    let result;
    try {
      result = await dispatch(row.node_id, 'instance.deploy', {
        instanceId: row.id, teamId: row.team_id, name: row.name, image: row.image,
        env: json(row.env_json, {}), ports: json(row.ports_json, []), volumes: json(row.volumes_json, []),
        cpu: row.cpu_cores, memory: row.memory_mb, disk: row.disk_gb,
        version: b.version || row.version, source: b.source || 'image',
        repoUrl: b.repoUrl || '', ref: b.ref || 'main', command: b.command || row.command || '',
      }, row.id);
    } catch (error) {
      getDb().prepare("UPDATE deployments SET status = 'failed' WHERE id = ?").run(did);
      getDb().prepare("UPDATE instances SET status = 'error', updated_at = ? WHERE id = ?").run(now(), row.id);
      throw error;
    }
    getDb().prepare("UPDATE deployments SET status = 'success', commit_sha = ? WHERE id = ?").run(str(result.commitSha || '', 100), did);
    getDb().prepare("UPDATE instances SET status = 'running', version = ?, updated_at = ? WHERE id = ?").run(str(b.version || row.version, 100), now(), row.id);
    audit(req, 'instance.deploy', 'instance', row.id, { version: b.version });
    res.status(202).json({ deploymentId: did, status: 'success', result });
  }));

  router.get('/:id/metrics', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const range = Math.min(1440, Math.max(1, int(req.query.range, 60)));
    const rows = getDb().prepare('SELECT ts, cpu, mem, disk, net_in, net_out, temp FROM metric_samples WHERE instance_id = ? AND ts > ? ORDER BY ts ASC').all(row.id, now() - range * 60000);
    res.json({ metrics: rows });
  }));

  router.get('/:id/logs', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const limit = Math.min(5000, Math.max(1, int(req.query.limit, 500)));
    const before = int(req.query.before, 0);
    const rows = before
      ? getDb().prepare('SELECT * FROM logs WHERE instance_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(row.id, before, limit).reverse()
      : getDb().prepare('SELECT * FROM logs WHERE instance_id = ? ORDER BY id DESC LIMIT ?').all(row.id, limit).reverse();
    res.json({ logs: rows });
  }));

  router.delete('/:id/logs', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    getDb().prepare('DELETE FROM logs WHERE instance_id = ?').run(row.id);
    res.json({ ok: true });
  }));

  router.post('/:id/console', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const command = str(req.body?.command, 1000);
    if (!command) throw badRequest('command_required');
    if (row.status !== 'running') throw conflict('instance_not_running');
    const result = await dispatch(row.node_id, 'instance.exec', { instanceId: row.id, command }, row.id);
    audit(req, 'instance.console', 'instance', row.id, { command });
    res.json(result);
  }));

  router.get('/:id/files', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const result = await dispatch(row.node_id, 'instance.files.list', { instanceId: row.id, path: str(req.query.path || '/', 500) }, row.id);
    res.json(result);
  }));

  router.post('/:id/files', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const b = req.body || {};
    const result = await dispatch(row.node_id, 'instance.files.write', { instanceId: row.id, path: str(b.path, 500), content: str(b.content, 2 * 1024 * 1024), op: str(b.op || 'write', 20) }, row.id);
    audit(req, 'instance.file.write', 'instance', row.id, { path: b.path, op: b.op });
    res.json(result);
  }));

  router.post('/:id/files/upload', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const b = req.body || {};
    const result = await dispatch(row.node_id, 'instance.files.write', { instanceId: row.id, path: str(b.path, 500), content: str(b.content, 8 * 1024 * 1024), op: 'write' }, row.id);
    res.json(result);
  }));

  router.get('/:id/files/download', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const result = await dispatch(row.node_id, 'instance.files.read', { instanceId: row.id, path: str(req.query.path, 500) }, row.id);
    res.json(result);
  }));

  router.post('/:id/backups', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const bid = id('bak');
    getDb().prepare('INSERT INTO backups (id, instance_id, team_id, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(bid, row.id, req.teamId, str(req.body?.name || 'manual backup', 100), 'running', now());
    try {
      const result = await dispatch(row.node_id, 'instance.backup', { instanceId: row.id, backupId: bid }, row.id);
      getDb().prepare("UPDATE backups SET status = 'ready', size_bytes = ?, location = ?, finished_at = ? WHERE id = ?").run(num(result.sizeBytes), str(result.location || '', 500), now(), bid);
      res.status(201).json({ backup: getDb().prepare('SELECT * FROM backups WHERE id = ?').get(bid) });
    } catch (error) {
      getDb().prepare("UPDATE backups SET status = 'failed', finished_at = ? WHERE id = ?").run(now(), bid);
      throw error;
    }
  }));

  router.get('/:id/backups', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    res.json({ backups: getDb().prepare('SELECT * FROM backups WHERE instance_id = ? ORDER BY created_at DESC').all(row.id) });
  }));

  router.post('/:id/backups/:backupId/restore', asyncRoute(async (req, res) => {
    const row = owned(req, req.params.id);
    if (!row) throw notFound();
    const backup = getDb().prepare('SELECT * FROM backups WHERE id = ? AND instance_id = ?').get(req.params.backupId, row.id);
    if (!backup) throw notFound('backup_not_found');
    await dispatch(row.node_id, 'instance.restore', { instanceId: row.id, location: backup.location }, row.id);
    audit(req, 'instance.restore', 'instance', row.id, { backupId: backup.id });
    res.json({ ok: true });
  }));

  return router;
}

function owned(req, instanceId) {
  const row = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId);
  if (!row) return null;
  if (row.team_id !== req.teamId && req.user.role !== 'admin') return null;
  return row;
}

function pickNode(nodeId) {
  const db = getDb();
  if (nodeId) {
    return db.prepare("SELECT * FROM nodes WHERE id = ? AND availability != 'draining'").get(nodeId) || null;
  }
  return db.prepare("SELECT * FROM nodes WHERE availability = 'active' ORDER BY (status = 'online') DESC, (cpu_used + mem_used) ASC LIMIT 1").get() || null;
}

function sanitizeEnv(env) {
  const out = {};
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env)) {
      const clean = String(key).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
      if (clean && clean.length <= 100) out[clean] = String(value).slice(0, 4000);
    }
  }
  return out;
}

function normalizePorts(ports) {
  if (!Array.isArray(ports)) return [];
  return ports.slice(0, 20).map((p) => ({ container: int(p.container ?? p.containerPort, 0), host: int(p.host ?? p.hostPort, 0), protocol: p.protocol === 'udp' ? 'udp' : 'tcp' })).filter((p) => p.container > 0);
}

function normalizeVolumes(volumes) {
  if (!Array.isArray(volumes)) return [];
  return volumes.slice(0, 20).map((v) => ({ path: str(v.path ?? v.container, 300), size: Math.min(2000, int(v.size, 1)) })).filter((v) => v.path.startsWith('/'));
}

function provisionPayload(row) {
  return {
    instanceId: row.id, teamId: row.team_id, name: row.name, image: row.image, command: row.command,
    env: json(row.env_json, {}), ports: json(row.ports_json, []), volumes: json(row.volumes_json, []),
    cpu: row.cpu_cores, memory: row.memory_mb, disk: row.disk_gb, version: row.version,
    environmentId: row.environment_id, environmentVersion: row.environment_version,
    runtimeEnv: json(row.env_json, {}), workingDir: '/app',
  };
}

export function view(row) {
  if (!row) return null;
  return {
    id: row.id, teamId: row.team_id, nodeId: row.node_id, name: row.name, category: row.category, type: row.type,
    status: row.status, image: row.image, command: row.command, version: row.version, env: json(row.env_json, {}),
    ports: json(row.ports_json, []), volumes: json(row.volumes_json, []), cpuCores: row.cpu_cores, memoryMb: row.memory_mb,
    diskGb: row.disk_gb, containerId: row.container_id, nodeName: row.node_name, teamName: row.team_name,
    environmentId: row.environment_id, environmentVersion: row.environment_version, source: row.source,
    healthStatus: row.health_status || 'unknown',
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at, finishedAt: row.finished_at,
  };
}
