// .light / Shade — universal execution backend abstraction.
// All infrastructure operations go through this module. The Control Plane and
// workload code never touch Docker APIs directly. Backends implement one
// workload interface; Docker is the first implementation.
import Docker from 'dockerode';
import fs from 'fs';

const docker = new Docker();
let state = { connected: false, lastError: '', lastCheck: 0, checkedAt: 0 };

export function backendInfo() {
  return {
    type: 'docker',
    connected: state.connected,
    healthy: state.connected,
    lastError: state.lastError || undefined,
    socket: process.env.SHADE_DOCKER_HOST || '/var/run/docker.sock',
    ...state,
  };
}

/** Verify connectivity and permission to the configured backend. Precise errors. */
export async function checkBackend() {
  state.checkedAt = Date.now();
  const socket = process.env.SHADE_DOCKER_HOST || '/var/run/docker.sock';
  if (socket.startsWith('unix://') && !fs.existsSync(socket.replace('unix://', ''))) {
    state.connected = false;
    state.lastError = `backend_unavailable: socket not found at ${socket.replace('unix://', '')}`;
    return { ok: false, error: state.lastError };
  }
  try {
    await docker.ping();
    await docker.info();
    state.connected = true; state.lastError = ''; state.lastCheck = Date.now();
    return { ok: true };
  } catch (error) {
    const code = error.code === 'ENOENT' || /ENOENT/.test(error.message) ? 'backend_unavailable'
      : error.statusCode === 403 ? 'backend_permission_denied' : 'backend_error';
    state.connected = false;
    state.lastError = `${code}: ${error.message}`;
    return { ok: false, error: state.lastError, code };
  }
}

/** Single entry point for all Docker access; retries on transient failure. */
export function getDocker() {
  return docker;
}

export async function withBackend(fn, { retries = 2 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!state.connected && attempt === 0) await checkBackend();
      const result = await fn(docker);
      state.connected = true; state.lastError = '';
      return result;
    } catch (error) {
      last = error;
      const transient = /ECONNRESET|ECONNREFUSED|ENOENT|socket hang up|connect ENOENT/.test(error.message) || error.statusCode >= 500;
      state.connected = false; state.lastError = error.message;
      if (!transient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      await checkBackend();
    }
  }
  const code = /ENOENT/.test(last?.message || '') ? 'backend_unavailable' : 'backend_error';
  throw Object.assign(new Error(`${code}: ${last?.message || 'backend failure'}`), { status: 503, code, backend: true });
}

/** Start periodic backend health checks. Exposed to /health and heartbeats. */
export function startBackendMonitor(intervalMs = 15000) {
  checkBackend();
  return setInterval(() => { checkBackend().catch(() => {}); }, intervalMs);
}
