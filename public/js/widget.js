// .light — desktop widget: real node metrics from the control plane.

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

async function refresh() {
  const api = window.__LT_API__;
  if (!api) return;
  try {
    const nr = await api.getNodes();
    const nodes = (nr && nr.data && nr.data.nodes) || [];
    const online = nodes.filter(function (n) { return n.status === 'online'; });
    if (!online.length) return;
    let cpu = 0, mem = 0, net = 0, temp = 0, n = 0;
    const cpuSeries = [], netSeries = [];
    for (const node of online) {
      const mr = await api.getNodeMetrics(node.id);
      const d = (mr && mr.data) || {};
      const arr = d.metrics || d.samples || d.history || [];
      for (const sample of arr) {
        cpuSeries.push(Number(sample.cpu || 0));
        netSeries.push(Number(sample.net_in || sample.netIn || 0));
      }
      const last = arr[arr.length - 1];
      if (last) {
        cpu += Number(last.cpu || 0);
        mem += Number(last.mem || 0);
        net += Number(last.net_in || last.netIn || 0);
        temp += Number(last.temp || 0);
        n += 1;
      }
    }
    const nodeLabel = document.getElementById('widgetNode');
    if (nodeLabel && online[0]) nodeLabel.textContent = 'node ' + (online[0].name || online[0].id);
    if (n) {
      setLive('cpu', Math.round(cpu / n), cpuSeries);
      setLive('mem', Math.round(mem / n));
      setLive('netIn', Math.round(net / n), netSeries);
      setLive('temp', Math.round(temp / n));
    }
  } catch (e) { /* keep last values */ }
}

function init() {
  refresh();
  window.setInterval(refresh, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
