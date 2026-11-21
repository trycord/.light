# .light — Docker deployment

## Architecture

| Service | Image | Role | Docker socket |
|---|---|---|---|
| `light` | `trycd/trycord-light:1.0.0` | Control plane, public site, customer dashboard, admin dashboard, auth, database, provisioning orchestration, webhooks | **No** |
| `shade` | `trycd/trycord-light:shade` (built from the `shade` target in the single `Dockerfile`) | Infrastructure agent — creates and manages customer workload containers | **Yes** |

Both images live in the **one** Docker Hub repository `trycd/trycord-light`:
- `:latest` / `:1.0.0` → the platform (`light` target)
- `:shade` → the Shade agent (`shade` target)

Customer workloads are **never** baked into these images. Shade launches them at runtime from approved runtime images. The Docker socket is mounted only into `shade`.

## Quick start

```bash
cd /home/ultim/.light
cp .env.example .env
# Set at minimum:
#   JWT_SECRET, NODE_TOKEN (must be shared by light + shade),
#   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD,
#   PLATFORM_DOMAIN, CONTROL_BASE_URL
docker compose up -d
docker compose ps     # both services must be healthy
curl http://localhost:5858/health
```

Frontends and API are all served by `light` on port `5858`.

## Ports

| Port | Service | Description |
|---|---|---|
| 5858 | light | Public site, dashboards, admin, REST API, `/health` |
| 5859 | shade | Shade agent health (internal to compose network) |

## Volumes

| Volume | Mount | Contents |
|---|---|---|
| `light-data` | `/data` | SQLite database, generated secrets (`.secrets.json`) |
| `light-shade-data` | `/var/lib/light-shade` | Shade state, instance workspaces |

## Environment variables

Shared (light): `NODE_ENV`, `LOG_LEVEL`, `PLATFORM_DOMAIN`, `CONTROL_BASE_URL`, `ALLOW_SIGNUP`, `ALLOW_CUSTOM_PLANS`, `JWT_SECRET`, `NODE_TOKEN`, `BOOTSTRAP_ADMIN_*`, all `BRAND_*`, `CLOUDFLARE_*`, `LIGHT_TUNNEL_IMAGE`, `LIGHT_RUNTIME_IMAGE*`, `STRIPE_*`, `GITHUB_*`, mail (`EMAIL_*`, `DEOMAIL_*`, `SMTP_*`), `CADDY_ADMIN_URL`, `SSO_*`.

Shade-specific: `SHADE_NODE_ID`, `SHADE_NODE_NAME`, `SHADE_NODE_TOKEN` (set from `NODE_TOKEN`), `SHADE_CONTROL_PLANE_URL` (set to `http://light:5858` by compose), `SHADE_DOCKER_HOST`, `SHADE_DATA_DIR`, `SHADE_HEARTBEAT_INTERVAL`, `SHADE_METRICS_INTERVAL`, `SHADE_LOG_LEVEL`.

Networks: `LIGHT_NET_SUBNET` overrides the default `172.31.0.0/16`.

## Building locally

```bash
# One Dockerfile, two targets, ONE repository.
docker build --target light -t trycd/trycord-light:1.0.0 -f Dockerfile .
docker build --target shade -t trycd/trycord-light:shade  -f Dockerfile .
docker tag trycd/trycord-light:1.0.0 trycd/trycord-light:latest
docker push trycd/trycord-light:1.0.0
docker push trycd/trycord-light:latest
docker push trycd/trycord-light:shade
```

## Linking a second machine as a Shade node (distributed testing)

The control plane can schedule workloads across multiple Shade nodes. A second,
higher-powered machine can join as a node without sharing any control-plane
secrets beyond its own node token.

**On the main machine** — ensure the control plane is reachable from the second
machine on port `5858` (firewall / VPN / tunnel). The node agent talks to
`http://<control-plane>:5858/api/agent/*` with its node token.

**On the second machine**:

```bash
# Point at the main control plane
export CONTROL_URL=http://<main-machine-ip>:5858
export BOOTSTRAP_ADMIN_EMAIL=admin@trycord.dev
export BOOTSTRAP_ADMIN_PASSWORD='...'
export SHADE_NODE_NAME=big-machine

npm run link-node     # or: bash scripts/link-node.sh
```

The script logs in, registers (or reuses) the node, writes a `0600` env file to
`/tmp/light-shade.env`, and prints the exact `docker run` command:

> **Use the `:shade` tag on the second machine, not `:latest`.** `:latest` is the
> platform image — it runs the `start.js` supervisor, not the Shade agent, and
> fails with `EACCES mkdir /var/lib/light-shade/instances`. The correct image is
> `trycd/trycord-light:shade` (multi-arch: amd64 + arm64).

```bash
docker run -d --name light-shade --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --env-file /tmp/light-shade.env \
  trycd/trycord-light:shade
```

**Verify** on the main machine: the node appears in *Admin → Infrastructure →
Nodes* as `online`, with real CPU/RAM/disk heartbeats. Shade selects online
nodes by lowest load, so new services land on the least busy machine.

Notes:
- The Docker socket is mounted **only** in the Shade container — never expose it
  to customers or the control-plane service.
- Re-running `link-node.sh` with the same `SHADE_NODE_NAME` reuses the node token
  (idempotent), so it is safe to run again after a machine rebuild.
- Use distinct names (`big-machine`, `gpu-node`, etc.) for distinct machines.

## Universal infrastructure engine (Shade)

Shade now uses shared subsystems instead of product-specific one-off fixes:

- **Execution backend abstraction** (`agent/backend.js`): all Docker access goes
  through a single interface with connectivity checks, precise errors
  (`backend_unavailable`, `backend_permission_denied`), retry/reconnect and a
  backend health object exposed on `GET :5859/health` and in heartbeats.
- **Universal dependency manager** (`agent/dependencies.js`): a global
  `Inspect → Detect → Resolve → Install → Verify → Start` stage. Detects
  `package.json`/lockfiles (npm, yarn, pnpm), Python (pip, uv, poetry, pipenv),
  PHP/Ruby/Java/Go/Rust manifests. Installs inside a short-lived isolated
  container with the customer workspace at `/home/container`, uid 1000,
  network-isolated from internal services, 2GB RAM / 2 vCPU limits, and
  verifies declared modules resolve. Never guesses modules from `require()`
  statements — only the project manifest drives installation.
- **Lifecycle integration**: dependency install runs automatically before first
  start for non-image-based packages (disable with `LIGHT_AUTO_DEPS=false`).
- **API**: `GET /api/instances/:id/dependencies` (detect + history) and
  `POST /api/instances/:id/dependencies/install` (manual reinstall).
- **Admin**: `AUTO_DEPS_ENABLED` setting (section `runtime`).

Admin bootstrap env vars: `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
`BOOTSTRAP_ADMIN_NAME`.

## Verification performed

- Platform image: `/health` ok, `/`, `/login`, `/admin` all 200, `/api/branding` and admin login functional.
- Compose stack: both services healthy; Shade registered as `node-01` with live CPU/memory/disk metrics and no heartbeat errors.
- Trycord workload image (`packages/trycord/Dockerfile`) verified separately through the real provisioning flow, including the no-package runtime path.
