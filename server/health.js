// .light — combined health aggregation for the unified container.
// Reports control plane and the integrated node agent (when present).

import config from './config.js';
import { getDb } from './db.js';

let agentStatus = { running: false, lastHeartbeat: null };

export function setAgentHealth(healthy) {
  agentStatus = { running: true, healthy, lastHeartbeat: Date.now() };
}

export function combinedHealth() {
  const dbOk = Boolean(getDb());
  const integratedAgent = config.ltMode === 'all';
  const agentOk = integratedAgent ? agentStatus.healthy === true : true;
  const ok = dbOk && agentOk;
  return {
    status: ok ? 'ok' : 'degraded',
    service: 'trycord-light',
    version: '1.0.0',
    mode: config.ltMode,
    uptime: Math.round(process.uptime()),
    db: dbOk,
    controlPlane: { status: dbOk ? 'ok' : 'degraded', port: config.port },
    nodeAgent: integratedAgent
      ? { status: agentOk ? 'ok' : 'degraded', healthy: agentStatus.healthy === true, lastHeartbeat: agentStatus.lastHeartbeat }
      : { status: 'external', note: 'running in separate container/mode' },
    timestamp: Date.now(),
  };
}
