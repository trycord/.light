#!/usr/bin/env node
// .light — guided terminal setup.
// Zero dependencies: uses only Node built-ins. Safe to re-run (merges existing .env).
import fs from 'fs';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { createInterface } from 'readline/promises';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(ROOT, '.env');
const LOCAL_PID_FILE = path.join(ROOT, '.light-local.pid');
const LOCAL_LOG = path.join(ROOT, 'logs', 'local.log');
const SELF = fileURLToPath(import.meta.url);

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

export function parseEnv(text = '') {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

/** Update known keys in place, preserve comments/order, append missing keys. */
export function updateEnvText(existingText = '', values = {}) {
  const seen = new Set();
  const lines = String(existingText).replace(/\r\n/g, '\n').split('\n');
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || !(m[2] in values)) return line;
    seen.add(m[2]);
    const prefix = m[1] + (/\bexport\b/.test(line) ? 'export ' : '');
    return `${prefix}${m[2]}=${values[m[2]]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export function randomHex(bytes = 48) { return crypto.randomBytes(bytes).toString('hex'); }
export function randomNodeToken() { return 'n_' + randomHex(32); }
export function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*-_';
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + 'aA1!';
}
export function mask(value = '') {
  const s = String(value);
  if (!s) return '(not set)';
  return s.length <= 8 ? '•'.repeat(s.length) : s.slice(0, 3) + '•'.repeat(Math.min(10, s.length - 6)) + s.slice(-3);
}
export function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')); }
export function isValidPassword(v) { return typeof v === 'string' && v.length >= 10; }
export function isValidPort(v) { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 65535; }
export function isValidDomain(v) { return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(v || '')); }

export function parseArgs(argv = []) {
  const opts = { check: false, yes: false, docker: null, start: true, force: false, set: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '-c') opts.check = true;
    else if (a === '--yes' || a === '-y' || a === '--defaults') opts.yes = true;
    else if (a === '--docker') opts.docker = true;
    else if (a === '--local') opts.docker = false;
    else if (a === '--no-start') opts.start = false;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--set' && argv[i + 1]) { const [k, ...rest] = argv[++i].split('='); if (k) opts.set[k] = rest.join('='); }
    else if (a.startsWith('--set=')) { const [k, ...rest] = a.slice(6).split('='); if (k) opts.set[k] = rest.join('='); }
    else opts.unknown = [...(opts.unknown || []), a];
  }
  return opts;
}

/** Default values, with existing .env and --set overrides applied. */
export function buildDefaults(existing = {}, overrides = {}) {
  const d = {
    NODE_ENV: 'production',
    PORT: '5858',
    AGENT_PORT: '5859',
    HOST: '0.0.0.0',
    CONTROL_PLANE_PORT: '5858',
    LOG_LEVEL: 'info',
    LT_MODE: 'all',
    JWT_SECRET: '',
    NODE_TOKEN: '',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@trycord.dev',
    BOOTSTRAP_ADMIN_PASSWORD: '',
    BOOTSTRAP_ADMIN_NAME: 'Administrator',
    ALLOW_SIGNUP: 'true',
    PLATFORM_DOMAIN: 'trycord.dev',
    CONTROL_BASE_URL: 'https://trycord.dev',
    BRAND_PRODUCT: '.light',
    BRAND_OWNER: 'Trycord',
    BRAND_ATTRIBUTION: '.light is a Trycord product',
    BRAND_TAGLINE: 'Universal hosting platform',
    BRAND_SUPPORT_EMAIL: 'support@trycord.dev',
    BRAND_PRIMARY_COLOR: '#FF4D24',
    BRAND_ACCENT_COLOR: '#4C9B8A',
    BRAND_MARK: 'ΔΓΟ',
    BRAND_FAVICON: '/assets/logos/favicon.svg',
    BRAND_LOGO: '/assets/logos/light-primary.svg',
    BRAND_WORDMARK: '/assets/logos/light-wordmark.svg',
    BRAND_BACKGROUND: '/assets/backgrounds/volcanic-strata-16x9.svg',
    BRAND_DOC_TITLE: '.light — Trycord Hosting',
    LIGHT_NODE_ID: 'node-01',
    CONTROL_URL: 'http://127.0.0.1:5858',
    AGENT_DATA_DIR: '/var/lib/trycord-light',
    CLOUDFLARE_API_TOKEN: '',
    CLOUDFLARE_ACCOUNT_ID: '',
    CLOUDFLARE_ZONE_ID: '',
    CLOUDFLARE_DOMAIN: '',
    ALLOW_CUSTOM_PLANS: 'false',
    SSO_ENABLED: 'false',
    SSO_URL: '',
    SSO_LABEL: 'Continue with SSO',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    GITHUB_CALLBACK_URL: '',
    GITHUB_WEBHOOK_SECRET: '',
    CADDY_ADMIN_URL: '',
    PLATFORM_IP: '',
    EMAIL_ENABLED: 'false',
  };
  for (const [key, value] of Object.entries(existing)) d[key] = value;
  for (const [key, value] of Object.entries(overrides)) d[key] = value;
  // Re-derive dependent values only when the operator did not set them explicitly.
  d.CONTROL_PLANE_PORT = d.PORT;
  if (existing.CONTROL_URL === undefined && overrides.CONTROL_URL === undefined) d.CONTROL_URL = `http://127.0.0.1:${d.PORT}`;
  if (existing.CONTROL_BASE_URL === undefined && overrides.CONTROL_BASE_URL === undefined) d.CONTROL_BASE_URL = `http://localhost:${d.PORT}`;
  if (!d.JWT_SECRET) d.JWT_SECRET = randomHex(48);
  if (!d.NODE_TOKEN) d.NODE_TOKEN = randomNodeToken();
  if (!d.BOOTSTRAP_ADMIN_PASSWORD) d.BOOTSTRAP_ADMIN_PASSWORD = randomPassword();
  return d;
}

export async function portAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(Number(port), host, () => server.close(() => resolve(true)));
  });
}

export async function nativeModuleOk() {
  try { await import('better-sqlite3'); return true; } catch { return false; }
}

export function which(command) {
  const r = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function nodeVersionOk() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20) return { ok: false, detail: `Node ${major} is too old (needs >= 20)` };
  if (major >= 25) return { ok: false, detail: `Node ${major}.${minor} is newer than the supported 20–24 range (better-sqlite3 v11 may fail to compile)` };
  return { ok: true, detail: `Node ${process.versions.node}` };
}

export async function checkPrerequisites(port, agentPort, dockerMode) {
  const checks = [];
  const node = nodeVersionOk();
  checks.push({ name: 'Node.js', ok: node.ok, detail: node.detail });
  checks.push({ name: 'npm', ok: Boolean(which('npm')), detail: which('npm') || 'not found' });
  if (dockerMode) {
    const docker = which('docker');
    checks.push({ name: 'Docker CLI', ok: Boolean(docker), detail: docker || 'not found' });
    let compose = false;
    if (docker) {
      const r = spawnSync(docker, ['compose', 'version'], { encoding: 'utf8' });
      compose = r.status === 0;
    }
    checks.push({ name: 'Docker Compose', ok: compose, detail: compose ? 'available' : 'not available' });
    let socket = false;
    try { socket = fs.existsSync('/var/run/docker.sock'); } catch { /* ignore */ }
    checks.push({ name: 'Docker socket', ok: socket || process.platform === 'win32', detail: socket ? '/var/run/docker.sock' : 'not found (required to provision workloads)' });
  }
  const controlFree = await portAvailable(port);
  checks.push({ name: `Control port ${port}`, ok: controlFree, detail: controlFree ? 'free' : 'in use (ok if stack is already running)' });
  if (!dockerMode) {
    const agentFree = await portAvailable(agentPort);
    checks.push({ name: `Agent port ${agentPort}`, ok: agentFree, detail: agentFree ? 'free' : 'in use (ok if stack is already running)' });
  }
  checks.push({ name: 'Native module (better-sqlite3)', ok: await nativeModuleOk(), detail: await nativeModuleOk() ? 'loaded' : 'needs rebuild (npm rebuild better-sqlite3)' });
  return checks;
}

/* ------------------------------------------------------------------ */
/* Interactive prompting                                               */
/* ------------------------------------------------------------------ */

let rl = null;
function out(s = '') { process.stdout.write(s + '\n'); }
function ok(s) { out(`  ✓ ${s}`); }
function warn(s) { out(`  ! ${s}`); }
function step(n, title) { out(`\n[${n}/7] ${title}`); }

async function ask(label, def = '', validate = null) {
  const answer = (await rl.question(`  ${label}${def ? ` [${def}]` : ''}: `)).trim();
  const value = answer === '' ? String(def) : answer;
  const err = validate ? validate(value) : null;
  if (err) { warn(err); return ask(label, def, validate); }
  return value;
}

async function askHidden(label, def = '', validate = null) {
  if (!process.stdin.isTTY || !rl) return ask(label, def, validate);
  rl.pause();
  process.stdout.write(`  ${label}${def ? ' [auto-generate if blank]' : ''}: `);
  return new Promise((resolve) => {
    let value = '';
    const stdin = process.stdin;
    const prevRaw = stdin.isRaw;
    const cleanup = () => { stdin.off('data', onData); try { stdin.setRawMode(prevRaw); } catch { /* ignore */ } stdin.pause(); rl.resume(); };
    const finish = (v) => { cleanup(); process.stdout.write('\n'); resolve(v); };
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      if (s === '\r' || s === '\n') {
        const v = value || def;
        const err = validate ? validate(v) : null;
        if (err) { cleanup(); process.stdout.write('\n'); warn(err); askHidden(label, def, validate).then(resolve); }
        else finish(v);
      } else if (s === '\u0003') { cleanup(); out('\nSetup cancelled.'); process.exit(130); }
      else if (s === '\u007f' || s === '\b') { value = value.slice(0, -1); }
      else if (s >= ' ') { value += s; process.stdout.write('*'); }
    };
    try { stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData); }
    catch { finish(value || def); }
  });
}

async function confirm(label, def = true) {
  const answer = (await ask(`${label} (y/n)`, def ? 'y' : 'n')).toLowerCase();
  return answer.startsWith('y');
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

const HELP = `
.light — guided terminal setup

Usage: node setup.js [options]

Options:
  -y, --yes, --defaults   Accept all defaults (non-interactive)
  --check                 Run diagnostics only and exit
  --docker / --local      Choose deployment mode
  --no-start              Write config but do not start the stack
  --force                 Overwrite existing .env without prompting
  --set KEY=VALUE         Override a setting (repeatable)
  -h, --help              Show this help

Examples:
  node setup.js                       # interactive wizard
  node setup.js --check               # diagnose the host
  node setup.js --yes --local         # quick local setup
  node setup.js --yes --set PORT=6000 # scripted install
`;

export async function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) { out(HELP); return { code: 0 }; }
  if (opts.unknown?.length) { warn(`Unknown option(s): ${opts.unknown.join(', ')}`); out(HELP); return { code: 1 }; }

  out('╭──────────────────────────────────────────────────────────────╮');
  out('│  .light  ·  guided setup                       by Trycord    │');
  out('╰──────────────────────────────────────────────────────────────╯');
  out('Ownership attribution is embedded in the software and cannot be removed by white-label settings.');

  const existingText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const existing = parseEnv(existingText);
  const defaults = buildDefaults(existing, opts.set);
  const interactive = !opts.yes && Boolean(process.stdin.isTTY);
  const cfg = { ...defaults };

  let dockerMode = opts.docker;
  if (dockerMode === null) dockerMode = existing.LT_MODE !== 'local' && !(existing.COMPOSE_MODE === 'local');
  if (interactive && opts.docker === null) {
    step(1, 'Deployment mode');
    out('  Docker runs the panel and Shade agent in one container (recommended).');
    out('  Local runs both processes directly with Node.');
    dockerMode = await confirm('Use Docker deployment?', true);
  } else step(1, `Deployment mode: ${dockerMode ? 'Docker' : 'Local'}`);

  const checks = await checkPrerequisites(cfg.PORT, cfg.AGENT_PORT, dockerMode);
  out('\n[2/7] Prerequisites');
  for (const c of checks) out(`  ${c.ok ? '✓' : '!'} ${c.name}: ${c.detail}`);
  const hardFail = checks.find((c) => !c.ok && ['Node.js', 'npm', 'Docker CLI', 'Docker Compose'].includes(c.name));
  if (hardFail) { warn(`Cannot continue: ${hardFail.name} — ${hardFail.detail}`); return { code: 1 }; }

  if (opts.check) {
    const failed = checks.filter((c) => !c.ok).length;
    out(`\nDiagnostics complete: ${checks.length - failed}/${checks.length} checks passed.`);
    return { code: failed && dockerMode ? 1 : 0, checks };
  }

  if (interactive) {
    step(3, 'Network & ports');
    cfg.PORT = await ask('Control plane port', cfg.PORT, (v) => isValidPort(v) ? null : 'Enter a port between 1 and 65535');
    cfg.AGENT_PORT = await ask('Agent port', cfg.AGENT_PORT, (v) => isValidPort(v) ? null : 'Enter a port between 1 and 65535');
    if (cfg.PORT === cfg.AGENT_PORT) { warn('Ports must differ — using 5859 for the agent'); cfg.AGENT_PORT = '5859'; }
    cfg.PLATFORM_DOMAIN = await ask('Platform domain', cfg.PLATFORM_DOMAIN, (v) => isValidDomain(v) ? null : 'Enter a valid domain, e.g. example.com');
  } else step(3, `Network: control ${cfg.PORT}, agent ${cfg.AGENT_PORT}, domain ${cfg.PLATFORM_DOMAIN}`);
  cfg.CONTROL_PLANE_PORT = cfg.PORT;
  cfg.CONTROL_URL = `http://127.0.0.1:${cfg.PORT}`;
  cfg.CONTROL_BASE_URL = `http://localhost:${cfg.PORT}`;
  cfg.AGENT_PORT = cfg.AGENT_PORT || '5859';

  if (interactive) {
    step(4, 'Administrator account');
    cfg.BOOTSTRAP_ADMIN_EMAIL = await ask('Admin email', cfg.BOOTSTRAP_ADMIN_EMAIL, (v) => isValidEmail(v) ? null : 'Enter a valid email address');
    const pwLabel = existing.BOOTSTRAP_ADMIN_PASSWORD ? 'Admin password (Enter to keep current)' : 'Admin password (Enter to auto-generate)';
    cfg.BOOTSTRAP_ADMIN_PASSWORD = await askHidden(pwLabel, cfg.BOOTSTRAP_ADMIN_PASSWORD || randomPassword(), (v) => isValidPassword(v) ? null : 'Password must be at least 10 characters');
    cfg.BOOTSTRAP_ADMIN_NAME = await ask('Admin display name', cfg.BOOTSTRAP_ADMIN_NAME);
    cfg.ALLOW_SIGNUP = (await confirm('Allow public sign-ups?', cfg.ALLOW_SIGNUP !== 'false')) ? 'true' : 'false';
  } else step(4, `Administrator: ${cfg.BOOTSTRAP_ADMIN_EMAIL} (password ${mask(cfg.BOOTSTRAP_ADMIN_PASSWORD)})`);

  if (interactive) {
    step(5, 'Branding (white-label)');
    out('  Branding is cosmetic — the Trycord ownership watermark stays intact.');
    cfg.BRAND_PRODUCT = await ask('Product name', cfg.BRAND_PRODUCT);
    cfg.BRAND_TAGLINE = await ask('Tagline', cfg.BRAND_TAGLINE);
    cfg.BRAND_SUPPORT_EMAIL = await ask('Support email', cfg.BRAND_SUPPORT_EMAIL, (v) => isValidEmail(v) ? null : 'Enter a valid email address');
    cfg.BRAND_PRIMARY_COLOR = await ask('Primary colour (hex)', cfg.BRAND_PRIMARY_COLOR, (v) => /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour, e.g. #FF4D24');
    cfg.BRAND_ACCENT_COLOR = await ask('Accent colour (hex)', cfg.BRAND_ACCENT_COLOR, (v) => /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour, e.g. #4C9B8A');
  } else step(5, `Branding: ${cfg.BRAND_PRODUCT} — ${cfg.BRAND_TAGLINE}`);
  cfg.BRAND_DOC_TITLE = `${cfg.BRAND_PRODUCT} — Trycord Hosting`;

  if (interactive) {
    step(6, 'Optional integrations (press Enter to skip)');
    out('  Stripe payments — leave blank for administrator-approved manual activation.');
    cfg.STRIPE_SECRET_KEY = await ask('Stripe secret key', cfg.STRIPE_SECRET_KEY);
    cfg.STRIPE_WEBHOOK_SECRET = cfg.STRIPE_SECRET_KEY ? await ask('Stripe webhook secret', cfg.STRIPE_WEBHOOK_SECRET) : '';
    out('  GitHub deployments — enable OAuth pushes with verified webhooks.');
    cfg.GITHUB_CLIENT_ID = await ask('GitHub client ID', cfg.GITHUB_CLIENT_ID);
    cfg.GITHUB_CLIENT_SECRET = cfg.GITHUB_CLIENT_ID ? await askHidden('GitHub client secret', '') : '';
    cfg.GITHUB_CALLBACK_URL = cfg.GITHUB_CLIENT_ID ? await ask('GitHub callback URL', cfg.GITHUB_CALLBACK_URL || `${cfg.CONTROL_BASE_URL}/api/github/callback`) : '';
    cfg.GITHUB_WEBHOOK_SECRET = cfg.GITHUB_CLIENT_ID ? await ask('GitHub webhook secret', '') : '';
    cfg.CADDY_ADMIN_URL = await ask('Caddy admin API URL (TLS/proxy)', cfg.CADDY_ADMIN_URL);
    cfg.EMAIL_ENABLED = (await confirm('Enable outbound email?', cfg.EMAIL_ENABLED === 'true')) ? 'true' : 'false';
    if (cfg.EMAIL_ENABLED === 'true') {
      cfg.EMAIL_PROVIDER = await ask('Email provider (deomail/smtp)', cfg.EMAIL_PROVIDER || 'deomail');
      if (cfg.EMAIL_PROVIDER === 'smtp') {
        cfg.SMTP_HOST = await ask('SMTP host', cfg.SMTP_HOST || '');
        cfg.SMTP_FROM = await ask('SMTP from address', cfg.SMTP_FROM || '');
        cfg.SMTP_PORT = await ask('SMTP port', cfg.SMTP_PORT || '587', (v) => isValidPort(v) ? null : 'Invalid port');
      } else {
        cfg.DEOMAIL_API_KEY = await askHidden('DeoMail API key', '');
        cfg.DEOMAIL_FROM_EMAIL = await ask('DeoMail from address', cfg.DEOMAIL_FROM_EMAIL || '');
      }
    }
  } else step(6, 'Integrations: optional providers left at current values');

  out('\n[7/7] Write configuration & launch');
  if (fs.existsSync(ENV_PATH) && !opts.force && !interactive) warn('Existing .env found — values will be merged (use --force to overwrite)');
  const merged = updateEnvText(existingText, cfg);
  fs.writeFileSync(ENV_PATH, merged, { mode: 0o600 });
  ok(`.env written (${Object.keys(cfg).length} settings, existing comments preserved)`);
  ok(`JWT secret ${mask(cfg.JWT_SECRET)} · node token ${mask(cfg.NODE_TOKEN)}`);

  if (!(await nativeModuleOk())) {
    out('  Native module missing — installing dependencies…');
    const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], { cwd: ROOT, stdio: 'inherit' });
    if (rebuild.status !== 0 || !(await nativeModuleOk())) {
      const install = spawnSync('npm', ['ci'], { cwd: ROOT, stdio: 'inherit' });
      if (install.status !== 0) { warn('Dependency installation failed — run "npm ci" and retry setup.'); return { code: 1 }; }
    }
    ok('Dependencies ready');
  } else ok('Dependencies ready');

  if (dockerMode) cfg.COMPOSE_MODE = 'docker';
  if (!dockerMode) cfg.COMPOSE_MODE = 'local';
  fs.writeFileSync(ENV_PATH, updateEnvText(fs.readFileSync(ENV_PATH, 'utf8'), { COMPOSE_MODE: cfg.COMPOSE_MODE }), { mode: 0o600 });

  let launched = false;
  if (opts.start) {
    if (dockerMode) {
      out('  Building and starting Docker Compose stack…');
      const r = spawnSync('docker', ['compose', 'up', '-d', '--build'], { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0) { warn('Docker Compose failed — check Docker permissions and try again.'); return { code: 1 }; }
      launched = true;
    } else {
      out('  Starting local supervisor (node start.js)…');
      fs.mkdirSync(path.dirname(LOCAL_LOG), { recursive: true });
      const log = fs.openSync(LOCAL_LOG, 'a');
      const child = spawn(process.execPath, ['start.js'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...parseEnv(fs.readFileSync(ENV_PATH, 'utf8')) } });
      child.unref();
      fs.writeFileSync(LOCAL_PID_FILE, String(child.pid));
      launched = true;
    }
  }

  if (launched) {
    out('  Waiting for health endpoint…');
    const healthy = await waitForHealth(cfg.PORT, 120000);
    if (healthy) ok('Health check passed');
    else warn('Stack did not become healthy in time — check logs and run "node setup.js --check"');
  }

  out('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out('  .light is ready.');
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out(`  Public site     http://localhost:${cfg.PORT}/`);
  out(`  Dashboard       http://localhost:${cfg.PORT}/login`);
  out(`  Admin centre    http://localhost:${cfg.PORT}/admin`);
  out(`  Health          http://localhost:${cfg.PORT}/health`);
  out('');
  out(`  Admin email     ${cfg.BOOTSTRAP_ADMIN_EMAIL}`);
  out(`  Admin password  ${cfg.BOOTSTRAP_ADMIN_PASSWORD}`);
  out('  (saved in .env — change it after first login)');
  out('');
  out('  Tip: run "node setup.js --check" any time for diagnostics.');
  return { code: 0, config: cfg };
}

export async function waitForHealth(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.status === 'ok') return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (process.stdin.isTTY) rl = createInterface({ input: process.stdin, output: process.stdout });
  run().then((result) => {
    if (rl) rl.close();
    process.exit(result.code ?? 0);
  }).catch((error) => {
    if (rl) rl.close();
    console.error('[setup] unexpected error:', error);
    process.exit(1);
  });
}
