# syntax=docker/dockerfile:1.7
# ==============================================================================
# .light — control plane image
# The actual hosting platform: backend API, authentication, provisioning core,
# public frontend, customer dashboard and admin dashboard.
#
# Shade is a SEPARATE image (Dockerfile.shade). Customer workloads are NEVER
# built into this image — they are launched by Shade at runtime.
# ==============================================================================

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.title=".light" \
      org.opencontainers.image.description=".light hosting platform — control plane, frontend, admin — POWERED BY TRYCORD" \
      org.opencontainers.image.vendor="Trycord"

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      gosu ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /var/lib/trycord-light \
    && chown -R node:node /data /var/lib/trycord-light

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY agent ./agent
COPY public ./public
COPY assets ./assets
COPY start.js docker-entrypoint.sh shade-entry.js ./
RUN chmod +x docker-entrypoint.sh

# 5858 = control plane + all frontends; 5859 = optional built-in Shade (LT_MODE=all)
EXPOSE 5858 5859

ENV PORT=5858 \
    AGENT_PORT=5859 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    DATABASE_PATH=/data/trycord-light.db \
    CONTROL_URL=http://127.0.0.1:5858 \
    NODE_ID=node-01 \
    AGENT_DATA_DIR=/var/lib/trycord-light \
    LT_MODE=all

# Data is persisted via named volumes in docker-compose.yml. No VOLUME here —
# it would create anonymous volumes on every container recreate.

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["./docker-entrypoint.sh"]
