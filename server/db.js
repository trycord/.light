import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import config from './config.js';
import { id, now } from './util.js';
import { hashPassword } from './security.js';

let db;
export function getDb() { return db; }

const TABLES = {
  users: `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
    username TEXT, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', team_id TEXT,
    status TEXT NOT NULL DEFAULT 'active', token_version INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 1,
    verification_token TEXT, verification_expires INTEGER,
    reset_token TEXT, reset_expires INTEGER,
    failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
    accept_terms INTEGER NOT NULL DEFAULT 0,
    theme TEXT NOT NULL DEFAULT 'dark', notifications_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login INTEGER)`,
  teams: `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
    plan_id TEXT NOT NULL DEFAULT 'free', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  team_members: `CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id))`,
  plans: `CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, memory_mb INTEGER NOT NULL, disk_gb INTEGER NOT NULL,
    cpu_cores INTEGER NOT NULL, instances INTEGER NOT NULL DEFAULT 3,
    price_monthly INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '')`,
  nodes: `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, host TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'local', version TEXT NOT NULL DEFAULT '1.0.0',
    status TEXT NOT NULL DEFAULT 'offline', availability TEXT NOT NULL DEFAULT 'active',
    cpu_cores INTEGER NOT NULL DEFAULT 4, memory_mb INTEGER NOT NULL DEFAULT 8192,
    disk_gb INTEGER NOT NULL DEFAULT 100, cpu_used REAL NOT NULL DEFAULT 0,
    mem_used REAL NOT NULL DEFAULT 0, disk_used REAL NOT NULL DEFAULT 0,
    net_in REAL NOT NULL DEFAULT 0, net_out REAL NOT NULL DEFAULT 0, temp REAL NOT NULL DEFAULT 0,
    last_heartbeat INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  templates: `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'game',
    image TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', versions TEXT NOT NULL DEFAULT '[]',
    command TEXT NOT NULL DEFAULT '', ports TEXT NOT NULL DEFAULT '[]', env TEXT NOT NULL DEFAULT '{}',
    official INTEGER NOT NULL DEFAULT 1)`,
  instances: `CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, node_id TEXT, name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'web', type TEXT NOT NULL DEFAULT 'custom',
    status TEXT NOT NULL DEFAULT 'pending', image TEXT NOT NULL, command TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT 'latest', env_json TEXT NOT NULL DEFAULT '{}',
    ports_json TEXT NOT NULL DEFAULT '[]', volumes_json TEXT NOT NULL DEFAULT '[]',
    cpu_cores INTEGER NOT NULL DEFAULT 1, memory_mb INTEGER NOT NULL DEFAULT 512,
    disk_gb INTEGER NOT NULL DEFAULT 4, container_id TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER)`,
  deployments: `CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', version TEXT NOT NULL DEFAULT 'latest',
    source TEXT NOT NULL DEFAULT 'image', repo_url TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT 'main', commit_sha TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, finished_at INTEGER)`,
  logs: `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    ts INTEGER NOT NULL, stream TEXT NOT NULL DEFAULT 'stdout', line TEXT NOT NULL)`,
  metric_samples: `CREATE TABLE IF NOT EXISTS metric_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL, instance_id TEXT,
    ts INTEGER NOT NULL, cpu REAL NOT NULL DEFAULT 0, mem REAL NOT NULL DEFAULT 0,
    disk REAL NOT NULL DEFAULT 0, net_in REAL NOT NULL DEFAULT 0,
    net_out REAL NOT NULL DEFAULT 0, temp REAL NOT NULL DEFAULT 0)`,
  node_commands: `CREATE TABLE IF NOT EXISTS node_commands (
    id TEXT PRIMARY KEY, node_id TEXT NOT NULL, instance_id TEXT, type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
    result TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  backups: `CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', size_bytes INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, finished_at INTEGER)`,
  schedules: `CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL, name TEXT NOT NULL,
    action TEXT NOT NULL, cron TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    last_run INTEGER, created_at INTEGER NOT NULL)`,
  domains: `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, instance_id TEXT NOT NULL, domain TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0, ssl_status TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL)`,
  sessions: `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '')`,
  audit_logs: `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, team_id TEXT, user_id TEXT, action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}', ip TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)`,
};

const LEGACY_COLUMNS = {
  users: { token_version: 'INTEGER NOT NULL DEFAULT 0', team_id: 'TEXT', status: "TEXT NOT NULL DEFAULT 'active'", updated_at: 'INTEGER', last_login: 'INTEGER',
    username: 'TEXT', email_verified: 'INTEGER NOT NULL DEFAULT 1', verification_token: 'TEXT', verification_expires: 'INTEGER',
    reset_token: 'TEXT', reset_expires: 'INTEGER', failed_logins: 'INTEGER NOT NULL DEFAULT 0', locked_until: 'INTEGER',
    accept_terms: 'INTEGER NOT NULL DEFAULT 0', theme: "TEXT NOT NULL DEFAULT 'dark'", notifications_enabled: 'INTEGER NOT NULL DEFAULT 1' },
  nodes: { availability: "TEXT NOT NULL DEFAULT 'active'", cpu_used: 'REAL NOT NULL DEFAULT 0', mem_used: 'REAL NOT NULL DEFAULT 0', disk_used: 'REAL NOT NULL DEFAULT 0', net_in: 'REAL NOT NULL DEFAULT 0', net_out: 'REAL NOT NULL DEFAULT 0', temp: 'REAL NOT NULL DEFAULT 0' },
  deployments: { instance_id: "TEXT NOT NULL DEFAULT ''", team_id: "TEXT NOT NULL DEFAULT ''", source: "TEXT NOT NULL DEFAULT 'image'", repo_url: "TEXT NOT NULL DEFAULT ''", ref: "TEXT NOT NULL DEFAULT 'main'", commit_sha: "TEXT NOT NULL DEFAULT ''", command: "TEXT NOT NULL DEFAULT ''", created_at: 'INTEGER NOT NULL DEFAULT 0' },
  metric_samples: { instance_id: 'TEXT', temp: 'REAL NOT NULL DEFAULT 0' },
  instances: { volumes_json: "TEXT NOT NULL DEFAULT '[]'", category: "TEXT NOT NULL DEFAULT 'web'", type: "TEXT NOT NULL DEFAULT 'custom'", container_id: 'TEXT' },
};

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
  'CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)',
  'CREATE INDEX IF NOT EXISTS idx_instances_team ON instances(team_id)',
  'CREATE INDEX IF NOT EXISTS idx_instances_node ON instances(node_id)',
  'CREATE INDEX IF NOT EXISTS idx_deployments_team ON deployments(team_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_logs_instance ON logs(instance_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_node ON metric_samples(node_id, ts)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_instance ON metric_samples(instance_id, ts)',
  'CREATE INDEX IF NOT EXISTS idx_commands_node ON node_commands(node_id, status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_backups_instance ON backups(instance_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)',
  'CREATE INDEX IF NOT EXISTS idx_domains_team ON domains(team_id, id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain)',
  'CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_logs(team_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, id)',
];

function migrate() {
  for (const [table, ddl] of Object.entries(TABLES)) db.exec(ddl);
  for (const [table, columns] of Object.entries(LEGACY_COLUMNS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const [column, definition] of Object.entries(columns)) {
      if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  for (const sql of INDEXES) { try { db.exec(sql); } catch { /* legacy index on old column */ } }
}

function seed() {
  const ts = now();
  const insertPlan = db.prepare('INSERT OR IGNORE INTO plans (id, name, memory_mb, disk_gb, cpu_cores, instances, price_monthly, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertPlan.run('free', 'Free', 512, 4, 1, 3, 0, '512 MB RAM · 4 GB storage · subdomain · custom domains');
  insertPlan.run('shared', 'Shared', 4096, 40, 2, 10, 1200, '4 GB RAM · 40 GB storage · priority scheduling');
  insertPlan.run('dedicated', 'Dedicated', 16384, 200, 8, 50, 4800, '16 GB RAM · 200 GB storage · dedicated allocation');

  const templates = [
    ['minecraft', 'Minecraft (Paper)', 'game', 'itzg/minecraft-server', ['1.21.4', '1.20.6', '1.19.4'], '["25565"]', '{"EULA":"TRUE"}'],
    ['factorio', 'Factorio', 'game', 'factorio/factorio', ['latest'], '["34197/udp"]', '{}'],
    ['rust', 'Rust', 'game', 'rustserver/rust', ['latest'], '["28015/udp"]', '{}'],
    ['satisfactory', 'Satisfactory', 'game', 'satisfactory-server', ['latest'], '["7777/udp"]', '{}'],
    ['node', 'Node.js', 'web', 'node:20-alpine', ['20', '18'], '["3000"]', '{}'],
    ['python', 'Python', 'web', 'python:3.12-alpine', ['3.12', '3.11'], '["8000"]', '{}'],
    ['nginx', 'Static site (Nginx)', 'web', 'nginx:alpine', ['latest'], '["80"]', '{}'],
    ['postgres', 'PostgreSQL', 'database', 'postgres:16-alpine', ['16', '15'], '["5432"]', '{"POSTGRES_PASSWORD":"change-me"}'],
    ['redis', 'Redis', 'database', 'redis:7-alpine', ['7'], '["6379"]', '{}'],
  ];
  const insertTemplate = db.prepare('INSERT OR IGNORE INTO templates (id, name, category, image, description, versions, command, ports, env, official) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)');
  for (const t of templates) insertTemplate.run(t[0], t[1], t[2], t[3], 'Official .light template', JSON.stringify(t[4]), '', t[5], t[6]);

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (email && password && !db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    const uid = id('usr'); const teamId = id('team');
    db.transaction(() => {
      db.prepare('INSERT INTO teams (id, name, owner_id, plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(teamId, 'Administration', uid, 'free', ts, ts);
      db.prepare('INSERT INTO users (id, email, name, password_hash, role, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(uid, email.toLowerCase(), process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator', hashPassword(password), 'admin', teamId, ts, ts);
      db.prepare('INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(teamId, uid, 'owner', ts);
    })();
  }

  if (config.nodeToken) {
    const nid = process.env.NODE_ID || 'node-01';
    const existing = db.prepare('SELECT id, token FROM nodes WHERE id = ?').get(nid);
    if (!existing) {
      db.prepare('INSERT INTO nodes (id, token, name, host, region, version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nid, config.nodeToken, nid, '127.0.0.1', 'local', '1.0.0', 'offline', ts, ts);
    } else if (existing.token !== config.nodeToken) {
      // Keep the integrated node's token in sync with the configured/generated one.
      db.prepare('UPDATE nodes SET token = ?, updated_at = ? WHERE id = ?').run(config.nodeToken, ts, nid);
    }
  }
}

export function initDb() {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  seed();
  return db;
}
export function closeDb() { if (db) { db.close(); db = undefined; } }
