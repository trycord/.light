// .light — deployments page: real API data, deploy action.

async function init() {
  const logEl = document.getElementById('deployLog');
  const btn = document.getElementById('deployStartBtn');
  const progress = document.querySelector('.lt-progress-bar');
  const workloadSel = document.getElementById('deployWorkload');
  const versionSel = document.getElementById('deployVersion');

  async function load() {
    const api = window.__LT_API__;
    const res = await api.getDeployments();
    const deployments = (res && res.data && res.data.deployments) || [];
    if (logEl) {
      if (deployments.length === 0) {
        logEl.innerHTML = '<div class="lt-console-line info"><span class="ts">--:--:--</span> <span>info · no deployments recorded yet</span></div>';
      } else {
        logEl.innerHTML = deployments.slice(0, 20).map(function (d) {
          const status = d.status || 'pending';
          const level = status === 'success' ? 'success' : status === 'failed' ? 'error' : 'info';
          const ts = new Date(d.started_at || Date.now());
          const tsStr = ts.toTimeString().slice(0, 8);
          return '<div class="lt-console-line ' + level + '"><span class="ts">' + tsStr + '</span> <span>' + (d.version || '') + ' · ' + (d.workload_id || '') + ' → ' + status + '</span></div>';
        }).join('');
      }
    }
  }

  async function loadWorkloads() {
    const api = window.__LT_API__;
    const res = await api.getWorkloads();
    const workloads = (res && res.data && res.data.workloads) || [];
    if (workloadSel) {
      workloadSel.innerHTML = '<option value="">Select workload…</option>';
      workloads.forEach(function (w) {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name + ' (' + (w.type || '') + ')';
        workloadSel.appendChild(opt);
      });
    }
  }

  async function doDeploy() {
    const api = window.__LT_API__;
    const wid = workloadSel ? workloadSel.value : null;
    const version = versionSel ? versionSel.value : 'latest';
    if (!wid) { window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Select a workload to deploy', type: 'warning' } })); return; }
    const res = await api.deployWorkload(wid, version);
    const depId = (res && res.data && res.data.deployment && res.data.deployment.id) || ('dep_' + Date.now());
    if (progress) progress.style.width = '0%';
    const timer = setInterval(async function () {
      const stRes = await api.getDeployments();
      const deployments = (stRes && stRes.data && stRes.data.deployments) || [];
      const dep = deployments.find(function (d) { return d.id === depId; });
      const status = (dep && dep.status) || 'deploying';
      const pct = (status === 'success' || status === 'failed') ? 100 : 50;
      if (progress) progress.style.width = pct + '%';
      if (status === 'success' || status === 'failed') {
        clearInterval(timer);
        if (btn) { btn.disabled = false; btn.textContent = 'Deploy workload'; }
        window.dispatchEvent(new CustomEvent('lt:toast', { detail: { message: 'Deployment finished: ' + status, type: status === 'success' ? 'success' : 'error' } }));
      }
    }, 900);
  }

  if (btn) {
    btn.addEventListener('click', async function () { await doDeploy(); });
  }

  await load();
  await loadWorkloads();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
