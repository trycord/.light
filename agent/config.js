const port = parseInt(process.env.AGENT_PORT || process.env.PORT || '5859', 10);
const host = process.env.HOST || '0.0.0.0';

const config = {
  env: process.env.NODE_ENV || 'development',
  port,
  host,
  logLevel: process.env.LOG_LEVEL || 'info',
  controlUrl: process.env.CONTROL_URL || 'http://localhost:5858',
  nodeId: process.env.NODE_ID || 'node-01',
  nodeToken: process.env.NODE_TOKEN || '',
  dockerHost: process.env.DOCKER_HOST || '/var/run/docker.sock',
  dataRoot: process.env.AGENT_DATA_DIR || '/var/lib/trycord-light',
};

export default config;
