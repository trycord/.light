// .light — email provider abstraction.
// EmailService → provider (DeoMail / SMTP) → provider API.
// No email requests are made when EMAIL_ENABLED=false.
import config from '../config.js';
import { get, bool } from '../settings.js';

function mailConfig() {
  return {
    enabled: bool('EMAIL_ENABLED', false),
    provider: String(get('EMAIL_PROVIDER', 'deomail') || 'deomail'),
    deomail: {
      apiKey: String(get('DEOMAIL_API_KEY', '') || ''),
      fromEmail: String(get('DEOMAIL_FROM_EMAIL', '') || ''),
      apiUrl: String(get('DEOMAIL_API_URL', 'https://api.deomail.com') || 'https://api.deomail.com'),
      timeoutMs: 10000, retries: 2,
    },
    smtp: {
      host: String(get('SMTP_HOST', '') || ''),
      port: Number(get('SMTP_PORT', '587') || 587),
      user: String(get('SMTP_USER', '') || ''),
      password: String(get('SMTP_PASSWORD', '') || ''),
      from: String(get('SMTP_FROM', '') || ''),
      secure: bool('SMTP_SECURE', true),
    },
  };
}

class DeomailProvider {
  constructor(cfg) { this.cfg = cfg; }
  async send({ to, subject, html, text }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let lastError;
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      try {
        const res = await fetch(`${this.cfg.apiUrl}/v1/send`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'X-API-Key': this.cfg.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: this.cfg.fromEmail, to: Array.isArray(to) ? to : [to], subject, html, text }),
        });
        if (res.status === 401 || res.status === 403) throw new Error('invalid_api_key');
        if (res.status === 429) throw new Error('rate_limited');
        if (res.status === 500) throw new Error('provider_error');
        if (!res.ok) throw new Error(`provider_http_${res.status}`);
        const body = await res.json().catch(() => ({}));
        if (body.success === false || body.error) throw new Error('provider_rejected');
        return { delivered: true, provider: 'deomail', id: body.id || body.messageId || null };
      } catch (error) {
        lastError = error;
        if (error.message === 'invalid_api_key') break; // no retry on auth errors
        // bounded retry with small backoff
        if (attempt < this.cfg.retries) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
    clearTimeout(timer);
    return { delivered: false, provider: 'deomail', error: lastError?.message || 'send_failed' };
  }
}

class SmtpProvider {
  constructor(cfg) { this.cfg = cfg; }
  async send({ to, subject, html, text }) {
    // SMTP support requires nodemailer; use it when available, otherwise fail clearly.
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.cfg.host, port: this.cfg.port, secure: this.cfg.secure,
        auth: this.cfg.user ? { user: this.cfg.user, pass: this.cfg.password } : undefined,
      });
      await transporter.sendMail({ from: this.cfg.from, to, subject, html, text });
      return { delivered: true, provider: 'smtp' };
    } catch (error) {
      return { delivered: false, provider: 'smtp', error: error.code === 'ERR_MODULE_NOT_FOUND' ? 'smtp_provider_not_installed' : error.message };
    }
  }
}

let provider;
let providerKey = '';
function getProvider() {
  const cfg = mailConfig();
  if (!cfg.enabled) return null;
  const key = `${cfg.provider}:${cfg.deomail.apiKey}:${cfg.smtp.host}:${cfg.smtp.user}`;
  if (!provider || providerKey !== key) {
    provider = cfg.provider === 'smtp' ? new SmtpProvider(cfg.smtp) : new DeomailProvider(cfg.deomail);
    providerKey = key;
  }
  return provider;
}

export function emailEnabled() { return mailConfig().enabled; }

export async function sendEmail(message) {
  if (!mailConfig().enabled) return { delivered: false, skipped: true, reason: 'email_disabled' };
  const p = getProvider();
  try {
    const result = await p.send(message);
    if (!result.delivered) console.error('[email] delivery failed:', result.error);
    return result;
  } catch (error) {
    console.error('[email] send error:', error.message);
    return { delivered: false, error: error.message };
  }
}
