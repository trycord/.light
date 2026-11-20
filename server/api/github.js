import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, id, now, str } from '../util.js';
import * as github from '../github.js';
import { queueCommand } from '../commands.js';
import crypto from 'crypto';

export function githubRoutes() {
  const router = Router();

  router.get('/config', requireAuth, asyncRoute(async (req, res) => {
    const cfg = github.oauthConfig();
    res.json({ ...cfg, connected: github.isConnected(req.teamId) });
  }));

  router.get('/connect', requireAuth, asyncRoute(async (req, res) => {
    const cfg = github.oauthConfig();
    if (!cfg.configured) throw badRequest('github_oauth_not_configured');
    const state = github.oauthState(req.teamId);
    res.json({ url: cfg.authorizeUrl + state });
  }));

  router.post('/token', requireAuth, asyncRoute(async (req, res) => {
    const token = str(req.body?.token);
    if (!token) throw badRequest('token_required');
    let login = '';
    try {
      const res2 = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': '.light' } });
      const u = await res2.json().catch(() => ({}));
      login = u.login || '';
    } catch { /* still store */ }
    github.connect(req.teamId, token, login);
    audit(req, 'github.connect', 'github', req.teamId, { login });
    res.json({ connected: true, account: login });
  }));

  router.get('/callback', asyncRoute(async (req, res) => {
    const code = str(req.query.code);
    const state = str(req.query.state);
    const row = getDb().prepare('SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?').get(state, now());
    if (!row) return res.status(400).send('Invalid or expired OAuth state');
    try {
      const token = await github.exchangeCode(code);
      github.connect(row.team_id, token, '');
      getDb().prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
      res.redirect('/login#/deployments?github=connected');
    } catch (e) { res.status(400).send(e.message); }
  }));

  router.post('/disconnect', requireAuth, asyncRoute(async (req, res) => {
    github.disconnect(req.teamId);
    res.json({ ok: true });
  }));

  router.get('/repos', requireAuth, asyncRoute(async (req, res) => {
    try { res.json({ repos: await github.listRepos(req.teamId, Math.max(1, Number(req.query.page) || 1)) }); }
    catch (e) { throw badRequest(e.message); }
  }));

  router.get('/repos/:owner/:repo/branches', requireAuth, asyncRoute(async (req, res) => {
    try { res.json({ branches: await github.listBranches(req.teamId, `${req.params.owner}/${req.params.repo}`) }); }
    catch (e) { throw badRequest(e.message); }
  }));

  // Configure auto-deploy for an instance.
  router.post('/autodeploy', requireAuth, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const instance = getDb().prepare('SELECT * FROM instances WHERE id = ? AND team_id = ?').get(str(b.instanceId), req.teamId);
    if (!instance) throw badRequest('instance_not_found');
    const fullName = str(b.repoFullName);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw badRequest('invalid_repo');
    const secret = crypto.randomBytes(24).toString('hex');
    const did = id('ad');
    getDb().prepare(`INSERT INTO auto_deploys (id, instance_id, team_id, repo_full_name, branch, install_command, build_command, secret, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(did, instance.id, req.teamId, fullName, str(b.branch || 'main'), str(b.installCommand || '', 2000), str(b.buildCommand || '', 2000), secret, now());
    audit(req, 'github.autodeploy.create', 'instance', instance.id, { repo: fullName });
    res.status(201).json({ autoDeploy: { id: did, repo: fullName, branch: b.branch || 'main', webhookSecret: secret, webhookUrl: `${process.env.CONTROL_BASE_URL || ''}/api/github/webhook` } });
  }));

  router.get('/autodeploy', requireAuth, asyncRoute(async (req, res) => {
    const instanceId = str(req.query.instanceId);
    const rows = instanceId
      ? getDb().prepare('SELECT id, instance_id, repo_full_name, branch, enabled, last_commit, created_at FROM auto_deploys WHERE team_id = ? AND instance_id = ?').all(req.teamId, instanceId)
      : getDb().prepare('SELECT id, instance_id, repo_full_name, branch, enabled, last_commit, created_at FROM auto_deploys WHERE team_id = ?').all(req.teamId);
    res.json({ autoDeploys: rows });
  }));

  // GitHub push webhook — signature verified, idempotent.
  router.post('/webhook', asyncRoute(async (req, res) => {
    const raw = req.rawBody || JSON.stringify(req.body || {});
    if (!github.verifyWebhookSignature(raw, req.headers['x-hub-signature-256'])) return res.status(401).json({ error: 'invalid_signature' });
    const event = req.body || {};
    if (req.headers['x-github-event'] !== 'push') return res.json({ received: true, ignored: true });
    const repo = event.repository?.full_name || '';
    const ref = String(event.ref || '').replace('refs/heads/', '');
    const commit = event.after || '';
    const rows = getDb().prepare('SELECT * FROM auto_deploys WHERE repo_full_name = ? AND branch = ? AND enabled = 1').all(repo, ref);
    for (const ad of rows) {
      const instance = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(ad.instance_id);
      if (!instance || !instance.node_id) continue;
      // idempotency: skip if same commit already deployed
      if (ad.last_commit === commit) continue;
      getDb().prepare('UPDATE auto_deploys SET last_commit = ? WHERE id = ?').run(commit, ad.id);
      queueCommand(instance.node_id, 'instance.deploy', {
        instanceId: instance.id, teamId: instance.team_id, name: instance.name, image: instance.image,
        env: JSON.parse(instance.env_json || '{}'), ports: JSON.parse(instance.ports_json || '[]'),
        volumes: JSON.parse(instance.volumes_json || '[]'), cpu: instance.cpu_cores, memory: instance.memory_mb, disk: instance.disk_gb,
        source: 'git', repoUrl: `https://github.com/${repo}.git`, ref, commitSha: commit,
        installCommand: ad.install_command, buildCommand: ad.build_command,
      }, instance.id);
    }
    res.json({ received: true, triggered: rows.length });
  }));

  return router;
}
