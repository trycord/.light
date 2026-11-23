// .light — on-chain crypto payments (decentralized, no KYC).
// No private keys, no custody: we publish a receiving address and watch the
// public explorer for a transfer of the exact expected amount. Once confirmed,
// the referenced order/subscription is activated.
import { getDb } from './db.js';
import { get } from './settings.js';
import { id, now } from './util.js';

export function config() {
  return {
    enabled: String(get('CRYPTO_ENABLED', 'false')) === 'true',
    network: get('CRYPTO_NETWORK', 'polygon'),
    token: get('CRYPTO_TOKEN', 'USDC'),
    contract: String(get('CRYPTO_TOKEN_CONTRACT', '') || '').trim(),
    wallet: String(get('CRYPTO_WALLET', '') || '').trim(),
    explorer: String(get('CRYPTO_EXPLORER_API', '') || '').replace(/\/$/, ''),
    apiKey: String(get('CRYPTO_API_KEY', '') || '').trim(),
    confirmations: Math.max(1, Number(get('CRYPTO_CONFIRMATIONS', 12)) || 12),
  };
}

/** Unique amount in token units with a 2-digit cents suffix to disambiguate. */
function expectedAmount(cents) {
  // cents -> token units with unique fraction, e.g. 999 -> 9.99 + 0.000099
  const base = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `${base}.${frac}`.replace(/^0\./, '.');
}

export function createPayment({ teamId, userId, kind, referenceId, amountCents }) {
  const c = config();
  if (!c.enabled || !c.wallet || !c.explorer) throw Object.assign(new Error('Crypto payments are not configured.'), { status: 400 });
  const pid = id('crypto');
  const ts = now();
  const expected = expectedAmount(amountCents);
  getDb().prepare(`INSERT INTO crypto_payments (id, team_id, user_id, kind, reference_id, amount, token, network, address, expected_raw, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, teamId, userId, kind, referenceId, amountCents, c.token, c.network, c.wallet, expected, 'awaiting', ts, ts);
  return {
    id: pid, address: c.wallet, amount: expected, token: c.token, network: c.network,
    note: `Send exactly ${expected} ${c.token} on ${c.network}. Payments are verified on-chain — no account or KYC required.`,
  };
}

async function explorer(path) {
  const c = config();
  const url = `${c.explorer}${path}${c.apiKey ? (path.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(c.apiKey) : ''}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`explorer_${r.status}`);
  return r.json();
}

/** Fetch recent transfers into the wallet from the public explorer. */
export async function fetchIncoming() {
  const c = config();
  if (!c.wallet) return [];
  if (c.contract) {
    const j = await explorer(`/api?module=account&action=tokentx&address=${c.wallet}&contractaddress=${c.contract}&sort=desc`);
    return (j.result || []).filter(t => (t.to || '').toLowerCase() === c.wallet.toLowerCase());
  }
  const j = await explorer(`/api?module=account&action=txlist&address=${c.wallet}&sort=desc`);
  return (j.result || []).filter(t => (t.to || '').toLowerCase() === c.wallet.toLowerCase());
}

/** Match on-chain transfers to awaiting payments. Returns newly confirmed. */
export async function watch(onConfirmed) {
  const c = config();
  if (!c.enabled || !c.wallet || !c.explorer) return [];
  const pending = getDb().prepare("SELECT * FROM crypto_payments WHERE status='awaiting' AND created_at > ?").all(now() - 24 * 3600 * 1000);
  if (!pending.length) return [];
  const txs = await fetchIncoming().catch(() => []);
  const confirmed = [];
  for (const p of pending) {
    const match = txs.find(t => {
      const raw = c.contract ? Number(t.value) / (10 ** Number(t.tokenDecimal || 18)) : Number(t.value) / 1e18;
      return raw.toFixed(6) === Number(p.expected_raw).toFixed(6) && Number(t.confirmations || 0) >= c.confirmations;
    });
    if (!match) continue;
    getDb().prepare("UPDATE crypto_payments SET status='confirmed', tx_hash=?, confirmations=?, updated_at=? WHERE id=?")
      .run(match.hash, Number(match.confirmations), now(), p.id);
    confirmed.push(p);
    if (onConfirmed) { try { await onConfirmed(p, match.hash); } catch (e) { console.error('[crypto] confirm hook:', e.message); } }
  }
  return confirmed;
}

export function history(teamId) {
  return getDb().prepare('SELECT id, kind, reference_id, amount, token, network, address, expected_raw, status, tx_hash, confirmations, created_at FROM crypto_payments WHERE team_id=? ORDER BY created_at DESC LIMIT 50').all(teamId);
}

export function view(p) { return getDb().prepare('SELECT * FROM crypto_payments WHERE id=?').get(p); }
