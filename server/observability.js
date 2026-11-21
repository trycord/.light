// .light — real operational observability from persisted data.
// No fabricated metrics: every figure is read from SQLite / process state.
import { getDb } from './db.js';
import { now } from './util.js';

const started = Date.now();
const requests = { total: 0, errors: 0, byStatus: {}, byRoute: {}, latencySum: 0, latencyMax: 0, samples: [] };

export function recordRequest({ method, route, status, duration }) {
  requests.total++;
  if (status >= 400) requests.errors++;
  const key = `${String(status).charAt(0)}xx`;
  requests.byStatus[key] = (requests.byStatus[key] || 0) + 1;
  const rk = `${method} ${route || 'unknown'}`;
  requests.byRoute[rk] = (requests.byRoute[rk] || 0) + 1;
  requests.latencySum += duration;
  if (duration > requests.latencyMax) requests.latencyMax = duration;
  requests.samples.push({ ts: now(), status, duration, route: rk });
  if (requests.samples.length > 500) requests.samples.shift();
}

const count = (sql, ...args) => { try { return getDb().prepare(sql).get(...args)?.c || 0; } catch { return 0; } };

export function snapshot() {
  const db = getDb();
  const uptime = Math.round((Date.now() - started) / 1000);
  const avgLatency = requests.total ? Math.round(requests.latencySum / requests.total) : 0;
  let memory = {};
  try { memory = { rssMb: Math.round(process.memoryUsage().rss / 1048576), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) }; } catch {}
  return {
    service: 'trycord-light', uptime,
    process: { pid: process.pid, node: process.version, ...memory },
    requests: {
      total: requests.total, errors: requests.errors,
      errorRate: requests.total ? Number((requests.errors / requests.total * 100).toFixed(2)) : 0,
      avgLatencyMs: avgLatency, maxLatencyMs: Math.round(requests.latencyMax),
      byStatus: requests.byStatus,
      topRoutes: Object.entries(requests.byRoute).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([route, count]) => ({ route, count })),
    },
    data: {
      users: count('SELECT COUNT(*) c FROM users'),
      teams: count('SELECT COUNT(*) c FROM teams'),
      services: count('SELECT COUNT(*) c FROM instances'),
      runningServices: count("SELECT COUNT(*) c FROM instances WHERE status = 'running'"),
      failedServices: count("SELECT COUNT(*) c FROM instances WHERE status = 'error'"),
      orders: count('SELECT COUNT(*) c FROM orders'),
      paidOrders: count("SELECT COUNT(*) c FROM orders WHERE status IN ('paid','active')"),
      pendingCommands: count("SELECT COUNT(*) c FROM node_commands WHERE status = 'pending'"),
      failedCommands: count("SELECT COUNT(*) c FROM node_commands WHERE status = 'failed'"),
      tickets: count("SELECT COUNT(*) c FROM support_tickets WHERE status IN ('open','pending')"),
      packages: count('SELECT COUNT(*) c FROM software_packages'),
      nodesOnline: count("SELECT COUNT(*) c FROM nodes WHERE status = 'online'"),
    },
    tunnels: (() => { try { return db.prepare("SELECT id, domain, instance_id, tunnel_id, tunnel_status, updated_at FROM domains WHERE tunnel_id IS NOT NULL").all(); } catch { return []; } })(),
  };
}

/** Lightweight instrumentation middleware. */
export function instrument(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      recordRequest({ method: req.method, route: req.route?.path || req.baseUrl || req.path?.split('/').slice(0, 3).join('/'),
        status: res.statusCode, duration });
    } catch { /* never break a response for telemetry */ }
  });
  next();
}
