// .light — public website data from the backend API.
import api from '/js/api.js';

const app = document.getElementById('site');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadBranding() {
  try { return await api.branding(); } catch { return {}; }
}

const PRODUCTS = [
  { id: 'game', icon: '◆', title: 'Game Servers', desc: 'Deploy Minecraft, Rust, Factorio, Satisfactory and more. Version selection, live console, mod support and automatic updates.', color: '#FF4D24' },
  { id: 'web', icon: '◈', title: 'Applications', desc: 'Node.js, Python, Go, PHP and any containerized app. Git-based deploys, environment variables and custom startup commands.', color: '#4C9B8A' },
  { id: 'website', icon: '◧', title: 'Websites', desc: 'Static sites and dynamic web apps with custom domains, SSL and global delivery. Simple, fast and reliable.', color: '#F2C75C' },
  { id: 'bot', icon: '◇', title: 'Bots', desc: 'Host Discord bots, Telegram bots and background workers with persistent storage and automatic restarts.', color: '#A96745' },
  { id: 'database', icon: '▤', title: 'Databases', desc: 'PostgreSQL, Redis, MySQL and more. Isolated, backed up and ready to connect to your applications.', color: '#6FB3A0' },
  { id: 'docker', icon: '◉', title: 'Custom Docker', desc: 'Bring any Docker image. Full control over commands, ports, volumes, environment and resources.', color: '#D8D0C3' },
];

const FEATURES = [
  ['Instant provisioning', 'Create a server and it is live in moments — no infrastructure work required.'],
  ['Live console & logs', 'Watch output in real time and run commands directly from your browser.'],
  ['Built-in file manager', 'Browse, upload, edit and manage files without SSH.'],
  ['Automatic backups', 'Schedule snapshots and restore them whenever you need.'],
  ['Custom domains & SSL', 'Point a domain at your service with automated certificate provisioning.'],
  ['Resource controls', 'Set CPU, memory and storage limits that are enforced by the platform.'],
  ['Distributed nodes', 'Capacity scales across machines while your dashboard stays simple.'],
  ['Tenant isolation', 'Every service runs isolated — your data stays yours.'],
];

const FAQS = [
  ['Do I need to know Docker or Linux?', 'No. .light handles containers, networking and infrastructure for you. You choose what to host and configure it through a simple dashboard.'],
  ['What can I host?', 'Game servers, websites, web applications, bots, databases, APIs and virtually any Docker-based service.'],
  ['Can I use my own domain?', 'Yes. Every service gets a project subdomain, and you can attach custom domains with automatic SSL.'],
  ['Is there a free plan?', 'Yes. The free plan includes 512 MB RAM and 4 GB storage — enough to get started. Upgrade any time.'],
  ['Are my services isolated?', 'Yes. Each service runs in its own container with resource limits and strict tenant isolation.'],
  ['Can I self-host .light?', 'Yes. .light is available as a single Docker container with Docker Compose, independent of Trycord infrastructure.'],
];

function layout(brand, content, active = '') {
  const product = esc(brand.product || '.light');
  return `<!DOCTYPE html><html lang="en" data-theme="dark"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="${product} — universal hosting platform for game servers, applications, websites and more.">
    <meta property="og:title" content="${product} — universal hosting"><meta property="og:type" content="website">
    <title>${esc(brand.docTitle || '.light — universal hosting')}</title>
    <link rel="icon" href="${esc(brand.favicon || '/assets/logos/favicon.svg')}">
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/site.css">
  </head><body>
    <header class="site-header"><div class="site-wrap site-nav">
      <a href="/" class="site-brand"><img src="${esc(brand.logo || '/assets/logos/light-primary.svg')}" height="34" alt="${product}"></a>
      <nav class="site-links">
        <a href="/hosting" class="${active === 'products' ? 'active' : ''}">Products</a>
        <a href="/#features">Features</a>
        <a href="/pricing" class="${active === 'pricing' ? 'active' : ''}">Pricing</a>
        <a href="/docs">Docs</a><a href="/about">About</a>
      </nav>
      <div class="site-actions">
        <a href="/login" class="lt-btn lt-btn-ghost">Sign in</a>
        <a href="/login#register" class="lt-btn lt-btn-primary">Get Started</a>
      </div>
    </div></header>
    <main>${content}</main>
    <footer class="site-footer"><div class="site-wrap">
      <div class="site-footer-grid">
        <div><div class="site-brand" style="margin-bottom:10px"><img src="${esc(brand.wordmark || '/assets/logos/light-wordmark.svg')}" height="26" alt="${product}"></div>
          <p class="site-muted">Universal hosting for games, apps, websites and more. Infrastructure made simple.</p></div>
        <div><h4>Product</h4><a href="/hosting">Products</a><a href="/pricing">Pricing</a><a href="/docs">Documentation</a></div>
        <div><h4>Company</h4><a href="/about">About</a><a href="/contact">Contact</a><a href="/legal">Legal</a></div>
        <div><h4>Account</h4><a href="/login">Dashboard</a><a href="/login#register">Create account</a></div>
      </div>
      <div class="site-footer-bottom">
        <span>${esc(brand.attribution || '.light is a Trycord product')} · © 2026 Trycord</span>
        <span class="site-muted">${esc(brand.tagline || 'Universal hosting platform')} · ${esc(brand.domain || 'trycord.dev')}</span>
      </div>
    </div></footer>
  </body></html>`;
}

export { layout, esc, loadBranding, PRODUCTS, FEATURES, FAQS };
window.__LT_SITE__ = { layout, esc, loadBranding, PRODUCTS, FEATURES, FAQS };
