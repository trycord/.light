import { getDb } from './db.js';
import { now } from './util.js';

export function audit(req, action, targetType = '', targetId = '', details = {}) {
  try {
    getDb().prepare('INSERT INTO audit_logs (team_id, user_id, action, target_type, target_id, details, ip, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.teamId || null, req.user?.id || null, action, targetType, targetId, JSON.stringify(details || {}), req.ip || '', now());
  } catch { /* auditing must never break the operation */ }
}
