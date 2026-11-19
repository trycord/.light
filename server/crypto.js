// .light — encryption helper for secrets at rest (tokens, API keys).
import crypto from 'crypto';
import config from './config.js';

const ALGO = 'aes-256-gcm';

function key() {
  // Derive a stable 32-byte key from JWT secret (operator-controlled, never exposed).
  return crypto.createHash('sha256').update(config.jwtSecret + ':light-secrets-v1').digest();
}

export function encrypt(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(value) {
  if (!String(value || '').startsWith('enc:v1:')) return String(value || '');
  try {
    const [, , ivB64, tagB64, dataB64] = String(value).split(':');
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}
