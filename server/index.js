import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

import config from './config.js';
import { initDb, closeDb, getDb } from './db.js';
import { requireAuth, requireAdmin, requireNode } from './auth.js';
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
import { environmentsRoutes } from './api/environments.js';
import { billingRoutes } from './api/billing.js';
import { githubRoutes } from './api/github.js';
import { featuresRoutes } from './api/features.js';
import { creditsRoutes, adminCreditsRoutes } from './api/credits.js';
import { notificationsRoutes } from './api/notifications.js';
import { ticketsRoutes, adminTicketRoutes } from './api/tickets.js';
import { analyticsRoutes } from './api/analytics.js';
import { checkoutRoutes } from './api/checkout.js';
import { connectRoutes } from './api/connect.js';
import { handleProvisionResult } from './provisioning.js';
import { snapshot as observabilitySnapshot, instrument } from './observability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
// Behind Cloudflare / a reverse proxy, trust the first hop so rate limits and
// audit logs see the real client IP instead of the proxy address.
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: config.env === 'production' ? false : true }));
app.use(compression());
// Capture raw body for webhook signature verification via express.json verify hook.
app.use(express.json({ limit: '12mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// Mandatory software identification + request correlation on every response.
const IDENT = softwareIdentification();
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || '').slice(0, 64) || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Powered-By', `${IDENT.software} ${IDENT.version}`);
  res.setHeader('X-Light-Identifier', IDENT.identifier);
  next();
});

app.get('/api/branding', (req, res) => res.json(publicBranding()));
app.get('/api/identify', (req, res) => res.json(IDENT));
// Observability — admin only, real data from process + database.
app.get('/api/observability', requireAuth, requireAdmin, asyncRoute(async (req, res) => res.json(observabilitySnapshot())));
const healthHandler = (req, res) => {
  const health = combinedHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Node agents report results/heartbeats frequently; exempt them from the
// browser-oriented rate limit so provisioning never times out under load.
const apiLimiter = rateLimit({
  windowMs: 60000, max: 600, standardHeaders: true, legacyHeaders: false,
  skip: (req) => Boolean(req.headers['x-node-token']),
});
// Brute-force protection for credential endpoints — tighter than the general API.
const authLimiter = rateLimit({
  windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' },
});
const api = express.Router();
api.use(instrument);
api.use(apiLimiter);
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// Only throttle credential endpoints, not every authenticated /auth call.
api.use('/auth', (req, res, next) => {
  if (/^\/(login|register|forgot-password|reset-password|verify)$/.test(req.path)) return authLimiter(req, res, next);
  next();
});
api.use('/auth', authRoutes());
api.use('/instances', instancesRoutes());
api.use('/nodes', nodesRoutes());
api.use('/deployments', deploymentsRoutes());
api.use('/domains', domainsRoutes());
api.use('/backups', backupsRoutes());
api.use('/schedules', schedulesRoutes());
api.use('/catalog', catalogRoutes());
api.use('/subscriptions', subscriptionsRoutes());
api.use('/environments', environmentsRoutes());
api.use('/billing', billingRoutes());
api.use('/github', githubRoutes());
api.use('/features', featuresRoutes());
api.use('/notifications', notificationsRoutes());
api.use('/tickets', ticketsRoutes());
api.use('/checkout', checkoutRoutes());
api.use('/connect', connectRoutes());
api.use('/credits', creditsRoutes());
api.use('/admin', adminRoutes());
api.use('/admin/tickets', adminTicketRoutes());
api.use('/admin/analytics', analyticsRoutes());
api.use('/admin/credits', adminCreditsRoutes());
api.use('/agent', agentRoutes());
api.get('/stats', requireAuth, statsRoutes());
api.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.teamId);
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, teamId: req.teamId },
    team, impersonatedBy: req.impersonatedBy || null, permissions: req.permissions });
}));
app.use('/api', api);

// Obsolete standalone pages from the pre-redesign frontend are redirected to
// their modern equivalents rather than served with incompatible API contracts.
const LEGACY_REDIRECTS = {
  '/nodes.html': '/login#/servers',
  '/workloads.html': '/login#/servers',
  '/deployments.html': '/login#/activity',
  '/showcase.html': '/',
  '/widget.html': '/login#/overview',
};
for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) app.get(from, (req, res) => res.redirect(302, to));

// `index: false` stops static middleware from hijacking `/` with index.html —
// the explicit route below must serve the public marketing homepage.
app.use(express.static(path.join(appDir, 'public'), {
  index: false,
  setHeaders: (res, filePath) => {
    // Hashed/static assets may be cached; HTML must always be revalidated so
    // deployments and branding changes are visible immediately.
    if (/\.(?:css|js|woff2?|svg|png|webp|ico|avif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    } else if (/\.html?$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use('/assets', express.static(path.join(appDir, 'assets'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800, immutable'),
}));
// Clean, human-friendly routes (no .html exposed to visitors).
const send = (file) => (req, res) => res.sendFile(path.join(appDir, 'public', file));

app.get('/', send('site.html'));
app.get('/hosting', send('hosting.html'));
app.get('/hosting/:category', send('hosting.html'));
app.get('/product', send('product.html'));
app.get('/product/:slug', send('product.html'));
app.get('/pricing', send('pricing.html'));
app.get('/configure', send('configure.html'));
app.get('/docs', send('docs.html'));
app.get('/about', send('about.html'));
app.get('/contact', send('contact.html'));
app.get('/legal', send('legal.html'));
app.get('/features', send('features.html'));
app.get('/faq', send('faq.html'));
app.get('/login', send('index.html'));
app.get('/register', send('index.html'));
app.get('/files', send('files.html'));
app.get('/checkout', send('checkout.html'));
app.get('/order/:id', send('order.html'));
// Stripe Connect sample pages.
app.get('/connect', send('connect.html'));
app.get('/store/:accountId', send('store.html'));
// Administration — independent application; serves admin.html for /admin and all sub-routes.
app.get(['/admin', /^\/admin\/.*/], send('admin.html'));
// Legacy .html URLs still work (backward compatibility).
const PUBLIC_PAGES = ['site','pricing','docs','about','contact','legal','product','hosting','configure','features','faq','admin','files','checkout','connect','store'];
app.get('/:page.html', (req, res, next) => {
  if (PUBLIC_PAGES.includes(req.params.page)) return send(`${req.params.page}.html`)(req, res);
  next();
});
app.get(/^\/(?!api|health|assets).*/, send('index.html'));
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
/** Map unexpected error classes to honest HTTP statuses instead of blanket 500s. */
function statusForError(error) {
  if (error instanceof HttpError) return error.status;
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) return error.status;
  if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) return 400;
  if (error.type === 'entity.too.large') return 413;
  if (typeof error.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) return 409;
  if (error.code === 'LIMIT_FILE_SIZE') return 413;
  return 500;
}

/** Human-readable, non-technical message for unexpected failures — never "internal server error". */
function friendlyMessage(status, error) {
  if (error instanceof HttpError || error.message) {
    // Pass through our own HttpError messages (already actionable) and known
    // client errors. For unknown 500s, give the operator something to act on.
    if (status < 500) return error.message;
    const m = String(error.message || '');
    if (/SQLITE|database|disk i\/o/i.test(m)) return 'A storage error occurred. Please try again or contact support.';
    if (/docker|agent|node|ECONNREFUSED|ENOENT|fetch failed/i.test(m)) return 'The infrastructure agent is temporarily unavailable. Please retry in a moment.';
    if (/timeout|ETIMEDOUT/i.test(m)) return 'The operation timed out. Please retry.';
  }
  if (status === 404) return 'The requested resource was not found.';
  if (status === 409) return 'This action conflicts with the current state. Refresh and try again.';
  if (status === 413) return 'The request is too large. Try a smaller file or request.';
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  return 'Something went wrong on our side. Please try again — if it persists, contact support with the request ID below.';
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = statusForError(error);
  const code = error.code || (status === 500 ? 'internal_error' : 'error');
  if (status >= 500) console.error(`[error] request=${req.id || '-'}`, error);
  res.status(status).json({
    error: code,
    message: friendlyMessage(status, error),
    requestId: req.id || undefined,
  });
});

const server = http.createServer(app);

function start() {
  initDb();
  server.listen(config.port, config.host, () => console.log(`[.light] control plane listening on http://${config.host}:${config.port}`));
  const scheduleTimer = setInterval(() => { try { runSchedules(); } catch (error) { console.error('[schedules]', error); } }, 60000);
  // Reconcile DB state with reported Docker reality every 2 minutes.
  import('./reconcile.js').then(({ reconcileWorkloads }) => {
    setInterval(() => { try { reconcileWorkloads().catch((e) => console.error('[reconcile]', e)); } catch (e) { console.error('[reconcile]', e); } }, 120000);
  }).catch(() => {});
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    console.log('[.light] shutting down');
    clearInterval(scheduleTimer);
    // Close the DB exactly once. better-sqlite3 aborts natively if close() is
    // called twice or with live statements, so clear the safety timer as soon
    // as the graceful path completes.
    let closed = false;
    const finish = () => {
      if (closed) return; closed = true;
      clearTimeout(floor);
      try { closeDb(); } catch {}
      process.exit(0);
    };
    server.close(finish);
    const floor = setTimeout(finish, 5000);
    floor.unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', (error) => { console.error('[.light] uncaught:', error); shutdown(); });
  process.on('unhandledRejection', (error) => { console.error('[.light] unhandled rejection:', error); });
}

// Retry init if the DB is briefly locked during a restart handoff.
let attempts = 0;
while (true) {
  try { start(); break; }
  catch (error) {
    if (++attempts >= 5) { console.error('[.light] failed to start:', error); process.exit(1); }
    console.error(`[.light] init attempt ${attempts} failed: ${error.message}; retrying`);
    const block = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(block), 0, 0, 1000);
  }
}
