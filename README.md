# .light

Universal hosting platform. `.light` is a Trycord product.

## Quick start (standalone, one container)

Requires Docker with the Docker socket available at `/var/run/docker.sock` (the
integrated node agent provisions real containers through it).

```bash
cp .env.example .env
# edit .env: set JWT_SECRET, NODE_TOKEN (or leave blank to auto-generate),
# and the bootstrap admin credentials
docker compose up -d --build
```

- Dashboard: `http://<host>:5858/index.html`
- Public site: `http://<host>:5858/`
- Health: `http://<host>:5858/health` (reports both control plane and integrated agent)
- Default admin: `admin@trycord.dev` / `TryAdmin2026!` (from `.env` — change it)

One container (`start.js`) runs two processes: the control plane (API + dashboard)
and the integrated node agent. A supervisor starts both, reports failures, and
shuts them down gracefully. Data is stored in named volumes `trycord-light-data`
(database) and `trycord-light-node-data` (workload files/backups).

## Configuration

All settings are environment variables in `.env`. Key groups:

- **Secrets:** `JWT_SECRET`, `NODE_TOKEN` — auto-generated and persisted in
  `/data/.secrets.json` if blank.
- **Branding (white-label):** `BRAND_PRODUCT`, `BRAND_LOGO`, `BRAND_FAVICON`,
  `BRAND_PRIMARY_COLOR`, `BRAND_ACCENT_COLOR`, `BRAND_TAGLINE`, etc. Served by
  `GET /api/branding`. The `.light` ownership watermark and software identity
  (`server/watermark.js`, `GET /api/identify`) are embedded in source and cannot
  be removed through configuration.
- **Domain:** `PLATFORM_DOMAIN` (default `trycord.dev`) is used for project
  subdomains assigned to each new instance.
- **Email:** disabled by default. Set `EMAIL_ENABLED=true` and either
  `EMAIL_PROVIDER=deomail` with `DEOMAIL_API_KEY`/`DEOMAIL_FROM_EMAIL`, or
  `EMAIL_PROVIDER=smtp` with the `SMTP_*` variables. With email disabled,
  registration/login work without verification and password recovery is
  administrator-assisted.

## Remote nodes (distributed mode)

The standalone install does not require a node container. To add capacity on
another machine, run the same image in agent-only mode:

```bash
CONTROL_URL=https://<control-plane>:5858 NODE_ID=node-02 NODE_TOKEN=<token> \
  docker compose -f compose.node.yml up -d
```

Register the matching node/token in the admin panel. Agents authenticate with
`NODE_TOKEN`, poll an authenticated command queue, stream logs, and push real
host metrics.

## Operations

- **Upgrade:** `docker compose pull && docker compose up -d --build`. Database
  migrations run automatically on start and are additive (existing data kept).
- **Backup:** copy the `trycord-light-data` and `trycord-light-node-data`
  volumes. Per-instance backups are created from the instance's Backups tab.
- **Restore:** restore the volumes, then start the stack.
- **Tests:** `npm test` (requires a running stack for API/E2E tests).

## Architecture

Express control plane + SQLite (WAL) + dockerode node agent. Multi-tenant with
scrypt password hashing, JWT sessions, role-based authorization, quota
enforcement, tenant isolation, audit log, and an authenticated node command
queue. Frontend is a vanilla-JS SPA plus a public marketing site.

## Known limitations

- Git-based builds are stubbed in the agent (image-based deploys are real).
- SSL certificate provisioning and reverse-proxy application are not automatic;
  a Caddy-compatible config is generated at `GET /api/domains/config/proxy`.
- Mod/plugin management and automatic 2FA are not implemented.
- Plan billing/payment processing is not implemented; plans are configuration.
