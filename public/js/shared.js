// .light — shared frontend primitives used by every application shell.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (t) => t ? new Date(t).toLocaleString() : '—';
export const fmtAgo = (t) => {
  if (!t) return 'never';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
export const fmtMoney = (c, cur = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD' }).format(Number(c || 0) / 100);

/** Minimal inline SVG area chart — no dependencies, inherits theme tokens. */
export function sparkline(values = [], { width = 320, height = 64, color = 'var(--lt-ember-500)', fill = true, max = 100 } = {}) {
  const data = (values || []).map(v => Math.max(0, Number(v) || 0));
  if (data.length < 2) return `<div class="lt-chart-empty">Collecting data…</div>`;
  const peak = max || Math.max(1, ...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (Math.min(v, peak) / peak) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="lt-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="usage over time">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${fill ? `<path d="${area}" fill="url(#${id})"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** Keep Tab focus inside a modal dialog. */
export function trapFocus(container, event) {
  if (event.key !== 'Tab' || !container) return;
  const focusable = [...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
