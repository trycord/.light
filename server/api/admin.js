import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAdmin, signToken } from '../auth.js';
import { requireRealAdmin, hasPermission, PERMISSIONS, isValidPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { asyncRoute, badRequest, forbidden, notFound, conflict, id, now, str, int, num, json } from '../util.js';

export function adminRoutes() {
  const router = Router();
  router.use(requireAdmin);

  // Granular enforcement: a custom role with `admin.access` still needs the
  // specific read/write permission for each admin section it calls.
  router.use((req, res, next) => {
    const p = req.path;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    let needed = null;
    if (/^\/(users|teams)/.test(p)) needed = write ? 'customers.write' : 'customers.read';
    else if (/^\/audit/.test(p)) needed = 'audit.read';
    else if (/^\/(products|categories)/.test(p)) needed = write ? 'products.write' : 'products.read';
    else if (/^\/plans/.test(p)) needed = write ? 'plans.write' : 'plans.read';
    else if (/^\/(pricing|subscriptions|transactions)/.test(p)) needed = write ? 'billing.write' : 'billing.read';
    else if (/^\/(roles|permissions)/.test(p)) needed = write ? 'roles.write' : 'roles.read';
    if (needed && !hasPermission(req.user, needed)) return next(forbidden('permission_required'));
    next();
  });

  /* ---------- Users ---------- */
  router.get('/users', asyncRoute(async (req, res) => {
    res.json({ users: getDb().prepare('SELECT id, email, name, username, role, team_id, status, created_at, last_login FROM users ORDER BY created_at DESC').all() });
  }));
  router.patch('/users/:id', asyncRoute(async (req, res) => {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw notFound();
    const b = req.body || {};
    if (b.role && b.role !== 'user' && b.role !== 'admin' && !getDb().prepare('SELECT id FROM roles WHERE id = ?').get(b.role)) throw badRequest('invalid_role');
    if (b.status && !['active', 'suspended'].includes(b.status)) throw badRequest('invalid_status');
    getDb().prepare('UPDATE users SET role = ?, status = ?, token_version = COALESCE(token_version,0)+1, updated_at = ? WHERE id = ?').run(b.role || user.role, b.status || user.status, now(), user.id);
    audit(req, 'admin.user.update', 'user', user.id, b);
    res.json({ user: getDb().prepare('SELECT id, email, name, role, team_id, status FROM users WHERE id = ?').get(user.id) });
  }));

  /* ---------- Audit / teams ---------- */
  router.get('/audit', asyncRoute(async (req, res) => {
    const limit = Math.min(1000, Math.max(1, int(req.query.limit, 200)));
    res.json({ events: getDb().prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) });
  }));
  router.get('/teams', asyncRoute(async (req, res) => {
    res.json({ teams: getDb().prepare('SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, (SELECT COUNT(*) FROM instances i WHERE i.team_id = t.id) AS instances FROM teams t ORDER BY t.created_at DESC').all() });
  }));
  router.patch('/teams/:id/plan', asyncRoute(async (req, res) => {
    const plan = getDb().prepare('SELECT id FROM plans WHERE id = ?').get(str(req.body?.planId));
    if (!plan) throw badRequest('invalid_plan');
    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!team) throw notFound();
    getDb().prepare('UPDATE teams SET plan_id = ?, updated_at = ? WHERE id = ?').run(plan.id, now(), team.id);
    audit(req, 'admin.team.plan', 'team', team.id, { planId: plan.id });
    res.json({ team: getDb().prepare('SELECT * FROM teams WHERE id = ?').get(team.id) });
  }));

  /* ---------- Categories ---------- */
  router.get('/categories', asyncRoute(async (req, res) => {
    res.json({ categories: getDb().prepare('SELECT * FROM product_categories ORDER BY sort_order').all() });
  }));
  router.post('/categories', asyncRoute(async (req, res) => {
    const b = req.body || {}; const name = str(b.name).trim(); const slug = str(b.slug || name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!name || !slug) throw badRequest('name_required');
    const cid = id('cat');
    getDb().prepare('INSERT INTO product_categories (id, name, slug, description, icon, image, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(cid, name, slug, str(b.description, 500), str(b.icon || '◈', 20), str(b.image, 500), int(b.sortOrder, 0), str(b.status || 'published', 20));
    res.status(201).json({ category: getDb().prepare('SELECT * FROM product_categories WHERE id = ?').get(cid) });
  }));

  /* ---------- Products ---------- */
  router.get('/products', asyncRoute(async (req, res) => {
    res.json({ products: getDb().prepare('SELECT * FROM products ORDER BY featured DESC, sort_order').all().map(viewProduct) });
  }));
  router.post('/products', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name).trim(); const slug = str(b.slug || name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!name || !slug) throw badRequest('name_required');
    if (!getDb().prepare('SELECT id FROM product_categories WHERE id = ?').get(str(b.categoryId))) throw badRequest('invalid_category');
    if (getDb().prepare('SELECT id FROM products WHERE slug = ?').get(slug)) throw conflict('slug_exists');
    const pid = id('prod'); const ts = now();
    getDb().prepare(`INSERT INTO products (id, category_id, name, slug, short_description, description, image, icon, features, tags, status, featured, sort_order, starting_price_monthly, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, b.categoryId, name, slug, str(b.shortDescription, 300), str(b.description, 4000), str(b.image, 500), str(b.icon || '◈', 20), JSON.stringify(b.features || []), JSON.stringify(b.tags || []), str(b.status || 'published', 20), b.featured ? 1 : 0, int(b.sortOrder, 0), int(b.startingPriceMonthly, 0), str(b.currency || 'USD', 10), ts, ts);
    audit(req, 'admin.product.create', 'product', pid, { name, slug });
    res.status(201).json({ product: viewProduct(getDb().prepare('SELECT * FROM products WHERE id = ?').get(pid)) });
  }));
  router.patch('/products/:id', asyncRoute(async (req, res) => {
    const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    const b = req.body || {}; const fields = { name: 'name', slug: 'slug', shortDescription: 'short_description', description: 'description', image: 'image', icon: 'icon', status: 'status', currency: 'currency' };
    const sets = []; const values = [];
    for (const [key, col] of Object.entries(fields)) if (b[key] !== undefined) { sets.push(`${col} = ?`); values.push(str(b[key], 4000)); }
    if (b.features !== undefined) { sets.push('features = ?'); values.push(JSON.stringify(b.features)); }
    if (b.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(b.tags)); }
    if (b.startingPriceMonthly !== undefined) { sets.push('starting_price_monthly = ?'); values.push(int(b.startingPriceMonthly, 0)); }
    if (b.featured !== undefined) { sets.push('featured = ?'); values.push(b.featured ? 1 : 0); }
    if (b.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(int(b.sortOrder, 0)); }
    if (b.categoryId !== undefined) { sets.push('category_id = ?'); values.push(str(b.categoryId)); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now(), p.id); getDb().prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
    audit(req, 'admin.product.update', 'product', p.id, b);
    res.json({ product: viewProduct(getDb().prepare('SELECT * FROM products WHERE id = ?').get(p.id)) });
  }));
  router.delete('/products/:id', asyncRoute(async (req, res) => {
    const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    getDb().prepare('DELETE FROM product_locations WHERE product_id = ?').run(p.id);
    getDb().prepare('DELETE FROM products WHERE id = ?').run(p.id);
    res.json({ ok: true });
  }));

  /* ---------- Plans ---------- */
  router.get('/plans', asyncRoute(async (req, res) => {
    res.json({ plans: getDb().prepare('SELECT * FROM plans ORDER BY sort_order').all().map(viewPlan) });
  }));
  router.post('/plans', asyncRoute(async (req, res) => {
    const b = req.body || {}; const name = str(b.name).trim(); if (!name) throw badRequest('name_required');
    const pid = id('plan'); const ts = now();
    getDb().prepare(`INSERT INTO plans (id, name, description, category, product_id, cpu_cores, memory_mb, disk_gb, network_gb, instances, price_monthly, price_yearly, interval, currency, features, restrictions, status, featured, sort_order, available, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, name, str(b.description, 1000), str(b.category || 'shared', 40), b.productId || null,
      int(b.cpuCores, 1), int(b.memoryMb, 512), int(b.diskGb, 4), int(b.networkGb, 0), int(b.instances, 3), int(b.priceMonthly, 0), int(b.priceYearly, 0), str(b.interval || 'monthly', 20), str(b.currency || 'USD', 10),
      JSON.stringify(b.features || []), JSON.stringify(b.restrictions || []), str(b.status || 'published', 20), b.featured ? 1 : 0, int(b.sortOrder, 0), b.available === false ? 0 : 1, ts, ts);
    audit(req, 'admin.plan.create', 'plan', pid, { name });
    res.status(201).json({ plan: viewPlan(getDb().prepare('SELECT * FROM plans WHERE id = ?').get(pid)) });
  }));
  router.patch('/plans/:id', asyncRoute(async (req, res) => {
    const p = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    const b = req.body || {};
    const map = { name: 'name', description: 'description', category: 'category', interval: 'interval', currency: 'currency', status: 'status' };
    const sets = []; const values = [];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(str(b[k], 1000)); }
    for (const [k, col] of Object.entries({ cpuCores: 'cpu_cores', memoryMb: 'memory_mb', diskGb: 'disk_gb', networkGb: 'network_gb', instances: 'instances', priceMonthly: 'price_monthly', priceYearly: 'price_yearly', sortOrder: 'sort_order' })) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(int(b[k], 0)); }
    for (const [k, col] of Object.entries({ features: 'features', restrictions: 'restrictions' })) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(JSON.stringify(b[k])); }
    if (b.featured !== undefined) { sets.push('featured = ?'); values.push(b.featured ? 1 : 0); }
    if (b.available !== undefined) { sets.push('available = ?'); values.push(b.available ? 1 : 0); }
    if (b.productId !== undefined) { sets.push('product_id = ?'); values.push(b.productId || null); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now(), p.id); getDb().prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
    audit(req, 'admin.plan.update', 'plan', p.id, b);
    res.json({ plan: viewPlan(getDb().prepare('SELECT * FROM plans WHERE id = ?').get(p.id)) });
  }));
  router.delete('/plans/:id', asyncRoute(async (req, res) => {
    const p = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
    if (!p) throw notFound();
    if (getDb().prepare("SELECT id FROM subscriptions WHERE plan_id = ? AND status = 'active'").get(p.id)) throw conflict('plan_has_active_subscriptions');
    getDb().prepare("UPDATE plans SET status = 'archived', available = 0, updated_at = ? WHERE id = ?").run(now(), p.id);
    res.json({ ok: true });
  }));

  /* ---------- Pricing config ---------- */
  router.get('/pricing', asyncRoute(async (req, res) => {
    res.json({ config: getDb().prepare('SELECT * FROM pricing_config WHERE id = ?').get('default') });
  }));
  router.patch('/pricing', asyncRoute(async (req, res) => {
    const b = req.body || {}; const map = { currency: 'currency', paymentProvider: 'payment_provider' };
    const sets = []; const values = [];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(str(b[k], 100)); }
    for (const [k, col] of Object.entries({ taxPercent: 'tax_percent', yearlyDiscountPercent: 'yearly_discount_percent', priceCpu: 'price_cpu', priceMemoryMb: 'price_memory_mb', priceDiskGb: 'price_disk_gb', priceNetworkGb: 'price_network_gb', priceInstance: 'price_instance', minCpu: 'min_cpu', maxCpu: 'max_cpu', minMemoryMb: 'min_memory_mb', maxMemoryMb: 'max_memory_mb', minDiskGb: 'min_disk_gb', maxDiskGb: 'max_disk_gb', stepCpu: 'step_cpu', stepMemoryMb: 'step_memory_mb', stepDiskGb: 'step_disk_gb' })) if (b[k] !== undefined) { sets.push(`${col} = ?`); values.push(num(b[k], 0)); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now()); getDb().prepare(`UPDATE pricing_config SET ${sets.join(', ')} WHERE id = 'default'`).run(...values); }
    audit(req, 'admin.pricing.update', 'pricing', 'default', b);
    res.json({ config: getDb().prepare('SELECT * FROM pricing_config WHERE id = ?').get('default') });
  }));

  /* ---------- Subscriptions / transactions ---------- */
  router.get('/subscriptions', asyncRoute(async (req, res) => {
    res.json({ subscriptions: getDb().prepare('SELECT s.*, t.name AS team_name FROM subscriptions s JOIN teams t ON t.id = s.team_id ORDER BY s.created_at DESC LIMIT 300').all() });
  }));
  router.get('/transactions', asyncRoute(async (req, res) => {
    res.json({ transactions: getDb().prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 300').all() });
  }));

  /* ---------- RBAC roles ---------- */
  router.get('/permissions', asyncRoute(async (req, res) => {
    res.json({ permissions: PERMISSIONS });
  }));
  router.get('/roles', asyncRoute(async (req, res) => {
    const roles = getDb().prepare('SELECT * FROM roles ORDER BY system DESC, name').all().map(viewRole);
    res.json({ roles });
  }));
  router.post('/roles', requireRealAdmin, asyncRoute(async (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 80).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (!name || ['admin', 'user'].includes(name)) throw badRequest('invalid_role_name');
    if (getDb().prepare('SELECT id FROM roles WHERE id = ? OR name = ?').get(name, name)) throw conflict('role_exists');
    const permissions = normalizePermissions(b.permissions);
    const rid = name; const ts = now();
    getDb().prepare('INSERT INTO roles (id, name, description, permissions, system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(rid, name, str(b.description, 300), JSON.stringify(permissions), ts, ts);
    audit(req, 'admin.role.create', 'role', rid, { name, permissions });
    res.status(201).json({ role: viewRole(getDb().prepare('SELECT * FROM roles WHERE id = ?').get(rid)) });
  }));
  router.patch('/roles/:id', requireRealAdmin, asyncRoute(async (req, res) => {
    const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) throw notFound();
    const b = req.body || {}; const sets = []; const values = [];
    if (b.description !== undefined) { sets.push('description = ?'); values.push(str(b.description, 300)); }
    if (b.permissions !== undefined) { sets.push('permissions = ?'); values.push(JSON.stringify(normalizePermissions(b.permissions))); }
    if (sets.length) { sets.push('updated_at = ?'); values.push(now(), role.id); getDb().prepare(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`).run(...values); }
    audit(req, 'admin.role.update', 'role', role.id, b);
    res.json({ role: viewRole(getDb().prepare('SELECT * FROM roles WHERE id = ?').get(role.id)) });
  }));
  router.delete('/roles/:id', requireRealAdmin, asyncRoute(async (req, res) => {
    const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!role) throw notFound();
    if (role.system) throw badRequest('system_role_cannot_be_deleted');
    if (getDb().prepare('SELECT id FROM users WHERE role = ?').get(role.id)) throw conflict('role_in_use');
    getDb().prepare('DELETE FROM roles WHERE id = ?').run(role.id);
    audit(req, 'admin.role.delete', 'role', role.id, {});
    res.json({ ok: true });
  }));

  /* ---------- Impersonation (real admins only, fully audited) ---------- */
  router.post('/users/:id/impersonate', requireRealAdmin, asyncRoute(async (req, res) => {
    const target = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) throw notFound();
    if (target.role === 'admin') throw forbidden('cannot_impersonate_admin');
    const token = signToken(target, { impersonatedBy: req.user.id });
    audit(req, 'admin.user.impersonate', 'user', target.id, { email: target.email });
    res.json({ token, user: { id: target.id, email: target.email, name: target.name, role: target.role },
      impersonatedBy: req.user.id });
  }));

  return router;
}

function normalizePermissions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((p) => typeof p === 'string' && isValidPermission(p)))];
}

function viewRole(r) {
  return { id: r.id, name: r.name, description: r.description, permissions: json(r.permissions, []),
    system: !!r.system, createdAt: r.created_at, updatedAt: r.updated_at };
}

function viewProduct(p) { return {
  id: p.id, categoryId: p.category_id, name: p.name, slug: p.slug, shortDescription: p.short_description,
  description: p.description, image: p.image, icon: p.icon, features: json(p.features, []), tags: json(p.tags, []),
  status: p.status, featured: !!p.featured, sortOrder: p.sort_order, startingPriceMonthly: p.starting_price_monthly, currency: p.currency,
}; }
function viewPlan(p) { return {
  id: p.id, name: p.name, description: p.description, category: p.category, productId: p.product_id,
  cpuCores: p.cpu_cores, memoryMb: p.memory_mb, diskGb: p.disk_gb, networkGb: p.network_gb, instances: p.instances,
  priceMonthly: p.price_monthly, priceYearly: p.price_yearly, interval: p.interval, currency: p.currency,
  features: json(p.features, []), restrictions: json(p.restrictions, []), status: p.status, featured: !!p.featured,
  available: !!p.available, sortOrder: p.sort_order,
}; }
