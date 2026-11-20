// .light — application frontend. All data comes from the control plane API.
import api from '/js/api.js';
import { ASSETS, iconImg, brandMark, brandWordmark } from '/js/assets.js';

const appHost = document.getElementById('app');
// Legacy standalone pages load this module without an #app mount point. Use a
// detached node so module evaluation is harmless and skip boot entirely.
const app = appHost || document.createElement('div');
const overlays = document.getElementById('overlay-root');
let session = null;
let pollTimer = null;
let currentView = null;
let brand = {
  product: '.light', owner: 'Trycord', attribution: '.light POWERED BY TRYCORD',
  tagline: 'Universal hosting platform', supportEmail: 'support@trycord.dev',
  domain: 'trycord.dev', primaryColor: '#FF4D24', accentColor: '#4C9B8A',
  favicon: '/assets/logos/favicon.svg', logo: '/assets/logos/light-primary.svg',
  wordmark: '/assets/logos/light-wordmark.svg', background: '/assets/backgrounds/volcanic-strata-16x9.svg',
  docTitle: '.light — Trycord Hosting', signupEnabled: true,
};

/* ---------- helpers ---------- */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtBytes = (bytes) => { const b = Number(bytes || 0); if (b > 1073741824) return `${(b / 1073741824).toFixed(1)} GB`; if (b > 1048576) return `${(b / 1048576).toFixed(1)} MB`; if (b > 1024) return `${(b / 1024).toFixed(1)} KB`; return `${b} B`; };
const fmtTime = (ts) => ts ? new Date(ts).toLocaleString() : '—';
const fmtAgo = (ts) => { if (!ts) return 'never'; const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const fmtUptime = (s) => { s = Math.floor(Number(s || 0)); const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };

const STATUS_COLORS = { running: 'success', online: 'success', ready: 'success', success: 'success', active: 'success', stopped: 'neutral', offline: 'neutral', suspended: 'warning', draining: 'warning', deploying: 'warning', pending: 'info', creating: 'info', queued: 'info', provisioning: 'info', error: 'danger', failed: 'danger', missing: 'danger' };
function badge(status) { const c = STATUS_COLORS[status] || 'neutral'; const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'; return `<span class="lt-badge lt-badge-${c}"><span class="lt-dot lt-dot-${c}"></span>${esc(label)}</span>`; }

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `lt-toast ${type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : ''}`;
  el.innerHTML = `<span class="lt-dot lt-dot-${type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'info'}"></span><span>${esc(message)}</span>`;
  let stack = overlays.querySelector('.lt-toast-stack');
  if (!stack) { stack = document.createElement('div'); stack.className = 'lt-toast-stack'; overlays.appendChild(stack); }
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3600);
}

function modal(title, bodyHtml, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'lt-modal-overlay';
    const formBody = bodyHtml.includes('<form') ? bodyHtml : `<form id="modalForm">${bodyHtml}</form>`;
    overlay.innerHTML = `<div class="lt-modal" role="dialog" aria-modal="true"><div class="lt-modal-header"><h3 class="lt-h3">${esc(title)}</h3><button class="lt-btn lt-btn-ghost lt-btn-icon" data-close aria-label="Close">✕</button></div><div class="lt-modal-body">${formBody}</div><div class="lt-modal-footer">${options.extra || ''}<button class="lt-btn lt-btn-ghost" data-close>${esc(options.cancel || 'Cancel')}</button>${options.danger ? `<button class="lt-btn lt-btn-danger" data-confirm>${esc(options.confirm || 'Delete')}</button>` : ''}${!options.danger ? `<button class="lt-btn lt-btn-primary" data-confirm>${esc(options.confirm || 'Save')}</button>` : ''}</div></div>`;
    overlays.appendChild(overlay);
    const close = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    const confirmBtn = overlay.querySelector('[data-confirm]');
    if (confirmBtn) confirmBtn.addEventListener('click', () => {
      const form = overlay.querySelector('form');
      if (form) { if (!form.reportValidity()) return; resolveForm(form); return; }
      close(true);
    });
    function resolveForm(form) { const data = Object.fromEntries(new FormData(form).entries()); close(data); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}

function confirmDialog(title, message, confirmText = 'Delete') { return modal(title, `<p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6">${esc(message)}</p>`, { danger: true, confirm: confirmText }); }

function field(label, name, type = 'text', value = '', extra = '') { return `<div class="lt-field"><label for="f-${name}">${esc(label)}</label><input class="lt-input" id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`; }
function selectField(label, name, options, selected = '') { return `<div class="lt-field"><label for="f-${name}">${esc(label)}</label><select class="lt-select" id="f-${name}" name="${name}">${options.map((o) => { const value = typeof o === 'string' ? o : o.value; const text = typeof o === 'string' ? o : o.label; return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select></div>`; }
function textarea(label, name, value = '', rows = 4) { return `<div class="lt-field"><label for="f-${name}">${esc(label)}</label><textarea class="lt-textarea" id="f-${name}" name="${name}" rows="${rows}">${esc(value)}</textarea></div>`; }

function loading(title = 'Loading') { return `<div class="lt-loading"><span class="lt-spinner"></span>${esc(title)}…</div>`; }
function empty(title, description, action = '') { return `<div class="lt-empty"><div class="lt-empty-icon">${iconImg("applications", 20)}</div><div class="lt-empty-title">${esc(title)}</div><div class="lt-empty-desc">${esc(description)}</div>${action}</div>`; }
function errorState(error) { return `<div class="lt-error">${esc(error.message || error)}</div>`; }
function section(title, subtitle, content, actions = '') { return `<div class="lt-card"><div class="lt-card-header"><div><h3 class="lt-h3">${esc(title)}</h3>${subtitle ? `<div class="lt-meta">${esc(subtitle)}</div>` : ''}</div>${actions}</div><div class="lt-card-body">${content}</div></div>`; }

/* ---------- branding ---------- */
function applyBranding() {
  const savedTheme = localStorage.getItem('lt_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.title = brand.docTitle || brand.product;
  const root = document.documentElement;
  root.style.setProperty('--lt-ember-500', brand.primaryColor || '#FF4D24');
  root.style.setProperty('--lt-mineral', brand.accentColor || '#4C9B8A');
  let favicon = document.querySelector('link[rel=icon]');
  if (favicon) favicon.href = brand.favicon || '/assets/logos/favicon.svg';
}
async function loadBranding() {
  try { const b = await api.branding(); if (b && b.product) brand = { ...brand, ...b }; } catch { /* use defaults */ }
  applyBranding();
}

/* ---------- auth ---------- */
function renderAuth(mode = 'login') {
  stopPolling();
  const isReg = mode === 'register';
  app.innerHTML = `<div class="lt-auth">
    <section class="lt-auth-brand-panel">
      <div class="lt-auth-brand-inner">
        <a href="/" class="lt-auth-logo">${brandMark(40)}<span>${esc(brand.product)}</span></a>
        <div class="lt-auth-visual" aria-hidden="true">
          <div class="v-glow"></div><div class="v-ring"></div><div class="v-ring alt"></div>
          <div class="v-stack">
            <div class="lt-auth-node"><div class="row"><span class="led"></span><span class="lt-meta">node-01 · online</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
            <div class="lt-auth-node"><div class="row"><span class="led"></span><span class="lt-meta">node-02 · online</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
            <div class="lt-auth-node warn"><div class="row"><span class="led"></span><span class="lt-meta">services · monitored</span><span class="bars"><i></i><i></i><i></i><i></i></span></div><div class="line"></div><div class="line short"></div></div>
          </div>
        </div>
        <div class="lt-auth-pitch">
          <h1>Your infrastructure.<br><span class="hl">Without the complexity.</span></h1>
          <p>Deploy, manage and scale your servers and applications from one place.</p>
        </div>
        <div class="lt-auth-brand-foot">${esc(brand.attribution)} · ${esc(brand.domain)}</div>
      </div>
    </section>
    <section class="lt-auth-form-panel">
      <div class="lt-auth-form-wrap">
        <div class="lt-auth-mobile-logo">${brandMark(34)}<span>${esc(brand.product)}</span></div>
        <div class="lt-auth-tabs">
          <button class="lt-auth-tab ${isReg ? '' : 'active'}" data-mode="login">Sign in</button>
          <button class="lt-auth-tab ${isReg ? 'active' : ''}" data-mode="register">Create account</button>
        </div>
        <h2 class="lt-auth-title">${isReg ? 'Create your account' : 'Welcome back'}</h2>
        <p class="lt-auth-sub">${isReg ? 'Deploy and manage your hosting services.' : `Sign in to your ${esc(brand.product)} account to continue.`}</p>
        <form id="authForm" novalidate>
          ${isReg ? field('Username', 'username', 'text', '', 'autocomplete="username" required pattern="[a-zA-Z0-9_]+" placeholder="your_username"') : ''}
          ${isReg
            ? field('Email', 'email', 'email', '', 'autocomplete="email" required placeholder="you@example.com"')
            : `<div class="lt-field"><label for="f-email">Username or email</label><input class="lt-input" id="f-email" name="email" type="text" autocomplete="username" required placeholder="you@example.com or username"></div>`}
          <div class="lt-field"><label for="f-password">Password</label>
            <div class="lt-input-wrap">
              <input class="lt-input" id="f-password" name="password" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" required minlength="${isReg ? 10 : 1}" placeholder="${isReg ? 'At least 10 characters' : 'Enter your password'}">
              <button type="button" class="lt-auth-eye" id="togglePw" aria-label="Show password" title="Show password">◉</button>
            </div>
          </div>
          ${isReg
            ? `<label class="lt-auth-terms"><input type="checkbox" name="acceptTerms" required><span>I accept the <a href="/legal" target="_blank">Terms of Service</a> and <a href="/legal" target="_blank">Privacy Policy</a>.</span></label>`
            : `<div style="text-align:right;margin:-2px 0 8px"><button type="button" id="forgotBtn" class="lt-auth-link">Forgot password?</button></div>`}
          <div class="lt-auth-error" id="authError" role="alert"></div>
          <button class="lt-btn lt-btn-primary" type="submit" style="width:100%;margin-top:8px">${isReg ? 'Create account' : 'Sign in'}</button>
        </form>
        ${!isReg ? `<div class="lt-auth-divider">or continue with</div>
        <div class="lt-field"><label for="f-sso">Organization email (SSO)</label><input class="lt-input" id="f-sso" type="email" placeholder="you@company.com"></div>
        <button class="lt-btn lt-btn-secondary" id="ssoBtn" style="width:100%">Continue with SSO</button>` : ''}
        <div class="lt-auth-footer">
          ${esc(brand.attribution)} · ${esc(brand.tagline)}
          <div class="lt-auth-watermark"><span class="lt-wm-mark">ΔΓΟ</span> <a href="${esc(brand.watermark?.source || 'https://trycord.dev')}" target="_blank" rel="noopener">${esc(brand.watermark?.short || 'POWERED BY TRYCORD')}</a></div>
        </div>
      </div>
    </section>
  </div>`;

  app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
  const eye = app.querySelector('#togglePw');
  if (eye) eye.addEventListener('click', () => {
    const input = app.querySelector('#f-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? '◌' : '◉';
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  const forgotBtn = app.querySelector('#forgotBtn');
  if (forgotBtn) forgotBtn.addEventListener('click', async () => {
    const data = await modal('Reset password', `${field('Account email or username', 'identity', 'text', '', 'required')}<p class="lt-meta" style="margin-top:10px">If email is configured, a secure reset link will be sent. Otherwise contact your administrator for assisted recovery.</p>`, { confirm: 'Send reset link' });
    if (!data) return;
    try {
      const r = await api.forgotPassword(data.identity);
      toast(r.ok ? 'Reset instructions sent' : (r.message || 'Email is disabled — contact your administrator'), r.ok ? 'success' : 'info');
    } catch (error) { toast(error.message, 'error'); }
  });
  const ssoBtn = app.querySelector('#ssoBtn');
  if (ssoBtn) ssoBtn.addEventListener('click', () => {
    const sso = brand.sso || {};
    const email = (app.querySelector('#f-sso')?.value || '').trim();
    if (!sso.enabled || !sso.url) { toast('SSO is not configured for this deployment — contact your administrator or sign in with your username or email.', 'info'); return; }
    if (!email) { toast('Enter your organization email to continue with SSO', 'warning'); return; }
    location.href = sso.url + (sso.url.includes('?') ? '&' : '?') + 'login_hint=' + encodeURIComponent(email);
  });
  app.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    const errorEl = app.querySelector('#authError');
    errorEl.textContent = '';
    const button = form.querySelector('button[type=submit]');
    button.disabled = true; button.textContent = 'Please wait…';
    try {
      const result = mode === 'register' ? await api.register(data) : await api.login(data);
      api.setToken(result.token);
      session = await api.me();
      if (result.verifyRequired || (session.user && session.user.emailVerified === false)) {
        location.hash = '#/verify'; renderShell(); await navigate();
        toast('Check your email to verify your account', 'info'); return;
      }
      location.hash = '#/overview'; renderShell(); navigate();
      toast(mode === 'register' ? 'Account created' : 'Signed in', 'success');
    } catch (error) { errorEl.textContent = error.message; }
    finally { button.disabled = false; button.textContent = mode === 'register' ? 'Create account' : 'Sign in'; }
  });
}

const NAV = [
  { group: 'Workspace', items: [
    { view: 'overview', label: 'Overview', icon: 'monitoring' },
    { view: 'instances', label: 'Instances', icon: 'instances' },
    { view: 'game', label: 'Game servers', icon: 'game-servers' },
    { view: 'web', label: 'Applications', icon: 'applications' },
    { view: 'deployments', label: 'Deployments', icon: 'schedules' },
  ] },
  { group: 'Infrastructure', items: [
    { view: 'nodes', label: 'Nodes', icon: 'nodes', admin: true },
    { view: 'domains', label: 'Domains', icon: 'network' },
    { view: 'backups', label: 'Backups', icon: 'backups' },
    { view: 'schedules', label: 'Schedules', icon: 'schedules' },
  ] },
  { group: 'Account', items: [
    { view: 'account', label: 'Account & plans', icon: 'settings' },
    { view: 'admin', label: 'Administration', icon: 'security', admin: true },
  ] },
];

function renderShell() {
  const nav = NAV.map((group) => {
    const items = group.items.filter((i) => !i.admin || session.user.role === 'admin');
    if (!items.length) return '';
    return `<nav class="lt-nav-section" style="flex:1"><div class="lt-nav-section-label">${esc(group.group)}</div>${items.map((i) => `<a class="lt-nav-item" href="#/${i.view}" data-nav="${i.view}">${iconImg(i.icon, 18)}${esc(i.label)}</a>`).join('')}</nav>`;
  }).join('');
  app.innerHTML = `<div class="lt-shell">
    <aside class="lt-sidebar" id="sidebar">
      <a class="lt-brand" href="#/overview">${brandMark(34)}<span class="lt-brand-word">.light<span class="lt-brand-sub">Trycord</span></span></a>
      ${nav}
      <div class="lt-nav-footer">
        <div class="lt-watermark"><span class="lt-wm-mark">ΔΓΟ</span><span><a href="${esc(brand.watermark?.source || 'https://trycord.dev')}" target="_blank" rel="noopener">${esc(brand.watermark?.short || 'POWERED BY TRYCORD')}</a> · v1.0.0</span></div>
      </div>
    </aside>
    <div class="lt-scrim lt-sidebar-overlay" id="sidebarScrim" style="display:none"></div>
    <div class="lt-main">
      <header class="lt-topbar">
        <button class="lt-btn lt-btn-ghost lt-btn-icon lt-sidebar-toggle" id="sidebarToggle" aria-label="Toggle navigation">☰</button>
        <div class="lt-breadcrumb"><span>Trycord</span><span class="sep">/</span><span class="cur" id="breadcrumb">Overview</span></div>
        <div class="lt-topbar-spacer"></div>
        <span class="lt-badge lt-badge-success" id="liveBadge"><span class="lt-dot lt-dot-success"></span>Connected</span>
        <div class="lt-user-menu"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="userButton">${esc(session.user.name || session.user.email)} ▾</button></div>
      </header>
      <main class="lt-content" id="view">${loading()}</main>
    </div>
  </div>`;
  const toggle = app.querySelector('#sidebarToggle');
  const sidebar = app.querySelector('#sidebar');
  const scrim = app.querySelector('#sidebarScrim');
  toggle?.addEventListener('click', () => { const open = sidebar.classList.toggle('is-open'); scrim.style.display = open ? 'block' : 'none'; });
  scrim?.addEventListener('click', () => { sidebar.classList.remove('is-open'); scrim.style.display = 'none'; });
  app.querySelector('#userButton').addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = app.querySelector('.lt-user-menu-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'lt-user-menu-panel';
    panel.innerHTML = `<div class="lt-menu-label">${esc(session.user.email)}</div>
      <a href="#/account">Account & plans</a>
      <button id="logoutButton">Sign out</button>`;
    app.querySelector('.lt-user-menu').appendChild(panel);
    panel.querySelector('#logoutButton').addEventListener('click', () => {
      api.setToken(''); session = null; stopPolling(); renderAuth('login');
    });
    setTimeout(() => { const handler = (ev) => { if (!ev.target.closest('.lt-user-menu')) { panel.remove(); document.removeEventListener('click', handler); } }; document.addEventListener('click', handler); }, 0);
  });
}

function setActiveNav(view) {
  app.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  const labels = { overview: 'Overview', instances: 'Instances', game: 'Game servers', web: 'Applications', deployments: 'Deployments', nodes: 'Nodes', domains: 'Domains', backups: 'Backups', schedules: 'Schedules', account: 'Account & plans', admin: 'Administration', instance: 'Instance' };
  const crumb = app.querySelector('#breadcrumb');
  if (crumb) crumb.textContent = labels[view] || view;
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function poll(fn, ms = 5000) { stopPolling(); pollTimer = setInterval(() => { if (currentView) fn().catch(() => {}); }, ms); }

/* ---------- router ---------- */
function parseHash() {
  const raw = (location.hash || '#/overview').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const [view, param] = pathPart.split('/');
  const query = new URLSearchParams(queryPart || '');
  return { view: view || 'overview', param, query };
}
async function navigate() {
  if (!session) return;
  const { view, param, query } = parseHash();
  setActiveNav(view);
  stopPolling();
  currentView = view;
  const container = app.querySelector('#view');
  if (!container) return;
  const renderers = {
    overview: renderOverview, instances: () => renderInstances('all'), game: () => renderInstances('game'), web: () => renderInstances('web'),
    deployments: renderDeployments, nodes: renderNodes, domains: renderDomains, backups: renderBackups, schedules: renderSchedules,
    account: renderAccount, admin: renderAdmin, instance: () => renderInstance(param),
    verify: () => renderVerify(query), reset: () => renderReset(query),
  };
  const renderer = renderers[view] || renderOverview;
  container.innerHTML = loading();
  try { await renderer(); } catch (error) { container.innerHTML = errorState(error); }
}

/* ---------- views ---------- */
async function renderVerify(query) {
  const view = app.querySelector('#view');
  const token = query?.get('token');
  let message = '', ok = false;
  if (token) {
    try { await api.verifyEmail(token); ok = true; message = 'Your email has been verified.'; }
    catch (error) { message = error.message || 'Verification failed.'; }
  } else {
    message = 'Open the verification link from your email to verify your account.';
  }
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Verify email</h1><p class="lt-page-subtitle">Account verification</p></div></div>
    ${section('Verification', '', `<p style="color:var(--lt-text-secondary);font-size:13px">${esc(message)}</p>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="lt-btn lt-btn-secondary" id="resendVerify">Resend verification email</button>
        <a class="lt-btn lt-btn-primary" href="#/overview">Continue to dashboard</a>
      </div>`)}`;
  const resend = view.querySelector('#resendVerify');
  if (resend) resend.addEventListener('click', async () => { try { const r = await api.resendVerification(); toast(r.ok ? 'Verification email sent' : (r.reason || 'Not available'), r.ok ? 'success' : 'info'); } catch (e) { toast(e.message, 'error'); } });
}

async function renderReset(query) {
  const view = app.querySelector('#view');
  const token = query?.get('token');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Reset password</h1><p class="lt-page-subtitle">Choose a new password</p></div></div>
    ${section('New password', '', `<form id="resetForm">
      ${field('New password (min 10 characters)', 'password', 'password', '', 'minlength="10" required')}
      <button class="lt-btn lt-btn-primary" type="submit" ${token ? '' : 'disabled'}>Set password</button>
      ${token ? '' : '<p class="lt-meta" style="margin-top:10px">Invalid or missing reset token. Request a new link from the sign-in page.</p>'}
    </form>`)}`;
  const form = view.querySelector('#resetForm');
  if (form && token) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = new FormData(form).get('password');
    try { await api.resetPassword(token, pw); toast('Password updated — please sign in', 'success'); api.setToken(''); session = null; renderAuth('login'); }
    catch (error) { toast(error.message, 'error'); }
  });
}

async function renderOverview() {
  const view = app.querySelector('#view');
  const [stats, instances, deployments, nodes] = await Promise.all([api.stats(), api.instances(), api.deployments(), api.nodes()]);
  const running = stats.instances?.running || 0;
  const online = nodes.nodes.filter((n) => n.status === 'online').length;
  const failed = stats.deployments?.failed || 0;
  const kpis = [
    { label: 'Running instances', value: running, sub: `${instances.instances.length} total` },
    { label: 'Nodes online', value: `${online}/${nodes.nodes.length}`, sub: 'agents connected' },
    { label: 'Deployments', value: stats.deployments?.success || 0, sub: `${stats.deployments?.failed || 0} failed` },
    { label: 'Alerts', value: failed, sub: failed ? 'needs attention' : 'all clear' },
  ].map((k) => `<div class="lt-card" style="padding:var(--lt-space-4)"><div class="lt-label">${esc(k.label)}</div><div class="lt-kpi" style="margin-top:6px">${esc(k.value)}</div><div class="lt-meta" style="margin-top:6px">${esc(k.sub)}</div></div>`).join('');
  const instanceRows = instances.instances.slice(0, 6).map((i) => `<tr><td><a class="lt-td-strong" href="#/instance/${i.id}" style="color:var(--lt-text);text-decoration:none">${esc(i.name)}</a><div class="lt-meta">${esc(i.image)}</div></td><td>${badge(i.status)}</td><td>${esc(i.category)}</td><td class="lt-td-mono">${i.memoryMb} MB</td><td>${esc(i.nodeName || '—')}</td><td>${fmtAgo(i.updatedAt)}</td></tr>`).join('');
  const deployRows = deployments.deployments.slice(0, 5).map((d) => `<tr><td class="lt-td-strong">${esc(d.instanceName || d.instanceId)}</td><td>${badge(d.status)}</td><td class="lt-td-mono">${esc(d.version)}</td><td>${fmtTime(d.createdAt)}</td></tr>`).join('');
  const onboarding = instances.instances.length === 0 ? `
    <div class="lt-card" style="padding:var(--lt-space-6);border-color:var(--lt-border-ember);background:linear-gradient(140deg,var(--lt-ember-alpha-08),transparent 60%);margin-bottom:var(--lt-space-4)">
      <div style="font-size:20px;font-weight:800;letter-spacing:-.02em">Welcome to ${esc(brand.product)} 👋</div>
      <p style="color:var(--lt-text-secondary);font-size:13px;max-width:620px;line-height:1.6;margin:8px 0 16px">Your workspace is ready. Create your first server to host a game, website, application, bot or database. Choose a template or bring your own Docker image — the platform handles the rest.</p>
      <a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting plans</a>
    </div>` : '';
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Overview</h1><p class="lt-page-subtitle">Your hosting infrastructure at a glance</p></div><div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting plans</a></div></div>
    ${onboarding}
    <div class="lt-grid lt-grid-4" style="margin-bottom:var(--lt-space-4)">${kpis}</div>
    <div class="lt-stack">
      ${section('Instances', 'Recent activity across your workspace', instanceRows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Memory</th><th>Node</th><th>Updated</th></tr></thead><tbody>${instanceRows}</tbody></table></div>` : empty('No instances yet', 'Purchase a hosting plan to deploy your first service.', '<a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting plans</a>'))}
      ${section('Recent deployments', 'Latest release activity', deployRows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Instance</th><th>Status</th><th>Version</th><th>Time</th></tr></thead><tbody>${deployRows}</tbody></table></div>` : empty('No deployments', 'Deployments will appear here once you deploy an instance.'))}
    </div>`;
  poll(async () => { if (currentView === 'overview') await renderOverview(); }, 10000);
}

async function renderInstances(category = 'all') {
  const view = app.querySelector('#view');
  const [list, templates, nodes] = await Promise.all([api.instances(), api.templates(), api.nodes()]);
  const filtered = list.instances.filter((i) => category === 'all' || i.category === category);
  const filters = [{ id: 'all', label: 'All instances' }, { id: 'game', label: 'Game servers' }, { id: 'web', label: 'Applications' }, { id: 'database', label: 'Databases' }];
  const cards = filtered.map((i) => `<div class="lt-card lt-card-hover" style="padding:var(--lt-space-4)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span class="lt-badge lt-badge-neutral">${esc(i.category)}</span>${badge(i.status)}</div>
    <div style="font-size:15px;font-weight:700;margin-top:10px"><a href="#/instance/${i.id}" style="color:var(--lt-text);text-decoration:none">${esc(i.name)}</a></div>
    <div class="lt-meta" style="margin-top:2px">${esc(i.image)}</div>
    <div style="display:flex;gap:12px;margin-top:14px;font-size:12px;color:var(--lt-text-secondary)"><span>CPU <b style="color:var(--lt-text)">${i.cpuCores}</b></span><span>MEM <b style="color:var(--lt-text)">${i.memoryMb} MB</b></span><span>DISK <b style="color:var(--lt-text)">${i.diskGb} GB</b></span></div>
    <div class="lt-meta" style="margin-top:10px">${esc(i.nodeName || 'No node')} · ${fmtAgo(i.updatedAt)}</div>
    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
      ${i.status === 'running' ? `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-action="stop" data-id="${i.id}">Stop</button>` : `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-action="start" data-id="${i.id}">Start</button>`}
      <button class="lt-btn lt-btn-ghost lt-btn-sm" data-action="restart" data-id="${i.id}">Restart</button>
      <button class="lt-btn lt-btn-ghost lt-btn-sm" data-action="deploy" data-id="${i.id}">Deploy</button>
      <a class="lt-btn lt-btn-ghost lt-btn-sm" href="#/instance/${i.id}">Manage</a>
    </div></div>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">${category === 'game' ? 'Game servers' : category === 'web' ? 'Applications' : 'Instances'}</h1><p class="lt-page-subtitle">Your purchased hosting services</p></div><div class="lt-page-actions"><a class="lt-btn lt-btn-primary" href="/hosting">Get hosting</a></div></div>
    <div class="lt-tabs">${filters.map((f) => `<button class="lt-tab ${f.id === category ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>`).join('')}</div>
    ${filtered.length ? `<div class="lt-grid lt-grid-3">${cards}</div>` : empty('No services yet', 'Purchase a hosting plan to get your first service.', '<a class="lt-btn lt-btn-primary" href="/hosting">Browse hosting</a>')}`;
  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.filter === 'all' ? 'instances' : b.dataset.filter}`; }));
  view.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
    const { action, id } = b.dataset;
    try {
      if (action === 'deploy') {
        const data = await modal('Deploy instance', `${selectField('Version', 'version', ['latest', 'stable', 'v1'], 'latest')}${selectField('Source', 'source', [{ value: 'image', label: 'Docker image' }, { value: 'git', label: 'Git repository' }])}<div id="gitFields" style="display:none">${field('Repository URL', 'repoUrl', 'url')}${field('Branch', 'ref', 'text', 'main')}</div>`, { confirm: 'Deploy' });
        if (!data) return;
        await api.deploy(id, data); toast('Deployment started', 'success');
      } else { await api.action(id, action); toast(`Instance ${action}ed`, 'success'); }
      await renderInstances(category);
    } catch (error) { toast(error.message, 'error'); }
  }));
}

async function renderInstance(id) {
  const view = app.querySelector('#view');
  const [data, logs, metrics] = await Promise.all([api.instance(id), api.logs(id, 200), api.metrics(id, 60)]);
  const i = data.instance;
  const tab = currentInstanceTab || 'overview';
  const tabs = ['overview', 'console', 'files', 'metrics', 'backups', 'settings'];
  const latest = metrics.metrics[metrics.metrics.length - 1] || {};
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">${esc(i.name)}</h1><p class="lt-page-subtitle">${esc(i.image)} · ${esc(i.nodeName || 'unassigned')} · ${badge(i.status)}</p></div><div class="lt-page-actions">
    ${i.status === 'running' ? '<button class="lt-btn lt-btn-secondary" data-i="stop">Stop</button>' : '<button class="lt-btn lt-btn-secondary" data-i="start">Start</button>'}
    <button class="lt-btn lt-btn-secondary" data-i="restart">Restart</button><button class="lt-btn lt-btn-secondary" data-i="deploy">Deploy</button>
    <button class="lt-btn lt-btn-danger" data-i="delete">Delete</button></div></div>
    <div class="lt-tabs">${tabs.map((t) => `<button class="lt-tab ${t === tab ? 'active' : ''}" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <div id="instanceTab"></div>`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { currentInstanceTab = b.dataset.tab; renderInstance(id); }));
  view.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
    const action = b.dataset.i;
    try {
      if (action === 'delete') { if (await confirmDialog('Delete instance', `Permanently delete ${i.name} and all its data?`, 'Delete')) { await api.deleteInstance(id); toast('Instance deleted', 'success'); location.hash = '#/instances'; } return; }
      if (action === 'deploy') { await api.deploy(id, {}); toast('Deployment started', 'success'); }
      else { await api.action(id, action); toast(`Instance ${action}ed`, 'success'); }
      await renderInstance(id);
    } catch (error) { toast(error.message, 'error'); }
  }));
  const tabView = view.querySelector('#instanceTab');
  if (tab === 'overview') {
    tabView.innerHTML = `<div class="lt-grid lt-grid-4" style="margin-bottom:var(--lt-space-4)">
      ${[{ l: 'CPU', v: `${latest.cpu || 0}%` }, { l: 'Memory', v: `${latest.mem || 0}%` }, { l: 'Disk', v: `${latest.disk || 0}%` }, { l: 'Temperature', v: `${latest.temp || 0}°C` }].map((k) => `<div class="lt-card" style="padding:var(--lt-space-4)"><div class="lt-label">${k.l}</div><div class="lt-kpi" style="margin-top:6px">${k.v}</div></div>`).join('')}</div>
      ${section('Configuration', 'Current instance settings', `<div class="lt-grid lt-grid-2"><div><div class="lt-meta">Image</div><div style="font-weight:650">${esc(i.image)}</div></div><div><div class="lt-meta">Command</div><div style="font-family:var(--lt-font-mono);font-size:12px">${esc(i.command || 'default')}</div></div><div><div class="lt-meta">CPU / Memory</div><div style="font-weight:650">${i.cpuCores} cores · ${i.memoryMb} MB</div></div><div><div class="lt-meta">Storage</div><div style="font-weight:650">${i.diskGb} GB</div></div><div><div class="lt-meta">Ports</div><div class="lt-td-mono">${(i.ports || []).map((p) => esc(`${p.container}/${p.protocol}`)).join(', ') || 'none'}</div></div><div><div class="lt-meta">Environment</div><div class="lt-td-mono">${Object.keys(i.env || {}).length} variables</div></div></div>`)}
      ${section('Recent logs', 'Latest console output', `<div class="lt-console"><div class="lt-console-body" style="height:220px">${logs.logs.length ? logs.logs.map((l) => `<div class="lt-console-line ${l.stream === 'stderr' ? 'error' : 'info'}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('') : '<div class="lt-console-line info">No log output yet.</div>'}</div></div>`)}`;
  } else if (tab === 'console') {
    tabView.innerHTML = `${section('Live console', 'Execute commands in the running container (if supported)', `<div class="lt-console"><div class="lt-console-toolbar"><span class="lt-label">console</span><span style="flex:1"></span><button class="lt-btn lt-btn-ghost lt-btn-sm" id="clearLogs">Clear history</button></div><div class="lt-console-body" id="consoleBody">${logs.logs.map((l) => `<div class="lt-console-line ${l.stream === 'stderr' ? 'error' : 'info'}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join('')}</div><div class="lt-console-input"><span class="prompt">❯</span><input id="consoleInput" placeholder="Type a command and press Enter" ${i.status !== 'running' ? 'disabled' : ''}></div></div>`)}`;
    tabView.querySelector('#clearLogs').addEventListener('click', async () => { await api.clearLogs(id); toast('Logs cleared', 'success'); });
    tabView.querySelector('#consoleInput').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const command = e.target.value; e.target.value = '';
      const body = tabView.querySelector('#consoleBody');
      body.innerHTML += `<div class="lt-console-line cmd"><span class="ts">${fmtTime(Date.now())}</span><span>❯ ${esc(command)}</span></div>`;
      try { const result = await api.console(id, command); body.innerHTML += `<div class="lt-console-line info"><span class="ts">${fmtTime(Date.now())}</span><span>${esc(result.output || '')}</span></div>`; }
      catch (error) { body.innerHTML += `<div class="lt-console-line error"><span class="ts">${fmtTime(Date.now())}</span><span>${esc(error.message)}</span></div>`; }
      body.scrollTop = body.scrollHeight;
    });
    poll(async () => { const latestLogs = await api.logs(id, 100); if (currentView !== 'instance' || currentInstanceTab !== 'console') return; const body = tabView.querySelector('#consoleBody'); if (!body) return; const lastId = body.dataset.lastId || ''; const fresh = latestLogs.logs.filter((l) => String(l.id) > lastId); if (fresh.length) { body.dataset.lastId = String(fresh[fresh.length - 1].id); body.innerHTML += fresh.map((l) => `<div class="lt-console-line ${l.stream === 'stderr' ? 'error' : 'info'}"><span class="ts">${fmtTime(l.ts)}</span><span>${esc(l.line)}</span></div>`).join(''); body.scrollTop = body.scrollHeight; } }, 2000);
  } else if (tab === 'files') {
    const files = await api.files(id, currentFilePath || '/');
    currentFilePath = files.path;
    tabView.innerHTML = `${section('File manager', `Storage path: ${esc(files.path)}`, `<div class="lt-meta" style="margin-bottom:12px">${(files.entries || []).length} entries</div><div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Actions</th></tr></thead><tbody>
      ${files.path !== '/' ? '<tr><td colspan="4"><button class="lt-btn lt-btn-ghost lt-btn-sm" id="parentDir">← Parent directory</button></td></tr>' : ''}
      ${(files.entries || []).map((e) => `<tr><td class="lt-td-strong">${e.type === 'dir' ? '📁' : '📄'} ${esc(e.name)}</td><td>${e.type}</td><td class="lt-td-mono">${fmtBytes(e.size)}</td><td>${e.type === 'file' ? `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-file="${esc(e.name)}">Edit</button>` : `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-dir="${esc(e.name)}">Open</button>`} <button class="lt-btn lt-btn-ghost lt-btn-sm" data-delete="${esc(e.name)}">Delete</button></td></tr>`).join('')}</tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="lt-btn lt-btn-secondary" id="newFolder">New folder</button><button class="lt-btn lt-btn-secondary" id="newFile">New file</button><button class="lt-btn lt-btn-secondary" id="uploadFile">Upload file</button></div>`)}`;
    tabView.querySelector('#parentDir')?.addEventListener('click', () => { currentFilePath = files.path.split('/').slice(0, -1).join('/') || '/'; renderInstance(id); });
    tabView.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { currentFilePath = `${files.path}/${b.dataset.dir}`.replace('//', '/'); renderInstance(id); }));
    tabView.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', async () => { const p = `${files.path}/${b.dataset.file}`; const data = await api.readFile(id, p); const result = await modal(`Edit ${b.dataset.file}`, `<form id="fileForm">${textarea('Content', 'content', data.content || '', 14)}</form>`, { confirm: 'Save' }); if (result) { await api.writeFile(id, { path: p, content: result.content }); toast('File saved', 'success'); } }));
    tabView.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Delete file', `Delete ${b.dataset.delete}?`, 'Delete')) { await api.writeFile(id, { op: 'delete', path: `${files.path}/${b.dataset.delete}` }); toast('Deleted', 'success'); renderInstance(id); } }));
    tabView.querySelector('#newFolder').addEventListener('click', async () => { const data = await modal('New folder', field('Folder name', 'name', 'text', '', 'required'), { confirm: 'Create' }); if (data) { await api.writeFile(id, { op: 'mkdir', path: `${files.path}/${data.name}` }); renderInstance(id); } });
    tabView.querySelector('#newFile').addEventListener('click', async () => { const data = await modal('New file', `${field('File name', 'name', 'text', '', 'required')}${textarea('Content', 'content', '', 8)}`, { confirm: 'Create' }); if (data) { await api.writeFile(id, { path: `${files.path}/${data.name}`, content: data.content }); renderInstance(id); } });
    tabView.querySelector('#uploadFile').addEventListener('click', async () => { const data = await modal('Upload file', `${field('Destination path', 'path', 'text', files.path, 'required')}${textarea('File content (text)', 'content', '', 10)}`, { confirm: 'Upload' }); if (data) { await api.writeFile(id, { path: data.path, content: data.content }); toast('File uploaded', 'success'); renderInstance(id); } });
  } else if (tab === 'metrics') {
    const points = metrics.metrics.map((m) => `<div class="lt-metric-row"><span class="lt-label">${fmtTime(m.ts)}</span><span class="v">CPU ${m.cpu}% · MEM ${m.mem}% · NET ${fmtNum(m.net_in)}/${fmtNum(m.net_out)}</span></div>`).join('');
    tabView.innerHTML = `${section('Resource usage', 'Historical metrics from the node agent', points ? points : empty('No metrics yet', 'Metrics appear once the node agent reports for this instance.'))}`;
    poll(async () => { if (currentView === 'instance' && currentInstanceTab === 'metrics') await renderInstance(id); }, 10000);
  } else if (tab === 'backups') {
    const backups = await api.backups(id);
    tabView.innerHTML = `${section('Backups', 'Create and restore instance data snapshots', `<button class="lt-btn lt-btn-primary" id="createBackup" style="margin-bottom:14px">Create backup</button>${backups.backups.length ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Status</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>${backups.backups.map((b) => `<tr><td class="lt-td-strong">${esc(b.name)}</td><td>${badge(b.status)}</td><td class="lt-td-mono">${fmtBytes(b.size_bytes)}</td><td>${fmtTime(b.created_at)}</td><td>${b.status === 'ready' ? `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-restore="${b.id}">Restore</button>` : ''}<button class="lt-btn lt-btn-ghost lt-btn-sm" data-delbackup="${b.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : empty('No backups', 'Create a backup to protect your instance data.')}`)}`;
    tabView.querySelector('#createBackup').addEventListener('click', async () => { const data = await modal('Create backup', field('Backup name', 'name', 'text', 'manual backup', 'required'), { confirm: 'Create' }); if (data) { await api.createBackup(id, data.name); toast('Backup created', 'success'); renderInstance(id); } });
    tabView.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Restore backup', 'This will overwrite current instance data. Continue?', 'Restore')) { await api.restoreBackup(id, b.dataset.restore); toast('Backup restored', 'success'); } }));
    tabView.querySelectorAll('[data-delbackup]').forEach((b) => b.addEventListener('click', async () => { await api.deleteBackup(b.dataset.delbackup); renderInstance(id); }));
  } else if (tab === 'settings') {
    tabView.innerHTML = `${section('Instance settings', 'Update image, resources, ports, and environment', `<form id="settingsForm">${field('Name', 'name', 'text', i.name)}${field('Image', 'image', 'text', i.image)}${field('Startup command', 'command', 'text', i.command)}${field('CPU cores', 'cpuCores', 'number', i.cpuCores, 'min="1" max="32"')}${field('Memory (MB)', 'memoryMb', 'number', i.memoryMb, 'min="128"')}${field('Storage (GB)', 'diskGb', 'number', i.diskGb, 'min="1"')}${textarea('Environment (KEY=value per line)', 'env', Object.entries(i.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'))}<button class="lt-btn lt-btn-primary" type="submit">Save changes</button></form>`)}
      ${section('Danger zone', 'Destructive operations', `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="lt-btn lt-btn-danger" id="reinstallBtn">Reinstall</button><button class="lt-btn lt-btn-danger" id="suspendBtn">${i.status === 'suspended' ? 'Resume' : 'Suspend'}</button></div>`)}`;
    tabView.querySelector('#settingsForm').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target).entries()); const env = {}; for (const line of String(data.env || '').split('\n')) { const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2]; } try { await api.updateInstance(id, { ...data, cpuCores: Number(data.cpuCores), memoryMb: Number(data.memoryMb), diskGb: Number(data.diskGb), env }); toast('Settings saved', 'success'); renderInstance(id); } catch (error) { toast(error.message, 'error'); } });
    tabView.querySelector('#reinstallBtn').addEventListener('click', async () => { if (await confirmDialog('Reinstall instance', 'Recreate the container from its image. Volume data is preserved.', 'Reinstall')) { await api.reinstall(id); toast('Instance reinstalled', 'success'); renderInstance(id); } });
    tabView.querySelector('#suspendBtn').addEventListener('click', async () => { await api.action(id, i.status === 'suspended' ? 'resume' : 'suspend'); toast('Instance updated', 'success'); renderInstance(id); });
  }
}
let currentInstanceTab = 'overview';
let currentFilePath = '/';

async function renderDeployments() {
  const view = app.querySelector('#view');
  const [list, instances] = await Promise.all([api.deployments(), api.instances()]);
  const rows = list.deployments.map((d) => `<tr><td class="lt-td-strong">${esc(d.instanceName || d.instanceId)}</td><td>${badge(d.status)}</td><td class="lt-td-mono">${esc(d.source)}</td><td class="lt-td-mono">${esc(d.version)}</td><td class="lt-td-mono">${esc(d.commitSha || '—')}</td><td>${fmtTime(d.createdAt)}</td></tr>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Deployments</h1><p class="lt-page-subtitle">Release history across your instances</p></div></div>
    ${section('Deployment history', `${list.deployments.length} records`, rows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Instance</th><th>Status</th><th>Source</th><th>Version</th><th>Commit</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No deployments', 'Deploy an instance to see its release history.'))}`;
  poll(async () => { if (currentView === 'deployments') await renderDeployments(); }, 8000);
}

async function renderNodes() {
  const view = app.querySelector('#view');
  const data = await api.nodes();
  const cards = data.nodes.map((n) => `<div class="lt-card" style="padding:var(--lt-space-4)">
    <div style="display:flex;justify-content:space-between"><span style="font-weight:700">${esc(n.name)}</span>${badge(n.status)}</div>
    <div class="lt-meta" style="margin-top:4px">${esc(n.host)} · ${esc(n.region)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;font-size:12px">
      <div><div class="lt-meta">CPU</div><div class="lt-kpi" style="font-size:18px">${Math.round(n.cpu_used)}%</div></div>
      <div><div class="lt-meta">Memory</div><div class="lt-kpi" style="font-size:18px">${Math.round(n.mem_used)}%</div></div>
      <div><div class="lt-meta">Disk</div><div class="lt-kpi" style="font-size:18px">${Math.round(n.disk_used)}%</div></div>
      <div><div class="lt-meta">Temp</div><div class="lt-kpi" style="font-size:18px">${Math.round(n.temp)}°C</div></div>
    </div>
    <div class="lt-meta" style="margin-top:10px">${n.cpu_cores} cores · ${fmtNum(n.memory_mb)} MB · ${n.disk_gb} GB · heartbeat ${fmtAgo(n.last_heartbeat)}</div>
    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><button class="lt-btn lt-btn-ghost lt-btn-sm" data-node-drain="${n.id}">${n.availability === 'draining' ? 'Activate' : 'Drain'}</button><button class="lt-btn lt-btn-ghost lt-btn-sm" data-node-token="${n.id}">Rotate token</button><button class="lt-btn lt-btn-danger lt-btn-sm" data-node-delete="${n.id}">Remove</button></div>
  </div>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Nodes</h1><p class="lt-page-subtitle">Distributed compute capacity connected to the control plane</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addNode">Register node</button></div></div>
    ${data.nodes.length ? `<div class="lt-grid lt-grid-3">${cards}</div>` : empty('No nodes registered', 'Register a hosting node and connect an agent to start deploying workloads.')}`;
  view.querySelector('#addNode').addEventListener('click', async () => {
    const data = await modal('Register node', `${field('Name', 'name', 'text', 'node-02', 'required')}${field('Host', 'host', 'text', 'node.example.com', 'required')}${field('Region', 'region', 'text', 'local')}${field('CPU cores', 'cpuCores', 'number', '4')}${field('Memory (MB)', 'memoryMb', 'number', '8192')}${field('Disk (GB)', 'diskGb', 'number', '100')}`, { confirm: 'Register' });
    if (!data) return;
    try { const result = await api.createNode(data); await modal('Node registered', `<p style="color:var(--lt-text-secondary);font-size:13px">Save this token for the node agent:</p><div class="lt-console" style="margin-top:10px"><div class="lt-console-body" style="height:auto;padding:12px">${esc(result.token)}</div></div>`, { confirm: 'Done' }); toast('Node registered', 'success'); renderNodes(); }
    catch (error) { toast(error.message, 'error'); }
  });
  view.querySelectorAll('[data-node-drain]').forEach((b) => b.addEventListener('click', async () => { await api.drainNode(b.dataset.nodeDrain); toast('Node availability updated', 'success'); renderNodes(); }));
  view.querySelectorAll('[data-node-token]').forEach((b) => b.addEventListener('click', async () => { const r = await api.nodeToken(b.dataset.nodeToken); await modal('New node token', `<div class="lt-console"><div class="lt-console-body" style="height:auto;padding:12px">${esc(r.token)}</div></div>`, { confirm: 'Done' }); }));
  view.querySelectorAll('[data-node-delete]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Remove node', 'Detach this node from the control plane.', 'Remove')) { try { await api.deleteNode(b.dataset.nodeDelete); toast('Node removed', 'success'); renderNodes(); } catch (error) { toast(error.message, 'error'); } } }));
  poll(async () => { if (currentView === 'nodes') await renderNodes(); }, 8000);
}

async function renderDomains() {
  const view = app.querySelector('#view');
  const [data, instances] = await Promise.all([api.domains(), api.instances()]);
  const rows = data.domains.map((d) => `<tr><td class="lt-td-strong">${esc(d.domain)}</td><td>${badge(d.verified ? 'active' : 'pending')}</td><td>${badge(d.ssl_status)}</td><td>${esc(instances.instances.find((i) => i.id === d.instance_id)?.name || d.instance_id)}</td><td>${!d.verified ? `<button class="lt-btn lt-btn-ghost lt-btn-sm" data-verify="${d.id}">Verify DNS</button>` : ''}<button class="lt-btn lt-btn-danger lt-btn-sm" data-deldomain="${d.id}">Remove</button></td></tr>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Domains</h1><p class="lt-page-subtitle">Custom domains and project subdomains</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addDomain">Add domain</button></div></div>
    ${section('Assigned domains', 'DNS verification records use _light.<domain>', rows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Domain</th><th>Verified</th><th>SSL</th><th>Instance</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No domains', 'Assign a custom domain to an instance to route traffic to it.'))}`;
  view.querySelector('#addDomain').addEventListener('click', async () => {
    const options = instances.instances.map((i) => ({ value: i.id, label: i.name }));
    const data = await modal('Add domain', `${field('Domain', 'domain', 'text', 'app.example.com', 'required')}${selectField('Instance', 'instanceId', options)}`, { confirm: 'Add' });
    if (!data) return;
    try { await api.createDomain(data); toast('Domain added — create the TXT record then verify', 'success'); renderDomains(); } catch (error) { toast(error.message, 'error'); }
  });
  view.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => { const r = await api.verifyDomain(b.dataset.verify); toast(r.verified ? 'Domain verified' : 'DNS record not found yet', r.verified ? 'success' : 'warning'); renderDomains(); }));
  view.querySelectorAll('[data-deldomain]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Remove domain', 'Detach this domain from the instance?', 'Remove')) { await api.deleteDomain(b.dataset.deldomain); renderDomains(); } }));
}

async function renderBackups() {
  const view = app.querySelector('#view');
  const r = await api.backupsAll();
  const rows = r.backups.map((b) => `<tr><td class="lt-td-strong">${esc(b.name)}</td><td>${esc(b.instance_name || b.instance_id)}</td><td>${badge(b.status)}</td><td class="lt-td-mono">${fmtBytes(b.size_bytes)}</td><td>${fmtTime(b.created_at)}</td></tr>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Backups</h1><p class="lt-page-subtitle">Instance snapshots stored on connected nodes</p></div></div>
    ${section('All backups', `${r.backups.length} snapshots`, rows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Instance</th><th>Status</th><th>Size</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No backups', 'Create backups from an instance’s Backups tab.'))}`;
}

async function renderSchedules() {
  const view = app.querySelector('#view');
  const [data, instances] = await Promise.all([api.schedules(), api.instances()]);
  const rows = data.schedules.map((s) => `<tr><td class="lt-td-strong">${esc(s.name)}</td><td>${esc(s.instance_name || s.instance_id)}</td><td>${esc(s.action)}</td><td class="lt-td-mono">${esc(s.cron)}</td><td>${badge(s.enabled ? 'active' : 'stopped')}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-toggle="${s.id}">${s.enabled ? 'Disable' : 'Enable'}</button><button class="lt-btn lt-btn-danger lt-btn-sm" data-del="${s.id}">Delete</button></td></tr>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Schedules</h1><p class="lt-page-subtitle">Automated tasks for your instances</p></div><div class="lt-page-actions"><button class="lt-btn lt-btn-primary" id="addSchedule">New schedule</button></div></div>
    ${section('Automation', 'Cron-style scheduling', rows ? `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Name</th><th>Instance</th><th>Action</th><th>Cron</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No schedules', 'Create a schedule to automate starts, stops, backups, and deployments.'))}`;
  view.querySelector('#addSchedule').addEventListener('click', async () => {
    const data = await modal('New schedule', `${field('Name', 'name', 'text', 'daily backup', 'required')}${selectField('Instance', 'instanceId', instances.instances.map((i) => ({ value: i.id, label: i.name })))}${selectField('Action', 'action', ['start', 'stop', 'restart', 'backup', 'deploy'])}${field('Cron expression', 'cron', 'text', '0 3 * * *', 'required')}`, { confirm: 'Create' });
    if (!data) return;
    try { await api.createSchedule(data); toast('Schedule created', 'success'); renderSchedules(); } catch (error) { toast(error.message, 'error'); }
  });
  view.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => { const s = data.schedules.find((x) => x.id === b.dataset.toggle); await api.updateSchedule(s.id, { enabled: !s.enabled }); renderSchedules(); }));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Delete schedule', 'Remove this schedule?', 'Delete')) { await api.deleteSchedule(b.dataset.del); renderSchedules(); } }));
}

async function renderAccount() {
  const view = app.querySelector('#view');
  const [me, plans, sessions] = await Promise.all([api.me(), api.plans(), api.sessions()]);
  const current = plans.plans.find((p) => p.id === me.team?.plan_id) || plans.plans[0];
  const user = me.user;
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Account & plans</h1><p class="lt-page-subtitle">Profile, security, appearance and resources</p></div></div>
    <div class="lt-grid lt-grid-2">
      ${section('Profile', 'Your account details', `<form id="profileForm">
        ${field('Name', 'name', 'text', user.name || '')}
        ${field('Username', 'username', 'text', user.username || '')}
        <div class="lt-meta" style="margin-bottom:12px">Email: ${esc(user.email)}</div>
        <button class="lt-btn lt-btn-primary" type="submit">Save profile</button></form>`)}
      ${section('Appearance', 'Dashboard visual identity', `<div class="lt-field"><label>Theme</label>
        <div style="display:flex;gap:8px">
          <button class="lt-btn ${document.documentElement.getAttribute('data-theme') !== 'light' ? 'lt-btn-primary' : 'lt-btn-secondary'}" data-theme-btn="dark">Dark</button>
          <button class="lt-btn ${document.documentElement.getAttribute('data-theme') === 'light' ? 'lt-btn-primary' : 'lt-btn-secondary'}" data-theme-btn="light">Light</button>
        </div></div>`)}
      ${section('Current plan', current?.name || 'Free', `<div class="lt-meta">${esc(current?.description || '')}</div><div class="lt-grid lt-grid-3" style="margin-top:14px">${[['Memory', `${current?.memory_mb || 0} MB`], ['Storage', `${current?.disk_gb || 0} GB`], ['Instances', current?.instances || 0]].map(([l, v]) => `<div><div class="lt-meta">${l}</div><div style="font-weight:700;font-size:18px">${v}</div></div>`).join('')}</div>`)}
      ${section('Available plans', 'Upgrade or downgrade your allocation', `<div class="lt-grid lt-grid-3">${plans.plans.map((p) => `<div class="lt-card" style="padding:14px"><div style="font-weight:700">${esc(p.name)}</div><div class="lt-meta">${p.memory_mb} MB · ${p.disk_gb} GB · ${p.instances} instances</div><div style="margin-top:10px;font-weight:700">${p.price_monthly ? '$' + (p.price_monthly / 100).toFixed(0) + '/mo' : 'Free'}</div></div>`).join('')}</div>`)}
      ${section('Change password', 'Update your credentials', `<form id="passwordForm">${field('Current password', 'currentPassword', 'password')}${field('New password (min 10 characters)', 'newPassword', 'password', '', 'minlength="10"')}<button class="lt-btn lt-btn-primary" type="submit">Update password</button></form>`)}
      ${section('Active sessions', 'Devices signed in to your account', `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Device</th><th>IP</th><th>Last seen</th><th></th></tr></thead><tbody>${(sessions.sessions || []).map((s) => `<tr><td class="lt-td-mono">${esc((s.user_agent || 'Unknown').slice(0, 50))}</td><td class="lt-td-mono">${esc(s.ip || '—')}</td><td>${fmtTime(s.last_seen)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-session="${s.id}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="4" class="lt-meta">No active sessions recorded</td></tr>'}</tbody></table></div>`)}
      ${section('Danger zone', 'Irreversible actions', `<button class="lt-btn lt-btn-danger" id="deleteAccount">Delete account</button><p class="lt-meta" style="margin-top:8px">Permanently deletes your account, workspaces and all services.</p>`)}
    </div>`;

  view.querySelector('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try { await api.updateProfile(data); toast('Profile saved', 'success'); renderAccount(); } catch (error) { toast(error.message, 'error'); }
  });
  view.querySelector('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try { const r = await api.changePassword(data); api.setToken(r.token); toast('Password updated', 'success'); e.target.reset(); } catch (error) { toast(error.message, 'error'); }
  });
  view.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', async () => {
    const theme = b.dataset.themeBtn;
    document.documentElement.setAttribute('data-theme', theme);
    try { await api.updateProfile({ theme }); localStorage.setItem('lt_theme', theme); toast('Theme updated', 'success'); renderAccount(); } catch (error) { toast(error.message, 'error'); }
  }));
  view.querySelectorAll('[data-session]').forEach((b) => b.addEventListener('click', async () => { await api.deleteSession(b.dataset.session); toast('Session revoked', 'success'); renderAccount(); }));
  view.querySelector('#deleteAccount').addEventListener('click', async () => {
    const ok = await modal('Delete account', `<p style="color:var(--lt-text-secondary);font-size:13px;line-height:1.6">This permanently deletes your account, workspaces and all services. Type <strong>DELETE</strong> to confirm.</p>${field('Confirmation', 'confirm', 'text', '', 'placeholder="DELETE"')}`, { danger: true, confirm: 'Delete account' });
    if (!ok || ok.confirm !== 'DELETE') return;
    try { await api.deleteAccount(); api.setToken(''); session = null; renderAuth('login'); toast('Account deleted', 'info'); } catch (error) { toast(error.message, 'error'); }
  });
}

async function renderAdmin() {
  const view = app.querySelector('#view');
  const [users, teams, audit] = await Promise.all([api.adminUsers(), api.teams(), api.audit()]);
  const userRows = users.users.map((u) => `<tr><td class="lt-td-strong">${esc(u.email)}</td><td>${esc(u.name || '—')}</td><td>${badge(u.role)}</td><td>${badge(u.status)}</td><td>${fmtTime(u.last_login)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-role="${u.id}">Toggle role</button></td></tr>`).join('');
  const teamRows = teams.teams.map((t) => `<tr><td class="lt-td-strong">${esc(t.name)}</td><td>${t.members} members</td><td>${t.instances} instances</td><td>${esc(t.plan_id)}</td><td><button class="lt-btn lt-btn-ghost lt-btn-sm" data-plan="${t.id}">Change plan</button></td></tr>`).join('');
  const auditRows = audit.events.slice(0, 30).map((e) => `<tr><td class="lt-td-mono">${fmtTime(e.ts)}</td><td class="lt-td-strong">${esc(e.action)}</td><td>${esc(e.target_type || '—')}</td><td>${esc(e.target_id || '—')}</td></tr>`).join('');
  view.innerHTML = `<div class="lt-page-header"><div><h1 class="lt-page-title">Administration</h1><p class="lt-page-subtitle">Users, workspaces, plans, and audit trail</p></div></div>
    <div class="lt-stack">
      ${section('Users', `${users.users.length} accounts`, `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${userRows}</tbody></table></div>`)}
      ${section('Workspaces', `${teams.teams.length} teams`, `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Workspace</th><th>Members</th><th>Instances</th><th>Plan</th><th>Actions</th></tr></thead><tbody>${teamRows}</tbody></table></div>`)}
      ${section('Audit log', 'Recent administrative and lifecycle events', `<div class="lt-table-wrap"><table class="lt-table"><thead><tr><th>Time</th><th>Action</th><th>Target</th><th>ID</th></tr></thead><tbody>${auditRows}</tbody></table></div>`)}
    </div>`;
  view.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => { const u = users.users.find((x) => x.id === b.dataset.role); await api.updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }); toast('Role updated', 'success'); renderAdmin(); }));
  view.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => { const plans = await api.plans(); const data = await modal('Change plan', selectField('Plan', 'planId', plans.plans.map((p) => ({ value: p.id, label: p.name }))), { confirm: 'Apply' }); if (data) { await api.setTeamPlan(b.dataset.plan, data.planId); toast('Plan updated', 'success'); renderAdmin(); } }));
}

/* ---------- boot ---------- */
window.addEventListener('hashchange', navigate);
window.addEventListener('lt:unauthorized', () => { toast('Session expired — please sign in', 'error'); session = null; renderAuth('login'); });

async function boot() {
  await loadBranding();
  if (!api.token()) { renderAuth('login'); return; }
  try { session = await api.me(); renderShell(); await navigate(); }
  catch (error) { api.setToken(''); renderAuth('login'); }
}
if (appHost) boot();
