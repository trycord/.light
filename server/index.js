import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

import config from './config.js';
import { initDb, closeDb, getDb } from './db.js';
import { requireAuth, requireNode } from './auth.js';
import { asyncRoute, HttpError } from './util.js';
import { combinedHealth, setAgentHealth } from './health.js';
import { publicBranding } from './branding.js';
import { softwareIdentification } from './watermark.js';
import { authRoutes } from './api/auth.js';
import { instancesRoutes } from './api/instances.js';
import { nodesRoutes } from './api/nodes.js';
import { deploymentsRoutes } from './api/deployments.js';
import { domainsRoutes } from './api/domains.js';
import { backupsRoutes } from './api/backups.js';
import { schedulesRoutes, runSchedules } from './api/schedules.js';
import { catalogRoutes } from './api/catalog.js';
import { adminRoutes } from './api/admin.js';
import { agentRoutes } from './api/agent.js';
import { statsRoutes } from './api/stats.js';
import { subscriptionsRoutes } from './api/subscriptions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: config.env === 'production' ? false : true }));
app.use(compression());
app.use(express.json({ limit: '12mb' }));

// Mandatory software identification on every response (cannot be white-labeled away).
const IDENT = softwareIdentification();
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', `${IDENT.software} ${IDENT.version}`);
  res.setHeader('X-Light-Identifier', IDENT.identifier);
  next();
});

app.get('/api/branding', (req, res) => res.json(publicBranding()));
app.get('/api/identify', (req, res) => res.json(IDENT));
app.get('/health', (req, res) => {
  const health = combinedHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

const apiLimiter = rateLimit({ windowMs: 60000, max: 600, standardHeaders: true, legacyHeaders: false });
const api = express.Router();
api.use(apiLimiter);
api.use('/auth', authRoutes());
api.use('/instances', instancesRoutes());
api.use('/nodes', nodesRoutes());
api.use('/deployments', deploymentsRoutes());
api.use('/domains', domainsRoutes());
api.use('/backups', backupsRoutes());
api.use('/schedules', schedulesRoutes());
api.use('/catalog', catalogRoutes());
api.use('/subscriptions', subscriptionsRoutes());
api.use('/admin', adminRoutes());
api.use('/agent', agentRoutes());
api.get('/stats', requireAuth, statsRoutes());
api.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.teamId);
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, teamId: req.teamId }, team });
}));
app.use('/api', api);

app.use(express.static(path.join(appDir, 'public')));
app.use('/assets', express.static(path.join(appDir, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(appDir, 'public', 'site.html')));
const PUBLIC_PAGES = ['site','pricing','docs','about','contact','legal','product','hosting','configure','features','faq'];
app.get('/:page.html', (req, res, next) => {
  if (PUBLIC_PAGES.includes(req.params.page)) return res.sendFile(path.join(appDir, 'public', `${req.params.page}.html`));
  next();
});
app.get(/^\/(?!api|health|assets).*/, (req, res) => res.sendFile(path.join(appDir, 'public', 'index.html')));
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof HttpError ? error.status : (error.status || 500);
  const code = error.code || (status === 500 ? 'internal_error' : 'error');
  if (status >= 500) console.error('[error]', error);
  res.status(status).json({ error: code, message: status >= 500 ? 'internal server error' : error.message });
});

const server = http.createServer(app);

function start() {
  initDb();
  server.listen(config.port, config.host, () => console.log(`[.light] control plane listening on http://${config.host}:${config.port}`));
  const scheduleTimer = setInterval(() => { try { runSchedules(); } catch (error) { console.error('[schedules]', error); } }, 60000);
  const shutdown = () => {
    console.log('[.light] shutting down');
    clearInterval(scheduleTimer);
    server.close(() => { closeDb(); process.exit(0); });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
start();
