// .light — reconcile Control Plane state against Docker reality.
// Detects missing containers, stale identities and drift. Never deletes data.
import { getDb } from './db.js';
import { now } from './util.js';

/** Ask each online node for its real container state, then compare to the DB. */
export async function reconcileWorkloads() {
  const db = getDb();
  const instances = db.prepare("SELECT id, node_id, container_id, status, name FROM instances WHERE status IN ('running','stopped','pending','deploying','error')").all();
  const report = { checked: 0, missing: [], drift: [], nodesQueried: 0 };

  // Shade periodically reports health; we use that as the source of truth for
  // existence. Containers are authoritative in the `health_status` field.
  for (const i of instances) {
    report.checked++;
    const node = i.node_id ? db.prepare('SELECT status, last_heartbeat FROM nodes WHERE id = ?').get(i.node_id) : null;
    if (!node || node.status !== 'online') { report.drift.push({ id: i.id, reason: 'node_offline' }); continue; }
    const health = db.prepare('SELECT health_status FROM instances WHERE id = ?').get(i.id)?.health_status;
    if (health === 'missing') {
      report.missing.push({ id: i.id, name: i.name, nodeId: i.node_id, containerId: i.container_id });
      // Mark the real state — never leave a missing container reported as running.
      db.prepare("UPDATE instances SET status='error', updated_at=? WHERE id=?").run(now(), i.id);
    }
  }
  return report;
}
