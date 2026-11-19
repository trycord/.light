// .light — live metric display engine. Values come from the control plane API.

const states = [];

function fmtValue(type, v) {
  switch (type) {
    case 'pct': return Math.round(v) + '%';
    case 'mem': return v.toFixed(1) + ' GB';
    case 'net':
    case 'net-in':
    case 'net-out': return Math.round(v) + ' Mbps';
    case 'temp': return v.toFixed(0) + '°C';
    case 'count':
    case 'running': return Math.round(v);
    default: return String(Math.round(v));
  }
}

function renderSpark(el, values) {
  if (!values || values.length < 2) { el.innerHTML = ''; return; }
  const w = 100;
  const h = 32;
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const span = max - min || 1;
  const pts = values.map(function (v, i) {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = 3 + (1 - (v - min) / span) * (h - 6);
    return [x, y];
  });
  let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) d += ' L ' + pts[i][0] + ' ' + pts[i][1];
  const area = d + ' L ' + pts[pts.length - 1][0] + ' ' + h + ' L ' + pts[0][0] + ' ' + h + ' Z';
  el.innerHTML = '<path class="area" d="' + area + '"/><path class="line" d="' + d + '"/>';
}

function paint(s) {
  if (s.valueEl) s.valueEl.textContent = fmtValue(s.fmt, s.value);
  const fill = s.el.querySelector('[data-role="fill"]');
  if (fill) {
    const ratio = (s.value - s.min) / (s.max - s.min || 1);
    fill.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
  }
  const stateClass = s.value >= s.crit ? 'is-crit' : s.value >= s.warn ? 'is-warn' : '';
  s.el.classList.remove('is-warn', 'is-crit');
  if (stateClass) s.el.classList.add(stateClass);
  const spark = s.el.querySelector('[data-role="spark"]') || (s.el.getAttribute('data-role') === 'spark' ? s.el : null);
  if (spark) renderSpark(spark, s.history);
}

function setValue(key, value, series) {
  const s = states.find(function (x) { return x.key === key; });
  if (!s) return;
  s.base = Number(value) || 0;
  s.value = s.base;
  if (Array.isArray(series) && series.length) {
    s.history = series.map(function (v) { return Number(v) || 0; });
  } else {
    s.history.push(s.value);
    if (s.history.length > 40) s.history.shift();
  }
  paint(s);
}

function initMetrics(root) {
  const scope = root || document;
  const els = scope.querySelectorAll('[data-live]');
  states.length = 0;
  for (const el of Array.from(els)) {
    const valueEl = el.querySelector('[data-role="value"]') || el;
    const baseRaw = el.getAttribute('data-base');
    const baseVal = baseRaw !== null ? parseFloat(baseRaw) : (parseFloat(el.textContent) || 0);
    const s = {
      el: el,
      key: el.getAttribute('data-live'),
      valueEl: valueEl,
      base: baseVal,
      min: parseFloat(el.getAttribute('data-min') || '0'),
      max: parseFloat(el.getAttribute('data-max') || '100'),
      fmt: el.getAttribute('data-fmt') || 'count',
      warn: parseFloat(el.getAttribute('data-warn') || '9999'),
      crit: parseFloat(el.getAttribute('data-crit') || '9999'),
      value: baseVal,
      history: [],
    };
    states.push(s);
    paint(s);
  }
}

window.__LT_METRICS__ = {
  init: initMetrics,
  setValue: setValue,
  states: states,
};

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initMetrics(); });
  } else {
    initMetrics();
  }
}
boot();
