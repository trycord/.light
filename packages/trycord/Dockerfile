# syntax=docker/dockerfile:1
# .light — Native Trycord hosting package image.
# Built from the real Trycord source in packages/trycord/src.
# Derived from the upstream Trycord Dockerfile (node:22-bookworm-slim, port 9971,
# tini, non-root, /data + /app/uploads persistent, /api/health check).
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY src/package.json src/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=9971 HOST=0.0.0.0 \
    DB_CLIENT=sqlite DB_FILE=/data/trycord.db UPLOAD_DIR=/app/uploads SERVER_HOST_TYPE=express \
    TINI_SUBREAPER=1
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /build/node_modules ./backend/node_modules
COPY src/package.json ./backend/
COPY src/backend ./backend/src
COPY scripts-src ./backend/scripts
COPY src/frontend ./frontend
COPY src/public ./public
RUN mkdir -p /data /app/uploads && chown -R node:node /data /app/uploads /app/backend
WORKDIR /app/backend
USER node
EXPOSE 9971
# No VOLUME declarations: .light bind-mounts the customer's persistent workspace
# at /home/container (data + uploads). Anonymous volumes would leak on recreate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9971)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
