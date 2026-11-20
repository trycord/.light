// .light — Cloudflare Tunnel provisioning for project subdomains.
// No credentials => honest "configuration_required". We never fabricate a
// tunnel or claim a domain is proxied when Cloudflare is not configured.
import { getDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { id, now, str } from './util.js';
import { audit } from './audit.js';
import { queueCommand } from './commands.js';

const API = 'https://api.cloudflare.com/client/v4';

export function cloudflareConfig() {
  return {
    token: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || '',
    domain: process.env.CLOUDFLARE_DOMAIN || process.env.PLATFORM_DOMAIN || 'trycord.dev',
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

function tunnelName(hostname) {
  return `light-${String(hostname).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60)}`;
}

/** Create (or reuse) a named tunnel, DNS record, and persist the connector token. */
export async function provisionTunnel(domainRow, req) {
  if (!isCloudflareConfigured()) {
    getDb().prepare('UPDATE domains SET tunnel_status = ? WHERE id = ?').run('configuration_required', domainRow.id);
    return { status: 'configuration_required', tunnelId: null };
  }
  const c = cloudflareConfig();
  const hostname = String(domainRow.domain).toLowerCase().replace(/\.$/, '');
  if (!hostname.endsWith(String(c.domain).toLowerCase())) {
    getDb().prepare('UPDATE domains SET tunnel_status = ? WHERE id = ?').run('outside_zone', domainRow.id);
    return { status: 'outside_zone', tunnelId: null };
  }
  let tunnelId = domainRow.tunnel_id || null;
  let token = domainRow.tunnel_token ? decrypt(domainRow.tunnel_token) : '';
  if (!tunnelId) {
    const tunnel = await cf(`/accounts/${c.accountId}/cfd_tunnel`, {
      method: 'POST', body: { name: tunnelName(hostname), config_src: 'cloudflare' },
    });
    tunnelId = tunnel.id;
    const tokenResult = await cf(`/accounts/${c.accountId}/cfd_tunnel/${tunnelId}/token`);
    token = String(tokenResult || '');
  }
  // Route the hostname to the tunnel via CNAME.
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
  getDb().prepare('UPDATE domains SET tunnel_id = ?, tunnel_token = ?, tunnel_status = ?, ssl_status = ?, updated_at = ? WHERE id = ?')
    .run(tunnelId, encrypt(token), 'provisioned', 'active', now(), domainRow.id);
  // Ask Shade to run the connector inside our approved image on the team network.
  const instance = getDb().prepare('SELECT node_id FROM instances WHERE id = ?').get(domainRow.instance_id);
  if (instance?.node_id && token) {
    queueCommand(instance.node_id, 'tunnel.start', {
      teamId: domainRow.team_id, hostname, token, image: `${process.env.LIGHT_RUNTIME_IMAGE || 'trycord/light-runtime'}:${process.env.LIGHT_RUNTIME_IMAGE_VERSION || '1.0.0'}`,
    }, domainRow.instance_id);
  }
  audit(req || {}, 'cloudflare.tunnel.provision', 'domain', domainRow.id, { hostname, tunnelId });
  return { status: 'provisioned', tunnelId, target };
}

export async function deleteTunnel(domainRow) {
  if (!isCloudflareConfigured() || !domainRow.tunnel_id) return { ok: false, reason: 'not_configured' };
  const c = cloudflareConfig();
  try {
    await cf(`/accounts/${c.accountId}/cfd_tunnel/${domainRow.tunnel_id}`, { method: 'DELETE' });
    const instance = getDb().prepare('SELECT node_id FROM instances WHERE id = ?').get(domainRow.instance_id);
    if (instance?.node_id) queueCommand(instance.node_id, 'tunnel.stop', { teamId: domainRow.team_id }, domainRow.instance_id);
    getDb().prepare('UPDATE domains SET tunnel_status = ?, tunnel_token = NULL, tunnel_id = NULL WHERE id = ?').run('deleted', domainRow.id);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}

/** Tunnel connector token for Shade (decrypted, only for its own service). */
export function connectorToken(domainRow) {
  return decrypt(domainRow.tunnel_token || '');
}
