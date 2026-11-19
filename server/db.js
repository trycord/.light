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
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'shared', product_id TEXT,
    cpu_cores INTEGER NOT NULL DEFAULT 1, memory_mb INTEGER NOT NULL DEFAULT 512,
    disk_gb INTEGER NOT NULL DEFAULT 4, network_gb INTEGER NOT NULL DEFAULT 0,
    instances INTEGER NOT NULL DEFAULT 3,
    price_monthly INTEGER NOT NULL DEFAULT 0, price_yearly INTEGER NOT NULL DEFAULT 0,
    interval TEXT NOT NULL DEFAULT 'monthly', currency TEXT NOT NULL DEFAULT 'USD',
    features TEXT NOT NULL DEFAULT '[]', restrictions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'published', featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  product_categories: `CREATE TABLE IF NOT EXISTS product_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '◈',
    image TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published')`,
  products: `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    short_description TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '◈',
    features TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'published', featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    starting_price_monthly INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  product_locations: `CREATE TABLE IF NOT EXISTS product_locations (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
    node_id TEXT, available INTEGER NOT NULL DEFAULT 1, latency_ms INTEGER)`,
  pricing_config: `CREATE TABLE IF NOT EXISTS pricing_config (
    id TEXT PRIMARY KEY, currency TEXT NOT NULL DEFAULT 'USD', tax_percent REAL NOT NULL DEFAULT 0,
    price_cpu INTEGER NOT NULL DEFAULT 200, price_memory_mb INTEGER NOT NULL DEFAULT 2,
    price_disk_gb INTEGER NOT NULL DEFAULT 20, price_network_gb INTEGER NOT NULL DEFAULT 5,
    price_instance INTEGER NOT NULL DEFAULT 0,
    min_cpu INTEGER NOT NULL DEFAULT 1, max_cpu INTEGER NOT NULL DEFAULT 32,
    min_memory_mb INTEGER NOT NULL DEFAULT 256, max_memory_mb INTEGER NOT NULL DEFAULT 65536,
    min_disk_gb INTEGER NOT NULL DEFAULT 4, max_disk_gb INTEGER NOT NULL DEFAULT 2000,
    step_cpu INTEGER NOT NULL DEFAULT 1, step_memory_mb INTEGER NOT NULL DEFAULT 256,
    step_disk_gb INTEGER NOT NULL DEFAULT 4,
    yearly_discount_percent REAL NOT NULL DEFAULT 15,
    payment_provider TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`,
  subscriptions: `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, plan_id TEXT,
    status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'preset',
    custom_config TEXT NOT NULL DEFAULT '{}',
    price_monthly INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    started_at INTEGER NOT NULL, renews_at INTEGER, cancelled_at INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  transactions: `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, subscription_id TEXT,
    type TEXT NOT NULL DEFAULT 'charge', description TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending', provider TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
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
  environments: `CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '◈', versions TEXT NOT NULL DEFAULT '[]', default_version TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL, image_digest TEXT NOT NULL DEFAULT '', architectures TEXT NOT NULL DEFAULT '["amd64"]',
    default_command TEXT NOT NULL DEFAULT '', default_entrypoint TEXT NOT NULL DEFAULT '',
    working_dir TEXT NOT NULL DEFAULT '/app', build_capable INTEGER NOT NULL DEFAULT 0,
    package_managers TEXT NOT NULL DEFAULT '[]', default_env TEXT NOT NULL DEFAULT '{}',
    exposed_ports TEXT NOT NULL DEFAULT '[]', healthcheck TEXT NOT NULL DEFAULT '{}',
    storage TEXT NOT NULL DEFAULT '{}', resource_recommendations TEXT NOT NULL DEFAULT '{}',
    lifecycle TEXT NOT NULL DEFAULT '[]', security TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'published', featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  builds: `CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload', repo_url TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
    commit_sha TEXT NOT NULL DEFAULT '', install_command TEXT NOT NULL DEFAULT '', build_command TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued', logs TEXT NOT NULL DEFAULT '', artifact_path TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '', started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL)`,
  github_connections: `CREATE TABLE IF NOT EXISTS github_connections (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'github',
    account_login TEXT NOT NULL DEFAULT '', access_token_encrypted TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  webhook_events: `CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'github', event_id TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'processed', created_at INTEGER NOT NULL)`,
  trycord_releases: `CREATE TABLE IF NOT EXISTS trycord_releases (
    id TEXT PRIMARY KEY, version TEXT NOT NULL, image TEXT NOT NULL, release_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL)`,
  payment_methods: `CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'unconfigured', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  checkout_sessions: `CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, subscription_id TEXT, plan_id TEXT,
    provider TEXT NOT NULL, provider_session_id TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending', metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, expires_at INTEGER)`,
  webhook_events2: `CREATE TABLE IF NOT EXISTS payment_webhooks (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'processed', error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  invoices: `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, team_id TEXT NOT NULL, subscription_id TEXT,
    number TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'draft',
    provider TEXT NOT NULL DEFAULT '', provider_ref TEXT NOT NULL DEFAULT '',
    issued_at INTEGER NOT NULL, due_at INTEGER, paid_at INTEGER, created_at INTEGER NOT NULL)`,
  oauth_states: `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY, team_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'github',
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  auto_deploys: `CREATE TABLE IF NOT EXISTS auto_deploys (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    repo_full_name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main',
    install_command TEXT NOT NULL DEFAULT '', build_command TEXT NOT NULL DEFAULT '',
    secret TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    last_commit TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  two_factor: `CREATE TABLE IF NOT EXISTS two_factor (
    user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    backup_codes TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, enabled_at INTEGER)`,
  modpacks: `CREATE TABLE IF NOT EXISTS modpacks (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, team_id TEXT NOT NULL,
    name TEXT NOT NULL, loader TEXT NOT NULL DEFAULT 'fabric', version TEXT NOT NULL DEFAULT '',
    mods TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
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
  plans: { description: "TEXT NOT NULL DEFAULT ''", category: "TEXT NOT NULL DEFAULT 'shared'", product_id: 'TEXT',
    price_yearly: 'INTEGER NOT NULL DEFAULT 0', interval: "TEXT NOT NULL DEFAULT 'monthly'", currency: "TEXT NOT NULL DEFAULT 'USD'",
    features: "TEXT NOT NULL DEFAULT '[]'", restrictions: "TEXT NOT NULL DEFAULT '[]'", status: "TEXT NOT NULL DEFAULT 'published'",
    featured: 'INTEGER NOT NULL DEFAULT 0', sort_order: 'INTEGER NOT NULL DEFAULT 0', available: 'INTEGER NOT NULL DEFAULT 1',
    network_gb: 'INTEGER NOT NULL DEFAULT 0', created_at: 'INTEGER NOT NULL DEFAULT 0', updated_at: 'INTEGER NOT NULL DEFAULT 0' },
  users: { token_version: 'INTEGER NOT NULL DEFAULT 0', team_id: 'TEXT', status: "TEXT NOT NULL DEFAULT 'active'", updated_at: 'INTEGER', last_login: 'INTEGER',
    username: 'TEXT', email_verified: 'INTEGER NOT NULL DEFAULT 1', verification_token: 'TEXT', verification_expires: 'INTEGER',
    reset_token: 'TEXT', reset_expires: 'INTEGER', failed_logins: 'INTEGER NOT NULL DEFAULT 0', locked_until: 'INTEGER',
    accept_terms: 'INTEGER NOT NULL DEFAULT 0', theme: "TEXT NOT NULL DEFAULT 'dark'", notifications_enabled: 'INTEGER NOT NULL DEFAULT 1' },
  nodes: { availability: "TEXT NOT NULL DEFAULT 'active'", cpu_used: 'REAL NOT NULL DEFAULT 0', mem_used: 'REAL NOT NULL DEFAULT 0', disk_used: 'REAL NOT NULL DEFAULT 0', net_in: 'REAL NOT NULL DEFAULT 0', net_out: 'REAL NOT NULL DEFAULT 0', temp: 'REAL NOT NULL DEFAULT 0' },
  deployments: { instance_id: "TEXT NOT NULL DEFAULT ''", team_id: "TEXT NOT NULL DEFAULT ''", source: "TEXT NOT NULL DEFAULT 'image'", repo_url: "TEXT NOT NULL DEFAULT ''", ref: "TEXT NOT NULL DEFAULT 'main'", commit_sha: "TEXT NOT NULL DEFAULT ''", command: "TEXT NOT NULL DEFAULT ''", created_at: 'INTEGER NOT NULL DEFAULT 0' },
  metric_samples: { instance_id: 'TEXT', temp: 'REAL NOT NULL DEFAULT 0' },
  instances: { volumes_json: "TEXT NOT NULL DEFAULT '[]'", category: "TEXT NOT NULL DEFAULT 'web'", type: "TEXT NOT NULL DEFAULT 'custom'", container_id: 'TEXT', environment_id: 'TEXT', environment_version: 'TEXT', source: "TEXT NOT NULL DEFAULT 'image'", repo_url: "TEXT NOT NULL DEFAULT ''", build_command: "TEXT NOT NULL DEFAULT ''", install_command: "TEXT NOT NULL DEFAULT ''" },
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
  'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_environments_category ON environments(category, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_builds_instance ON builds(instance_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_webhook_events ON webhook_events(event_id)',
  'CREATE INDEX IF NOT EXISTS idx_checkout_team ON checkout_sessions(team_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_invoices_team ON invoices(team_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_autodeploy_repo ON auto_deploys(repo_full_name, branch)',
  'CREATE INDEX IF NOT EXISTS idx_products_status ON products(status, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_team ON subscriptions(team_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_team ON transactions(team_id, id)',
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
  // Pricing configuration (server-side source of truth for custom plans).
  if (!db.prepare('SELECT id FROM pricing_config LIMIT 1').get()) {
    db.prepare(`INSERT INTO pricing_config (id, currency, tax_percent, price_cpu, price_memory_mb, price_disk_gb, price_network_gb, price_instance,
      min_cpu, max_cpu, min_memory_mb, max_memory_mb, min_disk_gb, max_disk_gb, step_cpu, step_memory_mb, step_disk_gb, yearly_discount_percent, payment_provider, updated_at)
      VALUES ('default', 'USD', 0, 200, 2, 20, 5, 0, 1, 32, 256, 65536, 4, 2000, 1, 256, 4, 15, '', ?)`).run(ts);
  }

  // Product catalogue categories.
  const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (id, name, slug, description, icon, image, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const categories = [
    ['game', 'Game Servers', 'game', 'Host multiplayer game servers with console and mod support', '◆', '/assets/icons/game-servers.svg', 1],
    ['web', 'Web Hosting', 'web', 'Websites, web applications and APIs', '◈', '/assets/icons/applications.svg', 2],
    ['bot', 'Bot Hosting', 'bot', 'Discord bots, Lavalink and general bots', '◇', '/assets/icons/instances.svg', 3],
    ['database', 'Databases', 'database', 'Managed database services', '▤', '/assets/icons/storage.svg', 4],
    ['custom', 'Custom Docker', 'custom', 'Run any containerised service', '◉', '/assets/icons/templates.svg', 5],
  ];
  for (const cat of categories) insertCat.run(cat[0], cat[1], cat[2], cat[3], cat[4], cat[5], cat[6], 'published');

  // Hosting products.
  const insertProduct = db.prepare(`INSERT OR IGNORE INTO products (id, category_id, name, slug, short_description, description, image, icon, features, tags, status, featured, sort_order, starting_price_monthly, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const products = [
    ['minecraft', 'game', 'Minecraft', 'minecraft', 'Java & Bedrock game server hosting', 'Host Minecraft Java or Bedrock with version selection, mod/plugin support and a live console.', '/assets/backgrounds/volcanic-strata-16x9.svg', '◆', ['Instant setup','Version selection','Mods & plugins','Live console','Automatic backups'], ['minecraft','game','java','bedrock'], 1, 1, 500],
    ['hytale', 'game', 'Hytale', 'hytale', 'Hytale server hosting', 'Dedicated Hytale server hosting with configuration and console access.', '/assets/backgrounds/volcanic-strata-16x9.svg', '◆', ['Instant setup','Console access','Backups'], ['hytale','game'], 0, 2, 500],
    ['terraria', 'game', 'Terraria', 'terraria', 'Terraria server hosting', 'Host Terraria worlds with mod support and automated backups.', '/assets/backgrounds/volcanic-strata-16x9.svg', '◆', ['Instant setup','Mod support','Backups'], ['terraria','game'], 0, 3, 500],
    ['five-m', 'game', 'FiveM', 'five-m', 'GTA V roleplay server hosting', 'FiveM server hosting for GTA V roleplay communities.', '/assets/backgrounds/volcanic-strata-16x9.svg', '◆', ['Instant setup','Resources','Console'], ['fivem','game','gta'], 0, 4, 1200],
    ['discord-bot', 'bot', 'Discord Bot', 'discord-bot', 'Always-on Discord bot hosting', 'Keep your Discord bots online with persistent storage and automatic restarts.', '/assets/icons/instances.svg', '◇', ['24/7 uptime','Auto-restart','Environment variables'], ['discord','bot'], 1, 1, 300],
    ['lavalink', 'bot', 'Lavalink', 'lavalink', 'Lavalink audio node hosting', 'Dedicated Lavalink audio nodes for music bots.', '/assets/icons/instances.svg', '◇', ['Low latency','Auto-restart','Configurable'], ['lavalink','bot','audio'], 0, 2, 300],
    ['website', 'web', 'Website Hosting', 'website', 'Static and dynamic website hosting', 'Host static sites or dynamic web applications with custom domains and SSL.', '/assets/icons/applications.svg', '◈', ['Custom domains','SSL','Git deploys','Backups'], ['website','web','static'], 1, 1, 300],
    ['webapp', 'web', 'Web Applications', 'webapp', 'Node, Python, Go and more', 'Deploy web applications and APIs from Git or custom images.', '/assets/icons/applications.svg', '◈', ['Git deploys','Environment variables','Databases'], ['app','api','node','python'], 1, 2, 500],
    ['database', 'database', 'Database Hosting', 'database', 'PostgreSQL, MySQL, Redis', 'Isolated database instances with persistent storage and backups.', '/assets/icons/storage.svg', '▤', ['Persistent storage','Backups','Isolation'], ['postgres','mysql','redis','database'], 0, 1, 500],
    ['docker', 'custom', 'Custom Docker', 'docker', 'Run any container image', 'Bring your own Docker image with full control over commands, ports and volumes.', '/assets/icons/templates.svg', '◉', ['Custom images','Resource limits','Volumes'], ['docker','custom'], 1, 1, 300],
  ];
  for (const p of products) insertProduct.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], JSON.stringify(p[8]), JSON.stringify(p[9]), 'published', p[10], p[11], p[12], 'USD', ts, ts);

  // Shade universal environment registry (data-driven runtime catalogue).
  const insertEnv = db.prepare(`INSERT OR IGNORE INTO environments (id, name, category, description, icon, versions, default_version, image, image_digest,
    architectures, default_command, default_entrypoint, working_dir, build_capable, package_managers, default_env, exposed_ports, healthcheck,
    storage, resource_recommendations, lifecycle, security, status, featured, sort_order, created_at, updated_at)
    VALUES (@id, @name, @category, @description, @icon, @versions, @default_version, @image, @image_digest,
    @architectures, @default_command, @default_entrypoint, @working_dir, @build_capable, @package_managers, @default_env, @exposed_ports, @healthcheck,
    @storage, @resource_recommendations, @lifecycle, @security, @status, @featured, @sort_order, @created_at, @updated_at)`);
  const J = (v) => JSON.stringify(v ?? []);
  const E = (id, name, category, description, icon, versions, def, image, cmd, ports, opts = {}) => ({
    id, name, category, description, icon, versions: J(versions), default_version: def, image, image_digest: opts.digest || '',
    architectures: J(['amd64','arm64']), default_command: cmd, default_entrypoint: '', working_dir: opts.dir || '/app',
    build_capable: opts.build ? 1 : 0, package_managers: J(opts.pm || []), default_env: J(opts.env || {}),
    exposed_ports: J(ports), healthcheck: J({}), storage: J(opts.storage || {}), resource_recommendations: J({}),
    lifecycle: J(opts.lifecycle || ['start','stop','restart','deploy']), security: J({}),
    status: 'published', featured: opts.featured ? 1 : 0, sort_order: opts.order || 0, created_at: ts, updated_at: ts,
  });
  const persistent = { persistent: true };
  const envs = [
    E('node','Node.js','runtime','JavaScript and TypeScript runtime','◈',['18','20','22','24'],'22','node:22-alpine','npm start',['3000'],{build:1,pm:['npm','yarn','pnpm'],featured:1,order:1}),
    E('bun','Bun','runtime','Fast JavaScript runtime and toolkit','◈',['latest','1.1'],'latest','oven/bun:1-alpine','bun run start',['3000'],{build:1,pm:['bun','npm'],order:2}),
    E('deno','Deno','runtime','Secure TypeScript runtime','◈',['latest','2.0'],'latest','denoland/deno:alpine','deno run --allow-net --allow-env main.ts',['8000'],{build:1,pm:['deno'],order:3}),
    E('python','Python','runtime','Python with pip, Poetry and uv','◈',['3.11','3.12','3.13'],'3.12','python:3.12-alpine','python main.py',['8000'],{build:1,pm:['pip','pipx','poetry','uv'],featured:1,order:4}),
    E('java','OpenJDK / JVM','runtime','Java with Maven and Gradle','◈',['17','21','25'],'21','eclipse-temurin:21-jre-alpine','java -jar application.jar',['8080'],{build:1,pm:['maven','gradle'],order:5}),
    E('dotnet','.NET','runtime','.NET SDK and ASP.NET Core','◈',['8','9','10'],'10','mcr.microsoft.com/dotnet/aspnet:10.0-alpine','dotnet application.dll',['8080'],{build:1,pm:['dotnet','nuget'],order:6}),
    E('go','Go','runtime','Go compiled applications','◈',['latest','1.22'],'latest','golang:1.22-alpine','./application',['8080'],{build:1,pm:['go'],order:7}),
    E('rust','Rust','runtime','Rust compiled applications','◈',['latest','1.75'],'latest','rust:1.75-alpine','./application',['8080'],{build:1,pm:['cargo'],order:8}),
    E('php','PHP','runtime','PHP applications and frameworks','◈',['8.2','8.3'],'8.3','php:8.3-cli-alpine','php -S 0.0.0.0:8080 -t public',['8080'],{build:1,pm:['composer'],order:9}),
    E('ruby','Ruby','runtime','Ruby and Rails applications','◈',['3.2','3.3'],'3.3','ruby:3.3-alpine','bundle exec ruby app.rb',['8080'],{build:1,pm:['bundler','gem'],order:10}),
    E('postgres','PostgreSQL','database','PostgreSQL relational database','▤',['16','15','14'],'16','postgres:16-alpine','',['5432'],{dir:'/var/lib/postgresql/data',env:{POSTGRES_PASSWORD:''},storage:persistent,featured:1,order:11,lifecycle:['start','stop','restart','backup','restore']}),
    E('mariadb','MariaDB','database','MariaDB relational database','▤',['11','10'],'11','mariadb:11-alpine','',['3306'],{dir:'/var/lib/mysql',env:{MARIADB_ROOT_PASSWORD:''},storage:persistent,order:12,lifecycle:['start','stop','restart','backup','restore']}),
    E('mongodb','MongoDB','database','MongoDB document database','▤',['7','6'],'7','mongo:7','',['27017'],{dir:'/data/db',storage:persistent,order:13,lifecycle:['start','stop','restart','backup','restore']}),
    E('redis','Redis','database','Redis in-memory data store','▤',['7','6'],'7','redis:7-alpine','',['6379'],{dir:'/data',storage:persistent,featured:1,order:14,lifecycle:['start','stop','restart','backup','restore']}),
    E('valkey','Valkey','database','Valkey open-source Redis alternative','▤',['latest'],'latest','valkey/valkey:alpine','',['6379'],{dir:'/data',storage:persistent,order:15,lifecycle:['start','stop','restart','backup','restore']}),
    E('minecraft-java','Minecraft Java','game','Minecraft Java Edition server','◆',['1.21.4','1.20.6','latest'],'1.21.4','itzg/minecraft-server:java21','',['25565'],{dir:'/data',env:{EULA:'TRUE'},storage:persistent,featured:1,order:16,lifecycle:['start','stop','restart','backup','restore']}),
    E('minecraft-bedrock','Minecraft Bedrock','game','Minecraft Bedrock Edition server','◆',['latest'],'latest','itzg/minecraft-bedrock-server','',['19132/udp'],{dir:'/data',env:{EULA:'TRUE'},storage:persistent,order:17,lifecycle:['start','stop','restart','backup','restore']}),
    E('discord-bot','Discord Bot','general','Discord bots and background workers','◇',['node','python'],'node','node:22-alpine','npm start',[],{build:1,pm:['npm'],featured:1,order:18}),
    E('static-site','Static Site','web','Static websites served by Nginx','◇',['latest'],'latest','nginx:alpine','',['80'],{dir:'/usr/share/nginx/html',featured:1,order:19}),
  ];
  for (const e of envs) insertEnv.run(e);

  // Official Trycord release (only when a real image is configured by the operator).
  const trycordImage = process.env.TRYCORD_IMAGE || '';
  if (trycordImage && !db.prepare('SELECT id FROM trycord_releases LIMIT 1').get()) {
    db.prepare('INSERT INTO trycord_releases (id, version, image, release_notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id('trc'), process.env.TRYCORD_VERSION || 'stable', trycordImage, 'Operator-published Trycord release', 'published', ts);
  }

  // Preset plans (configurable, not hardcoded in UI).
  const insertPlan = db.prepare(`INSERT OR IGNORE INTO plans (id, name, description, category, product_id, cpu_cores, memory_mb, disk_gb, network_gb, instances,
    price_monthly, price_yearly, interval, currency, features, restrictions, status, featured, sort_order, available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const planData = [
    ['free','Free','Free plan to get started','shared',null,1,512,4,10,3,0,0,'monthly','USD',['Community support','Project subdomain','Basic monitoring'],['Limited resources'],'published',1,1,1],
    ['starter','Starter','For small personal projects','shared',null,2,2048,20,100,5,800,8000,'monthly','USD',['Email support','Custom domains','Backups'],[],'published',0,2,1],
    ['basic','Basic','For growing applications','shared',null,2,4096,40,250,10,1600,16000,'monthly','USD',['Priority support','Backups','Monitoring'],[],'published',1,3,1],
    ['pro','Pro','For production workloads','shared',null,4,8192,80,500,20,3200,32000,'monthly','USD',['Priority support','Advanced monitoring','Backups','SSL'],[],'published',0,4,1],
    ['advanced','Advanced','For demanding services','dedicated',null,8,16384,160,1000,50,6400,64000,'monthly','USD',['Dedicated resources','Priority support','SSL','Backups'],[],'published',0,5,1],
    ['enterprise','Enterprise','Custom allocation','dedicated',null,16,32768,500,2000,100,12800,128000,'monthly','USD',['Dedicated resources','Dedicated support','SLA available'],['Contact for custom allocations'],'published',0,6,1],
  ];
  for (const p of planData) insertPlan.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], JSON.stringify(p[14]), JSON.stringify(p[15]), p[16], p[17], p[18], p[19], ts, ts);

  // Default subscription for every team that has none (free plan).
  for (const team of db.prepare('SELECT id FROM teams').all()) {
    if (!db.prepare('SELECT id FROM subscriptions WHERE team_id = ?').get(team.id)) {
      db.prepare(`INSERT INTO subscriptions (id, team_id, plan_id, status, source, price_monthly, currency, started_at, created_at, updated_at)
        VALUES (?, ?, 'free', 'active', 'preset', 0, 'USD', ?, ?, ?)`).run(id('sub'), team.id, ts, ts, ts);
    }
  }

  const templates = [
    ['minecraft', 'Minecraft (Paper)', 'game', 'itzg/minecraft-server', ['1.21.4', '1.20.6', '1.19.4'], '["25565"]', '{"EULA":"TRUE"}'],
    ['factorio', 'Factorio', 'game', 'factorio/factorio', ['latest'], '["34197/udp"]', '{}'],
    ['rust', 'Rust', 'game', 'rustserver/rust', ['latest'], '["28015/udp"]', '{}'],
    ['satisfactory', 'Satisfactory', 'game', 'satisfactory-server', ['latest'], '["7777/udp"]', '{}'],
    ['rust', 'Rust (SteamCMD)', 'game', 'gameserversteamcmd/steamcmd', ['258550'], '["28015/udp"]', '{"GAME":"rust","STEAM_APPID":"258550"}'],
    ['valheim', 'Valheim (SteamCMD)', 'game', 'gameserversteamcmd/steamcmd', ['896660'], '["2456/udp"]', '{"GAME":"valheim","STEAM_APPID":"896660"}'],
    ['palworld', 'Palworld (SteamCMD)', 'game', 'gameserversteamcmd/steamcmd', ['1623730'], '["8211/udp"]', '{"GAME":"palworld","STEAM_APPID":"1623730"}'],
    ['cs2', 'Counter-Strike 2 (SteamCMD)', 'game', 'gameserversteamcmd/steamcmd', ['730'], '["27015/udp"]', '{"GAME":"cs2","STEAM_APPID":"730"}'],
    ['7dtd', '7 Days to Die (SteamCMD)', 'game', 'gameserversteamcmd/steamcmd', ['294420'], '["26900/udp"]', '{"GAME":"7dtd","STEAM_APPID":"294420"}'],
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
