// .light — platform analytics aggregation. All figures come from persisted data;
// nothing is estimated or fabricated when data is missing.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAdmin } from '../auth.js';
import { requirePermission } from '../permissions.js';
import { asyncRoute } from '../util.js';

const DAY = 86400000;

function dailySeries(table, column, days = 30, where = '', args = []) {
  const db = getDb();
  const end = Date.now();
  const start = end - days * DAY;
  const rows = db.prepare(`SELECT ${column} AS ts FROM ${table} WHERE ${column} >= ? ${where}`).all(start, ...args);
  const buckets = [];
  for (let d = 0; d < days; d++) buckets.push({ day: new Date(start + d * DAY).toISOString().slice(0, 10), count: 0 });
  for (const r of rows) {
    const key = new Date(r.ts).toISOString().slice(0, 10);
    const bucket = buckets.find((b) => b.day === key);
    if (bucket) bucket.count++;
  }
  return buckets;
}

function revenueSeries(days = 30) {
  const db = getDb();
  const start = Date.now() - days * DAY;
  const rows = db.prepare("SELECT created_at, amount FROM transactions WHERE status = 'paid' AND created_at >= ?").all(start);
  const buckets = [];
  for (let d = 0; d < days; d++) buckets.push({ day: new Date(start + d * DAY).toISOString().slice(0, 10), amount: 0 });
  for (const r of rows) {
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    const bucket = buckets.find((b) => b.day === key);
    if (bucket) bucket.amount += r.amount;
  }
  return buckets;
}

export function analyticsRoutes() {
  const router = Router();
  router.use(requireAdmin);
  router.use(requirePermission('analytics.read'));

  router.get('/', asyncRoute(async (req, res) => {
    const db = getDb();
    const one = (sql, ...args) => db.prepare(sql).get(...args);
    const all = (sql, ...args) => db.prepare(sql).all(...args);

    const revenue = one("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM transactions WHERE status = 'paid'");
    const summary = {
      users: one('SELECT COUNT(*) AS c FROM users').c,
      teams: one('SELECT COUNT(*) AS c FROM teams').c,
      instances: one('SELECT COUNT(*) AS c FROM instances').c,
      runningInstances: one("SELECT COUNT(*) AS c FROM instances WHERE status = 'running'").c,
      nodesOnline: one("SELECT COUNT(*) AS c FROM nodes WHERE status = 'online'").c,
      nodes: one('SELECT COUNT(*) AS c FROM nodes').c,
      deployments: one('SELECT COUNT(*) AS c FROM deployments').c,
      backups: one('SELECT COUNT(*) AS c FROM backups').c,
      activeSubscriptions: one("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'").c,
      openTickets: one("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('open','pending')").c,
      paidTransactions: revenue.count,
      revenueCents: revenue.total,
    };
    res.json({
      summary,
      signups: dailySeries('users', 'created_at', 30),
      revenue: revenueSeries(30),
      instancesByCategory: all('SELECT category, COUNT(*) AS count FROM instances GROUP BY category ORDER BY count DESC'),
      instancesByStatus: all('SELECT status, COUNT(*) AS count FROM instances GROUP BY status ORDER BY count DESC'),
      subscriptionsByPlan: all('SELECT plan_id, COUNT(*) AS count FROM subscriptions GROUP BY plan_id ORDER BY count DESC'),
      ticketsByStatus: all('SELECT status, COUNT(*) AS count FROM support_tickets GROUP BY status'),
      ticketsByPriority: all('SELECT priority, COUNT(*) AS count FROM support_tickets GROUP BY priority'),
      nodes: all('SELECT id, name, region, status, cpu_used, mem_used, (SELECT COUNT(*) FROM instances i WHERE i.node_id = n.id) AS workloads FROM nodes n ORDER BY workloads DESC LIMIT 20'),
      recentActivity: all('SELECT action, target_type, target_id, ts FROM audit_logs ORDER BY id DESC LIMIT 20'),
    });
  }));

  return router;
}
