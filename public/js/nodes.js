// .light — nodes page: real API data for hosting nodes.

function nodeCard(node, metrics) {
  const status = node.status || 'offline';
  const color = status === 'online' ? 'success' : 'danger';
  const label = status === 'online' ? 'Online' : status === 'offline' ? 'Unreachable' : status;
  const last = (metrics && metrics[metrics.length - 1]) || null;
  const cpu = last ? Math.round(Number(last.cpu || 0)) : null;
  const mem = last ? Math.round(Number(last.mem || 0)) : null;
  return '<div class="lt-card lt-card-hover" style="padding:var(--lt-space-4)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span class="lt-badge lt-badge-' + color + '"><span class="lt-dot lt-dot-' + color + '"></span>' + label + '</span>' +
      '<span class="lt-badge lt-badge-neutral">' + (node.region || 'local') + '</span>' +
    '</div>' +
    '<div style="font-size:16px;font-weight:700;margin-top:10px">' + node.name + '</div>' +
    '<div class="lt-meta" style="margin-top:2px">' + node.host + ' · ' + (node.cpu_cores || node.cpuCores || '—') + ' vCPU · ' + Math.round((node.memory_mb || node.memoryMb || 0) / 1024) + 'GB</div>' +
    '<div style="display:flex;gap:12px;margin-top:14px;font-size:12px;color:var(--lt-text-secondary)">' +
      '<span>CPU <b class="lt-metric-value" style="color:var(--lt-text)">' + (cpu !== null ? cpu + '%' : '—') + '</b></span>' +
      '<span>MEM <b class="lt-metric-value" style="color:var(--lt-text)">' + (mem !== null ? mem + '%' : '—') + '</b></span>' +
    '</div>' +
    '<div class="lt-meter" style="margin-top:10px"><div class="lt-meter-fill" style="width:' + (cpu !== null ? cpu : 0) + '%"></div></div>' +
  '</div>';
}

async function init() {
  const api = window.__LT_API__;
  const container = document.getElementById('nodeCards');
  if (!api || !container) return;
  try {
    const r = await api.getNodes();
    const nodes = (r && r.data && r.data.nodes) || [];
    if (!nodes.length) {
      container.innerHTML = '<div class="lt-card" style="padding:var(--lt-space-5);grid-column:1/-1"><div class="lt-meta">No hosting nodes registered yet. Connect a node agent with a valid NODE_TOKEN.</div></div>';
      return;
    }
    const html = await Promise.all(nodes.map(async function (node) {
      let metrics = [];
      try {
        const mr = await api.getNodeMetrics(node.id);
        const d = (mr && mr.data) || {};
        metrics = d.metrics || d.samples || d.history || [];
      } catch (e) { /* offline node */ }
      return nodeCard(node, metrics);
    }));
    container.innerHTML = html.join('');
  } catch (e) {
    container.innerHTML = '<div class="lt-card" style="padding:var(--lt-space-5);grid-column:1/-1"><div class="lt-meta">Could not load nodes.</div></div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
