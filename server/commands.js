import { getDb } from './db.js';
import { id, now } from './util.js';

const TIMEOUT_MS = 45000;

export function queueCommand(nodeId, type, payload = {}, instanceId = null) {
  const db = getDb();
  const cid = id('cmd');
  const ts = now();
  db.prepare('INSERT INTO node_commands (id, node_id, instance_id, type, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cid, nodeId, instanceId || null, type, JSON.stringify(payload), 'pending', ts, ts);
  return cid;
}

export async function dispatch(nodeId, type, payload = {}, instanceId = null) {
  if (!nodeId) throw Object.assign(new Error('no_node_assigned'), { status: 409 });
  const cid = queueCommand(nodeId, type, payload, instanceId);
  const db = getDb();
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const row = db.prepare('SELECT status, result FROM node_commands WHERE id = ?').get(cid);
    if (row.status === 'done' || row.status === 'failed') {
      let result = {};
      try { result = JSON.parse(row.result || '{}'); } catch { result = { error: row.result }; }
      if (row.status === 'failed') {
        // Translate infrastructure error codes into honest, customer-safe errors.
        const code = result?.code || result?.error || 'command_failed';
        const map = {
          docker_container_missing: ['container_missing', 503, 'The workload container is missing. Contact support.'],
          docker_unavailable: ['node_unavailable', 503, 'The infrastructure node is temporarily unavailable.'],
          container_not_found: ['container_missing', 503, 'The workload container is missing. Contact support.'],
          node_offline: ['node_unavailable', 503, 'The infrastructure node is temporarily unavailable.'],
          instance_not_running: ['instance_not_running', 409, 'The service is not running.'],
        };
        const [errorCode, status, message] = map[code] || ['operation_failed', 502, 'The operation could not be completed.'];
        const err = new Error(message);
        err.code = errorCode; err.status = status; err.result = result;
        console.error('[command] failed', cid, code, JSON.stringify(result || {}).slice(0, 500));
        throw err;
      }
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Object.assign(new Error('node_command_timeout'), { status: 504 });
}

export function pendingCommands(nodeId) {
  return getDb().prepare("SELECT * FROM node_commands WHERE node_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 25").all(nodeId);
}

// Atomically claim a command so concurrent polls cannot execute it twice.
export function claimCommand(commandId, nodeId) {
  const result = getDb().prepare("UPDATE node_commands SET status = 'in_progress', updated_at = ? WHERE id = ? AND node_id = ? AND status = 'pending'")
    .run(Date.now(), commandId, nodeId);
  return result.changes > 0;
}

// Agents renew a lease while executing long commands (builds, game installs).
// Only the owning node may renew its own in-progress command.
export function renewCommand(commandId, nodeId) {
  return getDb().prepare("UPDATE node_commands SET updated_at = ? WHERE id = ? AND node_id = ? AND status = 'in_progress'")
    .run(Date.now(), commandId, nodeId).changes > 0;
}

// Safety net for agents that die without renewing. The threshold is well above
// the longest legitimate command so a slow build is never executed twice.
export function recoverStaleCommands(nodeId) {
  getDb().prepare("UPDATE node_commands SET status = 'pending' WHERE node_id = ? AND status = 'in_progress' AND updated_at < ?")
    .run(nodeId, Date.now() - 15 * 60000);
}

export function completeCommand(commandId, status, result) {
  getDb().prepare('UPDATE node_commands SET status = ?, result = ?, updated_at = ? WHERE id = ?')
    .run(status, typeof result === 'string' ? result : JSON.stringify(result || {}), now(), commandId);
}
