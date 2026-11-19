// .light — real API client. All functions return the parsed response body directly.
const API_BASE = window.__LT_API_BASE__ || '';

function token() { return localStorage.getItem('lt_token') || ''; }
function setToken(value) { value ? localStorage.setItem('lt_token', value) : localStorage.removeItem('lt_token'); }

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let response;
  try {
    response = await fetch(API_BASE + path, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
  } catch (error) {
    throw new Error('Cannot reach the control plane. Check your connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token()) {
      setToken('');
      window.dispatchEvent(new CustomEvent('lt:unauthorized', { detail: body }));
    }
    const error = new Error(body.message || body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.error;
    throw error;
  }
  return body;
}

const api = {
  token, setToken,
  branding: () => request('/api/branding'),
  register: (data) => request('/api/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/api/auth/login', { method: 'POST', body: data }),
  me: () => request('/api/auth/me'),
  changePassword: (data) => request('/api/auth/password', { method: 'POST', body: data }),
  stats: () => request('/api/stats'),
  instances: (all = false) => request(`/api/instances${all ? '?all=true' : ''}`),
  instance: (id) => request(`/api/instances/${id}`),
  createInstance: (data) => request('/api/instances', { method: 'POST', body: data }),
  updateInstance: (id, data) => request(`/api/instances/${id}`, { method: 'PATCH', body: data }),
  deleteInstance: (id) => request(`/api/instances/${id}`, { method: 'DELETE' }),
  action: (id, action) => request(`/api/instances/${id}/action`, { method: 'POST', body: { action } }),
  reinstall: (id) => request(`/api/instances/${id}/reinstall`, { method: 'POST', body: {} }),
  deploy: (id, data) => request(`/api/instances/${id}/deploy`, { method: 'POST', body: data || {} }),
  metrics: (id, range = 60) => request(`/api/instances/${id}/metrics?range=${range}`),
  logs: (id, limit = 300) => request(`/api/instances/${id}/logs?limit=${limit}`),
  clearLogs: (id) => request(`/api/instances/${id}/logs`, { method: 'DELETE' }),
  console: (id, command) => request(`/api/instances/${id}/console`, { method: 'POST', body: { command } }),
  files: (id, p = '/') => request(`/api/instances/${id}/files?path=${encodeURIComponent(p)}`),
  writeFile: (id, data) => request(`/api/instances/${id}/files`, { method: 'POST', body: data }),
  readFile: (id, p) => request(`/api/instances/${id}/files/download?path=${encodeURIComponent(p)}`),
  backups: (id) => request(`/api/instances/${id}/backups`),
  backupsAll: () => request('/api/backups'),
  deleteBackup: (id) => request(`/api/backups/${id}`, { method: 'DELETE' }),
  createBackup: (id, name) => request(`/api/instances/${id}/backups`, { method: 'POST', body: { name } }),
  restoreBackup: (id, backupId) => request(`/api/instances/${id}/backups/${backupId}/restore`, { method: 'POST', body: {} }),
  nodes: () => request('/api/nodes'),
  createNode: (data) => request('/api/nodes', { method: 'POST', body: data }),
  updateNode: (id, data) => request(`/api/nodes/${id}`, { method: 'PATCH', body: data }),
  drainNode: (id) => request(`/api/nodes/${id}/drain`, { method: 'POST', body: {} }),
  nodeToken: (id) => request(`/api/nodes/${id}/token`, { method: 'POST', body: {} }),
  deleteNode: (id) => request(`/api/nodes/${id}`, { method: 'DELETE' }),
  nodeMetrics: (id, range = 60) => request(`/api/nodes/${id}/metrics?range=${range}`),
  deployments: () => request('/api/deployments'),
  domains: () => request('/api/domains'),
  createDomain: (data) => request('/api/domains', { method: 'POST', body: data }),
  verifyDomain: (id) => request(`/api/domains/${id}/verify`, { method: 'POST', body: {} }),
  deleteDomain: (id) => request(`/api/domains/${id}`, { method: 'DELETE' }),
  schedules: () => request('/api/schedules'),
  createSchedule: (data) => request('/api/schedules', { method: 'POST', body: data }),
  updateSchedule: (id, data) => request(`/api/schedules/${id}`, { method: 'PATCH', body: data }),
  deleteSchedule: (id) => request(`/api/schedules/${id}`, { method: 'DELETE' }),
  templates: () => request('/api/catalog/templates'),
  plans: () => request('/api/catalog/plans'),
  adminUsers: () => request('/api/admin/users'),
  updateUser: (id, data) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: data }),
  audit: () => request('/api/admin/audit'),
  teams: () => request('/api/admin/teams'),
  setTeamPlan: (id, planId) => request(`/api/admin/teams/${id}/plan`, { method: 'PATCH', body: { planId } }),
};

window.__LT_API__ = api;
export default api;
