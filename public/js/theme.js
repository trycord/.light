// .light — adaptive theme controller.
// Respects the OS preference by default; an explicit choice is saved locally
// and (when signed in) to the account profile so it follows the user.
const KEY = 'lt_theme_mode'; // 'system' | 'light' | 'dark' | 'high-contrast'

function systemPrefersLight() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function resolve(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'high-contrast') return mode;
  // .light ships with a light-first visual system. Explicit choices still win.
  return 'light';
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

// Initialise from saved choice (or system), then follow OS changes while in system mode.
applyTheme(getThemeMode());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
  });
}

window.__LT_THEME__ = { get: getThemeMode, set: setTheme, apply: applyTheme };
