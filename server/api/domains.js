import { Router } from 'express';
import dns from 'dns/promises';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, notFound, conflict, id, now, str } from '../util.js';
import { provisionDomainRoute, removeDomainRoute, isCloudflareConfigured } from '../cloudflare.js';

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
    res.json({ domains: getDb().prepare('SELECT * FROM domains WHERE team_id = ? ORDER BY created_at DESC').all(req.teamId) });
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
