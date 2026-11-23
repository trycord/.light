// .light — runtime-editable configuration persisted alongside the database.
// Environment variables remain the initial source of truth; values saved by
// an administrator in the control center override them.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.SETTINGS_PATH || path.join(ROOT, 'data', 'settings.json');

export const SETTINGS_SCHEMA = Object.freeze({
  // General
  PLATFORM_DOMAIN: { section: 'general', label: 'Platform domain', type: 'text' },
  CONTROL_BASE_URL: { section: 'general', label: 'Control base URL', type: 'text' },
  ALLOW_SIGNUP: { section: 'general', label: 'Allow public sign-up', type: 'bool' },
  ALLOW_CUSTOM_PLANS: { section: 'general', label: 'Allow Build Your Own Plan', type: 'bool' },
  AUTO_DEPS_ENABLED: { section: 'runtime', label: 'Automatic dependency installation', type: 'bool', default: true },
  // Credits (temporary until Stripe replaces it)
  AD_CREDIT_REWARD: { section: 'credits', label: 'Credits per completed ad', type: 'number', default: 100 },
  AD_COOLDOWN_SECONDS: { section: 'credits', label: 'Seconds between ads', type: 'number', default: 30 },
  // Node topology — lets an operator link a second machine from settings
  NODE_ROLE: { section: 'nodes', label: 'Node role (primary / subjunct)', type: 'select', options: ['primary', 'subjunct'], default: 'primary' },
  SUBJUNT_CONTROL_URL: { section: 'nodes', label: 'Primary control plane URL (subjunct nodes)', type: 'text' },
  SUBJUNT_NODE_TOKEN: { section: 'nodes', label: 'Node token from primary (subjunct nodes)', type: 'secret' },
  SUBJUNT_NODE_NAME: { section: 'nodes', label: 'This node name (subjunct nodes)', type: 'text' },
  // Payments
  CRYPTO_ENABLED: { section: 'crypto', label: 'Accept crypto payments (decentralized, no KYC)', type: 'bool', default: false },
  CRYPTO_NETWORK: { section: 'crypto', label: 'Network (e.g. polygon, bsc, ethereum)', type: 'text', default: 'polygon' },
  CRYPTO_TOKEN: { section: 'crypto', label: 'Token symbol (USDC, USDT, ETH…)', type: 'text', default: 'USDC' },
  CRYPTO_TOKEN_CONTRACT: { section: 'crypto', label: 'Token contract address (blank = native coin)', type: 'text' },
  CRYPTO_WALLET: { section: 'crypto', label: 'Receiving wallet address', type: 'text' },
  CRYPTO_EXPLORER_API: { section: 'crypto', label: 'Explorer API base URL (Etherscan-compatible)', type: 'text' },
  CRYPTO_API_KEY: { section: 'crypto', label: 'Explorer API key (optional)', type: 'secret' },
  CRYPTO_CONFIRMATIONS: { section: 'crypto', label: 'Confirmations required', type: 'number', default: 12 },
  STRIPE_SECRET_KEY: { section: 'payments', label: 'Stripe secret key', type: 'secret' },
  STRIPE_WEBHOOK_SECRET: { section: 'payments', label: 'Stripe webhook secret (thin V2)', type: 'secret' },
  STRIPE_SUB_WEBHOOK_SECRET: { section: 'payments', label: 'Stripe subscription webhook secret', type: 'secret' },
  PLATFORM_PRICE_ID: { section: 'payments', label: 'Platform subscription Price ID (price_…)', type: 'text' },
  CONNECT_APP_FEE_CENTS: { section: 'payments', label: 'Connect application fee (cents)', type: 'number' },
  CONNECT_RETURN_URL: { section: 'payments', label: 'Connect return URL', type: 'text' },
  // Cloudflare
  CLOUDFLARE_API_TOKEN: { section: 'cloudflare', label: 'Cloudflare API token', type: 'secret' },
  CLOUDFLARE_ACCOUNT_ID: { section: 'cloudflare', label: 'Account ID', type: 'text' },
  CLOUDFLARE_ZONE_ID: { section: 'cloudflare', label: 'Zone ID', type: 'text' },
  CLOUDFLARE_DOMAIN: { section: 'cloudflare', label: 'Zone domain', type: 'text' },
  // Mail
  EMAIL_ENABLED: { section: 'mail', label: 'Enable outbound email', type: 'bool' },
  EMAIL_PROVIDER: { section: 'mail', label: 'Provider (deomail/smtp)', type: 'text' },
  DEOMAIL_API_KEY: { section: 'mail', label: 'DeoMail API key', type: 'secret' },
  DEOMAIL_FROM_EMAIL: { section: 'mail', label: 'DeoMail from address', type: 'text' },
  DEOMAIL_API_URL: { section: 'mail', label: 'DeoMail API URL', type: 'text' },
  SMTP_HOST: { section: 'mail', label: 'SMTP host', type: 'text' },
  SMTP_PORT: { section: 'mail', label: 'SMTP port', type: 'number' },
  SMTP_USER: { section: 'mail', label: 'SMTP user', type: 'text' },
  SMTP_PASSWORD: { section: 'mail', label: 'SMTP password', type: 'secret' },
  SMTP_FROM: { section: 'mail', label: 'SMTP from address', type: 'text' },
  SMTP_SECURE: { section: 'mail', label: 'SMTP TLS', type: 'bool' },
  // Proxy / runtime
  CADDY_ADMIN_URL: { section: 'proxy', label: 'Caddy admin API URL', type: 'text' },
  PLATFORM_IP: { section: 'proxy', label: 'Platform IP', type: 'text' },
  LIGHT_RUNTIME_IMAGE_MODE: { section: 'runtime', label: 'Runtime image mode', type: 'text' },
  LIGHT_RUNTIME_IMAGE: { section: 'runtime', label: 'Runtime image repository', type: 'text' },
  LIGHT_RUNTIME_IMAGE_VERSION: { section: 'runtime', label: 'Runtime image version', type: 'text' },
});

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = {}; }
  return cache;
}

/** Effective value: admin setting > environment > fallback. */
export function get(key, fallback = '') {
  const stored = load();
  if (Object.prototype.hasOwnProperty.call(stored, key)) return stored[key];
  if (process.env[key] !== undefined) return process.env[key];
  return fallback;
}

export function bool(key, fallback = false) {
  const value = get(key, undefined);
  if (value === undefined) return fallback;
  return String(value).toLowerCase() !== 'false' && value !== '0' && value !== '';
}

/** Masked view for the admin UI; secrets are never returned in cleartext. */
export function publicSettings() {
  const result = {};
  for (const [key, meta] of Object.entries(SETTINGS_SCHEMA)) {
    let value = get(key, '');
    if (meta.type === 'secret') value = value ? '••••••••' : '';
    result[key] = { value, ...meta };
  }
  return result;
}

/** Persist only known keys. Empty secrets leave the existing value untouched. */
export function updateSettings(values = {}) {
  const current = load();
  for (const [key, meta] of Object.entries(SETTINGS_SCHEMA)) {
    if (!(key in values)) continue;
    let value = values[key];
    if (meta.type === 'secret' && (value === '' || value === '••••••••' || value === undefined)) continue;
    if (meta.type === 'bool') value = (value === true || value === 'true' || value === '1' || value === 'on') ? 'true' : 'false';
    if (meta.type === 'number') value = String(Number(value) || 0);
    current[key] = String(value ?? '');
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2), { mode: 0o600 });
  cache = current;
  return publicSettings();
}
