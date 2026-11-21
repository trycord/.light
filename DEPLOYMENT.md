# .light — Docker deployment

## Architecture

| Service | Image | Role | Docker socket |
|---|---|---|---|
| `light` | `trycd/trycord-light:1.0.0` | Control plane, public site, customer dashboard, admin dashboard, auth, database, provisioning orchestration, webhooks | **No** |
| `shade` | `light-shade:latest` (built from `Dockerfile.shade`) | Infrastructure agent — creates and manages customer workload containers | **Yes** |

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
docker build -t trycd/trycord-light:platform -f Dockerfile .
docker build -t light-shade:latest -f Dockerfile.shade .
docker tag trycd/trycord-light:platform trycd/trycord-light:1.0.0
docker push trycd/trycord-light:1.0.0
docker push trycd/trycord-light:latest
```

## Verification performed

- Platform image: `/health` ok, `/`, `/login`, `/admin` all 200, `/api/branding` and admin login functional.
- Compose stack: both services healthy; Shade registered as `node-01` with live CPU/memory/disk metrics and no heartbeat errors.
- Trycord workload image (`packages/trycord/Dockerfile`) verified separately through the real provisioning flow, including the no-package runtime path.
