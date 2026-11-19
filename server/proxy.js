// .light — reverse proxy + TLS certificate management.
// Generates a Caddyfile from verified domains and applies it via Caddy admin API
// when configured; otherwise exposes the config for manual application.
import { getDb } from './db.js';
import { id, now } from './util.js';

function caddyAdmin() { return process.env.CADDY_ADMIN_URL || 'http://127.0.0.1:2019'; }
function caddyEnabled() { return Boolean(process.env.CADDY_ADMIN_URL); }

export function generateConfig() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT d.domain, d.id AS domain_id, i.ports_json, n.host AS node_host
    FROM domains d JOIN instances i ON i.id = d.instance_id
    LEFT JOIN nodes n ON n.id = i.node_id
    WHERE d.verified = 1 AND d.status = 'active'
  `).all();
  const lines = ['# .light reverse proxy config — generated automatically', '# Managed by the control plane. Do not edit manually.', ''];
  for (const r of rows) {
    let port = 80;
    try { const ports = JSON.parse(r.ports_json || '[]'); if (ports[0]?.container) port = ports[0].container; } catch { /* default */ }
    const upstream = r.node_host && r.node_host !== '127.0.0.1' ? r.node_host : '127.0.0.1';
    lines.push(r.domain, '  tls {', '    issuer acme', '  }', `  reverse_proxy ${upstream}:${port}`, '');
  }
  return lines.join('\n');
}

export async function applyConfig() {
  const config = generateConfig();
  if (!caddyEnabled()) return { applied: false, reason: 'caddy_not_configured', config };
  try {
    const res = await fetch(`${caddyAdmin()}/load`, { method: 'POST', headers: { 'Content-Type': 'text/caddyfile' }, body: config });
    if (!res.ok) throw new Error(`caddy_${res.status} ${(await res.text()).slice(0, 200)}`);
    return { applied: true, config };
  } catch (e) { return { applied: false, reason: e.message, config }; }
}

export function sslStatus(domain) {
  const db = getDb();
  const row = db.prepare('SELECT verified, ssl_status FROM domains WHERE domain = ?').get(domain);
  if (!row) return { status: 'unknown' };
  if (!row.verified) return { status: 'pending', reason: 'domain_not_verified' };
  return { status: row.ssl_status };
}

export function markCertificate(domain, status) {
  getDb().prepare('UPDATE domains SET ssl_status = ? WHERE domain = ?').run(status, domain);
}

export function dnsInstructions(domain, platformIp) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM domains WHERE domain = ?').get(domain);
  return {
    domain,
    records: [
      { type: 'A', name: domain, value: platformIp || process.env.PLATFORM_IP || 'YOUR_PLATFORM_IP', note: 'Point to the .light platform' },
      { type: 'TXT', name: `_light.${domain}`, value: `lt-verify=${row?.id || 'DOMAIN_ID'}`, note: 'Ownership verification' },
    ],
  };
}

export function isConfigured() { return { caddy: caddyEnabled(), platformIp: Boolean(process.env.PLATFORM_IP) }; }
