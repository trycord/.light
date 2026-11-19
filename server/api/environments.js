import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncRoute, badRequest, notFound, id, now, str, int, json } from '../util.js';

export function environmentsRoutes() {
  const router = Router();

  // Public environment catalogue (authenticated customers).
  router.get('/', requireAuth, asyncRoute(async (req, res) => {
    let rows = getDb().prepare("SELECT * FROM environments WHERE status = 'published' ORDER BY featured DESC, sort_order").all();
    if (req.query.category) rows = rows.filter((e) => e.category === req.query.category);
    res.json({ environments: rows.map(view) });
  }));

  router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
    const e = getDb().prepare('SELECT * FROM environments WHERE id = ? AND status = ?').get(req.params.id, 'published');
    if (!e) throw notFound();
    res.json({ environment: view(e) });
  }));

  // Admin: full management.
  router.get('/admin/all', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ environments: getDb().prepare('SELECT * FROM environments ORDER BY sort_order').all().map(view) });
  }));

  router.post('/admin', requireAdmin, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const eid = str(b.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!eid || !b.name || !b.image) throw badRequest('id_name_image_required');
    if (getDb().prepare('SELECT id FROM environments WHERE id = ?').get(eid)) throw badRequest('environment_exists');
    const ts = now();
    const J = (v) => JSON.stringify(v ?? []);
    getDb().prepare(`INSERT INTO environments (id, name, category, description, icon, versions, default_version, image, image_digest, architectures,
      default_command, default_entrypoint, working_dir, build_capable, package_managers, default_env, exposed_ports, healthcheck, storage,
      resource_recommendations, lifecycle, security, version_images, status, featured, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(eid, str(b.name), str(b.category || 'runtime'), str(b.description, 1000), str(b.icon || '◈', 20), J(b.versions), str(b.defaultVersion || b.versions?.[0] || 'latest'),
        str(b.image), str(b.imageDigest || '', 200), J(b.architectures || ['amd64']), str(b.defaultCommand || '', 500), str(b.defaultEntrypoint || '', 300),
        str(b.workingDir || '/app', 200), b.buildCapable ? 1 : 0, J(b.packageManagers), JSON.stringify(b.defaultEnv || {}), J(b.exposedPorts),
        JSON.stringify(b.healthcheck || {}), JSON.stringify(b.storage || {}), JSON.stringify(b.resourceRecommendations || {}), J(b.lifecycle), JSON.stringify(b.security || {}),
        str(b.status || 'published', 20), b.featured ? 1 : 0, int(b.sortOrder, 0), ts, ts);
    res.status(201).json({ environment: view(getDb().prepare('SELECT * FROM environments WHERE id = ?').get(eid)) });
  }));

  router.patch('/admin/:id', requireAdmin, asyncRoute(async (req, res) => {
    const e = getDb().prepare('SELECT * FROM environments WHERE id = ?').get(req.params.id);
    if (!e) throw notFound();
    const b = req.body || {};
    const textMap = { name: 'name', category: 'category', description: 'description', icon: 'icon', defaultVersion: 'default_version', image: 'image', imageDigest: 'image_digest', defaultCommand: 'default_command', defaultEntrypoint: 'default_entrypoint', workingDir: 'working_dir', status: 'status' };
    const jsonMap = { versions: 'versions', architectures: 'architectures', packageManagers: 'package_managers', exposedPorts: 'exposed_ports', lifecycle: 'lifecycle', defaultEnv: 'default_env', healthcheck: 'healthcheck', storage: 'storage', resourceRecommendations: 'resource_recommendations', security: 'security' };
    const sets = []; const values = [];
    for (const [k, col] of Object.entries(textMap)) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(str(b[k], 1000)); }
    for (const [k, col] of Object.entries(jsonMap)) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(JSON.stringify(b[k])); }
    if (b.buildCapable !== undefined) { sets.push('build_capable = ?'); values.push(b.buildCapable ? 1 : 0); }
    if (b.featured !== undefined) { sets.push('featured = ?'); values.push(b.featured ? 1 : 0); }
    if (b.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(int(b.sortOrder, 0)); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now(), e.id); getDb().prepare(`UPDATE environments SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
    res.json({ environment: view(getDb().prepare('SELECT * FROM environments WHERE id = ?').get(e.id)) });
  }));

  return router;
}

function view(e) {
  return {
    id: e.id, name: e.name, category: e.category, description: e.description, icon: e.icon,
    versions: json(e.versions, []), defaultVersion: e.default_version, image: e.image, imageDigest: e.image_digest,
    architectures: json(e.architectures, []), defaultCommand: e.default_command, defaultEntrypoint: e.default_entrypoint,
    workingDir: e.working_dir, buildCapable: !!e.build_capable, packageManagers: json(e.package_managers, []),
    defaultEnv: json(e.default_env, {}), exposedPorts: json(e.exposed_ports, []), healthcheck: json(e.healthcheck, {}),
    storage: json(e.storage, {}), resourceRecommendations: json(e.resource_recommendations, {}),
    lifecycle: json(e.lifecycle, []), security: json(e.security, {}),
    status: e.status, featured: !!e.featured, sortOrder: e.sort_order,
  };
}
