import http from 'http';
import fs from 'fs';
import path from 'path';
import config from './config.js';
import { hostMetrics, createInstance, startInstance, stopInstance, restartInstance, suspendInstance, resumeInstance, removeInstance, reinstallInstance, execCommand, deployImage, containerStatus, containerStats, followLogs, ensureDirs, containerName } from './docker.js';
import { listFiles, readFile, writeFile, fileOperation, storageUsage, createBackup, restoreBackup } from './files.js';
import { installSteamGame, isSteamGame, resolveGame } from './games.js';
import { buildSource, cloneRepository, validateBuildSpec } from './build.js';

const CONTROL = config.controlUrl.replace(/\/$/, '');
const HEADERS = { 'Content-Type': 'application/json', 'x-node-token': config.nodeToken || '' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 16 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function send(res, code, object) {
  const body = JSON.stringify(object);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function post(path, body) {
  const response = await fetch(CONTROL + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json().catch(() => ({}));
}

async function heartbeat() {
  try {
    const metrics = await hostMetrics();
    await post('/api/agent/heartbeat', { version: '1.0.0', ...metrics });
    await post('/api/agent/health', { ok: true, docker: true });
  } catch (error) {
    console.error('[agent] heartbeat failed:', error.message);
    try { await post('/api/agent/health', { ok: false }); } catch { /* ignore */ }
  }
}

async function reportResult(commandId, result, status) {
  try { await post(`/api/agent/commands/${commandId}/result`, { ok: !result?.error, result, status }); }
  catch (error) { console.error('[agent] result report failed:', error.message); }
}

const streaming = new Set();

async function execute(command) {
  const payload = command.payload || {};
  switch (command.type) {
    case 'instance.reprovision': {
      // Remove the previous container (if any) then recreate with the same
      // persistent volume paths. This is idempotent and data-preserving.
      try { await removeInstance(command.instanceId); } catch { /* nothing to remove */ }
      return createInstance({ ...payload, instanceId: command.instanceId });
    }
    case 'instance.create': {
      const result = await createInstance({ ...payload, instanceId: command.instanceId });
      // If this is a Steam game, install it into the persistent volume first.
      if (payload.game && isSteamGame(payload.game, payload.image)) {
        try { await installSteamGame({ ...payload, instanceId: command.instanceId }); }
        catch (error) { return { ...result, warning: 'steam_install_failed', detail: error.message }; }
      }
      return result;
    }
    case 'instance.game.install': return installSteamGame({ ...payload, instanceId: command.instanceId });
    case 'instance.game.info': return resolveGame(payload.game);
    case 'instance.mods.install': {
      const dir = path.join(config.dataRoot, 'instances', String(command.instanceId).replace(/[^A-Za-z0-9_-]/g, ''), 'mods');
      fs.mkdirSync(dir, { recursive: true });
      const results = [];
      for (const mod of (payload.mods || [])) {
        try {
          const url = String(mod.url || '');
          if (!/^https:\/\//.test(url)) { results.push({ name: mod.name, ok: false, reason: 'invalid_url' }); continue; }
          const res = await fetch(url);
          if (!res.ok) { results.push({ name: mod.name, ok: false, reason: 'download_' + res.status }); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 200 * 1024 * 1024) { results.push({ name: mod.name, ok: false, reason: 'too_large' }); continue; }
          fs.writeFileSync(path.join(dir, String(mod.name).replace(/[^A-Za-z0-9._-]/g, '')), buf);
          results.push({ name: mod.name, ok: true, bytes: buf.length });
        } catch (e) { results.push({ name: mod.name, ok: false, reason: e.message }); }
      }
      return { ok: results.every((r) => r.ok), results, modpackId: payload.modpackId };
    }


    case 'instance.start': return startInstance(command.instanceId);
    case 'instance.stop': return stopInstance(command.instanceId);
    case 'instance.restart': return restartInstance(command.instanceId);
    case 'instance.suspend': return suspendInstance(command.instanceId);
    case 'instance.resume': return resumeInstance(command.instanceId);
    case 'instance.remove': return removeInstance(command.instanceId);
    case 'instance.reinstall': return reinstallInstance(command.instanceId, payload);
    case 'instance.exec': return execCommand(command.instanceId, payload.command);
    case 'instance.deploy': {
      if (payload.source === 'git' && payload.repoUrl) {
        const clone = await cloneRepository({ instanceId: command.instanceId, repoUrl: payload.repoUrl, ref: payload.ref, token: payload.token || '' });
        if (!clone.ok) throw new Error('git_clone_failed');
        const spec = validateBuildSpec({ runtime: payload.runtime || 'node', version: payload.version || '22', installCommand: payload.installCommand, buildCommand: payload.buildCommand });
        const built = await buildSource({ instanceId: command.instanceId, source: 'git', ...spec });
        if (!built.ok) throw new Error('build_failed: ' + built.logs.slice(-500));
        return { ok: true, source: 'git', commitSha: payload.commitSha || '', image: built.image, logs: built.logs.slice(-1000) };
      }
      return deployImage(command.instanceId, payload);
    }
    case 'instance.status': return containerStatus(command.instanceId);
    case 'instance.stats': return (await containerStats(command.instanceId)) || {};
    case 'instance.files.list': return listFiles(command.instanceId, payload.path || '/');
    case 'instance.files.read': return readFile(command.instanceId, payload.path);
    case 'instance.files.write': return payload.op && payload.op !== 'write'
      ? fileOperation(command.instanceId, payload.op, payload.path, payload)
      : writeFile(command.instanceId, payload.path, payload.content);
    case 'instance.files.remove': return fileOperation(command.instanceId, 'delete', payload.path, payload);
    case 'instance.storage': return storageUsage(command.instanceId);
    case 'instance.backup': return createBackup(command.instanceId, payload.backupId);
    case 'instance.restore': return restoreBackup(command.instanceId, payload.location);
    case 'ping': return { ok: true, nodeId: config.nodeId };
    default: throw new Error(`unknown_command: ${command.type}`);
  }
}

async function pollCommands() {
  try {
    const response = await fetch(`${CONTROL}/api/agent/commands`, { headers: HEADERS });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    for (const command of data.commands || []) {
      try {
        const ack = await fetch(`${CONTROL}/api/agent/commands/${command.id}/ack`, { method: 'POST', headers: HEADERS });
        const ackBody = await ack.json().catch(() => ({}));
        if (!ackBody.ok) continue; // claimed by another poll
        const result = await execute(command);
        await reportResult(command.id, result, result?.status);
      } catch (error) {
        await reportResult(command.id, { error: error.message }, 'error');
      }
    }
  } catch (error) {
    // Control plane temporarily unavailable.
  }
}

const logBuffers = new Map();
function enqueueLog(instanceId, entry) {
  if (!logBuffers.has(instanceId)) {
    logBuffers.set(instanceId, []);
    setTimeout(() => flushLogs(instanceId), 1500).unref();
  }
  const buffer = logBuffers.get(instanceId);
  buffer.push(entry);
  if (buffer.length >= 100) flushLogs(instanceId);
}
async function flushLogs(instanceId) {
  const buffer = logBuffers.get(instanceId);
  if (!buffer || !buffer.length) return;
  logBuffers.set(instanceId, []);
  try { await post('/api/agent/logs', { instanceId, lines: buffer }); }
  catch { /* logs will be retried on next flush */ }
}

async function startLogStreams() {
  try {
    const response = await fetch(`${CONTROL}/api/agent/instances`, { headers: HEADERS });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    for (const instance of data.instances || []) {
      if (streaming.has(instance.id) || instance.status !== 'running') continue;
      const stream = await followLogs(instance.id, (line) => enqueueLog(instance.id, line));
      if (stream) {
        streaming.add(instance.id);
        stream.on('end', () => streaming.delete(instance.id));
        stream.on('error', () => streaming.delete(instance.id));
      }
    }
  } catch { /* best effort */ }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'trycord-light-node-agent', nodeId: config.nodeId, uptime: process.uptime(), timestamp: Date.now() });
  return send(res, 404, { error: 'not_found' });
});

let timers = [];
function start() {
  ensureDirs();
  server.listen(config.port, config.host, () => console.log(`[.light node] agent listening on http://${config.host}:${config.port} (node ${config.nodeId})`));
  timers.push(setInterval(heartbeat, 5000));
  timers.push(setInterval(pollCommands, 1000));
  timers.push(setInterval(startLogStreams, 10000));
  heartbeat();
  pollCommands();
  const shutdown = () => {
    timers.forEach(clearInterval);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
start();
