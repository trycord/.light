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
      if (row.status === 'failed') throw Object.assign(new Error(result.error || 'command_failed'), { status: 502, result });
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

// Reset commands orphaned by an agent restart back to pending.
export function recoverStaleCommands(nodeId) {
  getDb().prepare("UPDATE node_commands SET status = 'pending' WHERE node_id = ? AND status = 'in_progress' AND updated_at < ?")
    .run(nodeId, Date.now() - 60000);
}

export function completeCommand(commandId, status, result) {
  getDb().prepare('UPDATE node_commands SET status = ?, result = ?, updated_at = ? WHERE id = ?')
    .run(status, typeof result === 'string' ? result : JSON.stringify(result || {}), now(), commandId);
}
