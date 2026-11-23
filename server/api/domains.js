import { Router } from 'express';
import dns from 'dns/promises';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, notFound, conflict, id, now, str } from '../util.js';
import { provisionDomainRoute, removeDomainRoute, isCloudflareConfigured, provisionAlias, removeAlias } from '../cloudflare.js';

// Route provisioning happens in the background so DNS/API latency never blocks
// a customer action. Failures are recorded on the domain row.
function provisionRoute(domain, req) {
  provisionDomainRoute(domain, req).catch((error) => {
    getDb().prepare('UPDATE domains SET tunnel_status = ?, updated_at = ? WHERE id = ?')
      .run(`failed: ${error.message.slice(0, 120)}`, now(), domain.id);
  });
}

export function domainsRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncRoute(async (req, res) => {
    res.json({
      domains: getDb().prepare('SELECT * FROM domains WHERE team_id = ? ORDER BY created_at DESC').all(req.teamId),
      aliases: getDb().prepare('SELECT * FROM aliases WHERE team_id = ? ORDER BY created_at DESC').all(req.teamId),
    });
  }));

  // Vanity aliases: clean (name).trycord.dev for game servers / databases.
  router.post('/aliases', asyncRoute(async (req, res) => {
    const name = str(req.body?.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
    const instanceId = str(req.body?.instanceId);
    if (!name) throw badRequest('invalid_alias_name');
    const instance = getDb().prepare('SELECT * FROM instances WHERE id = ? AND team_id = ?').get(instanceId, req.teamId);
    if (!instance) throw notFound('instance_not_found');
    const base = (await import('../config.js')).default.platformDomain;
    const alias = `${name}.${base}`;
    if (getDb().prepare('SELECT id FROM aliases WHERE alias = ?').get(alias)) throw conflict('alias_in_use');
    // Reserve the name against real domains too.
    if (getDb().prepare('SELECT id FROM domains WHERE domain = ?').get(alias)) throw conflict('alias_in_use');
    const aid = id('alias');
    getDb().prepare('INSERT INTO aliases (id, team_id, instance_id, alias, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(aid, req.teamId, instanceId, alias, now(), now());
    audit(req, 'alias.create', 'alias', aid, { alias, instanceId });
    const row = getDb().prepare('SELECT * FROM aliases WHERE id = ?').get(aid);
    if (isCloudflareConfigured()) provisionAlias(row).catch((e) => getDb().prepare("UPDATE aliases SET status=? WHERE id=?").run(`failed: ${e.message.slice(0,100)}`, aid));
    res.status(201).json({ alias: getDb().prepare('SELECT * FROM aliases WHERE id = ?').get(aid) });
  }));

  router.delete('/aliases/:id', asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM aliases WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!row) throw notFound();
    await removeAlias(row).catch(() => {});
    getDb().prepare('DELETE FROM aliases WHERE id = ?').run(row.id);
    audit(req, 'alias.delete', 'alias', row.id, { alias: row.alias });
    res.json({ ok: true });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const domain = str(req.body?.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    const instanceId = str(req.body?.instanceId);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw badRequest('invalid_domain');
    const instance = getDb().prepare('SELECT * FROM instances WHERE id = ? AND team_id = ?').get(instanceId, req.teamId);
    if (!instance) throw notFound('instance_not_found');
    if (getDb().prepare('SELECT id FROM domains WHERE domain = ?').get(domain)) throw conflict('domain_in_use');
    const did = id('dom');
    getDb().prepare('INSERT INTO domains (id, team_id, instance_id, domain, created_at) VALUES (?, ?, ?, ?, ?)').run(did, req.teamId, instanceId, domain, now());
    audit(req, 'domain.create', 'domain', did, { domain, instanceId });
    const row = getDb().prepare('SELECT * FROM domains WHERE id = ?').get(did);
    if (isCloudflareConfigured()) provisionRoute(row, req);
    else getDb().prepare("UPDATE domains SET tunnel_status = 'configuration_required' WHERE id = ?").run(did);
    res.status(201).json({ domain: getDb().prepare('SELECT * FROM domains WHERE id = ?').get(did) });
  }));

  // Retry Cloudflare route provisioning for a failed/pending domain.
  router.post('/:id/retry-route', requireAdmin, asyncRoute(async (req, res) => {
    const domain = getDb().prepare('SELECT * FROM domains WHERE id = ?').get(req.params.id);
    if (!domain) throw notFound();
    if (!isCloudflareConfigured()) throw badRequest('cloudflare_not_configured');
    await provisionDomainRoute(domain, req);
    res.json({ domain: getDb().prepare('SELECT * FROM domains WHERE id = ?').get(domain.id) });
  }));

  router.post('/:id/verify', asyncRoute(async (req, res) => {
    const domain = getDb().prepare('SELECT * FROM domains WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!domain) throw notFound();
    const expected = `lt-verify=${domain.id}`;
    let verified = false;
    try {
      const records = await dns.resolveTxt(`_light.${domain.domain}`);
      verified = records.some((parts) => parts.join('').includes(expected));
    } catch { /* DNS not propagated */ }
    getDb().prepare('UPDATE domains SET verified = ?, ssl_status = ? WHERE id = ?').run(verified ? 1 : 0, verified ? 'provisioning' : 'pending', domain.id);
    if (verified && isCloudflareConfigured()) provisionRoute(getDb().prepare('SELECT * FROM domains WHERE id = ?').get(domain.id), req);
    res.json({ verified, domain: getDb().prepare('SELECT * FROM domains WHERE id = ?').get(domain.id) });
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const domain = getDb().prepare('SELECT * FROM domains WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!domain) throw notFound();
    if (domain.tunnel_id) removeDomainRoute(domain).catch(() => {});
    getDb().prepare('DELETE FROM domains WHERE id = ?').run(domain.id);
    audit(req, 'domain.delete', 'domain', domain.id, { domain: domain.domain });
    res.json({ ok: true });
  }));

  // Infrastructure configuration — admins only, never exposed to customers.
  router.get('/config/proxy', requireAdmin, asyncRoute(async (req, res) => {
    const rows = getDb().prepare('SELECT d.domain, i.id AS instance_id, i.ports_json FROM domains d JOIN instances i ON i.id = d.instance_id WHERE d.verified = 1').all();
    const lines = ['# .light reverse proxy configuration (Caddy-compatible)', ''];
    for (const row of rows) {
      let port = 80;
      try { const ports = JSON.parse(row.ports_json || '[]'); if (ports[0]?.container) port = ports[0].container; } catch { /* default */ }
      lines.push(row.domain, `  reverse_proxy 127.0.0.1:${port}`, '');
    }
    res.type('text/plain').send(lines.join('\n'));
  }));

  return router;
}
