// .light — centralized server-side pricing engine.
// Never trust client-provided prices. All final calculations happen here.
import { getDb } from './db.js';
import { badRequest, conflict, num, int, str, id, now } from './util.js';

export function pricingConfig() {
  return getDb().prepare('SELECT * FROM pricing_config WHERE id = ?').get('default') || {};
}

export function calculatePrice(config, resources, interval = 'monthly') {
  const cpu = int(resources.cpuCores ?? resources.cpu, config.min_cpu);
  const memory = int(resources.memoryMb ?? resources.memory, config.min_memory_mb);
  const disk = int(resources.diskGb ?? resources.disk, config.min_disk_gb);
  const network = int(resources.networkGb ?? resources.network, 0);
  const instances = int(resources.instances, 1);
  const raw = cpu * config.price_cpu + memory * config.price_memory_mb + disk * config.price_disk_gb + network * config.price_network_gb + instances * config.price_instance;
  const discount = interval === 'yearly' ? (config.yearly_discount_percent || 0) / 100 : 0;
  const discounted = Math.round(raw * (1 - discount));
  const tax = Math.round(discounted * ((config.tax_percent || 0) / 100));
  return {
    cpuCores: cpu, memoryMb: memory, diskGb: disk, networkGb: network, instances,
    subtotal: raw, discountPercent: interval === 'yearly' ? config.yearly_discount_percent : 0,
    discountAmount: raw - discounted, taxAmount: tax, total: discounted + tax,
    currency: config.currency, interval,
  };
}

export function validateResources(config, resources) {
  const cpu = int(resources.cpuCores ?? resources.cpu, 0);
  const memory = int(resources.memoryMb ?? resources.memory, 0);
  const disk = int(resources.diskGb ?? resources.disk, 0);
  if (cpu < config.min_cpu || cpu > config.max_cpu) throw badRequest('cpu_out_of_range');
  if (memory < config.min_memory_mb || memory > config.max_memory_mb) throw badRequest('memory_out_of_range');
  if (disk < config.min_disk_gb || disk > config.max_disk_gb) throw badRequest('disk_out_of_range');
  if (cpu % config.step_cpu !== 0) throw badRequest('invalid_cpu_increment');
  if (memory % config.step_memory_mb !== 0) throw badRequest('invalid_memory_increment');
  if (disk % config.step_disk_gb !== 0) throw badRequest('invalid_disk_increment');
  return { cpuCores: cpu, memoryMb: memory, diskGb: disk, networkGb: int(resources.networkGb, 0), instances: int(resources.instances, 1) };
}

export function planPrice(plan, interval = 'monthly') {
  if (interval === 'yearly' && plan.price_yearly) return plan.price_yearly;
  if (interval === 'yearly') return plan.price_monthly * 10; // 2 months free fallback
  return plan.price_monthly;
}

export function getPlan(id) {
  const plan = getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!plan) throw badRequest('plan_not_found');
  return plan;
}

export function publicPlan(p, interval = 'monthly') {
  return {
    id: p.id, name: p.name, description: p.description, category: p.category, productId: p.product_id,
    cpuCores: p.cpu_cores, memoryMb: p.memory_mb, diskGb: p.disk_gb, networkGb: p.network_gb,
    instances: p.instances, price: planPrice(p, interval), priceMonthly: p.price_monthly, priceYearly: p.price_yearly,
    currency: p.currency, interval, features: parse(p.features, []), restrictions: parse(p.restrictions, []),
    status: p.status, featured: !!p.featured, available: !!p.available, sortOrder: p.sort_order,
  };
}
function parse(v, f) { try { return JSON.parse(v || ''); } catch { return f; } }
