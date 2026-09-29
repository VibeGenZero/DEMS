# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ── Stage 1: install production dependencies ────────────────────────────
# better-sqlite3 ships prebuilt binaries for linux x64/arm64. The build tools
# are only a fallback for platforms without a prebuild and never reach the
# final image.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ── Stage 2: runtime image ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/app/data/dems.sqlite

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# SQLite data lives on a volume so it survives container rebuilds
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run node directly (not via npm) so SIGTERM reaches the graceful shutdown handler
CMD ["node", "server.js"]
