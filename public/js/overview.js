// .light — overview page: real API data for KPIs, monitors, workloads and deployments.

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setLive(key, value, series) {
  const m = window.__LT_METRICS__;
  if (m && m.setValue) { m.setValue(key, value, series); return; }
  const el = document.querySelector('[data-live="' + key + '"]');
  if (!el) return;
  el.setAttribute('data-base', String(value));
  const valueEl = el.querySelector('[data-role="value"]') || el;
  valueEl.textContent = value;
  const fill = el.querySelector('[data-role="fill"]');
  if (fill) fill.style.width = Math.max(0, Math.min(100, value)) + '%';
}

function badge(status) {
  const map = {
    running: 'success', stopped: 'neutral', deploying: 'warning', error: 'danger', pending: 'info',
  };
  const c = map[status] || 'neutral';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return '<span class="lt-badge lt-badge-' + c + '"><span class="lt-dot lt-dot-' + c + '"></span>' + label + '</span>';
}

function card(w) {
  const types = (window.__LT_DATA__ && window.__LT_DATA__.WORKLOAD_TYPES) || {};
  const type = types[w.type] || { label: w.type || 'web', color: 'var(--lt-ember-500)', icon: '◈' };
  const memGb = (Number(w.mem_limit_mb || 0) / 1024).toFixed(1);
  return '<div class="lt-card lt-card-hover" style="padding:var(--lt-space-4)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span class="lt-badge" style="background:' + type.color + '1a;border-color:' + type.color + '40;color:' + type.color + '">' + type.icon + ' ' + type.label + '</span>' + badge(w.status) +
    '</div>' +
    '<div style="font-size:15px;font-weight:700;margin-top:10px">' + w.name + '</div>' +
    '<div class="lt-meta" style="margin-top:2px">' + w.runtime + ' · ' + w.version + '</div>' +
    '<div style="display:flex;gap:12px;margin-top:14px;font-size:12px;color:var(--lt-text-secondary)">' +
      '<span>CPU <b class="lt-metric-value" style="color:var(--lt-text)">' + w.cpu_limit + '</b></span>' +
      '<span>MEM <b class="lt-metric-value" style="color:var(--lt-text)">' + memGb + 'GB</b></span>' +
    '</div>' +
    '<div class="lt-meter" style="margin-top:10px"><div class="lt-meter-fill" style="width:' + Math.min(100, (Number(w.cpu_limit || 0) / 8) * 100) + '%"></div></div>' +
    '<div class="lt-meta" style="margin-top:8px">' + (w.node_name || w.node_id) + '</div>' +
  '</div>';
}

async function init() {
  const api = window.__LT_API__;
  if (!api) return;

  try {
    const r = await api.getStats();
    const s = r && r.data;
    if (s) {
      setText('kpiRunning', String((s.workloads && s.workloads.running) || 0));
      setText('kpiNodesOnline', ((s.nodes && s.nodes.online) || 0) + '/' + ((s.nodes && s.nodes.total) || 0));
      setText('kpiAlerts', String((s.deployments && s.deployments.failed) || 0));
    }
  } catch (e) { /* keep last values */ }

  try {
    const nr = await api.getNodes();
    const nodes = (nr && nr.data && nr.data.nodes) || [];
    let cpu = 0, mem = 0, net = 0, n = 0;
    const cpuSeries = [], memSeries = [], netSeries = [];
    for (const node of nodes.filter(function (x) { return x.status === 'online'; })) {
      const mr = await api.getNodeMetrics(node.id);
      const d = (mr && mr.data) || {};
      const arr = d.metrics || d.samples || d.history || [];
      for (const sample of arr) {
        cpuSeries.push(Number(sample.cpu || 0));
        memSeries.push(Number(sample.mem || 0));
        netSeries.push(Number(sample.net_in || sample.netIn || 0));
      }
      const last = arr[arr.length - 1];
      if (last) {
        cpu += Number(last.cpu || 0);
        mem += Number(last.mem || 0);
        net += Number(last.net_in || last.netIn || 0) + Number(last.net_out || last.netOut || 0);
        n += 1;
      }
    }
    if (n) {
      setText('kpiNet', String(Math.round(net)));
      setLive('cpu', Math.round(cpu / n), cpuSeries);
      setLive('mem', Math.round(mem / n), memSeries);
      setLive('net', Math.round(net), netSeries);
    }
  } catch (e) { /* keep live engine defaults */ }

  try {
    const wr = await api.getWorkloads();
    const workloads = (wr && wr.data && wr.data.workloads) || [];
    const container = document.getElementById('overviewWorkloads');
    if (container) container.innerHTML = workloads.slice(0, 3).map(card).join('');
  } catch (e) { /* no workloads */ }

  try {
    const dr = await api.getDeployments();
    const deployments = (dr && dr.data && dr.data.deployments) || [];
    const alertsList = document.getElementById('overviewAlerts');
    if (alertsList) {
      const failed = deployments.filter(function (d) { return d.status === 'failed'; });
      alertsList.innerHTML = failed.length
        ? failed.slice(0, 3).map(function (d) {
            return '<div class="lt-alert lt-alert-danger"><div><div class="lt-alert-title">Deployment failed</div>' +
              '<div class="lt-alert-desc">' + d.workload_id + ' · ' + (d.version || '') + '</div></div></div>';
          }).join('')
        : '<div class="lt-meta">No active alerts</div>';
    }
    const depList = document.getElementById('overviewDeployments');
    if (depList) {
      if (!deployments.length) {
        depList.innerHTML = '<div class="lt-meta">No deployments recorded yet</div>';
      } else {
        depList.innerHTML = deployments.slice(0, 4).map(function (d) {
          const status = d.status || 'pending';
          const color = status === 'success' ? 'success' : status === 'failed' ? 'danger' : status === 'deploying' ? 'warning' : 'info';
          const label = status.charAt(0).toUpperCase() + status.slice(1);
          return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
            '<div><div style="font-size:13px;font-weight:650">' + d.workload_id + '</div>' +
            '<div class="lt-meta">' + (d.version || '') + ' · ' + new Date(d.started_at || Date.now()).toLocaleString() + '</div></div>' +
            '<span class="lt-badge lt-badge-' + color + '"><span class="lt-dot lt-dot-' + color + '"></span>' + label + '</span></div>';
        }).join('<div class="lt-divider" style="margin:0"></div>');
      }
    }
  } catch (e) { /* no deployments */ }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
