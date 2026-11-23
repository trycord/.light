// .light — adaptive theme controller.
// Respects the OS preference by default; an explicit choice is saved locally
// and (when signed in) to the account profile so it follows the user.
const KEY = 'lt_theme_mode'; // 'system' | 'light' | 'dark' | 'high-contrast'

function systemPrefersLight() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function resolve(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'high-contrast') return mode;
  return systemPrefersLight() ? 'light' : 'dark';
}

export function applyTheme(mode) {
  const resolved = resolve(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-mode', mode || 'system');
  document.documentElement.style.colorScheme = resolved === 'light' ? 'light' : 'dark';
  document.dispatchEvent(new CustomEvent('lt:theme', { detail: { mode, resolved } }));
}

export function getThemeMode() { return localStorage.getItem(KEY) || 'system'; }

export function setTheme(mode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
  // Persist to the account when a session exists; ignore failures silently.
  try {
    const token = localStorage.getItem('lt_token');
    if (token) fetch('/api/auth/profile', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ theme: mode === 'system' ? 'dark' : mode }) }).catch(() => {});
  } catch { /* storage unavailable */ }
}

// Mobile detection — tag the document so CSS can gate mobile-only UI (bottom
// nav, card-style tables, wrapped topbar) regardless of viewport-only tricks.
function detectMobile() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth <= 640;
  const touch = navigator.maxTouchPoints > 0;
  document.documentElement.setAttribute('data-mobile', String((coarse || touch) && narrow));
}
detectMobile();
window.addEventListener('resize', detectMobile, { passive: true });

// Initialise from saved choice (or system), then follow OS changes while in system mode.
applyTheme(getThemeMode());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
  });
}

/* ---------- Theme toggle ---------- */
function currentResolved() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function paintToggles() {
  const next = currentResolved() === 'light' ? 'dark' : 'light';
  document.querySelectorAll('[data-theme-toggle]').forEach((el) => {
    el.textContent = currentResolved() === 'light' ? '☾' : '☀';
    el.setAttribute('aria-label', `Switch to ${next} theme`);
    el.title = `${next === 'light' ? 'Light' : 'Dark'} theme`;
  });
}

function toggleTheme() {
  setTheme(currentResolved() === 'light' ? 'dark' : 'light');
  paintToggles();
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-theme-toggle]');
  if (!el) return;
  event.preventDefault();
  toggleTheme();
});
document.addEventListener('lt:theme', paintToggles);
window.addEventListener('DOMContentLoaded', paintToggles);
paintToggles();

// Restrained scroll progress hairline
if (!document.querySelector('.lt-progress')) {
  const bar = document.createElement('div');
  bar.className = 'lt-progress';
  document.body.appendChild(bar);
  const update = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

window.__LT_THEME__ = { get: getThemeMode, set: setTheme, apply: applyTheme, toggle: toggleTheme };
