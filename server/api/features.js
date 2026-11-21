import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin, authenticate, signToken } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, unauthorized, id, now, str, json } from '../util.js';
import * as twofactor from '../twofactor.js';
import * as proxy from '../proxy.js';
import { isCloudflareConfigured, cloudflareConfig } from '../cloudflare.js';

export function featuresRoutes() {
  const router = Router();

  router.get('/cloudflare/tunnels', requireAdmin, asyncRoute(async (req, res) => {
    const { allNodeTunnels } = await import('../cloudflare.js');
    const tunnels = allNodeTunnels().map(t => ({ nodeId: t.node_id, tunnelId: t.tunnel_id,
      status: t.status, lastHeartbeat: t.last_heartbeat, updatedAt: t.updated_at }));
    res.json({ tunnels });
  }));

  router.get('/cloudflare', requireAuth, asyncRoute(async (req, res) => {
    const c = cloudflareConfig();
    res.json({ configured: isCloudflareConfigured(), domain: c.domain,
      detail: isCloudflareConfigured() ? 'tunnels are provisioned for project subdomains' : 'configuration_required' });
  }));

  /* ---------- Two-factor authentication ---------- */
  router.get('/2fa/status', requireAuth, asyncRoute(async (req, res) => res.json(twofactor.status(req.user.id))));
  router.post('/2fa/setup', requireAuth, asyncRoute(async (req, res) => {
    const secret = twofactor.generateSecret();
    res.json(twofactor.setup(req.user.id, secret));
  }));
  router.post('/2fa/enable', requireAuth, asyncRoute(async (req, res) => {
    const r = twofactor.enable(req.user.id, str(req.body?.code));
    if (!r) throw badRequest('invalid_code');
    audit(req, 'security.2fa.enable', 'user', req.user.id, {});
    res.json(r);
  }));
  router.post('/2fa/disable', requireAuth, asyncRoute(async (req, res) => {
    const r = twofactor.disable(req.user.id, str(req.body?.code));
    if (!r) throw badRequest('invalid_code');
    audit(req, 'security.2fa.disable', 'user', req.user.id, {});
    res.json(r);
  }));
  // Login with 2FA: verify password then code, issue token.
  router.post('/2fa/login', asyncRoute(async (req, res) => {
    const { email, password, code } = req.body || {};
    // Same brute-force protection as the primary login route.
    const identity = String(email || '').toLowerCase().trim();
    const candidate = getDb().prepare('SELECT * FROM users WHERE email = ? OR lower(username) = ?').get(identity, identity);
    if (candidate?.locked_until && candidate.locked_until > now()) throw unauthorized('account_locked');
    let user;
    try { user = authenticate(email, password); }
    catch (error) {
      if (candidate) {
        const fails = (candidate.failed_logins || 0) + 1;
        getDb().prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
          .run(fails, fails >= 5 ? now() + 15 * 60000 : null, candidate.id);
      }
      throw error;
    }
    getDb().prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
    const status = twofactor.status(user.id);
    if (status.enabled) {
      if (!code || !twofactor.verify(user.id, str(code))) throw unauthorized('invalid_2fa_code');
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.team_id } });
  }));

  /* ---------- Domains / TLS / proxy ---------- */
  router.get('/proxy/config', requireAdmin, asyncRoute(async (req, res) => {
    res.type('text/plain').send(proxy.generateConfig());
  }));
  router.post('/proxy/apply', requireAdmin, asyncRoute(async (req, res) => {
    const r = await proxy.applyConfig();
    audit(req, 'proxy.apply', 'proxy', 'default', { applied: r.applied });
    res.json(r);
  }));
  router.get('/proxy/status', requireAdmin, asyncRoute(async (req, res) => res.json(proxy.isConfigured())));
  router.get('/domains/:domain/dns', requireAuth, asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM domains WHERE domain = ? AND team_id = ?').get(req.params.domain, req.teamId);
    if (!row) throw badRequest('domain_not_found');
    res.json(proxy.dnsInstructions(row.domain));
  }));
  router.post('/domains/:domain/ssl', requireAuth, asyncRoute(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM domains WHERE domain = ? AND team_id = ?').get(req.params.domain, req.teamId);
    if (!row) throw badRequest('domain_not_found');
    if (!row.verified) throw badRequest('domain_not_verified');
    proxy.markCertificate(row.domain, 'provisioning');
    const result = await proxy.applyConfig();
    proxy.markCertificate(row.domain, result.applied ? 'active' : 'pending');
    res.json({ status: result.applied ? 'active' : 'pending', reason: result.reason });
  }));

  /* ---------- Mods / plugins ---------- */
  router.get('/modpacks', requireAuth, asyncRoute(async (req, res) => {
    const iid = str(req.query.instanceId);
    const rows = iid
      ? getDb().prepare('SELECT * FROM modpacks WHERE team_id = ? AND instance_id = ?').all(req.teamId, iid)
      : getDb().prepare('SELECT * FROM modpacks WHERE team_id = ?').all(req.teamId);
    res.json({ modpacks: rows.map((m) => ({ ...m, mods: json(m.mods, []) })) });
  }));
  router.post('/modpacks', requireAuth, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const instance = getDb().prepare('SELECT * FROM instances WHERE id = ? AND team_id = ?').get(str(b.instanceId), req.teamId);
    if (!instance) throw badRequest('instance_not_found');
    const mid = id('mod');
    const mods = Array.isArray(b.mods) ? b.mods.slice(0, 200).map((m) => ({ name: String(m.name || '').slice(0, 200), url: String(m.url || '').slice(0, 500) })).filter((m) => m.name) : [];
    getDb().prepare(`INSERT INTO modpacks (id, instance_id, team_id, name, loader, version, mods, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(mid, instance.id, req.teamId, str(b.name || 'modpack'), str(b.loader || 'fabric', 40), str(b.version || '', 60), JSON.stringify(mods), now(), now());
    if (instance.node_id) {
      // Queue mod installation on the node.
      const { queueCommand } = await import('../commands.js');
      queueCommand(instance.node_id, 'instance.mods.install', { instanceId: instance.id, modpackId: mid, loader: b.loader || 'fabric', mods }, instance.id);
    }
    audit(req, 'modpack.create', 'instance', instance.id, { name: b.name });
    res.status(201).json({ modpack: { id: mid, name: b.name, loader: b.loader, mods, status: 'pending' } });
  }));
  router.post('/modpacks/:id/sync', requireAuth, asyncRoute(async (req, res) => {
    const m = getDb().prepare('SELECT * FROM modpacks WHERE id = ? AND team_id = ?').get(req.params.id, req.teamId);
    if (!m) throw badRequest('modpack_not_found');
    getDb().prepare("UPDATE modpacks SET status = 'pending', updated_at = ? WHERE id = ?").run(now(), m.id);
    res.json({ ok: true, status: 'pending' });
  }));

  return router;
}
