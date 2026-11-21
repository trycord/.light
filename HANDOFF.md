# .light — HANDOFF SUMMARY FOR NEW CODING AGENT

## 0. CRITICAL CONTEXT

**Project:** `/light` (Trycord's universal hosting SaaS)
**Repo root:** `C:\Users\ultim\.light` (git initialized, multiple commits)
**Stack:** Node 20 ESM + Express + better-sqlite3 (SQLite WAL) + dockerode. No frontend build step. Fonts via Google Fonts.
**Brand:** Product = `.light`; Owner/developer = Trycord; Infra agent = Shade. Watermark ".light POWERED BY TRYCORD" is MANDATORY and embedded in source — never remove. White-label config can change appearance but not ownership attribution.
**Universal domain:** `trycord.dev` (project subdomains `<slug>-<id>.trycord.dev`).
**Ports:** Control plane 5858 (`PORT`), agent 5859 (`AGENT_PORT`/`SHADE_PORT`). Both env-overridable.

## 1. CURRENT RUNNING STATE (as of handoff)

- Docker image `trycord/light:latest` built; one container `trycord-light` running via `docker compose up -d`.
- Health endpoint `GET /health` returns status ok with both `controlPlane` and `nodeAgent` healthy.
- Single container runs TWO processes via `start.js` supervisor: `server/index.js` (panel) + `agent/index.js` (integrated Shade).
- Persistent volumes: `trycord-light-data` (DB), `trycord-light-node-data` (workload files).
- Test artifacts: `public/_boot.html` exists (dev-only token boot page — DELETE before production).

## 2. ACCESS CREDENTIALS

- Admin: `admin@trycord.dev` / `LightAdmin2026!`
- Reset utility: `docker exec trycord-light node server/reset-admin.js [password]`
- `BOOTSTRAP_ADMIN_EMAIL/PASSWORD/NAME` env vars seed admin on fresh DB.

## 3. FILE TREE (key files)

```
server/
  index.js          - Express app, all routes, static serving, clean URLs, webhook raw-body
  config.js         - env config (branding, email, payments, platform domain)
  db.js             - schema + additive migrations + seed (products, plans, 19 environments, etc.)
  auth.js           - JWT auth, requireAuth/requireAdmin, scrypt password hashing
  crypto.js         - AES-256-GCM encrypt/decrypt for secrets at rest
  pricing.js        - server-side pricing engine (authoritative, no client price trust)
  payments.js       - Stripe abstraction (checkout, webhook verify, refunds)
  github.js         - GitHub OAuth/API/webhook signature verification
  proxy.js          - Caddyfile generation + Caddy admin API application
  twofactor.js      - RFC 6238 TOTP + backup codes
  plans.js          - quota enforcement (checkQuota), planFor (respects custom subs)
  commands.js       - node command queue (queueCommand, claimCommand, dispatch)
  health.js         - combined health for panel + agent
  watermark.js      - mandatory ownership attribution
  branding.js       - publicBranding() merges white-label + immutable watermark
  secrets.js        - auto-generates JWT_SECRET/NODE_TOKEN on first start
  audit.js          - audit logging
  permissions.js    - permission catalogue, hasPermission / requirePermission, real-admin guard
  notifications.js  - persisted notification helpers (users, teams, admins)
  reset-admin.js    - admin reset utility
  api/
    auth.js, billing.js, github.js, features.js, catalog.js, subscriptions.js,
    environments.js, instances.js, nodes.js, deployments.js, domains.js,
    backups.js, schedules.js, admin.js, agent.js, stats.js,
    notifications.js, tickets.js, analytics.js
agent/
  config.js         - SHADE_* env config
  index.js          - agent main loop, command execution, log streaming
  docker.js         - dockerode workload execution
  build.js          - isolated build pipeline (no Dockerfiles/socket/privileged)
  games.js          - steamcmd game server installs
  files.js          - file manager with path traversal protection
public/
  index.html        - customer dashboard SPA entry (loads /js/dashboard.js)
  admin.html        - INDEPENDENT admin app entry (loads /js/admin.js)
  site.html         - public website
  hosting.html, product.html, pricing.html, configure.html, docs.html,
  about.html, contact.html, legal.html
  js/
    dashboard.js    - customer dashboard (nav, views, all functionality)
    admin.js        - admin control center (nav, views, editing)
    api.js          - API client (ALL methods defined here)
    assets.js       - brand asset helpers
    site.js         - public website helpers
  styles/
    tokens.css, components.css, utilities.css, layout.css, app.css,
    dashboard.css, admin.css, site.css, widget.css
tests/
  unit.test.js, api.test.js, auth.test.js, e2e.test.js, features.test.js
Dockerfile          - single image (panel+agent), multi-stage, non-root via entrypoint
Dockerfile.shade    - standalone Shade image (light-shade:latest)
docker-compose.yml  - standalone stack
compose.shade.yml   - distributed Shade node
compose.node.yml    - legacy node override
docker-entrypoint.sh - socket permission fix + privilege drop
start.js            - process supervisor
```

## 4. CLEAN URL ROUTES (no .html)

| URL | Page |
|---|---|
| `/` | Public website |
| `/hosting`, `/hosting/:category` | Marketplace |
| `/product/:slug` | Product detail + plans |
| `/pricing`, `/configure` | Plans / custom configurator |
| `/docs`, `/features`, `/faq` | Info pages |
| `/about`, `/contact`, `/legal` | Company/legal |
| `/login`, `/register` | Customer dashboard + auth |
| `/admin`, `/admin/:section` | Admin control center |

## 5. IMPLEMENTED FEATURES (all with real backend + persistence)

**Auth:** registration (username/email/password/terms), scrypt hashing, JWT sessions, logout (token_version invalidation), password change/reset, email verification (conditional on EMAIL_ENABLED), brute-force lockout, session management, account deletion, 2FA (TOTP + backup codes).

**Commercial:** products/categories/plans/pricing_config/subscriptions/transactions/invoices — all DB-backed and admin-editable. Server-side pricing engine. Build Your Own Plan. Stripe checkout + verified webhooks + refunds (manual mode when unconfigured — never fakes payment).

**Hosting:** instance CRUD + lifecycle (start/stop/restart/reinstall/suspend/resume/delete) via authenticated node command queue. Docker execution with resource limits, per-team networks, port mappings, persistent volumes, CapDrop, no-new-privileges. Files manager (path-traversal protected), console/log streaming, metrics, backups/restore, schedules, domains.

**GitHub:** OAuth + PAT, encrypted tokens, repo/branch listing, HMAC-verified push webhooks → idempotent auto-deploy.

**Shade:** 19 runtime environments, steamcmd game installs, isolated builds (no customer Dockerfiles), mods, standalone + distributed modes, health checks.

**TLS/proxy:** Caddyfile generation from verified domains, Caddy admin API application, DNS instructions, cert state tracking (active only after provisioning).

**Admin app:** independent entry at /admin with full nav — customers, services, products, plans (editing VERIFIED working), environments, nodes, subscriptions, transactions, pricing, domains, backups, audit, settings.

**Branding:** publicBranding() API with watermark; all branding env-configurable; white-label cannot remove watermark.

## 6. VERIFICATION

- `npm test` → 36/36 tests pass (unit, API, auth, E2E provisioning, tenant isolation, features with real TOTP, plus notifications, tickets, analytics, RBAC and impersonation).
- Admin dashboard verified rendering via headless Chrome after fixing `poll is not a function` bug.
- Clean routes all return HTTP 200.
- E2E verified: register → create server → agent provisions real container → lifecycle → delete.
- Data persists across container restarts.

## 7. JUST-FIXED BUGS (last session)

1. Admin dashboard stuck on error `poll is not a function` — admin.js called `poll()` but never defined it. Fixed by adding `function poll(fn, ms=15000)` and renaming timer var to `pollTimer` to avoid collision. Also set `currentView = v` in `render()`. VERIFIED working (8 admin-stat cards, 15 nav items rendered).
2. Webhook 500 error — raw-body middleware consumed stream before express.json. Fixed by using `express.json({ verify: (req,res,buf) => req.rawBody = buf.toString() })`.
3. 2FA enable chicken-and-egg — enable() called verify() which required enabled=1. Fixed by verifying against stored secret directly.
4. Environment seed "Too few parameter values" — rewrote seed using named object parameters.
5. Plan editing via admin API verified working.

## 8. REMAINING / NOT DONE (honest)

**Completed this session (previously listed as outstanding):**
- Granular custom RBAC roles + fully audited admin impersonation — DONE (`server/permissions.js`, `roles` table, scoped `imp` JWT, permission-aware admin nav, per-section API enforcement).
- Support tickets backend + customer/admin UI — DONE (`server/api/tickets.js`, tables `support_tickets` / `support_ticket_messages`, threaded replies, status/priority, notifications).
- Notifications backend + customer/admin UI — DONE (`server/notifications.js`, `server/api/notifications.js`, bell/unread badge, broadcasts, mark-read).
- Analytics detail — DONE (`server/api/analytics.js`, admin Analytics view with real persisted-data aggregates).
- Fixed broken customer `renderNotifications` / `renderSupport` references and the admin `table()` array-comma bug.
- Deleted all dev-only `_boot.html` / test boot pages — no token boot artifacts remain.

**Platform decisions applied this session:**
- Only the `free` plan exists. A one-time migration (`only_free_plan`) reassigned all subscriptions/teams to Free and deleted every other plan; the seed now inserts only Free.

**Per-service provisioning added this session:**
- Debian-only universal runtime image definition (`runtime/`, `scripts/build-runtime-image.sh`, `npm run build:runtime`). `LIGHT_RUNTIME_IMAGE_MODE=custom` switches Shade from approved external Debian images to our image with exact runtime/version injected via env.
- Runtime catalog now uses explicit per-version images (`version_images`); one tested version per runtime aligned with `runtime/manifest.json`. One-time `debian_runtime_catalog` migration upgrades existing installs.
- Shade adds `instance.reprovision`, security-checked container config, auto-assigned host ports reported to the panel, and data-preserving runtime migration.
- Customers no longer pick CPU/RAM/disk — plan-granted resources only; admin **Plan maker** defines plans; BYOP gated behind `ALLOW_CUSTOM_PLANS`.
- Right-side server info panel shows runtime, randomized port mappings, project domain, SSL and plan resources.
- Cloudflare Tunnel provisioning (`server/cloudflare.js`) with honest `configuration_required` state.

**Operations added this session:**
- Shade reports real container state (running/health/exit code) every 20s; control plane persists it on services and recovers orphaned commands after restarts.
- Cloudflare connector command (`tunnel.start`/`tunnel.stop`) runs cloudflared inside our approved image on the team network; binary is installed by `runtime/Dockerfile`.
- `npm run pin:digests -- --apply` resolves approved Docker Hub images to digests.

**Native Trycord package + custom runtime (latest):**
- `packages/trycord/` holds the real Trycord 7.2.0 source (copied from `/home/ultim/trycord/.trycord`, excluding `.git`/`node_modules`/`.env`/DBs) and its multi-stage Debian `Dockerfile` (`trycord/light-trycord:1.0.0`). Non-root `node` user, tini, port 9971, `/api/health`.
- Registered as product `trycord`, package `trycord`, and custom runtime `trycord` in the catalogue (`trycord_runtime` migration). The package auto-selects this runtime — customers never pick an OS/runtime; checkout shows the auto-selected runtime read-only.
- The app is baked into the image at `/app/backend`; the customer workspace `/home/container` holds persistent `data/` + `uploads/` and `.env` (per-service `JWT_SECRET`). Shade chowns these to uid 1000 so SQLite can write; image-based packages skip the generic scaffold workdir bind and supply their absolute startup command.
- Trycord services provision through the standard Shade `instance.create` pipeline; the runtime catalogue is the single source of truth for the image ref. Verified live: healthy container, `/api/health` ok, only `/home/container` mounted.
- Cloudflare: one tunnel per application + DNS CNAME + hostname ingress, verified live. Wildcard shared-tunnel fallback when the zone nears its 200-record limit; `POST /api/domains/:id/retry-route`.
- Settings apply immediately (no restart). Admin restart button restarts the full stack via `scripts/restart-all.sh`. Shade heartbeats retry before reporting degraded.
- "Sell with Connect" link removed from customer-facing footers.

**Masterpiece hardening pass (latest):**
- Fixed an "internal server error" on authenticated calls: malformed/expired JWTs threw `JsonWebTokenError` without an HTTP status, so the global handler returned 500. `verifyToken` now maps them to 401 (`invalid_token` / `token_expired`).
- Backend: request correlation IDs (`X-Request-Id`) on every response, `/api/health` alias, `trust proxy`, scoped brute-force rate limit on credential endpoints, no-store on API responses, immutable caching for static assets, and global error normalization (parse errors → 400, payloads → 413, SQLite constraints → 409) instead of blanket 500s.
- Visual redesign work was reverted at the operator's request; the original design system (tokens/components/site/marketing/dashboard/admin/app/layout/utilities/masterpiece CSS) and original flame-orange SVG assets are restored.

**Still outstanding:**
- ACME certificate issuance delegated to Caddy (not native).
- Payment methods beyond Stripe not added (PayPal etc listed as possibilities only).
- Webhook raw-body for GitHub uses `req.rawBody` from express.json verify — works.
- `.env` contains real secrets (local dev) — gitignored, never commit.
- Git-based builds: `agent/build.js` exists but real repo builds need GITHUB credentials + proper build images tested.
- Local Linux note: Node 26 cannot compile `better-sqlite3@11`; use Node 24 (`~/.nvm/versions/node/v24.21.0/bin`) after a Windows zip restore, and start the agent with sudo for Docker socket access.

## 9. HOW TO RUN / TEST

```powershell
cd C:\Users\ultim\.light
docker compose up -d --build
curl.exe http://127.0.0.1:5858/health
npm test
```

Admin UI: `http://localhost:5858/admin` → login with admin creds (redirects to /login if no token; after login, navigate to /admin).
Customer UI: `http://localhost:5858/login`.
Public site: `http://localhost:5858/`.

## 10. GIT HISTORY (recent)

```
c280aea docs: update integrations and remaining limitations
4e818c2 feat: implement payments, GitHub deploys, TLS/proxy, mods, 2FA
e0eed8c docs: update README with admin access, clean routes, commercial platform
da372f7 chore: remove test artifacts
0800223 feat: clean routes, administration control center, Shade runtime registry
aeab453 feat: commercial platform backend + catalogue, admin reset utility
```

## 11. INSTRUCTIONS FOR NEW AGENT

1. Read this file + README.md + server/index.js + public/js/admin.js + public/js/dashboard.js.
2. Verify dashboards load in a browser (use fresh token if using headless Chrome boot page).
3. Continue with remaining items in section 8, prioritizing: RBAC, support tickets backend/UI, notifications, analytics, and fuller GitHub build testing.
4. Keep all changes backward-compatible; maintain tests; keep app runnable.
5. NEVER remove the watermark or change ownership attribution.
6. Every new feature needs: interface + backend + persistence + permissions + tests.
