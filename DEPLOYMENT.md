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

## Verification performed

- Platform image: `/health` ok, `/`, `/login`, `/admin` all 200, `/api/branding` and admin login functional.
- Compose stack: both services healthy; Shade registered as `node-01` with live CPU/memory/disk metrics and no heartbeat errors.
- Trycord workload image (`packages/trycord/Dockerfile`) verified separately through the real provisioning flow, including the no-package runtime path.
