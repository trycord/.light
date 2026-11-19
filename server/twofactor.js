// .light — TOTP-based two-factor authentication (RFC 6238).
import crypto from 'crypto';
import { getDb } from './db.js';
import { id, now } from './util.js';
import { encrypt, decrypt } from './crypto.js';

function base32(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = ''; for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function fromBase32(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of String(str).toUpperCase()) { const i = alphabet.indexOf(c); if (i >= 0) bits += i.toString(2).padStart(5, '0'); }
  const buf = []; for (let i = 0; i + 8 <= bits.length; i += 8) buf.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(buf);
}
function totp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', fromBase32(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
export function generateSecret() { return base32(crypto.randomBytes(20)); }

export function setup(userId, secret) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM two_factor WHERE user_id = ?').get(userId);
  if (existing) db.prepare('UPDATE two_factor SET secret = ?, enabled = 0, created_at = ? WHERE user_id = ?').run(encrypt(secret), now(), userId);
  else db.prepare('INSERT INTO two_factor (user_id, secret, enabled, backup_codes, created_at) VALUES (?, ?, 0, ?, ?)').run(userId, encrypt(secret), '[]', now());
  return { secret, otpauthUrl: `otpauth://totp/.light:${encodeURIComponent(userId)}?secret=${secret}&issuer=.light&algorithm=SHA1&digits=6&period=30` };
}

export function verify(userId, code) {
  const row = getDb().prepare('SELECT * FROM two_factor WHERE user_id = ? AND enabled = 1').get(userId);
  if (!row) return false;
  const secret = decrypt(row.secret);
  const counter = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    if (totp(secret, counter + offset) === String(code)) return true;
  }
  // backup codes
  const codes = JSON.parse(row.backup_codes || '[]');
  const idx = codes.indexOf(String(code));
  if (idx >= 0) { codes.splice(idx, 1); getDb().prepare('UPDATE two_factor SET backup_codes = ? WHERE user_id = ?').run(JSON.stringify(codes), userId); return true; }
  return false;
}

export function enable(userId, code) {
  // Verify against the stored secret directly (row exists but enabled=0 before enabling).
  const row = getDb().prepare('SELECT * FROM two_factor WHERE user_id = ?').get(userId);
  if (!row) return false;
  const secret = decrypt(row.secret);
  const counter = Math.floor(Date.now() / 30000);
  let valid = false;
  for (const offset of [-1, 0, 1]) if (totp(secret, counter + offset) === String(code)) { valid = true; break; }
  if (!valid) return false;
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'));
  getDb().prepare('UPDATE two_factor SET enabled = 1, backup_codes = ?, enabled_at = ? WHERE user_id = ?').run(JSON.stringify(codes), now(), userId);
  return { enabled: true, backupCodes: codes };
}

export function disable(userId, code) {
  if (!verify(userId, code)) return false;
  getDb().prepare('UPDATE two_factor SET enabled = 0, backup_codes = ? WHERE user_id = ?').run('[]', userId);
  return { enabled: false };
}

export function status(userId) {
  const row = getDb().prepare('SELECT enabled, enabled_at FROM two_factor WHERE user_id = ?').get(userId);
  return { enabled: Boolean(row?.enabled), enabledAt: row?.enabled_at || null };
}
