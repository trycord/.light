import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import config from '../config.js';
import { asyncRoute, notFound, badRequest, forbidden } from '../util.js';
import { pricingConfig, calculatePrice, validateResources, publicPlan } from '../pricing.js';
import { optionsForProduct } from '../packages.js';

export function catalogRoutes() {
  const router = Router();

  // Public catalogue (no auth) — used by the website.
  // Backward-compatible templates endpoint (used by instance creation UI).
  router.get('/templates', asyncRoute(async (req, res) => {
    res.json({ templates: getDb().prepare('SELECT * FROM templates ORDER BY category, name').all().map((t) => ({
      id: t.id, name: t.name, category: t.category, image: t.image, description: t.description,
      versions: JSON.parse(t.versions || '[]'), command: t.command, ports: JSON.parse(t.ports || '[]'), env: JSON.parse(t.env || '{}'),
      game: t.category === 'game' ? t.id : undefined,
    })) });
  }));

  router.get('/categories', asyncRoute(async (req, res) => {
    const rows = getDb().prepare("SELECT * FROM product_categories WHERE status = 'published' ORDER BY sort_order").all();
    res.json({ categories: rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, icon: c.icon, image: c.image })) });
  }));

  router.get('/products', asyncRoute(async (req, res) => {
    const category = req.query.category;
    let rows = getDb().prepare("SELECT * FROM products WHERE status = 'published' ORDER BY featured DESC, sort_order").all();
    if (category) rows = rows.filter((p) => p.category_id === category);
    res.json({ products: rows.map(publicProduct) });
  }));

  router.get('/products/:slug', asyncRoute(async (req, res) => {
    const p = getDb().prepare("SELECT * FROM products WHERE slug = ? AND status = 'published'").get(req.params.slug);
    if (!p) throw notFound();
    const locations = getDb().prepare('SELECT id, country, region, city, available, latency_ms FROM product_locations WHERE product_id = ?').all(p.id);
    const plans = getDb().prepare("SELECT * FROM plans WHERE product_id = ? AND status = 'published' ORDER BY sort_order").all(p.id);
    const products = getDb().prepare("SELECT * FROM plans WHERE status = 'published' AND (product_id IS NULL OR product_id = ?) ORDER BY sort_order").all(p.id);
    res.json({ product: publicProduct(p), locations, plans: (plans.length ? plans : products).map((x) => publicPlan(x, req.query.interval || 'monthly')) });
  }));

  // Product-aware configuration options — the frontend asks the backend which
  // packages/runtimes are valid for a product instead of hardcoding conditionals.
  router.get('/products/:slug/options', asyncRoute(async (req, res) => {
    const product = getDb().prepare("SELECT * FROM products WHERE slug = ? AND status = 'published'").get(req.params.slug);
    if (!product) throw notFound();
    const options = optionsForProduct(product.id);
    res.json({ productId: product.id, ...options });
  }));

  router.get('/plans', asyncRoute(async (req, res) => {
    const interval = req.query.interval === 'yearly' ? 'yearly' : 'monthly';
    const productId = req.query.productId;
    let rows = getDb().prepare("SELECT * FROM plans WHERE status = 'published' AND available = 1 ORDER BY sort_order").all();
    if (productId) rows = rows.filter((p) => !p.product_id || p.product_id === productId);
    res.json({ plans: rows.map((p) => publicPlan(p, interval)) });
  }));

  router.get('/pricing', asyncRoute(async (req, res) => {
    const cfg = pricingConfig();
    res.json({ config: {
      currency: cfg.currency, taxPercent: cfg.tax_percent,
      cpu: cfg.price_cpu, memoryMb: cfg.price_memory_mb, diskGb: cfg.price_disk_gb, networkGb: cfg.price_network_gb, instance: cfg.price_instance,
      minCpu: cfg.min_cpu, maxCpu: cfg.max_cpu, minMemoryMb: cfg.min_memory_mb, maxMemoryMb: cfg.max_memory_mb,
      minDiskGb: cfg.min_disk_gb, maxDiskGb: cfg.max_disk_gb,
      stepCpu: cfg.step_cpu, stepMemoryMb: cfg.step_memory_mb, stepDiskGb: cfg.step_disk_gb,
      yearlyDiscountPercent: cfg.yearly_discount_percent, paymentProvider: cfg.payment_provider,
      customPlansEnabled: config.allowCustomPlans,
    }});
  }));

  // Server-side estimate (frontend may display but cannot be trusted for purchases).
  router.post('/pricing/estimate', asyncRoute(async (req, res) => {
    if (!config.allowCustomPlans) throw forbidden('custom_plans_disabled');
    const cfg = pricingConfig();
    const resources = validateResources(cfg, req.body?.resources || {});
    const interval = req.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    res.json({ estimate: calculatePrice(cfg, resources, interval), valid: true });
  }));

  return router;
}

function publicProduct(p) {
  return {
    id: p.id, categoryId: p.category_id, name: p.name, slug: p.slug,
    shortDescription: p.short_description, description: p.description, image: p.image, icon: p.icon,
    features: parse(p.features, []), tags: parse(p.tags, []),
    featured: !!p.featured, startingPriceMonthly: p.starting_price_monthly, currency: p.currency,
  };
}
function parse(v, f) { try { return JSON.parse(v || ''); } catch { return f; } }
