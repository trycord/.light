// .light — Cloudflare Tunnel integration.
// Architecture: ONE persistent tunnel per hosting node, with published-application
// routes (hostname -> internal address:port) managed through Cloudflare's remote
// configuration API. A single connector per node serves every website on it.
import { getDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { id, now, str, json, conflict } from './util.js';
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

// Serialize per-node route reconciliation so concurrent domain adds cannot
// clobber each other's ingress rules.
const locks = new Map();
async function withNodeLock(nodeId, fn) {
  const prev = locks.get(nodeId) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  locks.set(nodeId, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(nodeId) === next) locks.delete(nodeId); }
}

function nodeTunnelName(nodeId) { return `light-node-${String(nodeId).replace(/[^a-z0-9-]/gi, '').slice(-24)}`; }

/** Get (or create) the persistent tunnel for a node. Idempotent. */
export async function ensureNodeTunnel(nodeId) {
  if (!isCloudflareConfigured()) throw new Error('cloudflare_not_configured');
  const db = getDb();
  const c = cloudflareConfig();
  let row = db.prepare('SELECT * FROM node_tunnels WHERE node_id = ?').get(nodeId);
  if (row?.tunnel_id && row.tunnel_token) return row;

  return withNodeLock(nodeId, async () => {
    // Re-check inside the lock.
    row = db.prepare('SELECT * FROM node_tunnels WHERE node_id = ?').get(nodeId);
    if (row?.tunnel_id && row.tunnel_token) return row;
    let tunnelId = row?.tunnel_id || '';
    let token = row?.tunnel_token ? decrypt(row.tunnel_token) : '';
    if (!tunnelId) {
      const tunnel = await cf(`/accounts/${c.accountId}/cfd_tunnel`, {
        method: 'POST', body: { name: nodeTunnelName(nodeId), config_src: 'cloudflare' },
      });
      tunnelId = tunnel.id;
    }
    if (!token) {
      const result = await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/token`);
      token = String(result || '');
    }
    if (!row) {
      db.prepare('INSERT INTO node_tunnels (node_id, tunnel_id, tunnel_token, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
        .run(nodeId, tunnelId, encrypt(token), 'provisioned', now(), now());
    } else {
      db.prepare('UPDATE node_tunnels SET tunnel_id=?, tunnel_token=?, status=?, updated_at=? WHERE node_id=?')
        .run(tunnelId, encrypt(token), 'provisioned', now(), nodeId);
    }
    // Start (or reuse) the single connector for this node.
    queueCommand(nodeId, 'tunnel.start', {
      nodeId, token, image: `${get('LIGHT_RUNTIME_IMAGE', 'trycord/light-runtime')}:${get('LIGHT_RUNTIME_IMAGE_VERSION', '1.0.0')}`,
    });
    return db.prepare('SELECT * FROM node_tunnels WHERE node_id = ?').get(nodeId);
  });
}

/** Ensure the DNS CNAME for a hostname points at the node tunnel. */
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

/** Rebuild the full published-application ingress for a node. */
export async function publishIngress(nodeId) {
  const db = getDb(); const c = cloudflareConfig();
  const tunnel = db.prepare('SELECT * FROM node_tunnels WHERE node_id = ?').get(nodeId);
  if (!tunnel?.tunnel_id) throw new Error('node_tunnel_missing');
  const rows = db.prepare(`SELECT d.domain, d.instance_id, i.ports_json, i.status AS service_status
    FROM domains d JOIN instances i ON i.id = d.instance_id
    WHERE i.node_id = ? AND d.verified = 1 AND d.status = 'active'`).all(nodeId);
  const ingress = [];
  for (const row of rows) {
    let ports = []; try { ports = json(row.ports_json, []); } catch { ports = []; }
    const hostPort = ports.find(p => p.host)?.host;
    const containerPort = ports[0]?.container || 80;
    // The connector runs with host networking on the node, so the published
    // host port is directly reachable at 127.0.0.1 on that node.
    const service = `http://127.0.0.1:${hostPort || containerPort}`;
    ingress.push({ hostname: row.domain, service });
  }
  ingress.push({ service: 'http_status:404' }); // required catch-all
  await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnel.tunnel_id}/configurations`, {
    method: 'PUT', body: { config: { ingress } },
  });
  db.prepare('UPDATE node_tunnels SET status=?, last_heartbeat=?, updated_at=? WHERE node_id=?')
    .run('synced', now(), now(), nodeId);
  return { routes: ingress.length - 1, ingress };
}

/** Provision routing for a domain on its service's node. */
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
  const instance = getDb().prepare('SELECT node_id FROM instances WHERE id = ?').get(domainRow.instance_id);
  const nodeId = instance?.node_id;
  if (!nodeId) { getDb().prepare("UPDATE domains SET tunnel_status='no_node' WHERE id=?").run(domainRow.id); return { status: 'no_node' }; }

  try {
    const tunnel = await ensureNodeTunnel(nodeId);
    await ensureDns(hostname, tunnel.tunnel_id);
    await publishIngress(nodeId);
    getDb().prepare("UPDATE domains SET tunnel_id=?, tunnel_status='provisioned', ssl_status='active', updated_at=? WHERE id=?")
      .run(tunnel.tunnel_id, now(), domainRow.id);
    if (req) audit(req, 'cloudflare.route.provision', 'domain', domainRow.id, { hostname, nodeId });
    return { status: 'provisioned', tunnelId: tunnel.tunnel_id, nodeId };
  } catch (error) {
    getDb().prepare("UPDATE domains SET tunnel_status=?, updated_at=? WHERE id=?")
      .run(`failed: ${error.message.slice(0, 120)}`, now(), domainRow.id);
    throw error;
  }
}

/** Remove a hostname's route; the shared tunnel/connector stay up. */
export async function removeDomainRoute(domainRow) {
  if (!isCloudflareConfigured()) return { ok: false, reason: 'not_configured' };
  const instance = getDb().prepare('SELECT node_id FROM instances WHERE id = ?').get(domainRow.instance_id);
  const nodeId = instance?.node_id;
  getDb().prepare("UPDATE domains SET tunnel_status='removed', updated_at=? WHERE id=?").run(now(), domainRow.id);
  if (nodeId) {
    try { await publishIngress(nodeId); } catch { /* best effort; reconciled later */ }
  }
  return { ok: true, nodeId };
}

export function nodeTunnelStatus(nodeId) {
  const row = getDb().prepare('SELECT node_id, tunnel_id, status, last_heartbeat, updated_at FROM node_tunnels WHERE node_id = ?').get(nodeId);
  return row || { node_id: nodeId, status: 'none' };
}
export function allNodeTunnels() {
  return getDb().prepare('SELECT node_id, tunnel_id, status, last_heartbeat, updated_at FROM node_tunnels ORDER BY updated_at DESC').all();
}
