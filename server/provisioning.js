// .light — automatic provisioning from a paid order.
// The order's plan snapshot is the authoritative configuration. No browser
// values, live plan edits or infrastructure details are consulted.
import { getDb } from './db.js';
import config from './config.js';
import { id, now, str, json, conflict } from './util.js';
import { resolveRuntime } from './runtime-catalog.js';
import { pickNode } from './api/instances.js';
import { queueCommand } from './commands.js';
import { provisionDomainRoute, isCloudflareConfigured } from './cloudflare.js';
import { addOrderEvent, incrementAttempt, markOrderFailed, markOrderActive } from './orders.js';
import { teamUsage } from './plans.js';
import { packageForProvisioning } from './packages.js';

function systemAudit(userId, action, targetType, targetId, details = {}) {
  getDb().prepare('INSERT INTO audit_logs (team_id, user_id, action, target_type, target_id, details, ip, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(null, userId, action, targetType, targetId, JSON.stringify(details), 'system', now());
}

function checkCapacity(teamId, snapshot) {
  const usage = teamUsage(teamId);
  const instances = Number(snapshot.instances) || 1;
  const memory = Number(snapshot.memoryMb) || 512;
  const disk = Number(snapshot.diskGb) || 4;
  if (usage.instances + 1 > instances) throw conflict('plan_instance_limit');
  if (usage.memoryMb + memory > memory) throw conflict('plan_memory_exceeded');
  if (usage.diskGb + disk > disk) throw conflict('plan_disk_exceeded');
}

/** Provision the service attached to a paid order. Safe to call repeatedly. */
export function provisionOrder(orderId) {
  const db = getDb();
  let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('order_not_found');
  if (order.instance_id) {
    const existing = db.prepare('SELECT * FROM instances WHERE id = ?').get(order.instance_id);
    if (existing) return { order, instance: existing, reused: true };
  }
  if (!['paid', 'queued', 'failed'].includes(order.status)) {
    throw conflict(`order_not_provisionable_${order.status}`);
  }

  incrementAttempt(order.id);
  db.prepare("UPDATE orders SET status = 'provisioning', failure_reason = '', updated_at = ? WHERE id = ?").run(now(), order.id);
  addOrderEvent(order.id, 'queued', 'Order queued for provisioning');
  addOrderEvent(order.id, 'provisioning', 'Resolving purchased plan configuration');

  try {
    const snapshot = json(order.plan_snapshot, {});
    checkCapacity(order.team_id, snapshot);
    addOrderEvent(order.id, 'provisioning', 'Capacity reserved; selecting runtime');

    // The purchased software package determines the runtime and version.
    const software = order.package_id ? packageForProvisioning(order.package_id, order.package_version) : null;
    const runtime = resolveRuntime(db, {
      environmentId: software?.runtimeId || order.environment_id,
      version: software?.runtimeVersion || order.runtime_version,
    });
    addOrderEvent(order.id, 'provisioning',
      software ? `Installing ${software.name} ${software.version} on ${runtime.environmentName} ${runtime.version}`
               : `Approved Debian runtime ${runtime.environmentName} ${runtime.version}`);

    const node = pickNode(null);
    if (!node) throw conflict('no_capacity_available');
    addOrderEvent(order.id, 'provisioning', 'Infrastructure node selected; creating workload');

    const cpu = Math.max(1, Number(snapshot.cpuCores) || 1);
    const memory = Math.max(128, Number(snapshot.memoryMb) || 512);
    const disk = Math.max(1, Number(snapshot.diskGb) || 4);
    const network = Number(snapshot.networkGb) || 0;
    const command = snapshot.command || (software?.startupTemplate ? software.startupTemplate
      .replace('${memoryMb}', String(memory)) : runtime.command) || '';
    const env = { ...(runtime.runtimeEnv || {}), ...(software ? json(order.package_config, {}) : {}) };
    const portSpecs = software?.ports?.length ? software.ports : runtime.exposedPorts;
    const portsFromCatalog = (portSpecs || []).map((p) => {
      const value = typeof p === 'object' ? String(p.container ?? p.port ?? '') : String(p);
      const m = value.match(/^(\d{1,5})(?:\/(tcp|udp))?$/);
      return m ? { container: Number(m[1]), host: 0, protocol: m[2] || 'tcp' } : null;
    }).filter(Boolean).slice(0, 20);

    const ts = now();
    const iid = id('ins');
    const price = Number(snapshot.priceMonthly || 0) || Number(snapshot.price || 0) || 0;

    db.transaction(() => {
      // Entitlement: activate the purchased plan before the workload exists.
      db.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE team_id = ? AND status = 'active'")
        .run(ts, ts, order.team_id);
      db.prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, custom_config, price_monthly, currency, started_at, created_at, updated_at)
        VALUES (?, ?, ?, 'active', 'order', ?, ?, ?, ?, ?, ?)`)
        .run(id('sub'), order.team_id, order.plan_id || null,
          order.plan_id ? '{}' : JSON.stringify(snapshot), price, order.currency, ts, ts, ts);

      db.prepare(`INSERT INTO instances (id, team_id, node_id, name, category, type, status, image, command, version,
        env_json, ports_json, volumes_json, cpu_cores, memory_mb, disk_gb, environment_id, environment_version,
        source, order_id, package_id, package_version, package_config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 'order', ?, ?, ?, ?, ?, ?)`)
        .run(iid, order.team_id, node.id, order.service_name || 'My service', software?.category || 'app',
          runtime.environmentName, runtime.imageRef, command, software?.version || runtime.version,
          JSON.stringify(env), JSON.stringify(portsFromCatalog), cpu, memory, disk,
          runtime.environmentId, software?.runtimeVersion || runtime.version,
          order.id, software?.id || null, software?.version || null, JSON.stringify(json(order.package_config, {})), ts, ts);

      db.prepare('UPDATE orders SET instance_id = ?, updated_at = ? WHERE id = ?').run(iid, ts, order.id);
    })();
    addOrderEvent(order.id, 'provisioning', 'Service record created; handing off to Shade');

    // Project subdomain + optional Cloudflare tunnel, same as any service.
    const slug = String(order.service_name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'app';
    const subdomain = `${slug}-${iid.slice(-6)}.${config.platformDomain}`;
    const domainId = id('dom');
    db.prepare("INSERT OR IGNORE INTO domains (id, team_id, instance_id, domain, verified, ssl_status, created_at) VALUES (?, ?, ?, ?, 1, 'active', ?)")
      .run(domainId, order.team_id, iid, subdomain, ts);
    const domainRow = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId);
    if (domainRow && isCloudflareConfigured()) {
      provisionDomainRoute(domainRow, null).catch(() => {});
    } else if (domainRow) {
      db.prepare("UPDATE domains SET tunnel_status = 'configuration_required', updated_at = ? WHERE id = ?").run(ts, domainId);
    }

    queueCommand(node.id, 'instance.create', {
      instanceId: iid, teamId: order.team_id, name: order.service_name || 'My service',
      image: runtime.imageRef, command: '', defaultCommand: command,
      env, ports: portsFromCatalog, volumes: [], cpu, memory, disk, version: software?.version || runtime.version,
      environmentId: runtime.environmentId, environmentVersion: software?.runtimeVersion || runtime.version,
      digest: runtime.digest, runtimeEnv: runtime.runtimeEnv || {}, workingDir: runtime.workingDir,
      healthcheck: runtime.healthcheck, security: runtime.security, orderId: order.id,
      // Product-aware package installation is handled by Shade.
      package: software ? { id: software.id, installKind: software.installKind,
        name: software.name, version: software.version, runtimeVersion: software.runtimeVersion,
        downloadUrl: software.downloadUrl, sha256: software.sha256,
        startupTemplate: software.startupTemplate, config: json(order.package_config, {}) } : null,
    }, iid);

    systemAudit(order.user_id, 'order.provision.start', 'order', order.id, { instanceId: iid, environmentId: runtime.environmentId });
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const instance = db.prepare('SELECT * FROM instances WHERE id = ?').get(iid);
    return { order, instance, reused: false };
  } catch (error) {
    markOrderFailed(order.id, error.message || String(error));
    systemAudit(order.user_id, 'order.provision.failed', 'order', order.id, { reason: error.message });
    return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), error: error.message, reused: false };
  }
}

/** Called when Shade reports the result of the provisioning command. */
export function handleProvisionResult(command, ok, result) {
  const db = getDb();
  const instance = command.instance_id ? db.prepare('SELECT * FROM instances WHERE id = ?').get(command.instance_id) : null;
  const orderId = instance?.order_id || json(command.payload || '{}', {}).orderId || null;
  if (!orderId) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || ['active', 'refunded', 'terminated'].includes(order.status)) return;
  if (ok) {
    addOrderEvent(orderId, 'starting', 'Service started; waiting for health checks');
    // Health is confirmed by Shade's periodic reports; activate on command success.
    markOrderActive(orderId);
    systemAudit(order.user_id, 'order.provision.success', 'order', orderId, { instanceId: instance.id });
    db.prepare("INSERT INTO notifications (id, user_id, team_id, type, title, message, data, read, created_at) VALUES (?, ?, ?, 'success', ?, ?, ?, 0, ?)")
      .run(id('ntf'), order.user_id, order.team_id, 'Your service is ready',
        `${order.service_name} has been provisioned and is running.`, JSON.stringify({ orderId, instanceId: instance.id }), now());
  } else {
    const reason = result?.error || 'provisioning_failed';
    markOrderFailed(orderId, reason);
    addOrderEvent(orderId, 'failed', reason);
    // Clean up any partial container without creating a second service.
    if (instance) queueCommand(instance.node_id, 'instance.remove', { instanceId: instance.id }, instance.id);
    db.prepare("INSERT INTO notifications (id, user_id, team_id, type, title, message, data, read, created_at) VALUES (?, ?, ?, 'danger', ?, ?, ?, 0, ?)")
      .run(id('ntf'), order.user_id, order.team_id, 'Provisioning failed', reason, JSON.stringify({ orderId }), now());
  }
}

/** Retry only paid/failed orders; never duplicates an existing service. */
export function retryOrder(orderId) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('order_not_found');
  if (order.instance_id) {
    // Service exists — just re-run provisioning idempotently (no new instance).
    return provisionOrder(order.id);
  }
  if (!['paid', 'failed'].includes(order.status)) throw conflict('order_not_retryable');
  db.prepare("UPDATE orders SET status = 'paid', failure_reason = '' WHERE id = ?").run(order.id);
  return provisionOrder(order.id);
}
