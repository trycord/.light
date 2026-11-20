// .light — shared shell for all public marketing pages (Step 2 design system).
// Every page renders through this so navigation, footer, theme controls and
// branding stay identical across the website.
import api from '/js/api.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NAV = [
  { label: 'Hosting', href: '/hosting', key: 'hosting' },
  { label: 'Plans', href: '/pricing', key: 'pricing' },
  { label: 'Build your own', href: '/configure', key: 'configure' },
  { label: 'Features', href: '/features', key: 'features' },
  { label: 'Platform', href: '/about', key: 'platform' },
  { label: 'Docs', href: '/docs', key: 'docs' },
];

function nav(b, active) {
  const product = esc(b.product || '.light');
  return `<a class="mkt-skip" href="#main">Skip to content</a>
  <nav class="mkt-nav" aria-label="Main navigation"><div class="mkt-nav-in">
    <a href="/" class="mkt-logo" aria-label="${product} home"><span style="color:var(--lt-ember-500)">◆</span>${product}</a>
    <div class="mkt-links" id="mktLinks">
      ${NAV.map(n => `<a href="${n.href}" ${n.key === active ? 'aria-current="page" class="active"' : ''}>${n.label}</a>`).join('')}
      <a href="/contact">Support</a>
    </div>
    <div class="mkt-cta"><a class="lt-btn lt-btn-ghost lt-btn-sm" href="/login">Sign in</a>
      <a class="lt-btn lt-btn-primary lt-btn-sm" href="/hosting">Get started</a></div>
    <button class="mkt-burger" id="burger" aria-label="Open menu" aria-expanded="false">☰</button>
  </div></nav>`;
}

function footer(b) {
  const product = esc(b.product || '.light');
  return `<footer class="mkt-foot"><div class="mkt-foot-in">
    <div><a href="/" class="mkt-logo"><span style="color:var(--lt-ember-500)">◆</span>${product}</a>
      <p class="muted" style="max-width:300px">${esc(b.tagline || 'Universal hosting platform')}. Built by Trycord, powered by Shade.</p>
      <div style="font-size:11px;color:var(--lt-text-muted)">Theme:
        ${['system','light','dark','high-contrast'].map(t => `<a href="#" data-theme-set="${t}" style="display:inline;margin-right:6px">${t}</a>`).join('')}</div></div>
    <div><h4>Platform</h4><a href="/hosting">Hosting</a><a href="/pricing">Plans</a><a href="/features">Features</a><a href="/docs">Documentation</a></div>
    <div><h4>Company</h4><a href="/about">About</a><a href="/contact">Contact & support</a><a href="/legal">Legal</a></div>
    <div><h4>Account</h4><a href="/login">Dashboard</a><a href="/checkout">Checkout</a><a href="/connect">Sell with Connect</a></div>
  </div><div class="mkt-foot-in mkt-wm">
    <span>${esc(b.attribution || '.light is a Trycord product')} · © 2026 Trycord</span>
    <span><a href="https://trycord.dev" target="_blank" rel="noopener">POWERED BY TRYCORD</a> · <span class="lt-wm-mark">ΔΓΟ</span></span>
  </div></footer>`;
}

export async function page({ title, description, active, eyebrow, heading, lede, content, wide = false }) {
  let b = {};
  try { b = await api.branding(); } catch {}
  const product = esc(b.product || '.light');
  const root = document.getElementById('site');
  if (title) document.title = `${title} — ${product}`;
  root.innerHTML = nav(b, active) + `<main id="main">
    <section class="mkt-page-hero"><div class="mkt-hero-grid" style="grid-template-columns:1fr">
      <div><span class="mkt-eyebrow">${esc(eyebrow || product)}</span>
        <h1 style="font-size:clamp(2.2rem,4.6vw,3.4rem)">${heading || esc(title || '')}</h1>
        ${lede ? `<p class="mkt-lede">${lede}</p>` : ''}</div>
    </div></section>
    <div class="mkt-section${wide ? ' wide' : ''}" style="padding-top:48px">${content}</div>
  </main>` + footer(b);
  document.getElementById('burger')?.addEventListener('click', (e) => {
    const links = document.getElementById('mktLinks');
    links.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', links.classList.contains('open') ? 'true' : 'false');
  });
  document.querySelectorAll('[data-theme-set]').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault(); window.__LT_THEME__?.set(el.dataset.themeSet);
  }));
  return b;
}

export function errorBox(msg) { return `<div class="lt-error" role="alert">${esc(msg)}</div>`; }
export function emptyBox(title, text, action = '') {
  return `<div class="mkt-card" style="text-align:center;padding:42px"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>${action}</div>`;
}
