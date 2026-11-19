import dotenv from 'dotenv';
import autoSecrets from './secrets.js';

dotenv.config();
autoSecrets();

const port = parseInt(process.env.PORT || '5858', 10);
const host = process.env.HOST || '0.0.0.0';
const env = process.env.NODE_ENV || 'development';
const logLevel = process.env.LOG_LEVEL || 'info';
const bool = (v, d = true) => (v === undefined ? d : String(v).toLowerCase() !== 'false');

const config = {
  env,
  port,
  host,
  logLevel,
  ltMode: process.env.LT_MODE || 'all',

  // Storage / database
  databasePath: process.env.DATABASE_PATH || './data/trycord-light.db',
  dataDir: process.env.DATA_DIR || './data',

  // Security (auto-generated when unset)
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me',
  nodeToken: process.env.NODE_TOKEN || null,
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),

  // Branding — fully configurable by the self-hoster
  brand: {
    product: process.env.BRAND_PRODUCT || '.light',
    owner: process.env.BRAND_OWNER || 'Trycord',
    attribution: process.env.BRAND_ATTRIBUTION || '.light is a Trycord product',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'support@trycord.dev',
    tagline: process.env.BRAND_TAGLINE || 'Universal hosting platform',
    primaryColor: process.env.BRAND_PRIMARY_COLOR || '#FF4D24',
    accentColor: process.env.BRAND_ACCENT_COLOR || '#4C9B8A',
    mark: process.env.BRAND_MARK || 'ΔΓΟ',
    favicon: process.env.BRAND_FAVICON || '/assets/logos/favicon.svg',
    logo: process.env.BRAND_LOGO || '/assets/logos/light-primary.svg',
    wordmark: process.env.BRAND_WORDMARK || '/assets/logos/light-wordmark.svg',
    background: process.env.BRAND_BACKGROUND || '/assets/backgrounds/volcanic-strata-16x9.svg',
    docTitle: process.env.BRAND_DOC_TITLE || '.light — Trycord Hosting',
  },

  // Universal domain
  platformDomain: process.env.PLATFORM_DOMAIN || 'trycord.dev',
  controlBaseUrl: process.env.CONTROL_BASE_URL || 'https://trycord.dev',

  // Email (opt-in, disabled by default)
  email: {
    enabled: bool(process.env.EMAIL_ENABLED, false),
    provider: process.env.EMAIL_PROVIDER || 'deomail',
    deomail: {
      apiKey: process.env.DEOMAIL_API_KEY || '',
      fromEmail: process.env.DEOMAIL_FROM_EMAIL || '',
      apiUrl: process.env.DEOMAIL_API_URL || 'https://api.deomail.com',
      timeoutMs: parseInt(process.env.DEOMAIL_TIMEOUT_MS || '10000', 10),
      retries: parseInt(process.env.DEOMAIL_RETRIES || '2', 10),
    },
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      from: process.env.SMTP_FROM || '',
      secure: bool(process.env.SMTP_SECURE, true),
    },
  },

  // Container / agent
  nodeImage: process.env.LIGHT_NODE_IMAGE || 'trycord/light:latest',
  controlPlaneImage: process.env.CONTROL_PLANE_IMAGE || 'trycord/light:latest',
};

if (config.env === 'production' && config.jwtSecret === 'dev-insecure-jwt-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
if (config.env === 'production' && !config.nodeToken) {
  throw new Error('NODE_TOKEN must be set in production');
}

// Validate email config only when enabled (fail fast with clear message).
if (config.email.enabled) {
  if (config.email.provider === 'deomail') {
    if (!config.email.deomail.apiKey) throw new Error('DEOMAIL_API_KEY is required when EMAIL_ENABLED=true');
    if (!config.email.deomail.fromEmail) throw new Error('DEOMAIL_FROM_EMAIL is required when EMAIL_ENABLED=true');
  } else if (config.email.provider === 'smtp') {
    const s = config.email.smtp;
    if (!s.host || !s.from) throw new Error('SMTP_HOST and SMTP_FROM are required when EMAIL_ENABLED=true with SMTP provider');
  }
}

export default config;
