# .light

Universal hosting platform. `.light` is a Trycord product, powered by Shade.

## Quick start (standalone, one container)

```bash
cp .env.example .env
# Optionally set JWT_SECRET / NODE_TOKEN (auto-generated if blank).
docker compose up -d --build
```

- Public website: `http://<host>:5858/`
- Dashboard: `http://<host>:5858/login`
- Administration: `http://<host>:5858/admin`
- Health: `http://<host>:5858/health` (control plane + integrated node agent)
- Designated admin: `admin@trycord.dev` / `LightAdmin2026!` (set via `BOOTSTRAP_ADMIN_*` in `.env`; change after first login)

Requires the Docker socket at `/var/run/docker.sock` so the integrated Shade agent can provision workloads.

## Clean routes

| URL | Page |
|---|---|
| `/` | Public website |
| `/hosting`, `/hosting/:category` | Hosting marketplace |
| `/product/:slug` | Product detail + plans |
| `/pricing` | Plans & pricing |
| `/configure` | Build Your Own Plan |
| `/docs`, `/features`, `/faq` | Information |
| `/about`, `/contact`, `/legal` | Company / legal (drafts) |
| `/login`, `/register` | Customer dashboard + auth |
| `/admin`, `/admin/:section` | Administration Control Center |

Legacy `.html` URLs still redirect to the same pages.

## Architecture

- **Control plane** (`server/`): Express + SQLite (WAL), JWT auth, scrypt passwords,
  role-based access, tenant isolation, audit log, rate limiting. Multi-stage Docker image.
- **Shade** (`agent/`, `light-shade:latest`): infrastructure agent — Docker execution,
  isolated builds (no customer Dockerfiles/socket), resource limits, log streaming,
  metrics, BYOD domain support. `SHADE_*` env configuration.
- **Standalone**: one container runs control plane + integrated Shade via a supervisor
  with health checks and graceful shutdown.
- **Distributed**: `compose.shade.yml` runs independent Shade nodes that register with
  the central panel using `SHADE_NODE_TOKEN`.

## Commercial platform

- Backend-configurable products, categories, preset plans and custom pricing (`pricing_config`).
- Server-side pricing engine (`server/pricing.js`) — client estimates are never trusted.
- Subscriptions, transactions, manual activation when no payment provider is configured.
- Build Your Own Plan configurator with authoritative server-side validation.
- Administration UI for products, plans, pricing, environments, nodes, customers and audit.

## Ports & configuration

- Control plane: `5858` (`PORT`, `CONTROL_PLANE_PORT`) — env-overridable.
- Shade agent: `5859` (`AGENT_PORT` / `SHADE_PORT`) — env-overridable.
- All branding, domain (`PLATFORM_DOMAIN`, default `trycord.dev`), email (DeoMail,
  opt-in) and ownership attribution are environment-configurable. The `.light`
  ownership watermark is embedded in source and cannot be removed by white-label config.

## Operations

- **Upgrade:** `docker compose pull && docker compose up -d --build` (additive migrations run on start).
- **Backup:** copy `trycord-light-data` and `trycord-light-node-data` volumes; per-service backups from the dashboard.
- **Restore:** restore volumes, then start the stack.
- **Reset admin:** `docker exec trycord-light node server/reset-admin.js [password]`.
- **Tests:** `npm test` (API/E2E tests require a running stack).

## Known limitations

- Payment processing is not integrated; activation uses administrator-approved manual mode and records a pending transaction. It is never reported as a completed payment.
- Git-based automatic deploys and webhook verification are scaffolded (tables/models) but the full OAuth flow is not enabled.
- TLS certificate issuance and reverse-proxy application are not automatic; a Caddy-compatible config is exposed via the domains API.
- Mod/plugin management and 2FA are not implemented.
