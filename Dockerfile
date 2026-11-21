# syntax=docker/dockerfile:1.7
# ==============================================================================
# .light — ONE Dockerfile, two images.
#
#   docker build --target light -t trycd/trycord-light:1.0.0 .
#   docker build --target shade -t trycd/light-shade:1.0.0   .
#
# light : control plane + public site + customer dashboard + admin dashboard,
#         auth, database, provisioning orchestration, webhooks. No Docker socket.
# shade : infrastructure agent that executes customer workloads. Docker socket
#         mounted ONLY here. Customer workloads are never baked into either image.
# ==============================================================================

# ------------------------------------------------------------------------------
# Shared dependency layer
# ------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Skip install scripts here: node-gyp cannot run under QEMU when cross-building
# amd64 from arm64. The single native dependency (better-sqlite3) is installed
# below from its official prebuilt binary for the target architecture.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts
ARG TARGETARCH
RUN set -e; \
    case "$TARGETARCH" in \
      amd64) A=x64 ;; \
      arm64) A=arm64 ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v137-linux-${A}.tar.gz" \
      -o /tmp/bs3.tgz && tar xzf /tmp/bs3.tgz -C /app/node_modules/better-sqlite3
COPY . .

# ------------------------------------------------------------------------------
# IMAGE 1: light — the platform (control plane + all frontends)
# ------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS light
LABEL org.opencontainers.image.title=".light" \
      org.opencontainers.image.description=".light hosting platform — control plane, public site, customer dashboard, admin — POWERED BY TRYCORD" \
      org.opencontainers.image.vendor="Trycord"

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      gosu ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /var/lib/trycord-light \
    && chown -R node:node /data /var/lib/trycord-light

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/server ./server
COPY --from=deps /app/agent ./agent
COPY --from=deps /app/public ./public
COPY --from=deps /app/assets ./assets
COPY --from=deps /app/start.js /app/docker-entrypoint.sh /app/shade-entry.js ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 5858 5859
ENV PORT=5858 AGENT_PORT=5859 HOST=0.0.0.0 \
    DATABASE_PATH=/data/trycord-light.db \
    CONTROL_URL=http://127.0.0.1:5858 \
    NODE_ID=node-01 AGENT_DATA_DIR=/var/lib/trycord-light LT_MODE=all

# Data persists via named volumes in docker-compose.yml (no anonymous volumes).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["./docker-entrypoint.sh"]

# ------------------------------------------------------------------------------
# IMAGE 2: shade — the infrastructure agent (Docker socket here only)
# ------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS shade
LABEL org.opencontainers.image.title="light-shade" \
      org.opencontainers.image.description=".light infrastructure agent (Shade) — POWERED BY TRYCORD" \
      org.opencontainers.image.vendor="Trycord"

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/light-shade /var/run && chown -R node:node /var/lib/light-shade

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/agent ./agent
COPY --from=deps /app/shade-entry.js ./shade-entry.js
COPY shade-entry.sh ./shade-launch.sh
RUN chmod +x shade-launch.sh

EXPOSE 5859
ENV SHADE_PORT=5859 SHADE_HOST=0.0.0.0 SHADE_DATA_DIR=/var/lib/light-shade \
    SHADE_DOCKER_HOST=unix:///var/run/docker.sock NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5859/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
# Launch as root to fix volume ownership, then drop to node via gosu.
ENTRYPOINT ["./shade-launch.sh"]
