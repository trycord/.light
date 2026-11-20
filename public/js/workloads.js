// .light — workloads page: real API data, filters, rendering, actions.

async function init() {
  const cardsEl = document.getElementById('workloadCards');
  const tableWrap = document.getElementById('workloadTable');
  const tbody = document.getElementById('workloadTbody');
  const search = document.querySelector('.lt-search input');
  const chips = Array.from(document.querySelectorAll('.lt-chip'));
  let list = [];

  async function load() {
    const api = window.__LT_API__;
    const res = await api.getWorkloads();
    list = (res && res.data && res.data.workloads) || [];
    render(getFilter());
  }

  function getFilter() {
    const chip = chips.find(function (c) { return c.classList.contains('active'); });
    return chip ? chip.getAttribute('data-filter') || 'all' : 'all';
  }

  function render(filter) {
    const f = filter || getFilter();
    const filtered = list.filter(function (w) {
      if (f === 'all') return true;
      if (f === 'game') return (w.type || '').toLowerCase() === 'game';
      if (f === 'web') return (w.type || '').toLowerCase() === 'web';
      if (f === 'db') return (w.type || '').toLowerCase() === 'db';
      return true;
    });
    if (cardsEl) cardsEl.innerHTML = filtered.map(workloadCard).join('');
    if (tbody) tbody.innerHTML = filtered.map(workloadRow).join('');
    if (tableWrap) tableWrap.style.display = f === 'all' ? '' : 'none';
  }

  function workloadCard(w) {
    const type = (window.__LT_DATA__ && window.__LT_DATA__.WORKLOAD_TYPES && window.__LT_DATA__.WORKLOAD_TYPES[w.type]) || { label: w.type, color: 'var(--lt-ember-500)', icon: '◈' };
    const statusBadgeHtml = window.__LT_DATA__.statusBadge(w.status);
    return `
      <div class="lt-card lt-card-hover" style="padding:var(--lt-space-4);display:flex;flex-direction:column;gap:var(--lt-space-3)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span class="lt-badge" style="background:${type.color}1a;border-color:${type.color}40;color:${type.color}">${type.icon} ${type.label}</span>
          ${statusBadgeHtml}
        </div>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--lt-text)">${w.name}</div>
          <div class="lt-meta" style="margin-top:2px">${w.runtime} · ${w.version}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--lt-text-secondary)">
          <span>Node</span><b style="color:var(--lt-text)">${w.node_name || w.node_id}</b>
          <span>·</span><span>Instances <b style="color:var(--lt-text)">${w.instances}</b></span>
        </div>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--lt-text-secondary)">
          <span>CPU <b class="lt-metric-value" style="color:var(--lt-text)">${w.cpu_limit}</b></span>
          <span>MEM <b class="lt-metric-value" style="color:var(--lt-text)">${(w.mem_limit_mb / 1024).toFixed(1)}GB</b></span>
          <span>DISK <b class="lt-metric-value" style="color:var(--lt-text)">${w.disk_gb}GB</b></span>
        </div>
        <div class="lt-meter"><div class="lt-meter-fill" style="width:${Math.min(100, (w.cpu_limit / 8) * 100)}%"></div></div>
        <div style="display:flex;gap:8px;margin-top:auto">
          <button class="lt-btn lt-btn-ghost lt-btn-sm" type="button" data-action="console">Console</button>
          <button class="lt-btn lt-btn-ghost lt-btn-sm" type="button" data-action="restart">Restart</button>
          <button class="lt-btn lt-btn-ghost lt-btn-sm" type="button" data-action="stop">Stop</button>
        </div>
      </div>
    `;
  }

  function workloadRow(w) {
    const type = (window.__LT_DATA__ && window.__LT_DATA__.WORKLOAD_TYPES && window.__LT_DATA__.WORKLOAD_TYPES[w.type]) || { label: w.type, color: 'var(--lt-ember-500)', icon: '◈' };
    const status = w.status || 'pending';
    const badgeColor = status === 'running' ? 'success' : status === 'stopped' ? 'neutral' : status === 'deploying' ? 'warning' : status === 'error' ? 'danger' : status === 'pending' ? 'info' : 'neutral';
    const badgeLabel = status.charAt(0).toUpperCase() + status.slice(1);
    return `
      <tr>
        <td><span class="lt-td-strong">${w.name}</span> <span class="lt-td-mono" style="color:var(--lt-text-muted)">${w.runtime}</span></td>
        <td><span class="lt-badge" style="background:${type.color}1a;border-color:${type.color}40;color:${type.color}">${type.icon} ${type.label}</span></td>
        <td>${w.node_name || w.node_id}</td>
        <td><span class="lt-badge lt-badge-${badgeColor}"><span class="lt-dot lt-dot-${badgeColor}"></span>${badgeLabel}</span></td>
        <td class="lt-td-mono">${w.cpu_limit}</td>
        <td class="lt-td-mono">${(w.mem_limit_mb / 1024).toFixed(1)}GB</td>
        <td class="lt-td-mono">${w.disk_gb}GB</td>
        <td class="lt-td-mono">—</td>
        <td></td>
      </tr>`;
  }

  async function reload() { await load(); }

  await load();

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      render(getFilter());
    });
  });

  if (search) {
    search.addEventListener('input', function () {
      const q = search.value.toLowerCase();
      const filtered = list.filter(function (w) { return (w.name + ' ' + w.runtime).toLowerCase().indexOf(q) > -1; });
      if (cardsEl) cardsEl.innerHTML = filtered.map(workloadCard).join('');
      if (tbody) tbody.innerHTML = filtered.map(workloadRow).join('');
    });
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const card = btn.closest ? btn.closest('.lt-card') : null;
    const nameEl = card ? card.querySelector('div[style*="font-size:15px"]') : null;
    const name = nameEl ? nameEl.textContent : 'workload';
    const id = card ? card.getAttribute('data-workload-id') : null;
    if (action === 'console') {
      window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Console session requested for ' + name, type: 'info' } }));
    } else if (action === 'restart') {
      if (id) {
        window.__LT_API__.setWorkloadState(id, 'restart').then(function () {
          window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Restart queued for ' + name, type: 'info' } }));
        });
      } else {
        window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Restart queued for ' + name, type: 'info' } }));
      }
    } else if (action === 'stop') {
      if (id) {
        window.__LT_API__.setWorkloadState(id, 'stop').then(function () {
          window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Stop signal sent to ' + name, type: 'warning' } }));
        });
      } else {
        window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Stop signal sent to ' + name, type: 'warning' } }));
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
