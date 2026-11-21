// .light — Cloudflare Tunnel integration: ONE tunnel per hosted application.
// Each service gets its own named tunnel, connector, DNS record and ingress route
// mapping its public hostname to the internal address:port of its workload.
import { getDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { id, now, str, json } from './util.js';
import { audit } from './audit.js';
import { queueCommand } from './commands.js';
import { get } from './settings.js';

const API = 'https://api.cloudflare.com/client/v4';

export function cloudflareConfig() {
  return {
    token: String(get('CLOUDFLARE_API_TOKEN', '') || ''),
    accountId: String(get('CLOUDFLARE_ACCOUNT_ID', '') || ''),
    zoneId: String(get('CLOUDFLARE_ZONE_ID', '') || ''),
    domain: String(get('CLOUDFLARE_DOMAIN', '') || get('PLATFORM_DOMAIN', 'trycord.dev') || 'trycord.dev'),
  };
}
export function isCloudflareConfigured() {
  const c = cloudflareConfig();
  return Boolean(c.token && c.accountId && c.zoneId);
}

async function cf(path, options = {}) {
  const c = cloudflareConfig();
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const detail = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${response.status}`;
    throw new Error(`cloudflare_${detail}`.slice(0, 400));
  }
  return body.result;
}

const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
}

function tunnelName(hostname) { return `light-${String(hostname).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48)}`; }

/** Internal service address cloudflared can reach. Connector uses host networking. */
function serviceTarget(instance) {
  let ports = [];
  try { ports = json(instance?.ports_json, []); } catch { ports = []; }
  const published = ports.find((p) => p.host)?.host;
  const containerPort = ports[0]?.container || 80;
  return `http://127.0.0.1:${published || containerPort}`;
}

/** Ensure a dedicated tunnel exists for this domain (per-application). */
async function ensureTunnel(domainRow, instance) {
  const db = getDb(); const c = cloudflareConfig();
  if (domainRow.tunnel_id && domainRow.tunnel_token) {
    return { id: domainRow.tunnel_id, token: decrypt(domainRow.tunnel_token), reused: true };
  }
  return withLock(domainRow.id, async () => {
    // Re-read inside lock.
    const fresh = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainRow.id);
    if (fresh?.tunnel_id && fresh?.tunnel_token) {
      return { id: fresh.tunnel_id, token: decrypt(fresh.tunnel_token), reused: true };
    }
    const tunnel = await cf(`/accounts/${c.accountId}/cfd_tunnel`, {
      method: 'POST', body: { name: tunnelName(domainRow.domain), config_src: 'cloudflare' },
    });
    const tokenResult = await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnel.id}/token`);
    const token = String(tokenResult || '');
    db.prepare('UPDATE domains SET tunnel_id = ?, tunnel_token = ?, updated_at = ? WHERE id = ?')
      .run(tunnel.id, encrypt(token), now(), domainRow.id);
    return { id: tunnel.id, token, reused: false };
  });
}

async function ensureDns(hostname, tunnelId) {
  const c = cloudflareConfig();
  const records = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`);
  const target = `${tunnelId}.cfargotunnel.com`;
  if (Array.isArray(records) && records.length) {
    await cf(`/zones/${c.zoneId}/dns_records/${records[0].id}`, {
      method: 'PATCH', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 },
    });
  } else {
    await cf(`/zones/${c.zoneId}/dns_records`, {
      method: 'POST', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 },
    });
  }
}

/** Publish the hostname -> internal service route into the tunnel's ingress. */
async function publishIngress(tunnelId, hostname, instance) {
  const c = cloudflareConfig();
  const service = serviceTarget(instance);
  const ingress = [
    { hostname, service },
    { service: 'http_status:404' },
  ];
  await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT', body: { config: { ingress } },
  });
  return { hostname, service };
}

/** Full provisioning of an application's public route. Idempotent + retryable. */
export async function provisionDomainRoute(domainRow, req) {
  if (!isCloudflareConfigured()) {
    getDb().prepare("UPDATE domains SET tunnel_status='configuration_required' WHERE id=?").run(domainRow.id);
    return { status: 'configuration_required' };
  }
  const c = cloudflareConfig();
  const hostname = String(domainRow.domain).toLowerCase().replace(/\.$/, '');
  if (!hostname.endsWith(String(c.domain).toLowerCase())) {
    getDb().prepare("UPDATE domains SET tunnel_status='outside_zone' WHERE id=?").run(domainRow.id);
    return { status: 'outside_zone' };
  }
  const instance = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(domainRow.instance_id);
  if (!instance) { getDb().prepare("UPDATE domains SET tunnel_status='no_service' WHERE id=?").run(domainRow.id); return { status: 'no_service' }; }

  try {
    const tunnel = await ensureTunnel(domainRow, instance);
    await ensureDns(hostname, tunnel.id);
    const route = await publishIngress(tunnel.id, hostname, instance);
    getDb().prepare("UPDATE domains SET tunnel_id=?, tunnel_status='provisioned', ssl_status='active', updated_at=? WHERE id=?")
      .run(tunnel.id, now(), domainRow.id);

    // Start/reuse the dedicated connector for this application.
    queueCommand(instance.node_id || 'node-01', 'tunnel.start', {
      instanceId: instance.id, domainId: domainRow.id, hostname, token: tunnel.token,
      tunnelId: tunnel.id, image: `${get('LIGHT_RUNTIME_IMAGE', 'trycord/light-runtime')}:${get('LIGHT_RUNTIME_IMAGE_VERSION', '1.0.0')}`,
    }, instance.id);

    if (req) audit(req, 'cloudflare.tunnel.provision', 'domain', domainRow.id, { hostname, tunnelId: tunnel.id });
    return { status: 'provisioned', tunnelId: tunnel.id, hostname, service: route.service };
  } catch (error) {
    getDb().prepare("UPDATE domains SET tunnel_status=?, updated_at=? WHERE id=?")
      .run(`failed: ${error.message.slice(0, 120)}`, now(), domainRow.id);
    throw error;
  }
}

/** Re-publish routes when an application's host port changes after provisioning. */
export async function refreshDomainRoutes(instanceId) {
  if (!isCloudflareConfigured()) return;
  const instance = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(instanceId);
  if (!instance) return;
  const domains = getDb().prepare("SELECT * FROM domains WHERE instance_id = ? AND tunnel_status = 'provisioned'").all(instanceId);
  for (const d of domains) {
    try { await publishIngress(d.tunnel_id, d.domain, instance); } catch { /* reconcile later */ }
  }
}

/** Delete the tunnel, DNS record and connector for an application. */
export async function removeDomainRoute(domainRow) {
  if (!isCloudflareConfigured()) return { ok: false, reason: 'not_configured' };
  const c = cloudflareConfig();
  const instance = getDb().prepare('SELECT node_id FROM instances WHERE id = ?').get(domainRow.instance_id);
  try {
    if (domainRow.tunnel_id) {
      await cf(`/accounts/${c.accountId}/cfd_tunnel/${domainRow.tunnel_id}`, { method: 'DELETE' }).catch(() => {});
    }
    const records = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(domainRow.domain)}&type=CNAME`).catch(() => []);
    for (const r of (Array.isArray(records) ? records : [])) {
      await cf(`/zones/${c.zoneId}/dns_records/${r.id}`, { method: 'DELETE' }).catch(() => {});
    }
    if (instance?.node_id) queueCommand(instance.node_id, 'tunnel.stop', { instanceId: domainRow.instance_id, domainId: domainRow.id }, domainRow.instance_id);
    getDb().prepare("UPDATE domains SET tunnel_status='removed', tunnel_token='', tunnel_id=NULL, updated_at=? WHERE id=?").run(now(), domainRow.id);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}

/** Check whether the configured token actually has the required permissions. */
export async function tokenCapabilities() {
  if (!isCloudflareConfigured()) return { configured: false, canTunnel: false, canDns: false, hint: 'Set CLOUDFLARE_API_TOKEN, ACCOUNT_ID and ZONE_ID' };
  const c = cloudflareConfig();
  const check = async (path) => {
    try {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${c.token}` } });
      const j = await r.json().catch(() => ({}));
      return r.ok && j.success !== false;
    } catch { return false; }
  };
  const [canTunnel, canDns] = await Promise.all([
    check(`/accounts/${c.accountId}/cfd_tunnel`),
    check(`/zones/${c.zoneId}/dns_records?per_page=1`),
  ]);
  return {
    configured: true, canTunnel, canDns,
    ready: canTunnel && canDns,
    hint: canTunnel && canDns ? 'Ready' :
      'Token needs Cloudflare Tunnel:Edit + DNS:Edit + Zone:Read permissions',
  };
}

export function allTunnels() {
  return getDb().prepare("SELECT id, domain, instance_id, tunnel_id, tunnel_status, ssl_status, updated_at FROM domains WHERE tunnel_id IS NOT NULL OR tunnel_status != 'pending' ORDER BY updated_at DESC").all()
    .map(d => ({ domainId: d.id, hostname: d.domain, instanceId: d.instance_id, tunnelId: d.tunnel_id,
      status: d.tunnel_status, sslStatus: d.ssl_status, updatedAt: d.updated_at }));
}
