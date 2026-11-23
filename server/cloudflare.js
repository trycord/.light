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

/**
 * DNS strategy: one CNAME per hostname is precise but consumes the zone's
 * 200-record budget. When a zone is running low, fall back to a single wildcard
 * CNAME pointing at a SHARED routing tunnel, with per-hostname ingress rules.
 * `provisionDomainRoute` picks the strategy based on available records.
 */
async function ensureDns(hostname, tunnelId, opts = {}) {
  const c = cloudflareConfig();
  const records = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`);
  const target = `${tunnelId}.cfargotunnel.com`;
  if (opts.wildcard) {
    // One wildcard record for the whole platform domain, pointed at the shared
    // tunnel. Hostname routing is handled by that tunnel's ingress config.
    const base = String(c.domain).toLowerCase();
    const wildcard = `*.${base}`;
    const wr = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(wildcard)}&type=CNAME`);
    if (Array.isArray(wr) && wr.length) {
      if (wr[0].content !== `${opts.sharedTunnelId}.cfargotunnel.com`) {
        await cf(`/zones/${c.zoneId}/dns_records/${wr[0].id}`, {
          method: 'PATCH', body: { name: wildcard, type: 'CNAME', content: `${opts.sharedTunnelId}.cfargotunnel.com`, proxied: true, ttl: 1 },
        });
      }
    } else {
      await cf(`/zones/${c.zoneId}/dns_records`, {
        method: 'POST', body: { name: wildcard, type: 'CNAME', content: `${opts.sharedTunnelId}.cfargotunnel.com`, proxied: true, ttl: 1 },
      });
    }
    return { mode: 'wildcard', wildcard };
  }
  if (Array.isArray(records) && records.length) {
    if (records[0].content !== target) {
      await cf(`/zones/${c.zoneId}/dns_records/${records[0].id}`, {
        method: 'PATCH', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 },
      });
    }
  } else {
    await cf(`/zones/${c.zoneId}/dns_records`, {
      method: 'POST', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 },
    });
  }
  return { mode: 'per-host' };
}

/** Count DNS records in the zone so we can switch to wildcard mode early. */
export async function dnsUsage() {
  if (!isCloudflareConfigured()) return { used: 0, limit: 200 };
  const c = cloudflareConfig();
  const response = await fetch(`${API}/zones/${c.zoneId}/dns_records?per_page=1`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error('cloudflare_dns_usage_failed');
  const used = Number(body.result_info?.total ?? (Array.isArray(body.result) ? body.result.length : 0));
  return { used, limit: 200, remaining: 200 - used };
}

/** Provision a vanity alias (name.trycord.dev) pointing at a service's tunnel. */
export async function provisionAlias(aliasRow) {
  if (!isCloudflareConfigured()) return { status: 'configuration_required' };
  const c = cloudflareConfig();
  const instance = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(aliasRow.instance_id);
  if (!instance) throw new Error('instance_not_found');
  const domainRow = getDb().prepare("SELECT * FROM domains WHERE instance_id = ? AND tunnel_status = 'provisioned' ORDER BY created_at DESC LIMIT 1").get(instance.id);
  const tunnelId = domainRow?.tunnel_id || aliasRow.tunnel_id;
  const hostname = aliasRow.alias;
  if (tunnelId) {
    const target = `${tunnelId}.cfargotunnel.com`;
    const existing = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`).catch(() => []);
    if (Array.isArray(existing) && existing.length) {
      if (existing[0].content !== target) await cf(`/zones/${c.zoneId}/dns_records/${existing[0].id}`, { method: 'PATCH', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 } });
    } else {
      await cf(`/zones/${c.zoneId}/dns_records`, { method: 'POST', body: { name: hostname, type: 'CNAME', content: target, proxied: true, ttl: 1 } });
    }
    await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      method: 'PUT', body: { config: { ingress: [
        { hostname, service: serviceTarget(instance) },
        { service: 'http_status:404' },
      ] } },
    });
  }
  getDb().prepare("UPDATE aliases SET status='active', tunnel_id=?, updated_at=? WHERE id=?").run(tunnelId || null, now(), aliasRow.id);
  return { status: 'active', hostname, tunnelId };
}

export async function removeAlias(aliasRow) {
  if (!isCloudflareConfigured()) return;
  const c = cloudflareConfig();
  const records = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(aliasRow.alias)}&type=CNAME`).catch(() => []);
  for (const r of (Array.isArray(records) ? records : [])) await cf(`/zones/${c.zoneId}/dns_records/${r.id}`, { method: 'DELETE' }).catch(() => {});
}

/**
 * Game servers and databases are addressed with SRV records so clients connect
 * to a clean hostname without knowing the randomized port. The target is the
 * service's own subdomain (which has a CNAME to its tunnel).
 * e.g. _minecraft._tcp.mc.example.com -> 0 5 25565 mc.example.com
 */
const SRV_SPECS = {
  'minecraft-vanilla': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-paper': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-purpur': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-spigot': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-fabric': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-forge': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-neoforge': { prefix: '_minecraft._tcp', port: 25565 },
  'minecraft-bedrock': { prefix: '_minecraft._tcp', port: 19132 },
  postgres: { prefix: '_postgres._tcp', port: 5432 },
  mariadb: { prefix: '_mysql._tcp', port: 3306 },
  mongodb: { prefix: '_mongodb._tcp', port: 27017 },
  redis: { prefix: '_redis._tcp', port: 6379 },
};

async function ensureSrv(hostname, packageId, instance) {
  const spec = SRV_SPECS[packageId];
  if (!spec) return null;
  const c = cloudflareConfig();
  const name = `${spec.prefix}.${hostname}`;
  const content = `0 5 ${spec.port} ${hostname}`;
  const existing = await cf(`/zones/${c.zoneId}/dns_records?name=${encodeURIComponent(name)}&type=SRV`).catch(() => []);
  if (Array.isArray(existing) && existing.length) {
    if (existing[0].content !== content) {
      await cf(`/zones/${c.zoneId}/dns_records/${existing[0].id}`, { method: 'PATCH', body: { name, type: 'SRV', content, ttl: 1 } });
    }
  } else {
    await cf(`/zones/${c.zoneId}/dns_records`, { method: 'POST', body: { name, type: 'SRV', content, ttl: 1 } });
  }
  return { name, content };
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

/** One shared tunnel used only when wildcard DNS mode is active. */
async function ensureSharedTunnel() {
  const db = getDb(); const c = cloudflareConfig();
  const row = db.prepare("SELECT value FROM meta WHERE key = 'cloudflare_shared_tunnel'").get();
  if (row?.value) {
    const tokenRow = db.prepare("SELECT value FROM meta WHERE key = 'cloudflare_shared_token'").get();
    return { id: row.value, token: tokenRow?.value ? decrypt(tokenRow.value) : '' };
  }
  const tunnel = await cf(`/accounts/${c.accountId}/cfd_tunnel`, {
    method: 'POST', body: { name: 'light-shared-wildcard', config_src: 'cloudflare' },
  });
  const token = String(await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnel.id}/token`) || '');
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('cloudflare_shared_tunnel',?)").run(tunnel.id);
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('cloudflare_shared_token',?)").run(encrypt(token));
  return { id: tunnel.id, token };
}

/** Add/replace one hostname route in the shared tunnel's ingress. */
async function publishSharedIngress(tunnelId, hostname, instance) {
  const c = cloudflareConfig();
  const response = await fetch(`${API}/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  const body = await response.json().catch(() => ({}));
  const current = body.result?.config?.ingress || [];
  const rules = current.filter((r) => r.service !== 'http_status:404' && r.hostname !== hostname);
  rules.push({ hostname, service: serviceTarget(instance) });
  rules.push({ service: 'http_status:404' });
  await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT', body: { config: { ingress: rules } },
  });
  return { hostname, service: serviceTarget(instance) };
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
    // Use wildcard DNS when the zone is close to its 200-record limit.
    let dnsMode = 'per-host';
    let dnsStatus = 'ok';
    try {
      const usage = await dnsUsage();
      if (usage.remaining < 20) {
        // Shared wildcard tunnel: one DNS record + many hostname ingress rules.
        const shared = await ensureSharedTunnel();
        await ensureDns(hostname, shared.id, { wildcard: true, sharedTunnelId: shared.id });
        await publishSharedIngress(shared.id, hostname, instance);
        dnsMode = 'wildcard';
        getDb().prepare('UPDATE domains SET tunnel_id=?, routing_mode=? WHERE id=?').run(shared.id, 'wildcard', domainRow.id);
      } else {
        await ensureDns(hostname, tunnel.id);
        const route = await publishIngress(tunnel.id, hostname, instance);
      }
    } catch (error) { dnsStatus = `dns_failed: ${error.message.slice(0, 100)}`; console.error('[cloudflare] DNS:', dnsStatus); }
    const route = { hostname, service: serviceTarget(instance) };
    // Game servers and databases also get an SRV record for clean client
    // discovery (Minecraft, Postgres, MySQL, Mongo, Redis, …).
    try {
      const srv = await ensureSrv(hostname, instance.package_id, instance);
      if (srv) route.srv = srv;
    } catch (error) { console.error('[cloudflare] SRV:', error.message); }
    getDb().prepare("UPDATE domains SET tunnel_id=?, tunnel_status=?, ssl_status=?, updated_at=? WHERE id=?")
      .run(tunnel.id, dnsStatus === 'ok' ? 'provisioned' : 'dns_required', dnsStatus === 'ok' ? 'active' : 'pending', now(), domainRow.id);

    // Start/reuse the dedicated connector for this application. A dedicated
    // cloudflared image is used — the universal runtime image is for workloads,
    // not for connectors. Empty settings must not produce an invalid `":"` ref.
    const configuredImage = String(get('LIGHT_TUNNEL_IMAGE', '') || '').trim();
    const connectorImage = configuredImage || 'trycord/light-tunnel:1.0.0';
    queueCommand(instance.node_id || 'node-01', 'tunnel.start', {
      instanceId: instance.id, domainId: domainRow.id, hostname, token: tunnel.token,
      tunnelId: tunnel.id, image: connectorImage,
    }, instance.id);

    if (req) audit(req, 'cloudflare.tunnel.provision', 'domain', domainRow.id, { hostname, tunnelId: tunnel.id });
    return { status: 'provisioned', tunnelId: tunnel.id, hostname, service: route.service, srv: route.srv || null };
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
