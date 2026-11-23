// SHADE — official .light infrastructure agent configuration.
// Auto-detects .env files in common locations so no token/env var is required
// to boot; explicit environment variables always win.
import dotenv from 'dotenv';
import fs from 'fs';
for (const file of [
  process.env.SHADE_ENV_FILE,
  `${process.env.SHADE_DATA_DIR || process.env.AGENT_DATA_DIR || '/var/lib/light-shade'}/.env`,
  '/etc/light/agent.env',
  `${process.cwd()}/.env`,
  '/app/.env',
]) {
  if (file && fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
}

const port = parseInt(process.env.SHADE_PORT || process.env.AGENT_PORT || process.env.PORT || '5859', 10);
const host = process.env.SHADE_HOST || process.env.HOST || '0.0.0.0';

const config = {
  env: process.env.NODE_ENV || 'development',
  port,
  host,
  logLevel: process.env.SHADE_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  controlUrl: process.env.SHADE_CONTROL_PLANE_URL || process.env.CONTROL_URL || 'http://localhost:5858',
  nodeId: process.env.SHADE_NODE_ID || process.env.NODE_ID || 'node-01',
  nodeName: process.env.SHADE_NODE_NAME || process.env.NODE_ID || process.env.NODE_NAME || 'node-01',
  nodeToken: process.env.SHADE_NODE_TOKEN || process.env.NODE_TOKEN || '',
  dockerHost: process.env.SHADE_DOCKER_HOST || process.env.DOCKER_HOST || '/var/run/docker.sock',
  dataRoot: process.env.SHADE_DATA_DIR || process.env.AGENT_DATA_DIR || '/var/lib/trycord-light',
  heartbeatMs: parseInterval(process.env.SHADE_HEARTBEAT_INTERVAL || '30s', 30000),
  metricsMs: parseInterval(process.env.SHADE_METRICS_INTERVAL || '15s', 15000),
  version: '1.0.0',
};

function parseInterval(value, fallback) {
  const match = String(value).match(/^(\d+)(ms|s|m)$/);
  if (!match) return fallback;
  const n = Number(match[1]);
  if (match[2] === 'ms') return n;
  if (match[2] === 's') return n * 1000;
  return n * 60000;
}

export default config;
