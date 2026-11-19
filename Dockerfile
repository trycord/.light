# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ tar \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data /var/lib/trycord-light && chown -R node:node /data /var/lib/trycord-light
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server ./server
COPY --from=deps /app/agent ./agent
COPY --from=deps /app/public ./public
COPY --from=deps /app/assets ./assets
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/start.js ./start.js
COPY --from=deps /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 5858 5859
ENV PORT=5858 AGENT_PORT=5859 HOST=0.0.0.0 NODE_ENV=production \
    DATABASE_PATH=/data/trycord-light.db \
    CONTROL_URL=http://127.0.0.1:5858 \
    NODE_ID=node-01 \
    AGENT_DATA_DIR=/var/lib/trycord-light \
    LT_MODE=all
VOLUME ["/data", "/var/lib/trycord-light"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["./docker-entrypoint.sh"]
